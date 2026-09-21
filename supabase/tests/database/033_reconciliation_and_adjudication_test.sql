-- =====================================================================
-- 033_reconciliation_and_adjudication_test.sql
-- Phase 05, Plan 05-04 - Task 1 (pgTAP contract test for migration 033)
--
-- Harness: 002_login_contract_test.sql conventions (fixtures inside a
-- transaction, try_* failure-shape capture, simulated session headers via
-- set_config('request.headers', ...) — the 028 pattern).
--
-- Proves the 033 contracts:
--   * get_reconciliation_rpc exists as SECURITY DEFINER and is admin/anon-
--     granted (not PUBLIC);
--   * seeded queue rows produce EXACT per-kiosk counts (pending/synced/
--     duplicate/invalid/conflict) — deny-constraint-derived, no stored
--     counters;
--   * counted = synced rows whose offline_vote_id produced a votes row
--     (matches the queue→votes join), queued = all non-synced rows;
--   * totals: approved / voted / not_voted derived for the balance report;
--   * adjudicate_vote_rpc: non-admin denied (anonymous + sslg_adviser),
--     status whitelist (pending/synced rejected), linked-vote required for
--     duplicate/conflict (same election), note required for invalid,
--     post-publish fixed error, re-adjudication allowed with audit-row
--     accumulation, counts STAY derived and consistent after flips, and
--     votes keeps ZERO adjudication columns (B-3).
--
-- Runs inside a transaction; safe to re-run.
-- =====================================================================

begin;

select plan(55);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
create temp table t_base (approved int);
insert into t_base select count(*)::int from public.students where status = 'approved';

create temp table t_admin_token (raw text);
insert into t_admin_token select public.issue_session_token('20000000-0000-4000-8000-000000000010', 'admin');

create temp table t_sslg_token (raw text);
insert into t_sslg_token select public.issue_session_token('20000000-0000-4000-8000-000000000011', 'sslg_adviser');

-- Election E (the reconciled one) + election E2 (for the cross-election
-- linked-vote rejection).  Both inactive so the one_active_election
-- partial unique index (001:217) is untouched.
insert into public.election_periods (id, school_year, is_active, results_published)
values ('20000000-0000-4000-8000-000000000001', '2099-033-TEST', false, false);

insert into public.election_periods (id, school_year, is_active, results_published)
values ('20000000-0000-4000-8000-000000000002', '2099-033-TEST-B', false, false);

-- Students: s1, s2 approved voters; s3 rejected (never counted).
insert into public.students (id, email, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values ('20000000-0000-4000-8000-000000000021', 'recon.s1@test.local', 'Recon', 'One', 'Grade 11', 'Male', '2009-01-01', '130000000001', 'approved', 'autoApproved', 0);

insert into public.students (id, email, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values ('20000000-0000-4000-8000-000000000022', 'recon.s2@test.local', 'Recon', 'Two', 'Grade 12', 'Female', '2008-02-02', '130000000002', 'approved', 'autoApproved', 0);

insert into public.students (id, email, first_name, last_name, grade_level, gender, birthdate, lrn, status, verification_status, mismatch_count)
values ('20000000-0000-4000-8000-000000000023', 'recon.s3@test.local', 'Recon', 'Three', 'Grade 10', 'Male', '2010-03-03', '130000000003', 'rejected', 'forReview', 0);

-- Two kiosks.
insert into public.kiosk_devices (id, name, location)
values ('20000000-0000-4000-8000-000000000031', 'Kiosk Alpha', 'Hall A');

insert into public.kiosk_devices (id, name, location)
values ('20000000-0000-4000-8000-000000000032', 'Kiosk Bravo', 'Hall B');

-- One candidate (President, student s1) for the non-abstain vote v3.
insert into public.candidates (id, student_id, election_period_id, surname, given_name, grade_level, position, gender, date_of_birth, age, email, mobile_number, status)
values ('20000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-000000000021',
        '20000000-0000-4000-8000-000000000001', 'Alpha', 'Pres', 'Grade 11', 'President',
        'Male', '2009-01-01', 17, 'cand.alpha@test.local', '0917 000 0001', 'approved');

-- Votes: v3 (kiosk Alpha synced ballot — counted), v9 (kiosk Bravo synced
-- ballot — counted), vx (web vote, no queue row), vx2 (vote in ANOTHER
-- election — used to prove the same-election linked-vote guard).
insert into public.votes (id, election_period_id, voter_id, candidate_id, "position", offline_vote_id, transaction_id, abstained)
values ('20000000-0000-4000-8000-000000000051', '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000041',
        'President', 'o-003', 'tx-v3', false);

insert into public.votes (id, election_period_id, voter_id, "position", offline_vote_id, transaction_id, abstained)
values ('20000000-0000-4000-8000-000000000052', '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000021', 'Vice President', 'o-009', 'tx-v9', true);

insert into public.votes (id, election_period_id, voter_id, "position", transaction_id, abstained)
values ('20000000-0000-4000-8000-000000000053', '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000022', 'Secretary', 'tx-vx', true);

insert into public.votes (id, election_period_id, voter_id, "position", transaction_id, abstained)
values ('20000000-0000-4000-8000-000000000054', '20000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000023', 'President', 'tx-vx2', true);

-- Queue rows (10) — the D-10 machine fixture.
-- Kiosk Alpha: q1, q2 pending; q3 synced WITH votes row (counted);
-- q4 synced WITHOUT votes row (SYNC_INTEGRITY case — marked synced but
-- never counted); q5 duplicate; q6 invalid; q7 conflict.
insert into public.kiosk_vote_queue (id, kiosk_id, election_period_id, offline_vote_id, encrypted_payload, conflict_status, queued_at)
values
  ('20000000-0000-4000-8000-000000000061', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-001', convert_to('{"s":[]}', 'UTF8'), 'pending', now() - interval '3 hours'),
  ('20000000-0000-4000-8000-000000000062', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-002', convert_to('{"s":[]}', 'UTF8'), 'pending', now() - interval '2 hours'),
  ('20000000-0000-4000-8000-000000000063', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-003', convert_to('{"s":[]}', 'UTF8'), 'synced',  now() - interval '6 hours'),
  ('20000000-0000-4000-8000-000000000064', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-004', convert_to('{"s":[]}', 'UTF8'), 'synced',  now() - interval '5 hours'),
  ('20000000-0000-4000-8000-000000000065', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-005', convert_to('{"s":[]}', 'UTF8'), 'duplicate', now() - interval '4 hours'),
  ('20000000-0000-4000-8000-000000000066', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-006', convert_to('{"s":[]}', 'UTF8'), 'invalid',  now() - interval '4 hours'),
  ('20000000-0000-4000-8000-000000000067', '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'o-007', convert_to('{"s":[]}', 'UTF8'), 'conflict', now() - interval '4 hours'),
  ('20000000-0000-4000-8000-000000000068', '20000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000001', 'o-008', convert_to('{"s":[]}', 'UTF8'), 'pending', now() - interval '3 hours'),
  ('20000000-0000-4000-8000-000000000069', '20000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000001', 'o-009', convert_to('{"s":[]}', 'UTF8'), 'synced',  now() - interval '6 hours'),
  ('20000000-0000-4000-8000-000000000070', '20000000-0000-4000-8000-000000000032', '20000000-0000-4000-8000-000000000001', 'o-010', convert_to('{"s":[]}', 'UTF8'), 'duplicate', now() - interval '4 hours');

-- The two synced rows with votes rows need synced_at (the sync path sets
-- it; the fixture mirrors that so the reconciliation read sees canonical
-- state).
update public.kiosk_vote_queue set synced_at = now() - interval '5 hours'
 where id in ('20000000-0000-4000-8000-000000000063', '20000000-0000-4000-8000-000000000064',
              '20000000-0000-4000-8000-000000000069');

-- Role gate helpers.
create temporary function set_admin_header()
returns void
language plpgsql
as $$
begin
  perform set_config('request.headers',
    json_build_object('authorization', 'Bearer ' || (select raw from t_admin_token))::text, false);
end;
$$;

create temporary function set_sslg_header()
returns void
language plpgsql
as $$
begin
  perform set_config('request.headers',
    json_build_object('authorization', 'Bearer ' || (select raw from t_sslg_token))::text, false);
end;
$$;

-- Adjudication failure-shape helper (002 try_v2 convention).
create temporary function try_adj(p_row uuid, p_status text, p_note text, p_link uuid)
returns text
language plpgsql
as $$
begin
  begin
    perform public.adjudicate_vote_rpc('20000000-0000-4000-8000-000000000001', p_row, p_status, p_note, p_link);
    return 'OK';
  exception when others then
    return sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) Schema surface (4)
-- ---------------------------------------------------------------------
select has_function('public', 'get_reconciliation_rpc', array['uuid'],
       'get_reconciliation_rpc must exist (033 reconciliation read model)');
select has_function('public', 'adjudicate_vote_rpc', array['uuid','uuid','text','text','uuid'],
       'adjudicate_vote_rpc must exist (033 adjudication RPC)');
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_reconciliation_rpc', 'adjudicate_vote_rpc')
      and p.prosecdef),
  2,
  'both 033 RPCs must be SECURITY DEFINER');
select is(
  (select count(*)::int
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'votes'
      and column_name in ('linked_vote_id', 'adjudicated_by', 'adjudicated_at')),
  0,
  'votes carries NO adjudication columns (the machine lives on the queue, B-3)');

-- ---------------------------------------------------------------------
-- 2) Grant posture (3)
-- ---------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'public.get_reconciliation_rpc(uuid)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on get_reconciliation_rpc (SPA surface)');
select is(
  has_function_privilege('anon', 'public.adjudicate_vote_rpc(uuid, uuid, text, text, uuid)', 'EXECUTE'),
  true,
  'anon is granted EXECUTE on adjudicate_vote_rpc (SPA surface)');
select is(
  has_function_privilege('public', 'public.adjudicate_vote_rpc(uuid, uuid, text, text, uuid)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on adjudicate_vote_rpc (least privilege)');

-- ---------------------------------------------------------------------
-- 3) Role gates (4) — anonymous + sslg_adviser denied on both RPCs
-- ---------------------------------------------------------------------
select set_config('request.headers', '{}'::text, false);
select throws_ok(
  $$select public.get_reconciliation_rpc('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  NULL,
  'anonymous caller is rejected by get_reconciliation_rpc');
select throws_ok(
  $$select public.adjudicate_vote_rpc('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000061', 'duplicate', 'note', null)$$,
  'P0001',
  NULL,
  'anonymous caller is rejected by adjudicate_vote_rpc');
select set_sslg_header();
select throws_ok(
  $$select public.adjudicate_vote_rpc('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000061', 'duplicate', 'note', null)$$,
  'P0001',
  NULL,
  'sslg_adviser session is rejected by adjudicate_vote_rpc');
select throws_ok(
  $$select public.get_reconciliation_rpc('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  NULL,
  'sslg_adviser session is rejected by get_reconciliation_rpc');

-- ---------------------------------------------------------------------
-- 4) Reconciliation happy path (admin session) — exact derived counts
-- ---------------------------------------------------------------------
select set_admin_header();

create temp table t_rec (r jsonb);
insert into t_rec select public.get_reconciliation_rpc('20000000-0000-4000-8000-000000000001');

select is(
  jsonb_array_length((select r -> 'kiosks' from t_rec)),
  2,
  'every registered kiosk appears in the reconciliation (Kiosk Alpha + Kiosk Bravo)');

select is(
  (select (k ->> 'pending')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  2,
  'Kiosk Alpha pending = 2 (derived from conflict_status, no stored counter)');
select is(
  (select (k ->> 'synced')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  2,
  'Kiosk Alpha synced = 2 (q3 with votes row + q4 without)');
select is(
  (select (k ->> 'duplicate')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  1,
  'Kiosk Alpha duplicate = 1');
select is(
  (select (k ->> 'invalid')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  1,
  'Kiosk Alpha invalid = 1');
select is(
  (select (k ->> 'conflict')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  1,
  'Kiosk Alpha conflict = 1');
select is(
  (select (k ->> 'counted')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  1,
  'Kiosk Alpha counted = 1 (only q3: synced AND offline_vote_id produced a votes row)');
select is(
  (select (k ->> 'queued')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  5,
  'Kiosk Alpha queued = 5 (all non-synced rows: 2 pending + 1 duplicate + 1 invalid + 1 conflict)');

select is(
  (select (k ->> 'pending')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Bravo'),
  1,
  'Kiosk Bravo pending = 1');
select is(
  (select (k ->> 'synced')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Bravo'),
  1,
  'Kiosk Bravo synced = 1');
select is(
  (select (k ->> 'counted')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Bravo'),
  1,
  'Kiosk Bravo counted = 1 (q9 synced with votes row)');
select is(
  (select (k ->> 'queued')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k
    where k ->> 'name' = 'Kiosk Bravo'),
  2,
  'Kiosk Bravo queued = 2 (1 pending + 1 duplicate)');

select is(
  (select coalesce(sum((k ->> 'counted')::int), 0)
     from jsonb_array_elements((select r -> 'kiosks' from t_rec)) k),
  (select count(*)::int
     from public.kiosk_vote_queue q
     join public.votes v on v.offline_vote_id = q.offline_vote_id
    where q.election_period_id = '20000000-0000-4000-8000-000000000001'
      and q.conflict_status = 'synced'),
  'counted sum matches the queue→votes synced join (lossless unique join, B-3)');

select is(
  jsonb_array_length((select r -> 'queue_rows' from t_rec)),
  10,
  'the adjudication section lists all 10 queue rows for the election');
select is(
  jsonb_array_length((select r -> 'votes' from t_rec)),
  3,
  'the linked-vote picker lists the 3 votes of the election');

-- ---------------------------------------------------------------------
-- 5) Totals (balance report inputs, derived) (3)
-- ---------------------------------------------------------------------
select is(
  (select (r -> 'totals' ->> 'approved_voters')::int from t_rec),
  (select approved + 2 from t_base),
  'approved voters = baseline + the 2 approved fixtures (rejected s3 excluded)');
select is(
  (select (r -> 'totals' ->> 'voted_voters')::int from t_rec),
  2,
  'voted voters = distinct voters with a votes row in this election (s1, s2)');
select is(
  (select (r -> 'totals' ->> 'not_voted_voters')::int from t_rec),
  (select approved from t_base),
  'not voted = approved minus voted (my 2 fixtures both voted; baseline had none in this election)');

-- ---------------------------------------------------------------------
-- 6) Adjudication semantics (D-10) (18)
-- ---------------------------------------------------------------------
select is(
  try_adj('20000000-0000-4000-8000-000000000065', 'duplicate', 'double ballot', null),
  'A linked vote is required for duplicate/conflict adjudication.',
  'duplicate WITHOUT linked vote is rejected');
select is(
  try_adj('20000000-0000-4000-8000-000000000065', 'duplicate', 'double ballot', '20000000-0000-4000-8000-000000000054'),
  'Linked vote does not exist in this election.',
  'a linked vote from ANOTHER election is rejected');
select is(
  try_adj('20000000-0000-4000-8000-000000000065', 'duplicate', 'double ballot', '20000000-0000-4000-8000-000000000051'),
  'OK',
  'duplicate WITH a linked vote in the same election succeeds (q5 -> duplicate, link v3)');
select is(
  (select conflict_status from public.kiosk_vote_queue where id = '20000000-0000-4000-8000-000000000065'),
  'duplicate',
  'adjudicated row flipped to duplicate');
select is(
  (select linked_vote_id from public.kiosk_vote_queue where id = '20000000-0000-4000-8000-000000000065'),
  '20000000-0000-4000-8000-000000000051',
  'adjudicated row carries the linked (canonical) vote id');
select is(
  (select adjudicated_by from public.kiosk_vote_queue where id = '20000000-0000-4000-8000-000000000065'),
  '20000000-0000-4000-8000-000000000010',
  'adjudicated_by records the acting admin session identity');
select ok(
  (select adjudicated_at is not null from public.kiosk_vote_queue where id = '20000000-0000-4000-8000-000000000065'),
  'adjudicated_at is set on the adjudicated row');

select is(
  try_adj('20000000-0000-4000-8000-000000000067', 'conflict', null, null),
  'A linked vote is required for duplicate/conflict adjudication.',
  'conflict WITHOUT linked vote is rejected');
select is(
  try_adj('20000000-0000-4000-8000-000000000067', 'conflict', 'resolved to v9', '20000000-0000-4000-8000-000000000052'),
  'OK',
  'conflict WITH a linked vote succeeds (q7 -> conflict, link v9)');

select is(
  try_adj('20000000-0000-4000-8000-000000000066', 'invalid', null, null),
  'A resolution note is required for invalid votes.',
  'invalid WITHOUT a resolution note is rejected');
select is(
  try_adj('20000000-0000-4000-8000-000000000066', 'invalid', 'spoiled ballot', null),
  'OK',
  'invalid WITH a resolution note succeeds');

select is(
  try_adj('20000000-0000-4000-8000-000000000061', 'pending', 'nope', null),
  'Status must be duplicate, invalid or conflict - pending/synced transitions belong to the sync path.',
  'the sync-owned pending transition is rejected in adjudicate_vote_rpc');
select is(
  try_adj('20000000-0000-4000-8000-000000000061', 'synced', 'nope', null),
  'Status must be duplicate, invalid or conflict - pending/synced transitions belong to the sync path.',
  'the sync-owned synced transition is rejected in adjudicate_vote_rpc');
select is(
  try_adj('20000000-0000-4000-8000-000000000061', 'bogus', 'nope', null),
  'Status must be duplicate, invalid or conflict - pending/synced transitions belong to the sync path.',
  'an unknown status literal is rejected');

select is(
  try_adj('20000000-0000-4000-8000-000000000061', 'conflict', 'two ballots, kept this', '20000000-0000-4000-8000-000000000051'),
  'OK',
  'a pending row can be adjudicated directly to conflict (pre-publish revisable machine)');
select is(
  try_adj('20000000-0000-4000-8000-000000000062', 'duplicate', 'dupe of v9', '20000000-0000-4000-8000-000000000052'),
  'OK',
  'a pending row can be adjudicated directly to duplicate');

-- Re-adjudication (D-10: revisable + audit accumulates).
select is(
  try_adj('20000000-0000-4000-8000-000000000065', 'invalid', 'reconsidered: actually invalid', null),
  'OK',
  'an adjudicated row is RE-adjudicable pre-publish (q5 duplicate -> invalid)');
select is(
  (select linked_vote_id from public.kiosk_vote_queue where id = '20000000-0000-4000-8000-000000000065'),
  null,
  'a stale linked vote is cleared when the row is re-adjudicated away from duplicate/conflict');

-- ---------------------------------------------------------------------
-- 7) Audit trail (2) — every adjudication writes a row, re-adjudications
--    accumulate (T-05-07 / R2 / D-10)
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from public.audit_logs
    where action = 'Adjudicated Vote'
      and details like '%20000000-0000-4000-8000-000000000065%'),
  2,
  're-adjudication accumulates TWO audit rows for q5 (duplicate + invalid)');
select is(
  (select count(*)::int
     from public.audit_logs
    where action = 'Adjudicated Vote'),
  6,
  'six successful adjudications total, each audited');

-- ---------------------------------------------------------------------
-- 8) Counts stay derived and consistent after the flips (4)
-- ---------------------------------------------------------------------
create temp table t_rec2 (r jsonb);
insert into t_rec2 select public.get_reconciliation_rpc('20000000-0000-4000-8000-000000000001');

select is(
  (select (k ->> 'pending')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec2)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  0,
  'after flips: Kiosk Alpha pending = 0 (both pending rows adjudicated)');
select is(
  (select (k ->> 'duplicate')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec2)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  1,
  'after flips: Kiosk Alpha duplicate = 1 (q2; q5 moved to invalid, q7 stayed conflict)');
select is(
  (select (k ->> 'invalid')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec2)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  2,
  'after flips: Kiosk Alpha invalid = 2 (q6 + re-adjudicated q5)');
select is(
  (select (k ->> 'conflict')::int
     from jsonb_array_elements((select r -> 'kiosks' from t_rec2)) k
    where k ->> 'name' = 'Kiosk Alpha'),
  2,
  'after flips: Kiosk Alpha conflict = 2 (q7 + adjudicated q1)');

-- ---------------------------------------------------------------------
-- 9) PRE-PUBLISH ONLY (D-10/D-12): the live release marker on disk is
--    election_periods.results_published (set by the 012 publish RPC) — a
--    published election refuses adjudication with a fixed error (2)
-- ---------------------------------------------------------------------
update public.election_periods
   set results_published = true
 where id = '20000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.adjudicate_vote_rpc('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000062', 'invalid', 'late flip', null)$$,
  'P0001',
  NULL,
  'post-publication adjudication raises the fixed pre-publish-lock error');
select is(
  (select conflict_status from public.kiosk_vote_queue where id = '20000000-0000-4000-8000-000000000062'),
  'duplicate',
  'the rejected post-publish attempt left the row untouched (still duplicate from the earlier flip)');

select * from finish();
rollback;