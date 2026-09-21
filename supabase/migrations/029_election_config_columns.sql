-- 029_election_config_columns.sql
-- =============================================================
-- Phase 4, Plan 04-01 - Task 2 (election config columns:
-- rules-discussion date + voting method)
--
-- Adds the two config columns the re-created AdminElectionSetup
-- (Plan 04-04) writes and the Rules Discussion meeting notice
-- (Plan 04-07) reads:
--   * rules_discussion_at timestamptz - date/time of the rules
--     discussion (APPROV-01 meeting-notice source)
--   * voting_method text - fixed D-06 dropdown set, 'plurality'
--     default so existing period rows (e.g. 2026-2027) keep a
--     valid value without an UPDATE (RESEARCH assumptions A3/A4)
--
-- Policy (D-13): ALL changes land in this single additive
-- migration file.  Every statement is idempotent (drop if exists
-- / add column if not exists) and guarded so re-apply is a no-op.
-- Existing migration bodies 001-027 are NEVER edited.  Only
-- election_periods is touched (D-13: no other tables).
--
-- Apply in numeric order: 001..027, then 028, then 029.  Apply
-- manually via the Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

alter table public.election_periods
  add column if not exists rules_discussion_at timestamptz;

alter table public.election_periods
  add column if not exists voting_method text not null default 'plurality';

-- D-06 fixed values.  Named constraint + drop-if-exists so re-apply
-- is a no-op.
alter table public.election_periods
  drop constraint if exists election_periods_voting_method_check;
alter table public.election_periods
  add constraint election_periods_voting_method_check
  check (voting_method in ('plurality', 'plurality_with_run_off', 'ranked_choice'));

commit;