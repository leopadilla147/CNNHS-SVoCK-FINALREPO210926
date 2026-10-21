-- =====================================================================
-- 076_remove_pro_position.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   The "PRO" (Public Relations Officer) office is being removed from the
--   election entirely.  The canonical position list is now the 13 seats:
--     President, Vice President, Secretary, Treasurer, Auditor, PIO,
--     Protocol Officer, and the Grade 7-12 Representatives.
--   This migration purges every trace of PRO data (complete purge, per
--   the decision recorded with the change) and tightens the candidates
--   position CHECK so no PRO candidacy can ever be written again.
--
-- DELETION ORDER (FK-safe)
--   proclamations.candidate_id  -> ON DELETE RESTRICT (052:303/344 loop)
--   votes.candidate_id          -> ON DELETE RESTRICT (052:341-344)
--   so the dependents go first, then public.candidates itself.
--   (There is no vote_receipts table to worry about — 037 dropped it.)
--   NOTE: this deletes the votes cast FOR PRO candidates too — that is
--   the point of the complete purge.
--
-- The archived past-election tables (053 past_election_results rows are
-- period-scoped copies; 061 past_election_candidates /
-- past_election_positions carry their own `position` text) are purged as
-- well so nothing named PRO survives anywhere in the schema.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Dependents that would block the candidacy delete.
-- ---------------------------------------------------------------------

-- Proclamation rows won by a PRO candidate, and (defensively) any row
-- keyed as a PRO win regardless of the candidate join.
delete from public.proclamations p
using public.candidates c
where p.candidate_id = c.id
  and c.position = 'PRO';

delete from public.proclamations
where winning_position = 'PRO';

-- The votes themselves (052 made this FK RESTRICT, so it must happen
-- before the candidate row goes).
delete from public.votes v
using public.candidates c
where v.candidate_id = c.id
  and c.position = 'PRO';

-- ---------------------------------------------------------------------
-- 2) The candidacies themselves.
-- ---------------------------------------------------------------------
delete from public.candidates
where position = 'PRO';

-- ---------------------------------------------------------------------
-- 3) Past-election archives — complete purge.
-- ---------------------------------------------------------------------
delete from public.past_election_candidates
where position = 'PRO';

delete from public.past_election_positions
where position = 'PRO';

-- ---------------------------------------------------------------------
-- 4) Tighten the candidates position CHECK to the 13 remaining seats.
-- ---------------------------------------------------------------------
alter table public.candidates
  drop constraint if exists candidates_position_check;

alter table public.candidates
  add constraint candidates_position_check
  check (position in (
    'President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor',
    'PIO', 'Protocol Officer',
    'Grade 7 Representative', 'Grade 8 Representative',
    'Grade 9 Representative', 'Grade 10 Representative',
    'Grade 11 Representative', 'Grade 12 Representative'
  ));

commit;
