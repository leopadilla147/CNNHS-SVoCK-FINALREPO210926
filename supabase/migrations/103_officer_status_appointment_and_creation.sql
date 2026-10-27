-- =====================================================================
-- 103_officer_status_appointment_and_creation.sql
--
-- Officer Management rework (the Chief's appointment surface).
--
-- WHY
--   The Officer Management page needed: richer officer statuses
--   (Active / On Leave / Retired / Resigned), a Co-commissioner
--   creation path per commissioner role, a records-only Commissioner
--   of Appointment designation (name + email, NO login), a staffing
--   readiness signal for the five roles that must exist to run the
--   system, and the retirement of the per-officer "Reset password"
--   action.
--
-- WHAT
--   1) RICHER STATUS — adminprofiles.status widens from
--      ('active','inactive') to ('active','on_leave','retired',
--      'resigned').  Existing 'inactive' rows migrate to 'resigned'
--      (an officer who was deactivated has effectively ended service;
--      no row carries a value outside the new set).  Only 'active'
--      officers count as serving their role for vacancy checks and
--      report signatories.
--   2) APPOINTMENT ROLE RETURN — the 'appointment' commissioner_role
--      rejoins the adminprofiles CHECK (027 removed it).  It is a
--      RECORDS-ONLY designation: set_appointment_commissioner_rpc
--      upserts a single row with auth_id NULL and password_hash NULL,
--      so it can never authenticate (login refuses a null hash) — it
--      exists for the roster, the vacancy check, and the report
--      signatory prefill.
--   3) OFFICER CREATION RPCs — create_commissioner_rpc /
--      create_co_commissioner_rpc / create_sslg_adviser_rpc replace
--      the legacy create_commissioner / create_sslg_adviser edge
--      functions, which still wrote the commissioners/sslg_advisers
--      tables that 037 DROPPED (and auth.users rows that staff login
--      never reads).  035 made adminprofiles the single staff
--      identity — login_staff_direct_v2 verifies the bcrypt
--      password_hash directly — so the RPCs generate a one-time temp
--      password, bcrypt it with pgcrypto (the 023 D-10 '$2' verify
--      branch), store the hash, and return the plaintext EXACTLY ONCE
--      to the Chief (D-03 modal contract).
--      create_co_commissioner_rpc enforces the primary-first rule
--      server-side: a Co-commissioner can only be created for a role
--      that currently has an ACTIVE primary commissioner (multiple
--      co-commissioners per role are allowed).
--   4) STATUS RPC — set_officer_status_rpc: chief-gated, refuses the
--      chief row (succession is deliberately out of scope), and for
--      retired/resigned purges the officer's session rows so the
--      change takes effect immediately.
--   5) LOGIN GATE — login_staff_direct_v2 refuses retired/resigned
--      officers AFTER credential verification (SEC-03: the
--      account-state answer is only ever revealed to a valid
--      credential, never used as an enumeration oracle).
--   6) SUPERSEDED SURFACES — update_commissioner_status (005)
--      targeted the dropped commissioners table; dropped here.  The
--      legacy edge functions stay in the repo unused (the client no
--      longer calls them).
--
-- GATE
--   Every new RPC enforces public.current_commissioner_role() =
--   'chief' server-side (046/068 posture) — the session-spine helper,
--   never a client-supplied role.  Officers created here get
--   auth_id NULL: nothing in the staff login or storage policies
--   reads auth.users for non-chief staff (035/072/073 precedent).
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) STATUS WIDENING — migrate first, then re-constrain.
-- ---------------------------------------------------------------------
update public.adminprofiles
   set status = 'resigned'
 where status = 'inactive';

alter table public.adminprofiles
  drop constraint if exists adminprofiles_status_check;

alter table public.adminprofiles
  add constraint adminprofiles_status_check
  check (status in ('active', 'on_leave', 'retired', 'resigned'));

-- ---------------------------------------------------------------------
-- 2) APPOINTMENT ROLE RETURN — widen the commissioner_role CHECK.
--    ('appointment' rows carry auth_id NULL + password_hash NULL via
--    section 4; they can never authenticate.)
-- ---------------------------------------------------------------------
alter table public.adminprofiles
  drop constraint if exists adminprofiles_commissioner_role_check;

alter table public.adminprofiles
  add constraint adminprofiles_commissioner_role_check
  check (commissioner_role in
    ('chief', 'screening_validation', 'electoral_board', 'grievance', 'appointment'));

-- ---------------------------------------------------------------------
-- 3) SHARED HELPERS (local to this file's RPCs)
--    * chief_only_gate() — identical posture to the inline checks in
--      046/068: raise unless the session resolves to the chief row.
--    * officer_email_is_free(p_email, p_exclude_id) — the unique index
--      on adminprofiles.email would surface a raw constraint violation;
--      raise a clear message instead.  EXECUTE is revoked from PUBLIC
--      (section 11): called directly it would be an email-existence
--      oracle; inside the definer RPCs it runs as the function owner.
-- ---------------------------------------------------------------------
create or replace function public.chief_only_gate()
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can manage officers.';
  end if;
end;
$$;

create or replace function public.officer_email_is_free(p_email text, p_exclude_id uuid default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  return not exists (
    select 1
      from public.adminprofiles a
     where lower(a.email) = lower(btrim(p_email))
       and (p_exclude_id is null or a.id != p_exclude_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4) CREATE COMMISSIONER — primary commissioner for one of the three
--    serving roles ('appointment' is records-only via section 6;
--    'chief' rows are seeded, never created here).
--    Returns the one-time temp password (shown once, D-03).
-- ---------------------------------------------------------------------
create or replace function public.create_commissioner_rpc(
  p_name text,
  p_email text,
  p_commissioner_role text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_temp_password text;
begin
  perform public.chief_only_gate();

  if p_commissioner_role is null
     or p_commissioner_role not in ('screening_validation', 'electoral_board', 'grievance') then
    raise exception 'Invalid commissioner role.';
  end if;

  if p_name is null or btrim(p_name) = '' or p_email is null or btrim(p_email) = '' then
    raise exception 'Name and email are required.';
  end if;

  if not public.officer_email_is_free(p_email) then
    raise exception 'An officer account with this email already exists.';
  end if;

  v_actor := public.current_session_user_id();

  -- One-time credential: 32 hex chars, bcrypt-hashed for the 023 D-10
  -- verify branch.  The plaintext is returned exactly once below.
  v_temp_password := replace(gen_random_uuid()::text, '-', '');

  insert into public.adminprofiles
    (role_type, commissioner_role, full_name, email, password_hash, status, appointed_by)
  values
    ('commissioner',
     p_commissioner_role,
     btrim(p_name),
     lower(btrim(p_email)),
     crypt(v_temp_password, gen_salt('bf')),
     'active',
     v_actor);

  select a.full_name into v_actor_name
    from public.adminprofiles a
   where a.id = v_actor;

  perform public.insert_audit_log_rpc(
    v_actor,
    coalesce(v_actor_name, 'Chief Commissioner'),
    'admin',
    'Appointed Commissioner',
    'Appointed ' || btrim(p_name) || ' as Commissioner of '
      || replace(p_commissioner_role, '_', ' ')
      || ' (' || lower(btrim(p_email)) || ')',
    'success'
  );

  return v_temp_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) CREATE CO-COMMISSIONER — allowed ONLY for a role that currently
--    has an ACTIVE primary commissioner (the primary-first rule the
--    UI also enforces; server-side is the real gate).  Multiple
--    co-commissioners per role are allowed.  Returns the one-time
--    temp password.
-- ---------------------------------------------------------------------
create or replace function public.create_co_commissioner_rpc(
  p_name text,
  p_email text,
  p_commissioner_role text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_primary_id uuid;
  v_primary_name text;
  v_temp_password text;
begin
  perform public.chief_only_gate();

  if p_commissioner_role is null
     or p_commissioner_role not in ('screening_validation', 'electoral_board', 'grievance') then
    raise exception 'Invalid commissioner role.';
  end if;

  if p_name is null or btrim(p_name) = '' or p_email is null or btrim(p_email) = '' then
    raise exception 'Name and email are required.';
  end if;

  if not public.officer_email_is_free(p_email) then
    raise exception 'An officer account with this email already exists.';
  end if;

  -- Primary-first rule: the newest ACTIVE primary for the role.
  select a.id, a.full_name
    into v_primary_id, v_primary_name
    from public.adminprofiles a
   where a.role_type = 'commissioner'
     and a.commissioner_role = p_commissioner_role
     and a.status = 'active'
   order by a.appointed_at desc
   limit 1;

  if v_primary_id is null then
    raise exception
      'A Commissioner of % must be appointed before a Co-commissioner can be added.',
      replace(p_commissioner_role, '_', ' ');
  end if;

  v_actor := public.current_session_user_id();
  v_temp_password := replace(gen_random_uuid()::text, '-', '');

  insert into public.adminprofiles
    (role_type, commissioner_role, full_name, email, password_hash, status,
     co_commissioner_of, appointed_by)
  values
    ('co_commissioner',
     p_commissioner_role,
     btrim(p_name),
     lower(btrim(p_email)),
     crypt(v_temp_password, gen_salt('bf')),
     'active',
     v_primary_id,
     v_actor);

  select a.full_name into v_actor_name
    from public.adminprofiles a
   where a.id = v_actor;

  perform public.insert_audit_log_rpc(
    v_actor,
    coalesce(v_actor_name, 'Chief Commissioner'),
    'admin',
    'Appointed Co-commissioner',
    'Appointed ' || btrim(p_name) || ' as Co-commissioner of '
      || replace(p_commissioner_role, '_', ' ')
      || ' (serving with ' || coalesce(v_primary_name, 'the Commissioner') || ')',
    'success'
  );

  return v_temp_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) APPOINTMENT COMMISSIONER RECORD — records-only designation.
--    Upserts THE single appointment row: name + email, no auth_id,
--    no password_hash — it appears on the roster, fills the
--    appointment vacancy, and prefills the report signatory, but can
--    never log in.  Re-running with new values updates the record.
-- ---------------------------------------------------------------------
create or replace function public.set_appointment_commissioner_rpc(
  p_name text,
  p_email text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_existing_id uuid;
begin
  perform public.chief_only_gate();

  if p_name is null or btrim(p_name) = '' or p_email is null or btrim(p_email) = '' then
    raise exception 'Name and email are required.';
  end if;

  v_actor := public.current_session_user_id();

  -- The designation is a single row; find it (if present) so the
  -- email-uniqueness check can exclude it on update.
  select a.id
    into v_existing_id
    from public.adminprofiles a
   where a.role_type = 'commissioner'
     and a.commissioner_role = 'appointment'
   limit 1;

  if not public.officer_email_is_free(p_email, v_existing_id) then
    raise exception 'An officer account with this email already exists.';
  end if;

  if v_existing_id is not null then
    update public.adminprofiles
       set full_name = btrim(p_name),
           email = lower(btrim(p_email))
     where id = v_existing_id;
  else
    insert into public.adminprofiles
      (role_type, commissioner_role, full_name, email, password_hash, status, appointed_by)
    values
      ('commissioner', 'appointment', btrim(p_name), lower(btrim(p_email)),
       null, 'active', v_actor);
  end if;

  select a.full_name into v_actor_name
    from public.adminprofiles a
   where a.id = v_actor;

  perform public.insert_audit_log_rpc(
    v_actor,
    coalesce(v_actor_name, 'Chief Commissioner'),
    'admin',
    'Designated Commissioner of Appointment',
    case
      when v_existing_id is not null then
        'Updated the Commissioner of Appointment record: ' || btrim(p_name)
          || ' (' || lower(btrim(p_email)) || ') (records only, no account)'
      else
        'Designated ' || btrim(p_name) || ' as Commissioner of Appointment ('
          || lower(btrim(p_email)) || ') (records only, no account)'
    end,
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 7) SET OFFICER STATUS — the Active / On Leave / Retired / Resigned
--    control.  Chief-gated; the chief row itself is refused
--    (succession is out of scope); retired/resigned purge the
--    officer's sessions so the change bites immediately.
-- ---------------------------------------------------------------------
create or replace function public.set_officer_status_rpc(
  p_officer_id uuid,
  p_status text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_target_name text;
  v_target_role_type text;
begin
  perform public.chief_only_gate();

  if p_officer_id is null then
    raise exception 'An officer id is required.';
  end if;

  if p_status not in ('active', 'on_leave', 'retired', 'resigned') then
    raise exception 'Invalid officer status.';
  end if;

  select a.full_name, a.role_type
    into v_target_name, v_target_role_type
    from public.adminprofiles a
   where a.id = p_officer_id;

  if v_target_role_type is null then
    raise exception 'Officer not found.';
  end if;

  if v_target_role_type = 'chief' then
    raise exception 'The Chief Commissioner status cannot be changed here.';
  end if;

  update public.adminprofiles
     set status = p_status
   where id = p_officer_id;

  -- Retired / resigned officers end service now: kill their session
  -- rows (no FK — the 068 purge pattern) so their token dies with it.
  if p_status in ('retired', 'resigned') then
    delete from public.sessions where user_id = p_officer_id;
  end if;

  v_actor := public.current_session_user_id();

  select a.full_name into v_actor_name
    from public.adminprofiles a
   where a.id = v_actor;

  perform public.insert_audit_log_rpc(
    v_actor,
    coalesce(v_actor_name, 'Chief Commissioner'),
    'admin',
    'Officer Status Changed',
    'Set ' || coalesce(v_target_name, 'an officer') || '''s status to ' || p_status,
    case when p_status in ('retired', 'resigned') then 'warning' else 'info' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8) CREATE SSLG ADVISER — mirrors create_commissioner_rpc for the
--    adviser role_type.  Returns the one-time temp password.
-- ---------------------------------------------------------------------
create or replace function public.create_sslg_adviser_rpc(
  p_name text,
  p_email text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_temp_password text;
begin
  perform public.chief_only_gate();

  if p_name is null or btrim(p_name) = '' or p_email is null or btrim(p_email) = '' then
    raise exception 'Name and email are required.';
  end if;

  if not public.officer_email_is_free(p_email) then
    raise exception 'An officer account with this email already exists.';
  end if;

  v_actor := public.current_session_user_id();
  v_temp_password := replace(gen_random_uuid()::text, '-', '');

  insert into public.adminprofiles
    (role_type, full_name, email, password_hash, status, appointed_by)
  values
    ('sslg_adviser',
     btrim(p_name),
     lower(btrim(p_email)),
     crypt(v_temp_password, gen_salt('bf')),
     'active',
     v_actor);

  select a.full_name into v_actor_name
    from public.adminprofiles a
   where a.id = v_actor;

  perform public.insert_audit_log_rpc(
    v_actor,
    coalesce(v_actor_name, 'Chief Commissioner'),
    'admin',
    'Appointed SSLG Adviser',
    'Appointed ' || btrim(p_name) || ' as SSLG Adviser (' || lower(btrim(p_email)) || ')',
    'success'
  );

  return v_temp_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) LOGIN GATE — re-apply 035's login_staff_direct_v2 body with the
--    retired/resigned refusal added AFTER credential verification
--    (SEC-03: a valid credential is the only thing that can learn the
--    account's state; unauthenticated probes keep seeing the identical
--    'Invalid credentials').
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
  v_status text;
  v_session_role text;
  v_token text;
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

  select a.id, a.role_type, a.commissioner_role, a.full_name, a.email,
         a.password_hash, a.status
    into v_id, v_role_type, v_commissioner_role, v_full_name, v_email,
         v_password_hash, v_status
    from public.adminprofiles a
   where lower(a.email) = v_identifier
   limit 1;

  if v_id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  if v_password_hash is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

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

  -- 103: ended service (retired/resigned) — refuse after verification,
  -- with the same single message for both states.  on_leave still
  -- logs in (temporary absence from duties).
  if v_status in ('retired', 'resigned') then
    raise exception 'This account is no longer active. Please contact the Chief Commissioner.';
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
-- 10) SUPERSEDED SURFACE — update_commissioner_status (005) wrote the
--     commissioners table 037 dropped; set_officer_status_rpc
--     replaces it.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.update_commissioner_status(uuid,text)') is not null then
    revoke all on function public.update_commissioner_status(uuid, text) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.update_commissioner_status(uuid, text);

-- ---------------------------------------------------------------------
-- 11) GRANTS — chief-only surfaces (046/068 posture): callable by any
--     client role, self-gated on the session-spine chief check; the
--     login RPC re-asserts its 035 grants.  The section-3 helpers stay
--     execution-private (owner-only) — officer_email_is_free must never
--     become a callable email-existence oracle.
-- ---------------------------------------------------------------------
revoke all on function public.chief_only_gate() from public, anon, authenticated;
revoke all on function public.officer_email_is_free(text, uuid) from public, anon, authenticated;

revoke all on function public.create_commissioner_rpc(text, text, text) from public, anon, authenticated;
grant execute on function public.create_commissioner_rpc(text, text, text) to anon, authenticated;

revoke all on function public.create_co_commissioner_rpc(text, text, text) from public, anon, authenticated;
grant execute on function public.create_co_commissioner_rpc(text, text, text) to anon, authenticated;

revoke all on function public.set_appointment_commissioner_rpc(text, text) from public, anon, authenticated;
grant execute on function public.set_appointment_commissioner_rpc(text, text) to anon, authenticated;

revoke all on function public.set_officer_status_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.set_officer_status_rpc(uuid, text) to anon, authenticated;

revoke all on function public.create_sslg_adviser_rpc(text, text) from public, anon, authenticated;
grant execute on function public.create_sslg_adviser_rpc(text, text) to anon, authenticated;

revoke all on function public.login_staff_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_staff_direct_v2(text, text) to anon;
