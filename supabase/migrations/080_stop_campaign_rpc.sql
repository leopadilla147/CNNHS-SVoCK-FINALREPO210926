  -- 080_stop_campaign_rpc.sql
  -- Manual "Stop Campaign" for the Electoral Board.  Ends the Campaign Period
  -- early by moving the election straight to the Fingerprint Registration
  -- stage — the same stage flip start_fingerprint_registration_rpc performs
  -- (060:126-130), but WITHOUT opening an enrolment window.  The window stays
  -- unscheduled until start_fingerprint_registration_rpc runs, so the board
  -- keeps manual control of Stage 3.
  --
  -- One-way, like every stage RPC: there is no transition back to 'campaign'.

  create or replace function public.stop_campaign_rpc(
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
      raise exception 'Only administrators can stop the Campaign Period.';
    end if;

    v_role := public.current_commissioner_role();
    if v_role is null or v_role not in ('electoral_board', 'chief') then
      raise exception 'Only the Commissioner of Electoral Board can stop the Campaign Period.';
    end if;

    select e.lifecycle_stage into v_stage
      from public.election_periods e
    where e.id = p_election_id;

    if v_stage is null then
      raise exception 'Election period not found.';
    end if;

    if v_stage <> 'campaign' then
      raise exception 'The Campaign Period is not the current stage. This election is in the % stage.', v_stage;
    end if;

    v_actor := public.current_session_user_id();

    update public.election_periods
      set lifecycle_stage = 'fingerprint_registration'
    where id = p_election_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      v_actor,
      'Commissioner of Electoral Board',
      'admin',
      'Campaign Period Stopped',
      'The Campaign Period was ended early. The election moved to the Fingerprint Registration stage; the enrolment window is not scheduled yet.',
      'warning'
    );
  end;
  $$;

  revoke all on function public.stop_campaign_rpc(uuid) from public, anon, authenticated;
  grant execute on function public.stop_campaign_rpc(uuid) to anon, authenticated;
