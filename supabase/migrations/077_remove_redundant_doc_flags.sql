-- =====================================================================
-- 077_remove_redundant_doc_flags.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   The Application Form IS the Election Application Form (EAF) — one
--   document, not two.  The Screening Form, Report Card, and Good Moral
--   Certificate are likewise not separate filings: all of that content
--   lives inside the EAF the student prints, signs, and uploads as the
--   front/back photos.  Tracking them as independent boolean flags on
--   candidates double-counts what doc_application_form +
--   doc_eaf_front + doc_eaf_back already answer.
--
-- WHAT
--   Drops from public.candidates:
--     doc_screening_form, doc_report_card, doc_good_moral_cert
--   Keeps:
--     doc_application_form     (the "EAF was generated/attached" flag —
--                               displayed as "EAF (Election Application
--                               Form)" in the Archived Documents preview)
--     doc_eaf_front/back       (the uploaded EAF photos)
--     doc_introductory_profile (separate requirement, still tracked)
--
-- WHO TOUCHED THE DROPPED COLUMNS
--   Every writer/reader was submit_candidacy_rpc (003 -> 017 -> 020 ->
--   044 -> 052 -> 058).  The latest definition is 058's, so this file
--   recreates it verbatim minus the three flags:
--     - 'create' INSERT: column list 764-766 / values 781
--     - 'finalize' UPDATE: set list 575-577
--   Nothing else references them: 061's past_election_candidates
--   snapshot never copied doc flags, and no view or other RPC does.
--
-- NOTE
--   Dropping a column is instant and non-destructive to other data;
--   the boolean values themselves are discarded, which is the point —
--   they were derivable from the EAF uploads.
-- =====================================================================

begin;

alter table public.candidates
  drop column if exists doc_screening_form,
  drop column if exists doc_report_card,
  drop column if exists doc_good_moral_cert;

-- ---------------------------------------------------------------------
-- submit_candidacy_rpc — 058's definition, minus the dropped flags.
-- Same signature, security posture, and grants as before (Section 8).
-- ---------------------------------------------------------------------
create or replace function public.submit_candidacy_rpc(
  p_action text,
  p_candidate_data jsonb default null,
  p_candidate_id uuid default null,
  p_picture_url text default null,
  p_eaf_front_url text default null,
  p_eaf_back_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_student_id uuid;
  v_actor_id uuid;
  v_election_id uuid;
  v_party_id uuid;
  v_new_id uuid;
  v_result jsonb;
  v_existing record;
  v_student record;
begin
  v_actor_id := public.current_session_user_id();
  if v_actor_id is null then
    raise exception 'Authentication required — candidacy actions must come from a signed-in user.';
  end if;
  if public.current_app_role() != 'student' then
    raise exception 'Only students can manage candidacy applications.';
  end if;
  v_student_id := v_actor_id;

  if p_action = 'finalize' then
    if p_candidate_id is null then
      raise exception 'Candidate ID is required for finalization.';
    end if;

    select * into v_existing
    from public.candidates
    where id = p_candidate_id;

    if not found then
      raise exception 'Candidate not found.';
    end if;

    if v_existing.student_id is distinct from v_student_id then
      raise exception 'You can only manage your own candidacy application.';
    end if;

    if v_existing.doc_eaf_front = false or v_existing.doc_eaf_back = false then
      raise exception 'EAF front and back photos must be uploaded before final submission.';
    end if;

    -- Another candidate already holds this position in this party.  Re-applying
    -- is only possible through reapply_party_candidacy_rpc (054), which
    -- re-checks that the slot is genuinely free.
    if v_existing.position_approval_status = 'presidentRejected' then
      raise exception 'Another candidate was approved for that position in your party. You can only re-apply if the position opens up again.';
    end if;

    update public.candidates
    set status = 'pending',
        doc_introductory_profile = true,
        -- Stamp the gate on first submission only.  A row that already carries
        -- 'presidentApproved' keeps it, so re-finalizing cannot undo a
        -- decision the President already made.
        position_approval_status = case
          when party_id is not null
               and position <> 'President'
               and position_approval_status = 'notRequired'
            then 'presidentApprovalRequired'
          else position_approval_status
        end
    where id = p_candidate_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (null, coalesce(v_existing.given_name, 'Student'), 'student',
            'Candidacy Application',
            'Submitted completed EAF — Pending officer review', 'info');

    select row_to_json(c)::jsonb into v_result
    from public.candidates c where id = p_candidate_id;
    return v_result;
  end if;

  if p_action = 'update' then
    if p_candidate_id is null then
      raise exception 'Candidate ID is required for update.';
    end if;

    select * into v_existing
    from public.candidates
    where id = p_candidate_id;

    if not found then
      raise exception 'Candidate not found.';
    end if;

    if v_existing.student_id is distinct from v_student_id then
      raise exception 'You can only manage your own candidacy application.';
    end if;

    update public.candidates
    set picture_url = coalesce(p_picture_url, picture_url),
        eaf_front_url = coalesce(p_eaf_front_url, eaf_front_url),
        eaf_back_url = coalesce(p_eaf_back_url, eaf_back_url),
        doc_eaf_front = case when p_eaf_front_url is not null then true else doc_eaf_front end,
        doc_eaf_back = case when p_eaf_back_url is not null then true else doc_eaf_back end
    where id = p_candidate_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (null, coalesce(v_existing.given_name, 'Student'), 'student',
            'EAF Uploaded', 'Uploaded EAF images for candidacy', 'info');

    select row_to_json(c)::jsonb into v_result
    from public.candidates c where id = p_candidate_id;
    return v_result;
  end if;

  if p_action != 'create' then
    raise exception 'Action must be create, update, or finalize.';
  end if;

  if p_candidate_data is null then
    raise exception 'Candidate data is required for creation.';
  end if;

  -- 058: the Candidate Application Period is now a real database gate.
  -- Resolving through candidacy_election_period_id() both picks the
  -- right period and refuses outright when no window is open.
  v_election_id := public.candidacy_election_period_id();

  if v_election_id is null then
    raise exception 'The Candidate Application Period is closed. Applications are not being accepted right now.';
  end if;

  if exists (
    select 1 from public.candidates
    where student_id = v_student_id
      and election_period_id = v_election_id
      and rejection_tier = 'high'
  ) then
    raise exception 'You are disqualified from running in this election period due to: high-tier rejection. Please contact the Commissioner of Grievance.';
  end if;

  if nullif(p_candidate_data->>'surname', '') is null then
    raise exception 'Surname is required.';
  end if;
  if nullif(p_candidate_data->>'givenName', '') is null then
    raise exception 'Given name is required.';
  end if;
  if nullif(p_candidate_data->>'gradeLevel', '') is null then
    raise exception 'Grade level is required.';
  end if;
  if nullif(p_candidate_data->>'position', '') is null then
    raise exception 'Position is required.';
  end if;
  if nullif(p_candidate_data->>'gender', '') is null then
    raise exception 'Gender is required.';
  end if;
  if nullif(p_candidate_data->>'email', '') is null then
    raise exception 'Email is required.';
  end if;
  if nullif(p_candidate_data->>'mobileNumber', '') is null then
    raise exception 'Mobile number is required.';
  end if;
  if nullif(p_candidate_data->>'homeAddress', '') is null then
    raise exception 'Home address is required.';
  end if;
  if (p_candidate_data->>'age')::int is null or (p_candidate_data->>'age')::int < 10 then
    raise exception 'Valid age is required.';
  end if;
  if nullif(p_candidate_data->>'status', '') is null
     or p_candidate_data->>'status' not in ('ongoingSubmission', 'pending') then
    raise exception 'Invalid status.';
  end if;

  if (p_candidate_data->>'position') like '%Representative'
     and (p_candidate_data->>'position') <> ((p_candidate_data->>'gradeLevel') || ' Representative') then
    raise exception 'Grade-level mismatch: % students can only apply for % Representative.', p_candidate_data->>'gradeLevel', p_candidate_data->>'gradeLevel';
  end if;

  v_new_id := gen_random_uuid();

  -- The "register a new party" path: a President applicant creates the row
  -- for this period, anyone joining an existing slate reuses it.  Only a
  -- President may bring a new party into being; a non-President naming a
  -- party that does not exist yet would field a slate nobody presides over.
  if nullif(p_candidate_data->>'partyAffiliation', '') is not null then
    v_party_id := null;

    select id into v_party_id
    from public.parties
    where election_period_id = v_election_id
      and name = p_candidate_data->>'partyAffiliation'
    limit 1;

    if v_party_id is null then
      if p_candidate_data->>'position' <> 'President' then
        raise exception 'You can only create a new party by running for President. Join an existing party instead.';
      end if;

      -- Two Presidents can pick the same name at once; the loser adopts the
      -- winner's row rather than failing the whole application.
      begin
        insert into public.parties (name, election_period_id)
        values (p_candidate_data->>'partyAffiliation', v_election_id)
        returning id into v_party_id;
      exception when unique_violation then
        select id into v_party_id
        from public.parties
        where election_period_id = v_election_id
          and name = p_candidate_data->>'partyAffiliation'
        limit 1;
      end;
    else
      -- Joining an existing slate is only legitimate once that slate has an
      -- APPROVED PRESIDENT.  The Apply page already hides such parties from
      -- the picker, but the picker is a convenience, not a rule: without this
      -- check a crafted request could seat somebody under a party that nobody
      -- presides over, and 054's approval board has no President to drive it.
      -- A President applicant is exempt — running for President is how a slate
      -- gets one in the first place.
      if p_candidate_data->>'position' <> 'President'
         and not exists (
           select 1
           from public.candidates c
           where c.party_id = v_party_id
             and c.position = 'President'
             and c.status = 'approved'
         )
      then
        raise exception 'You can only join a party that already has an approved President.';
      end if;
    end if;

    -- president_student_id is deliberately NOT set here.  It mirrors the
    -- screening-approved President (see the backfill in Section 2 and
    -- 054), so claiming it at application time would publish a president
    -- the Screening Office has not accepted.
  end if;

  select first_name, last_name into v_student
  from public.students where id = v_student_id;

  insert into public.candidates (
    id, student_id, election_period_id, surname, given_name, middle_name,
    extension_name, grade_level, position, party_id, gender, date_of_birth,
    age, email, mobile_number, landline, home_address, parent_guardian_name,
    parent_guardian_contact, picture_url, doc_application_form,
    doc_introductory_profile, doc_eaf_front, doc_eaf_back,
    position_approval_status, leadership_profile, status, submitted_at
  ) values (
    v_new_id, v_student_id, v_election_id,
    p_candidate_data->>'surname', p_candidate_data->>'givenName',
    nullif(p_candidate_data->>'middleName', ''),
    nullif(p_candidate_data->>'extensionName', ''),
    p_candidate_data->>'gradeLevel', p_candidate_data->>'position',
    v_party_id, p_candidate_data->>'gender',
    (p_candidate_data->>'dateOfBirth')::date, (p_candidate_data->>'age')::int,
    p_candidate_data->>'email', p_candidate_data->>'mobileNumber',
    nullif(p_candidate_data->>'landline', ''),
    p_candidate_data->>'homeAddress',
    p_candidate_data->>'parentGuardianName',
    p_candidate_data->>'parentGuardianContact',
    p_picture_url, true, false, false, false,
    -- Derived, never taken from p_candidate_data.
    case
      when v_party_id is not null and p_candidate_data->>'position' <> 'President'
        then 'presidentApprovalRequired'
      else 'notRequired'
    end,
    (p_candidate_data->>'leadershipProfile')::jsonb,
    p_candidate_data->>'status', now()
  );

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    null,
    coalesce(v_student.first_name || ' ' || v_student.last_name, p_candidate_data->>'givenName'),
    'student',
    'EAF Generated',
    'Generated EAF for ' || (p_candidate_data->>'position') || ' — Ongoing Submission',
    'info'
  );

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where id = v_new_id;
  return v_result;
end;
$$;

-- Grant posture copied from 044/052/058: the custom session spine means the
-- platform role is ALWAYS anon, so anon gets EXECUTE and the real gate is
-- the in-body session/role check.
revoke all on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) to anon;

commit;
