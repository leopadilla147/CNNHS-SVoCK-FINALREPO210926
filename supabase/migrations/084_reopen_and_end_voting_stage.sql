-- 084_reopen_and_end_voting_stage.sql
--
-- WHAT
--   1. close_election_rpc goes back to the 036 body: it only pauses the
--      vote (is_active = false) and NO LONGER moves the stage to
--      'results'.  083 made closing a one-way door into Stage 5; that
--      was too final — the board may need to resume the vote.
--   2. verify_electoral_password_internal(p_password) — the 078 password
--      check (bcrypt crypt / sha256 hex against the caller's
--      adminprofiles.password_hash) factored into an internal helper.
--   3. reopen_voting_rpc(p_election_id, p_password) — resumes a paused
--      vote.  Electoral Board password required, verified server-side.
--   4. end_voting_stage_rpc(p_election_id, p_password) — finalizes the
--      Voting Stage: lifecycle_stage = 'results', which is what unlocks
--      Stage 5 publishing.  Electoral Board password required.
--
-- WHY
--   Closing the vote is reversible in the real world (a ballot box
--   found late, a technical issue, a recount request), so it must not
--   be the same action as finalizing the stage.  The pause is cheap;
--   the two consequential moves — resuming and finalizing — are the
--   ones guarded by the Electoral Board password, verified in the RPC
--   so the password never crosses the network in plain text beyond
--   the call that needs it.
--
--   publish_results_rpc needs no change: it already requires the
--   period to be inactive and writes lifecycle_stage = 'results'.
--
-- APPLIED BY HAND IN SUPABASE — this file is the record of it.

begin;

-- ---------------------------------------------------------------------
-- 1) close_election_rpc — back to 036:423 (is_active only).  Guards
--    survive verbatim: the admin gate and the must-be-active check.
-- ---------------------------------------------------------------------
create or replace function public.close_election_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can close the election.';
  end if;

  if not exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Election is not currently active.';
  end if;

  update public.election_periods
     set is_active = false
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

revoke all on function public.close_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.close_election_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) verify_electoral_password_internal — shared password gate.  The
--    same dual-hash check 078 performs for the plan reset: bcrypt
--    hashes are verified with crypt(), legacy sha256 with a hex
--    compare.  Raises on every failure mode.
-- ---------------------------------------------------------------------
create or replace function public.verify_electoral_password_internal(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_hash text;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated.';
  end if;

  if p_password is null or p_password = '' then
    raise exception 'Password is required.';
  end if;

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if starts_with(coalesce(v_hash, ''), '$2') then
    if v_hash is distinct from crypt(p_password, v_hash) then
      raise exception 'Password is incorrect.';
    end if;
  else
    if v_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      raise exception 'Password is incorrect.';
    end if;
  end if;
end;
$$;

revoke all on function public.verify_electoral_password_internal(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) reopen_voting_rpc — resume a paused vote.  The pause is the state
--    close_election_rpc leaves behind: stage still 'voting',
--    is_active = false, nothing published.  Results stage rows are
--    NOT reopenable here (083's guard on open_election_rpc still
--    holds); a concluded election only moves forward.
-- ---------------------------------------------------------------------
create or replace function public.reopen_voting_rpc(p_election_id uuid, p_password text)
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
    raise exception 'Only administrators can reopen the election.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can reopen the Voting Period.';
  end if;

  perform public.verify_electoral_password_internal(p_password);

  select * into v_record
    from public.election_periods
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  if v_record.lifecycle_stage is distinct from 'voting' or v_record.is_active then
    raise exception 'The voting period is not paused.';
  end if;

  if v_record.results_published then
    raise exception 'Results have already been published.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set is_active = true
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Voting Period Reopened',
    'The voting period was reopened with the Electoral Board password. Students can cast votes again.',
    'warning'
  );
end;
$$;

revoke all on function public.reopen_voting_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.reopen_voting_rpc(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) end_voting_stage_rpc — finalize the Voting Stage into Stage 5.
--    Only a paused (closed, unpublished) vote can be finalized; while
--    the vote is still running the board closes it first.
-- ---------------------------------------------------------------------
create or replace function public.end_voting_stage_rpc(p_election_id uuid, p_password text)
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
    raise exception 'Only administrators can end the Voting Stage.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can end the Voting Stage.';
  end if;

  perform public.verify_electoral_password_internal(p_password);

  select * into v_record
    from public.election_periods
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  if v_record.lifecycle_stage is distinct from 'voting' then
    raise exception 'The Voting Stage has already ended.';
  end if;

  if v_record.is_active then
    raise exception 'Close the voting period before ending the Voting Stage.';
  end if;

  if v_record.results_published then
    raise exception 'Results have already been published.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'results'
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Voting Stage Ended',
    'The Voting Stage was ended with the Electoral Board password. The election moved to the Results stage.',
    'warning'
  );
end;
$$;

revoke all on function public.end_voting_stage_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.end_voting_stage_rpc(uuid, text) to anon, authenticated;

commit;
