-- 071_student_registration_notification.sql
--
-- WHAT
--   AFTER INSERT trigger on public.students that files a
--   'student_registered' notification for every active SSLG adviser.
--
-- WHY
--   Student registration (RegisterPage -> registerStudentDirect) runs
--   anonymously: the registering student has no session and cannot know
--   the advisers' adminprofiles ids, so the bell notification cannot be
--   written from the client.  A SECURITY DEFINER trigger fires for any
--   insert path with no client changes.
--
--   recipients:  every adminprofiles row with role_type = 'sslg_adviser'
--                and status = 'active'.  The bell fetch is user_id-scoped
--                (AppContext.fetchNotifications: .eq("user_id", currentUser.id))
--                and the adviser's currentUser.id IS the adminprofiles id
--                (login_staff_direct_v2 -> mapStaffLoginRow), so user_id
--                = adminprofiles.id is the correct recipient key.
--   role column: 'sslg_adviser' (allowed by the 011 role CHECK).
--   type column: 'student_registered' (already in the 011 / 062 type CHECK).

begin;

create or replace function public.notify_advisers_on_student_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, role, type, title, message, link)
  select
    a.id,
    'sslg_adviser',
    'student_registered',
    'New Student Registration',
    case
      when new.status = 'pending' then
        coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')
        || ' (LRN: ' || coalesce(new.lrn, 'n/a') || ', ' || coalesce(new.grade_level, 'n/a') || ')'
        || ' registered and is awaiting review.'
      else
        coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')
        || ' (LRN: ' || coalesce(new.lrn, 'n/a') || ', ' || coalesce(new.grade_level, 'n/a') || ')'
        || ' registered and was auto-approved.'
    end,
    '/admin/students?filter=pending'
  from public.adminprofiles a
  where a.role_type = 'sslg_adviser'
    and a.status = 'active';

  return new;
end;
$$;

drop trigger if exists trg_notify_advisers_on_student_registration on public.students;
create trigger trg_notify_advisers_on_student_registration
  after insert on public.students
  for each row
  execute function public.notify_advisers_on_student_registration();

commit;