-- 020_fix_storage_and_audit.sql
-- Additive fold-in of the out-of-band fix_storage_and_audit.sql patch
-- state (repo root) + functional bootstrap rows (option-a decision).
--
-- Folded FIX content is verbatim-compatible with the patch file so it
-- is safe to re-run (F-02) against both a patched hosted DB and a
-- fresh db-reset chain.  Bootstrap guard rows are ON CONFLICT DO
-- NOTHING only — no password resets, no row updates.
--
-- Functional bootstrap (option-a, per 01-02 decision):
--   chief admin auth.users/identities/profiles/commissioners
--   election_periods '2026-2027'
--   report_templates (16 enclosures)

-- ================================================================
-- FIX 1: Storage upload RLS — allow writes without Supabase Auth
--         session (direct-DB auth flow)
-- ================================================================
drop policy if exists "candidate pictures public write" on storage.objects;
create policy "candidate pictures public write" on storage.objects
  for insert
  with check (bucket_id = 'candidate-pictures');

drop policy if exists "candidate pictures authenticated write" on storage.objects;

drop policy if exists "candidate documents own read" on storage.objects;
create policy "candidate documents own read" on storage.objects
  for select
  using (bucket_id in ('candidate-documents', 'candidate-pictures'));

drop policy if exists "private election docs upload" on storage.objects;
create policy "private election docs upload" on storage.objects
  for insert
  with check (bucket_id in ('candidate-documents', 'nomination-documents'));

-- ================================================================
-- FIX 2: insert_audit_log_rpc — handle invalid roles &
--         missing profiles (students are not in public.profiles)
-- ================================================================
create or replace function public.insert_audit_log_rpc(
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default 'system',
  p_action text default null,
  p_details text default null,
  p_type text default 'info'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_role text;
begin
  v_actor_id := auth.uid();
  -- Actor identity comes ONLY from the PostgREST session (auth.uid()).
  -- p_actor_id is no longer trusted — it was client-supplied and let an
  -- anonymous caller forge audit rows for any actor.  With EXECUTE
  -- revoked from anon (see the grants below) this function only runs for
  -- authenticated sessions; auth.uid() is NULL only when it is invoked
  -- without a session (e.g. the local pgTAP runner).
  -- Only use actor_id if it exists in profiles (students are not in profiles)
  if v_actor_id is not null and not exists (select 1 from public.profiles where id = v_actor_id) then
    v_actor_id := null;
  end if;
  v_actor_name := coalesce(p_actor_name, 'System');
  v_role := lower(p_actor_role);
  if v_role not in ('admin', 'officer', 'student', 'system') then
    v_role := 'system';
  end if;
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (v_actor_id, v_actor_name, v_role, p_action, p_details, p_type);
end;
$$;

-- SECURITY (CR-02): the chain ships no REVOKE/GRANT anywhere, so these
-- SECURITY DEFINER functions were PUBLIC-executable by default — any
-- client holding the anon key could call them.  Revoke EXECUTE from
-- PUBLIC/anon and re-grant it to authenticated sessions only.  The
-- direct-DB login flow has no PostgREST session yet (Phase 2 auth-session
-- work, RESEARCH-03); until then this RPC refuses anonymous callers
-- instead of accepting a client-chosen actor identity.
revoke all on function public.insert_audit_log_rpc(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.insert_audit_log_rpc(uuid, text, text, text, text, text) to authenticated;

-- ================================================================
-- FIX 3: submit_candidacy_rpc — use null actor_id for student
--         audit logs (students are in public.students, not
--         public.profiles)
-- ================================================================
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
  -- SECURITY (CR-02): this SECURITY DEFINER function mutates candidacy
  -- rows, so it must never run for an unauthenticated caller.  EXECUTE is
  -- revoked from anon/PUBLIC below (authenticated sessions only); this
  -- guard is defense-in-depth for any direct-SQL invocation path and
  -- makes the "authenticated caller" requirement visible in the body.
  if auth.uid() is null then
    raise exception 'Authentication required — candidacy actions must come from a signed-in user.';
  end if;

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

    -- Students are not in public.profiles, so actor_id must be null
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

    -- Students are not in public.profiles, so actor_id must be null
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

-- SECURITY (CR-02): revoke the default PUBLIC/anon EXECUTE on the
-- candidacy RPC and re-grant it to authenticated sessions only.  An
-- anonymous client holding the anon key could previously file, update or
-- finalize candidacies for ANY student (studentId / p_candidate_id come
-- from the payload).  The direct-DB login flow has no PostgREST session
-- yet (Phase 2 auth-session work); once sessions land, only signed-in
-- callers reach this function and the auth.uid() guard above gates entry.
revoke all on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) to authenticated;

-- ================================================================
-- OPTION-A BOOTSTRAP: functional guard rows (DO NOTHING only).
--
-- After a full chain run (001-021), these rows already exist from
-- 001 and 007.  These inserts are zero-cost no-ops for that path.
-- On a host where only 020+021 are applied (db push on a DB
-- missing the chief/templates), they create the essential guard
-- rows the app requires to boot without seed data.
-- ================================================================

create extension if not exists pgcrypto;

do $$
declare
  chief_id uuid := '11111111-1111-4111-8111-111111111111';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    chief_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'chief.commissioner@cnnhs.edu',
    crypt('chief123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin","commissioner_role":"chief","full_name":"Chief Commissioner"}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do nothing;

  perform public.auth_identities_sync('email', 'chief.commissioner@cnnhs.edu', chief_id, jsonb_build_object('sub', chief_id::text, 'email', 'chief.commissioner@cnnhs.edu'));

  insert into public.profiles (id, role, commissioner_role, full_name)
  values (chief_id, 'admin', 'chief', 'Chief Commissioner')
  on conflict (id) do nothing;

  insert into public.commissioners (auth_id, name, email, commissioner_role, status)
  values (chief_id, 'Chief Commissioner', 'chief.commissioner@cnnhs.edu', 'chief', 'active')
  on conflict (commissioner_role) do nothing;
end $$;

-- Election period — functional guard row for the candidate/application flow.
--
-- Idempotency (WR-01): a bare `on conflict do nothing` NEVER fired here —
-- election_periods had no unique constraint on school_year (001 only adds
-- the partial one_active_election index on is_active = true), so a second
-- '2026-2027' row was silently stacked on every re-apply (and on a fresh
-- chain, 001 seeds the same row).  Two rows tie syncElectionPeriod's
-- .order("start_at").limit(1) and break election settings.  Fix:
--   1. heal any pre-existing duplicate school_year rows first (keep the
--      earliest-updated row, tie-break by smallest id) so the index can
--      be created on already-applied databases;
--   2. add a real unique index on school_year;
--   3. make the conflict target explicit: on conflict (school_year).
delete from public.election_periods a
 using public.election_periods b
 where a.school_year = b.school_year
   and (a.updated_at > b.updated_at
        or (a.updated_at = b.updated_at and a.id > b.id));

create unique index if not exists election_periods_school_year_key
  on public.election_periods (school_year);

insert into public.election_periods (school_year, candidacy_open, nomination_open, is_active, results_published, venue)
values ('2026-2027', false, false, false, false, 'CNNHS IoT Biometric Kiosk Precinct')
on conflict (school_year) do nothing;

-- Report templates — functional guard rows for the Chief dashboard.
-- (16 enclosures; ON CONFLICT (enclosure) DO NOTHING keeps it idempotent.)
insert into public.report_templates (enclosure, title, owner_role, category)
values
  ('6', 'Certificate of Candidacy / Election Application Form Tracking', 'screening_validation', 'candidacy'),
  ('7.2', 'Screening and Validation Summary', 'screening_validation', 'candidacy'),
  ('8.1', 'Official List of Candidates', 'appointment', 'forms'),
  ('8.2', 'Notice to Candidates / Party Approval Record', 'appointment', 'forms'),
  ('9', 'Campaign and Election Calendar', 'electoral_board', 'forms'),
  ('11', 'Nomination Form', 'appointment', 'appointment'),
  ('12', 'Nominee Reply Slip', 'appointment', 'appointment'),
  ('13', 'Appointment Recommendation', 'appointment', 'appointment'),
  ('14', 'Complaint Form', 'grievance', 'grievance'),
  ('15', 'Fact-Finding Report', 'grievance', 'grievance'),
  ('16', 'Initial Decision for Chief Approval', 'grievance', 'grievance'),
  ('17', 'Resolution and Sanction Notice', 'grievance', 'grievance'),
  ('18', 'Election Returns', 'electoral_board', 'results'),
  ('19', 'Statement of Votes', 'electoral_board', 'results'),
  ('20', 'Proclamation Report', 'chief', 'results'),
  ('21', 'System Audit Trail Report', 'chief', 'audit')
on conflict (enclosure) do nothing;