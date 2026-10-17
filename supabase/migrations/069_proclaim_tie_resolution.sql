-- =====================================================================
-- 069_proclaim_tie_resolution.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   proclaim_winners_rpc (latest body 061:431, originally 012/036) picked
--   every candidate whose count equalled the per-position max:
--       having count(v.id) = (select max(cnt) ...)
--   On a tie that matches MORE THAN ONE candidate, which collides with
--   proclamations UNIQUE (election_period_id, winning_position) (012:19)
--   and makes the whole RPC error out.  The same happens for a position
--   where every candidate sits on 0 votes.  The seed data deliberately
--   kept every count distinct to dodge this, so no real tie ever ran.
--
-- WHAT
--   1. proclamations gains a nullable resolution_method ('manual') so
--      the record shows that a tie was broken by the Electoral Board.
--   2. get_proclamation_tally_rpc returns the per-candidate tally for a
--      period (including 0-vote candidates) so the Election Plan tab can
--      render the running order and flag ties BEFORE proclaiming.
--   3. proclaim_winners_rpc is re-issued with a p_resolutions jsonb:
--        { "Secretary": { "method": "manual", "candidate_id": "<uuid>" } }
--      A position with a single top candidate is proclaimed as before
--      (resolution_method NULL).  A tied position (two or more on the
--      same top count, including an all-zero position) REQUIRES a
--      resolution: 'manual' must name one of the tied candidates.  A
--      missing/invalid resolution raises a clear error instead of a
--      unique-constraint crash.
--      Positions with no approved candidates produce no rows and are
--      simply not proclaimed.
--
-- GATE
--   Both RPCs enforce public.current_app_role() = 'admin' server-side
--   (the session spine, 035), matching the existing proclaim/posture.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) AUDIT COLUMN — how a tie was broken (NULL for uncontested winners).
-- ---------------------------------------------------------------------
alter table public.proclamations
add column if not exists resolution_method text;

alter table public.proclamations
drop constraint if exists proclamations_resolution_method_check;

alter table public.proclamations
add constraint proclamations_resolution_method_check
check (resolution_method is null or resolution_method in ('manual'));

-- ---------------------------------------------------------------------
-- 2) READ SURFACE — the full per-candidate tally for a period.
--    Mirrors the live_results_restricted shape (001:617) but scoped to
--    the requested period and readable by the same admin gate as the
--    proclamation itself.  Zero-vote candidates are included so the tab
--    can show "every position" and detect the all-zero tie.
-- ---------------------------------------------------------------------
drop function if exists public.get_proclamation_tally_rpc(uuid);

create or replace function public.get_proclamation_tally_rpc(p_election_id uuid)
returns table (
"position" text,
candidate_id uuid,
candidate_name text,
party_name text,
votes integer
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
if public.current_app_role() != 'admin' then
  raise exception 'Only administrators can view the proclamation tally.';
end if;

return query
  select
    c.position,
    c.id,
    (c.given_name || ' ' || c.surname)::text,
    p.name,
    count(v.id)::integer
  from public.candidates c
  left join public.parties p on p.id = c.party_id
  left join public.votes v on v.candidate_id = c.id
  where c.election_period_id = p_election_id
    and c.status = 'approved'
  group by c.position, c.id, c.given_name, c.surname, p.name
  order by c.position, count(v.id) desc, c.surname, c.given_name;
end;
$$;

revoke all on function public.get_proclamation_tally_rpc(uuid) from public, anon, authenticated;
grant execute on function public.get_proclamation_tally_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) PROCLAIM WITH TIE RESOLUTION
-- ---------------------------------------------------------------------
drop function if exists public.proclaim_winners_rpc(uuid);

create or replace function public.proclaim_winners_rpc(
p_election_id uuid,
p_resolutions jsonb default '{}'::jsonb
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
    (election_period_id, winning_position, candidate_id, votes, proclaimed_by, resolution_method)
  values
    (p_election_id, r.pos, v_candidate, r.top_votes, public.current_session_user_id(), v_method);
end loop;

drop table if exists _proclaim_tally;

update public.election_periods
set proclaimed = true,
    proclaimed_at = now()
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

revoke all on function public.proclaim_winners_rpc(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb) to anon, authenticated;
