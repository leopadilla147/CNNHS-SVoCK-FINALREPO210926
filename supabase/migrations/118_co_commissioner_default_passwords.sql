-- =====================================================================
-- 118_co_commissioner_default_passwords.sql
--
-- Officer Management (the Chief's appointment surface).
--
-- WHY
--   The Chief asked for Co-commissioner default passwords that are
--   distinct from their primary commissioner's: "co" + the role's
--   keyword + "123" (e.g. an Electoral Board Co-commissioner gets
--   coelectoral123, not electoral123).
--
-- WHAT
--   create_co_commissioner_rpc re-issued with a co-prefixed default:
--     screening_validation  -> coscreening123
--     electoral_board       -> coelectoral123
--     grievance             -> cogrievance123
--     appointment           -> unchanged: records-only co gets NO
--                              account (password_hash NULL, returns NULL)
--   Primaries keep their 104 role defaults (electoral123 /
--   grievance123 / screening123) and the SSLG adviser keeps sslg123 —
--   only create_co_commissioner_rpc changes.  Still bcrypt-hashed at
--   rest and returned to the Chief exactly once (D-03 modal).  No
--   backfill of existing co-commissioners.
--
-- GATE
--   Unchanged from 103/104: the RPC self-gates on the session-spine
--   chief check; signature and grants are unchanged, so a plain
--   create or replace suffices.
-- =====================================================================

set search_path = public, extensions;

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

  -- 118 co default ("co" + role keyword + "123"), distinct from the
  -- primary's 104 default.  The records-only appointment co gets NO
  -- account, so password_hash stays NULL and nothing is returned.
  v_temp_password := case p_commissioner_role
    when 'electoral_board' then 'coelectoral123'
    when 'grievance' then 'cogrievance123'
    when 'screening_validation' then 'coscreening123'
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

-- Grants — re-asserted (104 posture; signature unchanged).
revoke all on function public.create_co_commissioner_rpc(text, text, text) from public, anon, authenticated;
grant execute on function public.create_co_commissioner_rpc(text, text, text) to anon, authenticated;
