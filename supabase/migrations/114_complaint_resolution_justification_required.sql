-- 114_complaint_resolution_justification_required.sql
-- =============================================================
-- The Board's "Complaint Resolution and Justification" (the
-- one-time explanation stored as proclamation_decision_reason)
-- becomes required for EVERY Findings decision — not only
-- Substantiated grievances.
--
-- WHY
--   097 tied the reason to substantiated grievances alone: an
--   Unsubstantiated or Dismissed resolution left the public
--   record with no explanation at all.  Every resolution the
--   Grievance Commissioner classifies now owes the Board's
--   one-time explanation before winners may be proclaimed.
--
-- WHAT
--   1. has_decided_complaint_rpc(p_election_period_id) — gate
--      helper: TRUE when any complaint of the election carries a
--      Findings decision ('substantiated', 'unsubstantiated', or
--      'dismissed').  Rows resolved before 097 have no
--      classification and impose nothing.
--   2. proclaim_winners_rpc re-issued (097 body) with the gate
--      widened from has_substantiated_complaint_rpc to
--      has_decided_complaint_rpc: a non-blank p_decision_reason
--      is required whenever any decided grievance is on record.
--      has_substantiated_complaint_rpc itself is kept (still
--      granted, still correct) — the proclaim gate simply no
--      longer consults it alone.
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
--
-- Apply in numeric order, after 113.
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Gate helper — does this election carry ANY Findings decision?
-- ---------------------------------------------------------------------
create or replace function public.has_decided_complaint_rpc(p_election_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.complaints
     where election_period_id = p_election_period_id
       and decision is not null
  );
$$;

-- ---------------------------------------------------------------------
-- 2) proclaim_winners_rpc (097 body) + the widened gate
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

-- 114 (was 097/substantiated-only): ANY Findings decision on record —
-- Substantiated, Unsubstantiated, or Dismissed — requires the Board's
-- one-time Complaint Resolution and Justification.
if public.has_decided_complaint_rpc(p_election_id)
   and (p_decision_reason is null or btrim(p_decision_reason) = '') then
  raise exception 'A Complaint Resolution and Justification is required to proclaim winners while a grievance decision is on record.';
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
-- 3) Grants (028/089 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.has_decided_complaint_rpc(uuid) from public, anon, authenticated;
grant execute on function public.has_decided_complaint_rpc(uuid) to anon, authenticated;

revoke all on function public.proclaim_winners_rpc(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb, text, text) to anon, authenticated;

commit;
