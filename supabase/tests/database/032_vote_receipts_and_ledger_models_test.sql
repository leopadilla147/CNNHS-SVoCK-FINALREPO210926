-- =====================================================================
-- 032_vote_receipts_and_ledger_models_test.sql
-- Phase 05, Plan 05-03 - Task 3 (pgTAP contract test for migration 032)
--
-- Harness: 002/030/031 conventions (fixtures inside a transaction).
--
-- Proves the 032 contracts (D-06/D-07/R6/W-1):
--   * vote_receipts exists with the D-06 shape (vote_id PK cascade,
--     receipt_code + code_hash unique, election/position/candidate);
--   * an AFTER INSERT trigger on votes writes the receipt IN the vote
--     transaction: a direct vote insert produces EXACTLY one receipt row
--     with a 10-char Crockford base32 code and the matching SHA-256
--     code_hash;
--   * R6: a direct votes INSERT executed as the anon role FAILS (the
--     permissive 001 'votes kiosk insert' policy is dropped; client roles
--     keep ONLY submit_vote_rpc's security-definer path);
--   * submit_vote_rpc with a student web session returns the receipts
--     array; a same-token replay creates NO duplicate votes and returns
--     the same receipts (deterministic transaction ids, 031 unique index);
--   * verify_receipt_rpc round-trips the stored receipt (display-only
--     plaintext code pre-release) and returns nothing for an unknown code;
--   * the kiosk voter path works: a 031 voter TICKET session submits
--     through submit_vote_rpc and gets receipts (kiosk_id stays null for
--     ticket sessions - the kiosk sync path records the device).
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(24);

-- ---------------------------------------------------------------------
-- 1) Schema surface (8)
-- ---------------------------------------------------------------------
select has_table('public', 'vote_receipts',
       'vote_receipts must exist (D-06 immutable receipt ledger)');
select has_column('public', 'vote_receipts', 'receipt_code',
       'vote_receipts must carry the display-only receipt code');
select has_column('public', 'vote_receipts', 'code_hash',
       'vote_receipts must carry the committed SHA-256 code_hash (D-07)');
select has_function('public', 'generate_vote_receipt_code',
       array[]::text[],
       'generate_vote_receipt_code must exist (Crockford base32 generator)');
select has_function('public', 'submit_vote_rpc',
       array['text','jsonb'],
       'submit_vote_rpc must exist (web cast surface, W-1)');
select has_function('public', 'verify_receipt_rpc',
       array['text'],
       'verify_receipt_rpc must exist (receipt lookup, D-07)');
select has_function('public', 'sync_kiosk_votes_rpc',
       array['uuid','uuid','uuid','jsonb'],
       'sync_kiosk_votes_rpc must exist (atomic kiosk sync core, B-3)');
select has_trigger('public.votes', 'on_vote_insert_charge_receipt',
       'votes must carry the receipt-charging trigger (D-06)');

-- ---------------------------------------------------------------------
-- 2) Fixtures
-- ---------------------------------------------------------------------
-- Active election period + approved students (web path + kiosk path).
insert into public.election_periods (school_year, is_active, start_at, end_at)
values ('2026-2027', true, now() - interval '1 hour', now() + interval '2 hours');

insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'web.voter.032@test.local',
        crypt('web-pass-1', gen_salt('bf', 10)),
        'Web', 'Voter', 'Grade 11', 'Male', '2008-01-01', '120000000041',
        'approved', 'autoApproved', 0);

-- Kiosk-path student (bcrypt over the SHA-256 hex, the kiosk-native shape).
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'kiosk.voter.032@test.local',
        crypt(encode(sha256(convert_to('kiosk-pin-032', 'UTF8')), 'hex'), gen_salt('bf', 10)),
        'Kiosk', 'Voter', 'Grade 12', 'Female', '2006-02-02', '120000000042',
        'approved', 'autoApproved', 0);

-- Direct-insert fixture (section 3 only): its vote carries NO
-- transaction_id, so it must never touch the submit path (whose
-- already-voted pre-check treats NULL-transaction rows as foreign).
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'direct.voter.032@test.local',
        crypt('direct-pass-1', gen_salt('bf', 10)),
        'Direct', 'Voter', 'Grade 10', 'Male', '2009-04-04', '120000000043',
        'approved', 'autoApproved', 0);

-- ---------------------------------------------------------------------
-- 3) Direct vote insert -> receipt row created in-transaction (3)
-- ---------------------------------------------------------------------
insert into public.votes (election_period_id, voter_id, "position", abstained)
select e.id, s.id, 'President', true
  from public.election_periods e, public.students s
 where e.is_active = true and s.email = 'direct.voter.032@test.local';

select is(
  (select count(*)::int
     from public.vote_receipts vr
     join public.votes v on v.id = vr.vote_id
    where v.voter_id = (select id from public.students where email = 'direct.voter.032@test.local')),
  1,
  'a direct vote insert produces EXACTLY one receipt row in-transaction (D-06)');

select is(
  (select (vr.receipt_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$')
     from public.vote_receipts vr
     join public.votes v on v.id = vr.vote_id
    where v.voter_id = (select id from public.students where email = 'direct.voter.032@test.local')),
  true,
  'the receipt code is 10-char Crockford base32 (excludes I/L/O/U)');

select is(
  (select (vr.code_hash = encode(sha256(convert_to(vr.receipt_code, 'UTF8')), 'hex'))
     from public.vote_receipts vr
     join public.votes v on v.id = vr.vote_id
    where v.voter_id = (select id from public.students where email = 'direct.voter.032@test.local')),
  true,
  'code_hash is the SHA-256 of the receipt code (D-07 committed value)');

-- ---------------------------------------------------------------------
-- 4) R6 - anon direct votes INSERT fails (1)
--    The suite runs as the migration owner (bypasses RLS), so the anon
--    execution role is asserted explicitly: set local role anon -> the
--    insert has NO permissive policy left ('votes kiosk insert' dropped)
--    -> 42501.  The role is restored immediately after (transactional).
-- ---------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$insert into public.votes (election_period_id, voter_id, "position", abstained)
    select e.id, s.id, 'Secretary', true
      from public.election_periods e, public.students s
     where e.is_active = true and s.email = 'kiosk.voter.032@test.local'$$,
  '42501',
  NULL,
  'a direct votes INSERT by a client role fails (R6: the permissive "votes kiosk insert" policy is gone)');
reset role;

-- ---------------------------------------------------------------------
-- 5) submit_vote_rpc as a student web session (4)
-- ---------------------------------------------------------------------
create temp table t_submit_token (raw_token text);
insert into t_submit_token
select public.issue_session_token(s.id, 'student')
  from public.students s
 where s.email = 'web.voter.032@test.local';

-- Two abstain selections for two positions (the RPC generates a
-- transaction_id per selection, D-06).
select is(
  (select count(*)::int
     from public.submit_vote_rpc(
       (select raw_token from t_submit_token),
       '[{"position":"Treasurer","abstained":true},{"position":"Auditor","abstained":true}]'::jsonb)),
  2,
  'submit_vote_rpc with a student session returns the receipts array once (W-1)');

select is(
  (select count(*)::int
     from public.votes v
     join public.students s on s.id = v.voter_id
    where s.email = 'web.voter.032@test.local'
      and v."position" in ('Treasurer', 'Auditor')),
  2,
  'submit_vote_rpc inserts one votes row per selection');

select is(
  (select bool_and(v.transaction_id is not null)
     from public.votes v
     join public.students s on s.id = v.voter_id
    where s.email = 'web.voter.032@test.local'
      and v."position" in ('Treasurer', 'Auditor')),
  true,
  'every web-submitted vote carries a server-generated transaction_id (D-06)');

-- Same-token replay: deterministic transaction ids -> no duplicates.
select is(
  (select count(*)::int
     from public.submit_vote_rpc(
       (select raw_token from t_submit_token),
       '[{"position":"Treasurer","abstained":true},{"position":"Auditor","abstained":true}]'::jsonb)),
  2,
  'a same-token replay returns the SAME receipts (no second mint trip, D-06)');

select is(
  (select count(*)::int
     from public.votes v
     join public.students s on s.id = v.voter_id
    where s.email = 'web.voter.032@test.local'
      and v."position" in ('Treasurer', 'Auditor')),
  2,
  'the replay created NO duplicate votes rows (031 transaction_id unique)');

-- ---------------------------------------------------------------------
-- 6) verify_receipt_rpc round-trip (2)
-- ---------------------------------------------------------------------
select is(
  (select (verify_receipt_rpc.receipt_code = vr.receipt_code
            and verify_receipt_rpc.code_hash = vr.code_hash)
     from public.vote_receipts vr
     join public.votes v on v.id = vr.vote_id
     join public.students s on s.id = v.voter_id
     join lateral public.verify_receipt_rpc(vr.receipt_code) verify_receipt_rpc on true
    where s.email = 'web.voter.032@test.local'
      and v."position" = 'Treasurer'),
  true,
  'verify_receipt_rpc round-trips the stored receipt + code_hash (display-only pre-release, D-07)');

select is(
  (select count(*)::int
     from public.verify_receipt_rpc('NOPE-NOPE-01')),
  0,
  'verify_receipt_rpc returns nothing for an unknown code');

-- ---------------------------------------------------------------------
-- 7) Kiosk voter path via the 031 ticket (2)
-- ---------------------------------------------------------------------
create temp table t_ticket (raw_ticket text);
insert into t_ticket
select voter_ticket
  from public.verify_student_credentials_rpc(
    '120000000042',
    encode(sha256(convert_to('kiosk-pin-032', 'UTF8')), 'hex'));

select is(
  (select count(*)::int
     from public.submit_vote_rpc(
       (select raw_ticket from t_ticket),
       '[{"position":"PRO","abstained":true}]'::jsonb)),
  1,
  'the kiosk voter path works through submit_vote_rpc with the 031 ticket (receipts returned)');

select is(
  (select count(*)::int
     from public.votes v
     join public.students s on s.id = v.voter_id
    where s.email = 'kiosk.voter.032@test.local'
      and v."position" = 'PRO'),
  1,
  'the ticket submission created exactly one votes row');

-- ---------------------------------------------------------------------
-- 8) R6 policy + grant posture (3)
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename = 'votes'
      and policyname = 'votes kiosk insert'),
  0,
  'the permissive "votes kiosk insert" policy is REMOVED (R6; also the 002 4d hard assertion)');

select is(
  has_function_privilege('anon', 'public.submit_vote_rpc(text, jsonb)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on submit_vote_rpc (the security-definer web cast surface)');

select is(
  has_function_privilege('anon', 'public.verify_receipt_rpc(text)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on verify_receipt_rpc (receipt lookup surface)');

select * from finish();
rollback;