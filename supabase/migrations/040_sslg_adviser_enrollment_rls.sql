-- =====================================================================
-- 040_sslg_adviser_enrollment_rls.sql
-- SSLG Adviser student-enrollment backend (students table).
--
-- Run this in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   The SSLG Adviser portal's "Student Enrollment" tab renders the shared
--   /admin/students enrollment page, which reads public.students and calls
--   review_student_rpc to approve/reject. Two gaps:
--     1. The only SELECT policy on public.students is "students admin all"
--        (current_app_role() = 'admin').  An adviser session resolves
--        current_app_role() = 'sslg_adviser', so RLS filtered the list to
--        empty and the adviser saw no enrollments.
--     2. The client then re-wrote the changed row directly via the
--        PostgREST table UPDATE (AppContext.syncStudents), which the same
--        admin-only policy rejected.
--
--   review_student_rpc (036) is ALREADY adviser-gated — its role check
--   accepts adminprofiles.role_type in
--   ('chief','commissioner','co_commissioner','sslg_adviser') and it writes
--   server-side as SECURITY DEFINER.  So the guarded RPC stays the primary
--   mutation path; this migration only opens the read and the narrow
--   pending-row transition the enrollment UI performs.
--
-- WHAT
--   * SELECT: advisers may read student rows (enrollment list).
--   * UPDATE: advisers may modify ONLY rows currently in status 'pending'
--     (the pre-image USING clause), i.e. they can approve/reject a pending
--     registration but cannot edit an already-decided or approved student.
--     WITH CHECK permits the resulting status (approved/rejected).
--   Both are permissive policies ADDED to the existing admin-all policy.
-- =====================================================================

set search_path = public, extensions;

-- 1) Read: adviser sessions may list students for enrollment verification.
drop policy if exists "students sslg adviser select" on public.students;
create policy "students sslg adviser select"
  on public.students
  for select
  using (public.current_app_role() = 'sslg_adviser');

-- 2) Review: adviser sessions may act ONLY on still-pending rows, mirroring
--    what review_student_rpc allows.  The USING clause is the pre-image
--    (old row must be 'pending'); WITH CHECK validates the post-image
--    (any resulting status the review sets).
drop policy if exists "students sslg adviser review update" on public.students;
create policy "students sslg adviser review update"
  on public.students
  for update
  using (public.current_app_role() = 'sslg_adviser' and status = 'pending')
  with check (public.current_app_role() = 'sslg_adviser');