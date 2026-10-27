-- 106_check_registration_lrn.sql
-- =============================================================
-- LRN-first registration pre-check (REG-LRN-01).
--
-- The public registration form runs anonymously and `students` is
-- insert-only for anon (001 RLS: "students public registration insert"),
-- so the browser cannot see whether an LRN is already registered.  This
-- SECURITY DEFINER RPC answers exactly one question with no PII:
--
--   { in_students, student_status, in_masterlist }
--
--   in_students    - a students row exists for this LRN (any status)
--   student_status - 'approved' | 'pending' | 'rejected' | null
--   in_masterlist  - an enrolled student_masterlist row exists
--
-- Registration rules built on top of it (RegisterPage + registerStudentDirect):
--   approved in students          -> block: already registered, go to login
--   pending/rejected in students  -> block: a registration is already on file
--   in masterlist only            -> allowed, but the typed details must match
--                                    the masterlist exactly (any mismatch is a
--                                    hard block, MASTER-02 locked rule)
--   nowhere                       -> allowed: registers as pending and waits
--                                    for the SSLG Adviser
-- =============================================================

create or replace function public.check_registration_lrn(p_lrn text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'in_students', exists (
      select 1 from public.students s where s.lrn = p_lrn
    ),
    'student_status', (
      select s.status from public.students s where s.lrn = p_lrn
    ),
    'in_masterlist', exists (
      select 1 from public.student_masterlist m
      where m.lrn = p_lrn
        and m.enrollment_status = 'enrolled'
    )
  );
$$;

revoke all on function public.check_registration_lrn(text) from public;
grant execute on function public.check_registration_lrn(text) to anon, authenticated;
