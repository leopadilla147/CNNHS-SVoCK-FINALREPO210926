-- =====================================================================
-- 022_session_spine.sql
-- Phase 02, Plan 01 - Task 2 (session spine)
--
-- Run this in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
--
-- Replaces JWT-claim role resolution with DB-side session tokens carried
-- in the Authorization header.  The client sends `Authorization: Bearer
-- <64-hex raw token>` (via the supabase fetch interceptor, Task 3) and
-- PostgREST exposes the header to RLS through the `request.headers` GUC.
--
-- Design (02-CONTEXT D-01..D-26):
--   * sessions stores ONLY the SHA-256 of the raw token (never the token
--     itself), so a DB dump cannot leak a live session.
--   * 24h fixed expiry; one active session per user (mint replaces).
--   * Expired rows are purged lazily when the dead token is presented
--     (volatile helpers), keeping the table small at this scale.
--   * current_app_role() / current_commissioner_role() are REWRITTEN to
--     resolve identity from the header instead of auth.jwt()/auth.uid(),
--     which are null under custom DB auth (004 note).  The legacy claim
--     sources are removed so the header becomes the single trust path.
--   * Raw tokens are minted exactly once by login RPCs (student v2 here;
--     admin/officer/commissioner/adviser in 023) and returned to the
--     client; only the loading path needs them afterwards.
--
-- Tradeoff (documented in the phase SUMMARY): the helpers were `stable`
-- SQL in 001; they must be plpgsql `volatile` now because the lazy expiry
-- purge performs a DELETE.  Acceptable at school scale (one lookup per
-- row touched by an RLS policy).
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) sessions table (hash-only, RLS deny-all)
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null,
  user_role text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.sessions enable row level security;

-- Clients never touch this table directly: login RPCs mint and purge rows
-- as SECURITY DEFINER (owner bypasses RLS).  Deny every client path.
drop policy if exists "sessions deny all" on public.sessions;
create policy "sessions deny all"
  on public.sessions
  for all
  to public
  using (false)
  with check (false);

-- ---------------------------------------------------------------------
-- 2) session_identity() - single header parse + lookup + lazy purge
--    Internal helper consumed by the three public identity helpers.
-- ---------------------------------------------------------------------
create or replace function public.session_identity()
returns table (session_user_id uuid, session_user_role text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_authorization text;
  v_raw_token text;
  v_token_hash text;
  v_user_id uuid;
  v_user_role text;
  v_expires_at timestamptz;
begin
  v_authorization := current_setting('request.headers', true)::jsonb ->> 'authorization';
  if v_authorization is null then
    return;
  end if;

  -- Accept only an explicit Bearer-token prefix; anything else means the
  -- caller is not presenting a session token at all.
  v_raw_token := regexp_replace(v_authorization, '^[Bb]earer\s+', '');
  if v_raw_token = v_authorization or length(v_raw_token) < 32 then
    return;
  end if;

  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  select s.user_id, s.user_role, s.expires_at
    into v_user_id, v_user_role, v_expires_at
    from public.sessions s
   where s.token_hash = v_token_hash;

  if v_user_id is null then
    return;
  end if;

  if v_expires_at <= now() then
    -- Lazy purge: the presented token is dead; drop the cold row.
    delete from public.sessions where token_hash = v_token_hash;
    return;
  end if;

  return query select v_user_id, v_user_role;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Identity helpers (rewritten from auth.jwt()/auth.uid() to header)
-- ---------------------------------------------------------------------
create or replace function public.current_session_user_id()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  select session_user_id into v_user_id from public.session_identity();
  return v_user_id;
end;
$$;

create or replace function public.current_session_role()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_role text;
begin
  select session_user_role into v_user_role from public.session_identity();
  return v_user_role;
end;
$$;

create or replace function public.current_app_role()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_role text;
begin
  select session_user_role into v_user_role from public.session_identity();
  return v_user_role;
end;
$$;

create or replace function public.current_commissioner_role()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  select session_user_id into v_user_id from public.session_identity();
  if v_user_id is null then
    return null;
  end if;
  select commissioner_role into v_role from public.profiles where id = v_user_id;
  return v_role;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) issue_session_token() - mints a raw token, stores only its SHA-256.
--    Server-side only (login RPCs are SECURITY DEFINER and run as owner);
--    intentionally NO client grant - an anon-callable mint would let
--    anyone forge a session.
-- ---------------------------------------------------------------------
create or replace function public.issue_session_token(p_user_id uuid, p_user_role text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_raw text;
  v_hash text;
begin
  if p_user_id is null or p_user_role is null or p_user_role = '' then
    raise exception 'issue_session_token: invalid identity';
  end if;

  v_raw := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  -- One active session per user (D-05): replace any prior row.
  delete from public.sessions where user_id = p_user_id;

  insert into public.sessions (token_hash, user_id, user_role, expires_at)
  values (v_hash, p_user_id, p_user_role, now() + interval '24 hours');

  return v_raw;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) login_student_direct_v2() - plaintext student login that mints a
--    session token.  Password storage for students is SHA-256-hex of the
--    UTF-8 password (client hashPassword / 016 seeds); the server now
--    compares the plaintext the same way, so the hash never leaves the
--    browser.
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
  v_student public.students;
  v_token text;
begin
  select * into v_student
    from public.students s
   where lower(s.email) = lower(p_email)
     and s.password_hash = encode(sha256(convert_to(p_password, 'UTF8')), 'hex')
   limit 1;

  if v_student.id is null then
    raise exception 'Invalid credentials';
  end if;

  v_token := public.issue_session_token(v_student.id, 'student');

  return query
    select v_token, v_student.id, v_student.first_name, v_student.last_name,
           v_student.email, v_student.status;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) Grants (least privilege, CR-02 / 020 pattern).
--    The legacy client-hash login is replaced by v2; clients lose the old
--    surface.  Identity helpers feed RLS policies under the PostgREST
--    anon/authenticated roles, so they are re-granted to exactly those.
-- ---------------------------------------------------------------------
revoke all on function public.login_student_direct(text, text) from public, anon, authenticated;
revoke all on function public.login_student_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_student_direct_v2(text, text) to anon;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to anon, authenticated;

revoke all on function public.current_commissioner_role() from public;
grant execute on function public.current_commissioner_role() to anon, authenticated;

revoke all on function public.current_session_user_id() from public;
grant execute on function public.current_session_user_id() to anon, authenticated;

revoke all on function public.current_session_role() from public;
grant execute on function public.current_session_role() to anon, authenticated;

revoke all on function public.issue_session_token(uuid, text) from public, anon, authenticated;
revoke all on function public.session_identity() from public, anon, authenticated;