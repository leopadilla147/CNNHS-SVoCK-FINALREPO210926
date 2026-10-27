-- 107_student_account_disable.sql
-- =============================================================
-- SSLG Adviser "Disable Student Accounts" (Student Enrollment tab).
--
-- Disabling is deliberately SEPARATE from status='rejected': a disabled
-- account was legitimately approved and later deactivated (the learner
-- graduated or transferred to another school), while 'rejected' means the
-- registration itself was denied.
--
--   students.disabled_at      - set when the account is disabled
--   students.disabled_reason  - 'graduated' | 'transferred' (NULL otherwise)
--
-- Two SECURITY DEFINER RPCs, both gated by the acting staff member's OWN
-- password (bcrypt via crypt, 023 convention) and by the session-spine
-- actor (AUTH-05 — the actor derives ONLY from current_session_user_id(),
-- never from a client parameter):
--
--   verify_adviser_password_rpc(p_password)          - the "before
--     accessing" gate in front of the disable panel
--   disable_student_accounts_rpc(p_student_ids,      - the consequential
--     p_reason, p_password)                            move; re-verifies
--                                                      the password
--
-- login_student_direct_v2 (042 body re-emitted) refuses disabled accounts
-- AFTER the password verifies — the message never leaks to non-owners.
-- =============================================================

alter table public.students
  add column if not exists disabled_at timestamptz;

alter table public.students
  add column if not exists disabled_reason text
  check (disabled_reason is null or disabled_reason in ('graduated', 'transferred'));

-- ---------------------------------------------------------------------
-- verify_adviser_password_rpc — the gate in front of the disable panel.
-- ---------------------------------------------------------------------
create or replace function public.verify_adviser_password_rpc(p_password text)
returns boolean
language plpgsql
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

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if not found or v_hash is null then
    raise exception 'The SSLG Adviser password was not accepted.';
  end if;

  if v_hash is distinct from crypt(p_password, v_hash) then
    raise exception 'The SSLG Adviser password was not accepted.';
  end if;

  return true;
end;
$$;

revoke all on function public.verify_adviser_password_rpc(text) from public, anon;
grant execute on function public.verify_adviser_password_rpc(text) to authenticated;

-- ---------------------------------------------------------------------
-- disable_student_accounts_rpc — the consequential move.
-- Role gate mirrors review_student_rpc (036): chief / commissioner /
-- co_commissioner / sslg_adviser.  Only APPROVED, not-yet-disabled
-- accounts are touched; every disable is audited.
-- ---------------------------------------------------------------------
create or replace function public.disable_student_accounts_rpc(
  p_student_ids uuid[],
  p_reason text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_actor_role text;
  v_hash text;
  v_disabled int;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select a.full_name, a.role_type, a.password_hash
    into v_actor_name, v_actor_role, v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if not found then
    raise exception 'Only admins or active SSLG advisers can disable student accounts.';
  end if;

  v_actor_role := case when v_actor_role = 'sslg_adviser' then 'sslg_adviser' else 'admin' end;
  v_actor_name := coalesce(v_actor_name, 'Administrator');

  -- Password gate: the acting staff member's own password, bcrypt-verified.
  if v_hash is null or v_hash is distinct from crypt(p_password, v_hash) then
    raise exception 'The SSLG Adviser password was not accepted.';
  end if;

  if p_reason not in ('graduated', 'transferred') then
    raise exception 'Reason must be graduated or transferred.';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'Select at least one student account to disable.';
  end if;

  update public.students
     set disabled_at = now(),
         disabled_reason = p_reason
   where id = any(p_student_ids)
     and status = 'approved'
     and disabled_at is null
   returning 1 into v_disabled;

  get diagnostics v_disabled = row_count;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    v_actor_name,
    v_actor_role,
    'Student Accounts Disabled',
    format('Disabled %s student account(s) — reason: %s.',
           v_disabled,
           case when p_reason = 'graduated' then 'Graduated' else 'Transferred to another school' end),
    'warning'
  );

  return jsonb_build_object('disabled', v_disabled);
end;
$$;

revoke all on function public.disable_student_accounts_rpc(uuid[], text, text) from public, anon;
grant execute on function public.disable_student_accounts_rpc(uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------
-- login_student_direct_v2 — 042 body re-emitted with the disabled check.
-- The check sits AFTER the password verification, so only the true
-- account owner ever learns the account is disabled (SEC-03 discipline).
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
    -- 042 FIX: bare `id` was ambiguous against the RETURNS TABLE OUT
    -- variable of the same name; fully qualify students.id.
    update public.students
       set password_hash = crypt(p_password, gen_salt('bf', 10))
     where students.id = v_student.id;
  end if;

  -- 107: disabled accounts (graduated / transferred) never log in.  The
  -- check runs only after the password verified, so the reason surfaces
  -- to the real owner and to nobody else.
  if v_student.disabled_at is not null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Your account has been disabled (%). You can no longer log in. Please contact the SSLG Adviser.',
      case v_student.disabled_reason
        when 'graduated' then 'Graduated'
        else 'Transferred to another school'
      end;
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_student.id, 'student');

  return query
    select v_token, v_student.id, v_student.first_name, v_student.last_name,
           v_student.email, v_student.status;
end;
$$;

-- Grants re-asserted (042 contract): anon-only pre-session surface.
revoke all on function public.login_student_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_student_direct_v2(text, text) to anon;
