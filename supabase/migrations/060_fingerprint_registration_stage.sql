-- =====================================================================
-- 060_fingerprint_registration_stage.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   Adds a FIFTH lifecycle stage between Campaign and Voting:
--
--     application -> campaign -> fingerprint_registration -> voting -> results
--
--   Stage 4 of the Electoral Board's Election Setup tab becomes the
--   Fingerprint Registration window, and the old Stage 3 (Voting) shifts
--   down.  Voters register their fingerprint at the IoT biometric kiosks
--   during this window; the kiosk itself is deployed from the separate
--   SVoCK_Kiosk project, so nothing kiosk-side changes here.
--
-- WHY
--   The kiosks can only enrol a voter while the election is sitting in
--   the enrolment stage.  Until now that window did not exist in the
--   plan at all, so there was no way for the Electoral Board to say
--   "fingerprint registration is open" or to bound it in time.
--
-- RULES ENFORCED HERE (the Electoral Board's own requirements)
--   1. Fingerprint Registration sits BEFORE voting and never overlaps
--      it.  Enforced structurally: the stage only moves to 'voting'
--      after it, and starting the vote stamps
--      fingerprint_registration_end_at = now() when it is still open.
--   2. Starting the Voting Period ENDS the Campaign Period.  There is no
--      campaign_end_at column any more (036 dropped it), so "ending the
--      campaign" is expressed by moving lifecycle_stage off 'campaign'.
--      open_election_rpc is the single place that does that, and it is
--      the only writer of lifecycle_stage = 'voting'.
--   3. Fingerprint Registration ENDS when Voting starts.  Same statement
--      closes the window, so the two can never be open together.
--   4. Only the Commissioner of Electoral Board (and the Chief, who is
--      the appointing officer) may open either window — the same gate
--      058's reset_election_plan_rpc uses.
--
-- WHAT IS *NOT* CHANGED
--   036 deliberately dropped plan_finalized / official_list_posted /
--   campaign_start_at / campaign_end_at, and 058's buildElectionPeriodSyncPayload
--   never writes lifecycle_stage (only RPCs may move the election between
--   stages).  Both stances are preserved: this migration only ADDS.
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — COLUMNS
--   The enrolment window.  Both nullable: a campaign that never opens
--   enrolment simply leaves them null.
-- ---------------------------------------------------------------------
alter table public.election_periods
  add column if not exists fingerprint_registration_start_at timestamptz,
  add column if not exists fingerprint_registration_end_at timestamptz;

-- ---------------------------------------------------------------------
-- SECTION 2 — ALLOW THE NEW STAGE
--   Re-issued rather than edited: 058 owns the old constraint name and
--   may not have run yet on a fresh database, so drop-guard first.
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
    'completed'
  ));

-- ---------------------------------------------------------------------
-- SECTION 3 — STAGE 3: OPEN THE FINGERPRINT REGISTRATION WINDOW
--   Only reachable from the Campaign Period, which is what keeps the
--   stage order (and therefore "before voting, never overlapping") true.
-- ---------------------------------------------------------------------
create or replace function public.start_fingerprint_registration_rpc(
  p_election_id uuid,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
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
  v_stage text;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can open Fingerprint Registration.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can open Fingerprint Registration.';
  end if;

  v_actor := public.current_session_user_id();

  select e.lifecycle_stage into v_stage
    from public.election_periods e
   where e.id = p_election_id;

  if v_stage is null then
    raise exception 'Election period not found.';
  end if;

  if v_stage not in ('campaign', 'fingerprint_registration') then
    raise exception 'Fingerprint Registration can only be scheduled during the Campaign Period. This election is in the % stage.', v_stage;
  end if;

  if p_start_at is not null and p_end_at is not null and p_end_at <= p_start_at then
    raise exception 'The Fingerprint Registration window must end after it starts.';
  end if;

  update public.election_periods
     set lifecycle_stage = 'fingerprint_registration',
         fingerprint_registration_start_at = coalesce(p_start_at, now()),
         fingerprint_registration_end_at = p_end_at
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Fingerprint Registration Started',
    'Fingerprint Registration opened'
      || case when p_start_at is not null
              then ' from ' || to_char(p_start_at, 'YYYY-MM-DD HH24:MI') else '' end
      || case when p_end_at is not null
              then ' until ' || to_char(p_end_at, 'YYYY-MM-DD HH24:MI') else '' end
      || '. Voters may enrol at the biometric kiosks.',
    'success'
  );
end;
$$;

-- Close the window early without leaving the stage, mirroring
-- close_candidacy_period_rpc (058:203).  Voting may still start from here.
create or replace function public.close_fingerprint_registration_rpc(
  p_election_id uuid
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
  v_stage text;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can close Fingerprint Registration.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can close Fingerprint Registration.';
  end if;

  select e.lifecycle_stage into v_stage
    from public.election_periods e
   where e.id = p_election_id;

  if v_stage is null then
    raise exception 'Election period not found.';
  end if;

  if v_stage <> 'fingerprint_registration' then
    raise exception 'Fingerprint Registration is not the current stage.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set fingerprint_registration_end_at = now()
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Fingerprint Registration Closed',
    'The Fingerprint Registration window was closed early.',
    'warning'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 4 — STAGE 4: START VOTING (AND END THE CAMPAIGN)
--   Rebuilt from 036:391.  The admin gate and the already-active guard
--   survive verbatim; the differences are:
--     * the Electoral Board gate (rule 4),
--     * lifecycle_stage moves to 'voting' — this is what ends the
--       Campaign Period (rule 2),
--     * an open enrolment window is closed in the SAME statement, so
--       Fingerprint Registration can never overlap voting (rules 1/3),
--     * an audit entry, like every other stage RPC.
--   Still callable to re-open after close_election_rpc, where the stage
--   is already 'voting'.
-- ---------------------------------------------------------------------
drop function if exists public.open_election_rpc(uuid);

create or replace function public.open_election_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_record record;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can open the election.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can start the Voting Period.';
  end if;

  select * into v_record
  from public.election_periods
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  if v_record.is_active then
    raise exception 'Election is already active.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'voting',
         is_active = true,
         -- Never leave the enrolment window open into voting.  If it was
         -- still running, end it now; if it already ended, keep the
         -- earlier stamp (least() of the two never extends it).
         fingerprint_registration_end_at =
           least(coalesce(fingerprint_registration_end_at, now()), now())
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Voting Period Started',
    'Voting opened — the Campaign Period and Fingerprint Registration have ended.',
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 5 — RESET: ALSO CLEAR THE ENROLMENT WINDOW
--   Reproduced from 058:329 VERBATIM except that the in-place "clean"
--   branch now nulls the two 060 columns.  Without this a reset would
--   leave last cycle's enrolment dates on a period that is back at
--   Stage 1.  The archive branch is untouched: the retired row keeps its
--   own history (052 forbids deletion).
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
  v_name text;
  v_current uuid;
  v_archived uuid;
  v_new_id uuid;
  v_school_year text;
  v_dirty boolean;
  v_had_candidates integer;
  v_had_votes integer;
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

  if v_current is null then
    v_school_year := nullif(btrim(coalesce(p_school_year, '')), '');
    if v_school_year is null then
      raise exception 'There is no election period in progress. Provide a school year to start one (e.g. 2027-2028).';
    end if;
    if exists (select 1 from public.election_periods where school_year = v_school_year) then
      raise exception 'An election period already exists for school year %. Choose a different school year.', v_school_year;
    end if;

    insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
    values (v_school_year, 'application', false, v_actor)
    returning id into v_new_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      v_actor, 'Commissioner of Electoral Board', 'admin',
      'Election Plan Reset',
      'No election period was in progress. Started a new period for ' || v_school_year || '.',
      'warning'
    );

    return jsonb_build_object(
      'election_period_id', v_new_id,
      'archived_previous', false,
      'mode', 'started',
      'school_year', v_school_year
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
    update public.election_periods
       set lifecycle_stage = 'completed',
           candidacy_open = false,
           is_active = false
     where id = v_current;

    v_archived := v_current;
    v_school_year := nullif(btrim(coalesce(p_school_year, '')), '');

    if v_school_year is null then
      raise exception 'This election already has % candidate(s) and % vote(s), which are kept permanently. A new school year is required to start a fresh election period (e.g. 2027-2028).',
        v_had_candidates, v_had_votes;
    end if;

    if exists (select 1 from public.election_periods where school_year = v_school_year) then
      raise exception 'An election period already exists for school year %. Choose a different school year.', v_school_year;
    end if;

    insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
    values (v_school_year, 'application', false, v_actor)
    returning id into v_new_id;
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Plan Reset',
    case when v_dirty
      then 'Archived election period ' || v_archived::text || ' (' || v_had_candidates
           || ' candidate(s), ' || v_had_votes || ' vote(s) retained) and started a new period for '
           || v_school_year || '.'
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
    'mode', case when v_dirty then 'archived' else 'cleared' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 6 — GRANTS
--   Same posture as 058: the custom session spine means the platform
--   role is ALWAYS anon, so anon gets EXECUTE and the real gate is the
--   in-body session/role check.
-- ---------------------------------------------------------------------
revoke all on function public.start_fingerprint_registration_rpc(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.start_fingerprint_registration_rpc(uuid, timestamptz, timestamptz) to anon, authenticated;

revoke all on function public.close_fingerprint_registration_rpc(uuid) from public, anon, authenticated;
grant execute on function public.close_fingerprint_registration_rpc(uuid) to anon, authenticated;

revoke all on function public.open_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.open_election_rpc(uuid) to anon, authenticated;

revoke all on function public.reset_election_plan_rpc(text, text) from public, anon, authenticated;
grant execute on function public.reset_election_plan_rpc(text, text) to anon, authenticated;

commit;
