-- =====================================================================
-- 033_reconciliation_and_adjudication.sql
-- Phase 05, Plan 05-04 - Task 1 (reconciliation read model + single
-- adjudication RPC on the kiosk_vote_queue machine).
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
--
-- Ships (D-09 / D-10 / D-11 / B-3; INTG-03):
--   * get_reconciliation_rpc(p_election_id uuid) -> jsonb — the Chief's
--     reconciliation read model. EVERY count is DERIVED from
--     kiosk_vote_queue / votes (D-10): no maintained counters anywhere.
--       - totals: approved voters (students.status='approved'),
--         voted voters (distinct voters with a votes row in the
--         election), not_voted remainder — the D-11 balance inputs;
--       - kiosks: per-kiosk breakdown of kiosk_vote_queue rows by
--         conflict_status (pending/synced/duplicate/invalid/conflict —
--         deny-constraint-derived), counted = rows where
--         conflict_status='synced' AND offline_vote_id produced a votes
--         row (votes.offline_vote_id is UNIQUE — 001:313 — so the join is
--         lossless), queued = all non-synced rows;
--       - queue_rows: the live queue rows (adjudication section source)
--         with adjudicator_name joined from profiles;
--       - votes: the election's votes with candidate + voter names for
--         the duplicate/conflict "pick the linked vote" picker.
--     Admin-gated (current_session_role() = 'admin' — the 022 spine; all
--     commissioners incl. co-commissioners mint 'admin' sessions, so the
--     D-09 "Chief-gated (admin under the hood)" surface is enforced
--     server-side; sslg_adviser/student/none denied).
--   * adjudicate_vote_rpc(p_election_id, p_queue_row_id, p_status,
--     p_resolution_note, p_linked_vote_id default null) — the ONLY way a
--     queue row moves to 'duplicate'/'invalid'/'conflict' (D-10).
--       - ADMIN-ONLY (session role check — 'admin' or co_commissioner;
--         sslg_adviser denied);
--       - p_status IN ('duplicate','invalid','conflict') ONLY —
--         'pending'/'synced' belong to the sync path (032 sync flip) and
--         are rejected with a clear message;
--       - 'duplicate'/'conflict' REQUIRE p_linked_vote_id to point at an
--         existing votes row IN THE SAME ELECTION (semantic guard the
--         CHECK alone cannot express);
--       - 'invalid' REQUIRES a non-blank p_resolution_note;
--       - PRE-PUBLISH ONLY: election_periods.results_published must be
--         false — the 001-era flag the existing publish_results_rpc (012)
--         sets is the live release marker on disk, so the guard reads it
--         directly (no stub; 05-05 034 reworks the publish gate and this
--         guard stays live off the same column);
--       - REVISABLE: an adjudicated row can be flipped again (new status
--         + new note) as long as pre-publish holds; each write inserts an
--         audit row (insert_audit_log_rpc, 030 seam) so the trail
--         accumulates;
--       - on non-duplicate/conflict flips linked_vote_id is cleared so a
--         stale 'winner' link can never sit on an invalid row.
--
-- 001-032 bodies are NEVER edited (D-26); 033 is purely additive (two
-- new functions + grants).  votes keeps ZERO adjudication columns (B-3 —
-- the machine lives on the queue).
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) get_reconciliation_rpc — derived per-kiosk + election reconciliation
--    read model (D-09/D-10, INTG-03).  Security definer; the caller
--    role check (current_session_role() = 'admin') runs against the 022
--    session spine header, never a client-provided role.
-- ---------------------------------------------------------------------
create or replace function public.get_reconciliation_rpc(p_election_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_election_exists boolean;
  v_result jsonb;
begin
  v_role := public.current_session_role();

  if v_role is distinct from 'admin' then
    raise exception 'Forbidden: only the Chief Commissioner and commissioners can view reconciliation.';
  end if;

  select exists (
    select 1 from public.election_periods e where e.id = p_election_id
  ) into v_election_exists;

  if not v_election_exists then
    raise exception 'Election not found.';
  end if;

  select jsonb_build_object(
    'election',
    (select jsonb_build_object(
        'id', e.id, 'school_year', e.school_year,
        'is_active', e.is_active, 'results_published', e.results_published)
       from public.election_periods e where e.id = p_election_id),

    'totals',
    (select jsonb_build_object(
        'approved_voters', (select count(*)::int from public.students s where s.status = 'approved'),
        'voted_voters',     (select count(distinct v.voter_id)::int from public.votes v where v.election_period_id = p_election_id),
        'not_voted_voters', (select count(*)::int from public.students s
                              where s.status = 'approved'
                                and not exists (
                                      select 1 from public.votes v
                                       where v.election_period_id = p_election_id
                                         and v.voter_id = s.id)))),

    'kiosks',
    coalesce((
      select jsonb_agg(k ORDER BY k ->> 'name')
        from (
          select jsonb_build_object(
            'kiosk_id',    d.id,
            'name',        d.name,
            'location',    d.location,
            'sync_status', d.sync_status,
            'last_seen_at', d.last_seen_at,
            'pending',   count(q.id) filter (where q.conflict_status = 'pending'),
            'synced',    count(q.id) filter (where q.conflict_status = 'synced'),
            'duplicate', count(q.id) filter (where q.conflict_status = 'duplicate'),
            'invalid',   count(q.id) filter (where q.conflict_status = 'invalid'),
            'conflict',  count(q.id) filter (where q.conflict_status = 'conflict'),
            -- counted = synced rows whose offline_vote_id produced a
            -- votes row (the lossless unique join, B-3/Q4 definition).
            'counted',   count(q.id) filter (where q.conflict_status = 'synced' and v.id is not null),
            -- queued = all non-synced rows (pending + adjudication backlog).
            'queued',    count(q.id) filter (where q.conflict_status <> 'synced')
          ) as k
          from public.kiosk_devices d
          left join public.kiosk_vote_queue q
                 on q.kiosk_id = d.id
                and q.election_period_id = p_election_id
          left join public.votes v on v.offline_vote_id = q.offline_vote_id
         group by d.id, d.name, d.location, d.sync_status, d.last_seen_at
        ) k
    ), '[]'::jsonb),

    'queue_rows',
    coalesce((
      select jsonb_agg(r ORDER BY r ->> 'queued_at')
        from (
          select jsonb_build_object(
            'id',               q.id,
            'kiosk_id',         q.kiosk_id,
            'offline_vote_id',  q.offline_vote_id,
            'conflict_status',  q.conflict_status,
            'queued_at',        q.queued_at,
            'synced_at',        q.synced_at,
            'resolution_note',  q.resolution_note,
            'linked_vote_id',   q.linked_vote_id,
            'adjudicated_by',   q.adjudicated_by,
            'adjudicated_at',   q.adjudicated_at,
            'adjudicator_name', p.full_name
          ) as r
          from public.kiosk_vote_queue q
          left join public.profiles p on p.id = q.adjudicated_by
         where q.election_period_id = p_election_id
        ) r
    ), '[]'::jsonb),

    'votes',
    coalesce((
      select jsonb_agg(v ORDER BY v ->> 'position', v ->> 'voted_at')
        from (
          select jsonb_build_object(
            'id',              v.id,
            'position',        v."position",
            'candidate_id',    v.candidate_id,
            'candidate_name',  coalesce(c.given_name || ' ' || c.surname, 'Abstain'),
            'voter_id',        v.voter_id,
            'voter_name',      coalesce(s.first_name || ' ' || s.last_name, 'Unknown voter'),
            'abstained',       coalesce(v.abstained, false),
            'voted_at',        v.voted_at
          ) as v
          from public.votes v
          left join public.candidates c on c.id = v.candidate_id
          left join public.students s on s.id = v.voter_id
         where v.election_period_id = p_election_id
        ) v
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) adjudicate_vote_rpc — the single pre-publish queue adjudication
--    path (D-10, INTG-03).  Admin-only, pre-publish-only, revisable,
--    fully audited.  'pending'/'synced' are the sync path's states and
--    are REJECTED here (032 owns that transition).
-- ---------------------------------------------------------------------
create or replace function public.adjudicate_vote_rpc(
  p_election_id uuid,
  p_queue_row_id uuid,
  p_status text,
  p_resolution_note text,
  p_linked_vote_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
  v_actor_id uuid;
  v_actor_name text;
  v_row_election uuid;
  v_offline_id text;
begin
  v_role := public.current_session_role();
  v_actor_id := public.current_session_user_id();

  -- ADMIN-ONLY (D-10): chiefs, commissioners AND co-commissioners all
  -- mint 'admin' sessions via the 023 admin login; sslg_adviser (its
  -- own role literal) and any anonymous/no-header caller are denied.
  if v_role is distinct from 'admin' then
    raise exception 'Forbidden: only the Chief Commissioner and commissioners can adjudicate votes.';
  end if;

  if p_status not in ('duplicate', 'invalid', 'conflict') then
    raise exception 'Status must be duplicate, invalid or conflict - pending/synced transitions belong to the sync path.';
  end if;

  -- PRE-PUBLISH ONLY (D-10/D-12): results_published is the live release
  -- marker the existing publish_results_rpc (012) sets; 05-05 reworks
  -- that gate and this guard reads the SAME column, so it stays live.
  if exists (
    select 1 from public.election_periods e
     where e.id = p_election_id and e.results_published = true
  ) then
    raise exception 'Results are already published - adjudication is locked.';
  end if;

  if not exists (select 1 from public.election_periods e where e.id = p_election_id) then
    raise exception 'Election not found.';
  end if;

  select q.election_period_id, q.offline_vote_id
    into v_row_election, v_offline_id
    from public.kiosk_vote_queue q
   where q.id = p_queue_row_id;

  if v_row_election is null then
    raise exception 'Queue row not found.';
  end if;

  if v_row_election <> p_election_id then
    raise exception 'Queue row does not belong to this election.';
  end if;

  -- Semantic guards the CHECK alone cannot enforce (D-10 / pgTAP 033):
  -- duplicate/conflict need a real linked vote IN THIS ELECTION;
  -- invalid needs a non-blank note.
  if p_status in ('duplicate', 'conflict') then
    if p_linked_vote_id is null then
      raise exception 'A linked vote is required for duplicate/conflict adjudication.';
    end if;
    if not exists (
      select 1 from public.votes v
       where v.id = p_linked_vote_id
         and v.election_period_id = p_election_id
    ) then
      raise exception 'Linked vote does not exist in this election.';
    end if;
  end if;

  if p_status = 'invalid' and (p_resolution_note is null or btrim(p_resolution_note) = '') then
    raise exception 'A resolution note is required for invalid votes.';
  end if;

  update public.kiosk_vote_queue q
     set conflict_status = p_status,
         resolution_note = case
                              when p_resolution_note is null then q.resolution_note
                              else p_resolution_note
                            end,
         linked_vote_id  = case
                             when p_status in ('duplicate', 'conflict') then p_linked_vote_id
                             else null
                           end,
         adjudicated_by  = v_actor_id,
         adjudicated_at  = now()
   where q.id = p_queue_row_id;

  select full_name into v_actor_name
    from public.profiles
   where id = v_actor_id;

  -- Audit (D-10 / R2 / T-05-07): every adjudication writes a row via the
  -- 030 anon-granted seam; the caller role IS recorded ('admin' literal
  -- is in the 027 CHECK set).  Re-adjudications accumulate rows.
  perform public.insert_audit_log_rpc(
    v_actor_id,
    coalesce(v_actor_name, 'Commissioner'),
    'admin',
    'Adjudicated Vote',
    'Queue row ' || p_queue_row_id::text
      || ' (offline vote ' || coalesce(v_offline_id, 'null') || ') adjudicated to "'
      || p_status || '" in election ' || p_election_id::text
      || case when p_linked_vote_id is not null then ' linked to ' || p_linked_vote_id::text else '' end
      || case when p_resolution_note is not null then ' - ' || p_resolution_note else '' end,
    case when p_status = 'invalid' then 'warning' else 'info' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Grants — least privilege (020/023/032 pattern).  Both RPCs are
--    called by the SPA under the anon execution role with the 022 bearer
--    session header (the role check is internal); revoked from PUBLIC.
-- ---------------------------------------------------------------------
revoke all on function public.get_reconciliation_rpc(uuid) from public;
grant execute on function public.get_reconciliation_rpc(uuid) to anon, authenticated;

revoke all on function public.adjudicate_vote_rpc(uuid, uuid, text, text, uuid) from public;
grant execute on function public.adjudicate_vote_rpc(uuid, uuid, text, text, uuid) to anon, authenticated;