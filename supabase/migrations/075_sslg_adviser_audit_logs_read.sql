-- ====================================================================
-- 075_sslg_adviser_audit_logs_read.sql
--
-- Purpose:
--   The System Logs tab is shown ONLY to the Chief Commissioner and the
--   SSLG Adviser (sidebar change in DashboardSidebar.tsx).  The only
--   audit_logs SELECT policy is still the 001-era
--
--     "audit logs admin select" ... using (current_app_role() = 'admin')
--
--   which 038 explicitly left untouched.  Under the session spine an
--   SSLG Adviser session resolves current_app_role() = 'sslg_adviser'
--   (035: role_type -> session role mapping), so RLS silently filtered
--   every audit_logs row to nothing and the adviser's System Logs page
--   would render empty (safeSelect returns [], no error).
--
-- Change:
--   Re-create the SAME policy name (keeps 001's drop-if-exists
--   idempotency pattern) widened to the adviser session role:
--
--     current_app_role() in ('admin', 'sslg_adviser')
--
--   'admin' still covers the Chief Commissioner AND the other three
--   commissioners (035 maps chief/commissioner/co_commissioner all to
--   session role 'admin') — hiding their sidebar tab is a UI decision,
--   not a data-access one; no other role's access is narrowed here.
--
-- Rollback:
--   drop policy if exists "audit logs admin select" on public.audit_logs;
--   create policy "audit logs admin select" on public.audit_logs
--     for select using (public.current_app_role() = 'admin');
-- ====================================================================

drop policy if exists "audit logs admin select" on public.audit_logs;

create policy "audit logs admin select" on public.audit_logs
  for select
  using (public.current_app_role() in ('admin', 'sslg_adviser'));
