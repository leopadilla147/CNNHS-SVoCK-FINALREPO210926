-- =====================================================================
-- 001_schema_contract_test.sql
-- Phase 01, Plan 03 — Task 1 (schema contract)
--
-- pgTAP contract test for the consolidated migration chain (001-021).
-- Every table, column, RPC signature, and storage policy asserted here
-- is DELIVERED by the chain itself (D-06): the test encodes the intended
-- post-consolidation schema, never current drift.
--
-- Runs inside a transaction (begin / finish / rollback) so it is safe
-- to re-run and never mutates the database.
--
-- Run via:  npx supabase test db   (D-11 — user runs the DB gates)
-- =====================================================================

begin;

select plan(58);

-- ---------------------------------------------------------------------
-- 1) Core tables (22)
-- ---------------------------------------------------------------------
select has_table('public', 'profiles',            'public.profiles must exist (001)');
select has_table('public', 'student_masterlist',  'public.student_masterlist must exist (001)');
select has_table('public', 'students',            'public.students must exist (001)');
select has_table('public', 'commissioners',       'public.commissioners must exist (001/007)');
select has_table('public', 'officers',            'public.officers must exist (001)');
select has_table('public', 'election_periods',    'public.election_periods must exist (001/020)');
select has_table('public', 'parties',             'public.parties must exist (001)');
select has_table('public', 'candidates',          'public.candidates must exist (001)');
select has_table('public', 'nominations',         'public.nominations must exist (001)');
select has_table('public', 'votes',               'public.votes must exist (001)');
select has_table('public', 'biometric_templates', 'public.biometric_templates must exist (001)');
select has_table('public', 'kiosk_devices',       'public.kiosk_devices must exist (001)');
select has_table('public', 'kiosk_ballot_cache',  'public.kiosk_ballot_cache must exist (001)');
select has_table('public', 'kiosk_vote_queue',    'public.kiosk_vote_queue must exist (001)');
select has_table('public', 'complaints',          'public.complaints must exist (001)');
select has_table('public', 'archived_documents',  'public.archived_documents must exist (001)');
select has_table('public', 'report_templates',    'public.report_templates must exist (001)');
select has_table('public', 'audit_logs',          'public.audit_logs must exist (001)');
select has_table('public', 'notifications',       'public.notifications must exist (011)');
select has_table('public', 'party_members',       'public.party_members must exist (011)');
select has_table('public', 'proclamations',       'public.proclamations must exist (012)');
select has_table('public', 'sslg_advisers',       'public.sslg_advisers must exist (006)');

-- ---------------------------------------------------------------------
-- 2) Column spot-checks (25) — key login / candidate / audit columns
-- ---------------------------------------------------------------------
-- students (voter/student account)
select has_column('public', 'students', 'lrn',                'students.lrn must exist');
select has_column('public', 'students', 'email',              'students.email must exist');
select has_column('public', 'students', 'password_hash',      'students.password_hash must exist');
select has_column('public', 'students', 'status',             'students.status must exist');
select has_column('public', 'students', 'verification_status','students.verification_status must exist');
select has_column('public', 'students', 'mismatch_count',     'students.mismatch_count must exist');
-- votes (ballot)
select has_column('public', 'votes', 'election_period_id',    'votes.election_period_id must exist');
select has_column('public', 'votes', 'voter_id',              'votes.voter_id must exist');
select has_column('public', 'votes', 'candidate_id',          'votes.candidate_id must exist');
select has_column('public', 'votes', 'position',              'votes.position must exist');
-- candidates (candidacy flow)
select has_column('public', 'candidates', 'student_id',       'candidates.student_id must exist');
select has_column('public', 'candidates', 'election_period_id','candidates.election_period_id must exist');
select has_column('public', 'candidates', 'position',         'candidates.position must exist');
select has_column('public', 'candidates', 'status',           'candidates.status must exist');
-- election_periods (school-year scoping)
select has_column('public', 'election_periods', 'school_year','election_periods.school_year must exist');
select has_column('public', 'election_periods', 'is_active',  'election_periods.is_active must exist');
-- audit_logs
select has_column('public', 'audit_logs', 'actor_id',         'audit_logs.actor_id must exist');
select has_column('public', 'audit_logs', 'actor_role',       'audit_logs.actor_role must exist');
select has_column('public', 'audit_logs', 'action',           'audit_logs.action must exist');
-- profiles (role helpers feed off this)
select has_column('public', 'profiles', 'role',               'profiles.role must exist');
select has_column('public', 'profiles', 'commissioner_role',  'profiles.commissioner_role must exist');
select has_column('public', 'profiles', 'full_name',          'profiles.full_name must exist');
-- parties / nominations (candidacy graph edges)
select has_column('public', 'parties', 'name',                'parties.name must exist');
select has_column('public', 'parties', 'president_student_id','parties.president_student_id must exist');
select has_column('public', 'nominations', 'nominee_student_id','nominations.nominee_student_id must exist');

-- ---------------------------------------------------------------------
-- 3) RPC signatures (4) — the chain's canonical function contracts
-- ---------------------------------------------------------------------
select has_function('public', 'insert_audit_log_rpc',
       array['uuid','text','text','text','text','text'],
       'insert_audit_log_rpc must exist with the canonical 6-arg audit signature (013/020)');
select has_function('public', 'submit_candidacy_rpc',
       array['text','jsonb','uuid','text','text','text'],
       'submit_candidacy_rpc must exist with the canonical 6-arg submission signature (003/017/020)');
select has_function('public', 'current_app_role',
       array[]::text[],
       'current_app_role must exist (001 role helper)');
select has_function('public', 'current_commissioner_role',
       array[]::text[],
       'current_commissioner_role must exist (001 role helper)');

-- ---------------------------------------------------------------------
-- 4) One-vote contract (1) — D-06 integrity invariant
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class r on r.oid = c.conrelid
     join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'votes'
      and c.contype = 'u'
      and c.conname = 'votes_voter_id_position_election_period_id_key'),
  1,
  'votes must enforce one vote per voter/position/election period (unique constraint)');

-- ---------------------------------------------------------------------
-- 5) Storage policy intent (5) — the post-020 chain policy set
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'candidate pictures public read'),
  1,
  'storage: "candidate pictures public read" must exist (001, public select)');

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'candidate pictures public write'
      and cmd = 'INSERT'
      and with_check like '%candidate-pictures%'),
  1,
  'storage: "candidate pictures public write" must be an INSERT policy checked on the candidate-pictures bucket (020)');

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'candidate documents own read'
      and cmd = 'SELECT'
      and qual like '%candidate-documents%'
      and qual like '%candidate-pictures%'),
  1,
  'storage: "candidate documents own read" must be a SELECT policy over candidate-documents and candidate-pictures (020)');

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'private election docs upload'
      and cmd = 'INSERT'
      and with_check like '%candidate-documents%'
      and with_check like '%nomination-documents%'),
  1,
  'storage: "private election docs upload" must be an INSERT policy checked on candidate-documents/nomination-documents (020)');

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'private election docs role read'),
  1,
  'storage: "private election docs role read" must exist (001, admin-gated select)');

-- ---------------------------------------------------------------------
-- 6) Executable contract (1) — role helpers must run without error
-- ---------------------------------------------------------------------
select lives_ok(
  $$ select public.current_app_role() $$,
  'current_app_role() must execute without error');

select * from finish();
rollback;