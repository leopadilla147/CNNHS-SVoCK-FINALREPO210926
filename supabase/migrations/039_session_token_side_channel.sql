-- =====================================================================
-- 039_session_token_side_channel.sql
-- Phase 02 fallback transport (docs/phase2-bearer-gate-probe.md).
--
-- Run this in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   The 022 session spine had the client overwrite PostgREST's
--   `Authorization` header with a raw non-JWT 64-hex session token
--   (`Authorization: Bearer <raw>`), expecting the hosted edge to silently
--   downgrade it to the anon role.  On this instance the edge instead
--   REJECTS a non-JWT bearer with HTTP 401, so every post-login
--   `/rest/v1` call (RPCs, table reads) fails:
--
--       POST /rest/v1/rpc/insert_audit_log_rpc  401 (Unauthorized)
--       POST /rest/v1/rpc/current_session_role  401 (Unauthorized)
--       GET  /rest/v1/notifications             401 (Unauthorized)
--       GET  /rest/v1/party_members             401 (Unauthorized)
--
--   That is assumption A ("non-JWT bearer is downgraded, not 401'd") of
--   docs/phase2-bearer-gate-probe.md FAILING, so its [Fallback transport]
--   applies: keep PostgREST's own Authorization (the platform anon JWT)
--   intact for role selection, and carry the session token in a dedicated
--   `x-session-token` request header instead.
--
-- WHAT
--   Re-creates ONLY public.session_identity() so it reads the raw token
--   from `request.headers ->> 'x-session-token'` FIRST, then falls back to
--   the legacy `authorization: Bearer <raw>` path (so pgTAP fixtures that
--   set the bearer, and any bearer-gate-capable deployment, keep working).
--   The 034 sliding-renewal / ticket-exclusion body is otherwise verbatim.
--
--   Client counterpart: src/app/lib/supabase.ts now sends
--   `x-session-token` on BOTH /rest/v1/ and /functions/v1/ requests and no
--   longer touches Authorization.
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
  -- request.headers is a transaction-local GUC carrying the request's
  -- headers as JSON (PostgREST).  Guard the empty-string case so the
  -- jsonb cast never raises on a header-less connection.
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if v_headers is null then
    return;
  end if;

  -- (1) Fallback transport: the dedicated side-channel header the client
  --     sends on /rest/v1 and /functions/v1 requests.  Preferred when
  --     present, because the platform edge rejects non-JWT bearers (401).
  v_session_token := v_headers ->> 'x-session-token';
  if v_session_token is not null and length(v_session_token) >= 32 then
    v_raw_token := v_session_token;
  else
    -- (2) Legacy bearer path (022): `Authorization: Bearer <64-hex>`.
    --     Kept so bearer-capable deployments and the pgTAP fixtures that
    --     set request.headers.authorization continue to resolve.
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
    -- Lazy purge: the presented token is dead; drop the cold row.
    delete from public.sessions where token_hash = v_token_hash;
    return;
  end if;

  -- D-06/D-07/D-08 sliding renewal, web rows only (034 verbatim): voter
  -- tickets (kind = 'ticket') keep their exact 5-minute deadline.
  if v_kind is null or v_kind = 'web' then
    update public.sessions
       set expires_at = least(created_at + interval '7 days', now() + interval '24 hours')
     where token_hash = v_token_hash and coalesce(kind, 'web') = 'web';
  end if;

  return query select v_user_id, v_user_role;
end;
$$;

-- Internal helper — never callable by clients (022/034 posture re-asserted).
revoke all on function public.session_identity() from public, anon, authenticated;