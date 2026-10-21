-- 083_close_voting_moves_to_results.sql
--
-- WHAT
--   1. close_election_rpc now moves the period to the Results stage:
--      closing the vote sets lifecycle_stage = 'results' alongside
--      is_active = false.
--   2. open_election_rpc refuses to run once the vote has concluded —
--      the re-open path (060:214 allowed re-opening after a close) is
--      gone.  A concluded election only moves forward: publish and
--      proclaim, or a full plan reset.
--   3. One-time backfill: rows already closed by the old RPC
--      (is_active = false, stage still 'voting', results not yet
--      published) are moved to 'results' so the data matches the new
--      invariant: a closed vote IS the Results stage.
--
-- WHY
--   Closing the vote is the transition into Stage 5.  Leaving the row at
--   'voting' meant the Stage 4 card kept offering Open Voting (re-open)
--   after the election had effectively concluded, and the "results"
--   stage only ever appeared after publish_results_rpc ran.  Stage 5 is
--   now active the moment the vote closes.
--
--   publish_results_rpc needs no change: it only requires the period to
--   be inactive and already writes lifecycle_stage = 'results', so it is
--   idempotent with the new close behaviour.
--
-- APPLIED BY HAND IN SUPABASE — this file is the record of it.

begin;

-- ---------------------------------------------------------------------
-- 1) close_election_rpc — 036:423 body + the stage flip to 'results'.
--    Same guards survive verbatim: the admin gate and the must-be-active
--    check (a closed vote cannot be closed twice).
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
     set is_active = false,
         -- Closing the vote IS the move to Stage 5: publish_results_rpc
         -- keeps the stage at 'results' and flips results_published.
         lifecycle_stage = 'results'
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

revoke all on function public.close_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.close_election_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) open_election_rpc — 063 body (candidacy force-close + enrolment
--    window close survive verbatim) plus the concluded guard: the vote
--    cannot be re-opened once it has concluded.
-- ---------------------------------------------------------------------
drop function if exists public.open_election_rpc(uuid);

create function public.open_election_rpc(p_election_id uuid)
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

  -- 083: no re-open.  Once the vote closed, the election is at the
  -- Results stage; the only ways forward are publish/proclaim or a
  -- full reset_election_plan_rpc.
  if v_record.lifecycle_stage in ('results', 'completed') then
    raise exception 'The voting period has concluded and cannot be reopened.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'voting',
         is_active = true,
         -- 063: the Candidacy Period is over the moment the vote opens,
         -- no matter how the row got here.  FALSE here can only ever
         -- narrow an open window, never reopen one.
         candidacy_open = false,
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
    'Voting opened — the Candidate Application Period and Campaign Period have ended, and Fingerprint Registration is closed.',
    'success'
  );
end;
$$;

revoke all on function public.open_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.open_election_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Backfill — rows closed by the old RPC never left the 'voting'
--    stage.  Stage 'voting' + is_active = false can only mean the vote
--    was opened and then closed, so those elections belong at Stage 5.
-- ---------------------------------------------------------------------
update public.election_periods
   set lifecycle_stage = 'results'
 where lifecycle_stage = 'voting'
   and is_active = false
   and not results_published;

commit;
