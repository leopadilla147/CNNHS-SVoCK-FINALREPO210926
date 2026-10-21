-- 087_complaint_resolution_model.sql
-- =============================================================
-- Complaint resolution model: 'rejected' leaves the lifecycle.
--
-- The Commissioner of Grievance closes every complaint as
-- Resolved, and the Findings note (086 findings_note) is the
-- single official explanation: if the complaint is true, the
-- actions taken; if false, the reason behind it (e.g. "No
-- Evidence").  The UI no longer offers Reject, so the DB model
-- follows (labels stay display-layer: 'accepted' reads as
-- "Resolved").
--
-- Sections:
--   1. Status lifecycle swap: rejected -> accepted, old
--      rejection reason preserved as the Findings note, CHECK
--      re-added on ('filed', 'accepted')
--   2. decide_complaint_rpc re-issue: 'accepted' is the only
--      action; audit entry becomes "Resolved Complaint"
--   3. Grants re-asserted (028 pattern)
--
-- Untouched on purpose: save_complaint_findings_rpc (086),
-- has_active_complaint_rpc / count_active_complaints_rpc (both
-- key on 'filed' only), and the past_election_complaints
-- snapshots (frozen history; the Archive page renders their
-- original statuses).
--
-- Idempotent; wrapped in one transaction (028 pattern: the
-- constraint swap plus the row mapping are atomic).  Apply
-- manually via the Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- SECTION 1 — Status lifecycle swap (single statement so only rows that
-- were 'rejected' are touched) + constraint re-add (028 pattern)
-- ---------------------------------------------------------------------
alter table public.complaints drop constraint if exists complaints_status_check;

-- Map every rejected row to the single terminal state and carry its
-- recorded reason into Findings so the explanation is not lost.
-- (Accepted rows never had a resolution_note, so this cannot clobber
-- them; findings_note, when already present, wins.)
update public.complaints
   set status = 'accepted',
       findings_note = coalesce(findings_note, resolution_note)
 where status = 'rejected';

alter table public.complaints
  add constraint complaints_status_check
  check (status in ('filed', 'accepted'));

-- ---------------------------------------------------------------------
-- SECTION 2 — decide_complaint_rpc re-issue (035 body style):
-- 'accepted' is the ONLY action; the Findings note carries the why.
-- Signature unchanged (p_reason kept, always null from the client) so
-- the wrapper needs no call-site change.
-- ---------------------------------------------------------------------
create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject text;
  v_actor_name text;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can decide complaints.';
  end if;

  if p_action <> 'accepted' then
    raise exception 'Action must be ''accepted'' - complaints are resolved with Findings (087 model).';
  end if;

  select subject into v_subject
    from public.complaints
   where id = p_complaint_id and status = 'filed';

  if not found then
    raise exception 'Complaint not found or not in filed status.';
  end if;

  update public.complaints
     set status = 'accepted',
         resolution_note = p_reason,
         resolved_by = public.current_session_user_id(),
         resolved_at = now()
   where id = p_complaint_id and status = 'filed';

  select full_name into v_actor_name
    from public.adminprofiles
   where id = public.current_session_user_id();

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

-- ---------------------------------------------------------------------
-- SECTION 3 — Grants (028 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text) to anon, authenticated;

commit;
