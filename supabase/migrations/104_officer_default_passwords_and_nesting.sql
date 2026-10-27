-- =====================================================================
-- 104_officer_default_passwords_and_nesting.sql
--
-- Officer Management round two (the Chief's appointment surface).
--
-- WHY
--   The Chief asked for: per-role DEFAULT passwords instead of random
--   one-time credentials, a Co-commissioner creation path that lives
--   under each commissioner's roster row (including the records-only
--   Commissioner of Appointment, whose co-commissioner is records-only
--   too), and co-commissioner rows rendered nested beneath their
--   primary commissioner.
--
-- WHAT
--   1) ROLE DEFAULT PASSWORDS — create_commissioner_rpc and
--      create_co_commissioner_rpc swap the random gen_random_uuid()
--      credential for the school's role defaults:
--        electoral_board        -> electoral123
--        grievance              -> grievance123
--        screening_validation   -> screening123
--        sslg_adviser           -> sslg123   (create_sslg_adviser_rpc)
--      A co-commissioner receives THEIR ROLE'S default (e.g. an
--      Electoral co-commissioner gets electoral123) — the role's
--      default, never the primary's current password.  Still
--      bcrypt-hashed at rest and returned to the Chief exactly once
--      (D-03 modal).  There is deliberately NO forced first-login
--      change: the default stays valid until the officer personally
--      changes it (documented capstone decision — chief123 seed
--      precedent).  Existing officers are NOT backfilled.
--   2) RECORDS-ONLY CO-COMMISSIONER FOR THE APPOINTMENT COMMISSIONER —
--      create_co_commissioner_rpc now accepts 'appointment': the co row
--      is a name+email record with NO account (password_hash NULL,
--      auth_id NULL) linked via co_commissioner_of to the appointment
--      row, and the RPC returns NULL — no password to hand over.  The
--      primary-first rule still applies: an ACTIVE appointment record
--      must exist before its co-commissioner can be added.
--   3) ROSTER NESTING — list_staff_roster_rpc now returns
--      co_commissioner_of (uuid, null for non-co rows) so the client
--      can render each co-commissioner indented beneath its primary.
--
-- GATE
--   Unchanged from 103: every RPC self-gates on the session-spine
--   chief check; officer_email_is_free stays execution-private.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) CREATE COMMISSIONER — role default password (104).
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

  -- 104 role default (bcrypt-hashed below; returned exactly once).
  v_temp_password := case p_commissioner_role
    when 'electoral_board' then 'electoral123'
    when 'grievance' then 'grievance123'
    when 'screening_validation' then 'screening123'
  end;

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
-- 2) CREATE CO-COMMISSIONER — role default password, plus the 104
--    records-only 'appointment' branch.  Multiple co-commissioners per
--    role are allowed.  Returns the default password, or NULL for the
--    records-only appointment co (no account to credential).
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
  v_records_only boolean;
begin
  perform public.chief_only_gate();

  if p_commissioner_role is null
     or p_commissioner_role not in ('screening_validation', 'electoral_board', 'grievance', 'appointment') then
    raise exception 'Invalid commissioner role.';
  end if;

  if p_name is null or btrim(p_name) = '' or p_email is null or btrim(p_email) = '' then
    raise exception 'Name and email are required.';
  end if;

  if not public.officer_email_is_free(p_email) then
    raise exception 'An officer account with this email already exists.';
  end if;

  -- Primary-first rule: the newest ACTIVE primary (or appointment
  -- record) for the role.
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
      case
        when p_commissioner_role = 'appointment' then 'Appointment'
        else replace(p_commissioner_role, '_', ' ')
      end;
  end if;

  v_actor := public.current_session_user_id();
  v_records_only := (p_commissioner_role = 'appointment');

  -- 104 role default; the records-only appointment co gets NO account,
  -- so password_hash stays NULL and nothing is returned.
  v_temp_password := case p_commissioner_role
    when 'electoral_board' then 'electoral123'
    when 'grievance' then 'grievance123'
    when 'screening_validation' then 'screening123'
  end;

  insert into public.adminprofiles
    (role_type, commissioner_role, full_name, email, password_hash, status,
     co_commissioner_of, appointed_by)
  values
    ('co_commissioner',
     p_commissioner_role,
     btrim(p_name),
     lower(btrim(p_email)),
     case when v_records_only then null else crypt(v_temp_password, gen_salt('bf')) end,
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
      || case
           when p_commissioner_role = 'appointment' then 'Appointment'
           else replace(p_commissioner_role, '_', ' ')
         end
      || ' (serving with ' || coalesce(v_primary_name, 'the Commissioner') || ')'
      || case when v_records_only then ' (records only, no account)' else '' end,
    'success'
  );

  return v_temp_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) CREATE SSLG ADVISER — role default password (104).
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
  v_temp_password := 'sslg123';

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
-- 4) ROSTER NESTING — list_staff_roster_rpc gains co_commissioner_of.
--    Return type changes, so DROP first (42P13 — 030/035 precedent).
-- ---------------------------------------------------------------------
drop function if exists public.list_staff_roster_rpc();

create function public.list_staff_roster_rpc()
returns table (
  id uuid,
  full_name text,
  email text,
  role_type text,
  commissioner_role text,
  status text,
  appointed_at timestamptz,
  co_commissioner_of uuid
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can view the staff roster.';
  end if;

  return query
    select a.id, a.full_name, a.email, a.role_type, a.commissioner_role,
           a.status, a.appointed_at, a.co_commissioner_of
      from public.adminprofiles a
     order by
       case a.role_type
         when 'chief' then 1
         when 'commissioner' then 2
         when 'co_commissioner' then 3
         when 'sslg_adviser' then 4
         else 5
       end,
       a.full_name;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) GRANTS — re-asserted every run (046 posture).
-- ---------------------------------------------------------------------
revoke all on function public.create_commissioner_rpc(text, text, text) from public, anon, authenticated;
grant execute on function public.create_commissioner_rpc(text, text, text) to anon, authenticated;

revoke all on function public.create_co_commissioner_rpc(text, text, text) from public, anon, authenticated;
grant execute on function public.create_co_commissioner_rpc(text, text, text) to anon, authenticated;

revoke all on function public.create_sslg_adviser_rpc(text, text) from public, anon, authenticated;
grant execute on function public.create_sslg_adviser_rpc(text, text) to anon, authenticated;

revoke all on function public.list_staff_roster_rpc() from public, anon, authenticated;
grant execute on function public.list_staff_roster_rpc() to anon, authenticated;
