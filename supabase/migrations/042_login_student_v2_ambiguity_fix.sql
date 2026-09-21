-- =====================================================================
-- 042_login_student_v2_ambiguity_fix.sql
-- Fixes P0002 "column reference \"id\" is ambiguous" on
-- public.login_student_direct_v2(text, text).
--
-- Root cause: since 036 the function RETURNS TABLE (token, id, ...), and
-- every RETURNS TABLE column becomes an OUT variable in PL/pgSQL.  The
-- transparent re-hash UPDATE used a bare `where id = v_student.id`, so
-- `id` resolved ambiguously between the OUT variable and
-- public.students.id -> 42P18/P0002 at runtime -> HTTP 400 on
-- /rest/v1/rpc/login_student_direct_v2.
--
-- Fix: identical 036 body with every students column reference inside
-- the UPDATE (and the SELECT ... FROM students) explicitly qualified as
-- students.<col> so no OUT variable can shadow a table column.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: the USER applies this; the executor never touches live DB.
-- =====================================================================

set search_path = public, extensions;

drop function if exists public.login_student_direct_v2(text, text);

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

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_student.id, 'student');

  return query
    select v_token, v_student.id, v_student.first_name, v_student.last_name,
           v_student.email, v_student.status;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants re-asserted (036 contract): anon-only pre-session surface.
-- ---------------------------------------------------------------------
revoke all on function public.login_student_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_student_direct_v2(text, text) to anon;