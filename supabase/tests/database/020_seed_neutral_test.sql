-- =====================================================================
-- 020_seed_neutral_test.sql
-- Phase 01, Plan 03 — Task 1 (seed neutrality)
--
-- Regression test for T-02-01 (D-08): after a fresh database reset that
-- applies ONLY the consolidated migration chain (001-021, with seed-demo
-- NOT wired), no demo/dummy rows may exist.  The chain must be
-- self-neutralizing — 021_neutralize_seed_generators.sql clamps every
-- legacy generator, and the only demo source left is seed-demo.sql.
--
-- Each assertion is keyed on the exact demo fingerprint that
-- 021_neutralize_seed_generators.sql clamps on, so a resurrection of any
-- legacy generator path fails this suite loudly.
--
-- NOTE on "profiles with the demo email domain": public.profiles has no
-- email column (identity lives in students/officers/commissioners etc.),
-- so the demo-email-domain guard keys on the tables that actually carry
-- the demo emails introduced by 001/007.
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(7);

-- ---------------------------------------------------------------------
-- 1) Dummy students / masterlist / candidates (021 block A)
--    Pattern key: lrn like '136400%'       (016_seed_dummy_parties)
-- ---------------------------------------------------------------------
select is(
  (select count(*)::bigint
     from public.students
    where lrn like '136400%'),
  0::bigint,
  'no dummy student rows may be resurrected by the chain (lrn 136400...)');

select is(
  (select count(*)::bigint
     from public.student_masterlist
    where lrn like '136400%'),
  0::bigint,
  'no dummy masterlist rows may be resurrected by the chain (lrn 136400...)');

select is(
  (select count(*)::bigint
     from public.candidates c
     join public.students s on s.id = c.student_id
    where s.lrn like '136400%'),
  0::bigint,
  'no candidate rows may reference dummy students after the chain');

-- ---------------------------------------------------------------------
-- 2) Demo SSLG officer rows (021 block B)
--    Pattern key: the 13 known demo officer emails from 001 L750-771.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::bigint
     from public.officers
    where email = any (array[
      'president@cnnhs.edu', 'vice.president@cnnhs.edu', 'secretary@cnnhs.edu',
      'treasurer@cnnhs.edu', 'auditor@cnnhs.edu', 'pio@cnnhs.edu',
      'protocol@cnnhs.edu', 'grade7.rep@cnnhs.edu', 'grade8.rep@cnnhs.edu',
      'grade9.rep@cnnhs.edu', 'grade10.rep@cnnhs.edu', 'grade11.rep@cnnhs.edu',
      'grade12.rep@cnnhs.edu'])),
  0::bigint,
  'no legacy SSLG demo officer rows may be resurrected by the chain');

-- ---------------------------------------------------------------------
-- 3) Demo commissioner / adviser accounts (021 block C)
--    Pattern key: fixed demo auth.user UUIDs from 007 (021 clamps on
--    auth_id now, NOT on commissioner_role — a role-scoped delete would
--    have removed real commissioners appointed with other auth_ids).
-- ---------------------------------------------------------------------
select is(
  (select count(*)::bigint
     from public.commissioners
    where auth_id in (
      '22222222-2222-4222-8222-222222222222', -- screening_validation
      '33333333-3333-4333-8333-333333333333', -- electoral_board
      '44444444-4444-4444-8444-444444444444', -- appointment
      '55555555-5555-4555-8555-555555555555')), -- grievance
  0::bigint,
  'no demo commissioner accounts may survive the chain (021 deletes by demo auth_id; chief bootstrap excluded)');

select is(
  (select count(*)::bigint
     from public.sslg_advisers
    where auth_id = '66666666-6666-4666-8666-666666666666'),
  0::bigint,
  'no demo SSLG adviser rows may be resurrected by the chain (021 deletes by demo auth_id)');

select is(
  (select count(*)::bigint
     from auth.users
    where id in (
      '22222222-2222-4222-8222-222222222222', -- screening_validation
      '33333333-3333-4333-8333-333333333333', -- electoral_board
      '44444444-4444-4444-8444-444444444444', -- appointment
      '55555555-5555-4555-8555-555555555555', -- grievance
      '66666666-6666-4666-8666-666666666666')), -- sslg adviser
  0::bigint,
  'no demo auth.users rows may survive the chain (021 block C)');

select * from finish();
rollback;