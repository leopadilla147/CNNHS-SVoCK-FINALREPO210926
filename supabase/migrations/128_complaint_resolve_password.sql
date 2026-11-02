-- 128_complaint_resolve_password.sql
-- =============================================================
-- The Grievance Commissioner's own password gates a Disqualification.
--
-- WHY
--   127 lets the Commissioner impose sanctions on a Substantiated
--   Grievance — and a Disqualification actually flips approved
--   candidates to rejected, dropping them from the tally and the
--   proclamation.  That is a consequential, hard-to-walk-back move, so
--   it gets the same treatment the codebase already gives Disable
--   Student Accounts (107) and Reopen/End Voting (113): the acting
--   Commissioner enters THEIR OWN password, the UI verifies it BEFORE
--   the confirmation dialog, and the consequential RPC re-verifies it
--   server-side before writing.  A stale page or a hand-crafted API
--   call cannot bypass the gate.
--
-- WHAT
--   1. verify_grievance_password_rpc(p_password) — SECURITY DEFINER,
--      resolves the actor from the session spine (022), checks the
--      bcrypt hash with crypt() exactly like 107's
--      verify_adviser_password_rpc, but with a Grievance worded
--      message.  Granted to anon + authenticated so the UI can use it
--      as the pre-gate (108 grant pattern).
--   2. decide_complaint_rpc re-issued (127 body) with a trailing
--      p_password param.  Resolving with a Disqualification sanction
--      REQUIRES the password; the RPC re-verifies it right after the
--      role gate, before anything is written.  Other classifications
--      are unaffected (a password, if sent, is still verified).
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
-- Apply AFTER 127.
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- 1) The password gate — the Commissioner's OWN account password.
-- ---------------------------------------------------------------------
create or replace function public.verify_grievance_password_rpc(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_hash text;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if not found or v_hash is null then
    raise exception 'The Grievance Commissioner password was not accepted.';
  end if;

  if v_hash is distinct from crypt(p_password, v_hash) then
    raise exception 'The Grievance Commissioner password was not accepted.';
  end if;

  return true;
end;
$$;

revoke all on function public.verify_grievance_password_rpc(text) from public;
grant execute on function public.verify_grievance_password_rpc(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) decide_complaint_rpc (127 body) + the server-side password
--    re-verification for a Disqualification.
-- ---------------------------------------------------------------------
drop function if exists public.decide_complaint_rpc(uuid, text, text, text, jsonb, text, text[], uuid[], text[]);

create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null,
  p_findings text default null,
  p_findings_evidence jsonb default null,
  p_decision text default null,
  p_sanctions text[] default '{}'::text[],
  p_disqualified_candidate_ids uuid[] default '{}'::uuid[],
  p_disqualified_candidate_names text[] default '{}'::text[],
  p_password text default null
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
  v_election_id uuid;
  v_elem jsonb;
  v_sanctions text[];
  v_disq_ids uuid[];
  v_disq_names text[];
  v_cand_id uuid;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can decide complaints.';
  end if;

  -- 127: sanctions are from the known set and only accompany a
  -- Substantiated Grievance.
  v_sanctions := coalesce(p_sanctions, '{}'::text[]);
  if exists (
    select 1 from unnest(v_sanctions) s
     where s not in ('verbal_warning', 'reprimand', 'disqualification')
  ) then
    raise exception 'Unknown sanction. Allowed sanctions are verbal_warning, reprimand, or disqualification.';
  end if;

  if cardinality(v_sanctions) > 0 and p_decision <> 'substantiated' then
    raise exception 'Sanctions may only be imposed on a Substantiated Grievance.';
  end if;

  -- 128: resolving with a Disqualification is the consequential move —
  -- it requires the acting Commissioner's OWN password, verified
  -- server-side here so nothing is written on a bad password.  The UI
  -- gates on the same RPC BEFORE its confirmation dialog; this is the
  -- authoritative re-check (107's disable-panel doctrine).
  if 'disqualification' = any(v_sanctions) then
    if p_password is null or btrim(p_password) = '' then
      raise exception 'Enter the Grievance Commissioner password to confirm the disqualification.';
    end if;
    perform public.verify_grievance_password_rpc(p_password);

    v_disq_ids := coalesce(p_disqualified_candidate_ids, '{}'::uuid[]);
    if cardinality(v_disq_ids) = 0 then
      raise exception 'A Disqualification sanction requires the candidate to be disqualified.';
    end if;
  else
    v_disq_ids := '{}'::uuid[];
  end if;

  select subject, findings_note, election_period_id
    into v_subject, v_findings, v_election_id
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

  -- 096: the findings evidence must live in the complaint-evidence bucket.
  if p_findings_evidence is not null and jsonb_typeof(p_findings_evidence) = 'array' then
    for v_elem in select * from jsonb_array_elements(p_findings_evidence) loop
      if position('/storage/v1/object/public/complaint-evidence/' in coalesce(v_elem->>'url', '')) = 0 then
        raise exception 'Findings evidence URL must be a complaint-evidence upload.';
      end if;
    end loop;
  end if;

  -- 127: every disqualified candidate must be an APPROVED candidate of the
  -- complaint's own election.  The stored names are derived server-side, so
  -- a client-supplied list can never drift from the real candidate.
  if cardinality(v_disq_ids) > 0 then
    foreach v_cand_id in array v_disq_ids loop
      if not exists (
        select 1 from public.candidates c
         where c.id = v_cand_id
           and c.election_period_id = v_election_id
           and c.status = 'approved'
      ) then
        raise exception 'The selected candidate is not an approved candidate of this election.';
      end if;
    end loop;

    v_disq_names := coalesce((
      select array_agg(
               btrim(concat_ws(' ', c.given_name, nullif(c.middle_name, ''), c.surname, nullif(c.extension_name, '')))
               order by c.surname, c.given_name
             )
        from public.candidates c
       where c.id = any(v_disq_ids)
    ), '{}'::text[]);
  else
    v_disq_names := '{}'::text[];
  end if;

  -- 092: the deciding Commissioner's name is resolved once, ahead of the
  -- update, so it feeds both the complaint row and the audit log.
  select full_name into v_actor_name
    from public.adminprofiles
   where id = public.current_session_user_id();

  update public.complaints
     set status = 'accepted',
         findings_note = v_findings,
         findings_evidence_urls = coalesce(p_findings_evidence, '[]'::jsonb),
         decision = p_decision,
         sanctions = v_sanctions,
         disqualified_candidate_ids = v_disq_ids,
         disqualified_candidate_names = v_disq_names,
         resolution_note = p_reason,
         resolved_by = public.current_session_user_id(),
         resolved_by_name = v_actor_name,
         resolved_at = now()
   where id = p_complaint_id and status = 'filed';

  -- 127: the Disqualification sanction actually disqualifies.  The high
  -- rejection tier is the schema's "disqualified" marker; a rejected
  -- candidate drops out of every approved-candidate tally and the
  -- proclamation.  reviewed_by was removed by 036; reviewed_at survives.
  if cardinality(v_disq_ids) > 0 then
    update public.candidates
       set status = 'rejected',
           rejection_reason = 'Disqualified through a substantiated grievance',
           rejection_details = 'Disqualified by the Commissioner of Grievance on complaint "' || v_subject || '".',
           rejection_tier = 'high',
           reviewed_at = now()
     where id = any(v_disq_ids)
       and election_period_id = v_election_id
       and status = 'approved';
  end if;

  -- Audit side-effect (GRIEV-04 pattern): one row per decision.
  perform public.insert_audit_log_rpc(
    public.current_session_user_id(),   -- actor id (020 ignores it; auth.uid() is null under custom auth)
    coalesce(v_actor_name, 'Grievance Commissioner'),
    'admin',                            -- commissioners authenticate via the admin path
    'Resolved Complaint',
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') resolved — ' || p_decision || ' grievance'
      || case when cardinality(v_sanctions) > 0
              then '; sanction(s): ' || array_to_string(v_sanctions, ', ')
              else '' end
      || case when cardinality(v_disq_names) > 0
              then '; disqualified: ' || array_to_string(v_disq_names, ', ')
              else '' end,
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Grants (028/089/097 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text, text, jsonb, text, text[], uuid[], text[], text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text, text, jsonb, text, text[], uuid[], text[], text) to anon, authenticated;

commit;
