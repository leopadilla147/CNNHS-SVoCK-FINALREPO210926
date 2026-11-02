-- 127_complaint_sanctions.sql
-- =============================================================
-- Sanctions on a Substantiated Grievance.
--
-- WHY
--   When the Commissioner of Grievance classifies a resolution as a
--   Substantiated Grievance, the decision carries a consequence.  This
--   migration lets the Commissioner impose one or more sanctions:
--     * verbal_warning   — Verbal Warning
--     * reprimand        — Reprimand Through Writing
--     * disqualification — Disqualification
--   Choosing Disqualification names the candidate(s) to be disqualified
--   and actually disqualifies them (candidate status -> 'rejected' with a
--   high rejection tier), removing them from the tally/proclamation.
--
-- WHAT
--   1. complaints.sanctions text[] — the imposed sanctions (empty for
--      every decision other than 'substantiated').
--   2. complaints.disqualified_candidate_ids uuid[] +
--      complaints.disqualified_candidate_names text[] — the candidates a
--      disqualification sanction removes.  The names are denormalized so
--      the sanitized public record (099) can name them without a join.
--   3. A CHECK that sanctions are only ever carried by a substantiated
--      grievance, are from the known set, and that a disqualification
--      sanction always names at least one candidate.
--   4. decide_complaint_rpc re-issued (097 body) with three new params:
--      p_sanctions, p_disqualified_candidate_ids and
--      p_disqualified_candidate_names.  Validation + the candidate
--      disqualification happen here, in one transaction.
--   5. get_election_complaint_record_rpc RE-DROPPED AND RE-CREATED (099
--      body) to also return the sanctions and the disqualified candidate
--      names so the public results record shows them.
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
-- Apply in numeric order, after 126.
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Sanction columns + CHECK
-- ---------------------------------------------------------------------
alter table public.complaints
  add column if not exists sanctions text[] not null default '{}'::text[];

alter table public.complaints
  add column if not exists disqualified_candidate_ids uuid[] not null default '{}'::uuid[];

alter table public.complaints
  add column if not exists disqualified_candidate_names text[] not null default '{}'::text[];

alter table public.complaints drop constraint if exists complaints_sanctions_check;
alter table public.complaints
  add constraint complaints_sanctions_check
  check (
    sanctions <@ array['verbal_warning', 'reprimand', 'disqualification']::text[]
    and (cardinality(sanctions) = 0 or decision = 'substantiated')
    and (
      not ('disqualification' = any(sanctions))
      or cardinality(disqualified_candidate_names) > 0
    )
  );

-- ---------------------------------------------------------------------
-- 2) decide_complaint_rpc (097 body) + sanctions + auto-disqualification
-- ---------------------------------------------------------------------
drop function if exists public.decide_complaint_rpc(uuid, text, text, text, jsonb, text);

create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null,
  p_findings text default null,
  p_findings_evidence jsonb default null,
  p_decision text default null,
  p_sanctions text[] default '{}'::text[],
  p_disqualified_candidate_ids uuid[] default '{}'::uuid[],
  p_disqualified_candidate_names text[] default '{}'::text[]
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

  if p_action <> 'accepted' then
    raise exception 'Action must be ''accepted'' - complaints are resolved with Findings (087 model).';
  end if;

  -- 097: every resolution carries a classification.
  if p_decision is null or p_decision not in ('substantiated', 'unsubstantiated', 'dismissed') then
    raise exception 'A complaint decision (substantiated, unsubstantiated, or dismissed) is required.';
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

  if 'disqualification' = any(v_sanctions) then
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
-- 3) get_election_complaint_record_rpc (099 body) + sanctions
--    Dropped first: CREATE OR REPLACE cannot add columns to an existing
--    returns-table signature.
-- ---------------------------------------------------------------------
drop function if exists public.get_election_complaint_record_rpc(uuid);

create or replace function public.get_election_complaint_record_rpc(
  p_election_period_id uuid
)
returns table (
  id uuid,
  subject text,
  status text,
  decision text,
  findings text,
  resolved_at timestamptz,
  sanctions text[],
  disqualified_candidate_names text[]
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.subject,
    c.status,
    c.decision,
    c.findings_note as findings,
    c.resolved_at,
    coalesce(c.sanctions, '{}'::text[]) as sanctions,
    coalesce(c.disqualified_candidate_names, '{}'::text[]) as disqualified_candidate_names
  from public.complaints c
  where c.election_period_id = p_election_period_id
  order by c.submitted_at asc, c.id asc;
$$;

-- ---------------------------------------------------------------------
-- 4) Grants (028/089/097 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text, text, jsonb, text, text[], uuid[], text[]) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text, text, jsonb, text, text[], uuid[], text[]) to anon, authenticated;

revoke all on function public.get_election_complaint_record_rpc(uuid) from public, anon, authenticated;
grant execute on function public.get_election_complaint_record_rpc(uuid) to anon, authenticated;

commit;
