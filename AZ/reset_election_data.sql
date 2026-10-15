-- =====================================================================
-- AZ/reset_election_data.sql
-- ONE-OFF, DESTRUCTIVE.  Apply by hand in the Supabase SQL editor, which
-- runs as the owner role and so bypasses the client privilege revokes
-- 052 put on these tables.
--
-- Wipes: candidates, parties, votes, proclamations, period-linked
-- complaints, the 061 past-election snapshots, and every
-- election_periods row.
--
-- WHY IT LOOKS LIKE THIS
--   052 §5 made history permanent: a BEFORE DELETE trigger raises on any
--   election_periods delete, and every historical FK is ON DELETE
--   RESTRICT (candidates/parties/votes/proclamations/complaints ->
--   election_periods; votes/proclamations -> candidates; candidates ->
--   parties via the NOT DEFERRABLE composite (party_id,
--   election_period_id)).  The trigger must be suspended and the deletes
--   ordered child-first, or Postgres refuses.
--
-- SURVIVES BY DECISION
--   audit_logs  — the trail of everything so far.
--   biometric_templates — fingerprint enrolments key off students, not
--   elections, so a reset does not disturb them.
--   students / student_masterlist — untouched.  "Already voted" is
--   derived from votes (036:622), not stored on the student, so clearing
--   votes lets the same roster vote again.
--
-- AFTERWARDS
--   election_periods is empty, so current_election_period_id() returns
--   NULL.  Sign in as Chief Commissioner → Election Setup → Reset
--   Election Plan with a school year (e.g. 2026-2027): with no period in
--   progress, reset_election_plan_rpc (060:340-366) inserts the fresh row
--   at lifecycle_stage = 'application'.
--
-- BEFORE YOU RUN IT
--   Confirm you hold dumps of votes, proclamations, complaints and
--   election_periods as well as candidates/parties.  This script is the
--   only copy of nothing — once it commits, the rows are gone for good
--   (052's trigger is restored immediately afterwards and will refuse any
--   further delete).
-- =====================================================================

begin;

-- 1. 052:386 — permanent-retention trigger; suspend it for this txn only.
alter table public.election_periods disable trigger election_periods_no_delete;

-- 2. Children first.  Every FK below is ON DELETE RESTRICT (052 §5).
delete from public.proclamations;                                   -- -> candidates, election_periods
delete from public.votes;                                           -- -> candidates, election_periods
delete from public.complaints where election_period_id is not null; -- -> election_periods
delete from public.candidates;                                      -- -> parties (composite), election_periods
delete from public.parties;                                         -- -> election_periods

-- 3. 061's snapshot tables.  Guarded so the script is also safe on a
--    database where 061 was never applied.
do $$
begin
  if to_regclass('public.past_election_candidates') is not null then
    execute 'delete from public.past_election_candidates';
  end if;
  if to_regclass('public.past_election_positions') is not null then
    execute 'delete from public.past_election_positions';
  end if;
  if to_regclass('public.past_election_periods') is not null then
    execute 'delete from public.past_election_periods';
  end if;
end;
$$;

-- 4. The periods themselves.  current_election_period_id() is now NULL.
delete from public.election_periods;

-- 5. Put 052's guarantee back.
alter table public.election_periods enable trigger election_periods_no_delete;

commit;

-- Verify — every column should read 0.
select
  (select count(*) from public.election_periods) as periods,
  (select count(*) from public.candidates)       as candidates,
  (select count(*) from public.parties)          as parties,
  (select count(*) from public.votes)            as votes,
  (select count(*) from public.proclamations)    as proclamations,
  (select count(*) from public.complaints where election_period_id is not null) as period_complaints;
