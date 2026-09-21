-- =====================================================================
-- 031_kiosk_gateway_and_verify.sql
-- Phase 05, Plan 05-03 - Task 1 (kiosk device secrets, student verifier
-- RPC that mints voter tickets, queue D-10 columns)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
--
-- Ships (B-2 / B-3 / D-06 / D-08 / R1 / R4; ROADMAP step 4):
--   * kiosk_devices.auth_id (unique) + device_secret_hash — the device
--     bearer identity the 05-03 kiosk_vote rewrite binds to.  Legacy rows
--     whose secret is stored as a plaintext-ish 64-hex SHA-256 value are
--     backfilled IN PLACE to bcrypt cost 10 (crypt(gen_salt('bf',10),...))
--     and the legacy plaintext column is dropped afterwards (safe: no
--     in-repo code path reads it — kiosk_vote, the only reader, is
--     rewritten in 05-03 T2).  New devices always store the bcrypt hash;
--     never plaintext (R4).
--   * verify_kiosk_credentials_rpc(p_device_auth_id, p_device_secret) —
--     security-definer verifier (crypt compare against device_secret_hash)
--     that updates last_seen_at on success.  VERIFIES ONLY — it never
--     mints a ticket (the gateway mints the short-lived kiosk session).
--   * verify_student_credentials_rpc(p_lrn, p_password_sha256) — the ONLY
--     student verifier the kiosk uses (023 Pitfall 4 fix: the old kiosk
--     path did a PLAINTEXT string compare that rejects every bcrypt row).
--     BCRYPT-AWARE: '$2'-prefixed hashes verify via crypt(), legacy 64-hex
--     SHA-256 rows compare by equality — both kept in the DB so the kiosk
--     can keep sending its client-computed SHA-256 hex.  ON SUCCESS IT
--     MINTS A VOTER TICKET — an ADDITIONAL short-lived (5 minute) session
--     row (B-2).  It deliberately does NOT call issue_session_token's
--     delete-prior body, so the student's active web session survives.
--     Returns (student_id, first_name, last_name, voter_ticket, expires_at,
--     has_voted) and NEVER leaks password_hash.  Already-voted students get
--     a distinct has_voted=true flag (deterministic, kept in the RPC).
--   * kiosk_vote_queue gains the D-10 adjudication columns (linked_vote_id,
--     adjudicated_by, adjudicated_at) — the conflict_status CHECK and the
--     offline_vote_id unique constraint are UNTOUCHED (001:358-368).
--   * votes.transaction_id (019) upgraded from a non-unique index to a
--     partial UNIQUE index so sync ON CONFLICT (transaction_id) DO NOTHING
--     is DB-enforced and replays are idempotent at the constraint level.
--   * biometric_templates.fingerprint_id (integer) — repo/production drift
--     alignment (A7; the hosted DB has the column out-of-band).
--
-- 001-030 bodies are NEVER edited (D-26); 031 is strictly additive apart
-- from the 019 transaction_id index replacement it owns.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) kiosk_devices — device bearer identity + bcrypt secret hash
-- ---------------------------------------------------------------------
alter table public.kiosk_devices
  add column if not exists auth_id text,
  add column if not exists device_secret_hash text,
  add column if not exists last_seen_at timestamptz;

create unique index if not exists kiosk_devices_auth_id_key
  on public.kiosk_devices (auth_id)
  where auth_id is not null;

-- Legacy backfill + plaintext-column retirement.  The old kiosk table
-- family stored the device secret as a plaintext-ish 64-hex SHA-256 value
-- (RESEARCH Pitfall 4 legacy shape); hash those in place to bcrypt cost 10
-- and drop the legacy column.  Guarded on the column's existence so a
-- fresh DB (001 never created a secret column in-repo) is a clean no-op.
-- Verified before authoring: no in-repo code path reads a legacy device
-- secret column (kiosk_vote, the only kiosk_devices reader besides the
-- admin select, is rewritten by 05-03 T2 and never selects a secret).
do $$
declare
  v_secret_col text := 'device_secret';
  v_col_exists boolean;
begin
  select exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'kiosk_devices'
       and column_name = v_secret_col
  ) into v_col_exists;

  if v_col_exists then
    update public.kiosk_devices
       set device_secret_hash = crypt(device_secret, gen_salt('bf', 10))
     where device_secret_hash is null
       and device_secret ~ '^[0-9a-f]{64}$';

    execute format('alter table public.kiosk_devices drop column if exists %I', v_secret_col);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) verify_kiosk_credentials_rpc — device verifier (R1/R4)
--    VERIFIES ONLY, never mints tickets.  On success it bumps
--    last_seen_at so the kiosk heartbeat/verify doubles as a liveness
--    probe.  Marked VOLATILE (not stable): the body performs an UPDATE —
--    a stability claim of 'stable' on a writing function would be a
--    planner lie and a latent defect (fresh-DB posture, 5.0 dev flow).
-- ---------------------------------------------------------------------
create or replace function public.verify_kiosk_credentials_rpc(p_device_auth_id text, p_device_secret text)
returns table (
  device_id uuid,
  name text,
  auth_id text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_secret_hash text;
  v_device_id uuid;
  v_name text;
begin
  if p_device_auth_id is null or p_device_secret is null then
    raise exception 'Missing device credentials';
  end if;

  select d.device_secret_hash, d.id, d.name
    into v_secret_hash, v_device_id, v_name
    from public.kiosk_devices d
   where d.auth_id = p_device_auth_id
   limit 1;

  if v_secret_hash is null then
    raise exception 'Unknown kiosk device';
  end if;

  if v_secret_hash is distinct from crypt(p_device_secret, v_secret_hash) then
    raise exception 'Invalid device secret';
  end if;

  update public.kiosk_devices
     set last_seen_at = now()
   where id = v_device_id;

  return query select v_device_id, v_name, p_device_auth_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) verify_student_credentials_rpc — the ONLY student verifier; mints
--    the short-lived voter ticket (B-2, Pitfall 4 fix).  The kiosk keeps
--    sending its client-computed SHA-256 hex; the DB branches on the
--    stored format exactly like 023's login (bcrypt rows via crypt(),
--    legacy 64-hex rows by equality) — no plaintext secret ever reaches
--    the database layer of this endpoint.
-- ---------------------------------------------------------------------
create or replace function public.verify_student_credentials_rpc(p_lrn text, p_password_sha256 text)
returns table (
  student_id uuid,
  first_name text,
  last_name text,
  voter_ticket text,
  expires_at timestamptz,
  has_voted boolean
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_student public.students;
  v_election_id uuid;
  v_voted boolean := false;
  v_raw text;
  v_hash text;
  v_expires timestamptz;
begin
  if p_lrn is null or p_password_sha256 is null then
    raise exception 'Missing student credentials';
  end if;

  select * into v_student
    from public.students s
   where s.lrn = p_lrn
     and s.status = 'approved'
   limit 1;

  if v_student.id is null then
    raise exception 'Student not found or not approved';
  end if;

  -- 023 D-10 branch shape: bcrypt-prefixed hashes verify via crypt();
  -- anything else (legacy 64-hex SHA-256; NULL) compares the recomputed
  -- SHA-256 the client sent.  The kiosk protocol presents the SHA-256 hex
  -- for BOTH branches (the stored bcrypt hash of a kiosk-native row is
  -- bcrypt(sha256hex); the equality branch covers not-yet-rehashed rows).
  if starts_with(coalesce(v_student.password_hash, ''), '$2') then
    if v_student.password_hash is distinct from crypt(p_password_sha256, v_student.password_hash) then
      raise exception 'Invalid password';
    end if;
  else
    if v_student.password_hash is distinct from p_password_sha256 then
      raise exception 'Invalid password';
    end if;
  end if;

  -- Already-voted flag is DETERMINISTIC and lives in this RPC (never in
  -- edge code): the ACTIVE election is the only one students can vote in.
  select e.id into v_election_id
    from public.election_periods e
   where e.is_active = true
   order by e.start_at desc nulls last
   limit 1;

  if v_election_id is not null then
    select exists (
      select 1
        from public.votes v
       where v.voter_id = v_student.id
         and v.election_period_id = v_election_id
    ) into v_voted;
  end if;

  if v_voted then
    student_id := v_student.id;
    first_name := v_student.first_name;
    last_name := v_student.last_name;
    voter_ticket := null;
    expires_at := null;
    has_voted := true;
    return next;
    return;
  end if;

  -- Mint the ADDITIONAL short-lived voter ticket (B-2).  Deliberately NOT
  -- issue_session_token: its delete-prior body would kill the student's
  -- active web session.  The ticket is an extra 5-minute session row.
  v_raw := gen_random_uuid()::text;
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  v_expires := now() + interval '5 minutes';

  insert into public.sessions (token_hash, user_id, user_role, expires_at)
  values (v_hash, v_student.id, 'student', v_expires);

  student_id := v_student.id;
  first_name := v_student.first_name;
  last_name := v_student.last_name;
  voter_ticket := v_raw;
  expires_at := v_expires;
  has_voted := false;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) kiosk_vote_queue — D-10 adjudication columns (B-3).  The machine
--    (conflict_status CHECK + offline_vote_id unique) is UNTOUCHED.
-- ---------------------------------------------------------------------
alter table public.kiosk_vote_queue
  add column if not exists linked_vote_id uuid references public.votes(id),
  add column if not exists adjudicated_by uuid references public.profiles(id),
  add column if not exists adjudicated_at timestamptz;

-- ---------------------------------------------------------------------
-- 5) votes.transaction_id — 019's non-unique index replaced by a partial
--    UNIQUE index: sync replays become idempotent at the constraint level
--    (ON CONFLICT (transaction_id) DO NOTHING) instead of racing duplicate
--    keys.  Per-selection transaction ids (D-06) keep the unique property
--    well-formed.
-- ---------------------------------------------------------------------
drop index if exists public.votes_transaction_id_idx;
create unique index if not exists votes_transaction_id_key
  on public.votes (transaction_id)
  where transaction_id is not null;

-- ---------------------------------------------------------------------
-- 6) biometric_templates.fingerprint_id — repo/production drift alignment
--    (A7): the hosted DB has the column out-of-band; align if-not-exists.
-- ---------------------------------------------------------------------
alter table public.biometric_templates
  add column if not exists fingerprint_id integer;

-- ---------------------------------------------------------------------
-- 7) Grants — least privilege (020/023 pattern).  Both verifiers run
--    pre-session under PostgREST's anon execution role (the edge gateway
--    also reaches them via the service role, which Supabase's default
--    privileges keep on EXECUTE).  Revoke from PUBLIC + authenticated,
--    grant to anon + authenticated (A1 superset — the SPA/edge and the
--    kiosk both call through anon-key surfaces).
-- ---------------------------------------------------------------------
revoke all on function public.verify_kiosk_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_kiosk_credentials_rpc(text, text) to anon, authenticated;

revoke all on function public.verify_student_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to anon, authenticated;