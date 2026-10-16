-- 063_open_election_closes_candidacy.sql
--
-- WHAT
--   Re-creates public.open_election_rpc so that opening the Voting
--   Period also forces candidacy_open = false, in the same UPDATE that
--   flips the stage.
--
-- WHY
--   060:253 opened the vote by setting lifecycle_stage = 'voting' and
--   is_active = true, and it closed the Fingerprint Registration window
--   — but it never touched candidacy_open.  Candidacy is only closed
--   today because the Stage 2 meeting RPC (058:271) happens to close it
--   on the way through.  Any period that reaches voting with
--   candidacy_open still true (a reopened period, a row written by an
--   older client, a manual fix) stays open forever: students keep seeing
--   the Apply for Candidacy form DURING the vote, and the Screening
--   Commissioner keeps seeing an "applications open" board.
--
--   The Campaign Period needs no column of its own — it IS
--   lifecycle_stage = 'campaign', so the existing stage flip already
--   ends it.  What was missing was candidacy, and that is this file.
--
--   Client side (AdminElectionSetup.tsx) now also hides the Stage 1/2
--   controls once the stage is "voting" or "results", and blocks the
--   handlers defensively; this migration is the guarantee for every
--   other caller of the RPC.
--
--   The audit detail line is updated to say what actually happened.
--
-- APPLIED BY HAND IN SUPABASE — this file is the record of it.

begin;

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

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'voting',
         is_active = true,
         -- The Candidacy Period is over the moment the vote opens, no
         -- matter how the row got here.  FALSE here can only ever
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

commit;
