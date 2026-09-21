-- =============================================================
-- Run this in Supabase Dashboard > SQL Editor (after 016)
-- 1. Ensures parties.president_student_id exists even when the
--    parties table was created by an older schema version that
--    lacked it (001 only declares it inside create-table-if-not-exists,
--    which skips pre-existing tables).
-- 2. Patches submit_candidacy_rpc so that when a candidate applies
--    for President of a party (new or existing), the party's
--    president_student_id is linked to that student. This makes
--    request_party_membership_rpc able to notify the party
--    president of membership requests.
-- Idempotent: safe to re-run.
-- =============================================================

alter table public.parties
  add column if not exists president_student_id uuid references public.students(id);

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
set search_path = public
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
  -- FINALIZE: mark candidate as pending after EAF upload
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

    if v_existing.doc_eaf_front = false or v_existing.doc_eaf_back = false then
      raise exception 'EAF front and back photos must be uploaded before final submission.';
    end if;

    update public.candidates
    set status = 'pending',
        doc_introductory_profile = true,
        doc_screening_form = true,
        doc_report_card = true,
        doc_good_moral_cert = true
    where id = p_candidate_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (null, coalesce(v_existing.given_name, 'Student'), 'student',
            'Candidacy Application',
            'Submitted completed EAF — Pending officer review', 'info');

    select row_to_json(c)::jsonb into v_result
    from public.candidates c where c.id = p_candidate_id;
    return v_result;
  end if;

  -- UPDATE: store image URLs for existing candidate
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
    from public.candidates c where c.id = p_candidate_id;
    return v_result;
  end if;

  -- CREATE: new candidacy application
  if p_action != 'create' then
    raise exception 'Action must be create, update, or finalize.';
  end if;

  if p_candidate_data is null then
    raise exception 'Candidate data is required for creation.';
  end if;

  -- Resolve student_id from payload
  v_student_id := nullif(p_candidate_data->>'studentId', '')::uuid;

  if v_student_id is null then
    raise exception 'Student ID is required in candidate data.';
  end if;

  -- Block resubmission if student has a high-tier rejected candidacy
  if exists (
    select 1 from public.candidates
    where student_id = v_student_id
      and election_period_id = (select id from public.election_periods order by updated_at desc limit 1)
      and rejection_tier = 'high'
  ) then
    raise exception 'You are disqualified from running in this election period due to: high-tier rejection. Please contact the Commissioner of Grievance.';
  end if;

  -- Validate required fields
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

  -- Enforce grade-level-to-position match for representative positions
  if (p_candidate_data->>'position') like '%Representative'
     and (p_candidate_data->>'position') <> ((p_candidate_data->>'gradeLevel') || ' Representative') then
    raise exception 'Grade-level mismatch: % students can only apply for % Representative.', p_candidate_data->>'gradeLevel', p_candidate_data->>'gradeLevel';
  end if;

  v_new_id := gen_random_uuid();

  -- Get current election period
  select id into v_election_id
  from public.election_periods
  order by updated_at desc
  limit 1;

  if v_election_id is null then
    raise exception 'No election period configured. Ask an administrator to set one up.';
  end if;

  -- Upsert party if affiliation provided
  if nullif(p_candidate_data->>'partyAffiliation', '') is not null then
    insert into public.parties (name)
    values (p_candidate_data->>'partyAffiliation')
    on conflict (name) do update set name = excluded.name
    returning id into v_party_id;

    -- If applying as President, link the party to this student so membership
    -- requests can be routed to them for approval.
    if p_candidate_data->>'position' = 'President' then
      update public.parties
      set president_student_id = v_student_id
      where id = v_party_id;
    end if;
  end if;

  -- Get student info for audit log
  select first_name, last_name into v_student
  from public.students where id = v_student_id;

  -- Insert candidate record
  insert into public.candidates (
    id, student_id, election_period_id, surname, given_name, middle_name,
    extension_name, grade_level, position, party_id, gender, date_of_birth,
    age, email, mobile_number, landline, home_address, parent_guardian_name,
    parent_guardian_contact, picture_url, doc_application_form,
    doc_introductory_profile, doc_screening_form, doc_report_card,
    doc_good_moral_cert, doc_eaf_front, doc_eaf_back,
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
    nullif(p_candidate_data->>'parentGuardianName', ''),
    nullif(p_candidate_data->>'parentGuardianContact', ''),
    p_picture_url, true, false, false, false, false, false, false,
    coalesce(nullif(p_candidate_data->>'positionApprovalStatus', ''), 'notRequired'),
    (p_candidate_data->>'leadershipProfile')::jsonb,
    p_candidate_data->>'status', now()
  );

  -- Audit log (actor_id is null because students are not in public.profiles)
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
  from public.candidates c where c.id = v_new_id;
  return v_result;
end;
$$;
