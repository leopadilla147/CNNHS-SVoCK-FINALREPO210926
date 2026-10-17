-- =====================================================================
-- AZ/remove_proclamation_extra_parties_and_candidates_2.sql
--
-- UNDO for the proclamation that can follow
-- AZ/seed_extra_parties_and_candidates_2.sql.
--
-- Deletes, from the election period you paste below and NOTHING ELSE:
--   1. every public.proclamations row naming one of this batch's 50
--      candidates -- resolved by lrn through public.students, scoped to
--      the pasted period (same identification the
--      AZ/remove_extra_parties_and_candidates_2.sql cleanup uses).
--   2. election_periods.proclaimed = false, proclaimed_at = null -- but
--      only if the period has NO proclamation rows left afterwards.  The
--      extra batches (and the main seed) can share one period, so when a
--      sibling batch's proclamation survives the flag is deliberately
--      kept and a notice says so.
--   3. the archived snapshot (past_election_candidates.proclaimed_winner)
--      is refreshed via archive_election_results_internal, which re-derives
--      it from the remaining proclamations ledger -- but only when a
--      snapshot already exists, so an unarchived period does not suddenly
--      gain past_* rows.
--
-- COOPERATIVE WITH THE SIBLING BATCH
--   If this batch and AZ/seed_extra_parties_and_candidates.sql share a
--   period, run each batch's un-proclaim file.  Whichever runs LAST is the
--   one that finds zero proclamations left and clears the period's flag.
--
-- WHAT IS NEVER TOUCHED
--   * the candidates, parties and votes themselves -- this only un-proclaims.
--   * results_published -- un-proclaiming does NOT un-publish the tally.
--   * public.students -- the synthetic students stay exactly as they are.
--   * every other election period.
--
-- RUNS AS: the SQL editor's owner role.  RLS on proclamations is enabled
--   but never FORCED, so the owner bypasses it.  One transaction: a failure
--   rolls the whole thing back, so it is safe to fix and re-run.
-- =====================================================================

-- #####################################################################
-- #  STEP 1 -- EDIT THIS LINE: paste your election period id below.    #
-- #####################################################################
select set_config('svock.seed_election_period_id', 'PASTE-ELECTION-PERIOD-ID-HERE', false);

-- #####################################################################
-- #  STEP 2 -- run the whole script.  Nothing else needs editing.      #
-- #####################################################################

-- Single source of truth for election_period_id in this file.
create or replace function pg_temp.seed_election_period_id()
returns uuid
language sql
stable
as $$
  select nullif(btrim(current_setting('svock.seed_election_period_id', true)), '')::uuid
$$;

begin;

do $$
declare
  v_raw  text := nullif(btrim(current_setting('svock.seed_election_period_id', true)), '');
  v_uuid uuid;
  v_hint constant text :=
    'Edit the set_config call at the top of this script: put your election period id between the quotes, replacing PASTE-ELECTION-PERIOD-ID-HERE.';

  -- The 50 candidates inserted by AZ/seed_extra_parties_and_candidates_2.sql,
  -- keyed by lrn (party A: 259-272, party B: 273-286, party C: 287-300,
  -- independents: 193-200) -- the same lrn set its cleanup file uses.
  v_lrns constant text[] := array[
    '999900000259', '999900000260', '999900000261', '999900000262',
    '999900000263', '999900000264', '999900000271', '999900000272',
    '999900000265', '999900000266', '999900000267', '999900000268',
    '999900000269', '999900000270', '999900000279', '999900000280',
    '999900000281', '999900000282', '999900000283', '999900000284',
    '999900000285', '999900000286', '999900000277', '999900000278',
    '999900000273', '999900000274', '999900000275', '999900000276',
    '999900000293', '999900000294', '999900000295', '999900000296',
    '999900000297', '999900000298', '999900000299', '999900000300',
    '999900000289', '999900000290', '999900000291', '999900000292',
    '999900000287', '999900000288', '999900000193', '999900000194',
    '999900000195', '999900000196', '999900000197', '999900000198',
    '999900000199', '999900000200'
  ];

  v_removed bigint;
  v_procl   bigint;
  v_snapshot_exists boolean;
begin
  if v_raw is null or v_raw = 'PASTE-ELECTION-PERIOD-ID-HERE' then
    raise exception 'No election_period_id pasted (the placeholder is still in place).'
      using hint = v_hint;
  end if;

  begin
    v_uuid := v_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'election_period_id "%" is not a valid uuid.', v_raw
      using hint = v_hint;
  end;

  if not exists (select 1 from public.election_periods p where p.id = v_uuid) then
    raise exception 'No election period with id % -- nothing to un-proclaim.', v_uuid
      using hint = 'Find the id with: select id, school_year, lifecycle_stage, is_active from public.election_periods order by start_at nulls last;';
  end if;

  -- -------------------------------------------------------------------
  -- 1) PROCLAMATIONS naming this batch's candidates, scoped to the
  --    pasted period.  (proclamations.candidate_id references candidates
  --    ON DELETE NO ACTION -- 012:15 -- so this is also what unblocks
  --    deleting the candidates later.)
  -- -------------------------------------------------------------------
  delete from public.proclamations pr
  using public.candidates c
  join public.students s on s.id = c.student_id
  where pr.candidate_id = c.id
    and c.election_period_id = v_uuid
    and s.lrn = any (v_lrns);

  get diagnostics v_removed = row_count;

  -- -------------------------------------------------------------------
  -- 2) The period's proclaimed state.  Only clear it when NO proclamation
  --    is left in the period; otherwise a sibling batch's proclamation
  --    would be silently left without its flag.
  -- -------------------------------------------------------------------
  select count(*) into v_procl
  from public.proclamations pr
  where pr.election_period_id = v_uuid;

  if v_procl = 0 then
    update public.election_periods
       set proclaimed = false,
           proclaimed_at = null
     where id = v_uuid;
  else
    raise notice 'Removed % proclamation(s) for this batch, but the period still holds % proclamation(s) that do NOT name this batch''s candidates; leaving proclaimed = true.', v_removed, v_procl;
  end if;

  -- -------------------------------------------------------------------
  -- 3) Refresh the archived snapshot so past_election_candidates
  --    .proclaimed_winner reflects the remaining ledger (false for this
  --    batch).  Guarded and dynamic so this runs on a database where 061
  --    was never applied, matching the to_regclass pattern used by
  --    AZ/reset_election_data.sql.
  -- -------------------------------------------------------------------
  if to_regclass('public.past_election_candidates') is not null then
    execute
      'select exists (select 1 from public.past_election_candidates where election_period_id = $1)'
      into v_snapshot_exists
      using v_uuid;

    if v_snapshot_exists then
      perform public.archive_election_results_internal(v_uuid);
    end if;
  end if;

  raise notice 'Un-proclaimed % proclamation(s) for this batch in period %.', v_removed, v_uuid;
end;
$$;

commit;

-- ---------------------------------------------------------------------
-- Verify: expect batch_proclamations_left = 0, and proclaimed = false
-- once BOTH extra batches (and any main-seed proclamations) are cleared;
-- it stays true while a sibling batch is still proclaimed.
-- snapshot_proclaimed_winners counts only this batch's rows.
-- ---------------------------------------------------------------------
select
  pg_temp.seed_election_period_id() as period_id,
  (
    select count(*)
    from public.proclamations pr
    join public.candidates c on c.id = pr.candidate_id
    join public.students s on s.id = c.student_id
    where pr.election_period_id = pg_temp.seed_election_period_id()
      and s.lrn = any (array[
        '999900000259', '999900000260', '999900000261', '999900000262',
        '999900000263', '999900000264', '999900000271', '999900000272',
        '999900000265', '999900000266', '999900000267', '999900000268',
        '999900000269', '999900000270', '999900000279', '999900000280',
        '999900000281', '999900000282', '999900000283', '999900000284',
        '999900000285', '999900000286', '999900000277', '999900000278',
        '999900000273', '999900000274', '999900000275', '999900000276',
        '999900000293', '999900000294', '999900000295', '999900000296',
        '999900000297', '999900000298', '999900000299', '999900000300',
        '999900000289', '999900000290', '999900000291', '999900000292',
        '999900000287', '999900000288', '999900000193', '999900000194',
        '999900000195', '999900000196', '999900000197', '999900000198',
        '999900000199', '999900000200'
      ]::text[])
  ) as batch_proclamations_left,
  (
    select e.proclaimed
    from public.election_periods e
    where e.id = pg_temp.seed_election_period_id()
  ) as proclaimed,
  (
    select count(*)
    from public.past_election_candidates pc
    join public.candidates c on c.id = pc.candidate_id
    join public.students s on s.id = c.student_id
    where pc.election_period_id = pg_temp.seed_election_period_id()
      and pc.proclaimed_winner
      and s.lrn = any (array[
        '999900000259', '999900000260', '999900000261', '999900000262',
        '999900000263', '999900000264', '999900000271', '999900000272',
        '999900000265', '999900000266', '999900000267', '999900000268',
        '999900000269', '999900000270', '999900000279', '999900000280',
        '999900000281', '999900000282', '999900000283', '999900000284',
        '999900000285', '999900000286', '999900000277', '999900000278',
        '999900000273', '999900000274', '999900000275', '999900000276',
        '999900000293', '999900000294', '999900000295', '999900000296',
        '999900000297', '999900000298', '999900000299', '999900000300',
        '999900000289', '999900000290', '999900000291', '999900000292',
        '999900000287', '999900000288', '999900000193', '999900000194',
        '999900000195', '999900000196', '999900000197', '999900000198',
        '999900000199', '999900000200'
      ]::text[])
  ) as snapshot_proclaimed_winners;
