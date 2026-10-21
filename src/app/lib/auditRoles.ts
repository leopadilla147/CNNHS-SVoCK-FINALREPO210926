/**
 * Single source of truth for audit-log role values.
 *
 * Audit roles travel through THREE formats in this app:
 *
 *   1. DB rows (audit_logs.actor_role) — constrained by 027 to
 *      'admin' | 'student' | 'system' | 'sslg_adviser' (lowercase).
 *   2. Local optimistic addLog(...) entries — display strings
 *      ("Admin", "Student", "SSLG Adviser", ...) written by callers,
 *      cased inconsistently ("student" vs "Student").
 *   3. Whatever the filter UI needs to compare against.
 *
 * canonicalAuditRole() collapses all of them onto the 027 constraint
 * set, so:
 *   - the System Logs role filter matches both DB and local rows,
 *   - insertAuditLog() can never send a value the check constraint
 *     would reject (a rejected insert was previously swallowed
 *     silently, so "SSLG Adviser"/"Administrator" rows never
 *     persisted).
 */

export type AuditRole = "admin" | "student" | "system" | "sslg_adviser";

/** Map any role string onto the 027 constraint set. */
export function canonicalAuditRole(role: string | null | undefined): AuditRole {
  const key = (role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (key) {
    case "admin":
    case "administrator":
      return "admin";
    case "student":
      return "student";
    case "sslg_adviser":
      return "sslg_adviser";
    case "system":
      return "system";
    default:
      // Constraint-valid fallback: an unknown actor is still an
      // authenticated session, never anon — 'system' keeps the insert
      // alive instead of losing the audit row.
      return "system";
  }
}

/** Pretty label for display (badge, filter button). */
export function auditRoleLabel(role: string | null | undefined): string {
  switch (canonicalAuditRole(role)) {
    case "admin":
      return "Admin";
    case "student":
      return "Student";
    case "sslg_adviser":
      return "SSLG Adviser";
    case "system":
      return "System";
  }
}
