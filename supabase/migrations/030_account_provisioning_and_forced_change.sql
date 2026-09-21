-- =====================================================================
-- 030_account_provisioning_and_forced_change.sql
-- Phase 05, Plan 05-01 - Task 1 (must_change_password flag, login flag
-- returns, audit seam fix)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
--
-- Ships (D-04 / D-13 / D-14 / R2):
--   * students.must_change_password / profiles.must_change_password —
--     the forced-change flag a provisioning/reset flow sets so the first
--     login after a temp password routes to the change screen.  Existing
--     rows default false (no forced change for accounts already live).
--     The 023 session_version column is REUSED for session death — no new
--     version column is added.
--   * login_student_direct_v2 / login_admin_direct_v2 /
--     login_sslg_adviser_direct_v2 extended to RETURN the actor's flag
--     (students -> students row; admin/sslg_adviser -> profiles row)
--     alongside the existing OUT columns.  Envelope contracts and grants
--     are unchanged (D-13: login loads the latest profile, flag included).
--   * get_current_profile_rpc() — the session/profile refresh the client
--     bootstrap uses (counterpart of saveSessionToken).  A page refresh
--     re-reads the flag from the server so the forced-change gate cannot
--     be bypassed by reloading (D-04).
--   * change_my_password (023 body) extended: on success the flag is
--     cleared AND session_version bumped (kills the changer's own
--     sessions too — the client re-logs-in with the new password,
--     D-14).  Signature unchanged: change_my_password(p_current_password,
--     p_new_password).
--   * insert_audit_log_rpc recreated (R2 — 020 granted it
--     authenticated-only, but the SPA executes as anon, so every client
--     audit was silently swallowed).  Now granted to anon + authenticated;
--     the body normalizes the caller role so 'kiosk' and any missing role
--     map to 'system' — keeping 027's actor_role CHECK
--     ('admin','student','system','sslg_adviser') intact (001:438-449
--     log_vote_insert precedent).  This seam is consumed by 05-03's
--     submit path, 05-04/05-05 definer bodies, and the SPA — it lands
--     here, not in 033 (downstream plans depend on it).
--
-- 001-025/027-029 bodies are NEVER edited (D-26); 030 extends 023's
-- change_my_password via create-or-replace with the same signature.
-- No votes / kiosk table / 001 RLS policy is touched (owned by 031/032).
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) must_change_password flag (D-04 / ROADMAP step 2)
-- ---------------------------------------------------------------------
alter table public.students add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) login_student_direct_v2 — return the actor's flag
--    Same 023 body (lockout, D-10 bcrypt branch, transparent re-hash,
--    session mint); the returns table gains must_change_password and the
--    final query selects it from the students row.
--    DROP first: the return type changes (new OUT column), and PostgreSQL
--    refuses CREATE OR REPLACE across a return-type change (42P13).  The
--    re-created function is re-granted by the grant block below.
-- ---------------------------------------------------------------------
drop function if exists public.login_student_direct_v2(text, text);
create or replace function public.login_student_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  first_name text,
  last_name text,
  email text,
  status text,
  must_change_password boolean
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
           v_student.email, v_student.status, v_student.must_change_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) login_admin_direct_v2 — return the actor's flag (profiles row)
--    DROP first: the return type changes (new OUT column) — 42P13.
-- ---------------------------------------------------------------------
drop function if exists public.login_admin_direct_v2(text, text);
create or replace function public.login_admin_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  role text,
  commissioner_role text,
  full_name text,
  email text,
  must_change_password boolean
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
  v_must_change_password boolean;
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

  select p.id, p.role, p.commissioner_role, p.full_name, u.email::text,
         p.must_change_password
    into v_id, v_role, v_commissioner_role, v_full_name, v_email,
         v_must_change_password
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
    select v_token, v_id, v_role, v_commissioner_role, v_full_name, v_email,
           v_must_change_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) login_sslg_adviser_direct_v2 — return the actor's flag (profiles
--    row; the profiles row is created for advisers by 001's
--    handle_new_user trigger from user_metadata.role = 'sslg_adviser').
--    DROP first: the return type changes (new OUT column) — 42P13.
-- ---------------------------------------------------------------------
drop function if exists public.login_sslg_adviser_direct_v2(text, text);
create or replace function public.login_sslg_adviser_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  name text,
  email text,
  status text,
  role text,
  must_change_password boolean
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
  v_must_change_password boolean;
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

  select a.auth_id, a.name, a.email, a.status, p.must_change_password
    into v_id, v_name, v_email, v_status, v_must_change_password
    from auth.users u
    join public.sslg_advisers a on a.auth_id = u.id
    join public.profiles p on p.id = u.id
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
    select v_token, v_id, v_name, v_email, v_status, 'sslg_adviser',
           v_must_change_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) get_current_profile_rpc — bootstrap/profile refresh (D-13/D-14).
--    Resolves the actor from the session spine (Authorization Bearer ->
--    sessions token_hash) and returns the fresh profile incl. the
--    forced-change flag: students -> students row, staff -> profiles row.
--    The client calls this after session-restore so a page refresh cannot
--    bypass the /change-password gate.
-- ---------------------------------------------------------------------
create or replace function public.get_current_profile_rpc()
returns table (
  id uuid,
  role text,
  commissioner_role text,
  full_name text,
  email text,
  must_change_password boolean
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_user_role text;
begin
  select session_user_id, session_user_role into v_user_id, v_user_role
    from public.session_identity();

  if v_user_id is null then
    return;
  end if;

  if v_user_role = 'student' then
    return query
      select s.id, 'student'::text, null::text,
             s.first_name || ' ' || s.last_name, s.email, s.must_change_password
        from public.students s
       where s.id = v_user_id;
  else
    return query
      select p.id, p.role, p.commissioner_role, p.full_name, u.email::text,
             p.must_change_password
        from public.profiles p
        join auth.users u on u.id = p.id
       where p.id = v_user_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) change_my_password — 023 body extended: on success clear the
--    forced-change flag AND bump session_version (D-14; the changer's own
--    sessions die too — the delete below stays).  Signature unchanged.
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
         session_version = session_version + 1,
         must_change_password = false
   where id = v_actor;

  delete from public.sessions where user_id = v_actor;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) insert_audit_log_rpc — R2 seam fix (grants + role normalization)
--    Same body semantics as 020 plus: any role not in the 027 CHECK set
--    ('admin','student','system','sslg_adviser') — incl. 'kiosk' and
--    NULL/missing — maps to 'system' (001:438-449 log_vote_insert writes
--    'system' for kiosk votes; this keeps the CHECK intact for every
--    call path).  EXECUTE granted to anon + authenticated: the SPA runs
--    as anon under the custom-auth flow (020 granted authenticated only,
--    so every client audit silently failed — the defect this fixes).
-- ---------------------------------------------------------------------
create or replace function public.insert_audit_log_rpc(
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default 'system',
  p_action text default null,
  p_details text default null,
  p_type text default 'info'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_role text;
begin
  v_actor_id := auth.uid();
  -- Actor identity comes ONLY from the PostgREST session (auth.uid()).
  -- Only use actor_id if it exists in profiles (students are not in
  -- profiles — their audit rows carry a null actor id).
  if v_actor_id is not null and not exists (select 1 from public.profiles where id = v_actor_id) then
    v_actor_id := null;
  end if;
  v_actor_name := coalesce(p_actor_name, 'System');
  v_role := lower(coalesce(p_actor_role, 'system'));
  -- 027 actor_role CHECK ('admin','student','system','sslg_adviser'):
  -- 'kiosk' and any other client-visible/missing role normalize to
  -- 'system' so no call path can violate the constraint.
  if v_role not in ('admin', 'student', 'system', 'sslg_adviser') then
    v_role := 'system';
  end if;
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (v_actor_id, v_actor_name, v_role, p_action, p_details, p_type);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Grants — least privilege (020 pattern), re-asserted idempotently.
--    The login RPCs keep their pre-session anon grants; the profile
--    refresh is client-callable (anon + authenticated); the audit seam is
--    now open to the SPA's anon execution role.
-- ---------------------------------------------------------------------
revoke all on function public.login_student_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_student_direct_v2(text, text) to anon;

revoke all on function public.login_admin_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_admin_direct_v2(text, text) to anon;

revoke all on function public.login_sslg_adviser_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_sslg_adviser_direct_v2(text, text) to anon;

revoke all on function public.get_current_profile_rpc() from public;
grant execute on function public.get_current_profile_rpc() to anon, authenticated;

revoke all on function public.change_my_password(text, text) from public, authenticated;
grant execute on function public.change_my_password(text, text) to anon;

revoke all on function public.insert_audit_log_rpc(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.insert_audit_log_rpc(uuid, text, text, text, text, text) to anon, authenticated;