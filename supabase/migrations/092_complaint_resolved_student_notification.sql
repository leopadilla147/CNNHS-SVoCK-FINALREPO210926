-- 092_complaint_resolved_student_notification.sql
-- =============================================================
-- The student learns their complaint was resolved — and can
-- download the response letter themselves.
--
-- WHAT
--   1. `complaints.resolved_by_name` — the deciding Grievance
--      Commissioner's name, denormalized onto the complaint row.
--      Students cannot read adminprofiles, so the response letter
--      (generated in the student's browser) needs the name here.
--   2. decide_complaint_rpc re-issued (091 body + one line): the
--      same update that records the decision also stamps the
--      Commissioner's full_name.  The actor lookup moves ahead of
--      the update so one select feeds both the column and the
--      audit row.
--   3. Backfill: complaints resolved before this migration get
--      their resolved_by_name from adminprofiles.
--   4. AFTER UPDATE trigger (088 pattern, mirrored for the student
--      side): the filed -> accepted transition files a
--      'complaint_resolved' bell notification for the student who
--      filed the complaint.  The type already exists in the 011
--      role/type CHECKs (widened by 062) and maps to a green check
--      in NotificationBell — nothing ever wrote it until now.
--
-- WHY
--   The auto-download of the response letter on the Commissioner's
--   browser is removed (the file now belongs to the student, who
--   downloads it manually from My Complaints).  The student has no
--   way to learn of a resolution except re-opening the page, and
--   could not render the Commissioner's name without this column.
--
--   recipients:  the complaining student themself —
--                user_id = complaints.student_id (the student's
--                currentUser.id IS the students.id, mirroring the
--                088 adminprofiles.id keying).
--   role column: 'student' (allowed by the 011 role CHECK).
--   type column: 'complaint_resolved' (011 CHECK + bell mapping).
--   link:        the student's My Complaints page.
--
-- Idempotent; wrapped in one transaction.  Apply manually via
-- the Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- SECTION 1 — resolved_by_name column + backfill
-- ---------------------------------------------------------------------
alter table public.complaints
  add column if not exists resolved_by_name text;

update public.complaints c
   set resolved_by_name = a.full_name
  from public.adminprofiles a
 where c.resolved_by = a.id
   and (c.resolved_by_name is null or btrim(c.resolved_by_name) = '');

-- ---------------------------------------------------------------------
-- SECTION 2 — decide_complaint_rpc (091 body) + resolved_by_name stamp
-- ---------------------------------------------------------------------
drop function if exists public.decide_complaint_rpc(uuid, text, text);

create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null,
  p_findings text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject text;
  v_findings text;
  v_actor_name text;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can decide complaints.';
  end if;

  if p_action <> 'accepted' then
    raise exception 'Action must be ''accepted'' - complaints are resolved with Findings (087 model).';
  end if;

  select subject, findings_note into v_subject, v_findings
    from public.complaints
   where id = p_complaint_id and status = 'filed';

  if not found then
    raise exception 'Complaint not found or not in filed status.';
  end if;

  -- 091: the resolve call may carry the Findings itself.  A non-blank
  -- p_findings wins; otherwise the already-saved note stands.
  v_findings := coalesce(nullif(btrim(coalesce(p_findings, '')), ''), v_findings);

  -- 090: the Findings note is the official explanation - mandatory first.
  if v_findings is null or btrim(v_findings) = '' then
    raise exception 'Findings are required before a complaint can be resolved.';
  end if;

  -- 092: the deciding Commissioner's name is resolved once, ahead of the
  -- update, so it feeds both the complaint row and the audit log.
  select full_name into v_actor_name
    from public.adminprofiles
   where id = public.current_session_user_id();

  update public.complaints
     set status = 'accepted',
         findings_note = v_findings,
         resolution_note = p_reason,
         resolved_by = public.current_session_user_id(),
         resolved_by_name = v_actor_name,
         resolved_at = now()
   where id = p_complaint_id and status = 'filed';

  -- Audit side-effect (GRIEV-04 pattern): one row per decision.
  perform public.insert_audit_log_rpc(
    public.current_session_user_id(),   -- actor id (020 ignores it; auth.uid() is null under custom auth)
    coalesce(v_actor_name, 'Grievance Commissioner'),
    'admin',                            -- commissioners authenticate via the admin path
    'Resolved Complaint',
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') resolved',
    'success'
  );
end;
$$;

-- Grants (028 pattern: revoke PUBLIC, grant clients) - 4-arg signature
revoke all on function public.decide_complaint_rpc(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 3 — bell notification for the student on resolution
-- ---------------------------------------------------------------------
create or replace function public.notify_student_on_complaint_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, role, type, title, message, link)
  values (
    new.student_id,
    'student',
    'complaint_resolved',
    'Complaint Resolved',
    'Your complaint "' || new.subject || '" was reviewed and resolved by the Commissioner of Grievance. '
      || 'Open My Complaints to read the Findings and download your response letter.',
    '/student/complaints'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_student_on_complaint_resolved on public.complaints;
create trigger trg_notify_student_on_complaint_resolved
  after update on public.complaints
  for each row
  when (old.status is distinct from new.status and new.status = 'accepted')
  execute function public.notify_student_on_complaint_resolved();

commit;
