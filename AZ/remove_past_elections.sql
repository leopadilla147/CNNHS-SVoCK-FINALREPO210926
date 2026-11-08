-- =====================================================================
-- AZ/remove_past_elections.sql
--
-- UNDO for AZ/seed_past_elections.sql.
--
-- WHAT THE SEED OWNS
--   Everything under the five fixed period ids
--   5a000000-0000-4000-8000-000000000001 .. 000000000005 (school years
--   2019-2020 .. 2023-2024): the periods themselves, 20 parties
--   (5b000000-...), 260 candidates (5c000000-...), 2600 live votes, 65
--   proclamations and the frozen 061 snapshot.  The fixed-id namespace
--   is what makes this undo safe: it deletes BY PERIOD ID, but only
--   after the guard below has proven the periods hold nothing the seed
--   did not write.
--
-- Deletes, from the five seed periods and NOTHING ELSE:
--   1. kiosk_vote_queue pointers detached   (031:255 no-action FK would
--      block the vote delete otherwise)
--   2. proclamations in the five periods    (012 candidate FK is
--      no-action, so these must go before the candidates)
--   3. ALL votes in the five periods        (052:344 made
--      votes.candidate_id ON DELETE RESTRICT; vote_receipts cascade
--      with their votes via 032:58)
--   4. the five periods' archived ballots in 138's votes_archive (its
--      election_period FK is ON DELETE RESTRICT -- normally empty here,
--      because only finalize/reset archive the CURRENT period and the
--      seed periods are retired -- but the table must never block the
--      period delete; same treatment as the other AZ cleanups)
--   5. the 260 candidates
--   6. the 20 parties                        (party_members cascade via
--      011:49)
--   7. the five periods' frozen past-election snapshot rows (the
--      061/064/085 past_* tables all reference election_periods ON
--      DELETE RESTRICT, so they must go before the periods)
--   8. the five election_periods rows        (052:386's
--      election_periods_no_delete trigger is suspended for this txn
--      only, the seed's own guarded pattern)
--
-- WHAT IS NEVER TOUCHED
--   * public.students -- the 300 synthetic students stay exactly as
--     they were.  The seed resolved them by lrn (999900000001 ..
--     999900000280) and this undo only removes candidacies.
--   * the current election period and every other period -- every
--     delete is scoped to the five fixed ids, and the guard aborts
--     loudly if anything foreign lives under them (a party not on the
--     5b namespace, a candidate not on the 5c namespace / synthetic
--     roster, a vote by a non-synthetic voter).
--   * notifications / audit_logs -- this seed wrote none (it inserts
--     rows directly; no RPC that logs ever runs).
--
-- RUNS AS: the SQL editor's owner role.  One transaction: a failure
-- rolls the whole thing back, so it is safe to fix and re-run.  Also
-- idempotent -- running it twice (or on a database where the seed never
-- ran) deletes zero rows and the verify reads all zeros.
--
-- NOTE ON RE-SEEDING
--   The seed's own section 1 clear predates 064/085/138: it removes
--   only three of the five snapshot tables and knows nothing of
--   votes_archive, so on a current schema a straight RE-RUN of
--   AZ/seed_past_elections.sql can fail on past_parties /
--   past_election_complaints RESTRICT.  Run THIS file first (it removes
--   everything the seed owns, snapshot included), then re-run the seed.
-- =====================================================================

-- Single source of truth for the five seed period ids.
create or replace function pg_temp.seed_period_ids()
returns uuid[]
language sql
stable
as $$
  select array[
    '5a000000-0000-4000-8000-000000000001'::uuid,
    '5a000000-0000-4000-8000-000000000002'::uuid,
    '5a000000-0000-4000-8000-000000000003'::uuid,
    '5a000000-0000-4000-8000-000000000004'::uuid,
    '5a000000-0000-4000-8000-000000000005'::uuid
  ]::uuid[]
$$;

begin;

-- ---------------------------------------------------------------------
-- 0. GUARD -- the five periods must hold nothing this seed did not
--    write.  Parties must sit on the seed's 5b namespace, candidates on
--    the 5c namespace AND the synthetic roster, votes must belong to
--    synthetic voters.  Anything else aborts before a single delete.
-- ---------------------------------------------------------------------
do $$
declare
  v_strangers text;
begin
  select string_agg(x, '; ' order by x) into v_strangers
  from (
    select 'party ' || p.name || ' (' || p.id || ')' as x
    from public.parties p
    where p.election_period_id = any (pg_temp.seed_period_ids())
      and p.id::text not like '5b000000-%'
    union all
    select 'candidate ' || coalesce(s.lrn, '<unknown student>') || ' '
             || c.surname || ' (' || c."position" || ')' as x
    from public.candidates c
    left join public.students s on s.id = c.student_id
    where c.election_period_id = any (pg_temp.seed_period_ids())
      and (c.id::text not like '5c000000-%'
           or s.id is null
           or s.lrn not like '9999%')
    union all
    select 'vote by non-synthetic voter (id ' || v.id || ')' as x
    from public.votes v
    join public.students s on s.id = v.voter_id
    where v.election_period_id = any (pg_temp.seed_period_ids())
      and s.lrn not like '9999%'
  ) t;

  if v_strangers is not null then
    raise exception 'The seed periods hold rows this cleanup does not own: %. Refusing to continue -- remove them manually (or through their own seed''s cleanup) first.', v_strangers;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. 052:386 -- permanent-retention trigger; suspend it for this txn
--    only.  Guarded exactly like the seed suspends it.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.election_periods'::regclass
      and tgname = 'election_periods_no_delete'
      and not tgisinternal
  ) then
    execute 'alter table public.election_periods disable trigger election_periods_no_delete';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. KIOSK QUEUE -- detach pointers at the seed votes.  The queue rows
--    themselves are not this seed's and stay.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.kiosk_vote_queue') is not null then
    update public.kiosk_vote_queue
       set linked_vote_id = null
     where election_period_id = any (pg_temp.seed_period_ids());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. PROCLAMATIONS -- every winner named in the five periods.  The
--    candidate FK is no-action (012:15), so these go before step 5.
--    Guarded: the table is optional in some deployments (same tolerance
--    as the seed's own proclamation step).
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.proclamations') is not null then
    delete from public.proclamations
     where election_period_id = any (pg_temp.seed_period_ids());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. VOTES -- the whole seeded ballot box, 520 rows per period.
--    vote_receipts cascade with their votes (032:58).
-- ---------------------------------------------------------------------
delete from public.votes
 where election_period_id = any (pg_temp.seed_period_ids());

-- ---------------------------------------------------------------------
-- 5. ARCHIVED BALLOTS -- the five periods' rows in 138's votes_archive.
--    Normally zero (only finalize/reset archive the CURRENT period,
--    and these periods are retired), but the FK to election_periods is
--    ON DELETE RESTRICT, so it must be cleared before step 9 or it
--    blocks the period delete -- the same votes_archive trap the other
--    AZ cleanups handle.  votes_archive.candidate_id is deliberately
--    not an FK, so ordering against the candidate delete is free.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.votes_archive') is not null then
    delete from public.votes_archive
     where election_period_id = any (pg_temp.seed_period_ids());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. CANDIDATES -- the 260 seeded candidacies, by period.  students
--    rows are NOT deleted -- only the candidacies.
-- ---------------------------------------------------------------------
delete from public.candidates
 where election_period_id = any (pg_temp.seed_period_ids());

-- ---------------------------------------------------------------------
-- 7. PARTIES -- the 20 seeded slates, by period.  party_members
--    (011:49) cascades with them.
-- ---------------------------------------------------------------------
delete from public.parties
 where election_period_id = any (pg_temp.seed_period_ids());

-- ---------------------------------------------------------------------
-- 8. ARCHIVE SNAPSHOT -- the five periods' rows in the 061/064/085
--    past_* tables.  All five tables reference election_periods ON
--    DELETE RESTRICT, so they must go before the periods in step 9.
--    The seed froze them through archive_election_results_internal
--    (260 candidates, 65 positions, 5 periods, 20 parties, and the
--    complaints snapshot -- empty here, the seed writes no complaints).
--    Each table is to_regclass-guarded so this also runs on a database
--    where 061/064/085 were never applied.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.past_election_candidates') is not null then
    execute 'delete from public.past_election_candidates where election_period_id = any ($1)'
      using pg_temp.seed_period_ids();
  end if;
  if to_regclass('public.past_election_positions') is not null then
    execute 'delete from public.past_election_positions where election_period_id = any ($1)'
      using pg_temp.seed_period_ids();
  end if;
  if to_regclass('public.past_parties') is not null then
    execute 'delete from public.past_parties where election_period_id = any ($1)'
      using pg_temp.seed_period_ids();
  end if;
  if to_regclass('public.past_election_complaints') is not null then
    execute 'delete from public.past_election_complaints where election_period_id = any ($1)'
      using pg_temp.seed_period_ids();
  end if;
  if to_regclass('public.past_election_periods') is not null then
    execute 'delete from public.past_election_periods where election_period_id = any ($1)'
      using pg_temp.seed_period_ids();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. ELECTION PERIODS -- the five rows themselves.  The retention
--    trigger is suspended in step 1 and restored in step 10.
-- ---------------------------------------------------------------------
delete from public.election_periods
 where id = any (pg_temp.seed_period_ids());

-- ---------------------------------------------------------------------
-- 10. Put 052's guarantee back.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.election_periods'::regclass
      and tgname = 'election_periods_no_delete'
      and not tgisinternal
  ) then
    execute 'alter table public.election_periods enable trigger election_periods_no_delete';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Guarded counts for the verify below: snapshot rows across the
-- 061/064/085 past_* tables, the periods' votes_archive ballots, and
-- the periods' proclamations.  Each is reported as null when its table
-- does not exist in this deployment.
-- ---------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := pg_temp.seed_period_ids();
  v_seen boolean := false;
  v_total bigint := 0;
  v_count bigint;
begin
  if to_regclass('public.past_election_candidates') is not null then
    execute 'select count(*) from public.past_election_candidates where election_period_id = any ($1)' into v_count using v_ids;
    v_total := v_total + v_count;
    v_seen := true;
  end if;
  if to_regclass('public.past_election_positions') is not null then
    execute 'select count(*) from public.past_election_positions where election_period_id = any ($1)' into v_count using v_ids;
    v_total := v_total + v_count;
    v_seen := true;
  end if;
  if to_regclass('public.past_parties') is not null then
    execute 'select count(*) from public.past_parties where election_period_id = any ($1)' into v_count using v_ids;
    v_total := v_total + v_count;
    v_seen := true;
  end if;
  if to_regclass('public.past_election_complaints') is not null then
    execute 'select count(*) from public.past_election_complaints where election_period_id = any ($1)' into v_count using v_ids;
    v_total := v_total + v_count;
    v_seen := true;
  end if;
  if to_regclass('public.past_election_periods') is not null then
    execute 'select count(*) from public.past_election_periods where election_period_id = any ($1)' into v_count using v_ids;
    v_total := v_total + v_count;
    v_seen := true;
  end if;
  perform set_config('svock.archive_rows_left',
    case when v_seen then v_total::text else null end, false);

  if to_regclass('public.votes_archive') is not null then
    execute 'select count(*) from public.votes_archive where election_period_id = any ($1)' into v_count using v_ids;
    perform set_config('svock.archived_ballots_left', v_count::text, false);
  end if;

  if to_regclass('public.proclamations') is not null then
    execute 'select count(*) from public.proclamations where election_period_id = any ($1)' into v_count using v_ids;
    perform set_config('svock.proclamations_left', v_count::text, false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Verify: expect 0 on every column (null on the config-derived columns
-- only when the underlying table does not exist in this deployment).
-- Before the undo these read 5 / 20 / 260 / 2600 / 65 / 260 / 0.
-- ---------------------------------------------------------------------
select
  (select count(*) from public.election_periods
    where id = any (pg_temp.seed_period_ids()))                                as periods_left,
  (select count(*) from public.parties
    where election_period_id = any (pg_temp.seed_period_ids()))                as parties_left,
  (select count(*) from public.candidates
    where election_period_id = any (pg_temp.seed_period_ids()))                as candidates_left,
  (select count(*) from public.votes
    where election_period_id = any (pg_temp.seed_period_ids()))                as votes_left,
  nullif(current_setting('svock.proclamations_left', true), '')::bigint        as proclamations_left,
  nullif(current_setting('svock.archive_rows_left', true), '')::bigint         as snapshot_rows_left,
  nullif(current_setting('svock.archived_ballots_left', true), '')::bigint     as archived_ballots_left;
