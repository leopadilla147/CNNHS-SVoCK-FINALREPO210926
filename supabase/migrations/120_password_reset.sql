-- 120_password_reset.sql
-- =============================================================
-- Forgot-password email OTP ("reset code") — DB half.
--
-- Flow split (mirrors the 030 change-password split):
--   * send_password_reset edge function (verify_jwt = false) resolves the
--     account (students OR adminprofiles), mints an 8-char code from the
--     unambiguous alphabet, stores ONLY its SHA-256 here (022 session-token
--     derivation — the plaintext code lives just long enough to be emailed),
--     and delivers it through the Brevo HTTP API (hosted Deno Deploy blocks
--     outbound SMTP ports 25/465/587, so Gmail SMTP is not reachable — the
--     same reason the legacy `php mailer/` scripts cannot be reused as-is).
--   * verify_password_reset RPC (this file, SECURITY DEFINER, granted to
--     anon) hashes the submitted code, swaps the account password, and
--     reuses the 023 login lockout so code-guessing counts against the
--     same counter as login failures.
--
-- Hash convention (023 D-10): new passwords are always bcrypt
-- (crypt + gen_salt('bf', 10)); the legacy-SHA-256 branch is login-time
-- verification only.  On success every active session dies
-- (session_version bump + sessions delete, D-14 semantics).
--
-- Anti-enumeration: the edge function answers ok:true whether or not the
-- account exists; this RPC raises one generic text for every failure mode
-- (unknown code, expired, used, email mismatch, lockout).
-- =============================================================

-- ---------------------------------------------------------------------
-- 1) password_reset_codes — short-lived OTP rows.  RLS on with NO
--    policies: the edge function writes through the service role and the
--    definer RPC reads; anon/authenticated get nothing over PostgREST.
-- ---------------------------------------------------------------------
create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  account_type text not null check (account_type in ('student', 'staff')),
  account_id uuid not null,
  email text not null,          -- stored lowercased by the edge function
  code_hash text not null,      -- sha256 hex of upper(trim(code)) — 022 derivation
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_codes_open_hash_idx
  on public.password_reset_codes (code_hash)
  where used = false;

-- Plain (not expression) index: the edge function queries email = <lower>.
create index if not exists password_reset_codes_email_created_idx
  on public.password_reset_codes (email, created_at desc);

alter table public.password_reset_codes enable row level security;

-- ---------------------------------------------------------------------
-- 2) verify_password_reset — code check + password swap + session kill.
--    SECURITY DEFINER because the caller is the anon SPA (pre-login, no
--    session spine identity yet); the code hash + lockout are the gate.
-- ---------------------------------------------------------------------
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
    update public.students
       set password_hash = crypt(p_new_password, gen_salt('bf', 10)),
           session_version = session_version + 1,
           must_change_password = false
     where id = v_account_id;
  else
    update public.adminprofiles
       set password_hash = crypt(p_new_password, gen_salt('bf', 10)),
           session_version = session_version + 1
     where id = v_account_id;
    -- 035 deliberately deferred the staff forced-change flag; nothing to
    -- clear on profiles for staff.
  end if;

  -- D-14: the reset kills every active session for the account.
  delete from public.sessions where user_id = v_account_id;

  update public.password_reset_codes
     set used = true
   where id = v_row.id;

  -- Success clears the shared failure counter (same row the login RPCs use).
  perform public.record_login_outcome(v_identifier, v_ip, true);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Grants — repo convention (108): the SPA executes as anon under the
--    custom-auth flow; grant to anon AND authenticated.  The code hash +
--    lockout inside the function are the real gate, not the grant.
-- ---------------------------------------------------------------------
grant execute on function public.verify_password_reset(text, text, text) to anon;
grant execute on function public.verify_password_reset(text, text, text) to authenticated;
