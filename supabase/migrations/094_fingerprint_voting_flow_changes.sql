-- 094_fingerprint_voting_flow_changes.sql
--
-- WHAT
--   1. close_fingerprint_registration_rpc — the 060 body plus two guards
--      that were missing: the enrolment window must have started, and it
--      must not already be closed.  The RPC stays the one supported way
--      to end the window early.
--   2. open_election_rpc — the 083 body, except that it no longer
--      force-closes the Fingerprint Registration window.  The enrolment
--      window is closed by force_open_voting_rpc instead, or by its own
--      end stamp.  Every other guard survives verbatim: the admin gate,
--      the Commissioner gate, the already-active guard, the concluded
--      guard, candidacy_open = false and the audit row.
--   3. force_open_voting_rpc — new.  Opens voting AND ends the enrolment
--      window in the same statement.  This is the path behind the
--      "Force Open Voting" button, and the path the Stage 4 card takes
--      by itself when the saved voting start time arrives.
--
-- WHY
--   Opening the vote used to shut the enrolment window as a side effect
--   (060, then 083).  Under the new flow the enrolment window and the
--   voting window are separate: the vote may open while enrolment is
--   still running, and enrolment is ended by the force-open path or by
--   the window's own end stamp.  The audit trail records which path
--   was taken, so "the vote is open but enrolment never closed" is
--   still traceable.
--
-- APPLIED BY HAND IN SUPABASE — this file is the record of it.

begin;

set search_path = public, extensions;

-- Ensure close_fingerprint_registration_rpc exists (may be used in new flow)
create or replace function public.close_fingerprint_registration_rpc(p_election_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_record record;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can close Fingerprint Registration.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can close Fingerprint Registration.';
  end if;

  select * into v_record
    from public.election_periods
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  if v_record.lifecycle_stage <> 'fingerprint_registration' then
    raise exception 'Fingerprint Registration is not the current stage.';
  end if;

  if v_record.fingerprint_registration_start_at is null then
    raise exception 'Fingerprint Registration has not started.';
  end if;

  if v_record.fingerprint_registration_end_at is not null then
    raise exception 'Fingerprint Registration is already closed.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set fingerprint_registration_end_at = now()
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor, 'Commissioner of Electoral Board', 'admin',
    'Fingerprint Registration Ended',
    'The Fingerprint Registration window was ended.',
    'warning'
  );
end;
$$;

revoke all on function public.close_fingerprint_registration_rpc(uuid) from public, anon, authenticated;
grant execute on function public.close_fingerprint_registration_rpc(uuid) to anon, authenticated;

-- Modify open_election_rpc to not automatically close FP window
-- FP will be closed by force open or when start date arrives
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

  if v_record.lifecycle_stage in ('results', 'completed') then
    raise exception 'The voting period has concluded and cannot be reopened.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'voting',
         is_active = true,
         candidacy_open = false
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor, 'Commissioner of Electoral Board', 'admin',
    'Voting Period Started',
    'Voting opened.',
    'success'
  );
end;
$$;

revoke all on function public.open_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.open_election_rpc(uuid) to anon, authenticated;

-- Force open voting - ends FP and opens voting
create or replace function public.force_open_voting_rpc(p_election_id uuid)
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
    raise exception 'Only administrators can force open voting.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can force open voting.';
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

  if v_record.lifecycle_stage in ('results', 'completed') then
    raise exception 'The voting period has concluded and cannot be reopened.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'voting',
         is_active = true,
         candidacy_open = false,
         fingerprint_registration_end_at = coalesce(fingerprint_registration_end_at, now())
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor, 'Commissioner of Electoral Board', 'admin',
    'Voting Period Force Opened',
    'Voting opened by force; fingerprint registration ended.',
    'success'
  );
end;
$$;

revoke all on function public.force_open_voting_rpc(uuid) from public, anon, authenticated;
grant execute on function public.force_open_voting_rpc(uuid) to anon, authenticated;

commit;
