-- 086_complaint_findings.sql
-- =============================================================
-- Grievance findings persistence for the Commissioner of Grievance.
--
-- The AdminComplaints "Findings" panel (the reworked Fact-Find
-- surface) must persist its notes: adds complaints.findings_note
-- and the role-gated, audited save_complaint_findings_rpc - the
-- only findings mutation path (complaints UPDATE is revoked from
-- client roles by 028, security R2).
--
-- Findings are working notes while a complaint is 'filed' only;
-- the terminal decision still flows through decide_complaint_rpc
-- (028/035). Status literals stay 'filed'/'accepted'/'rejected' -
-- the "Resolved" wording is a display-layer label only.
--
-- Sections:
--   1. complaints.findings_note column
--   2. save_complaint_findings_rpc (grievance-guarded, audited)
--   3. Grants (028 pattern)
--
-- Idempotent; wrapped in one transaction. Apply manually via the
-- Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- SECTION 1 — findings_note column (additive, existing rows NULL)
-- ---------------------------------------------------------------------
alter table public.complaints
  add column if not exists findings_note text;

-- ---------------------------------------------------------------------
-- SECTION 2 — save_complaint_findings_rpc (035 body style)
-- ---------------------------------------------------------------------
create or replace function public.save_complaint_findings_rpc(
  p_complaint_id uuid,
  p_findings text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject text;
  v_actor_name text;
  v_findings text;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can save complaint findings.';
  end if;

  -- Blank input clears the note (stored NULL) so findings can be retracted.
  v_findings := nullif(btrim(coalesce(p_findings, '')), '');

  select subject into v_subject
    from public.complaints
   where id = p_complaint_id and status = 'filed';

  if not found then
    raise exception 'Complaint not found or not in filed status.';
  end if;

  update public.complaints
     set findings_note = v_findings
   where id = p_complaint_id and status = 'filed';

  select full_name into v_actor_name
    from public.adminprofiles
   where id = public.current_session_user_id();

  -- Audit side-effect (GRIEV-04 pattern): one row per save.
  perform public.insert_audit_log_rpc(
    public.current_session_user_id(),   -- actor id (020 ignores it; auth.uid() is null under custom auth)
    coalesce(v_actor_name, 'Grievance Commissioner'),
    'admin',                            -- commissioners authenticate via the admin path
    'Saved Complaint Findings',
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') findings '
      || case when v_findings is null then 'cleared.' else 'updated.' end,
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 3 — Grants (028 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.save_complaint_findings_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.save_complaint_findings_rpc(uuid, text) to anon, authenticated;

commit;
