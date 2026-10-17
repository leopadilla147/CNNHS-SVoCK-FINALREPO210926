-- =====================================================================
-- AZ/remove_extra_parties_and_candidates1.sql
--
-- UNDO for AZ/seed_extra_parties_and_candidates.sql.
--
-- Deletes, from the election period you paste below and NOTHING ELSE:
--   1. proclamations naming this batch's candidates   (012 candidate FK
--      is no-action, so these must go before the candidates)
--   2. votes cast for this batch's candidates         (052:344 made
--      votes.candidate_id ON DELETE RESTRICT; vote_receipts cascade
--      with their votes via 032:58)
--   3. this batch's 50 candidates                     (resolved by the
--      batch lrns through public.students, scoped to the pasted period)
--   4. this batch's 3 parties                         (by fixed id +
--      period; party_members cascade via 011:49)
--   5. this period's frozen past-election snapshot rows (the 061/064
--      past_* tables reference election_periods ON DELETE RESTRICT, so
--      they must go before the period -- see "ARCHIVED PERIODS" below)
--   6. the election_periods row itself, but ONLY if nothing else is
--      left in it -- see "COOPERATIVE PERIOD DELETE" below
--
-- WHAT IS NEVER TOUCHED
--   * public.students -- the 300 synthetic students stay exactly as
--     they were.  Only candidates rows are deleted; deleting a student
--     is a different operation and 052's students_no_delete_with_history
--     trigger refuses it for anyone with a candidacy or vote anyway.
--   * the other extra batch -- if both batches live in the same period,
--     this file leaves the other batch's parties, candidates and votes
--     alone (the guards below prove they are untouched).
--   * the original AZ/seed_parties_and_candidates_param.sql rows and
--     any real data -- the period-contents guard aborts loudly if the
--     period holds ANY row this batch does not own.
--   * the period row, if other data still lives in it.
--
-- COOPERATIVE PERIOD DELETE
--   parties.election_period_id is ON DELETE RESTRICT (052:259), so a
--   period holding another batch's parties cannot be deleted until that
--   batch is gone.  Therefore: whichever cleanup file runs LAST deletes
--   the period.  Each file removes its own batch, then deletes the
--   period only if no parties and no candidates remain in it; otherwise
--   it commits the batch removal and reports the period was kept.  Run
--   AZ/seed_extra_parties_and_candidates.sql's cleanup, then AZ/seed_extra_parties_and_candidates_2.sql's cleanup, and the
--   period disappears after the second run.
--   052:386's election_periods_no_delete trigger refuses all period
--   deletes (permanent retention), so step 6 suspends it for the delete
--   and re-enables it in the same transaction -- same pattern as
--   AZ/reset_election_data.sql and AZ/seed_past_elections.sql.
--
-- ⚠ VOTES ARE DESTROYED WITH THE PERIOD
--   Deleting the election_periods row cascades away whatever is left of
--   that period (kiosk cache/queue, complaints, nominations,
--   proclamations, receipts).  By the time this script attempts step 6
--   it has proven the period holds nothing but this batch, so no other
--   seed's votes can be caught.  Votes for THIS batch's candidates are
--   deleted in step 2 regardless -- an undo of the seed is meant to
--   erase the test election it created.
--
-- ARCHIVED PERIODS ARE UN-ARCHIVED WITH THE BATCH
--   If the period was archived (past_election_periods /
--   past_election_candidates / past_election_positions / past_parties
--   all reference election_periods ON DELETE RESTRICT -- 061/064), step
--   5 deletes THIS PERIOD's snapshot rows so the period row can be
--   deleted afterwards.  The snapshot is period-scoped and the guards
--   above have already proven the period contains nothing but the two
--   extra batches, so every frozen row it carries describes seeded test
--   data -- removing it is part of undoing the seed.  The deletes run
--   even when the period itself is KEPT (because the other batch still
--   lives there): a stale snapshot listing just-deleted candidates must
--   not linger in Past Elections; with the snapshot gone,
--   list_past_elections_rpc / get_past_election_results_rpc fall back to
--   live derivation (061 §7) and still render the remaining batch.
--   Guarded with to_regclass so the script also runs on a database
--   where 061/064 were never applied -- same pattern as
--   AZ/reset_election_data.sql.
--
-- RUNS AS: the SQL editor's owner role.  One transaction: a failure
-- rolls the whole thing back, so it is safe to fix and re-run.
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

-- Abort before touching anything if the pasted period is not usable or
-- if it holds data this batch does not own.
do $$
declare
  v_raw  text := nullif(btrim(current_setting('svock.seed_election_period_id', true)), '');
  v_uuid uuid;
  v_strangers text;
  v_hint constant text :=
    'Edit the set_config call at the top of this script: put your election period id between the quotes, replacing PASTE-ELECTION-PERIOD-ID-HERE.';
  v_my_parties constant uuid[] := array['b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'];
  v_my_lrns constant text[] := array['999900000201', '999900000202', '999900000203', '999900000204', '999900000205', '999900000206', '999900000207', '999900000208', '999900000209', '999900000210', '999900000211', '999900000212', '999900000213', '999900000214', '999900000215', '999900000216', '999900000217', '999900000218', '999900000219', '999900000220', '999900000221', '999900000222', '999900000223', '999900000224', '999900000225', '999900000226', '999900000227', '999900000228', '999900000229', '999900000230', '999900000231', '999900000232', '999900000233', '999900000234', '999900000235', '999900000236', '999900000237', '999900000238', '999900000239', '999900000240', '999900000241', '999900000242', '999900000251', '999900000252', '999900000253', '999900000254', '999900000255', '999900000256', '999900000257', '999900000258'];
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
    raise exception 'No election period with id % -- nothing to remove.', v_uuid
      using hint = 'Find the id with: select id, school_year, lifecycle_stage, is_active from public.election_periods order by start_at nulls last;';
  end if;

  -- The period must contain nothing but this batch (and, when both
  -- extra batches share a period, the other extra batch -- its own
  -- cleanup file owns it).  Anything else -- the original param-seed
  -- 55, real candidacies, another party -- aborts.
  select string_agg(x, '; ' order by x) into v_strangers
  from (
    select 'party ' || p.name || ' (' || p.id || ')' as x
    from public.parties p
    where p.election_period_id = v_uuid
      and p.id <> all(v_my_parties)
      and p.id not in ('c2b1f9e3-4d58-4eab-8f32-8a1b72d4e501', 'c2b1f9e3-4d58-4eab-8f32-8a1b72d4e502', 'c2b1f9e3-4d58-4eab-8f32-8a1b72d4e503')
    union all
    select 'candidate ' || s.lrn || ' ' || s.last_name || ' (' || c.position || ')' as x
    from public.candidates c
    join public.students s on s.id = c.student_id
    where c.election_period_id = v_uuid
      and s.lrn <> all(v_my_lrns)
      and s.lrn not in ('999900000259', '999900000260', '999900000261', '999900000262', '999900000263', '999900000264', '999900000265', '999900000266', '999900000267', '999900000268', '999900000269', '999900000270', '999900000271', '999900000272', '999900000273', '999900000274', '999900000275', '999900000276', '999900000277', '999900000278', '999900000279', '999900000280', '999900000281', '999900000282', '999900000283', '999900000284', '999900000285', '999900000286', '999900000287', '999900000288', '999900000289', '999900000290', '999900000291', '999900000292', '999900000293', '999900000294', '999900000295', '999900000296', '999900000297', '999900000298', '999900000299', '999900000300', '999900000193', '999900000194', '999900000195', '999900000196', '999900000197', '999900000198', '999900000199', '999900000200')
    union all
    select 'candidate with unknown student (' || c.position || ', id ' || c.id || ')' as x
    from public.candidates c
    where c.election_period_id = v_uuid
      and not exists (select 1 from public.students s where s.id = c.student_id)
  ) t;
  if v_strangers is not null then
    raise exception 'This period holds rows this cleanup does not own: %. Refusing to continue -- deleting the period would take them with it. Remove them through their own seed''s cleanup (or manually) first.', v_strangers;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) PROCLAMATIONS naming this batch's candidates.  proclamations
--    .candidate_id references candidates ON DELETE NO ACTION (012:15),
--    which would block the candidate deletes below.
-- ---------------------------------------------------------------------
delete from public.proclamations pr
using public.candidates c
join public.students s on s.id = c.student_id
where pr.candidate_id = c.id
  and c.election_period_id = pg_temp.seed_election_period_id()
  and s.lrn = any(array['999900000201', '999900000202', '999900000203', '999900000204', '999900000205', '999900000206', '999900000207', '999900000208', '999900000209', '999900000210', '999900000211', '999900000212', '999900000213', '999900000214', '999900000215', '999900000216', '999900000217', '999900000218', '999900000219', '999900000220', '999900000221', '999900000222', '999900000223', '999900000224', '999900000225', '999900000226', '999900000227', '999900000228', '999900000229', '999900000230', '999900000231', '999900000232', '999900000233', '999900000234', '999900000235', '999900000236', '999900000237', '999900000238', '999900000239', '999900000240', '999900000241', '999900000242', '999900000251', '999900000252', '999900000253', '999900000254', '999900000255', '999900000256', '999900000257', '999900000258']);

-- ---------------------------------------------------------------------
-- 2) VOTES cast for this batch's candidates.  052:344 made
--    votes.candidate_id ON DELETE RESTRICT, so these must go first.
--    vote_receipts (032:58) and the abstain/ledger rows cascade with
--    their votes.  Votes for the OTHER batch (if it shares the period)
--    name other candidates and are untouched.
-- ---------------------------------------------------------------------
delete from public.votes v
using public.candidates c
join public.students s on s.id = c.student_id
where v.candidate_id = c.id
  and c.election_period_id = pg_temp.seed_election_period_id()
  and s.lrn = any(array['999900000201', '999900000202', '999900000203', '999900000204', '999900000205', '999900000206', '999900000207', '999900000208', '999900000209', '999900000210', '999900000211', '999900000212', '999900000213', '999900000214', '999900000215', '999900000216', '999900000217', '999900000218', '999900000219', '999900000220', '999900000221', '999900000222', '999900000223', '999900000224', '999900000225', '999900000226', '999900000227', '999900000228', '999900000229', '999900000230', '999900000231', '999900000232', '999900000233', '999900000234', '999900000235', '999900000236', '999900000237', '999900000238', '999900000239', '999900000240', '999900000241', '999900000242', '999900000251', '999900000252', '999900000253', '999900000254', '999900000255', '999900000256', '999900000257', '999900000258']);

-- ---------------------------------------------------------------------
-- 3) CANDIDATES -- this batch's 50 rows, resolved by lrn through
--    public.students and scoped to the pasted period.  students rows
--    are NOT deleted -- only the candidacies.
-- ---------------------------------------------------------------------
delete from public.candidates c
using public.students s
where c.student_id = s.id
  and c.election_period_id = pg_temp.seed_election_period_id()
  and s.lrn = any(array['999900000201', '999900000202', '999900000203', '999900000204', '999900000205', '999900000206', '999900000207', '999900000208', '999900000209', '999900000210', '999900000211', '999900000212', '999900000213', '999900000214', '999900000215', '999900000216', '999900000217', '999900000218', '999900000219', '999900000220', '999900000221', '999900000222', '999900000223', '999900000224', '999900000225', '999900000226', '999900000227', '999900000228', '999900000229', '999900000230', '999900000231', '999900000232', '999900000233', '999900000234', '999900000235', '999900000236', '999900000237', '999900000238', '999900000239', '999900000240', '999900000241', '999900000242', '999900000251', '999900000252', '999900000253', '999900000254', '999900000255', '999900000256', '999900000257', '999900000258']);

-- ---------------------------------------------------------------------
-- 4) PARTIES -- this batch's 3 rows, by fixed id + period.
--    party_members (011:49) cascades with them.
-- ---------------------------------------------------------------------
delete from public.parties p
where p.election_period_id = pg_temp.seed_election_period_id()
  and p.id = any(array['b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403']::uuid[]);

-- ---------------------------------------------------------------------
-- 5) ARCHIVE SNAPSHOT -- this period's rows in the 061/064 past_*
--    tables.  All four reference election_periods ON DELETE RESTRICT,
--    so they must go before the period row in step 6.  The guards above
--    proved the period contains nothing but the two extra batches, so
--    every frozen row here describes seeded test data.  Removed even
--    when the period is KEPT for the other batch: the snapshot is
--    period-scoped and would otherwise linger in Past Elections listing
--    candidates this cleanup just deleted; the past-election RPCs fall
--    back to live derivation (061 §7) without it.  to_regclass-guarded
--    and dynamic so this also runs where 061/064 were never applied --
--    same pattern as AZ/reset_election_data.sql.
-- ---------------------------------------------------------------------
do $$
declare
  v_uuid uuid := pg_temp.seed_election_period_id();
  v_removed text := null;
  v_count bigint;
begin
  if to_regclass('public.past_election_candidates') is not null then
    execute 'delete from public.past_election_candidates where election_period_id = $1' using v_uuid;
    get diagnostics v_count = row_count;
    v_removed := coalesce(v_removed || ', ', '') || v_count || ' past_election_candidates row(s)';
  end if;
  if to_regclass('public.past_election_positions') is not null then
    execute 'delete from public.past_election_positions where election_period_id = $1' using v_uuid;
    get diagnostics v_count = row_count;
    v_removed := coalesce(v_removed || ', ', '') || v_count || ' past_election_positions row(s)';
  end if;
  if to_regclass('public.past_parties') is not null then
    execute 'delete from public.past_parties where election_period_id = $1' using v_uuid;
    get diagnostics v_count = row_count;
    v_removed := coalesce(v_removed || ', ', '') || v_count || ' past_parties row(s)';
  end if;
  if to_regclass('public.past_election_periods') is not null then
    execute 'delete from public.past_election_periods where election_period_id = $1' using v_uuid;
    get diagnostics v_count = row_count;
    v_removed := coalesce(v_removed || ', ', '') || v_count || ' past_election_periods row(s)';
  end if;

  if v_removed is null then
    raise notice 'No past-election snapshot tables found (061/064 not applied); nothing to un-archive for period %.', v_uuid;
  else
    raise notice 'Archive snapshot for period % removed: %.', v_uuid, v_removed;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) ELECTION PERIOD -- only if nothing is left in it.  (Both extra
--    batches may share a period; the cleanup that empties it deletes
--    it.  Anything still present was proven to be another batch's by
--    the guards above, so keeping the period protects it.)
-- ---------------------------------------------------------------------
do $$
declare
  v_uuid uuid := pg_temp.seed_election_period_id();
  v_left_parties bigint;
  v_left_candidates bigint;
begin
  select count(*) into v_left_parties from public.parties where election_period_id = v_uuid;
  select count(*) into v_left_candidates from public.candidates where election_period_id = v_uuid;

  if v_left_parties = 0 and v_left_candidates = 0 then
    -- 052:386 -- election_periods_no_delete refuses every period delete
    -- (permanent retention).  Suspend it for this txn only; the whole
    -- script is one transaction, so a failure rolls the suspension back
    -- with it and the guarantee returns untouched.
    execute 'alter table public.election_periods disable trigger election_periods_no_delete';
    delete from public.election_periods where id = v_uuid;
    execute 'alter table public.election_periods enable trigger election_periods_no_delete';
    raise notice 'Batch removed and the election period % was empty, so it was deleted too.', v_uuid;
  else
    raise notice 'Batch removed. The election period % was KEPT: it still holds % party/parties and % candidate(s) (the other extra batch -- run % next and the period will be deleted then).',
      v_uuid, v_left_parties, v_left_candidates, 'AZ/seed_extra_parties_and_candidates_2.sql cleanup';
  end if;
end;
$$;

commit;

-- ---------------------------------------------------------------------
-- Verify: expect removed_candidates = 50, removed_parties = 3,
-- archive_rows_left = 0 (null only if 061/064 were never applied),
-- period_exists = false (or true with 0 of this batch's rows left if
-- the other batch still lives there).  Students must be untouched:
-- present_students = 50.
-- ---------------------------------------------------------------------
-- Guarded + dynamic so the count is skipped (reported as null) on a
-- database without the 061/064 snapshot tables.
do $$
declare
  v_total bigint := 0;
  v_count bigint;
begin
  if to_regclass('public.past_election_candidates') is not null then
    execute 'select count(*) from public.past_election_candidates where election_period_id = $1' into v_count using pg_temp.seed_election_period_id();
    v_total := v_total + v_count;
  end if;
  if to_regclass('public.past_election_positions') is not null then
    execute 'select count(*) from public.past_election_positions where election_period_id = $1' into v_count using pg_temp.seed_election_period_id();
    v_total := v_total + v_count;
  end if;
  if to_regclass('public.past_parties') is not null then
    execute 'select count(*) from public.past_parties where election_period_id = $1' into v_count using pg_temp.seed_election_period_id();
    v_total := v_total + v_count;
  end if;
  if to_regclass('public.past_election_periods') is not null then
    execute 'select count(*) from public.past_election_periods where election_period_id = $1' into v_count using pg_temp.seed_election_period_id();
    v_total := v_total + v_count;
  end if;
  perform set_config('svock.archive_rows_left', case
    when to_regclass('public.past_election_candidates') is null
     and to_regclass('public.past_election_positions') is null
     and to_regclass('public.past_parties') is null
     and to_regclass('public.past_election_periods') is null
    then null else v_total::text end, false);
end;
$$;

select
  (select count(*) from public.students where lrn = any(array['999900000201', '999900000202', '999900000203', '999900000204', '999900000205', '999900000206', '999900000207', '999900000208', '999900000209', '999900000210', '999900000211', '999900000212', '999900000213', '999900000214', '999900000215', '999900000216', '999900000217', '999900000218', '999900000219', '999900000220', '999900000221', '999900000222', '999900000223', '999900000224', '999900000225', '999900000226', '999900000227', '999900000228', '999900000229', '999900000230', '999900000231', '999900000232', '999900000233', '999900000234', '999900000235', '999900000236', '999900000237', '999900000238', '999900000239', '999900000240', '999900000241', '999900000242', '999900000251', '999900000252', '999900000253', '999900000254', '999900000255', '999900000256', '999900000257', '999900000258'])) as present_students,
  (select count(*) from public.candidates c
     join public.students s on s.id = c.student_id
    where s.lrn = any(array['999900000201', '999900000202', '999900000203', '999900000204', '999900000205', '999900000206', '999900000207', '999900000208', '999900000209', '999900000210', '999900000211', '999900000212', '999900000213', '999900000214', '999900000215', '999900000216', '999900000217', '999900000218', '999900000219', '999900000220', '999900000221', '999900000222', '999900000223', '999900000224', '999900000225', '999900000226', '999900000227', '999900000228', '999900000229', '999900000230', '999900000231', '999900000232', '999900000233', '999900000234', '999900000235', '999900000236', '999900000237', '999900000238', '999900000239', '999900000240', '999900000241', '999900000242', '999900000251', '999900000252', '999900000253', '999900000254', '999900000255', '999900000256', '999900000257', '999900000258'])
      and c.election_period_id = pg_temp.seed_election_period_id())             as candidates_left_in_period,
  (select count(*) from public.parties
    where id = any(array['b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403']::uuid[]))                              as parties_left_anywhere,
  nullif(current_setting('svock.archive_rows_left', true), '')::bigint                          as archive_rows_left,
  exists (select 1 from public.election_periods where id = pg_temp.seed_election_period_id()) as period_exists;
