-- Run this in Supabase Dashboard > SQL Editor
-- Replaces the Edge Function approach with server-side RPCs for candidacy

-- -------------------------------------------------------
-- 0. Ensure all doc_ columns exist on candidates table
--    (may be missing if initial schema was from an older version)
-- -------------------------------------------------------
alter table public.candidates
  add column if not exists doc_application_form boolean not null default false,
  add column if not exists doc_introductory_profile boolean not null default false,
  add column if not exists doc_screening_form boolean not null default false,
  add column if not exists doc_report_card boolean not null default false,
  add column if not exists doc_good_moral_cert boolean not null default false,
  add column if not exists doc_eaf_front boolean not null default false,
  add column if not exists doc_eaf_back boolean not null default false;

alter table public.candidates
  add column if not exists eaf_front_url text,
  add column if not exists eaf_back_url text;

-- Also ensure students table has student_id column for auth linking
alter table public.students
  add column if not exists password_hash text;

-- -------------------------------------------------------
-- 1. Increase file size limit for candidate-pictures bucket
--    (needed for EAF scans which can exceed 2 MB)
-- -------------------------------------------------------
update storage.buckets
set file_size_limit = 10485760
where id = 'candidate-pictures';

-- Allow authenticated students to read candidate-documents
-- (needed so they can view their uploaded EAF images)
drop policy if exists "candidate documents own read" on storage.objects;
create policy "candidate documents own read" on storage.objects
  for select
  using (
    bucket_id in ('candidate-documents', 'candidate-pictures')
    and auth.role() = 'authenticated'
  );

-- -------------------------------------------------------
-- 2. RPC: submit_candidacy_rpc
--    Handles: create (new application), update (upload EAF),
--             finalize (submit for review)
--    Note: auth.uid() may be null because app uses custom DB auth,
--          not Supabase Auth. Student ID is resolved from payload
--          or from the existing candidate record instead.
-- -------------------------------------------------------
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

    v_actor_id := v_existing.student_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (v_actor_id, coalesce(v_existing.given_name, 'Student'), 'student',
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

    v_actor_id := v_existing.student_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (v_actor_id, coalesce(v_existing.given_name, 'Student'), 'student',
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

  -- Resolve student_id from payload (studentId is always provided by frontend)
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

  -- Get current election period (candidacy can open before voting is active)
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
  end if;

  -- Get student info for audit log
  select first_name, last_name into v_student
  from public.students where id = v_student_id;

  -- Insert candidate record
  insert into public.candidates (
    id,
    student_id,
    election_period_id,
    surname,
    given_name,
    middle_name,
    extension_name,
    grade_level,
    position,
    party_id,
    gender,
    date_of_birth,
    age,
    email,
    mobile_number,
    landline,
    home_address,
    parent_guardian_name,
    parent_guardian_contact,
    picture_url,
    doc_application_form,
    doc_introductory_profile,
    doc_screening_form,
    doc_report_card,
    doc_good_moral_cert,
    doc_eaf_front,
    doc_eaf_back,
    position_approval_status,
    leadership_profile,
    status,
    submitted_at
  ) values (
    v_new_id,
    v_student_id,
    v_election_id,
    p_candidate_data->>'surname',
    p_candidate_data->>'givenName',
    nullif(p_candidate_data->>'middleName', ''),
    nullif(p_candidate_data->>'extensionName', ''),
    p_candidate_data->>'gradeLevel',
    p_candidate_data->>'position',
    v_party_id,
    p_candidate_data->>'gender',
    (p_candidate_data->>'dateOfBirth')::date,
    (p_candidate_data->>'age')::int,
    p_candidate_data->>'email',
    p_candidate_data->>'mobileNumber',
    nullif(p_candidate_data->>'landline', ''),
    p_candidate_data->>'homeAddress',
    nullif(p_candidate_data->>'parentGuardianName', ''),
    nullif(p_candidate_data->>'parentGuardianContact', ''),
    p_picture_url,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    coalesce(nullif(p_candidate_data->>'positionApprovalStatus', ''), 'notRequired'),
    (p_candidate_data->>'leadershipProfile')::jsonb,
    p_candidate_data->>'status',
    now()
  );

  -- Audit log
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_student_id,
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

-- -------------------------------------------------------
-- 3. RPC: review_candidacy_rpc
--    Approve or reject a pending candidacy (admin only)
-- -------------------------------------------------------
create or replace function public.review_candidacy_rpc(
  p_candidate_id uuid,
  p_action text,
  p_rejection_reason text default null,
  p_rejection_details text default null,
  p_rejection_tier text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate record;
  v_actor_id uuid;
  v_actor_name text;
  v_new_status text;
  v_student_name text;
  v_result jsonb;
begin
  -- Determine the actor: use p_actor_id if provided, fallback to auth.uid()
  v_actor_id := coalesce(p_actor_id, auth.uid());

  -- Verify requester is admin
  if not exists (select 1 from public.profiles where id = v_actor_id and role = 'admin') then
    raise exception 'Only admins can review candidacy applications.';
  end if;

  select full_name into v_actor_name
  from public.profiles
  where id = v_actor_id;

  v_actor_name := coalesce(v_actor_name, 'Administrator');

  if p_action not in ('approve', 'reject') then
    raise exception 'Action must be approve or reject.';
  end if;

  -- Rejection requires reason and tier
  if p_action = 'reject' and p_rejection_reason is null then
    raise exception 'A rejection reason is required.';
  end if;
  if p_action = 'reject' and p_rejection_tier is null then
    raise exception 'A rejection tier (low/high) is required.';
  end if;
  if p_action = 'reject' and p_rejection_tier not in ('low', 'high') then
    raise exception 'Rejection tier must be low or high.';
  end if;

  select c.*, s.first_name, s.last_name into v_candidate
  from public.candidates c
  left join public.students s on s.id = c.student_id
  where c.id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found.';
  end if;

  if v_candidate.status != 'pending' then
    raise exception 'Cannot % a candidate with status ''%''.', p_action, v_candidate.status;
  end if;

  v_new_status := case when p_action = 'approve' then 'approved' else 'rejected' end;

  update public.candidates
  set status = v_new_status,
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      rejection_reason = case when p_action = 'reject' then p_rejection_reason else null end,
      rejection_details = case when p_action = 'reject' then p_rejection_details else null end,
      rejection_tier = case when p_action = 'reject' then p_rejection_tier else 'low' end
  where id = p_candidate_id;

  v_student_name := coalesce(
    v_candidate.first_name || ' ' || v_candidate.last_name,
    v_candidate.given_name || ' ' || v_candidate.surname
  );

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor_id,
    v_actor_name,
    'admin',
    case when p_action = 'approve' then 'Approved Candidacy' else 'Rejected Candidacy' end,
    case when p_action = 'approve'
      then 'Approved candidacy of ' || v_student_name || ' for ' || v_candidate.position
      else 'Rejected candidacy of ' || v_student_name || ' for ' || v_candidate.position || '. Reason: ' || coalesce(p_rejection_reason, 'N/A') || '. Details: ' || coalesce(p_rejection_details, 'N/A') || '. Tier: ' || coalesce(p_rejection_tier, 'N/A')
    end,
    case when p_action = 'approve' then 'success' else 'warning' end
  );

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where c.id = p_candidate_id;
  return v_result;
end;
$$;

-- -------------------------------------------------------
-- 4. CHECK constraint: grade_level must match position
--    for grade-level representative positions
-- -------------------------------------------------------
alter table public.candidates
  drop constraint if exists candidates_grade_position_match;
alter table public.candidates
  add constraint candidates_grade_position_match
  check (
    position not like '%Representative'
    or grade_level = replace(position, ' Representative', '')
  );
