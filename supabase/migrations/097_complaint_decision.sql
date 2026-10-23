-- 097_complaint_decision.sql
-- =============================================================
-- Complaint decision classification + the substantiated-grievance
-- gate on proclaiming winners.
--
-- WHY
--   The Commissioner of Grievance now classifies every resolution as a
--   Substantiated, Unsubstantiated, or Dismissed grievance.  A
--   Substantiated grievance taints the election, so the Electoral Board
--   must record a Complaint Reason (a one-time explanation) before the
--   winners can be proclaimed.  Unsubstantiated / Dismissed grievances
--   have no effect on the proclamation (they are only noted in Stage 5).
--
-- WHAT
--   1. complaints.decision text — nullable, CHECK in
--      ('substantiated','unsubstantiated','dismissed').  Existing
--      resolved rows stay NULL ("Not classified").
--   2. has_substantiated_complaint_rpc(p_election_period_id) — the
--      gate helper.
--   3. decide_complaint_rpc re-issued (096 body) with a new required
--      p_decision param — the ONLY path that writes the classification.
--   4. proclaim_winners_rpc re-issued (089 body) + the gate: a
--      substantiated grievance of this election requires a non-blank
--      p_decision_reason before winners may be proclaimed.
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
--
-- Apply in numeric order, after 096.
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Decision column + CHECK
-- ---------------------------------------------------------------------
alter table public.complaints
  add column if not exists decision text;

alter table public.complaints drop constraint if exists complaints_decision_check;
alter table public.complaints
  add constraint complaints_decision_check
  check (decision is null or decision in ('substantiated', 'unsubstantiated', 'dismissed'));

-- ---------------------------------------------------------------------
-- 2) Gate helper — does this election carry a substantiated grievance?
-- ---------------------------------------------------------------------
create or replace function public.has_substantiated_complaint_rpc(p_election_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.complaints
     where election_period_id = p_election_period_id
       and decision = 'substantiated'
  );
$$;

-- ---------------------------------------------------------------------
-- 3) decide_complaint_rpc (096 body) + p_decision
-- ---------------------------------------------------------------------
drop function if exists public.decide_complaint_rpc(uuid, text, text, text, jsonb);

create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null,
  p_findings text default null,
  p_findings_evidence jsonb default null,
  p_decision text default null
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
  v_elem jsonb;
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

  -- 096: the findings evidence must live in the complaint-evidence bucket.
  if p_findings_evidence is not null and jsonb_typeof(p_findings_evidence) = 'array' then
    for v_elem in select * from jsonb_array_elements(p_findings_evidence) loop
      if position('/storage/v1/object/public/complaint-evidence/' in coalesce(v_elem->>'url', '')) = 0 then
        raise exception 'Findings evidence URL must be a complaint-evidence upload.';
      end if;
    end loop;
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
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') resolved — ' || p_decision || ' grievance',
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4) proclaim_winners_rpc (089 body) + substantiated-grievance gate
-- ---------------------------------------------------------------------
create or replace function public.proclaim_winners_rpc(
p_election_id uuid,
p_resolutions jsonb default '{}'::jsonb,
p_decision_reason text default null,
p_complaint_note text default null
)
returns table (
winning_position text,
winner_name text,
votes integer,
resolution_method text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
r record;
v_tied integer;
v_candidate uuid;
v_method text;
v_manual uuid;
begin
if public.current_app_role() != 'admin' then
  raise exception 'Only administrators can proclaim winners.';
end if;

if not exists (select 1 from public.election_periods where id = p_election_id and results_published = true) then
  raise exception 'Results must be published before proclaiming winners.';
end if;

-- 089: every complaint of this election must be resolved first.
if public.has_active_complaint_rpc(p_election_id) then
  raise exception 'Winners cannot be proclaimed while there are unresolved complaints. Resolve all complaints first.';
end if;

-- 097: a substantiated grievance requires the Board's one-time reason.
if public.has_substantiated_complaint_rpc(p_election_id)
   and (p_decision_reason is null or btrim(p_decision_reason) = '') then
  raise exception 'A complaint reason is required to proclaim winners while a substantiated grievance is on record.';
end if;

if p_resolutions is null then
  p_resolutions := '{}'::jsonb;
end if;

delete from public.proclamations where election_period_id = p_election_id;

-- Tally every approved candidate, including 0-vote ones.  Column names
-- are deliberately unqualified-safe (pos/vote_count) so they cannot
-- shadow the OUT parameter `votes`.
create temporary table _proclaim_tally on commit drop as
select c.position as pos, c.id as candidate_id, count(v.id)::integer as vote_count
from public.candidates c
left join public.votes v on v.candidate_id = c.id
where c.election_period_id = p_election_id
  and c.status = 'approved'
group by c.position, c.id;

for r in
  select pos, max(vote_count) as top_votes
  from _proclaim_tally
  group by pos
  order by pos
loop
  select count(*) into v_tied
  from _proclaim_tally
  where pos = r.pos and vote_count = r.top_votes;

  v_candidate := null;
  v_method := null;

  if v_tied = 1 then
    -- Single top candidate — uncontested winner.
    select candidate_id into v_candidate
    from _proclaim_tally
    where pos = r.pos and vote_count = r.top_votes;
  else
    -- Tie (including an all-zero position): a resolution is mandatory
    -- and must specify the Electoral Board's chosen winner.
    if p_resolutions -> r.pos is not null then
      v_method := p_resolutions -> r.pos ->> 'method';
    end if;

    if v_method is null then
      raise exception 'The position "%" ends in a %-way tie. Choose the Electoral Board''s winner before proclaiming winners.',
        r.pos, v_tied;
    elsif v_method = 'manual' then
      v_manual := nullif(p_resolutions -> r.pos ->> 'candidate_id', '')::uuid;
      select candidate_id into v_candidate
      from _proclaim_tally
      where pos = r.pos
        and vote_count = r.top_votes
        and candidate_id = v_manual;
      if v_candidate is null then
        raise exception 'The chosen candidate is not one of the tied candidates for "%".', r.pos;
      end if;
    else
      raise exception 'Unknown tie resolution method "%" for position "%".', v_method, r.pos;
    end if;
  end if;

  insert into public.proclamations
    (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
     resolution_method, decision_reason, tie_break_note)
  values
    (p_election_id, r.pos, v_candidate, r.top_votes, public.current_session_user_id(),
     v_method,
     nullif(p_resolutions -> r.pos ->> 'reason', ''),
     nullif(p_resolutions -> r.pos ->> 'tie_break', ''));
end loop;

drop table if exists _proclaim_tally;

update public.election_periods
set proclaimed = true,
    proclaimed_at = now(),
    proclamation_decision_reason = coalesce(nullif(p_decision_reason, ''), proclamation_decision_reason),
    proclamation_complaint_note = coalesce(nullif(p_complaint_note, ''), proclamation_complaint_note)
where id = p_election_id;

-- 061: refresh the snapshot so proclaimed_winner is no longer stale.
perform public.archive_election_results_internal(p_election_id);

return query
select
  p.winning_position,
  (c.given_name || ' ' || c.surname)::text as winner_name,
  p.votes,
  p.resolution_method
from public.proclamations p
join public.candidates c on c.id = p.candidate_id
where p.election_period_id = p_election_id
order by p.winning_position;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Grants (028/089 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text, text, jsonb, text) to anon, authenticated;

revoke all on function public.has_substantiated_complaint_rpc(uuid) from public, anon, authenticated;
grant execute on function public.has_substantiated_complaint_rpc(uuid) to anon, authenticated;

revoke all on function public.proclaim_winners_rpc(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb, text, text) to anon, authenticated;

commit;
