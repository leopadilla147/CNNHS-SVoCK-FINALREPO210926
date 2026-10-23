-- 098_complaint_against.sql
-- =============================================================
-- "Complaint Against" — who/what the complaint is filed against.
--
-- WHY
--   A student complaint now names the party it is against (Learner
--   Government COMEA, Teacher, Learner, Candidate, Political Party, or
--   Others + a specified text).  It is a plain descriptive field,
--   stored beside the Nature of Complaint (subject) and the Narrative
--   Report (description).
--
-- WHAT
--   1. complaints.complaint_against text — nullable free text, so
--      existing rows stay NULL ("—").
--
-- The student INSERT is the direct, owner-keyed RLS path (028), so the
-- new column rides along with the existing table grants — no RPC change.
-- The 089 election-stamp trigger and the 096 evidence trigger are
-- unaffected.
--
-- Idempotent.  Apply manually via the Supabase Dashboard (AGENTS.md) —
-- never applied by the executor.  Apply in numeric order, after 097.
-- =============================================================

begin;

alter table public.complaints
  add column if not exists complaint_against text;

commit;
