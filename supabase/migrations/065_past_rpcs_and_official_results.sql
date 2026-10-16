-- =====================================================================
-- 065_past_rpcs_and_official_results.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   1. archive_election_results_internal(uuid) — rewritten to write the
--      independent snapshot: no candidate_id/party_id, a real total_votes
--      per row, and a populated past_parties.
--   2. publish_results_rpc(uuid) — also moves the period to
--      lifecycle_stage = 'results'.  Publishing results IS the "results"
--      stage; before this the stage stayed at 'voting' and the admin
--      Results tab went dead after a refresh (the frontend only set it
--      optimistically, in its mock branch).
--   3. A backfill putting already-published-but-not-superseded periods at
--      lifecycle_stage = 'results' (mirrors 058's original backfill).
--   4. list_past_elections_rpc() — a period is a PAST election only once
--      the Commissioner has superseded it (lifecycle_stage = 'completed').
--      A merely-published current election is an Official Result.
--   5. get_past_election_results_rpc(uuid) — same JSON contract minus the
--      two live ids, plus totalVotes.  Its guard is unchanged, so it
--      serves BOTH the Official Results page (current, published,
--      not completed) and a Past election detail page.
--
-- WHY THE VISIBILITY CHANGE
--   Official Results = the current election's published tally, and it
--   stays there until a successor exists.  Only reset_election_plan_rpc
--   (see 066) flips a period to 'completed', by which point it is history.
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — THE WRITER (NO ROLE GATE — see grants at the bottom)
--   Rebuilds this period's snapshot from scratch.  Tallies are computed
--   exactly the way 053 computes them, so a snapshot and the live fallback
--   agree value-for-value:
--     * candidate votes  = count(votes where candidate_id = candidate.id)
--       (abstentions carry candidate_id = NULL and can never match — 018)
--     * total_votes      = the position's whole race (sum of its candidate
--       votes) — the share denominator, frozen.
--     * is_winner        = votes > 0 and votes = position maximum (ties win)
--     * abstentions      = count(votes where position = p and abstained)
--   candidate_id / party_id are read here only to compute the flags; they
--   are deliberately NOT stored any more (064 dropped the columns).
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
    (r.votes > 0 and r.votes = r.top_votes),
    (r.candidate_id = any(v_proclaimed_ids))
  from (
    select
      ct.*,
      max(ct.votes) over (partition by ct.position) as top_votes,
      sum(ct.votes) over (partition by ct.position) as race_total
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
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 2 — publish_results_rpc: results stage + auto-archive
--   The admin gate, the cannot-publish-while-active guard and the
--   filed-complaint gate survive verbatim.  Two changes: the stage moves
--   to 'results' (so the period is an Official Result, not a Past
--   election, until it is superseded) and the freeze still runs after
--   results_published flips true.
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

  -- ELECT-02 (T-02-12): a complaint with status 'filed' blocks publication
  -- until resolved/rejected — the announcement stays delayed.
  if public.has_active_complaint_rpc(p_election_id) then
    raise exception 'Results cannot be published while a complaint is filed.';
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
-- SECTION 3 — BACKFILL: already-published periods are Official Results
--   A published period that was never superseded belongs at 'results'
--   (that is what 058's own backfill intended).  Completed rows are left
--   alone, and an (impossible) still-active row is skipped.
-- ---------------------------------------------------------------------
update public.election_periods e
   set lifecycle_stage = 'results'
 where e.results_published = true
   and e.is_active = false
   and e.lifecycle_stage <> 'completed'
   and e.lifecycle_stage <> 'results';

-- ---------------------------------------------------------------------
-- SECTION 4 — list_past_elections_rpc: superseded only
--   Same shape as 061.  The one change is the WHERE clause: a period is a
--   past election only once lifecycle_stage = 'completed' (set by
--   reset_election_plan_rpc in 066).  A published-but-current election no
--   longer leaks into the Past Elections list.
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
    coalesce(
      pep.positions_contested::bigint,
      (select count(distinct c.position)
         from public.candidates c
        where c.election_period_id = e.id
          and c.status = 'approved')
    ),
    coalesce(
      pep.approved_candidates::bigint,
      (select count(*)
         from public.candidates c
        where c.election_period_id = e.id
          and c.status = 'approved')
    ),
    coalesce(
      pep.votes_cast::bigint,
      (select count(*)
         from public.votes v
        where v.election_period_id = e.id
          and v.abstained is not true)
    ),
    coalesce(
      pep.abstentions::bigint,
      (select count(*)
         from public.votes v
        where v.election_period_id = e.id
          and v.abstained is true)
    ),
    coalesce(
      pep.total_ballots::bigint,
      (select count(*)
         from public.votes v
        where v.election_period_id = e.id)
    )
  from public.election_periods e
  left join public.past_election_periods pep
    on pep.election_period_id = e.id
  where e.lifecycle_stage = 'completed'
    and (e.results_published = true or pep.election_period_id is not null)
  order by e.election_date desc nulls last, e.school_year desc, e.id;
$$;

-- ---------------------------------------------------------------------
-- SECTION 5 — get_past_election_results_rpc: snapshot first, live fallback
--   The guard is unchanged (is_active = false AND published-or-snapshot),
--   which is exactly the state of a current Official Result as well as a
--   completed past election.  JSON changes: candidateId / partyId are gone
--   (the columns are gone) and every candidate carries totalVotes — the
--   position's race total, equal to votesCast, kept per-row at the user's
--   request.
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
  v_totals jsonb;
  v_result jsonb;
  v_proclaimed_ids uuid[] := '{}'::uuid[];
  v_use_snapshot boolean := false;
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
    and (
      e.results_published = true
      or exists (
        select 1 from public.past_election_periods pep
        where pep.election_period_id = p_election_period_id
      )
    );

  if not found then
    raise exception 'No published results are available for that election.';
  end if;

  v_use_snapshot := exists (
    select 1 from public.past_election_periods pep
    where pep.election_period_id = p_election_period_id
  );

  if v_use_snapshot then
    select jsonb_build_object(
             'positionsContested', pep.positions_contested,
             'approvedCandidates', pep.approved_candidates,
             'votesCast', pep.votes_cast,
             'abstentions', pep.abstentions,
             'totalBallots', pep.total_ballots
           )
      into v_totals
      from public.past_election_periods pep
     where pep.election_period_id = p_election_period_id;

    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'position', ps.position,
                 'votesCast', ps.votes_cast,
                 'abstentions', ps.abstentions,
                 'candidates', coalesce(
                   (
                     select jsonb_agg(
                       jsonb_build_object(
                         'name', pc.candidate_name,
                         'gradeLevel', pc.grade_level,
                         'partyName', pc.party_name,
                         'votes', pc.votes,
                         'totalVotes', pc.total_votes,
                         'picture', pc.picture_url,
                         'isWinner', pc.is_winner,
                         'proclaimedWinner', pc.proclaimed_winner
                       )
                       order by pc.votes desc, pc.candidate_name asc
                     )
                     from public.past_election_candidates pc
                     where pc.election_period_id = ps.election_period_id
                       and pc.position = ps.position
                   ),
                   '[]'::jsonb
                 )
               )
               order by ps.position
             ),
             '[]'::jsonb
           )
      into v_positions
      from public.past_election_positions ps
     where ps.election_period_id = p_election_period_id;
  else
    -- Proclaimed winners come from the proclamations ledger.  That table is
    -- optional in this deployment, so it cannot be named in a static query: a
    -- missing relation is a parse-time failure, and there is no way to write
    -- "FROM proclamations, if it exists".  This is the one place dynamic SQL is
    -- actually required, and it stays tiny — read the ids, hand them back to the
    -- static query below as an array.
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
                'name', btrim(concat_ws(' ', ct.given_name, ct.middle_name, ct.surname, ct.extension_name)),
                'gradeLevel', ct.grade_level,
                'partyName', ct.party_name,
                'votes', ct.votes,
                'totalVotes', pj.votes_cast,
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

    select jsonb_build_object(
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
    )
    into v_totals;
  end if;

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
    'totals', coalesce(
      v_totals,
      jsonb_build_object(
        'positionsContested', 0,
        'approvedCandidates', 0,
        'votesCast', 0,
        'abstentions', 0,
        'totalBallots', 0
      )
    ),
    'positions', coalesce(v_positions, '[]'::jsonb)
  );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 6 — FUNCTION GRANTS
-- ---------------------------------------------------------------------
-- The writer is NOT a client entry point.  Revoked from every client role
-- and deliberately not re-granted: the owner keeps EXECUTE after a revoke,
-- so the definer RPCs above and the SQL editor can still reach it.
revoke all on function public.archive_election_results_internal(uuid) from public, anon, authenticated;

revoke all on function public.publish_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.publish_results_rpc(uuid) to anon, authenticated;

revoke all on function public.list_past_elections_rpc() from public, anon, authenticated;
grant execute on function public.list_past_elections_rpc() to anon, authenticated;

revoke all on function public.get_past_election_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.get_past_election_results_rpc(uuid) to anon, authenticated;

commit;
