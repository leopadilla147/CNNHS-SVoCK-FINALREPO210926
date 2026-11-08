-- =====================================================================
-- 138_votes_archive.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   Until now a retired election's ballots lived in the live `votes`
--   table forever.  This migration gives them a permanent home of their
--   own — `votes_archive` — and MOVES every ballot into it at the exact
--   moments a period retires:
--
--     * finalize_election_rpc (131) — the Stage 5 close-out, when the
--       Commissioner of Electoral Board finalizes the election
--     * reset_election_plan_rpc (131) — the danger-zone reset, when
--       votes already exist (the dirty branch, both 'cancelled' and
--       'completed' retirements)
--
--   The transfer is a MOVE, not a copy: ballots are inserted into
--   votes_archive, then deleted from the live table, inside the
--   caller's transaction.  The active election therefore always starts
--   with an empty live votes table, while no ballot record is ever lost.
--
-- WHAT
--   1. votes_archive — one row per cast ballot, all live-vote columns
--      (id, election_period_id, voter_id, candidate_id, position,
--      offline_vote_id, voted_at, abstained, transaction_id)
--      plus archived_at.  FK to election_periods only (ON DELETE
--      RESTRICT); voter_id / candidate_id are deliberately NOT foreign
--      keys, so the archive stays readable even if a live student or
--      candidate row is ever removed (064 independence rule).
--   2. RLS — ADMIN-ONLY READ (the 028/085 pattern).  A ballot is
--      secret-ballot data: only the admin path
--      (current_app_role() = 'admin') may select; every write is
--      revoked from the client roles — the definer writer below is the
--      only mutation path.
--   3. archive_votes_internal(uuid) returns integer — THE WRITER.
--      Insert-select with ON CONFLICT (id) DO NOTHING — never
--      delete-then-insert, because a re-run after the move finds no
--      live rows and must NOT wipe what the first run archived — then
--      deletes the period's live votes.  Returns the transferred count.
--   4. archive_election_results_internal re-issued (the 117 body,
--      verbatim) with one change: every tally subquery counts from
--      votes UNION ALL votes_archive.  The freeze always runs BEFORE
--      the transfer in the same transaction (live rows present, archive
--      empty for the period) — and after a transfer the live side is
--      empty and the archive side carries the ballots — so the union is
--      always exactly the true tally, keeping Past Elections snapshots
--      correct even if a retired period is ever re-frozen.
--   5. finalize_election_rpc (131 body) re-issued: after the snapshot
--      freeze it performs the transfer and reports the moved count in
--      the audit row and its jsonb result ('votes_transferred').
--   6. reset_election_plan_rpc (131 body) re-issued: the dirty branch
--      performs the transfer right after the conditional snapshot
--      freeze; the audit wording changes from "vote(s) retained" to
--      "vote(s) transferred to the permanent vote archive".  The clean
--      (no candidates, no votes) in-place clear and the noop path are
--      untouched.
--
-- ACCEPTED SIDE EFFECTS
--   * vote_receipts rows cascade away with their moved votes (032's
--     ON DELETE CASCADE).  Receipts are client-unreadable by policy and
--     belong to the active election; the archived ballots remain the
--     permanent record.
--   * The daily TXN sequence generator (050) scans live votes only.
--     Its greatest(...) guard already tolerates deleted/cleared votes,
--     and a new election is a new period, so sequence continuity is
--     unaffected in practice.
--   * void_election_rpc (137) is NOT a retirement — the same period
--     returns to the Voting Stage with its votes retained — so it never
--     transfers anything, and its vote count only ever runs while the
--     ballots are still live.
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — THE ARCHIVE TABLE
--   A ballot's permanent home.  Same columns as the live votes table
--   (001/018/019) plus archived_at.  The id CARRIES OVER from the live
--   row, which is what makes the transfer re-runnable (ON CONFLICT (id)).
-- ---------------------------------------------------------------------
create table if not exists public.votes_archive (
  id uuid not null,
  election_period_id uuid not null
    references public.election_periods(id) on delete restrict,
  -- Traceability only — deliberately NOT foreign keys, so the archive
  -- never depends on a live student/candidate row surviving (064).
  voter_id uuid not null,
  candidate_id uuid,
  "position" text not null,
  offline_vote_id text,
  voted_at timestamptz not null,
  abstained boolean not null default false,
  transaction_id text,
  archived_at timestamptz not null default now(),

  constraint votes_archive_pkey primary key (id),

  constraint votes_archive_abstain_check check (
    (abstained = true and candidate_id is null)
    or
    (abstained = false and candidate_id is not null)
  )
);

-- Upgrade guard: the period FK, so a pre-existing table is upgraded in
-- place.  election_periods are never deleted (052), so validation passes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'votes_archive_election_period_fkey'
       and conrelid = 'public.votes_archive'::regclass
  ) then
    alter table public.votes_archive
      add constraint votes_archive_election_period_fkey
      foreign key (election_period_id)
      references public.election_periods(id)
      on delete restrict;
  end if;
end $$;

create index if not exists votes_archive_period_idx
  on public.votes_archive (election_period_id);

create index if not exists votes_archive_candidate_idx
  on public.votes_archive (candidate_id);

-- ---------------------------------------------------------------------
-- SECTION 2 — RLS AND TABLE GRANTS (ADMIN-ONLY READ)
--   The 028/085 rule for sensitive rows: the admin path reads every
--   row, everyone else reads none.  The definer writer below bypasses
--   RLS and is the only mutation path.
-- ---------------------------------------------------------------------
alter table public.votes_archive enable row level security;

drop policy if exists votes_archive_admin_read
  on public.votes_archive;
create policy votes_archive_admin_read
  on public.votes_archive for select using (
    public.current_app_role() = 'admin'
  );

revoke insert, update, delete, truncate, references, trigger
  on table public.votes_archive
  from public, anon, authenticated;

grant select on table public.votes_archive to anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 3 — THE TRANSFER WRITER (NO ROLE GATE — internal, like 085)
--   Archive first, then remove from the live table.  Both statements
--   run in the caller's transaction, so a failure anywhere rolls the
--   whole move back atomically.  Returns the transferred row count.
-- ---------------------------------------------------------------------
create or replace function public.archive_votes_internal(
  p_election_period_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_moved integer := 0;
begin
  if p_election_period_id is null then
    raise exception 'Election period is required.';
  end if;

  if not exists (
    select 1 from public.election_periods e where e.id = p_election_period_id
  ) then
    raise exception 'Election period not found.';
  end if;

  -- Copy every live ballot of the period into the archive.  ON CONFLICT
  -- (id) DO NOTHING, never delete-then-insert: a re-run after the move
  -- finds no live rows and must NOT wipe what the first run archived.
  with moved as (
    insert into public.votes_archive (
      id,
      election_period_id,
      voter_id,
      candidate_id,
      "position",
      offline_vote_id,
      voted_at,
      abstained,
      transaction_id
    )
    select
      v.id,
      v.election_period_id,
      v.voter_id,
      v.candidate_id,
      v."position",
      v.offline_vote_id,
      v.voted_at,
      v.abstained,
      v.transaction_id
    from public.votes v
    where v.election_period_id = p_election_period_id
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_moved from moved;

  -- The move: the live table lets go only after the archive has the
  -- ballots (and only within the same transaction).
  delete from public.votes
   where election_period_id = p_election_period_id;

  return v_moved;
end;
$$;

revoke all on function public.archive_votes_internal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 4 — FREEZE WRITER RE-ISSUE (117 body) — COUNT LIVE ∪ ARCHIVE
--   Verbatim except for the tally subqueries, which now count from
--   votes UNION ALL votes_archive.  Pre-transfer: live rows present,
--   archive empty for the period.  Post-transfer: live empty, archive
--   carries the ballots.  Either way the union is the true tally, so a
--   re-freeze of a retired period can no longer zero the snapshot.
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
        from (
          -- 138 — live ballots first; after the 138 transfer the live
          -- side is empty for this period and the archive side carries
          -- them, so the union is always the true tally.
          select 1 as ballot
          from public.votes v
          where v.candidate_id = c.id
          union all
          select 1
          from public.votes_archive va
          where va.candidate_id = c.id
        ) vb
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
      from (
        select 1 as ballot
        from public.votes v
        where v.election_period_id = p_election_period_id
          and v."position" = b.position
          and v.abstained is true
        union all
        select 1
        from public.votes_archive va
        where va.election_period_id = p_election_period_id
          and va."position" = b.position
          and va.abstained is true
      ) vx
    )
  from (
    select
      c.position,
      coalesce(t.votes, 0)::integer as votes
    from public.candidates c
    left join lateral (
      select count(*)::integer as votes
      from (
        select 1 as ballot
        from public.votes v
        where v.candidate_id = c.id
        union all
        select 1
        from public.votes_archive va
        where va.candidate_id = c.id
      ) vb
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
      from (
        select 1 as ballot
        from public.votes v
        where v.election_period_id = p_election_period_id
          and v.abstained is not true
        union all
        select 1
        from public.votes_archive va
        where va.election_period_id = p_election_period_id
          and va.abstained is not true
      ) vx
    ),
    (
      select count(*)::integer
      from (
        select 1 as ballot
        from public.votes v
        where v.election_period_id = p_election_period_id
          and v.abstained is true
        union all
        select 1
        from public.votes_archive va
        where va.election_period_id = p_election_period_id
          and va.abstained is true
      ) vx
    ),
    (
      select count(*)::integer
      from (
        select 1 as ballot
        from public.votes v
        where v.election_period_id = p_election_period_id
        union all
        select 1
        from public.votes_archive va
        where va.election_period_id = p_election_period_id
      ) vx
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

revoke all on function public.archive_election_results_internal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 5 — FINALIZE ELECTION (131 body) + THE TRANSFER HOOK
--   Everything byte-identical to 131 except: v_votes_moved declared,
--   the transfer performed right after the snapshot freeze, the audit
--   wording, and the 'votes_transferred' field in the jsonb result.
-- ---------------------------------------------------------------------
create or replace function public.finalize_election_rpc(
  p_password text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor       uuid;
  v_role        text;
  v_hash        text;
  v_current     uuid;
  v_stage       text;
  v_proclaimed  boolean;
  v_published   boolean;
  v_school_year text;
  -- 138 — how many ballots left the live votes table for the archive.
  v_votes_moved integer := 0;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can finalize the election.';
  end if;

  if p_password is null or p_password = '' then
    raise exception 'Password is required.';
  end if;

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if v_hash is null then
    raise exception 'Password is incorrect.';
  end if;

  if starts_with(coalesce(v_hash, ''), '$2') then
    if v_hash is distinct from crypt(p_password, v_hash) then
      raise exception 'Password is incorrect.';
    end if;
  else
    if v_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      raise exception 'Password is incorrect.';
    end if;
  end if;

  v_current := public.current_election_period_id();

  if v_current is null then
    raise exception 'There is no election period in progress to finalize.';
  end if;

  select e.lifecycle_stage, e.proclaimed, e.results_published, e.school_year
    into v_stage, v_proclaimed, v_published, v_school_year
    from public.election_periods e
   where e.id = v_current;

  -- The close-out exists for exactly one state: the record is committed
  -- (results published + winners proclaimed).  Everything earlier is a
  -- job for reset_election_plan_rpc instead.
  if v_stage <> 'results' or v_proclaimed is not true or v_published is not true then
    raise exception 'The election cannot be finalized yet. Publish the results and proclaim the winners first.';
  end if;

  update public.election_periods
     set lifecycle_stage = 'completed',
         candidacy_open = false,
         is_active = false
   where id = v_current;

  -- 066: freeze the official tally into the past-election snapshot the
  -- moment the period retires.  Idempotent — re-running is harmless.
  perform public.archive_election_results_internal(v_current);

  -- 138 — the ballots leave the live votes table for the permanent
  -- archive.  Runs after the freeze (which counts live ∪ archive) and
  -- in the same transaction, so the snapshot and the move can never
  -- disagree.
  v_votes_moved := public.archive_votes_internal(v_current);

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Finalized',
    'Election period ' || v_current::text || ' (school year '
      || coalesce(v_school_year, 'n/a') || ') was finalized. The proclaimed winners and '
      || 'published results are on permanent record; ' || coalesce(v_votes_moved, 0)
      || ' vote(s) were transferred to the permanent vote archive and the plan returns to Stage 1.',
    'success'
  );

  return jsonb_build_object(
    'election_period_id', v_current,
    'school_year', v_school_year,
    'finalized', true,
    'votes_transferred', coalesce(v_votes_moved, 0)
  );
end;
$$;

revoke all on function public.finalize_election_rpc(text) from public, anon, authenticated;
grant execute on function public.finalize_election_rpc(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 6 — RESET (131 body) + THE TRANSFER HOOK
--   Everything byte-identical to 131 except: v_votes_moved declared,
--   the transfer performed in the dirty branch (for BOTH the
--   'cancelled' and 'completed' retirements, right after the
--   conditional snapshot freeze), the two audit strings, and the
--   'votes_transferred' field in the jsonb result.  The gate, the
--   password check, the noop branch, the clean in-place clear, the
--   optional legacy next-period insert and the retired_as logic are
--   untouched.
-- ---------------------------------------------------------------------
create or replace function public.reset_election_plan_rpc(
  p_password text,
  p_school_year text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_hash text;
  v_current uuid;
  v_archived uuid;
  v_new_id uuid;
  v_school_year text;
  v_dirty boolean;
  v_had_candidates integer;
  v_had_votes integer;
  -- 131 — how the period retires: 'cancelled' when the reset happens
  -- before the results were published and the winners proclaimed,
  -- 'completed' otherwise (an API-only path once the Stage 5 UI stops
  -- offering the reset past the committed record).
  v_cancelled boolean;
  -- 138 — how many ballots left the live votes table for the archive.
  v_votes_moved integer := 0;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can reset the election plan.';
  end if;

  if p_password is null or p_password = '' then
    raise exception 'Password is required.';
  end if;

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if v_hash is null then
    raise exception 'Password is incorrect.';
  end if;

  if starts_with(coalesce(v_hash, ''), '$2') then
    if v_hash is distinct from crypt(p_password, v_hash) then
      raise exception 'Password is incorrect.';
    end if;
  else
    if v_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      raise exception 'Password is incorrect.';
    end if;
  end if;

  v_current := public.current_election_period_id();

  -- 078: nothing to reset is a no-op, not an error.  The School Year for
  -- the next election is set in Stage 1, not here.
  if v_current is null then
    return jsonb_build_object(
      'election_period_id', null,
      'archived_previous', false,
      'archived_election_period_id', null,
      'school_year', null,
      'mode', 'noop'
    );
  end if;

  select
    (select count(*) from public.candidates c where c.election_period_id = v_current),
    (select count(*) from public.votes v where v.election_period_id = v_current)
    into v_had_candidates, v_had_votes;

  v_dirty := (v_had_candidates > 0) or (v_had_votes > 0);

  if not v_dirty then
    update public.election_periods
       set candidacy_open = false,
           is_active = false,
           results_published = false,
           proclaimed = false,
           proclaimed_at = null,
           election_date = null,
           end_date = null,
           rules_discussion_at = null,
           fingerprint_registration_start_at = null,
           fingerprint_registration_end_at = null,
           lifecycle_stage = 'application'
     where id = v_current;

    v_new_id := v_current;
    v_school_year := (select e.school_year from public.election_periods e where e.id = v_current);
  else
    select (e.proclaimed is true) or (e.results_published is true)
      into v_cancelled
      from public.election_periods e
     where e.id = v_current;
    v_cancelled := not coalesce(v_cancelled, false);

    -- Archive.  Nothing is deleted: candidates keep pointing at this
    -- row, and the ballots move to votes_archive below.  A period
    -- retired BEFORE its record was committed is a CANCELLED election —
    -- it never enters Past Elections (065 lists lifecycle_stage =
    -- 'completed' only) and no snapshot is frozen for it.  A
    -- proclaimed/published period still retires as 'completed', which is
    -- what turns the official result into a past election.
    update public.election_periods
       set lifecycle_stage = case when v_cancelled then 'cancelled' else 'completed' end,
           candidacy_open = false,
           is_active = false
     where id = v_current;

    if not v_cancelled then
      -- 066: freeze the retiring period's tally into the past-election
      -- snapshot at the moment it becomes history.  Idempotent.
      perform public.archive_election_results_internal(v_current);
    end if;

    -- 138 — the ballots leave the live votes table for the permanent
    -- archive, for BOTH retirements: a completed election keeps its
    -- ballots alongside its frozen snapshot, and a cancelled one keeps
    -- them in the archive even though no snapshot was ever frozen (the
    -- archive is the only ballot record that survives the retirement).
    v_votes_moved := public.archive_votes_internal(v_current);

    v_archived := v_current;
    v_school_year := nullif(btrim(coalesce(p_school_year, '')), '');

    if v_school_year is not null then
      -- Legacy 066 path: a school year was passed explicitly, so the next
      -- period is started in the same transaction.
      if exists (select 1 from public.election_periods where school_year = v_school_year) then
        raise exception 'An election period already exists for school year %. Choose a different school year.', v_school_year;
      end if;

      insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
      values (v_school_year, 'application', false, v_actor)
      returning id into v_new_id;
    end if;
    -- 078: without a school year the archive stands alone; the next
    -- period is created later by start_candidacy_period_rpc (Stage 1).
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Plan Reset',
    case
      when v_dirty and v_new_id is not null
        then 'Archived election period ' || v_archived::text || ' as '
             || case when v_cancelled then 'CANCELLED' else 'COMPLETED' end
             || ' (' || v_had_candidates || ' candidate(s), ' || v_had_votes
             || ' vote(s) transferred to the permanent vote archive) and started a new period for ' || v_school_year || '.'
      when v_dirty
        then 'Archived election period ' || v_archived::text || ' as '
             || case when v_cancelled then 'CANCELLED' else 'COMPLETED' end
             || ' (' || v_had_candidates || ' candidate(s), ' || v_had_votes
             || ' vote(s) transferred to the permanent vote archive). The next school year will be set when the Candidate Application Period starts.'
      else 'Cleared the election plan in place for school year ' || v_school_year
           || '. No candidates or votes were present.'
    end,
    'warning'
  );

  return jsonb_build_object(
    'election_period_id', v_new_id,
    'archived_previous', v_dirty,
    'archived_election_period_id', case when v_dirty then v_archived else null end,
    'school_year', v_school_year,
    'mode', case when v_dirty then 'archived' else 'cleared' end,
    'retired_as', case when v_dirty then (case when v_cancelled then 'cancelled' else 'completed' end) else null end,
    'votes_transferred', coalesce(v_votes_moved, 0)
  );
end;
$$;

revoke all on function public.reset_election_plan_rpc(text, text) from public, anon, authenticated;
grant execute on function public.reset_election_plan_rpc(text, text) to anon, authenticated;

commit;
