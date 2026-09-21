-- Run this after 006_sslg_adviser.sql
-- Seeds accounts for the 4 commissioners and SSLG Adviser

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
  on conflict (id) do update
    set role = 'admin', commissioner_role = 'screening_validation', full_name = 'Commissioner of Screening & Validation';

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (screening_id, 'Commissioner of Screening & Validation', 'screening.commissioner@cnnhs.edu', 'screening_validation', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do update
    set auth_id = excluded.auth_id, name = excluded.name, email = excluded.email, status = excluded.status;

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
  on conflict (id) do update
    set role = 'admin', commissioner_role = 'electoral_board', full_name = 'Commissioner of Electoral Board';

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (electoral_id, 'Commissioner of Electoral Board', 'electoral.commissioner@cnnhs.edu', 'electoral_board', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do update
    set auth_id = excluded.auth_id, name = excluded.name, email = excluded.email, status = excluded.status;

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
  on conflict (id) do update
    set role = 'admin', commissioner_role = 'appointment', full_name = 'Commissioner of Appointment';

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (appointment_id, 'Commissioner of Appointment', 'appointment.commissioner@cnnhs.edu', 'appointment', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do update
    set auth_id = excluded.auth_id, name = excluded.name, email = excluded.email, status = excluded.status;

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
  on conflict (id) do update
    set role = 'admin', commissioner_role = 'grievance', full_name = 'Commissioner of Grievance';

  insert into public.commissioners (auth_id, name, email, commissioner_role, status, appointed_by)
  values (grievance_id, 'Commissioner of Grievance', 'grievance.commissioner@cnnhs.edu', 'grievance', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (commissioner_role) do update
    set auth_id = excluded.auth_id, name = excluded.name, email = excluded.email, status = excluded.status;

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
  on conflict (id) do update
    set role = 'sslg_adviser', full_name = 'SSLG Adviser';

  insert into public.sslg_advisers (auth_id, name, email, status, created_by)
  values (sslg_id, 'SSLG Adviser', 'sslg.adviser@cnnhs.edu', 'active', '11111111-1111-4111-8111-111111111111')
  on conflict (email) do update
    set auth_id = excluded.auth_id, name = excluded.name, status = excluded.status;

end $$;
