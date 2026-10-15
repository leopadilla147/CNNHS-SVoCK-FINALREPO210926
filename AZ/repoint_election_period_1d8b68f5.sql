-- Repoint parties / candidates / votes onto the FIRST election period.
--
--   source period : a2327f59-f05e-42d8-9518-22f97db37b15  (2024-2025, completed)
--   target period : 1d8b68f5-825b-4643-a78b-8c69b13184da  (2025-2026, active)
--
-- Run in the Supabase SQL editor (executes as postgres, so RLS is bypassed).
-- The change itself is one transaction: the pre-flight assertions abort it
-- before any write, and the post-update assertions abort it before COMMIT.
--
-- WHY THE CONSTRAINT IS DROPPED MID-TRANSACTION:
--   052_party_election_scope.sql:272 added a NOT DEFERRABLE composite FK
--     candidates (party_id, election_period_id) -> parties (id, election_period_id)
--   Being not deferrable, Postgres validates it after every single statement.
--   Moving parties off the old period therefore fails with 23503 while
--   candidates still reference the old pair, and moving candidates first fails
--   the same way in reverse. No ordering satisfies it — the constraint is
--   dropped and re-added inside the same transaction instead. ADD CONSTRAINT
--   re-validates the rows on the spot, so the final state is proven consistent
--   and the constraint is left exactly as 052 defined it (NOT DEFERRABLE).
--
-- WHAT DOES NOT FIRE (checked, not assumed):
--   votes         INSERT-only triggers; no UPDATE guard.
--   candidates    guard_party_approval_before_screening / ..._before_finalize and
--                 sync_party_president_on_screening all require a status
--                 transition; guard_party_president_seat is UPDATE OF party_id,
--                 position (untouched); log_status_change only writes when
--                 old.status is distinct from new.status.
--   parties       no UPDATE trigger.
--   => no audit_log noise, no side effects on parties.president_student_id.
--
-- party_election_scope_map needs no rows: 052_party_election_scope.sql:231
-- drops that table.


-- =====================================================================
-- STEP 1 — SURVEY (read-only, outside the transaction)
--
-- Lists every relation in public carrying an election_period_id, with row
-- counts on each period, so anything the three tables do not cover is visible
-- before you commit.
-- =====================================================================
do $$
declare
  r     record;
  v_all bigint;
  v_old bigint;
  v_new bigint;
begin
  raise notice '% | % | % | %',
    rpad('relation', 34), rpad('rows', 10), rpad('on_old', 10), 'on_target';

  for r in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attname = 'election_period_id'
     and a.attnum > 0
     and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
    order by c.relname
  loop
    execute format(
      'select count(*),'
      ' count(*) filter (where election_period_id = %L::uuid),'
      ' count(*) filter (where election_period_id = %L::uuid)'
      ' from public.%I',
      'a2327f59-f05e-42d8-9518-22f97db37b15',
      '1d8b68f5-825b-4643-a78b-8c69b13184da',
      r.tbl
    )
    into v_all, v_old, v_new;

    raise notice '% | % | % | %',
      rpad(r.tbl, 34), rpad(v_all::text, 10), rpad(v_old::text, 10), v_new;
  end loop;
end $$;


-- =====================================================================
-- STEP 2 — PRE-FLIGHT + STEP 3 — REPOINT + STEP 4 — VERIFY
-- =====================================================================
begin;

do $$
declare
  v_old        constant uuid := 'a2327f59-f05e-42d8-9518-22f97db37b15';
  v_new        constant uuid := '1d8b68f5-825b-4643-a78b-8c69b13184da';
  v_parties    integer;
  v_candidates integer;
  v_votes      integer;
  v_on_target  integer;
begin
  if not exists (select 1 from public.election_periods where id = v_new) then
    raise exception 'Target election period % does not exist.', v_new;
  end if;

  select count(*) into v_parties
    from public.parties where election_period_id = v_old;
  select count(*) into v_candidates
    from public.candidates where election_period_id = v_old;
  select count(*) into v_votes
    from public.votes where election_period_id = v_old;

  -- 6 / 55 / 24 is what the AZ dumps hold. If yours differ the DB has drifted
  -- from the dump; fix that first rather than re-pointing an unknown row set.
  if v_parties <> 6 or v_candidates <> 55 or v_votes <> 24 then
    raise exception
      'Row counts on the source period do not match the AZ dumps (expected 6/55/24, found %/%/%).',
      v_parties, v_candidates, v_votes;
  end if;

  select (select count(*) from public.parties    where election_period_id = v_new)
       + (select count(*) from public.candidates where election_period_id = v_new)
       + (select count(*) from public.votes      where election_period_id = v_new)
    into v_on_target;

  -- Any pre-existing target-period row would collide on
  -- candidates (student_id, election_period_id), (election_period_id,
  -- party_id, position) or votes (voter_id, position, election_period_id).
  if v_on_target > 0 then
    raise exception
      'The target period already holds % row(s) in these three tables; resolve those before re-pointing.',
      v_on_target;
  end if;

  raise notice 'Pre-flight OK: 6 parties / 55 candidates / 24 votes on %, target % empty.',
    v_old, v_new;
end $$;

-- The composite FK is NOT DEFERRABLE, so it is validated after EVERY
-- statement — re-pointing parties alone already fails with 23503 while
-- candidates still reference (party_id, old period). No statement order can
-- satisfy it, because whichever table moves first, the pair the other table
-- points at ceases to exist.
--
-- So the constraint is dropped and re-added inside this same transaction.
-- ADD CONSTRAINT validates existing rows immediately, so it runs against the
-- ALREADY updated rows and proves the new state is consistent. Failure anywhere
-- rolls back the updates and the constraint definition together, and on success
-- the constraint is left with the definition 052 gave it (NOT DEFERRABLE, same
-- columns, same ON DELETE RESTRICT).
alter table public.candidates
  drop constraint candidates_party_election_fkey;

update public.parties
   set election_period_id = '1d8b68f5-825b-4643-a78b-8c69b13184da'
 where election_period_id = 'a2327f59-f05e-42d8-9518-22f97db37b15';

update public.candidates
   set election_period_id = '1d8b68f5-825b-4643-a78b-8c69b13184da'
 where election_period_id = 'a2327f59-f05e-42d8-9518-22f97db37b15';

update public.votes
   set election_period_id = '1d8b68f5-825b-4643-a78b-8c69b13184da'
 where election_period_id = 'a2327f59-f05e-42d8-9518-22f97db37b15';

-- Re-validated here, not merely re-declared: this is the statement that would
-- have caught a bad move, had there been one.
alter table public.candidates
  add constraint candidates_party_election_fkey
  foreign key (party_id, election_period_id)
  references public.parties (id, election_period_id)
  on delete restrict;

do $$
declare
  v_old        constant uuid := 'a2327f59-f05e-42d8-9518-22f97db37b15';
  v_new        constant uuid := '1d8b68f5-825b-4643-a78b-8c69b13184da';
  v_parties    integer;
  v_candidates integer;
  v_votes      integer;
  v_left       integer;
begin
  select count(*) into v_parties
    from public.parties where election_period_id = v_new;
  select count(*) into v_candidates
    from public.candidates where election_period_id = v_new;
  select count(*) into v_votes
    from public.votes where election_period_id = v_new;

  if v_parties <> 6 or v_candidates <> 55 or v_votes <> 24 then
    raise exception
      'Verification failed: expected 6/55/24 on the target period, found %/%/%. Rolling back.',
      v_parties, v_candidates, v_votes;
  end if;

  select (select count(*) from public.parties    where election_period_id = v_old)
       + (select count(*) from public.candidates where election_period_id = v_old)
       + (select count(*) from public.votes      where election_period_id = v_old)
    into v_left;

  if v_left <> 0 then
    raise exception
      'Verification failed: % row(s) still on the source period. Rolling back.', v_left;
  end if;

  raise notice 'Verified: 6 parties / 55 candidates / 24 votes on %, 0 left on %.',
    v_new, v_old;
end $$;

commit;


-- =====================================================================
-- STEP 5 — READ-BACK SUMMARY (run on its own after the commit)
-- =====================================================================
select 'parties' as table_name, election_period_id, count(*) as rows
  from public.parties
 group by election_period_id
union all
select 'candidates', election_period_id, count(*)
  from public.candidates
 group by election_period_id
union all
select 'votes', election_period_id, count(*)
  from public.votes
 group by election_period_id
 order by 1, 2;


-- =====================================================================
-- OPTIONAL — UNCOMMENT WHAT YOU NEED
-- =====================================================================

-- Roll back: the same shape as the forward move, UUIDs swapped. It needs the
-- drop/re-add too — the composite FK is validated per statement, so it trips
-- on the reversal exactly as it did on the way in.
--
-- begin;
-- alter table public.candidates
--   drop constraint candidates_party_election_fkey;
-- update public.parties
--    set election_period_id = 'a2327f59-f05e-42d8-9518-22f97db37b15'
--  where election_period_id = '1d8b68f5-825b-4643-a78b-8c69b13184da';
-- update public.candidates
--    set election_period_id = 'a2327f59-f05e-42d8-9518-22f97db37b15'
--  where election_period_id = '1d8b68f5-825b-4643-a78b-8c69b13184da';
-- update public.votes
--    set election_period_id = 'a2327f59-f05e-42d8-9518-22f97db37b15'
--  where election_period_id = '1d8b68f5-825b-4643-a78b-8c69b13184da';
-- alter table public.candidates
--   add constraint candidates_party_election_fkey
--   foreign key (party_id, election_period_id)
--   references public.parties (id, election_period_id)
--   on delete restrict;
-- commit;

-- The target period now carries 24 votes but still reads as an open
-- candidacy window with no election date, which is what live-results and
-- proclamation paths filter on. Adjust as your testing requires.
--
-- update public.election_periods
--    set election_date = '2026-10-10',
--        lifecycle_stage = 'campaign',
--        start_time = '08:00:00',
--        end_time = '18:00:00'
--  where id = '1d8b68f5-825b-4643-a78b-8c69b13184da';