-- 137_void_retains_votes.sql
--
-- WHAT
--   void_election_rpc re-issued: the Stage 5 escape hatch no longer
--   deletes the period's recorded votes.  Void keeps every vote and still
--   returns the SAME period to the Voting Stage, paused (is_active =
--   false) -- Stage 1-3 records, the candidates, the complaints and the
--   voting schedule are untouched, exactly as in 113.
--
-- WHY
--   The board asked for the ballots to be retained instead of discarded:
--   a void is an administrative rewind, and wiping the tallies destroys
--   the audit trail.  The one-vote-per-student invariant is unchanged --
--   votes (voter_id, position, election_period_id) is UNIQUE (001) -- so
--   after a Void + Reopen only students who never cast a ballot can vote;
--   everyone else's recorded votes simply carry over into the tallies.
--
-- GUARDS (all unchanged from 113)
--   * admin role + Commissioner of Electoral Board (electoral_board/chief)
--   * Electoral Board password (verify_electoral_password_internal)
--   * only from the Results stage, vote closed/ended (not is_active)
--   * one-way doors: refused once results are published or winners are
--     proclaimed
--
-- DROPPED (the delete-era bookkeeping, no longer needed because the
--   votes survive)
--   * the kiosk_vote_queue.linked_vote_id release -- those references
--     pointed at the votes being discarded in 113 and would have dangled;
--     with the votes retained they stay valid, so the queue rows keep
--     pointing at their ballots.
--   * the votes DELETE itself (and its row_count capture).
--
-- KEPT (defensive, unchanged)
--   * the proclamations cleanup -- a no-op before proclaim, it only
--     keeps the invariant airtight if a stray row ever existed.  The
--     ledger is optional in this deployment (085 tolerance): skipped
--     when the table is absent.
--
-- SAFE TO RE-RUN: create or replace function.
-- =====================================================================

create or replace function public.void_election_rpc(p_election_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_record record;
  v_votes integer := 0;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can void the election.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can void the election.';
  end if;

  perform public.verify_electoral_password_internal(p_password);

  select * into v_record
    from public.election_periods
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  -- Void is a Stage 5 action: the vote must have been closed (or ended).
  if v_record.lifecycle_stage is distinct from 'results' then
    raise exception 'The election can only be voided from the Results stage.';
  end if;

  if v_record.is_active then
    raise exception 'The voting period is still running.';
  end if;

  -- The one-way doors: once results are published or winners proclaimed,
  -- the record is committed and the election can no longer be voided.
  if v_record.results_published then
    raise exception 'Results have already been published -- the election can no longer be voided.';
  end if;

  if v_record.proclaimed then
    raise exception 'Winners have already been proclaimed -- the election can no longer be voided.';
  end if;

  v_actor := public.current_session_user_id();

  -- 137 -- the votes are RETAINED, not deleted: count them for the audit
  -- trail.  Every ballot stays in place, so the kiosk queue's
  -- linked_vote_id references remain valid and the 113 release step is
  -- gone.  The one-vote-per-student invariant is untouched, so a student
  -- who already voted cannot vote again after a Void + Reopen.
  select count(*) into v_votes
    from public.votes
   where election_period_id = p_election_id;

  -- Defensive no-op before proclaim, but keeps the invariant airtight if
  -- a stray row ever existed for this period.  The ledger is optional in
  -- this deployment (085 tolerance): skip it when the table is absent.
  if to_regclass('public.proclamations') is not null then
    delete from public.proclamations
     where election_period_id = p_election_id;
  end if;

  -- Same period, back to the Voting Stage, PAUSED: the board reviews
  -- Stage 4 and resumes with reopen_voting_rpc when ready.  Stage 1-3
  -- records, the candidates, the schedule and every recorded vote are
  -- untouched.
  update public.election_periods
     set lifecycle_stage = 'voting',
         is_active = false,
         voting_ended_at = null,
         results_published = false,
         proclaimed = false,
         proclaimed_at = null
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Voided',
    'The election was voided with the Electoral Board password. '
      || v_votes::text || ' recorded vote(s) were retained and the same election period returned to the Voting Stage (paused). '
      || 'Stage 1-3 records are unchanged.',
    'warning'
  );
end;
$$;

revoke all on function public.void_election_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.void_election_rpc(uuid, text) to anon, authenticated;
