-- 123_board_choice_or_remain_winner.sql
-- =============================================================
-- With a complaint on record, the Electoral Board either
-- affirms "Keep Current Winner" OR chooses the winner(s)
-- itself.
--
-- WHY
--   117/122 made the Board's "Keep Current Winner" affirmation
--   MANDATORY for every position whose winners are the default
--   outcome whenever ANY complaint is on record (any decision —
--   Substantiated, Unsubstantiated, or Dismissed).  That left
--   the Board no alternative: even where the complaint weighed
--   against the leading candidate, the only path forward was to
--   affirm the standing winner.
--
--   123 turns the affirmation into one of TWO equal paths per
--   position: the Board affirms the default winner(s), or it
--   does not — and then it must choose every seat of the
--   position itself, naming its winner(s) from ANY of the
--   position's candidates (e.g. proclaim the runner-up after a
--   substantiated grievance against the top vote-getter).
--
-- WHAT
--   1. proclaim_winners_rpc re-issued (122 body).  The stand-
--      alone remain-winner gate is replaced by branch logic:
--        * v_tied = 1 (unique top):  with a complaint and NO
--          affirmation, the resolution must name exactly v_seats
--          candidates of the position (any vote count); those
--          are proclaimed as 'manual' rows with remain_winner =
--          false.  Otherwise the 117/122 default flow stands
--          (top winner + seat-2 fill, affirmation recorded).
--        * v_tied = v_seats (2-way Grade Representative tie):
--          with a complaint and NO affirmation, same manual
--          requirement; otherwise both proclaimed as 'tie_both'
--          with the affirmation (122).
--        * more tied candidates than seats: unchanged — picking
--          from the tied group already IS the Board's choice,
--          so no affirmation is possible or needed there.
--   2. The gate's error messages carry the affirm-or-choose
--      wording.
--
--   Schema is unchanged.
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
--
-- Apply in numeric order, after 122.
-- =============================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- proclaim_winners_rpc (122 body) — affirm OR choose, per position.
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
v_seats integer;
v_candidate uuid;
v_method text;
v_manual uuid[];
v_remain boolean;
v_next_votes integer;
v_next_tied integer;
v_picked integer;
v_required integer;
v_has_complaint boolean;
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

-- 117: ANY complaint on record (filed or resolved) puts every position
-- whose winners are the default outcome under the affirm-or-choose rule.
select exists (
  select 1 from public.complaints where election_period_id = p_election_id
) into v_has_complaint;

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
  -- 117: Grade Level Representative positions elect TWO winners; every
  -- other position elects one.
  v_seats := case when r.pos like '% Representative' then 2 else 1 end;

  select count(*) into v_tied
  from _proclaim_tally
  where pos = r.pos and vote_count = r.top_votes;

  v_method := null;
  v_manual := null;
  v_remain := false;

  if p_resolutions -> r.pos is not null then
    v_method := p_resolutions -> r.pos ->> 'method';
    v_remain := coalesce((p_resolutions -> r.pos ->> 'remain_winner')::boolean, false);
    if v_method = 'manual' then
      if p_resolutions -> r.pos ? 'candidate_ids' then
        select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_manual
        from jsonb_array_elements_text(p_resolutions -> r.pos -> 'candidate_ids') x;
      elsif nullif(p_resolutions -> r.pos ->> 'candidate_id', '') is not null then
        v_manual := array[(p_resolutions -> r.pos ->> 'candidate_id')::uuid];
      end if;
    elsif v_method is not null then
      raise exception 'Unknown tie resolution method "%" for position "%".', v_method, r.pos;
    end if;
  end if;

  if v_tied = 1 then
    -- A unique top candidate IS the default winner of the first seat,
    -- whatever the remaining seat(s) do.
    if v_has_complaint and not v_remain then
      -- 123: the Board did NOT affirm, so it must CHOOSE — the resolution
      -- names exactly v_seats candidates of this position, any vote count.
      if v_method is null then
        if v_seats = 1 then
          raise exception 'A complaint is on record for this election. For "%", affirm "Keep Current Winner" or choose the winner before proclaiming winners.', r.pos;
        else
          raise exception 'A complaint is on record for this election. For "%", affirm "Keep Current Winner" or choose the 2 winners before proclaiming winners.', r.pos;
        end if;
      end if;

      v_required := v_seats;
      select count(*) into v_picked
      from _proclaim_tally
      where pos = r.pos and candidate_id = any(v_manual);

      if coalesce(array_length(v_manual, 1), 0) <> v_required or v_picked <> v_required then
        if v_seats = 1 then
          raise exception 'The resolution for "%" must name exactly 1 candidate of the position.', r.pos;
        else
          raise exception 'The resolution for "%" must name exactly 2 candidates of the position.', r.pos;
        end if;
      end if;

      insert into public.proclamations
        (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
         resolution_method, decision_reason, tie_break_note, remain_winner)
      select
        p_election_id, r.pos, t.candidate_id, t.vote_count, public.current_session_user_id(),
        'manual',
        nullif(p_resolutions -> r.pos ->> 'reason', ''),
        nullif(p_resolutions -> r.pos ->> 'tie_break', ''),
        false
      from _proclaim_tally t
      where t.pos = r.pos and t.candidate_id = any(v_manual);

    else
      -- Affirmed (or no complaint): the default flow — the top candidate
      -- is proclaimed with the affirmation on record.
      select candidate_id into v_candidate
      from _proclaim_tally
      where pos = r.pos and vote_count = r.top_votes;

      insert into public.proclamations
        (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
         resolution_method, decision_reason, tie_break_note, remain_winner)
      values
        (p_election_id, r.pos, v_candidate, r.top_votes, public.current_session_user_id(),
         null, null, null, v_remain);

      if v_seats = 2 then
        -- Seat 2 goes to the next distinct vote count.
        select max(vote_count) into v_next_votes
        from _proclaim_tally
        where pos = r.pos and vote_count < r.top_votes;

        if v_next_votes is not null then
          select count(*) into v_next_tied
          from _proclaim_tally
          where pos = r.pos and vote_count = v_next_votes;

          if v_next_tied = 1 then
            -- Unique runner-up — the second default winner.
            select candidate_id into v_candidate
            from _proclaim_tally
            where pos = r.pos and vote_count = v_next_votes;

            insert into public.proclamations
              (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
               resolution_method, decision_reason, tie_break_note, remain_winner)
            values
              (p_election_id, r.pos, v_candidate, v_next_votes, public.current_session_user_id(),
               null, null, null, v_remain);
          else
            -- A tie for the LAST seat: the Board picks exactly one of them.
            if v_method is null then
              raise exception 'The position "%" ends with a %-way tie for the remaining seat. Choose the Electoral Board''s winner before proclaiming winners.',
                r.pos, v_next_tied;
            end if;

            v_required := 1;
            select count(*) into v_picked
            from _proclaim_tally
            where pos = r.pos and vote_count = v_next_votes
              and candidate_id = any(v_manual);

            if coalesce(array_length(v_manual, 1), 0) <> v_required or v_picked <> v_required then
              raise exception 'The resolution for "%" must name exactly one of the % candidates tied for the remaining seat.',
                r.pos, v_next_tied;
            end if;

            select candidate_id into v_candidate
            from _proclaim_tally
            where pos = r.pos and vote_count = v_next_votes
              and candidate_id = any(v_manual);

            insert into public.proclamations
              (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
               resolution_method, decision_reason, tie_break_note, remain_winner)
            values
              (p_election_id, r.pos, v_candidate, v_next_votes, public.current_session_user_id(),
               'manual',
               nullif(p_resolutions -> r.pos ->> 'reason', ''),
               nullif(p_resolutions -> r.pos ->> 'tie_break', ''),
               false);
          end if;
        end if;
        -- v_next_votes is null: only one candidate stands, so the position
        -- simply elects that single winner.
      end if;
    end if;

  elsif v_tied = v_seats then
    -- 117 — the standing Grade Level Representative rule: exactly 2
    -- candidates tie for the 2 seats.  (For single-seat positions this
    -- branch is unreachable — v_tied = 1 is handled above.)
    if v_has_complaint and not v_remain then
      -- 123: no affirmation — the Board must choose both seats itself.
      if v_method is null then
        raise exception 'A complaint is on record for this election. For "%", affirm "Keep Current Winner" or choose the 2 winners before proclaiming winners.', r.pos;
      end if;

      v_required := v_seats;
      select count(*) into v_picked
      from _proclaim_tally
      where pos = r.pos and candidate_id = any(v_manual);

      if coalesce(array_length(v_manual, 1), 0) <> v_required or v_picked <> v_required then
        raise exception 'The resolution for "%" must name exactly 2 candidates of the position.', r.pos;
      end if;

      insert into public.proclamations
        (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
         resolution_method, decision_reason, tie_break_note, remain_winner)
      select
        p_election_id, r.pos, t.candidate_id, t.vote_count, public.current_session_user_id(),
        'manual',
        nullif(p_resolutions -> r.pos ->> 'reason', ''),
        nullif(p_resolutions -> r.pos ->> 'tie_break', ''),
        false
      from _proclaim_tally t
      where t.pos = r.pos and t.candidate_id = any(v_manual);

    else
      -- 122 — the Board's affirmation is recorded on both rows when it
      -- affirmed the standing winners.
      insert into public.proclamations
        (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
         resolution_method, decision_reason, tie_break_note, remain_winner)
      select
        p_election_id, r.pos, t.candidate_id, t.vote_count, public.current_session_user_id(),
        'tie_both', null, null, v_remain
      from _proclaim_tally t
      where t.pos = r.pos and t.vote_count = r.top_votes;
    end if;

  else
    -- More tied candidates than seats: the Board picks exactly `v_seats`
    -- of them — 1 for a single-seat tie (including an all-zero position)
    -- and 2 for a Grade Level Representative tie of 3 or more.  123 —
    -- picking from the tied group already IS the Board's choice, so no
    -- affirmation applies here.
    if v_method is null then
      if v_seats = 1 then
        raise exception 'The position "%" ends in a %-way tie. Choose the Electoral Board''s winner before proclaiming winners.',
          r.pos, v_tied;
      else
        raise exception 'The position "%" ends in a %-way tie for 2 winners. Choose the Electoral Board''s 2 winners before proclaiming winners.',
          r.pos, v_tied;
      end if;
    end if;

    v_required := v_seats;
    select count(*) into v_picked
    from _proclaim_tally
    where pos = r.pos and vote_count = r.top_votes
      and candidate_id = any(v_manual);

    if coalesce(array_length(v_manual, 1), 0) <> v_required or v_picked <> v_required then
      raise exception 'The resolution for "%" must name exactly % of the % tied candidates.',
        r.pos, v_required, v_tied;
    end if;

    insert into public.proclamations
      (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
       resolution_method, decision_reason, tie_break_note, remain_winner)
    select
      p_election_id, r.pos, t.candidate_id, t.vote_count, public.current_session_user_id(),
      'manual',
      nullif(p_resolutions -> r.pos ->> 'reason', ''),
      nullif(p_resolutions -> r.pos ->> 'tie_break', ''),
      false
    from _proclaim_tally t
    where t.pos = r.pos and t.vote_count = r.top_votes
      and t.candidate_id = any(v_manual);
  end if;
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
order by p.winning_position, p.votes desc;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants (028/089 pattern: revoke PUBLIC, grant clients) — re-asserted
-- so the replaced function keeps exactly the 117 grant surface.
-- ---------------------------------------------------------------------
revoke all on function public.proclaim_winners_rpc(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb, text, text) to anon, authenticated;

commit;
