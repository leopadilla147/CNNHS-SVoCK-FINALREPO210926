-- =====================================================================
-- 030_account_provisioning_and_forced_change_test.sql
-- Phase 05, Plan 05-01 - Task 1 (pgTAP contract test for migration 030)
--
-- Harness: 002_login_contract_test.sql conventions (fixtures inside a
-- transaction, try_v2 failure-shape capture, 4.10 dead-token pattern via
-- current_session_role()).
--
-- Proves the 030 contracts:
--   * students.must_change_password / profiles.must_change_password exist;
--   * all three v2 login RPCs RETURN the actor's flag (student -> students
--     row; admin/adviser -> profiles row) with false for normal accounts;
--   * change_my_password clears the flag AND bumps students.session_version
--     on success, kills the caller's sessions (D-14), and the new password
--     logs in with flag false (re-login contract);
--   * get_current_profile_rpc() re-reads the flag from the server for the
--     session actor (bootstrap refresh — a page refresh cannot bypass the
--     gate) and returns no rows without a session;
--   * insert_audit_log_rpc is callable by anon + authenticated, is NOT
--     PUBLIC-callable, keeps its SECURITY DEFINER + search_path=public
--     posture (002 regression), and normalizes 'kiosk' / missing roles to
--     'system' while preserving a valid role (027 CHECK intact).
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(24);

-- Fixture/behaviour helper: call any (text, text) RPC and return 'OK' on
-- success or the raised message text on failure (002 harness convention).
create temporary function try_v2(p_rpc text, p_email text, p_password text)
returns text
language plpgsql
as $$
begin
  begin
    execute format('select %I(%L, %L)', p_rpc, p_email, p_password);
    return 'OK';
  exception when others then
    return sqlerrm;
  end;
end;
$$;

-- Login-flag probe: execute the named login RPC and return the
-- must_change_password column of its result row.
create temporary function login_flag(p_rpc text, p_email text, p_password text)
returns boolean
language plpgsql
as $$
declare
  v_flag boolean;
begin
  execute format('select must_change_password from %I(%L, %L)', p_rpc, p_email, p_password)
    into v_flag;
  return v_flag;
end;
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
-- Flagged + plain students (bcrypt hashes from the start, like 002's
-- change.student fixture).
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count, must_change_password)
values (gen_random_uuid(), 'flag.student.030@test.local',
        crypt('temp-pass-1', gen_salt('bf', 10)),
        'Flagged', 'Student', 'Grade 11', 'Male', '2008-01-01', '120000000030',
        'approved', 'autoApproved', 0, true);

insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'plain.student.030@test.local',
        crypt('plain-pass-1', gen_salt('bf', 10)),
        'Plain', 'Student', 'Grade 10', 'Female', '2009-05-05', '120000000031',
        'approved', 'autoApproved', 0);

-- Refresh fixture: flagged student used ONLY by get_current_profile_rpc.
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count, must_change_password)
values (gen_random_uuid(), 'refresh.student.030@test.local',
        crypt('refresh-pass-1', gen_salt('bf', 10)),
        'Refresh', 'Student', 'Grade 12', 'Male', '2006-03-03', '120000000032',
        'approved', 'autoApproved', 0, true);

-- Staff fixtures: auth.users rows (the 001 handle_new_user trigger builds
-- the profiles rows from raw_user_meta_data), then the flagged rows are
-- marked must_change_password = true.
create temp table t_fixtures (admin_flag_uid uuid, admin_plain_uid uuid, adviser_flag_uid uuid, adviser_plain_uid uuid);
insert into t_fixtures
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select admin_flag_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'flag.admin.030@test.local', crypt('adm-flag-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"admin","commissioner_role":"grievance","full_name":"Flagged Admin"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select admin_plain_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'plain.admin.030@test.local', crypt('adm-plain-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"admin","commissioner_role":"electoral_board","full_name":"Plain Admin"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select adviser_flag_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'flag.adviser.030@test.local', crypt('adv-flag-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"sslg_adviser","full_name":"Flagged Adviser"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select adviser_plain_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'plain.adviser.030@test.local', crypt('adv-plain-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"sslg_adviser","full_name":"Plain Adviser"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into public.sslg_advisers (auth_id, name, email, status)
select adviser_flag_uid, 'Flagged Adviser', 'flag.adviser.030@test.local', 'active'
  from t_fixtures;

insert into public.sslg_advisers (auth_id, name, email, status)
select adviser_plain_uid, 'Plain Adviser', 'plain.adviser.030@test.local', 'active'
  from t_fixtures;

update public.profiles set must_change_password = true
 where id in (select admin_flag_uid from t_fixtures);

update public.profiles set must_change_password = true
 where id in (select adviser_flag_uid from t_fixtures);

-- ---------------------------------------------------------------------
-- 1) Columns exist (2)
-- ---------------------------------------------------------------------
select has_column('public', 'students', 'must_change_password',
       'students must carry the must_change_password forced-change flag (030)');
select has_column('public', 'profiles', 'must_change_password',
       'profiles must carry the must_change_password forced-change flag (030)');

-- ---------------------------------------------------------------------
-- 2) Login RPCs return the actor flag (6)
-- ---------------------------------------------------------------------
select set_config('request.headers', '{}', false);

select is(
  (select login_flag('login_student_direct_v2', 'flag.student.030@test.local', 'temp-pass-1')),
  true,
  'a flagged student login returns must_change_password = true (students row)');

select is(
  (select login_flag('login_student_direct_v2', 'plain.student.030@test.local', 'plain-pass-1')),
  false,
  'a normal student login returns must_change_password = false');

select is(
  (select login_flag('login_admin_direct_v2', 'flag.admin.030@test.local', 'adm-flag-pass-1')),
  true,
  'a flagged admin login returns must_change_password = true (profiles row)');

select is(
  (select login_flag('login_admin_direct_v2', 'plain.admin.030@test.local', 'adm-plain-pass-1')),
  false,
  'a normal admin login returns must_change_password = false');

select is(
  (select login_flag('login_sslg_adviser_direct_v2', 'flag.adviser.030@test.local', 'adv-flag-pass-1')),
  true,
  'a flagged adviser login returns must_change_password = true (profiles row)');

select is(
  (select login_flag('login_sslg_adviser_direct_v2', 'plain.adviser.030@test.local', 'adv-plain-pass-1')),
  false,
  'a normal adviser login returns must_change_password = false');

-- ---------------------------------------------------------------------
-- 3) change_my_password: flag clears, session_version bumps, sessions
--    die, re-login with the new password returns flag false (6)
-- ---------------------------------------------------------------------
create temp table t_pw (raw_token text);

insert into t_pw
select public.issue_session_token(s.id, 'student')
  from public.students s
 where s.email = 'flag.student.030@test.local';

select set_config(
  'request.headers',
  json_build_object('authorization', 'Bearer ' || (select raw_token from t_pw))::text,
  false);

select is(
  (select try_v2('change_my_password', 'temp-pass-1', 'new-pass-1')),
  'OK',
  'change_my_password succeeds for the flagged student with the temp password');

select is(
  (select s.must_change_password
     from public.students s
    where s.email = 'flag.student.030@test.local'),
  false,
  'change_my_password clears must_change_password on success (D-04)');

select is(
  (select s.session_version
     from public.students s
    where s.email = 'flag.student.030@test.local'),
  1,
  'change_my_password bumps students.session_version on success (ACCT-05 / 002 regression)');

select is(
  (select count(*)::int
     from public.sessions
    where user_id = (select s.id from public.students s where s.email = 'flag.student.030@test.local')),
  0,
  'change_my_password deletes the caller''s active session rows (ACCT-05)');

select is(
  (select public.current_session_role()),
  null,
  'the pre-change token no longer resolves a role after the password change (4.10 dead-token pattern)');

select is(
  (select login_flag('login_student_direct_v2', 'flag.student.030@test.local', 'new-pass-1')),
  false,
  're-login with the new password succeeds and returns must_change_password = false (D-14)');

-- ---------------------------------------------------------------------
-- 4) get_current_profile_rpc — bootstrap refresh (3)
-- ---------------------------------------------------------------------
-- 4a) Student refresh: the refresh fixture is flagged in the DB, so the
--     server-derived profile must carry the flag regardless of what the
--     client had stored before the reload.
create temporary table t_refresh_pw (raw_token text);

insert into t_refresh_pw
select public.issue_session_token(s.id, 'student')
  from public.students s
 where s.email = 'refresh.student.030@test.local';

select set_config(
  'request.headers',
  json_build_object('authorization', 'Bearer ' || (select raw_token from t_refresh_pw))::text,
  false);

select is(
  (select must_change_password from public.get_current_profile_rpc()),
  true,
  'get_current_profile_rpc returns the flagged student''s flag from the server (refresh-safe gate)');

-- 4b) Staff refresh: the flagged admin (fresh token; the earlier admin
--     login mint from section 2 is replaced by this mint).
create temporary table t_admin_refresh_pw (raw_token text);

insert into t_admin_refresh_pw
select public.issue_session_token(admin_flag_uid, 'admin')
  from t_fixtures;

select set_config(
  'request.headers',
  json_build_object('authorization', 'Bearer ' || (select raw_token from t_admin_refresh_pw))::text,
  false);

select is(
  (select role || ':' || must_change_password::text from public.get_current_profile_rpc()),
  'admin:true',
  'get_current_profile_rpc returns the flagged admin''s profile role and flag (staff branch)');

-- 4c) No session -> no rows (a logged-out reload gets nothing).
select set_config('request.headers', '{}', false);

select is(
  (select count(*)::int from public.get_current_profile_rpc()),
  0,
  'get_current_profile_rpc returns zero rows without a session token');

-- ---------------------------------------------------------------------
-- 5) insert_audit_log_rpc — R2 seam (7)
-- ---------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'public.insert_audit_log_rpc(uuid, text, text, text, text, text)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on insert_audit_log_rpc (R2 — the SPA runs as anon)');

select is(
  has_function_privilege('authenticated', 'public.insert_audit_log_rpc(uuid, text, text, text, text, text)', 'EXECUTE'),
  true,
  'authenticated is granted EXECUTE on insert_audit_log_rpc');

select is(
  has_function_privilege('public', 'public.insert_audit_log_rpc(uuid, text, text, text, text, text)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on insert_audit_log_rpc (least privilege)');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg on true
    where n.nspname = 'public'
      and p.proname = 'insert_audit_log_rpc'
      and p.prosecdef
      and cfg = 'search_path=public'),
  1,
  'insert_audit_log_rpc stays SECURITY DEFINER with search_path pinned to public (002 regression)');

-- Behavioural: callable under the anon role; a 'kiosk' role normalizes to
-- 'system' and never violates the 027 actor_role CHECK.
set role anon;
select public.insert_audit_log_rpc(null, 'Kiosk Device', 'kiosk', '030 Test', 'kiosk role normalized', 'info');
select public.insert_audit_log_rpc(null, 'Missing Role', null, '030 Test', 'missing role normalized', 'info');
select public.insert_audit_log_rpc(null, 'Real Admin', 'admin', '030 Test', 'valid role kept', 'info');
reset role;

select is(
  (select actor_role from public.audit_logs where action = '030 Test' and details = 'kiosk role normalized' order by timestamp desc limit 1),
  'system',
  'a kiosk-caller audit row is stored with actor_role system (027 CHECK intact, 001:438-449 precedent)');

select is(
  (select actor_role from public.audit_logs where action = '030 Test' and details = 'missing role normalized' order by timestamp desc limit 1),
  'system',
  'a missing-role audit row is stored with actor_role system');

select is(
  (select actor_role from public.audit_logs where action = '030 Test' and details = 'valid role kept' order by timestamp desc limit 1),
  'admin',
  'a valid admin audit role passes through unnormalized');

select * from finish();
rollback;