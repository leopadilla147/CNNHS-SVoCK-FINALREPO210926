-- =====================================================================
-- 031_kiosk_gateway_and_verify_test.sql
-- Phase 05, Plan 05-03 - Task 1 (pgTAP contract test for migration 031)
--
-- Harness: 002_login_contract_test.sql conventions (fixtures inside a
-- transaction, try_* failure-shape capture, dead/anonymous probes).
--
-- Proves the 031 contracts:
--   * kiosk_devices carries auth_id (unique) + device_secret_hash;
--   * a legacy plaintext-ish 64-hex device secret row is backfilled
--     in-place to bcrypt and verifies via verify_kiosk_credentials_rpc;
--     a wrong secret fails; a missing auth_id fails; an unknown device
--     fails; success bumps last_seen_at;
--   * verify_student_credentials_rpc verifies BOTH a bcrypt-shaped
--     ('$2') student and a legacy 64-hex student; a wrong password
--     fails; a non-approved student is rejected;
--   * a successful verify mints EXACTLY the ticket rows: a sessions row
--     with user_role='student' and a ~5-minute TTL, while a pre-existing
--     web session for the same student SURVIVES (no delete-prior, B-2);
--   * an already-voted student gets the distinct has_voted flag and no
--     new ticket;
--   * the queue carries the D-10 adjudication columns while votes has
--     NO adjudication columns (information_schema assert, B-3);
--   * the queue's offline_vote_id unique constraint rejects a true
--     duplicate;
--   * votes.transaction_id is a partial UNIQUE index and rejects a
--     second row with the same transaction_id;
--   * both verifiers are anon+authenticated-granted, NOT PUBLIC.
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(31);

-- Fixture/behaviour helpers (002 try_v2 convention): call a (text, text)
-- verifier and return 'OK' on success or the raised message text.
create temporary function try_kiosk(p_auth_id text, p_secret text)
returns text
language plpgsql
as $$
begin
  begin
    perform public.verify_kiosk_credentials_rpc(p_auth_id, p_secret);
    return 'OK';
  exception when others then
    return sqlerrm;
  end;
end;
$$;

create temporary function try_student(p_lrn text, p_hash text)
returns text
language plpgsql
as $$
begin
  begin
    perform public.verify_student_credentials_rpc(p_lrn, p_hash);
    return 'OK';
  exception when others then
    return sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) Schema surface (5)
-- ---------------------------------------------------------------------
select has_column('public', 'kiosk_devices', 'auth_id',
       'kiosk_devices must carry the unique device auth_id (031)');
select has_column('public', 'kiosk_devices', 'device_secret_hash',
       'kiosk_devices must carry device_secret_hash (031)');
select has_function('public', 'verify_kiosk_credentials_rpc',
       array['text','text'],
       'verify_kiosk_credentials_rpc must exist (031 device verifier)');
select has_function('public', 'verify_student_credentials_rpc',
       array['text','text'],
       'verify_student_credentials_rpc must exist (031 student verifier)');
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public' and tablename = 'votes' and policyname = 'votes kiosk insert'),
  1,
  'the pre-existing "votes kiosk insert" policy still exists (revoked only in 032, R6)');

-- ---------------------------------------------------------------------
-- 2) Fixtures
-- ---------------------------------------------------------------------
-- Active election period (one_active_election partial unique: only one
-- active period may exist — the suite runs in a transaction, so this is
-- a temporary state).
insert into public.election_periods (school_year, is_active, start_at, end_at)
values ('2026-2027', true, now() - interval '1 hour', now() + interval '2 hours');

-- Legacy-shaped device secret: 64-hex SHA-256 (RESEARCH Pitfall 4 shape).
-- The 031 migration's backfill is idempotent and re-runnable, so the
-- suite re-creates the legacy column + row and re-runs the EXACT backfill
-- statement to prove the code path (the migration itself already ran).
alter table public.kiosk_devices add column if not exists device_secret text;

insert into public.kiosk_devices (name, location, auth_id, device_secret, device_secret_hash)
values ('Legacy Device', 'Test Hall A', '11111111-1111-4111-8111-111111111111',
        encode(sha256(convert_to('legacy-device-secret', 'UTF8')), 'hex'), null);

update public.kiosk_devices
   set device_secret_hash = crypt(device_secret, gen_salt('bf', 10))
 where device_secret_hash is null
   and device_secret ~ '^[0-9a-f]{64}$';

-- Modern bcrypt-shaped device (new-device contract: hash present, no
-- plaintext column value).
insert into public.kiosk_devices (name, location, auth_id, device_secret_hash)
values ('Modern Device', 'Test Hall B', '22222222-2222-4222-8222-222222222222',
        crypt(encode(sha256(convert_to('modern-device-secret', 'UTF8')), 'hex'), gen_salt('bf', 10)));

-- Bcrypt student: plaintext password 'kiosk-pin-1'; the kiosk presents
-- the SHA-256 hex of the PIN, so the stored bcrypt is over that hex
-- (the kiosk-native storage contract; 023-shaped = starts with '$2').
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'kiosk.bcrypt.031@test.local',
        crypt(encode(sha256(convert_to('kiosk-pin-1', 'UTF8')), 'hex'), gen_salt('bf', 10)),
        'KioskBcrypt', 'Student', 'Grade 11', 'Male', '2008-01-01', '120000000031',
        'approved', 'autoApproved', 0);

-- Legacy 64-hex student (not yet re-hashed).
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'kiosk.legacy.031@test.local',
        encode(sha256(convert_to('legacy-pin-1', 'UTF8')), 'hex'),
        'KioskLegacy', 'Student', 'Grade 10', 'Female', '2009-05-05', '120000000032',
        'approved', 'autoApproved', 0);

-- Already-voted student: a raised vote row for the active period.
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'kiosk.voted.031@test.local',
        crypt(encode(sha256(convert_to('voted-pin-1', 'UTF8')), 'hex'), gen_salt('bf', 10)),
        'KioskVoted', 'Student', 'Grade 12', 'Male', '2006-03-03', '120000000033',
        'approved', 'autoApproved', 0);

insert into public.votes (election_period_id, voter_id, position, abstained)
select e.id, s.id, 'President', true
  from public.election_periods e, public.students s
 where e.is_active = true and s.email = 'kiosk.voted.031@test.local';

-- Non-approved student (rejected) — must be refused by the verifier.
insert into public.students (id, email, password_hash, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values (gen_random_uuid(), 'kiosk.rejected.031@test.local',
        crypt('rejected-pin-1', gen_salt('bf', 10)),
        'KioskRejected', 'Student', 'Grade 9', 'Female', '2011-07-07', '120000000034',
        'rejected', 'forReview', 0);

-- ---------------------------------------------------------------------
-- 3) Device verifier (6)
-- ---------------------------------------------------------------------
select is(
  (select starts_with(device_secret_hash, '$2')
     from public.kiosk_devices d where d.name = 'Legacy Device'),
  true,
  'a legacy 64-hex device secret is backfilled in-place to the bcrypt prefix (031)');

select is(
  (select try_kiosk('11111111-1111-4111-8111-111111111111',
                    encode(sha256(convert_to('legacy-device-secret', 'UTF8')), 'hex'))),
  'OK',
  'the backfilled legacy device secret verifies via verify_kiosk_credentials_rpc');

select is(
  (select try_kiosk('11111111-1111-4111-8111-111111111111', 'wrong-device-secret')),
  'Invalid device secret',
  'a wrong device secret is rejected');

select is(
  (select try_kiosk(null, 'whatever')),
  'Missing device credentials',
  'a missing auth_id fails cleanly');

select is(
  (select try_kiosk('99999999-9999-4999-8999-999999999999', 'any-secret')),
  'Unknown kiosk device',
  'an unknown device auth_id is rejected');

select is(
  (select try_kiosk('22222222-2222-4222-8222-222222222222',
                    encode(sha256(convert_to('modern-device-secret', 'UTF8')), 'hex'))),
  'OK',
  'a modern bcrypt-hashed device verifies (new-device contract)');

select is(
  (select (last_seen_at > now() - interval '10 seconds')
     from public.kiosk_devices d where d.name = 'Modern Device'),
  true,
  'a successful device verify bumps last_seen_at (liveness probe)');

-- ---------------------------------------------------------------------
-- 4) Student verifier — both hash formats (4)
-- ---------------------------------------------------------------------
select is(
  (select try_student('120000000031',
                      encode(sha256(convert_to('kiosk-pin-1', 'UTF8')), 'hex'))),
  'OK',
  'a 023-shaped bcrypt student verifies via verify_student_credentials_rpc');

select is(
  (select try_student('120000000032',
                      encode(sha256(convert_to('legacy-pin-1', 'UTF8')), 'hex'))),
  'OK',
  'a legacy 64-hex SHA-256 student verifies (not-yet-rehashed rows accepted)');

select is(
  (select try_student('120000000031',
                      encode(sha256(convert_to('wrong-pin', 'UTF8')), 'hex'))),
  'Invalid password',
  'a wrong password is rejected');

select is(
  (select try_student('120000000034',
                      encode(sha256(convert_to('rejected-pin-1', 'UTF8')), 'hex'))),
  'Student not found or not approved',
  'a non-approved student is refused');

-- ---------------------------------------------------------------------
-- 5) Ticket minting (4) — verify the bcrypt student again and inspect
--    the sessions table: EXACTLY the ticket row, ~5min TTL, and a
--    pre-existing web session SURVIVES (B-2 no delete-prior).
-- ---------------------------------------------------------------------
-- A web session minted by the REAL login path (delete-prior semantics) —
-- represents the student's active browser session.
create temp table t_web_token (raw_token text);
insert into t_web_token
select public.issue_session_token(s.id, 'student')
  from public.students s
 where s.email = 'kiosk.bcrypt.031@test.local';

select is(
  (select try_student('120000000031',
                      encode(sha256(convert_to('kiosk-pin-1', 'UTF8')), 'hex'))),
  'OK',
  'the bcrypt student verifies again to mint the voter ticket');

select is(
  (select count(*)::int
     from public.sessions s
     join public.students st on st.id = s.user_id
    where st.email = 'kiosk.bcrypt.031@test.local'
      and s.user_role = 'student'),
  2,
  'successful verify mints EXACTLY the ticket row alongside the pre-existing web session (B-2)');

select is(
  (select (s.expires_at between now() + interval '4 minutes' and now() + interval '6 minutes')
     from public.sessions s
     join public.students st on st.id = s.user_id
    where st.email = 'kiosk.bcrypt.031@test.local'
      and s.token_hash <> encode(sha256(convert_to((select raw_token from t_web_token), 'UTF8')), 'hex')),
  true,
  'the minted ticket expires in ~5 minutes (short-lived voter ticket)');

select is(
  (select count(*)::int
     from public.sessions
    where token_hash = encode(sha256(convert_to((select raw_token from t_web_token), 'UTF8')), 'hex')),
  1,
  'the pre-existing web session SURVIVES the ticket mint (no delete-prior, B-2)');

-- ---------------------------------------------------------------------
-- 6) Already-voted flag (2)
-- ---------------------------------------------------------------------
select is(
  (select has_voted
     from public.verify_student_credentials_rpc('120000000033',
                       encode(sha256(convert_to('voted-pin-1', 'UTF8')), 'hex'))),
  true,
  'an already-voted student receives the distinct has_voted flag');

select is(
  (select count(*)::int
     from public.sessions s
     join public.students st on st.id = s.user_id
    where st.email = 'kiosk.voted.031@test.local'),
  0,
  'an already-voted student gets NO new ticket (flag only)');

-- ---------------------------------------------------------------------
-- 7) Queue D-10 columns / votes adjudication-free (B-3) (4)
-- ---------------------------------------------------------------------
select has_column('public', 'kiosk_vote_queue', 'linked_vote_id',
       'kiosk_vote_queue must carry linked_vote_id (D-10 adjudication)');
select has_column('public', 'kiosk_vote_queue', 'adjudicated_by',
       'kiosk_vote_queue must carry adjudicated_by (D-10)');
select has_column('public', 'kiosk_vote_queue', 'adjudicated_at',
       'kiosk_vote_queue must carry adjudicated_at (D-10)');
select is(
  (select count(*)::int
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'votes'
      and column_name in ('linked_vote_id', 'adjudicated_by', 'adjudicated_at')),
  0,
  'votes carries NO adjudication columns (the machine lives on the queue, B-3)');

-- ---------------------------------------------------------------------
-- 8) Queue unique + transaction_id unique (3)
-- ---------------------------------------------------------------------
insert into public.kiosk_vote_queue (kiosk_id, election_period_id, offline_vote_id, encrypted_payload, queued_at)
select d.id, e.id, 'offline-031-1', convert_to('{"selections":[]}', 'UTF8'), now()
  from public.kiosk_devices d, public.election_periods e
 where d.name = 'Modern Device' and e.is_active = true;

select throws_ok(
  $$insert into public.kiosk_vote_queue (kiosk_id, election_period_id, offline_vote_id, encrypted_payload, queued_at)
    select d.id, e.id, 'offline-031-1', convert_to('{"selections":[]}', 'UTF8'), now()
      from public.kiosk_devices d, public.election_periods e
     where d.name = 'Modern Device' and e.is_active = true$$,
  '23505',
  NULL,
  'a duplicate offline_vote_id violates the queue unique constraint (idempotency anchor)');

select has_index('public', 'votes', 'votes_transaction_id_key',
       'votes carries the partial UNIQUE transaction_id index (031, replaces 019 idx)');

select throws_ok(
  $$insert into public.votes (id, election_period_id, voter_id, position, abstained, transaction_id)
    select gen_random_uuid(), e.id, s.id, 'President', true, 'dup-txn-031'
      from public.election_periods e, public.students s
     where e.is_active = true and s.email = 'kiosk.bcrypt.031@test.local';
    insert into public.votes (id, election_period_id, voter_id, position, abstained, transaction_id)
    select gen_random_uuid(), e.id, s.id, 'Vice President', true, 'dup-txn-031'
      from public.election_periods e, public.students s
     where e.is_active = true and s.email = 'kiosk.bcrypt.031@test.local$$,
  '23505',
  NULL,
  'a second votes row with the same transaction_id is rejected (DB-enforced replay)');

-- ---------------------------------------------------------------------
-- 9) Grant posture (2)
-- ---------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'public.verify_student_credentials_rpc(text, text)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on verify_student_credentials_rpc (edge gateway surface)');

select is(
  has_function_privilege('public', 'public.verify_kiosk_credentials_rpc(text, text)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on verify_kiosk_credentials_rpc (least privilege)');

select * from finish();
rollback;