-- =====================================================================
-- 131_finalize_election_and_cancelled_stage.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent (create or replace / guarded
-- constraint swap); safe to re-run.
--
-- WHY
--   Two gaps in the election lifecycle, both around how a period RETIRES:
--
--   1) Stage 5, after the results are published and the winners
--      proclaimed, the only exit was "Reset Election Plan" — a
--      danger-zone reset whose success toast talks about clearing the
--      plan.  The intended happy close-out deserves its own, positive
--      action: Finalize Election.
--   2) A period retired by a reset BEFORE its results were published and
--      its winners proclaimed was stamped lifecycle_stage = 'completed'
--      — the same value a finished election carries.  An aborted
--      election is not a completed one: it now retires as 'cancelled'.
--
-- WHAT
--   * election_periods_lifecycle_stage_check — re-issued with
--     'cancelled' added (060's drop-guard pattern: 058 owns the old
--     name and may not have run yet on a fresh database).
--   * current_election_period_id() — re-issued to exclude BOTH retired
--     stages.  Critical: a cancelled period that still resolved as
--     current would block Stage 1 forever.
--   * finalize_election_rpc(p_password) — NEW.  The Stage 5 close-out:
--     requires the Electoral Board (or Chief) + the caller's own
--     password (the 078 crypt/sha256 verification), requires the
--     current period to sit at 'results' with proclaimed AND
--     results_published, then retires it as 'completed',
--     freezes the 066 past-election snapshot (idempotent) so it lands
--     on Past Elections, writes an audit_logs row and hands the plan
--     back to Stage 1 (the next school year is set there, per 078).
--   * reset_election_plan_rpc(p_password, p_school_year) — 078 body
--     re-issued with the cancelled branch: a dirty period that has NOT
--     proclaimed/published retires as 'cancelled' and NO snapshot is
--     frozen (nothing official was produced; its candidates and votes
--     stay on the live tables, retained — history is never deleted,
--     migration 052).  065's list_past_elections_rpc lists
--     'completed' only, so a cancelled election stays out of Past
--     Elections by construction.  A proclaimed/published period (an
--     API-only path once the Stage 5 UI stops offering the reset)
--     still retires as 'completed'.  The clean (no candidates, no
--     votes) in-place clear back to 'application' is untouched.
--
-- RETURNS (finalize) jsonb — { election_period_id, school_year,
--   finalized: true }; (reset) the 078 jsonb plus a 'retired_as' field
--   ('cancelled' | 'completed') so the toast can name the outcome.
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — ALLOW THE NEW RETIRED STAGE
-- ---------------------------------------------------------------------
alter table public.election_periods
  drop constraint if exists election_periods_lifecycle_stage_check;

alter table public.election_periods
  add constraint election_periods_lifecycle_stage_check
  check (lifecycle_stage in (
    'application',
    'campaign',
    'fingerprint_registration',
    'voting',
    'results',
    'completed',
    'cancelled'
  ));

-- ---------------------------------------------------------------------
-- SECTION 2 — PERIOD RESOLVER: a cancelled period is not current either
--   058's body with one widened predicate.  Both retired stages are
--   terminal history; neither may answer "current election period" or
--   Stage 1 could never start the next election.
-- ---------------------------------------------------------------------
create or replace function public.current_election_period_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id
    from public.election_periods e
   where e.lifecycle_stage <> 'completed'
     and e.lifecycle_stage <> 'cancelled'
   order by e.updated_at desc nulls last, e.school_year desc, e.id
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- SECTION 3 — FINALIZE ELECTION (NEW)
--   The Stage 5 close-out.  Password-verified like the reset (the user
--   chose the stronger gate): same crypt/sha256 dual check as 078.
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

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Finalized',
    'Election period ' || v_current::text || ' (school year '
      || coalesce(v_school_year, 'n/a') || ') was finalized. The proclaimed winners and '
      || 'published results are on permanent record; the plan returns to Stage 1.',
    'success'
  );

  return jsonb_build_object(
    'election_period_id', v_current,
    'school_year', v_school_year,
    'finalized', true
  );
end;
$$;

revoke all on function public.finalize_election_rpc(text) from public, anon, authenticated;
grant execute on function public.finalize_election_rpc(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 4 — RESET: RETIRE UNFINISHED ELECTIONS AS 'cancelled'
--   The 078 body re-issued with two changes in the dirty branch:
--     * the retiring stage value (cancelled vs completed)
--     * the snapshot only freezes for a COMPLETED retirement
--   Everything else — the gate, the password check, the noop branch,
--   the clean in-place clear, the optional legacy next-period insert,
--   the audit row — is byte-identical to 078.
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

    -- Archive.  Nothing is deleted: candidates and votes keep pointing
    -- at this row.  A period retired BEFORE its record was committed is
    -- a CANCELLED election — it never enters Past Elections (065 lists
    -- lifecycle_stage = 'completed' only) and no snapshot is frozen for
    -- it.  A proclaimed/published period still retires as 'completed',
    -- which is what turns the official result into a past election.
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
             || ' vote(s) retained) and started a new period for ' || v_school_year || '.'
      when v_dirty
        then 'Archived election period ' || v_archived::text || ' as '
             || case when v_cancelled then 'CANCELLED' else 'COMPLETED' end
             || ' (' || v_had_candidates || ' candidate(s), ' || v_had_votes
             || ' vote(s) retained). The next school year will be set when the Candidate Application Period starts.'
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
    'retired_as', case when v_dirty then (case when v_cancelled then 'cancelled' else 'completed' end) else null end
  );
end;
$$;

revoke all on function public.reset_election_plan_rpc(text, text) from public, anon, authenticated;
grant execute on function public.reset_election_plan_rpc(text, text) to anon, authenticated;

commit;
