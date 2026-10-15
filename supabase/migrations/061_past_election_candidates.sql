-- =====================================================================
-- 061_past_election_candidates.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   1. Three snapshot tables that FREEZE an election's final tally:
--        public.past_election_candidates — one row per approved candidate
--                                          (party, final votes, winner flag)
--        public.past_election_positions  — one row per position
--                                          (votes cast, abstentions, winner)
--        public.past_election_periods    — one row per election (headliners)
--   2. archive_election_results_internal(uuid) — the writer.  SECURITY
--      DEFINER, no role gate, NOT callable by clients (see grants).  Safe
--      to re-run: it deletes this period's rows, then re-inserts them.
--   3. archive_past_election_results_rpc(uuid) — the Electoral-Board
--      facing wrapper: admin + Commissioner of Electoral Board / Chief,
--      audits, then delegates to (2).
--   4. publish_results_rpc(uuid) — 036 body re-issued.  After
--      results_published flips true it calls (2), so publishing results
--      freezes them automatically (deliberate: re-publishing re-freezes).
--   5. proclaim_winners_rpc(uuid) — 036 body re-issued.  After the
--      proclamations ledger is rewritten it calls (2) again, so the frozen
--      proclaimed_winner flags catch up with the proclamation (a snapshot
--      taken at publish time cannot know the winners yet).
--   6. list_past_elections_rpc() / get_past_election_results_rpc(uuid) —
--      053 bodies re-issued.  Both now prefer the snapshot when one exists
--      and fall back to the original live derivation otherwise, so every
--      period published before this migration keeps rendering unchanged.
--
-- WHY
--   053 derives past results from the live candidates/parties/votes tables
--   on every read.  That works, but it means a published result is never
--   truly frozen: rename a party, edit a candidate, or move rows between
--   periods and history rewrites itself.  The snapshot decouples the two.
--   party_id / candidate_id are stored as PLAIN uuid with no foreign key on
--   purpose — the whole point is that the archive survives whatever happens
--   to the live rows (including the composite-FK juggling that
--   AZ/repoint_election_period_*.sql has to do).  election_period_id DOES
--   keep its FK because election_periods rows are permanently retained
--   (052) and can never be deleted.
--
-- FREEZING AN ELECTION THAT ALREADY EXISTS
--   Periods completed before this migration have no snapshot and still
--   render through the live fallback.  To freeze one, either sign in as the
--   Commissioner of Electoral Board and call
--
--     select public.archive_past_election_results_rpc('<election_period_id>');
--
--   or, from the Supabase SQL editor (which runs as the owner and bypasses
--   the client gate), call the internal writer directly:
--
--     select public.archive_election_results_internal('<election_period_id>');
--
--   The second form is the one to use for a period that was never
--   results_published (e.g. the 2024-2025 period in the AZ/ dumps).
--
-- NOTE ON RE-RUNNING
--   Every object here is create-if-not-exists / create-or-replace and the
--   tables only ever gain or replace rows, so the file can be replayed.
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — TABLES
-- ---------------------------------------------------------------------
create table if not exists public.past_election_candidates (
  id uuid primary key default gen_random_uuid(),
  election_period_id uuid not null references public.election_periods(id) on delete restrict,
  candidate_id uuid,
  position text not null,
  candidate_name text not null,
  grade_level text,
  party_id uuid,
  party_name text,
  picture_url text,
  votes integer not null default 0,
  is_winner boolean not null default false,
  proclaimed_winner boolean not null default false,
  snapshot_at timestamptz not null default now()
);

-- candidate_id is nullable (a hand-entered historical row would have none)
-- and NULLs are distinct in a Postgres unique index, which is exactly the
-- tolerance needed here.
create unique index if not exists past_election_candidates_period_position_candidate_key
  on public.past_election_candidates (election_period_id, position, candidate_id);

create table if not exists public.past_election_positions (
  id uuid primary key default gen_random_uuid(),
  election_period_id uuid not null references public.election_periods(id) on delete restrict,
  position text not null,
  votes_cast integer not null default 0,
  abstentions integer not null default 0,
  winner_candidate_id uuid,
  snapshot_at timestamptz not null default now(),
  unique (election_period_id, position)
);

create table if not exists public.past_election_periods (
  election_period_id uuid primary key references public.election_periods(id) on delete restrict,
  positions_contested integer not null default 0,
  approved_candidates integer not null default 0,
  votes_cast integer not null default 0,
  abstentions integer not null default 0,
  total_ballots integer not null default 0,
  snapshot_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SECTION 2 — RLS AND TABLE GRANTS
--   Read-only to the world (the rows only ever exist because the Electoral
--   Board froze a result, mirroring how proclamations is exposed).  The
--   definer functions below write as the owner, which bypasses RLS.
-- ---------------------------------------------------------------------
alter table public.past_election_candidates enable row level security;
alter table public.past_election_positions enable row level security;
alter table public.past_election_periods enable row level security;

drop policy if exists past_election_candidates_public_read on public.past_election_candidates;
create policy past_election_candidates_public_read
  on public.past_election_candidates for select using (true);

drop policy if exists past_election_positions_public_read on public.past_election_positions;
create policy past_election_positions_public_read
  on public.past_election_positions for select using (true);

drop policy if exists past_election_periods_public_read on public.past_election_periods;
create policy past_election_periods_public_read
  on public.past_election_periods for select using (true);

revoke insert, update, delete on table public.past_election_candidates from public, anon, authenticated;
revoke insert, update, delete on table public.past_election_positions from public, anon, authenticated;
revoke insert, update, delete on table public.past_election_periods from public, anon, authenticated;

grant select on table public.past_election_candidates to anon, authenticated;
grant select on table public.past_election_positions to anon, authenticated;
grant select on table public.past_election_periods to anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 3 — THE WRITER (NO ROLE GATE — see grants at the bottom)
--   Rebuilds this period's snapshot from scratch.  Tallies are computed
--   exactly the way 053 computes them, so a snapshot and the live fallback
--   agree value-for-value:
--     * candidate votes  = count(votes where candidate_id = candidate.id)
--       (abstentions carry candidate_id = NULL and can never match — 018)
--     * is_winner        = votes > 0 and votes = position maximum (ties win)
--     * abstentions      = count(votes where position = p and abstained)
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

  insert into public.past_election_candidates (
    election_period_id,
    candidate_id,
    position,
    candidate_name,
    grade_level,
    party_id,
    party_name,
    picture_url,
    votes,
    is_winner,
    proclaimed_winner
  )
  select
    p_election_period_id,
    r.candidate_id,
    r.position,
    r.candidate_name,
    r.grade_level,
    r.party_id,
    r.party_name,
    r.picture_url,
    r.votes,
    (r.votes > 0 and r.votes = r.top_votes),
    (r.candidate_id = any(v_proclaimed_ids))
  from (
    select
      ct.*,
      max(ct.votes) over (partition by ct.position) as top_votes
    from (
      select
        c.id as candidate_id,
        c.position,
        btrim(concat_ws(' ', c.given_name, c.middle_name, c.surname, c.extension_name)) as candidate_name,
        c.grade_level,
        c.picture_url,
        c.party_id,
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
    abstentions,
    winner_candidate_id
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
    ),
    b.candidate_id
  from (
    select
      c.id as candidate_id,
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
  order by b.position, b.votes desc, b.candidate_id;

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
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 4 — THE ELECTORAL-BOARD FACING ARCHIVE RPC
--   Same role gate as 058/060's stage RPCs: platform admin AND a
--   commissioner role of electoral_board or chief.
-- ---------------------------------------------------------------------
create or replace function public.archive_past_election_results_rpc(
  p_election_period_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_school_year text;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can archive election results.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can archive election results.';
  end if;

  v_actor := public.current_session_user_id();

  select e.school_year into v_school_year
    from public.election_periods e
   where e.id = p_election_period_id;

  if v_school_year is null then
    raise exception 'Election period not found.';
  end if;

  perform public.archive_election_results_internal(p_election_period_id);

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Results Archived',
    'Froze the final results for ' || v_school_year || ' into the past-election record.',
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 5 — publish_results_rpc (036:455) + AUTO-ARCHIVE
--   The admin gate, the cannot-publish-while-active guard and the
--   filed-complaint gate survive verbatim; the only addition is the
--   freeze after results_published flips true.
-- ---------------------------------------------------------------------
drop function if exists public.publish_results_rpc(uuid);

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
  set results_published = true
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  -- 061: publishing results freezes them.  Re-publishing replaces the
  -- snapshot, so the archive always reflects the newest tallies.
  perform public.archive_election_results_internal(p_election_id);
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 6 — proclaim_winners_rpc (036:491) + RE-ARCHIVE
--   Identical to 036 apart from the freeze after the ledger is rewritten:
--   a snapshot taken at publish time predates the proclamation and would
--   leave every proclaimed_winner flag false forever.
-- ---------------------------------------------------------------------
drop function if exists public.proclaim_winners_rpc(uuid);

create or replace function public.proclaim_winners_rpc(p_election_id uuid)
returns table (
  winning_position text,
  winner_name text,
  votes integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can proclaim winners.';
  end if;

  if not exists (select 1 from public.election_periods where id = p_election_id and results_published = true) then
    raise exception 'Results must be published before proclaiming winners.';
  end if;

  delete from public.proclamations where election_period_id = p_election_id;

  insert into public.proclamations (election_period_id, winning_position, candidate_id, votes, proclaimed_by)
  select
    c.election_period_id,
    c.position,
    c.id,
    count(v.id)::integer as vote_count,
    public.current_session_user_id()
  from public.candidates c
  left join public.votes v on v.candidate_id = c.id
  where c.election_period_id = p_election_id
    and c.status = 'approved'
  group by c.election_period_id, c.position, c.id
  having count(v.id) = (
    select max(cnt) from (
      select count(v2.id) as cnt
      from public.candidates c2
      left join public.votes v2 on v2.candidate_id = c2.id
      where c2.election_period_id = p_election_id
        and c2.status = 'approved'
        and c2.position = c.position
      group by c2.id
    ) sub
  );

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
    p.votes
  from public.proclamations p
  join public.candidates c on c.id = p.candidate_id
  where p.election_period_id = p_election_id
  order by p.winning_position;
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 7 — 053 RE-ISSUES: SNAPSHOT FIRST, LIVE FALLBACK
-- ---------------------------------------------------------------------

-- 7.1) list_past_elections_rpc — same shape as 053:26.  Two changes:
--   * a period also lists when it has a snapshot, even if it was never
--     results_published (that is how an archived 2024-2025 shows up);
--   * the headline aggregates come from the snapshot when one exists, so
--     the index and the detail page can never disagree.
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
  where e.is_active = false
    and (e.results_published = true or pep.election_period_id is not null)
  order by e.election_date desc nulls last, e.school_year desc, e.id;
$$;

-- 7.2) get_past_election_results_rpc — same JSON contract as 053:84.  When
--   a snapshot exists it is authoritative; otherwise the original live
--   derivation runs untouched, so nothing published before this migration
--   changes shape.
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
                         'candidateId', pc.candidate_id,
                         'name', pc.candidate_name,
                         'gradeLevel', pc.grade_level,
                         'partyId', pc.party_id,
                         'partyName', pc.party_name,
                         'votes', pc.votes,
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
    --
    -- Note the fallback is NOT "highest vote wins": isWinner already carries
    -- that, computed from the tallies.  An absent ledger simply means no
    -- candidate is flagged as proclaimed, which is the honest answer.
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
-- SECTION 8 — FUNCTION GRANTS
-- ---------------------------------------------------------------------
-- The writer is NOT a client entry point.  It is revoked from every client
-- role and deliberately not re-granted: the object owner keeps EXECUTE after
-- a revoke (the ACL is materialised with the owner's default privileges —
-- the same reason 028's has_active_complaint_rpc is still callable from
-- 036's definer publish_results_rpc), so the definer RPCs above and the
-- owner role running the SQL editor can still reach it while anon cannot.
revoke all on function public.archive_election_results_internal(uuid) from public, anon, authenticated;

revoke all on function public.archive_past_election_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.archive_past_election_results_rpc(uuid) to anon, authenticated;

revoke all on function public.publish_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.publish_results_rpc(uuid) to anon, authenticated;

revoke all on function public.proclaim_winners_rpc(uuid) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid) to anon, authenticated;

revoke all on function public.list_past_elections_rpc() from public, anon, authenticated;
grant execute on function public.list_past_elections_rpc() to anon, authenticated;

revoke all on function public.get_past_election_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.get_past_election_results_rpc(uuid) to anon, authenticated;

commit;
