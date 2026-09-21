-- =====================================================================
-- 043_student_session_self_access.sql
-- Ground the student's OWN-ROW access in the session spine.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   The app authenticates via the custom DB session spine (022), NOT
--   Supabase Auth.  There is never a Supabase Auth JWT on a student
--   request, so auth.uid() / auth.email() are ALWAYS NULL.  Several
--   own-row policies were therefore written against a dead source and
--   silently filter to nothing:
--
--     * students    "students self access"
--         using (student_id = auth.uid() or email = auth.email())   -- NULL = false
--     * candidates  (owner leg)
--         exists (select 1 from students s where ... s.student_id = auth.uid()
--                 or s.email = auth.email())                        -- NULL = false
--     * notifications "notifications own read/update"
--         using (user_id = auth.uid() or current_app_role() = 'admin')
--
--   Reported symptom — the student Profile page shows
--   "Student information not found":  StudentProfile.tsx resolves the row
--   via students.find(s => s.id === currentUser.id), and the boot load's
--   GET /rest/v1/students returns ZERO rows for a student session because
--   no policy matches (the admin leg needs current_app_role() = 'admin').
--   The same dead source also blanks the student's own candidacy card and
--   their notification list.
--
-- WHAT
--   Add permissive SELECT policies that resolve the owner through the
--   session spine (current_app_role() = 'student' AND the row key equals
--   current_session_user_id(), which is students.id for student sessions —
--   minted by issue_session_token(v_student.id, 'student')).  The legacy
--   auth.uid()-based policies are left in place (they are simply inert);
--   no existing policy is dropped or narrowed.
--
--   complaints was already re-grounded by 028 (complaints.student_id =
--   current_session_user_id()) and needs no change here.
-- =====================================================================

set search_path = public, extensions;

-- 1) students — a student session may read exactly its own registration row.
drop policy if exists "students self session select" on public.students;
create policy "students self session select"
  on public.students
  for select
  using (
    public.current_app_role() = 'student'
    and id = public.current_session_user_id()
  );

-- 2) candidates — a student session may read its own application (any
--    status), which feeds the Profile page's Candidacy card and the
--    student's own apply-for-candidacy flow.  Other students' non-approved
--    rows remain invisible; approved rows stay publicly readable via the
--    existing policy.
drop policy if exists "candidates self session select" on public.candidates;
create policy "candidates self session select"
  on public.candidates
  for select
  using (
    public.current_app_role() = 'student'
    and student_id = public.current_session_user_id()
  );

-- 3) notifications — a student session may read and update its own
--    notifications (read for the bell; update marks them seen).
drop policy if exists "notifications self session read" on public.notifications;
create policy "notifications self session read"
  on public.notifications
  for select
  using (
    public.current_app_role() = 'student'
    and user_id = public.current_session_user_id()
  );

drop policy if exists "notifications self session update" on public.notifications;
create policy "notifications self session update"
  on public.notifications
  for update
  using (
    public.current_app_role() = 'student'
    and user_id = public.current_session_user_id()
  )
  with check (
    public.current_app_role() = 'student'
    and user_id = public.current_session_user_id()
  );