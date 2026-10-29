-- 121_password_reset_trim_fix.sql
-- =============================================================
-- Fixes verify_password_reset (120): the students branch referenced
-- students.session_version / must_change_password, both dropped by the
-- 036 domain trim (036 SECTION 2).  The error surfaced at runtime as
-- 'column "session_version" does not exist' on the first student reset
-- attempt; the whole RPC rolled back, so the issued code stayed unused.
--
-- The corrected body mirrors the 035 change_my_password branches, which
-- are the current law of the land after the trim:
--   * students      -> password_hash only (035 lines 541-545)
--   * adminprofiles -> password_hash + session_version bump (035 lines
--     511-516; the column survived the trim on adminprofiles)
-- Session death still happens on BOTH branches via the 022 sessions
-- delete — session_version is belt-and-braces only on the staff side.
--
-- Create-or-replace per repo convention (023/030/035/042/103/107):
-- migration 120 stays untouched; this supersedes it.
-- =============================================================

create or replace function public.verify_password_reset(
  p_email text,
  p_code text,
  p_new_password text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_identifier text;
  v_code_hash text;
  v_ip inet;
  v_headers jsonb;
  v_row public.password_reset_codes%rowtype;
  v_account_id uuid;
begin
  -- Same minimum as change_my_password (030): 8 characters.
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;

  v_identifier := lower(btrim(coalesce(p_email, '')));

  -- Codes are uppercase-only (edge function alphabet); accept what the
  -- user typed in any case, then hash exactly what was stored.
  v_code_hash := encode(
    sha256(convert_to(coalesce(upper(btrim(p_code)), ''), 'UTF8')),
    'hex'
  );

  -- 023 pattern: derive the client IP from x-forwarded-for (absent or
  -- malformed header -> NULL, per-IP throttle skipped).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- Shared lockout with the login RPCs (SEC-03): a locked identifier/IP
  -- gets the identical text as a bad code — never an oracle.
  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid or expired reset code';
  end if;

  select * into v_row
    from public.password_reset_codes c
   where c.code_hash = v_code_hash
     and c.used = false
     and c.expires_at > now()
     and c.email = v_identifier
   order by c.created_at desc
   limit 1;

  if v_row.id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid or expired reset code';
  end if;

  -- Re-resolve the account at verify time (the row may outlive the
  -- account if it was deleted between request and verify).
  if v_row.account_type = 'student' then
    select s.id into v_account_id from public.students s where s.id = v_row.account_id;
  else
    select a.id into v_account_id from public.adminprofiles a where a.id = v_row.account_id;
  end if;

  if v_account_id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid or expired reset code';
  end if;

  if v_row.account_type = 'student' then
    -- 036 trimmed students.session_version / must_change_password; mirror
    -- the 035 change_my_password student branch (password only).
    update public.students
       set password_hash = crypt(p_new_password, gen_salt('bf', 10))
     where id = v_account_id;
  else
    update public.adminprofiles
       set password_hash = crypt(p_new_password, gen_salt('bf', 10)),
           session_version = session_version + 1
     where id = v_account_id;
  end if;

  -- 022 session spine: the reset kills every active session on BOTH
  -- branches (D-14 semantics).
  delete from public.sessions where user_id = v_account_id;

  update public.password_reset_codes
     set used = true
   where id = v_row.id;

  -- Success clears the shared failure counter (same row the login RPCs use).
  perform public.record_login_outcome(v_identifier, v_ip, true);
end;
$$;

-- Grants re-asserted per the 108 repo convention (anon AND authenticated —
-- the SPA executes as anon under the custom-auth flow).
grant execute on function public.verify_password_reset(text, text, text) to anon;
grant execute on function public.verify_password_reset(text, text, text) to authenticated;
