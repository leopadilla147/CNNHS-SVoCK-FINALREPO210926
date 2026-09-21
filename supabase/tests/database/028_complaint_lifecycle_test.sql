-- =====================================================================
-- 028_complaint_lifecycle_test.sql
-- Phase 04, Plan 01 - Task 3 (complaint lifecycle / RLS / RPC / gate)
--
-- Contract test for migration 028: the filed/accepted/rejected status
-- lifecycle (D-01) + row mapping + new column default, the session-
-- identity RLS rewrite, the revoked UPDATE privilege, the grievance-
-- guarded audited decide_complaint_rpc (D-04 / GRIEV-01, GRIEV-04),
-- has_active_complaint_rpc groundwork (ELECT-02, D-07), the RLS insert
-- leg, and the APPROV-02 constraint (candidates_grade_position_match).
--
-- Identity model (022 spine): a student session is minted with the
-- students PK (login_student_direct_v2 issues issue_session_token(
-- v_student.id, 'student')), and complaints.student_id references
-- students(id) - so current_session_user_id() equals complaints.
-- student_id for a student session.  Admin/commissioner sessions are
-- minted with the auth.users uid (profiles.id) and pass the policy
-- via current_app_role() = 'admin'.
--
-- RLS leg uses FORCE row level security + a simulated student session
-- so the with-check expression is exercised exactly as the client sees
-- it; the transaction rollback restores the relaxed posture.
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(28);

-- ---------------------------------------------------------------------
-- 1) Status lifecycle: CHECK restricts to the new set (5)
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.complaints (subject, description, status) values ('x', 'y', 'pending')$$,
  '23514',
  'complaints_status_check',
  'the old pending literal is rejected by the re-added CHECK');
select throws_ok(
  $$insert into public.complaints (subject, description, status) values ('x', 'y', 'dismissed')$$,
  '23514',
  'complaints_status_check',
  'the old dismissed literal is rejected by the re-added CHECK');
select throws_ok(
  $$insert into public.complaints (subject, description, status) values ('x', 'y', 'resolved')$$,
  '23514',
  'complaints_status_check',
  'the old resolved literal is rejected by the re-added CHECK');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'complaints' and column_name = 'status'),
  '''filed''::text',
  'complaints.status default is ''filed'' (new rows start in the holding state)');

-- The row mapping must have left zero legacy literals behind.
select is(
  (select count(*)::int from public.complaints where status in ('pending', 'dismissed', 'resolved')),
  0,
  'the 028 row mapping left zero pending/dismissed/resolved literals');

-- ---------------------------------------------------------------------
-- 2) Fixtures (1)
--    students a/b (complaint owners, SESSION-minted with the students
--    PK), an admin (chief) profile, and a grievance commissioner profile.
-- ---------------------------------------------------------------------
create temp table t_fx (
  student_a uuid,
  student_b uuid,
  admin_uid uuid,
  grievance_uid uuid,
  period_id uuid
);
insert into t_fx select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

insert into public.students (id, first_name, last_name, grade_level, gender, birthdate, lrn, email, status, verification_status, mismatch_count)
values ((select student_a from t_fx), 'Complainant', 'Alpha', 'Grade 11', 'Male', '2009-03-04', '120000000003',
        'complainant.a@test.local', 'approved', 'autoApproved', 0);

insert into public.students (id, first_name, last_name, grade_level, gender, birthdate, lrn, email, status, verification_status, mismatch_count)
values ((select student_b from t_fx), 'Complainant', 'Bravo', 'Grade 11', 'Male', '2009-03-05', '120000000004',
        'complainant.b@test.local', 'approved', 'autoApproved', 0);

-- Admin + grievance commissioner profiles bootstrap from auth.users
-- raw_user_meta_data via 001's handle_new_user (002 fixture pattern).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select admin_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'fx.admin@test.local', crypt('pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"admin","commissioner_role":"chief","full_name":"Fixture Admin"}'::jsonb,
       now(), now() from t_fx;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select grievance_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'fx.grievance@test.local', crypt('pass-1', gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"role":"admin","commissioner_role":"grievance","full_name":"Fixture Grievance"}'::jsonb,
       now(), now() from t_fx;

select is(
  (select count(*)::int from public.profiles where id in (select admin_uid from t_fx) or id in (select grievance_uid from t_fx)),
  2,
  'handle_new_user bootstrapped both admin and grievance commissioner profiles');

-- Election period fixture for has_active_complaint_rpc.
insert into public.election_periods (id, school_year, is_active)
values ((select period_id from t_fx), '2099-028-TEST', false);

-- ---------------------------------------------------------------------
-- 3) decide_complaint_rpc exists + SECURITY DEFINER posture (3)
-- ---------------------------------------------------------------------
select has_function('public', 'decide_complaint_rpc',
       array['uuid', 'text', 'text'],
       'decide_complaint_rpc must exist (028 adjudication RPC)');
select has_function('public', 'has_active_complaint_rpc',
       array['uuid'],
       'has_active_complaint_rpc must exist (ELECT-02 groundwork helper)');
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'decide_complaint_rpc' and p.prosecdef),
  1,
  'decide_complaint_rpc must be SECURITY DEFINER');

-- ---------------------------------------------------------------------
-- 4) RPC guard: non-grievance session rejected (2)
--    The admin profile is the Chief (commissioner_role = 'chief'), so
--    any non-grievance commissioner is proven rejected; a caller with
--    NO session header is rejected too (current_commissioner_role is
--    NULL in both cases).
-- ---------------------------------------------------------------------
select set_config('request.headers',
  json_build_object('authorization', 'Bearer ' || (select public.issue_session_token((select admin_uid from t_fx), 'admin'))::text)::text,
  false);
select throws_ok(
  $$select public.decide_complaint_rpc(gen_random_uuid(), 'accepted', null)$$,
  'P0001',
  'Forbidden',
  'a non-grievance commissioner (chief) is rejected by the role guard');

select set_config('request.headers', '{}'::text, false);
select throws_ok(
  $$select public.decide_complaint_rpc(gen_random_uuid(), 'accepted', null)$$,
  'P0001',
  'Forbidden',
  'a caller without a session header is rejected by the role guard');

-- ---------------------------------------------------------------------
-- 5) RPC happy path: grievance session, reason mandate, accept (7)
-- ---------------------------------------------------------------------
select set_config('request.headers',
  json_build_object('authorization', 'Bearer ' || (select public.issue_session_token((select grievance_uid from t_fx), 'admin'))::text)::text,
  false);

insert into public.complaints (id, student_id, subject, description, status, incident_date)
values ('10000000-0000-0000-0000-000000000001', (select student_a from t_fx),
        'Fixture complaint', 'Detail text', 'filed', '2026-09-01T08:00:00Z');

-- Null reason on reject raises.
select throws_ok(
  $$select public.decide_complaint_rpc('10000000-0000-0000-0000-000000000001', 'rejected', null)$$,
  'P0001',
  'rejection reason',
  'rejecting with a NULL reason is rejected (mandatory reason)');

-- Whitespace-trimmed-empty reason raises.
select throws_ok(
  $$select public.decide_complaint_rpc('10000000-0000-0000-0000-000000000001', 'rejected', '   ')$$,
  'P0001',
  'rejection reason',
  'rejecting with a whitespace-only reason is rejected (whitespace-trimmed)');

-- Unknown action raises.
select throws_ok(
  $$select public.decide_complaint_rpc('10000000-0000-0000-0000-000000000001', 'hold', null)$$,
  'P0001',
  'accepted.*rejected',
  'an action outside accepted/rejected is rejected');

-- Happy path: accept flips filed -> accepted and resolves.
select lives_ok(
  $$select public.decide_complaint_rpc('10000000-0000-0000-0000-000000000001', 'accepted', null)$$,
  'a grievance commissioner can accept a filed complaint');
select is(
  (select status from public.complaints where id = '10000000-0000-0000-0000-000000000001'),
  'accepted',
  'accept flips the complaint to accepted');
select is(
  (select resolved_by from public.complaints where id = '10000000-0000-0000-0000-000000000001'),
  (select grievance_uid from t_fx),
  'accept records the grievance commissioner as resolved_by');

-- Audit side-effect: exactly one Accepted Complaint row (GRIEV-04).
-- (The 001 audit_complaint_status trigger also fires but writes a
-- 'Complaints Status Changed' row, not 'Accepted Complaint'.)
select is(
  (select count(*)::int from public.audit_logs
    where action = 'Accepted Complaint'
      and details like '%Fixture complaint%'),
  1,
  'accept writes exactly one audited Accepted Complaint row via insert_audit_log_rpc');

-- ---------------------------------------------------------------------
-- 6) has_active_complaint_rpc: true with a filed row, false without (3)
--    Groundwork only (D-07) - never enforced by another function yet.
-- ---------------------------------------------------------------------
select is(
  (select public.has_active_complaint_rpc(gen_random_uuid())),
  false,
  'no filed complaint exists for an arbitrary election period');
select is(
  (select public.has_active_complaint_rpc(null)),
  false,
  'a NULL election period has no filed complaint (= never matches)');
insert into public.complaints (id, student_id, election_period_id, subject, description, status)
values ('20000000-0000-0000-0000-000000000002', (select student_a from t_fx),
        (select period_id from t_fx), 'Active complaint', 'Still filed', 'filed');
select is(
  (select public.has_active_complaint_rpc((select period_id from t_fx))),
  true,
  'a filed complaint under a real period makes the gate helper return true');

-- ---------------------------------------------------------------------
-- 7) RLS ownership legs: with-check rejects another student's id (4)
--    FORCE RLS subjects the table owner (the test runner) to the
--    policies; the rollback restores the relaxed posture.
-- ---------------------------------------------------------------------
alter table public.complaints force row level security;

-- Simulate the student-a session exactly as login_student_direct_v2
-- does: token minted on the students PK.
select set_config('request.headers',
  json_build_object('authorization', 'Bearer ' || (select public.issue_session_token((select student_a from t_fx), 'student'))::text)::text,
  false);

select lives_ok(
  $$insert into public.complaints (id, student_id, subject, description)
     values ('30000000-0000-0000-0000-000000000003', (select student_a from t_fx), 'Own complaint', 'Mine')$$,
  'a student can insert a complaint owned by their own session identity');
select is(
  (select count(*)::int from public.complaints where id = '30000000-0000-0000-0000-000000000003'),
  1,
  'the owner insert landed (visible to the owner under RLS)');

-- Student a cannot file a complaint owning student b's id: the
-- with-check expression is false -> 42501, 0 rows.
select throws_ok(
  $$insert into public.complaints (id, student_id, subject, description)
     values ('40000000-0000-0000-0000-000000000004', (select student_b from t_fx), 'Not mine', 'Hijack')$$,
  '42501',
  'row-level security',
  'a mismatched student_id insert is rejected by the RLS with-check');
select is(
  (select count(*)::int from public.complaints where id = '40000000-0000-0000-0000-000000000004'),
  0,
  'the mismatched insert landed 0 rows');

-- Restore the relaxed posture for the remaining assertions.
alter table public.complaints no force row level security;

-- ---------------------------------------------------------------------
-- 8) Revoked UPDATE privilege (2) - RPC is the ONLY mutation path (R2)
-- ---------------------------------------------------------------------
select is(
  (select has_table_privilege('anon', 'public.complaints', 'UPDATE')),
  false,
  'anon no longer has UPDATE on complaints (028 revoke - RPC only mutation)');
select is(
  (select has_table_privilege('authenticated', 'public.complaints', 'UPDATE')),
  false,
  'authenticated no longer has UPDATE on complaints (028 revoke - RPC only mutation)');

-- ---------------------------------------------------------------------
-- 9) APPROV-02 DB enforcement: candidates_grade_position_match (1)
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.conname = 'candidates_grade_position_match'
      and c.conrelid = 'public.candidates'::regclass),
  1,
  'candidates_grade_position_match constraint exists on public.candidates (APPROV-02)');

select * from finish();
rollback;