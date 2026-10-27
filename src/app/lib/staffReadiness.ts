import type { StaffRosterRow } from "./supabaseData";

/**
 * 103 — staffing readiness for the five roles the system needs to run.
 *
 * A role counts as filled ONLY by an ACTIVE primary:
 *   - the three serving commissioner roles fill from an active
 *     role_type='commissioner' row (a Co-commissioner never fills the
 *     role — they serve alongside a primary, not instead of one);
 *   - 'appointment' fills from the records-only designation row
 *     (name + email, no login — migration 103);
 *   - 'sslg_adviser' fills from any active adviser row.
 * On Leave / Retired / Resigned rows never fill a role.
 */
export const REQUIRED_ROLE_LABELS: Record<string, string> = {
  screening_validation: "Commissioner of Screening & Validation",
  electoral_board: "Commissioner of Electoral Board",
  grievance: "Commissioner of Grievance",
  appointment: "Commissioner of Appointment",
  sslg_adviser: "SSLG Adviser",
};

/** Labels of the required roles that currently have no active primary. */
export function missingRequiredRoles(roster: StaffRosterRow[]): string[] {
  const filled = new Set<string>();
  roster.forEach((row) => {
    if (row.status !== "active") return;
    if (row.role_type === "commissioner" && row.commissioner_role) {
      filled.add(row.commissioner_role);
    }
    if (row.role_type === "sslg_adviser") {
      filled.add("sslg_adviser");
    }
  });
  return Object.entries(REQUIRED_ROLE_LABELS)
    .filter(([key]) => !filled.has(key))
    .map(([, label]) => label);
}
