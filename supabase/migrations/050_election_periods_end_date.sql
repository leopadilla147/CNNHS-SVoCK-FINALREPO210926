-- =====================================================================
-- 050_election_periods_end_date.sql
-- Adds the missing end_date column to election_periods.
--
-- 036 reworked the schedule to election_date + start_time/end_time but
-- left no way to record a distinct end date; the Electoral Board's
-- Election Setup tab (AdminElectionSetup) exposes separate Start/End
-- dates, but the end date was silently discarded on reload because the
-- column did not exist.  This restores a nullable end_date so the full
-- voting window (start date, start time, end date, end time) persists.
--
-- Idempotent and safe to re-run.
-- =====================================================================

alter table public.election_periods
  add column if not exists end_date date;

alter table public.election_periods drop constraint if exists election_periods_end_date_order;

alter table public.election_periods
  add constraint election_periods_end_date_order
  check (election_date is null or end_date is null or end_date >= election_date);