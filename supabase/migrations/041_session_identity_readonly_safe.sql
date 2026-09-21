-- =====================================================================
-- 041_session_identity_readonly_safe.sql
-- Make the session_identity() lookup safe for PostgREST READ-ONLY (GET)
-- requests.
--
-- Run this in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   PostgREST executes read-only requests (GET/HEAD — every `.select()` the
--   app issues) inside a READ ONLY transaction.  session_identity() (022 /
--   034 / 039) performs TWO writes on lookup:
--       * lazy purge  — DELETE the row when the presented token is expired
--       * D-06 slide  — UPDATE expires_at forward on every valid web lookup
--   Inside a read-only transaction those writes raise SQLSTATE 25006
--   (read_only_sql_transaction), which PostgREST surfaces as HTTP 405
--   (Method Not Allowed).  Every authenticated GET therefore failed:
--
--       GET /rest/v1/students        405  cannot execute UPDATE in a read-only transaction
--       GET /rest/v1/audit_logs      405  cannot execute UPDATE in a read-only transaction
--       GET /rest/v1/report_templates 405 cannot execute UPDATE in a read-only transaction
--
--   RLS resolves each row through current_app_role() -> session_identity(),
--   so the failure hit any table the app lists.
--
-- WHAT
--   Re-creates ONLY public.session_identity() with the SAME token resolution
--   (x-session-token side channel first, then the legacy bearer path) and the
--   SAME 034 sliding-renewal / ticket-exclusion semantics, but gated: the
--   purge and the slide run ONLY when the transaction is writable.  On a
--   read-only GET the function degrades to a pure lookup (identity still
--   resolves correctly); the slide simply resumes on the next writable
--   request (an RPC write, a login, etc.), which is exactly the best-effort
--   behaviour D-06 already intended.
-- =====================================================================

set search_path = public, extensions;

create or replace function public.session_identity()
returns table (session_user_id uuid, session_user_role text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_headers jsonb;
  v_read_only boolean;
  v_session_token text;
  v_authorization text;
  v_raw_token text;
  v_token_hash text;
  v_user_id uuid;
  v_user_role text;
  v_expires_at timestamptz;
  v_created_at timestamptz;
  v_kind text;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if v_headers is null then
    return;
  end if;

  -- PostgREST read-only (GET/HEAD) requests run in a READ ONLY transaction;
  -- writing there raises 25006 -> HTTP 405.  Detect it up front so the
  -- purge/slide side effects below can be skipped.  'off'/missing -> write.
  begin
    v_read_only := coalesce(current_setting('transaction_read_only', true), 'off') <> 'off';
  exception when others then
    v_read_only := false;
  end;

  -- (1) Fallback transport: the dedicated side-channel header the client
  --     sends on /rest/v1 and /functions/v1 requests.  Preferred when
  --     present, because the platform edge rejects non-JWT bearers (401).
  v_session_token := v_headers ->> 'x-session-token';
  if v_session_token is not null and length(v_session_token) >= 32 then
    v_raw_token := v_session_token;
  else
    -- (2) Legacy bearer path (022): `Authorization: Bearer <64-hex>`.
    v_authorization := v_headers ->> 'authorization';
    if v_authorization is null then
      return;
    end if;
    v_raw_token := regexp_replace(v_authorization, '^[Bb]earer\s+', '');
    if v_raw_token = v_authorization or length(v_raw_token) < 32 then
      return;
    end if;
  end if;

  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  select s.user_id, s.user_role, s.expires_at, s.created_at, s.kind
    into v_user_id, v_user_role, v_expires_at, v_created_at, v_kind
    from public.sessions s
   where s.token_hash = v_token_hash;

  if v_user_id is null then
    return;
  end if;

  if v_expires_at <= now() then
    -- Lazy purge: the presented token is dead; drop the cold row — only in
    -- a writable transaction (a GET cannot, and must not, delete).
    if not v_read_only then
      delete from public.sessions where token_hash = v_token_hash;
    end if;
    return;
  end if;

  -- D-06/D-07/D-08 sliding renewal, web rows only (034 semantics): voter
  -- tickets (kind = 'ticket') keep their exact 5-minute deadline.  Skipped
  -- entirely on a read-only request (best-effort renewal — see header).
  if not v_read_only and (v_kind is null or v_kind = 'web') then
    update public.sessions
       set expires_at = least(created_at + interval '7 days', now() + interval '24 hours')
     where token_hash = v_token_hash and coalesce(kind, 'web') = 'web';
  end if;

  return query select v_user_id, v_user_role;
end;
$$;

-- Internal helper — never callable by clients (022/034/039 posture).
revoke all on function public.session_identity() from public, anon, authenticated;