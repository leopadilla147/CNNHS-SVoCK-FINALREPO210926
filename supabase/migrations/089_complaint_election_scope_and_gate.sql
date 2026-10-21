-- 089_complaint_election_scope_and_gate.sql
-- Complaints: election binding, filing window, and the restored ELECT-02 gate.
--
-- 1) Backfill: complaints filed before election_period_id was ever populated
--    are attached to the current (non-completed) period.  The column has
--    existed since 001, but no client path wrote it, so every live row is
--    NULL and the per-election helpers (has_active_complaint_rpc /
--    count_active_complaints_rpc) never saw them.
-- 2) BEFORE INSERT trigger: every complaint is stamped with the DB's own
--    current election period — a client can never pin a complaint to another
--    election — and the filing window is enforced: complaints open at the
--    campaign stage and close as soon as voting ends (the period reaches the
--    'results' stage).
-- 3) publish_results_rpc / proclaim_winners_rpc: the ELECT-02 hard gate is
--    restored.  Every complaint of the election must be resolved (no rows
--    with status 'filed') before results may be published or winners
--    proclaimed.  081 had relaxed the publish gate into an advisory note;
--    that advisory is a requirement again.

-- ---------------------------------------------------------------------
-- 1) Backfill — attach unassigned complaints to the current period
-- ---------------------------------------------------------------------
update public.complaints
   set election_period_id = public.current_election_period_id()
 where election_period_id is null
   and public.current_election_period_id() is not null;

-- ---------------------------------------------------------------------
-- 2) Election binding + filing window (BEFORE INSERT)
-- ---------------------------------------------------------------------
create or replace function public.set_complaint_election_period()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_period_id uuid;
  v_stage text;
begin
  v_period_id := public.current_election_period_id();

  if v_period_id is null then
    raise exception 'Complaints can only be filed while an election is in progress.';
  end if;

  select lifecycle_stage into v_stage
    from public.election_periods
   where id = v_period_id;

  -- Filing window: opens at the campaign stage (060's fingerprint
  -- registration window and the voting stage stay open) and closes as
  -- soon as voting ends — the moment the period reaches the 'results'
  -- stage.  'application' is not open yet; 'completed' is retired.
  if v_stage = 'application' then
    raise exception 'Complaint filing opens at the campaign stage.';
  end if;
  if v_stage is null or v_stage not in ('campaign', 'fingerprint_registration', 'voting') then
    raise exception 'The complaint window for this election is closed.';
  end if;

  -- Always the DB's own value: a complaint belongs to the election it was
  -- filed under, never to one the client picked.
  new.election_period_id := v_period_id;
  return new;
end;
$$;

drop trigger if exists trg_complaint_election_period on public.complaints;
create trigger trg_complaint_election_period
  before insert on public.complaints
  for each row execute function public.set_complaint_election_period();

-- ---------------------------------------------------------------------
-- 3) publish_results_rpc — same as 081 with the ELECT-02 gate restored.
--    Keeping the admin gate, the still-active gate, and the snapshot freeze.
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

  -- 089: ELECT-02 restored.  Every complaint of this election must be
  -- resolved before the results may be published.
  if public.has_active_complaint_rpc(p_election_id) then
    raise exception 'Results cannot be published while there are unresolved complaints. Resolve all complaints first.';
  end if;

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
-- 4) proclaim_winners_rpc — same tally/insert logic as 081 with the same
--    gate added after the results-published check (covers a complaint
--    filed between publish and proclaim).
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

-- 089: same gate as publish_results_rpc — every complaint of this
-- election must be resolved before the winners may be proclaimed.
if public.has_active_complaint_rpc(p_election_id) then
  raise exception 'Winners cannot be proclaimed while there are unresolved complaints. Resolve all complaints first.';
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
-- 5) Grants (036/065 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.publish_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.publish_results_rpc(uuid) to anon, authenticated;

revoke all on function public.proclaim_winners_rpc(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb, text, text) to anon, authenticated;
