-- =====================================================================
-- 023_bcrypt_and_lockout.sql
-- Phase 02, Plan 02 - Task 1 (bcrypt + lockout + change_my_password)
--
-- Run this in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
--
-- Ships, on top of the 022 session spine:
--   * public.login_attempts — account + per-IP lockout state, RLS deny-all
--     (only SECURITY DEFINER helpers touch it; mirrors the sessions posture).
--   * public.login_guard / public.record_login_outcome — the 5/15 account
--     lockout (SEC-01) and the 20/hr per-IP rolling damper (SEC-02) behind
--     a single identical 'Invalid credentials' failure text (SEC-03/D-20).
--   * login_student_direct_v2 rewritten with D-10 bcrypt branching and a
--     D-11 transparent re-hash of legacy 64-hex SHA-256 hashes.
--   * login_admin_direct_v2 / login_officer_direct_v2 /
--     login_sslg_adviser_direct_v2 — the legacy admin/officer/adviser login
--     surfaces plus lockout/throttle and 022 session minting (the 02-01
--     client contract; each legacy RPC is revoked beside its v2 creation so
--     no dead-login state exists between 022 and 023, cross-wave
--     serialization).
--   * students.session_version / profiles.session_version (A5).
--   * public.change_my_password — the student self-service password change:
--     actor derives exclusively from current_session_user_id(), enforces the
--     8-char minimum (D-24), verifies the current password with the D-10
--     branch, re-hashes to bcrypt cost 10, bumps session_version and deletes
--     the caller's active sessions (ACCT-05).  Staff accounts (admin /
--     commissioner / sslg_adviser) use the change_password edge function
--     instead (D-22/D-23).
--
-- Idempotency: create-table-if-not-exists, create-or-replace functions,
-- drop-policy-if-exists + create, add-column-if-not-exists, and explicit
-- revoke/grant blocks that re-assert the intended posture every run.
-- Bodies in 001-021 are NEVER edited (D-26).
--
-- Deployment note (T-02-10): the per-IP throttle trusts x-forwarded-for;
-- the hosting edge must strip inbound x-forwarded-for so clients cannot
-- forge it.  When the header is absent the throttle is skipped.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) login_attempts — lockout state (D-17)
--    Two partial-unique-index row families coexist:
--      * account row:      user_identifier set, ip_address IS NULL
--      * per-IP row:       user_identifier IS NULL, ip_address set
-- ---------------------------------------------------------------------
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  user_identifier text not null,
  ip_address inet,
  failed_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists login_attempts_account_key
  on public.login_attempts (user_identifier)
  where ip_address is null;

create unique index if not exists login_attempts_ip_key
  on public.login_attempts (ip_address)
  where user_identifier is null;

alter table public.login_attempts enable row level security;

-- Clients never touch this table: the SECURITY DEFINER helpers are the only
-- writers (login RPCs run as owner and bypass RLS).  Deny every client path.
drop policy if exists "login_attempts deny all" on public.login_attempts;
create policy "login_attempts deny all"
  on public.login_attempts
  for all
  to public
  using (false)
  with check (false);

-- ---------------------------------------------------------------------
-- 2) login_guard() — true = attempt allowed (SEC-01/SEC-02 gate)
--    Returns false when the account row (or the per-IP row, when p_ip is
--    not null) is currently locked.  Lazily purges rows older than 24h
--    (D-21) — a lock never outlives 15 minutes, so 24h-old rows are cold.
-- ---------------------------------------------------------------------
create or replace function public.login_guard(p_identifier text, p_ip inet)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_account_locked boolean;
  v_ip_locked boolean;
begin
  delete from public.login_attempts
   where created_at < now() - interval '24 hours';

  select coalesce(bool_or(locked_until > now()), false)
    into v_account_locked
    from public.login_attempts
   where user_identifier = p_identifier
     and ip_address is null;

  if v_account_locked then
    return false;
  end if;

  if p_ip is not null then
    select coalesce(bool_or(locked_until > now()), false)
      into v_ip_locked
      from public.login_attempts
     where ip_address = p_ip
       and user_identifier is null;

    if v_ip_locked then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) record_login_outcome() — feeds the lockout counters.
--    Account semantics (SEC-01, exact, D-18/D-28):
--      * success resets the account counter (failed_count = 0, unlock).
--      * failure increments ONLY while the row is not currently locked
--        (the counter never exceeds 5 while locked — precision), and sets
--        locked_until = now() + 15 min exactly when the post-increment
--        count reaches 5 (lockout on the 5th consecutive failure).
--      * a failure after a lock expired starts a fresh counting window
--        (the account auto-unlocked after its 15 minutes; it needs 5
--        fresh consecutive failures to re-lock).
--    Per-IP semantics (SEC-02, exact, D-19): a rolling 1-hour window
--    counter; 20 failures within the window lock the IP for 15 minutes.
--    An attempt rejected by login_guard() never reaches this function, so
--    locked rows are not re-incremented by the login flow.
-- ---------------------------------------------------------------------
create or replace function public.record_login_outcome(p_identifier text, p_ip inet, p_success boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if p_success then
    update public.login_attempts
       set failed_count = 0,
           locked_until = null,
           updated_at = now()
     where user_identifier = p_identifier
       and ip_address is null;
    return;
  end if;

  -- Account row: atomic upsert.  While locked: no increment.  After a
  -- lock expired: fresh window (count = 1), no re-lock on that attempt.
  insert into public.login_attempts (user_identifier, ip_address, failed_count, created_at, updated_at)
  values (p_identifier, null, 1, now(), now())
  on conflict (user_identifier) where ip_address is null
  do update set
    failed_count = case
      when public.login_attempts.locked_until is not null
           and public.login_attempts.locked_until > now()
        then public.login_attempts.failed_count
      when public.login_attempts.locked_until is null
        then public.login_attempts.failed_count + 1
      else 1
    end,
    locked_until = case
      when public.login_attempts.locked_until is not null
           and public.login_attempts.locked_until > now()
        then public.login_attempts.locked_until
      when public.login_attempts.locked_until is null
        then case when public.login_attempts.failed_count + 1 >= 5
             then now() + interval '15 minutes' else null end
      else null
    end,
    updated_at = now();

  -- Per-IP row (only when the header supplied an address): rolling 1-hour
  -- counter; the window restarts when the row is older than an hour.
  if p_ip is not null then
    insert into public.login_attempts (user_identifier, ip_address, failed_count, created_at, updated_at)
    values (null, p_ip, 1, now(), now())
    on conflict (ip_address) where user_identifier is null
    do update set
      failed_count = case
        when public.login_attempts.created_at >= now() - interval '1 hour'
          then public.login_attempts.failed_count + 1
        else 1
      end,
      created_at = case
        when public.login_attempts.created_at < now() - interval '1 hour'
          then now()
        else public.login_attempts.created_at
      end,
      locked_until = case
        when public.login_attempts.created_at >= now() - interval '1 hour'
             and public.login_attempts.failed_count + 1 >= 20
          then now() + interval '15 minutes'
        else public.login_attempts.locked_until
      end,
      updated_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) login_student_direct_v2 — bcrypt branching + lockout + transparent
--    re-hash.  Replace the 022 body (create-or-replace); envelope shape
--    and anon grant from 022 are kept and re-asserted below.
-- ---------------------------------------------------------------------
create or replace function public.login_student_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  first_name text,
  last_name text,
  email text,
  status text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_identifier text;
  v_ip inet;
  v_headers jsonb;
  v_student public.students;
  v_token text;
begin
  v_identifier := lower(p_email);

  -- D-19: derive the client IP from x-forwarded-for (split_part ',', 1);
  -- absent or malformed header -> NULL (per-IP throttle skipped, T-02-10).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- SEC-03: the guard's reject path emits the identical failure text as a
  -- bad password — never an account-existence / lock-state oracle.
  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid credentials';
  end if;

  select * into v_student
    from public.students s
   where lower(s.email) = v_identifier
   limit 1;

  -- D-20: unknown accounts count a failure against the same counter and
  -- return the identical text.
  if v_student.id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  -- D-10 branching: bcrypt-prefixed hashes verify via crypt(); anything
  -- else (legacy 64-hex SHA-256; NULL) compares the recomputed SHA-256.
  if starts_with(coalesce(v_student.password_hash, ''), '$2') then
    if v_student.password_hash is distinct from crypt(p_password, v_student.password_hash) then
      perform public.record_login_outcome(v_identifier, v_ip, false);
      raise exception 'Invalid credentials';
    end if;
  else
    if v_student.password_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      perform public.record_login_outcome(v_identifier, v_ip, false);
      raise exception 'Invalid credentials';
    end if;

    -- D-11/D-27: transparent re-hash of the legacy hash to bcrypt cost 10.
    update public.students
       set password_hash = crypt(p_password, gen_salt('bf', 10))
     where id = v_student.id;
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_student.id, 'student');

  return query
    select v_token, v_student.id, v_student.first_name, v_student.last_name,
           v_student.email, v_student.status;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) login_admin_direct_v2 — the 02-01 client contract for admin and
--    commissioner accounts (profiles.role = 'admin'; LoginPage filters
--    commissioner_role afterwards).  Mirrors the legacy 001/002 body plus
--    lockout/throttle and session minting (user_role 'admin').
-- ---------------------------------------------------------------------
create or replace function public.login_admin_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  role text,
  commissioner_role text,
  full_name text,
  email text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_identifier text;
  v_ip inet;
  v_headers jsonb;
  v_token text;
  v_id uuid;
  v_role text;
  v_commissioner_role text;
  v_full_name text;
  v_email text;
begin
  v_identifier := lower(p_email);

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid credentials';
  end if;

  select p.id, p.role, p.commissioner_role, p.full_name, u.email::text
    into v_id, v_role, v_commissioner_role, v_full_name, v_email
    from auth.users u
    join public.profiles p on p.id = u.id
   where lower(u.email) = v_identifier
     and u.encrypted_password = crypt(p_password, u.encrypted_password::text)
   limit 1;

  if v_id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_id, 'admin');

  return query
    select v_token, v_id, v_role, v_commissioner_role, v_full_name, v_email;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) login_officer_direct_v2 — mirrors the legacy officer body exactly
--    (auth.users + public.officers join, crypt compare; officers only —
--    the legacy body has no adviser mapping) plus lockout/throttle and
--    session minting (user_role 'officer').
-- ---------------------------------------------------------------------
create or replace function public.login_officer_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  name text,
  role text,
  email text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_identifier text;
  v_ip inet;
  v_headers jsonb;
  v_token text;
  v_id uuid;
  v_name text;
  v_email text;
begin
  v_identifier := lower(p_email);

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid credentials';
  end if;

  select o.id, o.name, o.email
    into v_id, v_name, v_email
    from auth.users u
    join public.officers o on o.auth_id = u.id
   where lower(u.email) = v_identifier
     and u.encrypted_password = crypt(p_password, u.encrypted_password::text)
   limit 1;

  if v_id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_id, 'officer');

  return query
    select v_token, v_id, v_name, 'officer', v_email;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) login_sslg_adviser_direct_v2 — the adviser surface (006) with the
--    same lockout/throttle and session minting (user_role
--    'sslg_adviser').  Required so revoking login_sslg_adviser_direct
--    lands beside its v2 creation (cross-wave serialization — no
--    dead-login state between 022 and 023).
-- ---------------------------------------------------------------------
create or replace function public.login_sslg_adviser_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  name text,
  email text,
  status text,
  role text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_identifier text;
  v_ip inet;
  v_headers jsonb;
  v_token text;
  v_id uuid;
  v_name text;
  v_email text;
  v_status text;
begin
  v_identifier := lower(p_email);

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid credentials';
  end if;

  select a.auth_id, a.name, a.email, a.status
    into v_id, v_name, v_email, v_status
    from auth.users u
    join public.sslg_advisers a on a.auth_id = u.id
   where lower(u.email) = v_identifier
     and u.encrypted_password = crypt(p_password, u.encrypted_password::text)
   limit 1;

  if v_id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_id, 'sslg_adviser');

  return query
    select v_token, v_id, v_name, v_email, v_status, 'sslg_adviser';
end;
$$;

-- ---------------------------------------------------------------------
-- 8) session_version markers (A5) — bumped on every password change so a
--    pre-change token can be proven dead independently of sessions rows.
-- ---------------------------------------------------------------------
alter table public.students add column if not exists session_version int not null default 0;
alter table public.profiles add column if not exists session_version int not null default 0;

-- ---------------------------------------------------------------------
-- 9) change_my_password — the student self-service password change.
--    Identity comes ONLY from the request session (current_session_user_id),
--    never from the caller.  Success re-hashes to bcrypt cost 10, bumps
--    students.session_version and deletes the caller's active session rows
--    (ACCT-05; D-04's one-active-session invariant makes the delete
--    comprehensive).
-- ---------------------------------------------------------------------
create or replace function public.change_my_password(p_current_password text, p_new_password text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_hash text;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;

  select s.password_hash into v_hash
    from public.students s
   where s.id = v_actor;

  -- D-22: staff/commissioner/adviser accounts are not students rows; they
  -- change their password through the change_password edge function.
  if v_hash is null then
    raise exception 'Staff accounts change their password through the staff portal';
  end if;

  if starts_with(coalesce(v_hash, ''), '$2') then
    if v_hash is distinct from crypt(p_current_password, v_hash) then
      raise exception 'Current password is incorrect';
    end if;
  else
    if v_hash is distinct from encode(sha256(convert_to(p_current_password, 'UTF8')), 'hex') then
      raise exception 'Current password is incorrect';
    end if;
  end if;

  update public.students
     set password_hash = crypt(p_new_password, gen_salt('bf', 10)),
         session_version = session_version + 1
   where id = v_actor;

  delete from public.sessions where user_id = v_actor;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) Grants — least privilege (020 pattern).
--     Login RPCs and change_my_password run pre-session under the anon
--     execution role: revoke from PUBLIC/authenticated, grant to anon.
--     The legacy login RPCs are revoked here beside their v2 creations
--     (cross-wave serialization); their definitions stay in 001/002/006
--     (dropping them is Phase 6 cleanup scope).  The lockout helpers are
--     internal — no client grant at all.
-- ---------------------------------------------------------------------
revoke all on function public.login_student_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_student_direct_v2(text, text) to anon;

revoke all on function public.login_admin_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_admin_direct_v2(text, text) to anon;

revoke all on function public.login_officer_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_officer_direct_v2(text, text) to anon;

revoke all on function public.login_sslg_adviser_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_sslg_adviser_direct_v2(text, text) to anon;

revoke all on function public.change_my_password(text, text) from public, authenticated;
grant execute on function public.change_my_password(text, text) to anon;

revoke all on function public.login_guard(text, inet) from public, anon, authenticated;
revoke all on function public.record_login_outcome(text, inet, boolean) from public, anon, authenticated;

-- Legacy login surfaces: revoked from every client role (CROSS-WAVE
-- SERIALIZATION — each revoke lands beside its v2 creation above).
revoke all on function public.login_admin_direct(text, text) from public, anon, authenticated;
revoke all on function public.login_officer_direct(text, text) from public, anon, authenticated;
revoke all on function public.login_sslg_adviser_direct(text, text) from public, anon, authenticated;