-- =====================================================================
-- 056_audit_results_rpc.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   The kiosk "Opening Election Audit" / "Final Election Audit" buttons
--   (login/login.js: handleAuditPrint) read live_results_restricted
--   directly.  That view's client SELECT grant was REVOKED:
--     * 027 revoke select on public.live_results_restricted from authenticated;
--     * 051 revoke select on table public.live_results_restricted
--           from public, anon, authenticated;
--   so the anon kiosk client now gets
--       "permission denied for view live_results_restricted".
--
-- WHAT
--   Adds the authorized electoral-board audit read path as
--   public.get_audit_results_rpc().  It is a SECURITY DEFINER function, so
--   it runs as the view owner and bypasses the revoked client SELECT.  It
--   is granted to anon + authenticated because the audit is requested from
--   the trusted precinct kiosk and returns ONLY aggregate candidate
--   tallies (never voter identities).
--
--   The return shape matches public.live_results_restricted verbatim, so
--   the client grouping/winner logic is unchanged:
--     election_period_id, position, candidate_id, given_name, surname,
--     party_name, votes
--
-- NOTE
--   get_live_results_rpc() (051/053) is left untouched: it keeps its
--   Chief/Electoral-Board role gate for the live dashboard.  This new
--   RPC is the narrower, kiosk-audit-specific read path.
-- =====================================================================

set search_path = public, extensions;

create or replace function public.get_audit_results_rpc()
returns table (
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  given_name text,
  surname text,
  party_name text,
  votes bigint
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  -- Authorized electoral-board audit read: runs as owner, so the revoked
  -- client SELECT on live_results_restricted does not apply.  Only
  -- aggregate candidate tallies leave the database.
  return query
    select * from public.live_results_restricted;
end;
$$;

revoke all on function public.get_audit_results_rpc() from public, anon, authenticated;
grant execute on function public.get_audit_results_rpc() to anon, authenticated;