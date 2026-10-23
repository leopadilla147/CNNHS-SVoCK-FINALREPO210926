-- =====================================================================
-- 101_title_case_names.sql
-- Normalise person-name casing to Title Case ("Padilla, Leonard").
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHY
--   The masterlist import used to upper-case names and registrations were
--   stored exactly as typed, so the Student Enrollment list could show
--   "DELA CRUZ, JUAN A." or "leonard padilla".  The app now Title Cases
--   names on write (masterlistDocx.toTitleCase, registerStudentDirect);
--   this backfill brings rows that already exist into the same shape —
--   only the first letter of each name part is a capital.
--
--   initcap() capitalises each name part and lowercases the rest
--   ("DELA CRUZ" -> "Dela Cruz", "PADILLA, LEONARD" -> "Padilla, Leonard",
--   "O'BRIEN" -> "O'Brien").  NULL middle names stay NULL (initcap is
--   strict).  Acronym columns are deliberately NOT touched — strand /
--   section keep "STEM" / "GAS" — and neither is any email.
--
--   The students table's audit_student_status trigger only fires when
--   `status` changes, so a name-only update writes no audit rows.
-- =====================================================================

set search_path = public, extensions;

-- 1) Already-imported masterlist sheet rows.
update public.student_masterlist
   set first_name      = initcap(first_name),
       last_name       = initcap(last_name),
       middle_name     = initcap(middle_name),
       parent_guardian = initcap(parent_guardian),
       adviser_name    = initcap(adviser_name)
 where first_name      is distinct from initcap(first_name)
    or last_name       is distinct from initcap(last_name)
    or middle_name     is distinct from initcap(middle_name)
    or parent_guardian is distinct from initcap(parent_guardian)
    or adviser_name    is distinct from initcap(adviser_name);

-- 2) Registered student accounts.
update public.students
   set first_name  = initcap(first_name),
       last_name   = initcap(last_name),
       middle_name = initcap(middle_name)
 where first_name  is distinct from initcap(first_name)
    or last_name   is distinct from initcap(last_name)
    or middle_name is distinct from initcap(middle_name);
