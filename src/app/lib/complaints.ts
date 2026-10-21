import type { Complaint, ElectionStage } from "../context/AppContext";

/**
 * Pure complaint helpers (Phase 4, Plan 04-02 - GRIEV-05 / D-01).
 *
 * D-01: the ONLY client statuses are 'filed' | 'accepted' | 'rejected'
 * (pending/resolved/dismissed are dead - 028 maps them server-side).
 * 086 wording change: 'accepted' DISPLAYS as "Resolved" (statusLabel)
 * while the stored literal stays 'accepted' - labels only, no DB rename.
 * toComplaintDto maps a raw complaints row (with the students join and
 * the 028 columns) into the client shape; buildSubmitPayload builds the
 * INSERT payload the page sends to insertComplaint.
 */

/** Map a raw complaints row (fetch/mapComplaint source) into the client shape. */
export function toComplaintDto(row: any): Complaint {
  const studentName = row.students ? `${row.students.first_name} ${row.students.last_name}` : "Student";
  return {
    id: row.id,
    studentName,
    subject: row.subject,
    description: row.description,
    status: row.status,
    submittedAt: row.submitted_at?.slice(0, 10) || "",
    rejectionReason: row.resolution_note || undefined,
    findings: row.findings_note || undefined,
    incidentDate: row.incident_date?.slice(0, 10) || undefined,
    resolvedAt: row.resolved_at?.slice(0, 10) || undefined,
  };
}

export interface SubmitComplaintInput {
  title: string;
  description: string;
  incidentDate?: string;
}

/**
 * Build the INSERT payload for insertComplaint - client field names to
 * the 028 column names (status is omitted: 028 defaults it to 'filed').
 */
export function buildSubmitPayload(input: SubmitComplaintInput, studentId: string) {
  return {
    student_id: studentId,
    subject: input.title,
    description: input.description,
    incident_date: input.incidentDate || null,
  };
}

/** D-01 status → human label + tone used by the history list pills. */
export function statusLabel(status: Complaint["status"]): string {
  // 086 wording change: the stored 'accepted' literal reads as "Resolved".
  if (status === "accepted") return "Resolved";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** D-01 status → pill metadata (label + tone) for the history list. */
export function statusMeta(status: Complaint["status"]): { label: string; tone: "amber" | "green" | "red" } {
  const tone = status === "filed" ? "amber" : status === "accepted" ? "green" : "red";
  return { label: statusLabel(status), tone };
}

const STATUS_RANK: Record<Complaint["status"], number> = { filed: 0, accepted: 1, rejected: 2 };

/**
 * D-11 pending-first ordering: filed rows first, then accepted, then rejected,
 * stable by submitted_at desc inside each group.
 */
export function sortFiledFirst(rows: Complaint[]): Complaint[] {
  return [...rows].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0;
  });
}

/**
 * The complaint filing window (089): complaints open at the campaign stage
 * and close as soon as voting ends — the moment the period reaches the
 * 'results' stage.  'application' is not open yet; 'completed' is retired.
 * Mirrors the trg_complaint_election_period gate (089) — the DB trigger
 * stays authoritative, this only drives the UI.
 */
export function complaintWindowOpen(period: { lifecycleStage?: ElectionStage }): boolean {
  return (
    period.lifecycleStage === "campaign" ||
    period.lifecycleStage === "fingerprint_registration" ||
    period.lifecycleStage === "voting"
  );
}

/**
 * Complaints stay with the election they were filed under (089): only rows
 * stamped with the current period's id belong in the live lists.  Rows from
 * previous elections surface only in the admin archive; with no current
 * period there is no election to show complaints for.
 */
export function complaintsForElection(complaints: Complaint[], electionPeriodId?: string): Complaint[] {
  if (!electionPeriodId) return [];
  return complaints.filter((c) => c.electionPeriodId === electionPeriodId);
}