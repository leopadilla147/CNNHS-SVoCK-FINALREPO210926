-- =====================================================================
-- 053_past_election_results.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   1. list_past_elections_rpc() — public index of CLOSED elections whose
--      results have been published (is_active = false AND
--      results_published = true) with headline aggregates.
--   2. get_past_election_results_rpc(uuid) — public per-position detail:
--      every approved candidate, their full tally, the abstention count
--      per position, and the proclaimed winner where one exists.  Only
--      aggregates are exposed; voter identities never leave the database.
--   3. get_live_results_rpc() is pinned to the ACTIVE election period so
--      the Chief's live view can no longer blend two periods together.
--
-- Nothing here deletes or rolls over an election period: history is kept
-- permanently (see 052) and simply becomes readable once published.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — public index of published past elections
-- ---------------------------------------------------------------------
create or replace function public.list_past_elections_rpc()
returns table (
  election_period_id uuid,
  school_year text,
  election_date date,
  end_date date,
  venue text,
  voting_method text,
  proclaimed boolean,
  proclaimed_at timestamptz,
  positions_contested bigint,
  approved_candidates bigint,
  votes_cast bigint,
  abstentions bigint,
  total_ballots bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    e.id,
    e.school_year,
    e.election_date,
    e.end_date,
    e.venue,
    e.voting_method,
    e.proclaimed,
    e.proclaimed_at,
    (select count(distinct c.position)
       from public.candidates c
      where c.election_period_id = e.id
        and c.status = 'approved'),
    (select count(*)
       from public.candidates c
      where c.election_period_id = e.id
        and c.status = 'approved'),
    (select count(*)
       from public.votes v
      where v.election_period_id = e.id
        and v.abstained is not true),
    (select count(*)
       from public.votes v
      where v.election_period_id = e.id
        and v.abstained is true),
    (select count(*)
       from public.votes v
      where v.election_period_id = e.id)
  from public.election_periods e
  where e.is_active = false
    and e.results_published = true
  order by e.election_date desc nulls last, e.school_year desc, e.id;
$$;

-- ---------------------------------------------------------------------
-- SECTION 2 — public detail for one published past election
-- ---------------------------------------------------------------------
create or replace function public.get_past_election_results_rpc(
  p_election_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_election record;
  v_positions jsonb;
  v_result jsonb;
  v_proclaimed_ids uuid[] := '{}'::uuid[];
begin
  if p_election_period_id is null then
    raise exception 'Election period is required.';
  end if;

  select
    e.id,
    e.school_year,
    e.election_date,
    e.end_date,
    e.venue,
    e.voting_method,
    e.proclaimed,
    e.proclaimed_at
  into v_election
  from public.election_periods e
  where e.id = p_election_period_id
    and e.is_active = false
    and e.results_published = true;

  if not found then
    raise exception 'No published results are available for that election.';
  end if;

  -- Proclaimed winners come from the proclamations ledger.  That table is
  -- optional in this deployment, so it cannot be named in a static query: a
  -- missing relation is a parse-time failure, and there is no way to write
  -- "FROM proclamations, if it exists".  This is the one place dynamic SQL is
  -- actually required, and it stays tiny — read the ids, hand them back to the
  -- static query below as an array.
  --
  -- Note the fallback is NOT "highest vote wins": isWinner already carries
  -- that, computed from the tallies.  An absent ledger simply means no
  -- candidate is flagged as proclaimed, which is the honest answer.
  --
  -- Both the table AND its columns are checked, matching the tolerance 052
  -- applies to the same optional table: guarding the relation alone would
  -- still blow up at runtime on a deployment that kept the table but not the
  -- candidate_id column, and this is a PUBLIC page, so it must not 500.
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

  with candidate_tallies as (
    select
      c.id as candidate_id,
      c.position,
      c.given_name,
      c.middle_name,
      c.surname,
      c.extension_name,
      c.grade_level,
      c.picture_url,
      p.id as party_id,
      p.name as party_name,
      coalesce(t.votes, 0)::bigint as votes
    from public.candidates c
    left join public.parties p on p.id = c.party_id
    left join lateral (
      select count(*)::bigint as votes
      from public.votes v
      where v.candidate_id = c.id
    ) t on true
    where c.election_period_id = p_election_period_id
      and c.status = 'approved'
  ),
  top_votes as (
    select ct.position, max(ct.votes) as votes
    from candidate_tallies ct
    group by ct.position
  ),
  position_totals as (
    select
      ct.position,
      sum(ct.votes)::bigint as votes_cast,
      (
        select count(*)::bigint
        from public.votes v
        where v.election_period_id = p_election_period_id
          and v."position" = ct.position
          and v.abstained is true
      ) as abstentions
    from candidate_tallies ct
    group by ct.position
  ),
  position_json as (
    select
      pj.position,
      pj.votes_cast,
      pj.abstentions,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'candidateId', ct.candidate_id,
              'name', btrim(concat_ws(' ', ct.given_name, ct.middle_name, ct.surname, ct.extension_name)),
              'gradeLevel', ct.grade_level,
              'partyId', ct.party_id,
              'partyName', ct.party_name,
              'votes', ct.votes,
              'picture', ct.picture_url,
              'isWinner', coalesce(ct.votes > 0 and tv.votes = ct.votes, false),
              'proclaimedWinner', ct.candidate_id = any(v_proclaimed_ids)
            )
            order by ct.votes desc, ct.surname asc, ct.given_name asc
          )
          from candidate_tallies ct
          left join top_votes tv
            on tv.position = ct.position
          where ct.position = pj.position
        ),
        '[]'::jsonb
      ) as candidates
    from position_totals pj
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'position', pj.position,
               'votesCast', pj.votes_cast,
               'abstentions', pj.abstentions,
               'candidates', pj.candidates
             )
             order by pj.position
           ),
           '[]'::jsonb
         )
  into v_positions
  from position_json pj;

  v_result := jsonb_build_object(
    'election', jsonb_build_object(
      'id', v_election.id,
      'schoolYear', v_election.school_year,
      'electionDate', v_election.election_date,
      'endDate', v_election.end_date,
      'venue', v_election.venue,
      'votingMethod', v_election.voting_method,
      'proclaimed', v_election.proclaimed,
      'proclaimedAt', v_election.proclaimed_at
    ),
    'totals', jsonb_build_object(
      'positionsContested', (
        select count(distinct c.position)
        from public.candidates c
        where c.election_period_id = p_election_period_id
          and c.status = 'approved'
      ),
      'approvedCandidates', (
        select count(*)
        from public.candidates c
        where c.election_period_id = p_election_period_id
          and c.status = 'approved'
      ),
      'votesCast', (
        select count(*)
        from public.votes v
        where v.election_period_id = p_election_period_id
          and v.abstained is not true
      ),
      'abstentions', (
        select count(*)
        from public.votes v
        where v.election_period_id = p_election_period_id
          and v.abstained is true
      ),
      'totalBallots', (
        select count(*)
        from public.votes v
        where v.election_period_id = p_election_period_id
      )
    ),
    'positions', v_positions
  );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 3 — pin the chief's live view to the active period
-- ---------------------------------------------------------------------
create or replace function public.get_live_results_rpc()
returns table (
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  given_name text,
  surname text,
  party_name text,
  votes bigint
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('chief', 'electoral_board') then
    raise exception 'Only the Chief Commissioner or Commissioner of Electoral Board can view live results.';
  end if;

  return query
    select
      v.election_period_id,
      v."position",
      v.candidate_id,
      v.given_name,
      v.surname,
      v.party_name,
      v.votes
    from public.live_results_restricted v
    where v.election_period_id = (
      select e.id
      from public.election_periods e
      where e.is_active = true
      order by e.election_date desc nulls last, e.school_year desc, e.id
      limit 1
    );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 4 — grants
-- ---------------------------------------------------------------------
revoke all on function public.list_past_elections_rpc() from public, anon, authenticated;
grant execute on function public.list_past_elections_rpc() to anon, authenticated;

revoke all on function public.get_past_election_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.get_past_election_results_rpc(uuid) to anon, authenticated;

revoke all on function public.get_live_results_rpc() from public, anon, authenticated;
grant execute on function public.get_live_results_rpc() to anon, authenticated;
