-- 095_force_open_voting_ends_enrolment.sql
--
-- WHAT
--   force_open_voting_rpc — the 094 body verbatim, except the enrolment window
--   is now clamped to now() whenever it is still open-ended OR still scheduled
--   to close in the future:
--
--     094: fingerprint_registration_end_at = coalesce(fingerprint_registration_end_at, now())
--     095: fingerprint_registration_end_at = least(coalesce(fingerprint_registration_end_at, now()), now())
--
--   A close date already in the past is kept as the true end of the window.
--
-- WHY
--   A saved enrolment window (both dates) is a PLAN, not a closure: enrolment
--   ends when the Voting Period starts, whether that happens at the saved
--   voting start time or early.  094 left a scheduled future
--   fingerprint_registration_end_at untouched, so starting the vote while a
--   close date was still in the future left the window "live" — the student
--   dashboard reminder reads end_at, not the lifecycle stage, so students kept
--   being told to enrol during the vote.
--
--   open_election_rpc is deliberately NOT changed here: the admin UI reaches
--   force_open_voting_rpc for every start that has to end enrolment (the
--   "Early Voting Activation" button and the Stage 4 auto-open timer).
--
-- APPLIED BY HAND IN SUPABASE — this file is the record of it.

begin;

set search_path = public, extensions;

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
         -- 095: end enrolment now unless it already ended earlier.
         fingerprint_registration_end_at = least(coalesce(fingerprint_registration_end_at, now()), now())
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
