-- 088_complaint_filed_notification.sql
-- =============================================================
-- Bell notification for new complaints (complaint_filed).
--
-- WHAT
--   AFTER INSERT trigger on public.complaints that files a
--   'complaint_filed' notification for every active Grievance
--   Commissioner.
--
-- WHY
--   The student files the complaint (insertComplaint -> 028
--   owner-keyed INSERT) and has no way to know the commissioners'
--   adminprofiles ids, so the bell notification cannot be written
--   from the client.  A SECURITY DEFINER trigger fires for any
--   insert path with no client changes (071 pattern).
--
--   recipients:  every adminprofiles row with
--                commissioner_role = 'grievance' and status =
--                'active' — co-commissioner rows carry the same
--                commissioner_role (035), so they are notified too.
--                The bell fetch is user_id-scoped
--                (AppContext.fetchNotifications: .eq("user_id",
--                currentUser.id)) and the commissioner's
--                currentUser.id IS the adminprofiles id
--                (login_staff_direct_v2 -> mapStaffLoginRow), so
--                user_id = adminprofiles.id is the correct
--                recipient key.
--   role column: 'admin' (commissioners authenticate via the
--                admin path; allowed by the 011 role CHECK).
--   type column: 'complaint_filed' (already in the 011 type CHECK
--                and mapped in NotificationBell).
--   link:        the Complaints tab Filed filter deep link.
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

create or replace function public.notify_grievance_on_complaint_filed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_name text;
begin
  select coalesce(btrim(s.first_name || ' ' || s.last_name), '')
    into v_student_name
    from public.students s
   where s.id = new.student_id;

  insert into public.notifications (user_id, role, type, title, message, link)
  select
    a.id,
    'admin',
    'complaint_filed',
    'New Complaint Filed',
    case
      when v_student_name is null or v_student_name = '' then
        'A student filed a complaint: "' || new.subject || '". It is awaiting review.'
      else
        v_student_name || ' filed a complaint: "' || new.subject || '". It is awaiting review.'
    end,
    '/admin/complaints?filter=filed'
  from public.adminprofiles a
  where a.commissioner_role = 'grievance'
    and a.status = 'active';

  return new;
end;
$$;

drop trigger if exists trg_notify_grievance_on_complaint_filed on public.complaints;
create trigger trg_notify_grievance_on_complaint_filed
  after insert on public.complaints
  for each row
  execute function public.notify_grievance_on_complaint_filed();

commit;
