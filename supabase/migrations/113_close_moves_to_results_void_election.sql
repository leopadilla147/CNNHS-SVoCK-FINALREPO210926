-- 113_close_moves_to_results_void_election.sql
--
-- WHAT
--   1. election_periods.voting_ended_at (NEW timestamptz) -- the stamp
--      end_voting_stage_rpc writes.  Close Voting and End Voting Stage BOTH
--      leave the period at lifecycle_stage = 'results' now, so the stage
--      alone can no longer tell them apart: this column is the signal the
--      Stage 4 check mark (admin header) and the publish gate read.
--   2. close_election_rpc re-issued: closing the vote moves the period to
--      'results' (083's behaviour restored) and clears voting_ended_at.
--   3. reopen_voting_rpc re-issued: resumes a CLOSED vote -- it now accepts
--      stage 'results' (the closed state, where Close Voting leaves the row)
--      as well as 'voting' (a voided period paused in the Voting Stage), and
--      moves the stage back to 'voting' with is_active = true.
--   4. end_voting_stage_rpc re-issued: finalizes from the closed state
--      (stage 'results', inactive, unpublished, not already ended) and
--      stamps voting_ended_at = now().
--   5. open_election_rpc / force_open_voting_rpc: voting_ended_at = null
--      added to the open update (defensive; the guards are unchanged).
--   6. publish_results_rpc: the 113 gate -- publishing requires the Voting
--      Stage to have been ENDED (voting_ended_at set), mirroring the UI.
--   7. void_election_rpc (NEW): the Stage 5 escape hatch.  Deletes every
--      recorded vote of the period and returns the SAME period to the
--      Voting Stage, paused (is_active = false).  Stage 1-3 records
--      (candidacy, campaign, enrolment windows), the candidates, the
--      complaints and the voting schedule are untouched.  Electoral Board
--      password required.  Only possible before the results are published
--      and the winners proclaimed.  Tables this deployment may not have --
--      the 031 kiosk_vote_queue and the 012 proclamations ledger -- are
--      checked with to_regclass / information_schema (the 085 tolerance
--      pattern), so a database running on the votes table alone voids
--      cleanly.
--   8. Backfills so existing rows satisfy the new invariants.
--
-- WHY
--   The board's lifecycle spec: Close Voting opens Stage 5 for review and
--   Void; End Voting Stage is the formal conclusion that lights the Stage 4
--   check and unlocks publishing; Reopen rewinds a closed vote.  Void
--   discards a tainted voting run within the same election period -- the
--   alternative (reset_election_plan_rpc) archives the whole plan and
--   restarts at Stage 1, which throws away Stage 1-3 work the board wants
--   to keep.
--
--   Votes are deleted, never archived: a voided run is an annulled ballot,
--   and the election is re-run on the SAME period (052 blocks period
--   deletes, so there is no new row to move history to).  The kiosk queue
--   keeps its rows -- only the linked_vote_id references are released
--   (031's FK carries no cascade) -- so the queue remains the audit trail
--   of what the kiosks submitted; when the queue table (or the column) is
--   absent from the deployment, the step is skipped.  transaction_sequences
--   is deliberately untouched: it is date-keyed and global, and numbering
--   continues from where it stopped.
--
-- APPLIED BY HAND IN SUPABASE -- this file is the record of it.

begin;

-- ---------------------------------------------------------------------
-- 1) voting_ended_at -- the End Voting Stage stamp.
-- ---------------------------------------------------------------------
alter table public.election_periods
  add column if not exists voting_ended_at timestamptz;

-- ---------------------------------------------------------------------
-- 2) Backfills.
--    a) Rows paused by the 084 close (stage 'voting', inactive,
--       unpublished) become CLOSED: 'results' with voting_ended_at null.
--       Published rows can never sit at 'voting' (publish requires
--       inactive and writes 'results'), so the published filter is
--       belt-and-braces.
--    b) Every row already at 'results' was ended by 084's
--       end_voting_stage_rpc (or published through it): stamp it ENDED so
--       the Stage 4 check and the publish gate stay lit for live data.
-- ---------------------------------------------------------------------
update public.election_periods
   set lifecycle_stage = 'results'
 where lifecycle_stage = 'voting'
   and is_active = false
   and not coalesce(results_published, false);

update public.election_periods
   set voting_ended_at = coalesce(voting_ended_at, updated_at)
 where lifecycle_stage = 'results'
   and voting_ended_at is null;

-- ---------------------------------------------------------------------
-- 3) close_election_rpc -- 083's body restored, plus voting_ended_at
--    cleared for idempotence.  Guards survive verbatim: the admin gate
--    and the must-be-active check (a closed vote cannot be closed twice).
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
         -- Closing the vote IS the move to Stage 5: the board reviews
         -- complaints, voids the run, or ends the stage from there.
         lifecycle_stage = 'results',
         -- A fresh close is never an ended stage.
         voting_ended_at = null
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

revoke all on function public.close_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.close_election_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) reopen_voting_rpc -- 084's body, widened for the 113 states.  Two
--    rows qualify: the CLOSED vote (stage 'results', where Close Voting
--    leaves it) and a VOIDED period (stage 'voting', paused).  A row whose
--    Voting Stage was ENDED (voting_ended_at set) is refused -- the ways
--    back from an ended stage are Stage 5's Void or publish flow.
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

  if v_record.lifecycle_stage not in ('voting', 'results') then
    raise exception 'The voting period is not open for reopening.';
  end if;

  if v_record.is_active then
    raise exception 'The voting period is not paused.';
  end if;

  if v_record.results_published then
    raise exception 'Results have already been published.';
  end if;

  if v_record.voting_ended_at is not null then
    raise exception 'The Voting Stage has already ended. Void the election instead to restart voting.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set is_active = true,
         lifecycle_stage = 'voting',
         voting_ended_at = null
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
-- 5) end_voting_stage_rpc -- finalize the Voting Stage.  Only a CLOSED
--    vote can be finalized: the stage must already be 'results' (Close
--    Voting put it there), the vote inactive, nothing published and the
--    stage not ended yet.  The stamp is what lights the Stage 4 check and
--    unlocks publish_results_rpc.
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

  if v_record.lifecycle_stage is distinct from 'results' then
    raise exception 'Close the voting period before ending the Voting Stage.';
  end if;

  if v_record.is_active then
    raise exception 'Close the voting period before ending the Voting Stage.';
  end if;

  if v_record.results_published then
    raise exception 'Results have already been published.';
  end if;

  if v_record.voting_ended_at is not null then
    raise exception 'The Voting Stage has already ended.';
  end if;

  v_actor := public.current_session_user_id();

  update public.election_periods
     set lifecycle_stage = 'results',
         voting_ended_at = now()
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Voting Stage Ended',
    'The Voting Stage was ended with the Electoral Board password. The election stays at the Results stage and publishing is now unlocked.',
    'warning'
  );
end;
$$;

revoke all on function public.end_voting_stage_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.end_voting_stage_rpc(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) open_election_rpc -- 083's body (the concluded guard survives) with
--    voting_ended_at = null added: an open vote is never an ended stage.
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

  -- 083: no re-open of a concluded vote.  Once the vote closed, the
  -- election is at the Results stage; reopening a closed vote goes
  -- through reopen_voting_rpc (password), and a voided run is resumed
  -- the same way.
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
           least(coalesce(fingerprint_registration_end_at, now()), now()),
         voting_ended_at = null
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Voting Period Started',
    'Voting opened -- the Candidate Application Period and Campaign Period have ended, and Fingerprint Registration is closed.',
    'success'
  );
end;
$$;

revoke all on function public.open_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.open_election_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) force_open_voting_rpc -- 095's body verbatim plus voting_ended_at =
--    null, same defensive clear as open_election_rpc.
-- ---------------------------------------------------------------------
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
         fingerprint_registration_end_at = least(coalesce(fingerprint_registration_end_at, now()), now()),
         voting_ended_at = null
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

-- ---------------------------------------------------------------------
-- 8) publish_results_rpc -- 089's body with the 113 gate: results may
--    only be published once the Voting Stage was ENDED, not while the
--    vote is merely closed.  Existing 'results' rows are backfilled with
--    voting_ended_at (section 2b), so re-publishing a snapshot keeps
--    working.
-- ---------------------------------------------------------------------
create or replace function public.publish_results_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can publish results.';
  end if;

  if exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Cannot publish results while the election is still active.';
  end if;

  -- 113: the Voting Stage must have been formally ended first.
  if not exists (
    select 1 from public.election_periods
     where id = p_election_id and voting_ended_at is not null
  ) then
    raise exception 'End the Voting Stage before publishing results.';
  end if;

  -- 089: ELECT-02 restored.  Every complaint of this election must be
  -- resolved before the results may be published.
  if public.has_active_complaint_rpc(p_election_id) then
    raise exception 'Results cannot be published while there are unresolved complaints. Resolve all complaints first.';
  end if;

  update public.election_periods
     set results_published = true,
         lifecycle_stage = 'results'
   where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  -- Publishing results freezes them.  Re-publishing replaces the snapshot,
  -- so the archive always reflects the newest tallies.
  perform public.archive_election_results_internal(p_election_id);
end;
$$;

revoke all on function public.publish_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.publish_results_rpc(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9) void_election_rpc (NEW) -- the Stage 5 escape hatch.  Discards every
--    recorded vote of the election and returns the SAME period to the
--    Voting Stage, paused.  Stage 1-3 records, candidates, complaints and
--    the voting schedule are untouched.  Electoral Board password
--    required; only possible before publish + proclaim.
-- ---------------------------------------------------------------------
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

  -- Release the kiosk queue's references first: linked_vote_id points at
  -- the votes being discarded and carries no cascade (031).  The queue
  -- rows themselves are kept -- they are the audit trail of what the
  -- kiosks submitted before the void.  The table AND the 031 column are
  -- optional in this deployment (a database can run on the votes table
  -- alone), so both are checked -- the 085 tolerance pattern -- and the
  -- step is skipped entirely when either is absent.
  if to_regclass('public.kiosk_vote_queue') is not null
     and exists (
       select 1
         from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name = 'kiosk_vote_queue'
          and col.column_name = 'linked_vote_id'
     ) then
    update public.kiosk_vote_queue q
       set linked_vote_id = null,
           resolution_note = coalesce(q.resolution_note || ' | ', '') || 'Election voided -- ballot discarded.'
     where q.linked_vote_id in (
       select v.id from public.votes v where v.election_period_id = p_election_id
     );
  end if;

  delete from public.votes
   where election_period_id = p_election_id;
  get diagnostics v_votes = row_count;

  -- Defensive no-op before proclaim, but keeps the invariant airtight if
  -- a stray row ever existed for this period.  The ledger is optional in
  -- this deployment (085 tolerance): skip it when the table is absent.
  if to_regclass('public.proclamations') is not null then
    delete from public.proclamations
     where election_period_id = p_election_id;
  end if;

  -- Same period, back to the Voting Stage, PAUSED: the board reviews
  -- Stage 4 and resumes with reopen_voting_rpc when ready.  Stage 1-3
  -- records, the candidates and the schedule are untouched.
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
      || v_votes::text || ' recorded vote(s) were discarded and the same election period returned to the Voting Stage (paused). '
      || 'Stage 1-3 records are unchanged.',
    'warning'
  );
end;
$$;

revoke all on function public.void_election_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.void_election_rpc(uuid, text) to anon, authenticated;

commit;
