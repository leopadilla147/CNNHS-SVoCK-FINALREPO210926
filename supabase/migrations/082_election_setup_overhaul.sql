-- 082_election_setup_overhaul.sql
-- =============================================================
-- Election Setup page overhaul.
--
-- Stage 1 (Application) takes ownership of the Rules Discussion
-- meeting: a new save_meeting_schedule_rpc records (and re-records)
-- the meeting while the Application Stage is current.  It no longer
-- ends candidacy or moves the stage — that is now a separate
-- "End Application Stage" action (end_candidacy_period_rpc), which
-- closes applications permanently and moves the election to the
-- Campaign Stage.
--
-- Also:
--   * campaign_start_at / campaign_end_at return (036 dropped them)
--     so the Campaign Period card can hold its own start/end dates.
--   * election_modality records Digital / Manual / Hybrid
--     (informational; the tallying voting_method column is untouched).
--
-- The old close_candidacy_period_rpc (pause) and
-- end_candidacy_and_schedule_meeting_rpc stay in the database —
-- migrations are append-only — but nothing calls them any more.
-- =============================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — COLUMNS
--   The Campaign window is a plain schedule record (nullable both):
--   stopping the campaign early flips the stage and leaves the saved
--   dates as the record of what was scheduled.  The modality defaults
--   to 'digital' so existing rows keep a valid value without an UPDATE.
-- ---------------------------------------------------------------------
alter table public.election_periods
  add column if not exists campaign_start_at timestamptz,
  add column if not exists campaign_end_at timestamptz;

alter table public.election_periods
  add column if not exists election_modality text not null default 'digital';

-- Fixed 082 set.  Named constraint + drop-if-exists so re-apply is a no-op.
alter table public.election_periods
  drop constraint if exists election_periods_election_modality_check;
alter table public.election_periods
  add constraint election_periods_election_modality_check
  check (election_modality in ('digital', 'manual', 'hybrid'));

-- ---------------------------------------------------------------------
-- SECTION 2 — STAGE 1: SAVE (OR RESAVE) THE MEETING SCHEDULE
--   Editable only while the Application Stage is current — that is the
--   "can't be changed after the Application Stage ends" rule, enforced
--   in the database rather than just the UI.
-- ---------------------------------------------------------------------
create or replace function public.save_meeting_schedule_rpc(
  p_election_id uuid,
  p_meeting_at timestamptz
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
    raise exception 'Only administrators can save the meeting schedule.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can save the meeting schedule.';
  end if;

  if p_meeting_at is null then
    raise exception 'A meeting date and time is required.';
  end if;

  select e.lifecycle_stage into v_stage
    from public.election_periods e
   where e.id = p_election_id;

  if v_stage is null then
    raise exception 'Election period not found.';
  end if;

  if v_stage <> 'application' then
    raise exception 'The meeting schedule can no longer be changed — the Application Stage has ended. This election is in the % stage.', v_stage;
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set rules_discussion_at = p_meeting_at
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Campaign Meeting Scheduled',
    'Rules Discussion Meeting set for ' || to_char(p_meeting_at, 'YYYY-MM-DD HH24:MI')
      || '. The schedule can still be changed until the Application Stage ends.',
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 3 — STAGE 1: END THE APPLICATION STAGE
--   Applications close permanently and the election moves to the
--   Campaign Stage.  The meeting must already be saved: the schedule
--   locks once this runs, and Fingerprint Registration (060) needs it —
--   allowing an end without a meeting would deadlock the election.
--   One-way, like every stage RPC: only a reset rewinds the stage.
-- ---------------------------------------------------------------------
create or replace function public.end_candidacy_period_rpc(
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
  v_meeting timestamptz;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can end the Application Stage.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can end the Application Stage.';
  end if;

  select e.lifecycle_stage, e.rules_discussion_at into v_stage, v_meeting
    from public.election_periods e
   where e.id = p_election_id;

  if v_stage is null then
    raise exception 'Election period not found.';
  end if;

  if v_stage <> 'application' then
    raise exception 'The Application Stage is not the current stage. This election is in the % stage.', v_stage;
  end if;

  if v_meeting is null then
    raise exception 'Save the Rules Discussion Meeting schedule before ending the Application Stage.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set candidacy_open = false,
         lifecycle_stage = 'campaign'
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Candidate Application Period Ended',
    'The Candidate Application Period has ended. Applications are closed for the rest of this election, and the election moved to the Campaign Stage.',
    'warning'
  );
end;
$$;

revoke all on function public.save_meeting_schedule_rpc(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.save_meeting_schedule_rpc(uuid, timestamptz) to anon, authenticated;

revoke all on function public.end_candidacy_period_rpc(uuid) from public, anon, authenticated;
grant execute on function public.end_candidacy_period_rpc(uuid) to anon, authenticated;

commit;
