-- 108_disable_rpc_grants.sql
-- =============================================================
-- Grant fix for the 107 Disable-Student-Accounts RPCs.
--
-- This app does NOT use Supabase Auth JWTs: every request — including
-- logged-in SSLG Advisers — executes under the `anon` PostgREST role,
-- with the staff session riding the x-session-token side-channel header
-- (session_identity resolves the actor for RLS / current_session_user_id).
-- 107 granted both RPCs to `authenticated` only, so PostgREST answered
-- 401 "permission denied for function".  Mirror the repo convention used
-- by every other session-spine RPC (022/028): grant to anon AND
-- authenticated.  The password check inside each function is the real
-- gate — not the grant.
-- =============================================================

grant execute on function public.verify_adviser_password_rpc(text) to anon;
grant execute on function public.disable_student_accounts_rpc(uuid[], text, text) to anon;
