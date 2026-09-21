-- =====================================================================
-- 044_submit_candidacy_session_actor.sql
-- Fix "permission denied for function submit_candidacy_rpc" (HTTP 401 on
-- POST /rest/v1/rpc/submit_candidacy_rpc) and re-ground the candidacy RPC
-- identity in the session spine.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY (three compounding blockers on the student "Generate Printable EAF"
--      / apply-for-candidacy flow)
--   1. GRANT — 020 granted EXECUTE on submit_candidacy_rpc to
--      `authenticated` ONLY and revoked it from anon, on the assumption
--      that "once sessions land, only signed-in callers reach this
--      function".  The sessions that landed are the CUSTOM session spine
--      (022), under which the platform role is ALWAYS anon (the request
--      keeps the platform anon JWT; the app session rides the
--      x-session-token header).  So the call fails at the grant layer:
--         permission denied for function public.submit_candidacy_rpc
--   2. GUARD — the 020 body's entry guard is
--         if auth.uid() is null then raise 'Authentication required …'
--      auth.uid() is ALWAYS NULL under the custom spine (no Supabase Auth
--      JWT), so even with a grant every student would be rejected.
--   3. IDENTITY (the spoofing vector 020's own comment admits) — the
--      CREATE path resolves the student from the PAYLOAD
--      (p_candidate_data->>'studentId'), and update/finalize never check
--      ownership: "an anonymous client holding the anon key could
--      previously file, update or finalize candidacies for ANY student".
--
-- WHAT
--   Re-creates ONLY public.submit_candidacy_rpc(text, jsonb, uuid, text,
--   text, text) — SIGNATURE UNCHANGED, so the client call
--   (supabaseData.submitCandidacyRpc) needs no change — with:
--     * the actor derived EXCLUSIVELY from the session spine
--       (current_session_user_id()), and the entry gate requires
--       current_app_role() = 'student' (only students apply);
--     * CREATE keys the candidate to the SESSION actor, ignoring the
--       payload's studentId (AUTH-05, mirroring 036's review rewrites);
--     * UPDATE / FINALIZE restricted to the session actor's OWN candidate
--       row (closes the any-student forgery vector);
--     * the 017 party-president link and every field validation preserved
--       verbatim;
--     * EXECUTE granted to anon (the posture 036 already established for
--       review_student_rpc / the login RPCs): the session check inside
--       the body is the real gate, not the transport role.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

drop function if exists public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text);

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
  -- SECURITY: the actor derives ONLY from the session spine.  A caller
  -- with no (or a dead) session token resolves anon and is refused; a
  -- student session is required because only students apply for candidacy.
  v_actor_id := public.current_session_user_id();
  if v_actor_id is null then
    raise exception 'Authentication required — candidacy actions must come from a signed-in user.';
  end if;
  if public.current_app_role() != 'student' then
    raise exception 'Only students can manage candidacy applications.';
  end if;
  v_student_id := v_actor_id;

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

    -- Ownership: a student may finalize ONLY their own application.
    if v_existing.student_id is distinct from v_student_id then
      raise exception 'You can only manage your own candidacy application.';
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

    -- Ownership: a student may upload EAF images ONLY to their own
    -- application.
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

  -- AUTH-05: the student key comes from the SESSION, never the payload —
  -- the p_candidate_data->>'studentId' value is not trusted (020-era
  -- spoofing vector: an anon caller could file candidacy for ANY student).

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
    -- requests can be routed to them for approval (017 behavior preserved).
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

-- ---------------------------------------------------------------------
-- Grants: anon-executable (the 036 posture).  The real gate is the
-- session check inside the body; revoking from anon is what broke the
-- student flow.  authenticated is revoked to keep the surface unambiguous.
-- ---------------------------------------------------------------------
revoke all on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) to anon;