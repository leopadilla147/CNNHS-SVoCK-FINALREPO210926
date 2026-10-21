-- 090_complaint_findings_required.sql
-- =============================================================
-- Findings are REQUIRED before a complaint can be resolved.
--
-- The Findings note (086 findings_note) is the single official
-- explanation of a decision — complaint true -> actions taken,
-- complaint false -> the reason (e.g. "No Evidence").  Resolving
-- without it would leave a decision with no recorded basis, so
-- decide_complaint_rpc (087 body) now refuses to resolve a
-- complaint whose findings_note is missing or blank.  The UI
-- mirrors this: the Resolved button stays disabled until
-- Findings are saved.
--
-- NOTE: originally numbered 089; renumbered to 090 because an
-- independent 089 (complaint election scope + ELECT-02 gate)
-- already claimed the number.  The two migrations touch disjoint
-- objects and are fully compatible; apply in numeric order.
--
-- Idempotent; wrapped in one transaction.  Apply manually via
-- the Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- decide_complaint_rpc re-issue (087 body + 090 findings guard).
-- Signature unchanged; grants re-asserted below.
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

  -- 090: the Findings note is the official explanation - mandatory first.
  if v_findings is null or btrim(v_findings) = '' then
    raise exception 'Findings are required before a complaint can be resolved.';
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
-- Grants (028 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text) to anon, authenticated;

commit;
