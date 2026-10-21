-- 091_resolve_with_findings.sql
-- =============================================================
-- Resolving a complaint saves its Findings in the same call.
--
-- The UI removed the standalone "Save Findings" button: the
-- Commissioner types the Findings and clicks Resolved — one
-- action.  decide_complaint_rpc (090 body) gains an optional
-- p_findings parameter so the note is written in the SAME
-- update as the decision: a resolution can never exist without
-- its explanation, and there is exactly one audit row per
-- decision.
--
-- Semantics: a non-blank p_findings overwrites findings_note;
-- a blank/null p_findings keeps the already-saved note.  The
-- 090 guard still refuses to resolve when the effective note
-- is blank.
--
-- The 086 save_complaint_findings_rpc stays in the DB (harmless
-- standalone persistence) but nothing calls it anymore.
--
-- NOTE: the 3-argument overload of decide_complaint_rpc is
-- dropped — its signature is superseded by (uuid, text, text,
-- text); calls with fewer arguments still resolve via defaults.
--
-- Idempotent; wrapped in one transaction.  Apply manually via
-- the Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

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

  update public.complaints
     set status = 'accepted',
         findings_note = v_findings,
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
-- Grants (028 pattern: revoke PUBLIC, grant clients) - new 4-arg signature
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text, text) to anon, authenticated;

commit;
