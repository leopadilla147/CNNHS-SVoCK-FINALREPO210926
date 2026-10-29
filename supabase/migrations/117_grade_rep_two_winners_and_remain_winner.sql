-- 117_grade_rep_two_winners_and_remain_winner.sql
-- =============================================================
-- Grade Level Representatives elect TWO winners, and the Board
-- affirms a default winner with "Remain Winner" when a
-- complaint is on record.
--
-- WHY
--   Every Grade Level Representative position ("Grade 7
--   Representative" ... "Grade 12 Representative") now elects TWO
--   winners instead of one:
--     * a clear highest-vote order (unique 1st, unique 2nd) proclaims
--       both automatically;
--     * exactly 2 candidates tied at the top proclaims BOTH — the
--       standing rule, no Board pick needed;
--     * 3 or more tied at the top requires the Electoral Board to
--       pick exactly 2 of them;
--     * a unique 1st with a tie underneath (2 or more candidates
--       sharing the next count) proclaims the 1st automatically and
--       requires the Board to pick exactly 1 of the tied for the
--       remaining seat.
--   Single-seat positions keep the 069/081/114 behavior unchanged.
--
--   Separately: complaints are election-wide rows (no position
--   link), so when ANY complaint is on record for the election, the
--   Board must affirm every DEFAULT winner — the candidate holding
--   strictly the highest vote — with "Remain Winner" before the
--   proclamation may proceed.  The affirmation is written onto the
--   proclamation row so the record shows the Board weighed the
--   complaint and the winner stands.  Tie-resolved seats need no
--   affirmation: the Board's pick there already IS the decision.
--
-- WHAT
--   1. proclamations — the one-winner-per-position UNIQUE constraint
--      (012:19) becomes (election_period_id, winning_position,
--      candidate_id) so a Grade Level Representative position can
--      hold two proclaimed winners;  resolution_method gains the
--      'tie_both' value for the auto both-win outcome;  a new
--      remain_winner boolean records the Board's affirmation.
--   2. proclaim_winners_rpc re-issued (114 body) with the seat-aware
--      algorithm and the remain_winner gate described above.
--      p_resolutions entries now carry:
--        { "Secretary": { "method": "manual", "candidate_ids": ["<uuid>"],
--                         "tie_break": "Coin Toss", "remain_winner": true } }
--      (the legacy single "candidate_id" is still accepted and read
--      as a one-element candidate_ids array).
--   3. archive_election_results_internal re-issued (085 body) with a
--      seat-aware is_winner: a candidate is a snapshot winner when
--      fewer candidates share strictly more votes than there are
--      seats in the position (reduces to the old top-1 rule for
--      single-seat positions).
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
--
-- Apply in numeric order, after 116.
-- =============================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) SCHEMA — two winners per Grade Level Representative position.
-- ---------------------------------------------------------------------
alter table public.proclamations
  drop constraint if exists proclamations_election_period_id_winning_position_key;

alter table public.proclamations
  add constraint proclamations_election_period_position_candidate_key
  unique (election_period_id, winning_position, candidate_id);

-- 117 — the Board's "Remain Winner" affirmation of a default winner
-- (set at proclaim time; never set for tie-resolved seats).
alter table public.proclamations
  add column if not exists remain_winner boolean not null default false;

-- 'tie_both' — exactly `seats` candidates tied at the top and all of
-- them were proclaimed by the standing rule, without a Board pick.
alter table public.proclamations
  drop constraint if exists proclamations_resolution_method_check;

alter table public.proclamations
  add constraint proclamations_resolution_method_check
  check (resolution_method is null or resolution_method in ('manual', 'tie_both'));

-- ---------------------------------------------------------------------
-- 2) proclaim_winners_rpc — seat-aware, with the remain-winner gate.
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

-- 117: ANY complaint on record (filed or resolved) obliges the Board to
-- affirm every DEFAULT winner — the candidate holding strictly the
-- highest vote — with "Remain Winner" before proclaiming.
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

  -- 117: the "Remain Winner" gate.  A unique top candidate IS the default
  -- winner, whatever the remaining seat(s) do — so with a complaint on
  -- record the Board must have affirmed the position before proclaiming.
  if v_has_complaint and v_tied = 1 and not v_remain then
    raise exception 'A complaint is on record for this election. Confirm "Remain Winner" for "%" before proclaiming winners.', r.pos;
  end if;

  if v_tied = 1 then
    -- Single top candidate — a default winner of the first seat.
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

  elsif v_tied = v_seats then
    -- 117 — the standing Grade Level Representative rule: exactly 2
    -- candidates tie for the 2 seats, so BOTH are proclaimed without a
    -- Board pick.  (For single-seat positions this branch is the old
    -- uncontested path and is unreachable here — v_tied = 1 is handled
    -- above.)
    insert into public.proclamations
      (election_period_id, winning_position, candidate_id, votes, proclaimed_by,
       resolution_method, decision_reason, tie_break_note, remain_winner)
    select
      p_election_id, r.pos, t.candidate_id, t.vote_count, public.current_session_user_id(),
      'tie_both', null, null, false
    from _proclaim_tally t
    where t.pos = r.pos and t.vote_count = r.top_votes;

  else
    -- More tied candidates than seats: the Board picks exactly `v_seats`
    -- of them — 1 for a single-seat tie (including an all-zero position)
    -- and 2 for a Grade Level Representative tie of 3 or more.
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
-- 3) archive_election_results_internal (085 body) — seat-aware
--    is_winner.  A candidate is a snapshot winner when fewer candidates
--    in the same position hold strictly more votes than there are seats
--    (rank() - 1 counts exactly those).  Single-seat positions reduce
--    to the old "votes = position max" rule; Grade Level
--    Representative positions mark the top two (ties included).
-- ---------------------------------------------------------------------
create or replace function public.archive_election_results_internal(
  p_election_period_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_proclaimed_ids uuid[] := '{}'::uuid[];
begin
  if p_election_period_id is null then
    raise exception 'Election period is required.';
  end if;

  if not exists (
    select 1 from public.election_periods e where e.id = p_election_period_id
  ) then
    raise exception 'Election period not found.';
  end if;

  -- Proclaimed winners come from the proclamations ledger, which is optional
  -- in this deployment and therefore cannot be named in a static query.  The
  -- relation AND its columns are checked, matching 052/053 tolerance.
  if to_regclass('public.proclamations') is not null
     and (
       select count(*) = 2
       from information_schema.columns col
       where col.table_schema = 'public'
         and col.table_name = 'proclamations'
         and col.column_name in ('candidate_id', 'election_period_id')
     ) then
    execute
      'select coalesce(array_agg(pr.candidate_id::uuid), ''{}''::uuid[])
          from public.proclamations pr
         where pr.election_period_id = $1
           and pr.candidate_id is not null'
    into v_proclaimed_ids
    using p_election_period_id;
  end if;

  -- Replace, never accumulate: a re-run has to be idempotent.
  delete from public.past_election_candidates where election_period_id = p_election_period_id;
  delete from public.past_election_positions  where election_period_id = p_election_period_id;
  delete from public.past_election_periods    where election_period_id = p_election_period_id;
  delete from public.past_parties             where election_period_id = p_election_period_id;
  delete from public.past_election_complaints where election_period_id = p_election_period_id;

  insert into public.past_election_candidates (
    election_period_id,
    position,
    candidate_name,
    grade_level,
    party_name,
    picture_url,
    votes,
    total_votes,
    is_winner,
    proclaimed_winner
  )
  select
    p_election_period_id,
    r.position,
    r.candidate_name,
    r.grade_level,
    r.party_name,
    r.picture_url,
    r.votes,
    r.race_total,
    -- 117 — seat-aware: winner when strictly-above count < seats
    -- (2 for Grade Level Representative positions, else 1).
    (
      r.votes > 0
      and r.strictly_above < (case when r.position like '% Representative' then 2 else 1 end)
    ),
    (r.candidate_id = any(v_proclaimed_ids))
  from (
    select
      ct.*,
      max(ct.votes) over (partition by ct.position) as top_votes,
      sum(ct.votes) over (partition by ct.position) as race_total,
      rank() over (partition by ct.position order by ct.votes desc) - 1 as strictly_above
    from (
      select
        c.id as candidate_id,
        c.position,
        btrim(concat_ws(' ', c.given_name, c.middle_name, c.surname, c.extension_name)) as candidate_name,
        c.grade_level,
        c.picture_url,
        p.name as party_name,
        coalesce(t.votes, 0)::integer as votes
      from public.candidates c
      left join public.parties p on p.id = c.party_id
      left join lateral (
        select count(*)::integer as votes
        from public.votes v
        where v.candidate_id = c.id
      ) t on true
      where c.election_period_id = p_election_period_id
        and c.status = 'approved'
    ) ct
  ) r;

  insert into public.past_election_positions (
    election_period_id,
    position,
    votes_cast,
    abstentions
  )
  select distinct on (b.position)
    p_election_period_id,
    b.position,
    (sum(b.votes) over (partition by b.position))::integer,
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
        and v."position" = b.position
        and v.abstained is true
    )
  from (
    select
      c.position,
      coalesce(t.votes, 0)::integer as votes
    from public.candidates c
    left join lateral (
      select count(*)::integer as votes
      from public.votes v
      where v.candidate_id = c.id
    ) t on true
    where c.election_period_id = p_election_period_id
      and c.status = 'approved'
  ) b
  order by b.position, b.votes desc;

  insert into public.past_election_periods (
    election_period_id,
    positions_contested,
    approved_candidates,
    votes_cast,
    abstentions,
    total_ballots
  )
  select
    p_election_period_id,
    (
      select count(distinct c.position)::integer
      from public.candidates c
      where c.election_period_id = p_election_period_id
        and c.status = 'approved'
    ),
    (
      select count(*)::integer
      from public.candidates c
      where c.election_period_id = p_election_period_id
        and c.status = 'approved'
    ),
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
        and v.abstained is not true
    ),
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
        and v.abstained is true
    ),
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
    );

  -- past_parties is derived from the candidates just frozen, so the party
  -- list and the per-candidate party_name can never disagree.
  insert into public.past_parties (election_period_id, party_name)
  select distinct
    pc.election_period_id,
    pc.party_name
  from public.past_election_candidates pc
  where pc.election_period_id = p_election_period_id
    and pc.party_name is not null
    and btrim(pc.party_name) <> '';

  -- 085 — the period's complaint record is part of the archive.  Every
  -- complaint filed against this election is frozen with its final
  -- status, the student's name (the live FK is `on delete set null`,
  -- so only the snapshot keeps it forever) and the deciding
  -- commissioner's name.  Filed-but-never-decided complaints freeze
  -- with their filed status — the record must show what happened AND
  -- what was left open.
  insert into public.past_election_complaints (
    election_period_id,
    complaint_id,
    student_name,
    subject,
    description,
    status,
    submitted_at,
    incident_date,
    resolution_note,
    resolved_by_name,
    resolved_at,
    archived_document_url
  )
  select
    p_election_period_id,
    c.id,
    nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
    c.subject,
    c.description,
    c.status,
    c.submitted_at,
    c.incident_date,
    c.resolution_note,
    ap.full_name,
    c.resolved_at,
    c.archived_document_url
  from public.complaints c
  left join public.students s on s.id = c.student_id
  left join public.adminprofiles ap on ap.id = c.resolved_by
  where c.election_period_id = p_election_period_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Grants (028/089 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.proclaim_winners_rpc(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid, jsonb, text, text) to anon, authenticated;

commit;
