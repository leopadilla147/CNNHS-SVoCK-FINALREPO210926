-- =====================================================================
-- 035_adminprofiles_core.sql
-- Phase 02, Plan 01 - Task 1 (adminprofiles core: staff identity
-- consolidation, FK re-points, staff auth rewrite)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase — the executor never touches the live project.
--
-- This is the keystone of the v1.1 schema restructure.  It is strictly
-- ADDITIVE: it creates, backfills, and re-wires; it destroys nothing.
--   * public.adminprofiles — one table carrying EVERY staff identity
--     (chief, commissioner, co_commissioner, sslg_adviser); credentials
--     live bcrypt-in-table; only the Chief keeps an auth.users identity.
--   * Backfill from profiles x commissioners x sslg_advisers x
--     auth.users with adminprofiles.id := profiles.id (FK/reference
--     continuity).
--   * Every FK that referenced public.profiles re-points to
--     public.adminprofiles(id) on delete set null.
--   * public.current_commissioner_role() re-grounds onto adminprofiles
--     (still resolved exclusively from the session spine header, never
--     auth.uid()/auth.jwt()).
--   * public.login_staff_direct_v2() — the single staff login:
--     bcrypt in-table verify with the 023 D-10 branch, SEC-01/02/03
--     lockout + throttle + identical failure text preserved verbatim.
--   * public.change_my_password() — unified staff + student branches.
--   * Audit/profile seams (get_current_profile_rpc,
--     insert_audit_log_rpc), triggers (handle_new_user,
--     log_status_change) and decide_complaint_rpc re-pointed.
--
-- sessions / login_attempts / votes / biometric_templates identities and
-- shapes are untouched (only session-row invalidation DML runs, exactly
-- as 023/030 already did).  001-034 bodies are NEVER edited.
--
-- Idempotency: create-table-if-not-exists, create-or-replace functions
-- (drop-first where the returns type changes), drop-policy-if-exists,
-- drop-constraint-if-exists + existence-guarded FK re-points,
-- existence-guarded do-blocks, and explicit revoke/grant blocks
-- re-asserted every run.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) ADMINPROFILES TABLE — the unified staff identity row
--    role_type:      chief | commissioner | co_commissioner | sslg_adviser
--    commissioner_role: NEVER unique here — a commissioner row and its
--                    co_commissioner legitimately share the same value
--                    (v1.1 "same powers" contract); NULL for advisers.
--    auth_id:        references auth.users(id); populated ONLY for the
--                    Chief row (all other staff exist purely in-table).
--    password_hash:  bcrypt crypt() value only (023 D-10 verify branch);
--                    no plaintext / SHA-256 write path exists in 035.
-- ---------------------------------------------------------------------
create table if not exists public.adminprofiles (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete set null,
  role_type text not null check (role_type in ('chief', 'commissioner', 'co_commissioner', 'sslg_adviser')),
  commissioner_role text check (commissioner_role in ('chief', 'screening_validation', 'electoral_board', 'grievance')),
  full_name text not null,
  email text not null unique,
  password_hash text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  co_commissioner_of uuid references public.adminprofiles(id) on delete set null,
  appointed_by uuid references public.adminprofiles(id) on delete set null,
  appointed_at timestamptz not null default now(),
  session_version int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.adminprofiles enable row level security;

-- RLS: identity comes ONLY from the session spine helpers — never
-- auth.uid() and never any client-supplied id (T-02-02 / T-02-04).
drop policy if exists "adminprofiles own select" on public.adminprofiles;
create policy "adminprofiles own select"
  on public.adminprofiles
  for select
  using (public.current_session_user_id() = id);

drop policy if exists "adminprofiles own update" on public.adminprofiles;
create policy "adminprofiles own update"
  on public.adminprofiles
  for update
  with check (public.current_session_user_id() = id);

drop policy if exists "adminprofiles chief all" on public.adminprofiles;
create policy "adminprofiles chief all"
  on public.adminprofiles
  for all
  using (public.current_commissioner_role() = 'chief')
  with check (public.current_commissioner_role() = 'chief');

-- ---------------------------------------------------------------------
-- 2) BACKFILL — one adminprofiles row per staff identity.
--    Reference continuity: adminprofiles.id := profiles.id, so every FK
--    that pointed at public.profiles resolves to the same person.
--    auth_id is set ONLY for the Chief (email
--    'chief.commissioner@cnnhs.edu'); all other staff rows carry NULL
--    (only the Chief identity remains relevant in auth.users).
--
--    role_type precedence (deterministic, all four staff types
--    reachable): chief -> co_commissioner (commissioners row with
--    co_commissioner_of set) -> commissioner (role 'admin' + a
--    commissioner_role) -> sslg_adviser.  The trailing ELSE catches
--    appointment-era admin profiles whose commissioner_role was swept
--    to NULL by 027 (they stay login-capable as plain commissioners).
--
--    co_commissioner_of resolves the appointing commissioner via
--    reference continuity: the appointer's adminprofiles.id equals their
--    profiles.id equals their commissioners.auth_id — so the self-
--    referential join reads commissioners.auth_id directly, which also
--    works for non-chief appointers (their adminprofiles.auth_id is
--    NULL by design).
-- ---------------------------------------------------------------------
do $$
declare
  v_chief_auth_id uuid;
begin
  select id into v_chief_auth_id
    from auth.users
   where email = 'chief.commissioner@cnnhs.edu'
   limit 1;

  insert into public.adminprofiles (
    id, auth_id, role_type, commissioner_role, full_name, email,
    password_hash, status, co_commissioner_of, appointed_by,
    appointed_at, session_version, created_at
  )
  select
    p.id,
    case when p.id = v_chief_auth_id then p.id else null end,
    case
      when p.commissioner_role = 'chief' then 'chief'
      when c.co_commissioner_of is not null then 'co_commissioner'
      when p.role = 'admin' and p.commissioner_role is not null
           and p.commissioner_role <> 'chief' then 'commissioner'
      when p.role = 'sslg_adviser' then 'sslg_adviser'
      else 'commissioner'
    end,
    p.commissioner_role,
    coalesce(p.full_name, c.name, s.name),
    u.email::text,
    u.encrypted_password::text,
    coalesce(c.status, s.status, 'active'),
    (select cc.auth_id
       from public.commissioners cc
      where cc.id = c.co_commissioner_of
      limit 1),
    null,
    now(),
    0,
    now()
  from public.profiles p
  left join public.commissioners c on c.auth_id = p.id
  left join public.sslg_advisers s on s.auth_id = p.id
  join auth.users u on u.id = p.id
  where p.role in ('admin', 'sslg_adviser')
     or p.commissioner_role is not null
     or c.id is not null
     or s.id is not null
  on conflict (email) do update
    set role_type = excluded.role_type,
        commissioner_role = excluded.commissioner_role,
        full_name = excluded.full_name,
        email = excluded.email,
        password_hash = excluded.password_hash,
        status = excluded.status,
        auth_id = excluded.auth_id,
        co_commissioner_of = excluded.co_commissioner_of,
        session_version = excluded.session_version;
end $$;

-- ---------------------------------------------------------------------
-- 3) FK RE-POINT — every FK column that referenced public.profiles now
--    references public.adminprofiles(id) on delete set null.  Each is
--    existence-guarded on information_schema.columns (fresh chains that
--    never had profiles FKs are clean no-ops) with the constraint
--    dropped by its constant auto-name (<table>_<column>_fkey) which
--    001/012 generated for the inline REFERENCES clauses.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'reviewed_by'
  ) then
    alter table public.students drop constraint if exists students_reviewed_by_fkey;
    alter table public.students
      add constraint students_reviewed_by_fkey
      foreign key (reviewed_by) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'student_masterlist'
       and column_name = 'imported_by'
  ) then
    alter table public.student_masterlist drop constraint if exists student_masterlist_imported_by_fkey;
    alter table public.student_masterlist
      add constraint student_masterlist_imported_by_fkey
      foreign key (imported_by) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'election_periods'
       and column_name = 'created_by'
  ) then
    alter table public.election_periods drop constraint if exists election_periods_created_by_fkey;
    alter table public.election_periods
      add constraint election_periods_created_by_fkey
      foreign key (created_by) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'complaints'
       and column_name = 'resolved_by'
  ) then
    alter table public.complaints drop constraint if exists complaints_resolved_by_fkey;
    alter table public.complaints
      add constraint complaints_resolved_by_fkey
      foreign key (resolved_by) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'archived_documents'
       and column_name = 'archived_by'
  ) then
    alter table public.archived_documents drop constraint if exists archived_documents_archived_by_fkey;
    alter table public.archived_documents
      add constraint archived_documents_archived_by_fkey
      foreign key (archived_by) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'proclamations'
       and column_name = 'proclaimed_by'
  ) then
    alter table public.proclamations drop constraint if exists proclamations_proclaimed_by_fkey;
    alter table public.proclamations
      add constraint proclamations_proclaimed_by_fkey
      foreign key (proclaimed_by) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_logs'
       and column_name = 'actor_id'
  ) then
    alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;
    alter table public.audit_logs
      add constraint audit_logs_actor_id_fkey
      foreign key (actor_id) references public.adminprofiles(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) ROLE HELPER RE-GROUND (AUTH-02) — current_commissioner_role()
--    resolves EXCLUSIVELY from the session spine:
--    request.headers -> session_identity() -> adminprofiles row.
--    Never auth.uid()/auth.jwt().  A missing header or unknown id
--    returns NULL (RLS evaluates NULL as false — fail-closed).  A
--    co_commissioner row carries the same commissioner_role as its
--    appointing commissioner (the v1.1 same-powers contract).
--    022's current_app_role()/current_session_role()/
--    current_session_user_id() bodies stay untouched.
-- ---------------------------------------------------------------------
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
  select commissioner_role into v_role from public.adminprofiles where id = v_user_id;
  return v_role;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) LOCKOUT / THROTTLE / IDENTICAL TEXT (SEC-01/02/03)
--    The login RPC below derives v_ip from request.headers
--    x-forwarded-for (split_part ',', 1 — the exact 023 pattern,
--    exception-guarded to NULL), calls public.login_guard(v_identifier,
--    v_ip) at entry raising the identical literal on false, calls
--    public.record_login_outcome(v_identifier, v_ip, false) on every
--    reject path and true on success.  The failure literal is
--    byte-identical across every reject path (SEC-03) — no account
--    existence / lock-state enumeration oracle.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 6) LOGIN RPC (AUTH-01/03/05) — login_staff_direct_v2
--    The single staff login surface.  Credentials verify against
--    adminprofiles.password_hash via the 023 D-10 branch (crypt() for
--    '$2'-prefixed bcrypt; defensive SHA-256 compare for any legacy
--    non-bcrypt backfilled hash); auth.users is NEVER joined for the
--    password (T-02-01).  Session role literal: 'admin' for
--    chief/commissioner/co_commissioner, 'sslg_adviser' for advisers;
--    the token is minted exactly once per success via
--    issue_session_token().  No client-supplied identity parameter
--    exists in the signature (AUTH-05).
-- ---------------------------------------------------------------------
create or replace function public.login_staff_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  role_type text,
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
  v_id uuid;
  v_role_type text;
  v_commissioner_role text;
  v_full_name text;
  v_email text;
  v_password_hash text;
  v_session_role text;
  v_token text;
begin
  v_identifier := lower(p_email);

  -- D-19 / 023 T-02-10: derive the client IP from x-forwarded-for
  -- (split_part ',', 1); absent or malformed header -> NULL (per-IP
  -- throttle skipped; the hosting edge strips inbound x-forwarded-for).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- SEC-03: the guard's reject path emits the identical failure text as
  -- a bad password — never an account-existence / lock-state oracle.
  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid credentials';
  end if;

  select a.id, a.role_type, a.commissioner_role, a.full_name, a.email,
         a.password_hash
    into v_id, v_role_type, v_commissioner_role, v_full_name, v_email,
         v_password_hash
    from public.adminprofiles a
   where lower(a.email) = v_identifier
   limit 1;

  -- SEC-03: unknown accounts count a failure against the same counter
  -- and return the identical text.
  if v_id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  -- A backfilled row with no hash cannot authenticate — treated exactly
  -- like an unknown account (identical text, counter incremented).
  if v_password_hash is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  -- D-10 branching: bcrypt-prefixed hashes verify via crypt(); anything
  -- else (legacy non-bcrypt staff hash; defensive for backfilled rows
  -- not '$2'-prefixed) compares the recomputed SHA-256.  No staff
  -- transparent re-hash — staff re-hash happens only on password change.
  if starts_with(coalesce(v_password_hash, ''), '$2') then
    if v_password_hash is distinct from crypt(p_password, v_password_hash) then
      perform public.record_login_outcome(v_identifier, v_ip, false);
      raise exception 'Invalid credentials';
    end if;
  else
    if v_password_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      perform public.record_login_outcome(v_identifier, v_ip, false);
      raise exception 'Invalid credentials';
    end if;
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  if v_role_type in ('chief', 'commissioner', 'co_commissioner') then
    v_session_role := 'admin';
  else
    v_session_role := 'sslg_adviser';
  end if;

  v_token := public.issue_session_token(v_id, v_session_role);

  return query
    select v_token, v_id, v_role_type, v_commissioner_role, v_full_name,
           v_email;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) SUPERSEDED LOGIN SURFACES — dropped with revoke-all guards BEFORE
--    each drop (revokes guarded so re-apply on an already-dropped
--    function is a no-op; login_officer_direct(_v2) were already
--    removed by 027 — not referenced here).
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.login_admin_direct_v2(text,text)') is not null then
    revoke all on function public.login_admin_direct_v2(text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.login_sslg_adviser_direct_v2(text,text)') is not null then
    revoke all on function public.login_sslg_adviser_direct_v2(text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.login_admin_direct(text,text)') is not null then
    revoke all on function public.login_admin_direct(text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.login_sslg_adviser_direct(text,text)') is not null then
    revoke all on function public.login_sslg_adviser_direct(text, text) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.login_admin_direct_v2(text, text);
drop function if exists public.login_sslg_adviser_direct_v2(text, text);
drop function if exists public.login_admin_direct(text, text);
drop function if exists public.login_sslg_adviser_direct(text, text);

-- ---------------------------------------------------------------------
-- 8) CHANGE-MY-PASSWORD (ACCT-03/ACCT-05) — unified staff + student
--    branches.  Actor derives EXCLUSIVELY from the session spine
--    (current_session_user_id()); no client-supplied actor id exists.
--    Staff branch: adminprofiles row required, current password verified
--    with the D-10 branch, new password written bcrypt cost 10,
--    session_version bumped, the caller's active session rows deleted.
--    Student branch: students.password_hash with 023 semantics; the
--    adminprofiles/students columns removed by the 036 trim are never
--    referenced from this file.
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
  v_staff_hash text;
  v_student_hash text;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;

  -- Staff branch: an adminprofiles row for the session actor wins.
  select a.password_hash into v_staff_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if v_staff_hash is not null then
    if starts_with(coalesce(v_staff_hash, ''), '$2') then
      if v_staff_hash is distinct from crypt(p_current_password, v_staff_hash) then
        raise exception 'Current password is incorrect';
      end if;
    else
      if v_staff_hash is distinct from encode(sha256(convert_to(p_current_password, 'UTF8')), 'hex') then
        raise exception 'Current password is incorrect';
      end if;
    end if;

    update public.adminprofiles
       set password_hash = crypt(p_new_password, gen_salt('bf', 10)),
           session_version = session_version + 1
     where id = v_actor;

    delete from public.sessions where user_id = v_actor;
    return;
  end if;

  -- Student branch (unchanged semantics minus the dropped columns):
  -- the staff-portal text raises only when neither an adminprofiles
  -- row nor a students row exists for the actor.
  select s.password_hash into v_student_hash
    from public.students s
   where s.id = v_actor;

  if v_student_hash is null then
    raise exception 'Staff accounts change their password through the staff portal';
  end if;

  if starts_with(coalesce(v_student_hash, ''), '$2') then
    if v_student_hash is distinct from crypt(p_current_password, v_student_hash) then
      raise exception 'Current password is incorrect';
    end if;
  else
    if v_student_hash is distinct from encode(sha256(convert_to(p_current_password, 'UTF8')), 'hex') then
      raise exception 'Current password is incorrect';
    end if;
  end if;

  update public.students
     set password_hash = crypt(p_new_password, gen_salt('bf', 10))
   where id = v_actor;

  delete from public.sessions where user_id = v_actor;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) AUDIT + PROFILE RE-READ SEAMS (030 re-points)
-- ---------------------------------------------------------------------
-- get_current_profile_rpc: staff read from adminprofiles, students
-- unchanged.  auth.users supplies ONLY the email column and only for
-- rows that still carry an auth identity (the Chief; LEFT JOIN so
-- non-chief staff rows resolve from adminprofiles.email).  The
-- must_change_password flag is deliberately NOT returned (deferred/
-- removed in v1.1).  DROP first: the returns type changed (the flag
-- OUT column is gone) — PostgreSQL refuses CREATE OR REPLACE across a
-- return-type change (42P13, 030 precedent).
drop function if exists public.get_current_profile_rpc();

create or replace function public.get_current_profile_rpc()
returns table (
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
             s.first_name || ' ' || s.last_name, s.email
        from public.students s
       where s.id = v_user_id;
  else
    return query
      select a.id, a.role_type, a.commissioner_role, a.full_name,
             coalesce(u.email::text, a.email)
        from public.adminprofiles a
        left join auth.users u on u.id = a.auth_id
       where a.id = v_user_id;
  end if;
end;
$$;

-- insert_audit_log_rpc: 030 body with the profiles membership test
-- replaced by an adminprofiles membership test — a stray actor id that
-- is not a current staff row is normalized to null (students' audit
-- rows keep a null actor id).  actor_role normalization to the 027
-- CHECK set ('admin','student','system','sslg_adviser') is unchanged.
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
  -- Only use actor_id if it exists in adminprofiles (students are not
  -- in adminprofiles — their audit rows carry a null actor id).
  if v_actor_id is not null and not exists (select 1 from public.adminprofiles where id = v_actor_id) then
    v_actor_id := null;
  end if;
  v_actor_name := coalesce(p_actor_name, 'System');
  v_role := lower(coalesce(p_actor_role, 'system'));
  -- 027 actor_role CHECK ('admin','student','system','sslg_adviser'):
  -- any client-visible/missing role normalizes to 'system'.
  if v_role not in ('admin', 'student', 'system', 'sslg_adviser') then
    v_role := 'system';
  end if;
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (v_actor_id, v_actor_name, v_role, p_action, p_details, p_type);
end;
$$;

-- ---------------------------------------------------------------------
-- 10) TRIGGER / DEPENDENT RE-POINTS
-- ---------------------------------------------------------------------
-- handle_new_user: the ONLY future auth.users inserts are the Chief
-- identity, so the trigger now writes an adminprofiles row (role_type
-- 'chief', commissioner_role + full_name from metadata).  The 001
-- on_auth_user_created trigger keeps firing the re-grounded body.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.adminprofiles (id, auth_id, role_type, commissioner_role, full_name, email)
  values (
    new.id,
    new.id,
    'chief',
    new.raw_user_meta_data ->> 'commissioner_role',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email
  )
  on conflict (auth_id) do update
    set role_type = excluded.role_type,
        commissioner_role = excluded.commissioner_role,
        full_name = excluded.full_name,
        email = excluded.email;
  return new;
end;
$$;

-- log_status_change: actor-name lookup re-pointed from
-- public.profiles where id = auth.uid() to public.adminprofiles where
-- id = current_session_user_id(); actor_role normalization (027 CHECK
-- literals) unchanged.
create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_actor := public.current_session_user_id();
    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      v_actor,
      coalesce((select full_name from public.adminprofiles where id = v_actor), 'System'),
      coalesce(public.current_app_role(), 'system'),
      tg_table_name || ' Status Changed',
      'Status changed from ' || old.status || ' to ' || new.status,
      'info'
    );
  end if;
  return new;
end;
$$;

-- decide_complaint_rpc: the 028 body with the actor full_name lookup
-- re-pointed to public.adminprofiles by current_session_user_id().
create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject text;
  v_actor_name text;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can decide complaints.';
  end if;

  if p_action not in ('accepted', 'rejected') then
    raise exception 'Action must be ''accepted'' or ''rejected''.';
  end if;

  if p_action = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'A rejection reason is required.';
  end if;

  select subject into v_subject
    from public.complaints
   where id = p_complaint_id and status = 'filed';

  if not found then
    raise exception 'Complaint not found or not in filed status.';
  end if;

  update public.complaints
     set status = p_action,
         resolution_note = p_reason,
         resolved_by = public.current_session_user_id(),
         resolved_at = now()
   where id = p_complaint_id and status = 'filed';

  select full_name into v_actor_name
    from public.adminprofiles
   where id = public.current_session_user_id();

  -- Audit side-effect (GRIEV-04): one row per decision.
  perform public.insert_audit_log_rpc(
    public.current_session_user_id(),
    coalesce(v_actor_name, 'Grievance Commissioner'),
    'admin',
    case when p_action = 'accepted' then 'Accepted Complaint' else 'Rejected Complaint' end,
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') '
      || p_action
      || case when p_action = 'rejected' then ': ' || p_reason else '' end,
    case when p_action = 'accepted' then 'success' else 'warning' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 11) GRANTS (least privilege, 023 pattern), re-asserted every run.
--     login_staff_direct_v2 / change_my_password run pre-session under
--     anon; profile/audit seams and the role helper serve anon +
--     authenticated; the lockout helpers stay internal (no client
--     grant).  Adminprofiles gets NO direct client DML grant beyond the
--     RLS policies in section 1.
-- ---------------------------------------------------------------------
revoke all on function public.login_staff_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_staff_direct_v2(text, text) to anon;

revoke all on function public.change_my_password(text, text) from public, authenticated;
grant execute on function public.change_my_password(text, text) to anon;

revoke all on function public.get_current_profile_rpc() from public;
grant execute on function public.get_current_profile_rpc() to anon, authenticated;

revoke all on function public.insert_audit_log_rpc(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.insert_audit_log_rpc(uuid, text, text, text, text, text) to anon, authenticated;

revoke all on function public.current_commissioner_role() from public;
grant execute on function public.current_commissioner_role() to anon, authenticated;

revoke all on function public.login_guard(text, inet) from public, anon, authenticated;
revoke all on function public.record_login_outcome(text, inet, boolean) from public, anon, authenticated;