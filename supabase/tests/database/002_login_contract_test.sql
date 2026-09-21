-- =====================================================================
-- 002_login_contract_test.sql
-- Phase 01, Plan 03 — Task 1 (login contract) — Phase 02, Plan 02 — Task 1
--
-- pgTAP contract test for the authentication entrypoints delivered by
-- the consolidated chain (001/002/006/010/013/020) plus the Phase 2
-- hardening (022 session spine + 023 bcrypt/lockout/change_my_password).
--
-- Hard assertions cover what the chain ACTUALLY ships (login RPCs, role
-- helpers, security-definer posture on the audit RPC) and — after the
-- 02-02 flip — the lockout/bcrypt/mint/change behavior that the 4a/4b/4c
-- TODO guards were placeholder for:
--   * 4a (app_settings helper) was DELETED: lockout windows are enforced
--     in-code in 023 against login_attempts, not via an app_settings row.
--   * 4b (aqad.role helper) was DELETED: aqad/role resolution is Phase 3+
--     scope (REMOVE-08).
--   * 4c flipped from a single todo() to a hard lockout/bcrypt/mint/change
--     assertion block (has_table login_attempts + behavioral probes).
--   * 4d flipped from a todo() to a hard assertion in Phase 5 (032): the
--     permissive "votes kiosk insert" policy is REMOVED (R6) — client
--     roles keep only submit_vote_rpc's security-definer path.
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(53);

-- Fixture/behaviour helper: call any (text, text) RPC and return 'OK' on
-- success or the raised message text on failure (failure shape capture
-- powers the lockout boundary, SEC-03 equality and change probes).
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

-- ---------------------------------------------------------------------
-- 1) Login entrypoints (4) — one per actor class
-- ---------------------------------------------------------------------
select has_function('public', 'login_student_direct',
       array['text','text'],
       'login_student_direct must exist (002 student login)');
select has_function('public', 'login_admin_direct',
       array['text','text'],
       'login_admin_direct must exist (001 admin login)');
select has_function('public', 'login_officer_direct',
       array['text','text'],
       'login_officer_direct must exist (001 officer login)');
select has_function('public', 'login_sslg_adviser_direct',
       array['text','text'],
       'login_sslg_adviser_direct must exist (006 adviser login)');

-- ---------------------------------------------------------------------
-- 2) Role helpers (2) — feed every RLS policy in the chain
-- ---------------------------------------------------------------------
select has_function('public', 'current_app_role',
       array[]::text[],
       'current_app_role must exist (roles helper, 001)');
select has_function('public', 'current_commissioner_role',
       array[]::text[],
       'current_commissioner_role must exist (commissioner roles helper, 001)');

-- ---------------------------------------------------------------------
-- 3) Security posture of the auth surface (5)
--    All login RPCs and the audit RPC are SECURITY DEFINER so they can
--    read password hashes / bypass RLS WITHOUT exposing the table to
--    the client — this is the chain's intended contract (D-06).
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'login_student_direct'
      and p.prosecdef),
  1,
  'login_student_direct must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'login_admin_direct'
      and p.prosecdef),
  1,
  'login_admin_direct must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'login_officer_direct'
      and p.prosecdef),
  1,
  'login_officer_direct must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'login_sslg_adviser_direct'
      and p.prosecdef),
  1,
  'login_sslg_adviser_direct must be SECURITY DEFINER');

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
  'insert_audit_log_rpc must be SECURITY DEFINER with search_path pinned to public (020)');

-- ---------------------------------------------------------------------
-- 4c → 4) Phase-2 hardening contract — 023 (41)
--    The former todo() guard for the login-attempt lockout design flips
--    to hard assertions: table shape, helper availability, the 5/15
--    account lockout boundary/expiry/precision, the per-IP 20/hr damper,
--    SEC-03 message equality, the transparent bcrypt re-hash, the v2
--    admin/officer/adviser mints with anon-granted/revoked-public
--    posture, and the change_my_password contract.  (4a/4b guards were
--    deleted — see header.)
-- ---------------------------------------------------------------------

-- ---- 4.1) Objects shipped by 023 (7) ----
select has_table('public', 'login_attempts',
       'login_attempts tracking table must exist (023 5-attempt/15-min lockout design)');
select has_function('public', 'login_guard',
       array['text', 'inet'],
       'login_guard must exist (023 lockout gate)');
select has_function('public', 'record_login_outcome',
       array['text', 'inet', 'boolean'],
       'record_login_outcome must exist (023 counter feedback)');
select has_function('public', 'login_admin_direct_v2',
       array['text', 'text'],
       'login_admin_direct_v2 must exist (023 admin v2 login)');
select has_function('public', 'login_officer_direct_v2',
       array['text', 'text'],
       'login_officer_direct_v2 must exist (023 officer v2 login)');
select has_function('public', 'login_sslg_adviser_direct_v2',
       array['text', 'text'],
       'login_sslg_adviser_direct_v2 must exist (023 adviser v2 login)');
select has_function('public', 'change_my_password',
       array['text', 'text'],
       'change_my_password must exist (023 student self-service password change)');

-- ---- 4.2) change_my_password posture (1) ----
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg on true
    where n.nspname = 'public'
      and p.proname = 'change_my_password'
      and p.prosecdef
      and cfg = 'search_path=public,extensions'),
  1,
  'change_my_password must be SECURITY DEFINER with search_path pinned to public,extensions (023)');

-- ---- 4.3) Fixtures (not asserted; roll back with the transaction) ----
-- Lockout/bcrypt student: carries a legacy 64-hex SHA-256 hash so the
-- lockout flow doubles as the AUTH-03 transparent re-hash probe.
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'lockout.student@test.local',
        encode(sha256(convert_to('correct-horse', 'UTF8')), 'hex'),
        'Lockout', 'Student', 'Grade 11', 'Male', '2008-01-01', '120000000001',
        'approved', 'autoApproved', 0);

-- change_my_password student: carries a bcrypt hash from the start.
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'change.student@test.local',
        crypt('current-pass-1', gen_salt('bf', 10)),
        'Change', 'Student', 'Grade 10', 'Female', '2009-05-05', '120000000002',
        'approved', 'autoApproved', 0);

-- Admin / officer / adviser fixture identities (auth.users rows trigger
-- 001's handle_new_user profile bootstrap from raw_user_meta_data).
create temp table t_fixtures (admin_uid uuid, officer_uid uuid, adviser_uid uuid);
insert into t_fixtures
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select admin_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'admin.v2@test.local', crypt('adm-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"admin","commissioner_role":"chief","full_name":"Test Admin"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select officer_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'officer.v2@test.local', crypt('ofc-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"officer","full_name":"Test Officer"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into public.officers (auth_id, name, email, position, status)
select officer_uid, 'Test Officer', 'officer.v2@test.local', 'President', 'active'
  from t_fixtures;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select adviser_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'adviser.v2@test.local', crypt('adv-pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"sslg_adviser","full_name":"Test Adviser"}'::jsonb,
       now(), now()
  from t_fixtures;

insert into public.sslg_advisers (auth_id, name, email, status)
select adviser_uid, 'Test Adviser', 'adviser.v2@test.local', 'active'
  from t_fixtures;

-- ---- 4.4) Account lockout boundary, precision, expiry + bcrypt re-hash (8) ----
select set_config('request.headers', '{}', false);

-- 5 consecutive wrong passwords → the 5th locks the account.
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-1');
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-2');
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-3');
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-4');
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-5');

select is(
  (select failed_count
     from public.login_attempts
    where user_identifier = 'lockout.student@test.local'
      and ip_address is null),
  5,
  'exactly 5 consecutive failures are recorded before lockout (SEC-01)');

select is(
  (select locked_until > now()
     from public.login_attempts
    where user_identifier = 'lockout.student@test.local'
      and ip_address is null),
  true,
  'the 5th consecutive failure locks the account (SEC-01, exactly on 5)');

-- Lockout boundary: the 6th attempt with the CORRECT password still fails
-- with the identical failure text (guard-reject path, no account oracle).
select is(
  (select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'correct-horse')),
  'Invalid credentials',
  'while locked, even the correct password fails with the identical failure text (SEC-01 boundary)');

-- Counter precision: guard-rejected attempts never push the counter past 5.
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-6');
select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'wrong-7');
select is(
  (select failed_count
     from public.login_attempts
    where user_identifier = 'lockout.student@test.local'
      and ip_address is null),
  5,
  'the failure counter never exceeds 5 while the account is locked (SEC-01 precision)');

-- Lockout expiry: unlocking (locked_until in the past) lets the correct
-- password through, and the success path resets the counter to 0.
update public.login_attempts
   set locked_until = now() - interval '1 minute'
 where user_identifier = 'lockout.student@test.local'
   and ip_address is null;

select is(
  (select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'correct-horse')),
  'OK',
  'the correct password succeeds once the 15-minute lock has expired (self-unlock)');

select is(
  (select failed_count
     from public.login_attempts
    where user_identifier = 'lockout.student@test.local'
      and ip_address is null),
  0,
  'a successful login resets the failure counter to 0');

-- AUTH-03 / D-10/D-11: the (now successful) legacy 64-hex student was
-- transparently re-hashed to bcrypt cost 10 during the login above.
select is(
  (select starts_with(s.password_hash, '$2')
     from public.students s
    where s.email = 'lockout.student@test.local'),
  true,
  'a legacy 64-hex SHA-256 hash is transparently re-hashed to the bcrypt prefix on login (AUTH-03)');

select is(
  (select substring(s.password_hash from '\$2[aby]\$(\d{2})\$')::int
     from public.students s
    where s.email = 'lockout.student@test.local'),
  10,
  'the transparent re-hash lands at bcrypt work factor 10 (D-27)');

-- ---- 4.5) SEC-03 — identical failure text across surfaces (1) ----
select is(
  (select try_v2('login_student_direct_v2', 'ghost.never@test.local', 'not-the-password')),
  (select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'not-the-password')),
  'unknown-account failures return the byte-identical failure text as wrong-password failures (SEC-03)');

-- ---- 4.6) SEC-02 — per-IP rolling 20/hr damper (2) ----
-- 20 failures from 20 distinct identifiers on one IP lock the IP; a valid
-- login from that IP (any account) is then rejected by the guard.
select set_config(
  'request.headers',
  json_build_object('x-forwarded-for', '203.0.113.7')::text,
  false);

do $$
declare
  i int;
begin
  for i in 1..20 loop
    begin
      perform public.login_student_direct_v2(format('ghost%s@test.local', i), 'wrong-pw');
    exception when others then
      null; -- 'Invalid credentials' — expected per iteration
    end;
  end loop;
end $$;

select is(
  (select locked_until > now()
     from public.login_attempts
    where ip_address = '203.0.113.7'
      and user_identifier is null),
  true,
  '20 failed logins from one IP within the rolling 1-hour window lock the IP for 15 minutes (SEC-02/D-19)');

select is(
  (select try_v2('login_student_direct_v2', 'lockout.student@test.local', 'correct-horse')),
  'Invalid credentials',
  'while the IP is locked, even a correct-password login from that IP is rejected (SEC-02 gate)');

select set_config('request.headers', '{}', false);

-- ---- 4.7) Admin v2 mint (5) ----
select is(
  (select try_v2('login_admin_direct_v2', 'admin.v2@test.local', 'adm-pass-1')),
  'OK',
  'admin v2 login succeeds with valid credentials (legacy crypt compare + lockout)');

select is(
  (select count(*)::int
     from public.sessions
    where user_id = (select admin_uid from t_fixtures)),
  1,
  'admin v2 login mints exactly one active session row (one-per-user replace)');

select is(
  (select user_role
     from public.sessions
    where user_id = (select admin_uid from t_fixtures)),
  'admin',
  'the admin session row carries user_role admin');

select is(
  has_function_privilege('anon', 'public.login_admin_direct_v2(text, text)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on login_admin_direct_v2 (pre-session login surface)');

select is(
  has_function_privilege('public', 'public.login_admin_direct_v2(text, text)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on login_admin_direct_v2 (revoked, least privilege)');

-- ---- 4.8) Officer v2 mint (5) ----
select is(
  (select try_v2('login_officer_direct_v2', 'officer.v2@test.local', 'ofc-pass-1')),
  'OK',
  'officer v2 login succeeds with valid credentials (legacy officers join + lockout)');

select is(
  (select count(*)::int
     from public.sessions
    where user_id = (select officer_uid from t_fixtures)),
  1,
  'officer v2 login mints exactly one active session row');

select is(
  (select user_role
     from public.sessions
    where user_id = (select officer_uid from t_fixtures)),
  'officer',
  'the officer session row carries user_role officer');

select is(
  has_function_privilege('anon', 'public.login_officer_direct_v2(text, text)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on login_officer_direct_v2');

select is(
  has_function_privilege('public', 'public.login_officer_direct_v2(text, text)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on login_officer_direct_v2');

-- ---- 4.9) Adviser v2 mint (5) ----
select is(
  (select try_v2('login_sslg_adviser_direct_v2', 'adviser.v2@test.local', 'adv-pass-1')),
  'OK',
  'adviser v2 login succeeds with valid credentials (legacy advisers join + lockout)');

select is(
  (select count(*)::int
     from public.sessions
    where user_id = (select adviser_uid from t_fixtures)),
  1,
  'adviser v2 login mints exactly one active session row');

select is(
  (select user_role
     from public.sessions
    where user_id = (select adviser_uid from t_fixtures)),
  'sslg_adviser',
  'the adviser session row carries user_role sslg_adviser');

select is(
  has_function_privilege('anon', 'public.login_sslg_adviser_direct_v2(text, text)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on login_sslg_adviser_direct_v2');

select is(
  has_function_privilege('public', 'public.login_sslg_adviser_direct_v2(text, text)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on login_sslg_adviser_direct_v2');

-- ---- 4.10) change_my_password (7) ----
-- Mint a session for the change fixture; identity must come from the
-- session only (the RPC never accepts a user id from the caller).
create temp table t_pw (raw_token text);

insert into t_pw
select public.issue_session_token(s.id, 'student')
  from public.students s
 where s.email = 'change.student@test.local';

select set_config(
  'request.headers',
  json_build_object('authorization', 'Bearer ' || (select raw_token from t_pw))::text,
  false);

select is(
  (select try_v2('change_my_password', 'current-pass-1', 'short')),
  'New password must be at least 8 characters',
  'change_my_password rejects new passwords shorter than 8 characters (D-24)');

select is(
  (select try_v2('change_my_password', 'wrong-current', 'new-password-1')),
  'Current password is incorrect',
  'change_my_password rejects a wrong current password');

select is(
  (select try_v2('change_my_password', 'current-pass-1', 'new-password-1')),
  'OK',
  'change_my_password succeeds with the correct current password and an 8-char new password');

select is(
  (select starts_with(s.password_hash, '$2')
     from public.students s
    where s.email = 'change.student@test.local'),
  true,
  'change_my_password stores the new password as a bcrypt hash (ACCT-03)');

select is(
  (select s.session_version
     from public.students s
    where s.email = 'change.student@test.local'),
  1,
  'change_my_password bumps students.session_version on success (ACCT-05)');

select is(
  (select count(*)::int
     from public.sessions
    where user_id = (select s.id from public.students s where s.email = 'change.student@test.local')),
  0,
  'change_my_password deletes the caller''s active session rows (ACCT-05)');

select is(
  (select public.current_session_role()),
  null,
  'the pre-change token no longer resolves a role after the password change (dead-token check)');

-- ---------------------------------------------------------------------
-- 4d) Vote insertion tightening (1): Phase 5 (032) removed the permissive
--     client insert path (R6) — hard assertion, no longer a todo.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename = 'votes'
      and policyname = 'votes kiosk insert'),
  0,
  'permissive "votes kiosk insert" policy must be removed (R6, Phase 5)');

select * from finish();
rollback;