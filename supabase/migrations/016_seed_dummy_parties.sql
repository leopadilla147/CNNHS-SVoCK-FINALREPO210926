-- =============================================================
-- Seed 3 dummy parties with full slates (President -> Grade 12 Representative)
-- Each candidate is backed by a real, login-capable student account.
-- All dummy students share the password: student123
-- Idempotent: upserts keyed on natural keys, safe to re-run.
-- Run after 001_initial_schema.sql via the Supabase SQL Editor.
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

  -- Resolve the active seeded election period, create one if missing.
  select id into v_election_id
  from public.election_periods
  where school_year = '2026-2027'
  order by start_at desc nulls last
  limit 1;

  if v_election_id is null then
    insert into public.election_periods (school_year, venue)
    values ('2026-2027', 'CNNHS IoT Biometric Kiosk Precinct')
    returning id into v_election_id;
  end if;

  for p in 1..array_length(party_names, 1) loop

    insert into public.parties (name, description)
    values (party_names[p], party_desc[p])
    on conflict (name) do update
      set description = excluded.description
    returning id into v_party_id;

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
      on conflict (lrn, school_year) do update
        set first_name = excluded.first_name,
            last_name = excluded.last_name,
            birthdate = excluded.birthdate,
            grade_level = excluded.grade_level,
            gender = excluded.gender;

      select id into v_master_id
      from public.student_masterlist
      where lrn = v_lrn and school_year = '2026-2027';

      -- Student account (login-capable, password: student123)
      insert into public.students
        (student_id, masterlist_id, first_name, middle_name, last_name, grade_level, gender,
         birthdate, lrn, email, password_hash, status, verification_status, mismatch_count)
      values
        (null, v_master_id, split_part(v_given, ' ', 1), v_middle, v_surname, v_grade, v_gender,
         v_birthdate, v_lrn, v_email, encode(digest('student123', 'sha256'), 'hex'),
         'approved', 'autoApproved', 0)
      on conflict (lrn) do update
        set masterlist_id = excluded.masterlist_id,
            first_name = excluded.first_name,
            middle_name = excluded.middle_name,
            last_name = excluded.last_name,
            grade_level = excluded.grade_level,
            gender = excluded.gender,
            birthdate = excluded.birthdate,
            email = excluded.email,
            password_hash = excluded.password_hash,
            status = excluded.status,
            verification_status = excluded.verification_status
      returning id into v_student_id;

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
      on conflict (student_id, election_period_id) do update
        set surname = excluded.surname,
            given_name = excluded.given_name,
            middle_name = excluded.middle_name,
            grade_level = excluded.grade_level,
            position = excluded.position,
            party_id = excluded.party_id,
            gender = excluded.gender,
            date_of_birth = excluded.date_of_birth,
            age = excluded.age,
            email = excluded.email,
            mobile_number = excluded.mobile_number,
            home_address = excluded.home_address,
            picture_url = excluded.picture_url,
            status = excluded.status;

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
