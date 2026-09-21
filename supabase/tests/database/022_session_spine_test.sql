-- =====================================================================
-- 022_session_spine_test.sql
-- Phase 02, Plan 01 - Task 2 (session spine)
--
-- pgTAP contract test for migration 022: sessions table (hash-only,
-- deny-all RLS), header-based identity helpers, server-side token
-- minting, and the student login v2 entrypoint.
--
-- Header simulation follows the 010 technique:
--   select set_config('request.headers', '<json>', false)
-- which is transaction-local and readable by the security-definer helpers.
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(25);

-- ---------------------------------------------------------------------
-- 1) sessions table shape (6)
-- ---------------------------------------------------------------------
select has_table('public', 'sessions', 'sessions table must exist (022 session spine)');
select has_column('public', 'sessions', 'token_hash', 'sessions.token_hash must exist (SHA-256 of the raw token)');
select has_column('public', 'sessions', 'user_id', 'sessions.user_id must exist');
select has_column('public', 'sessions', 'user_role', 'sessions.user_role must exist');
select has_column('public', 'sessions', 'expires_at', 'sessions.expires_at must exist (24h fixed expiry)');
select has_column('public', 'sessions', 'created_at', 'sessions.created_at must exist');

-- ---------------------------------------------------------------------
-- 2) Session-spine functions exist (6)
-- ---------------------------------------------------------------------
select has_function('public', 'current_app_role',
       array[]::text[],
       'current_app_role must exist (header-based rewrite of the 001 helper)');
select has_function('public', 'current_commissioner_role',
       array[]::text[],
       'current_commissioner_role must exist (header-based rewrite of the 001 helper)');
select has_function('public', 'current_session_user_id',
       array[]::text[],
       'current_session_user_id must exist (session identity helper)');
select has_function('public', 'current_session_role',
       array[]::text[],
       'current_session_role must exist (session identity helper)');
select has_function('public', 'issue_session_token',
       array['uuid', 'text'],
       'issue_session_token must exist (server-side mint)');
select has_function('public', 'login_student_direct_v2',
       array['text', 'text'],
       'login_student_direct_v2 must exist (plaintext student login)');

-- ---------------------------------------------------------------------
-- 3) SECURITY DEFINER posture (6)
--    All session functions are definer-owned so they can read hashes and
--    bypass RLS on sessions WITHOUT exposing the table to clients.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_app_role' and p.prosecdef),
  1,
  'current_app_role must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_commissioner_role' and p.prosecdef),
  1,
  'current_commissioner_role must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_session_user_id' and p.prosecdef),
  1,
  'current_session_user_id must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_session_role' and p.prosecdef),
  1,
  'current_session_role must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'issue_session_token' and p.prosecdef),
  1,
  'issue_session_token must be SECURITY DEFINER');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'login_student_direct_v2' and p.prosecdef),
  1,
  'login_student_direct_v2 must be SECURITY DEFINER');

-- ---------------------------------------------------------------------
-- 4) Behavioural round-trip (6)
--    Mint a token server-side, present it through the Bearer header, and
--    verify the identity helpers resolve it (and only it).
-- ---------------------------------------------------------------------

-- Fixture: a synthetic identity (sessions.user_id is intentionally not
-- FK-bound - profiles only exist for auth.users-backed rows).
create temp table session_fixture (raw text, uid uuid, role text);
insert into session_fixture (raw, uid, role)
select public.issue_session_token(u.uuid, 'student'), u.uuid, 'student'
  from (select gen_random_uuid() as uuid) u;

select set_config(
  'request.headers',
  json_build_object('authorization', 'Bearer ' || (select raw from session_fixture))::text,
  false);

select is(
  (select public.current_session_user_id()),
  (select uid from session_fixture),
  'current_session_user_id resolves the Bearer token to the minted user');

select is(
  (select public.current_session_role()),
  (select role from session_fixture),
  'current_session_role resolves the Bearer token to the minted role');

select is(
  (select public.current_app_role()),
  (select role from session_fixture),
  'current_app_role reflects the session role (header trust path)');

-- One session per user: a second mint replaces the first.
select public.issue_session_token((select uid from session_fixture), 'student');
select is(
  (select count(*)::int from public.sessions where user_id = (select uid from session_fixture)),
  1,
  'minting a second token for the same user keeps exactly one active session (D-05)');

-- Expiry: an expired token resolves to NULL and its row is purged lazily
-- on presentation.
update public.sessions
   set expires_at = now() - interval '1 hour'
 where user_id = (select uid from session_fixture);

select set_config(
  'request.headers',
  json_build_object('authorization', 'Bearer ' || (select raw from session_fixture))::text,
  false);

select is(
  (select public.current_session_user_id()),
  null,
  'expired token resolves to NULL (not a session)');

select is(
  (select count(*)::int from public.sessions where user_id = (select uid from session_fixture)),
  0,
  'presenting an expired token purges the dead row (lazy cleanup)');

-- ---------------------------------------------------------------------
-- 5) Absence of a Bearer token (1)
-- ---------------------------------------------------------------------
select set_config('request.headers', '{}'::text, false);
select is(
  (select public.current_app_role()),
  null,
  'without an Authorization header, current_app_role is NULL (anon stays anon)');

select * from finish();
rollback;