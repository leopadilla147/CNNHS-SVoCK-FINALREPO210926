-- =============================================================
-- seed-demo.sql — LOCAL DEMO DATA ONLY
-- =============================================================
-- Runs via [db.seed] in supabase/config.toml on:
--   * first `supabase start`
--   * every `supabase db reset`
-- NEVER on `supabase db push` (HYGI-02 / D-07).
--
-- Demo data previously embedded in migrations 001/007/016 was
-- consolidated here so a fresh db reset reproduces the working
-- patched-DB demo experience while the production migration chain
-- itself stays seed-free (021 neutralizes the legacy generators).
--
-- Safety contract (D-08):
--   * Functional bootstrap rows (chief admin, election_periods,
--     report_templates) live in migration 020, NOT here.
--   * This file NEVER updates existing rows via ON CONFLICT and NEVER
--     resets a password on re-run. All upserts are plain inserts or
--     `on conflict do nothing`.
--   * Demo hashes below are SHA-256 digests / bcrypt hashes of the
--     KNOWN demo passwords (student123, screening123, ...). These are
--     local-development credentials only. The Phase-2 bcrypt login
--     transition will re-hash SHA-256 student passwords at first
--     login, and the Plan 04 runbook instructs rotating all demo
--     credentials after first local login.
-- =============================================================

-- =============================================================
-- BLOCK 1: Dummy students, masterlist, parties, candidacy slates
-- (relocated from 016_seed_dummy_parties.sql, generation-loop
--  pattern preserved; row-updating ON CONFLICT clauses removed)
-- =============================================================
do $$
declare
  v_election_id  uuid;
  v_party_id     uuid;
  v_student_id   uuid;
  v_master_id    uuid;
  v_president    uuid[3];

  v_given        text;
  v_surname      text;
  v_middle       text := null;
  v_position     text;
  v_grade        text;
  v_grade_num    integer;
  v_gender       text;
  v_birthdate    date;
  v_age          integer;
  v_lrn          text;
  v_email        text;
  v_mobile       text;
  v_address      text;
  v_picture      text;

  party_names    text[] := array['Alyansa ng Kabataan', 'Bagong Sibol', 'Sulong Bayanihan'];
  party_desc     text[] := array[
    'Ang bagong henerasyon ng mga mag-aaral na nagkakaisa para sa serbisyong tapat at progresibo.',
    'Mga binibini at binatang may panibagong pag-asa para sa mas makabuluhang pamamahala ng SSLG.',
    'Sama-samang pagkilos para sa bayanihan, transparensiya, at kapakanan ng bawat estudyante.'
  ];

  positions      text[] := array[
    'President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor',
    'PRO', 'PIO', 'Protocol Officer',
    'Grade 7 Representative', 'Grade 8 Representative', 'Grade 9 Representative',
    'Grade 10 Representative', 'Grade 11 Representative', 'Grade 12 Representative'
  ];

  grades         text[] := array[
    'Grade 11', 'Grade 10', 'Grade 10', 'Grade 9', 'Grade 9',
    'Grade 12', 'Grade 12', 'Grade 11',
    'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'
  ];

  given_names    text[][] := array[
    array['Juan Miguel','Maria Clara','Angela','Paolo','Kristine','Rafael','Hannah','Marco','Ela Mae','Joshua','Nicole','Gabriel','Beatrice','Adrian'],
    array['Miguel Alfonso','Sofia Camille','John Carlo','Angelica Mae','Christian Jay','Kyla Ysabel','Daniel Vincent','Jasmine','Vincent Enzo','Alexa Faith','Renz Adrian','Chloe Ann','Angelo Miguel','Kate Loren'],
    array['Marcus Gabriel','Angel Faith','Sean Patrick','Patricia Anne','Kyle Benedict','Ysabel Lorraine','Nathan James','Rica Mae','Lorenz Mark','Gwen Ashley','Jericho Paulo','Elyza Shane','Aldrin James','Danielle Marie']
  ];

  surnames       text[][] := array[
    array['Dela Cruz','Santos','Reyes','Garcia','Mendoza','Bautista','Villanueva','Flores','Torres','Ramos','Aquino','Castillo','Domingo','Navarro'],
    array['Cruz','Rivera','Lim','Suarez','Morales','Ocampo','Salazar','Tadeo','Palacio','Estrada','Salcedo','Macalindong','Villaraza','Villamor'],
    array['Adolfo','Carillo','Gonzales','Duran','Mercado','Aguirre','Custodio','Valdez','De Guzman','Rosales','Samson','Bermejo','Ledesma','Pascual']
  ];

  p              integer;
  i              integer;
begin

  -- Resolve the bootstrap election period created by migration 020.
  -- (No insert here — functional bootstrap rows live in 020.)
  select id into v_election_id
  from public.election_periods
  where school_year = '2026-2027'
  order by start_at desc nulls last
  limit 1;

  if v_election_id is null then
    -- 020 ran before this seed on every db reset; a null here means the
    -- chain is incomplete. Fail loudly instead of silently seeding
    -- orphan candidates.
    raise exception 'seed-demo.sql: election period 2026-2027 not found — run the full migration chain (020) before seeding.';
  end if;

  for p in 1..array_length(party_names, 1) loop

    insert into public.parties (name, description)
    values (party_names[p], party_desc[p])
    on conflict (name) do nothing;

    select id into v_party_id
    from public.parties
    where name = party_names[p];

    for i in 1..array_length(positions, 1) loop

      v_given    := given_names[p][i];
      v_surname  := surnames[p][i];
      v_position := positions[i];
      v_grade    := grades[i];
      v_grade_num:= cast(substr(v_grade, 7) as integer);
      v_gender   := case when i % 2 = 0 then 'Female' else 'Male' end;
      v_birthdate:= make_date(2020 - v_grade_num, 6, 15);
      v_age      := 2026 - (2020 - v_grade_num);
      v_lrn      := '136400' || p || lpad(i::text, 2, '0') || '000';
      v_email    := lower(v_surname) || '.' || replace(lower(v_given), ' ', '') || p || '@cnnhs.edu';
      v_mobile   := '+63 9' || lpad(((p - 1) * 14 + i)::text, 2, '0') || ' 555 0100';
      v_address  := 'Zone ' || ((i % 5) + 1) || ', Brgy. Camambugan, Daet, Camarines Norte';
      v_picture  := 'https://ui-avatars.com/api/?name=' || replace(v_given || ' ' || v_surname, ' ', '+')
                    || '&background=5C0102&color=ffffff&bold=true';

      -- Masterlist entry (matching, enrolled -> would auto-approve in normal flow)
      insert into public.student_masterlist
        (lrn, first_name, last_name, birthdate, grade_level, gender, school_year, enrollment_status)
      values
        (v_lrn, split_part(v_given, ' ', 1), v_surname, v_birthdate, v_grade, v_gender, '2026-2027', 'enrolled')
      on conflict (lrn, school_year) do nothing;

      select id into v_master_id
      from public.student_masterlist
      where lrn = v_lrn and school_year = '2026-2027';

      -- Student account (login-capable, password: student123)
      -- SHA-256 digest encoding — demo hash, re-hashed at first login
      -- by the Phase-2 bcrypt transition.
      insert into public.students
        (student_id, masterlist_id, first_name, middle_name, last_name, grade_level, gender,
         birthdate, lrn, email, password_hash, status, verification_status, mismatch_count)
      values
        (null, v_master_id, split_part(v_given, ' ', 1), v_middle, v_surname, v_grade, v_gender,
         v_birthdate, v_lrn, v_email, encode(digest('student123', 'sha256'), 'hex'),
         'approved', 'autoApproved', 0)
      on conflict (lrn) do nothing;

      select id into v_student_id
      from public.students
      where lrn = v_lrn;

      -- Candidacy record (full slate, one candidate per party per position)
      insert into public.candidates
        (student_id, election_period_id, surname, given_name, middle_name, extension_name,
         grade_level, position, party_id, gender, date_of_birth, age, email, mobile_number,
         landline, home_address, parent_guardian_name, parent_guardian_contact, picture_url,
         leadership_profile, doc_application_form, doc_introductory_profile, doc_screening_form,
         doc_report_card, doc_good_moral_cert, doc_eaf_front, doc_eaf_back, status, submitted_at)
      values
        (v_student_id, v_election_id, v_surname, v_given, v_middle, null,
         v_grade, v_position, v_party_id, v_gender, v_birthdate, v_age, v_email, v_mobile,
         null, v_address, 'Mr./Ms. ' || v_surname, '+63 9' || lpad(((p - 1) * 14 + i)::text, 2, '0') || ' 555 0100', v_picture,
         jsonb_build_object(
           'qualities', 'Responsible, approachable, and committed to student welfare.',
           'skills', jsonb_build_array('Leadership', 'Communication', 'Teamwork'),
           'skillsExplanation', 'Proven ability to lead initiatives and collaborate with fellow students.',
           'threeYearVision', 'A campus where every learner is heard, supported, and empowered.',
           'makaDiyosProject', 'Values formation and spiritual growth program',
           'makaDiyosDescription', 'Weekly reflection and values seminars for all grade levels.',
           'makaTaoProject', 'Student welfare and peer support initiatives',
           'makaTaoDescription', 'Peer tutoring and mental health awareness campaigns.',
           'makakalikasanProject', 'Campus greening and waste segregation drive',
           'makakalikasanDescription', 'Zero-waste classrooms and tree planting activities.',
           'makabansaProject', 'Awareness campaigns on national values and civic duty',
           'makabansaDescription', 'Flag-raising programs and civic engagement activities.'
         ),
         true, true, true, true, true, true, true,
         'approved', now())
      on conflict (student_id, election_period_id) do nothing;

      if i = 1 then
        v_president[p] := v_student_id;
      end if;

    end loop;
  end loop;

  -- Link each party's president to the President candidate's student account.
  for p in 1..array_length(party_names, 1) loop
    update public.parties
    set president_student_id = v_president[p]
    where name = party_names[p];
  end loop;

end $$;

-- =============================================================
-- BLOCK 2: SSLG officer demo rows
-- (relocated from 001_initial_schema.sql L750-771; the row-updating
--  ON CONFLICT on (email) converted to `do nothing`)
-- =============================================================
insert into public.officers (name, email, position, grade_level, term_start, term_end, status)
values
  ('Student President', 'president@cnnhs.edu', 'President', null, '2026-04-01', '2027-03-31', 'active'),
  ('Student Vice President', 'vice.president@cnnhs.edu', 'Vice President', null, '2026-04-01', '2027-03-31', 'active'),
  ('Student Secretary', 'secretary@cnnhs.edu', 'Secretary', null, '2026-04-01', '2027-03-31', 'active'),
  ('Student Treasurer', 'treasurer@cnnhs.edu', 'Treasurer', null, '2026-04-01', '2027-03-31', 'active'),
  ('Student Auditor', 'auditor@cnnhs.edu', 'Auditor', null, '2026-04-01', '2027-03-31', 'active'),
  ('Student PIO', 'pio@cnnhs.edu', 'Public Information Officer', null, '2026-04-01', '2027-03-31', 'active'),
  ('Student Protocol Officer', 'protocol@cnnhs.edu', 'Protocol Officer', null, '2026-04-01', '2027-03-31', 'active'),
  ('Grade 7 Representative', 'grade7.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 7', '2026-04-01', '2027-03-31', 'active'),
  ('Grade 8 Representative', 'grade8.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 8', '2026-04-01', '2027-03-31', 'active'),
  ('Grade 9 Representative', 'grade9.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 9', '2026-04-01', '2027-03-31', 'active'),
  ('Grade 10 Representative', 'grade10.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 10', '2026-04-01', '2027-03-31', 'active'),
  ('Grade 11 Representative', 'grade11.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 11', '2026-04-01', '2027-03-31', 'active'),
  ('Grade 12 Representative', 'grade12.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 12', '2026-04-01', '2027-03-31', 'active')
on conflict (email) do nothing;

-- =============================================================
-- BLOCK 3: Commissioner + SSLG Adviser demo accounts
-- (relocated from 007_seed_accounts.sql; the row-updating ON CONFLICT
--  clauses on profiles/commissioners/sslg_advisers converted to
--  `do nothing`)
-- =============================================================
do $$
declare
  screening_id uuid := '22222222-2222-4222-8222-222222222222';
  electoral_id uuid := '33333333-3333-4333-8333-333333333333';
  appointment_id uuid := '44444444-4444-4444-8444-444444444444';
  grievance_id uuid := '55555555-5555-4555-8555-555555555555';
  sslg_id uuid := '66666666-6666-4666-8666-666666666666';
begin

  -- =========================================================
  -- Commissioner of Screening & Validation
  -- =========================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    screening_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'screening.commissioner@cnnhs.edu',
    crypt('screening123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin","commissioner_role":"screening_validation","full_name":"Commissioner of Screening & Validation"}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  perform public.auth_identities_sync('email', 'screening.commissioner@cnnhs.edu', screening_id, jsonb_build_object('sub', screening_id::text, 'email', 'screening.commissioner@cnnhs.edu'));

  insert into public.profiles (id, role, commissioner_role, full_name)
  values (screening_id, 'admin', 'screening_validation', 'Commissioner of Screening & Validation')
  on conflict (id) do nothing;

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (screening_id, 'Commissioner of Screening & Validation', 'screening.commissioner@cnnhs.edu', 'screening_validation', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do nothing;

  -- =========================================================
  -- Commissioner of Electoral Board
  -- =========================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    electoral_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'electoral.commissioner@cnnhs.edu',
    crypt('electoral123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin","commissioner_role":"electoral_board","full_name":"Commissioner of Electoral Board"}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  perform public.auth_identities_sync('email', 'electoral.commissioner@cnnhs.edu', electoral_id, jsonb_build_object('sub', electoral_id::text, 'email', 'electoral.commissioner@cnnhs.edu'));

  insert into public.profiles (id, role, commissioner_role, full_name)
  values (electoral_id, 'admin', 'electoral_board', 'Commissioner of Electoral Board')
  on conflict (id) do nothing;

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (electoral_id, 'Commissioner of Electoral Board', 'electoral.commissioner@cnnhs.edu', 'electoral_board', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do nothing;

  -- =========================================================
  -- Commissioner of Appointment
  -- =========================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    appointment_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'appointment.commissioner@cnnhs.edu',
    crypt('appointment123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin","commissioner_role":"appointment","full_name":"Commissioner of Appointment"}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  perform public.auth_identities_sync('email', 'appointment.commissioner@cnnhs.edu', appointment_id, jsonb_build_object('sub', appointment_id::text, 'email', 'appointment.commissioner@cnnhs.edu'));

  insert into public.profiles (id, role, commissioner_role, full_name)
  values (appointment_id, 'admin', 'appointment', 'Commissioner of Appointment')
  on conflict (id) do nothing;

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (appointment_id, 'Commissioner of Appointment', 'appointment.commissioner@cnnhs.edu', 'appointment', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do nothing;

  -- =========================================================
  -- Commissioner of Grievance
  -- =========================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    grievance_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'grievance.commissioner@cnnhs.edu',
    crypt('grievance123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin","commissioner_role":"grievance","full_name":"Commissioner of Grievance"}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  perform public.auth_identities_sync('email', 'grievance.commissioner@cnnhs.edu', grievance_id, jsonb_build_object('sub', grievance_id::text, 'email', 'grievance.commissioner@cnnhs.edu'));

  insert into public.profiles (id, role, commissioner_role, full_name)
  values (grievance_id, 'admin', 'grievance', 'Commissioner of Grievance')
  on conflict (id) do nothing;

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (grievance_id, 'Commissioner of Grievance', 'grievance.commissioner@cnnhs.edu', 'grievance', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do nothing;

  -- =========================================================
  -- SSLG Adviser
  -- =========================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    sslg_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sslg.adviser@cnnhs.edu',
    crypt('sslg123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"sslg_adviser","full_name":"SSLG Adviser"}'::jsonb,
    now(), now()
  ) on conflict (id) do nothing;

  perform public.auth_identities_sync('email', 'sslg.adviser@cnnhs.edu', sslg_id, jsonb_build_object('sub', sslg_id::text, 'email', 'sslg.adviser@cnnhs.edu'));

  insert into public.profiles (id, role, full_name)
  values (sslg_id, 'sslg_adviser', 'SSLG Adviser')
  on conflict (id) do nothing;

  insert into public.sslg_advisers (auth_id, name, email, status, created_by)
  values (sslg_id, 'SSLG Adviser', 'sslg.adviser@cnnhs.edu', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (email) do nothing;

end $$;