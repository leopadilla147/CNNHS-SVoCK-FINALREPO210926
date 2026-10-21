-- 081_proclamation_decisions.sql
-- Merged "Publish & Proclaim Winners" flow for the Electoral Board.
--
-- 1) publish_results_rpc no longer hard-blocks on filed complaints (the
--    ELECT-02 gate is relaxed): the Electoral Board may proceed, but the
--    merged proclaim flow documents the board's decision reason and a note
--    on the complaint(s).
-- 2) proclaim_winners_rpc carries richer tie resolutions (a per-tie reason
--    and how the tie was resolved) plus the board's global decision text.
-- 3) New columns store those decisions.

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
alter table public.proclamations
  add column if not exists decision_reason text;
alter table public.proclamations
  add column if not exists tie_break_note text;

alter table public.election_periods
  add column if not exists proclamation_decision_reason text;
alter table public.election_periods
  add column if not exists proclamation_complaint_note text;

-- ---------------------------------------------------------------------
-- publish_results_rpc — same as 065:239 with the complaint gate removed.
-- Keeping the admin gate, the still-active gate, and the snapshot freeze.
-- ---------------------------------------------------------------------
create or replace function public.publish_results_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can publish results.';
  end if;

  if exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Cannot publish results while the election is still active.';
  end if;

  -- 081: ELECT-02 relaxed.  A filed complaint no longer blocks publication;
  -- the merged proclaim flow requires the board's decision reason and a
  -- complaint note instead (see proclaim_winners_rpc below).

  update public.election_periods
     set results_published = true,
         lifecycle_stage = 'results'
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  -- Publishing results freezes them.  Re-publishing replaces the snapshot,
  -- so the archive always reflects the newest tallies.
  perform public.archive_election_results_internal(p_election_id);
end;
$$;

-- ---------------------------------------------------------------------
-- proclaim_winners_rpc — same tally/insert logic as 069:105, extended with:
--   * per-tie 'reason' + 'tie_break' strings in the p_resolutions entries,
--     stored on the proclamation row,
--   * p_decision_reason / p_complaint_note recorded on the period row
--     (only non-null values overwrite what is already there).
-- ---------------------------------------------------------------------
drop function if exists public.proclaim_winners_rpc(uuid, jsonb);

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

revoke all on function public.proclaim_winners_rpc(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb, text, text) to anon, authenticated;
