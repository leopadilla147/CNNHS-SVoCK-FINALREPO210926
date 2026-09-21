-- =====================================================================
-- 029_election_config_test.sql
-- Phase 04, Plan 01 - Task 3 (election config columns)
--
-- Contract test for migration 029: the rules_discussion_at and
-- voting_method columns (ELECT-01 / APPROV-01 groundwork, D-06 set),
-- the 'plurality' default (RESEARCH A3/A4 - existing period rows keep
-- a valid value without an UPDATE), and the named CHECK rejecting any
-- method outside the three D-06 values.
--
-- 029 creates no functions (the adjudication RPCs live in 028), so
-- this suite asserts the schema contract only; the 028 suite asserts
-- its own function creations via has_function.
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(11);

-- ---------------------------------------------------------------------
-- 1) Both columns exist on election_periods (2)
-- ---------------------------------------------------------------------
select has_column('public', 'election_periods', 'rules_discussion_at',
       'rules_discussion_at exists on election_periods (ELECT-01 meeting-notice source)');
select has_column('public', 'election_periods', 'voting_method',
       'voting_method exists on election_periods (D-06 config)');

-- ---------------------------------------------------------------------
-- 2) voting_method NOT NULL with the 'plurality' default (2)
--    Default is what keeps existing period rows (2026-2027) valid
--    without an UPDATE (RESEARCH A3/A4).
-- ---------------------------------------------------------------------
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'election_periods' and column_name = 'voting_method'),
  '''plurality''::text',
  'voting_method defaults to ''plurality''');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'election_periods' and column_name = 'voting_method'),
  'NO',
  'voting_method is NOT NULL');

-- ---------------------------------------------------------------------
-- 3) Existing rows are untouched by the additive columns (1)
--    001 seeds the 2026-2027 period; it must keep a valid default
--    value without any UPDATE (A4).
-- ---------------------------------------------------------------------
select is(
  (select voting_method from public.election_periods
    where school_year = '2026-2027'),
  'plurality',
  'the seeded 2026-2027 period carries the ''plurality'' default');

-- ---------------------------------------------------------------------
-- 4) Named CHECK: bogus methods raise, all three D-06 values pass (4)
-- ---------------------------------------------------------------------
select throws_ok(
  $$update public.election_periods set voting_method = 'first_past_the_post' where school_year = '2026-2027'$$,
  '23514',
  'election_periods_voting_method_check',
  'a voting method outside the D-06 set is rejected by the named CHECK');

select lives_ok(
  $$update public.election_periods set voting_method = 'plurality_with_run_off' where school_year = '2026-2027'$$,
  'plurality_with_run_off is a valid D-06 value');
select lives_ok(
  $$update public.election_periods set voting_method = 'ranked_choice' where school_year = '2026-2027'$$,
  'ranked_choice is a valid D-06 value');
select lives_ok(
  $$update public.election_periods set voting_method = 'plurality' where school_year = '2026-2027'$$,
  'plurality is a valid D-06 value');

-- ---------------------------------------------------------------------
-- 5) rules_discussion_at round-trips a timestamp (1)
--    APPROV-01 meeting-notice source: write then read.
-- ---------------------------------------------------------------------
update public.election_periods
   set rules_discussion_at = '2026-10-01T09:00:00Z'
 where school_year = '2026-2027';
select is(
  (select rules_discussion_at from public.election_periods where school_year = '2026-2027'),
  '2026-10-01T09:00:00Z'::timestamptz,
  'rules_discussion_at stores the meeting timestamp');

-- ---------------------------------------------------------------------
-- 6) 029 touches ONLY election_periods (1)
--    Idempotent alias guard: the exact CHECK name exists once.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.conname = 'election_periods_voting_method_check'
      and c.conrelid = 'public.election_periods'::regclass),
  1,
  'the named voting-method CHECK exists exactly once on election_periods');

select * from finish();
rollback;