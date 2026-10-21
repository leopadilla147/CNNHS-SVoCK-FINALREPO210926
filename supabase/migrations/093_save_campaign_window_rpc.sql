-- 093_save_campaign_window_rpc.sql
-- =============================================================
-- The Campaign Period window gets its own guarded RPC.
--
-- WHY
--   Until now the Stage 2 window (campaign_start_at /
--   campaign_end_at) was written by the plain schedule editor — a
--   bare UPDATE on election_periods whose RLS policy only checks
--   current_app_role() = 'admin'.  Every other stage transition in
--   this app goes through a role-guarded RPC (080 stop_campaign,
--   082 save_meeting_schedule / end_candidacy_period, 060/084
--   fingerprint + voting), but the campaign window was the one
--   window any administrator could rewrite at will.
--
--   It is now a locked record with an explicit unlock: the Stage 2
--   card disables both date pickers once the window has been saved
--   and only the Commissioner of Electoral Board gets an "Edit"
--   button that re-enables them.  This RPC is the database half of
--   that rule — the button is a convenience, the guard is here.
--
-- WHAT
--   save_campaign_window_rpc(p_election_id, p_campaign_start_at,
--   p_campaign_end_at) records the window, exactly as the Stage 2
--   card does:
--     * admin gate           — current_app_role() = 'admin'
--     * commissioner gate     — current_commissioner_role() in
--                               ('electoral_board', 'chief')
--     * stage gate           — the election must be in the
--                               'campaign' stage; once the stage
--                               moves on (End Campaign Early ->
--                               fingerprint_registration, Open
--                               Voting) the window is final
--     * window sanity       — both dates present, end after start
--     * audit row            — written inside the transaction
--
--   It touches ONLY the two window columns.  lifecycle_stage is
--   never written here: the stage moves through the 058/060/080
--   RPCs, never through a schedule save.
-- =============================================================

begin;

set search_path = public, extensions;

create or replace function public.save_campaign_window_rpc(
  p_election_id uuid,
  p_campaign_start_at timestamptz,
  p_campaign_end_at timestamptz
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
    raise exception 'Only administrators can update the Campaign Period.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can update the Campaign Period.';
  end if;

  if p_campaign_start_at is null or p_campaign_end_at is null then
    raise exception 'Choose the campaign start and end date before saving.';
  end if;

  if p_campaign_end_at <= p_campaign_start_at then
    raise exception 'The campaign end date must be after the start date.';
  end if;

  select e.lifecycle_stage into v_stage
    from public.election_periods e
   where e.id = p_election_id;

  if v_stage is null then
    raise exception 'Election period not found.';
  end if;

  if v_stage <> 'campaign' then
    raise exception 'The Campaign Period can no longer be changed — this election is in the % stage.', v_stage;
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set campaign_start_at = p_campaign_start_at,
         campaign_end_at   = p_campaign_end_at
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Campaign Period Window Saved',
    'The Campaign Period runs from ' || to_char(p_campaign_start_at, 'YYYY-MM-DD HH24:MI')
      || ' to ' || to_char(p_campaign_end_at, 'YYYY-MM-DD HH24:MI')
      || '. The window is locked until the Commissioner of Electoral Board edits it.',
    'success'
  );
end;
$$;

revoke all on function public.save_campaign_window_rpc(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.save_campaign_window_rpc(uuid, timestamptz, timestamptz) to anon, authenticated;

commit;
