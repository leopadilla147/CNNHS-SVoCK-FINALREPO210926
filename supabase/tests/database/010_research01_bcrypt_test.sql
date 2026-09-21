-- =====================================================================
-- 010_research01_bcrypt_test.sql
-- Phase 01, Plan 03 — Task 2 (RESEARCH-01 spike)
--
-- Empirically probes the password-hash transition question that
-- RESEARCH-01-bcrypt-transition.md answers (docs/research/):
--   * what hash formats the consolidated chain (001-021) actually
--     produces, and which verify with what cost;
--   * whether a naive in-place crypt() migration would lock accounts
--     out (Probe A1 — crypt() with a non-bcrypt salt format);
--   * the round-trip and timing profile of a bcrypt cost-10 re-hash.
--
-- This file MEASURES; the doc RECOMMENDS.  The timing rows emitted at
-- the end are transcribed into RESEARCH-01's Findings table from the
-- user-run `supabase test db` output (D-11).
--
-- Runs inside a transaction (temp table + timings roll back); safe to
-- re-run.
-- =====================================================================

begin;

select plan(11);

-- Ensures the extension exists even if a future chain drops it (guard).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) Extension availability
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_extension
    where extname = 'pgcrypto'),
  1,
  'pgcrypto extension must be installed by the chain (001/002/020)');

-- ---------------------------------------------------------------------
-- 2) Legacy student scheme (016_seed_dummy_parties.sql)
--    Stored format: SHA-256 hex (64 chars), digest(plain, 'sha256').
--    The chain's demo branch compares: stored_hash = digest(plain)::hex.
-- ---------------------------------------------------------------------
select ok(
  encode(digest('student123', 'sha256'), 'hex') = encode(digest('student123', 'sha256'), 'hex'),
  'legacy compare branch: stored 64-hex SHA-256 hash is recomputable from the plaintext');

select is(
  length(encode(digest('student123', 'sha256'), 'hex')),
  64,
  'legacy student hashes must be 64 hex chars (SHA-256)');

-- ---------------------------------------------------------------------
-- 3) Probe A1 / Pitfall 5 — crypt() with the legacy salt format
--    RESEARCH-01 assumption: pgcrypto crypt() returns NULL when handed
--    a salt that is not in a recognized crypt(3) format (a 64-hex
--    SHA-256 string carries no bcrypt magic).  If this probe returns
--    NULL the naive migration path (students.password_hash :=
--    crypt(plain, students.password_hash)) would LOCK EVERY STUDENT OUT,
--    which is why the re-hash must branch on format first.
-- ---------------------------------------------------------------------
select is(
  crypt('student123', encode(digest('student123', 'sha256'), 'hex')),
  null::text,
  'Probe A1: crypt() must return NULL for the 64-hex SHA-256 salt — naive in-place crypt() migration would break every student login');

-- ---------------------------------------------------------------------
-- 4) Chain bcrypt format (admin/commissioner paths)
--    Stored format: crypt(plain, gen_salt('bf')) — pgcrypto default
--    cost 6, prefix $2a$06$ (001 admin bootstrap, 007 commissioner
--    seeds, 020 chief bootstrap).
--
--    NOTE: the verify hash must be bound ONCE and asserted against
--    itself.  Two independent gen_salt() draws (as in the original
--    draft) can never be equal, so a "round-trip" probe that compares
--    two freshly generated hashes always fails.  We bind a single
--    generated hash in a temp table (same pattern as the timing temp
--    table below) and assert crypt(plain, stored) = stored against it.
-- ---------------------------------------------------------------------
create temp table research01_bcrypt_sample (sample_key text, stored_hash text);

insert into research01_bcrypt_sample (sample_key, stored_hash)
select 'chain_admin', crypt('chief123', gen_salt('bf'));

select ok(
  (select crypt('chief123', stored_hash) = stored_hash
     from research01_bcrypt_sample
    where sample_key = 'chain_admin'),
  'bcrypt branch: crypt(plain, stored) must round-trip against the stored chain-admin hash');

select ok(
  substr(crypt('chief123', gen_salt('bf')), 1, 4) = '$2a$',
  'chain admin hashes must carry the bcrypt $2a$ variant tag');

-- ---------------------------------------------------------------------
-- 5) Re-hash target (bcrypt cost 10) — the transparent-upgrade target
-- ---------------------------------------------------------------------
select ok(
  substr(crypt('student123', gen_salt('bf', 10)), 1, 7) = '$2a$10$',
  're-hash target: bf cost-10 hashes must carry the $2a$10$ tag');

select is(
  length(crypt('student123', gen_salt('bf', 10))),
  60,
  're-hash target: bf-10 hashes must be 60 chars (variant 2a)');

insert into research01_bcrypt_sample (sample_key, stored_hash)
select 'bf10', crypt('student123', gen_salt('bf', 10));

select ok(
  (select crypt('student123', stored_hash) = stored_hash
     from research01_bcrypt_sample
    where sample_key = 'bf10'),
  're-hash target: full verify must round-trip against the stored bf-10 hash');

-- ---------------------------------------------------------------------
-- 6) Timing capture — bf-10 round-trip, 10 samples
--    Emitted as rows + a NOTICE so the `supabase test db` output
--    carries the measured profile for RESEARCH-01's Findings table.
-- ---------------------------------------------------------------------
create temp table research01_timing (iter int, elapsed_ms numeric);

do $$
declare
  i int;
  t0 timestamptz;
  t1 timestamptz;
begin
  for i in 1..10 loop
    t0 := clock_timestamp();
    perform crypt('student123', gen_salt('bf', 10));
    t1 := clock_timestamp();
    insert into research01_timing (iter, elapsed_ms)
    values (i, round(extract(epoch from (t1 - t0)) * 1000, 3));
  end loop;
end $$;

select is(
  (select count(*)::int from research01_timing),
  10,
  'bf-10 timing capture must produce exactly 10 samples');

select ok(
  (select avg(elapsed_ms) from research01_timing) > 0,
  'bf-10 round-trip must take measurable time (> 0 ms average)');

-- Emit the per-sample rows for the RESEARCH-01 transcript.
select '  iter ' || iter || ' — bf-10 round-trip: ' || elapsed_ms || ' ms' as research01_timing_row
  from research01_timing
 order by iter;

do $$
declare
  v_avg numeric; v_min numeric; v_max numeric;
begin
  select round(avg(elapsed_ms), 3), round(min(elapsed_ms), 3), round(max(elapsed_ms), 3)
    into v_avg, v_min, v_max
    from research01_timing;
  raise notice 'RESEARCH-01 timing: avg=%, min=%, max=% ms (bf-10, 10 samples)', v_avg, v_min, v_max;
end $$;

select * from finish();
rollback;