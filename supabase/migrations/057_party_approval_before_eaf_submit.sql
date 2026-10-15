-- =====================================================================
-- 057_party_approval_before_eaf_submit.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
-- Apply AFTER 054_party_president_approval.sql.
--
-- WHAT
--   054 gates a party candidate at SCREENING: the BEFORE UPDATE trigger
--   guard_party_approval_before_screening raises unless the party President
--   has approved.  Nothing stopped the candidate from submitting the
--   completed EAF first, so the form could reach Screening and sit there
--   unsigned-off, and 054's trigger then failed with a message the student
--   could not act on.
--
--   This moves the gate EARLIER, to the submit itself:
--
--   1. guard_party_approval_before_finalize(), a second BEFORE UPDATE
--      trigger, blocks the 'ongoingSubmission' -> 'pending' move — which is
--      exactly what submit_candidacy_rpc's 'finalize' action performs —
--      while the gate is unsatisfied.  Same shape and same rationale as
--      054:166-187, including closing the direct PATCH /rest/v1/candidates
--      path that the "candidates owner admin update" policy allows.
--
--      The two exemptions are the same two 052:760-764 stamps
--      'notRequired':  a null party_id (any Independent run) and the party's
--      own President, who is approved by the Screening Office rather than by
--      the party.  partyApprovalBlockForSubmit in src/app/lib/partyScope.ts
--      is the client-side mirror of this predicate.
--
--   2. A backfill puts still-open party candidacies that somehow read
--      'notRequired' onto the gate.  052:759-764 stamps the gate at create
--      time, so in a healthy database there is nothing to do — but without
--      this, a row predating 052 would be permanently un-submittable once
--      (1) is in place, and nobody could ever un-wedge it.  054's
--      sync_party_president_on_screening covers the equivalent case for
--      'pending' rows; 'ongoingSubmission' is the gap this closes.
--
--   3. review_party_candidacy_rpc is re-created solely to correct one
--      user-facing string: the approval now unblocks a submit, so "It is
--      now ready for Screening" (054:376-377) is wrong — the candidate has
--      not submitted anything yet.  The body is otherwise byte-identical to
--      054:239-401; it is re-declared in full because 054 is already applied
--      to the live project and must not be edited.
--
-- NOT CHANGED
--   052's submit_candidacy_rpc is left alone.  The gate-stamping CASE at
--   052:545-551 is now unreachable for a party non-President — such a row can
--   only finalize while already 'presidentApproved', which the CASE passes
--   through untouched — so it is harmless, and re-declaring a 315-line
--   applied function to delete dead code is not worth the risk.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — THE GATE, AT SUBMIT TIME
-- ---------------------------------------------------------------------
create or replace function public.guard_party_approval_before_finalize()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  -- 'ongoingSubmission' -> 'pending' is the finalize transition.  Testing both
  -- sides rather than only the new value keeps a later unrelated status write
  -- from tripping the guard.
  if new.status is distinct from old.status
     and new.status = 'pending'
     and old.status = 'ongoingSubmission'
     and new.party_id is not null
     and new.position <> 'President'
     and new.position_approval_status <> 'presidentApproved' then
    raise exception 'The President of your party has to approve this candidacy before you can submit the completed EAF. Upload both EAF photos, then use "Check approval status" on your candidacy page once they approve it.';
  end if;
  return new;
end;
$$;

-- Named for the audit trail rather than dropped silently, and re-runnable:
-- a plain CREATE TRIGGER has no IF NOT EXISTS, so the drop is unconditional.
drop trigger if exists candidates_require_party_approval_before_submit
  on public.candidates;

create trigger candidates_require_party_approval_before_submit
  before update on public.candidates
  for each row execute function public.guard_party_approval_before_finalize();

-- ---------------------------------------------------------------------
-- SECTION 2 — BACKFILL: NO CANDIDACY LEFT STRANDED
--   Only rows that are still open for submission are touched.  An already
--   submitted ('pending') row keeps whatever 054 decided, so this can never
--   reopen a decision the President already made.
-- ---------------------------------------------------------------------
update public.candidates
set position_approval_status = 'presidentApprovalRequired'
where party_id is not null
  and position <> 'President'
  and position_approval_status = 'notRequired'
  and status = 'ongoingSubmission';

-- ---------------------------------------------------------------------
-- SECTION 3 — THE PRESIDENT'S DECISION, RE-DECLARED FOR ITS MESSAGE
--   Identical to 054 SECTION 4 apart from the notification body at the end
--   of the approve branch.  Kept verbatim so the two files can be diffed.
-- ---------------------------------------------------------------------
create or replace function public.review_party_candidacy_rpc(
  p_candidate_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
  v_candidate record;
  v_president_id uuid;
  v_president record;
  v_affected record;
  v_result jsonb;
begin
  v_actor_id := public.current_session_user_id();
  if v_actor_id is null then
    raise exception 'Authentication required — party decisions must come from a signed-in student.';
  end if;
  if public.current_app_role() <> 'student' then
    raise exception 'Only a party President can decide candidacy requests.';
  end if;
  if p_action not in ('approve', 'reject') then
    raise exception 'Action must be approve or reject.';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found.';
  end if;
  if v_candidate.party_id is null then
    raise exception 'Independent candidates do not need party approval.';
  end if;
  if v_candidate.position = 'President' then
    raise exception 'A party President is approved by the Screening Office, not by the party.';
  end if;
  -- 'ongoingSubmission' is the state this migration makes meaningful: the
  -- President now decides BEFORE the candidate submits, which is why the
  -- gate sits ahead of finalize rather than ahead of screening.
  if v_candidate.status not in ('ongoingSubmission', 'pending') then
    raise exception 'That candidacy is no longer open for a party decision.';
  end if;
  if v_candidate.position_approval_status <> 'presidentApprovalRequired' then
    raise exception 'That request has already been decided.';
  end if;

  -- The whole authorization surface: the caller must be the student on the
  -- APPROVED President candidacy of this exact party and period.
  select c.student_id into v_president_id
  from public.candidates c
  where c.party_id = v_candidate.party_id
    and c.election_period_id = v_candidate.election_period_id
    and c.position = 'President'
    and c.status = 'approved'
  limit 1;

  if v_president_id is distinct from v_actor_id then
    raise exception 'Only the approved President of that party can decide this request.';
  end if;

  select first_name, last_name into v_president
  from public.students where id = v_actor_id;

  if p_action = 'reject' then
    update public.candidates
    set position_approval_status = 'presidentRejected',
        party_decided_by = v_actor_id,
        party_decided_at = now()
    where id = p_candidate_id;

    perform public.insert_notification_rpc(
      v_candidate.student_id, 'student', 'party_membership_rejected',
      'Party candidacy declined',
      'The President of your party declined your candidacy for ' || v_candidate.position
        || '. You can re-apply if the position opens up again.',
      null
    );

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      null,
      coalesce(v_president.first_name || ' ' || v_president.last_name, 'Party President'),
      'student',
      'Party Candidacy Declined',
      'Declined ' || v_candidate.given_name || ' for ' || v_candidate.position,
      'info'
    );
  else
    if exists (
      select 1
      from public.candidates c
      where c.party_id = v_candidate.party_id
        and c.election_period_id = v_candidate.election_period_id
        and c.position = v_candidate.position
        and c.id <> p_candidate_id
        and c.position_approval_status = 'presidentApproved'
    ) then
      raise exception 'Position % in this party already has an approved candidate.',
        v_candidate.position;
    end if;

    update public.candidates
    set position_approval_status = 'presidentApproved',
        party_decided_by = v_actor_id,
        party_decided_at = now()
    where id = p_candidate_id;

    -- Everyone else who wanted this seat is out, and told so.
    for v_affected in
      select c.id, c.student_id, c.given_name
      from public.candidates c
      where c.party_id = v_candidate.party_id
        and c.election_period_id = v_candidate.election_period_id
        and c.position = v_candidate.position
        and c.id <> p_candidate_id
        and c.position_approval_status = 'presidentApprovalRequired'
    loop
      update public.candidates
      set position_approval_status = 'presidentRejected',
          party_decided_by = v_actor_id,
          party_decided_at = now()
      where id = v_affected.id;

      perform public.insert_notification_rpc(
        v_affected.student_id, 'student', 'party_membership_rejected',
        'Party candidacy declined',
        'Another candidate was approved for ' || v_candidate.position
          || ' in your party. You can re-apply if the position opens up again.',
        null
      );
    end loop;

    -- The one change from 054:376-377.  Approval now unblocks the candidate's
    -- own submit, so it must not claim the EAF is already with Screening.
    perform public.insert_notification_rpc(
      v_candidate.student_id, 'student', 'party_membership_approved',
      'Party candidacy approved',
      'The President of your party approved your candidacy for ' || v_candidate.position
        || '. Submit your completed EAF to the Commissioner on Screening and Validation.',
      null
    );

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      null,
      coalesce(v_president.first_name || ' ' || v_president.last_name, 'Party President'),
      'student',
      'Party Candidacy Approved',
      'Approved ' || v_candidate.given_name || ' for ' || v_candidate.position,
      'info'
    );

    -- Self-heal the display column in case an earlier approval predates this.
    update public.parties
    set president_student_id = v_actor_id
    where id = v_candidate.party_id
      and election_period_id = v_candidate.election_period_id;
  end if;

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where id = p_candidate_id;
  return v_result;
end;
$$;

revoke all on function public.review_party_candidacy_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.review_party_candidacy_rpc(uuid, text) to anon;

-- ---------------------------------------------------------------------
-- SECTION 4 — SANITY CHECK
--   A gated row that is still open must NOT be one of the two exemptions,
--   or the guard above would strand it: the trigger would refuse the submit
--   and nothing could ever clear the gate, because
--   review_party_candidacy_rpc refuses an Independent row outright.
--
--   Reported as a WARNING, not an exception, on purpose.  The SQL runner may
--   commit between statements (see the handoff doc, trap 2), so raising here
--   would report a failed migration while leaving the trigger and the
--   re-declared RPC already applied.  A warning is information; the gate
--   itself is enforced regardless.
-- ---------------------------------------------------------------------
do $$
declare
  v_stranded integer;
begin
  select count(*) into v_stranded
  from public.candidates
  where status = 'ongoingSubmission'
    and position_approval_status = 'presidentApprovalRequired'
    and (party_id is null or position = 'President');

  if v_stranded > 0 then
    raise warning '057 sanity check: % gated candidac(ies) are exempt from the party gate (Independent, or the party''s own President). Set position_approval_status = ''notRequired'' on them, or they can never be submitted.', v_stranded;
  end if;
end;
$$;
