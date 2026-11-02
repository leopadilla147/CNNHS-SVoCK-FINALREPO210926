import type {
  Complaint,
  ComplaintEvidence,
  ComplaintSanction,
  DisqualifiedCandidate,
  ElectionStage,
} from "../context/AppContext";

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

/**
 * 096: supporting-evidence upload rules.  The `accept` string drives the
 * file inputs; the client validates the same limits the bucket enforces
 * (10 MB, images + PDF + Word) so a bad pick fails fast with a clear message.
 */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_FILES = 5;
export const EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const EVIDENCE_ACCEPT = EVIDENCE_MIME_TYPES.join(",");

/** Human label for the allowed evidence types. */
export const EVIDENCE_TYPES_LABEL = "JPEG, PNG, WebP, PDF, or Word";

/**
 * Validate a freshly picked evidence file list.  `existingCount` is how many
 * files are already attached (so the running total never exceeds the cap).
 * Returns a message to show the user, or null when the picks are acceptable.
 */
export function validateEvidenceFiles(files: File[], existingCount = 0): string | null {
  if (files.length === 0) return "Please choose at least one file.";
  if (existingCount + files.length > EVIDENCE_MAX_FILES) {
    return `You can attach at most ${EVIDENCE_MAX_FILES} files.`;
  }
  const badType = files.find((f) => !EVIDENCE_MIME_TYPES.includes(f.type as (typeof EVIDENCE_MIME_TYPES)[number]));
  if (badType) {
    return `"${badType.name}" is not an allowed file type. Upload ${EVIDENCE_TYPES_LABEL} files only.`;
  }
  const tooBig = files.find((f) => f.size > EVIDENCE_MAX_BYTES);
  if (tooBig) {
    return `"${tooBig.name}" is larger than 10 MB.`;
  }
  return null;
}

/** True when an evidence file name looks like an image we can thumbnail. */
export function isImageEvidence(name?: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name ?? "");
}

/** Normalize a raw jsonb evidence column into the client shape. */
export function toEvidenceArray(value: any): ComplaintEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.url === "string")
    .map((item) => ({ url: item.url, name: typeof item.name === "string" ? item.name : "Evidence" }));
}

/** 127: normalize a raw sanctions text[] into the known sanction values. */
export function toSanctionArray(value: any): ComplaintSanction[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ComplaintSanction =>
    (COMPLAINT_SANCTION_VALUES as readonly string[]).includes(item)
  );
}

/** 127: pair the disqualified candidate ids with their denormalized names. */
export function toDisqualifiedCandidates(
  ids: any,
  names: any
): DisqualifiedCandidate[] {
  if (!Array.isArray(names)) return [];
  const idList = Array.isArray(ids) ? ids : [];
  return names
    .map((name, index) => ({
      id: typeof idList[index] === "string" ? idList[index] : "",
      name: typeof name === "string" ? name : "",
    }))
    .filter((candidate) => candidate.name !== "");
}

/**
 * The "Nature of Complaint" options.  The DB still stores a free-text
 * subject; this list only constrains what the filing form offers.  "Others"
 * is always last: picking it reveals a free-text field whose value becomes
 * the subject.
 */
export const COMPLAINT_SUBJECT_OTHERS = "Others";

export const COMPLAINT_SUBJECTS = [
  "Dishonesty",
  "Oppression",
  "Disgraceful and Immoral Conduct",
  "Impersonation",
  "Falsification",
  "Vote Solicitation",
  "Negligence of Duty",
  "Misconduct",
  COMPLAINT_SUBJECT_OTHERS,
] as const;

/** Resolve the stored subject from the dropdown choice + the "Others" free text. */
export function resolveComplaintSubject(subject: string, otherSubject: string): string {
  return subject === COMPLAINT_SUBJECT_OTHERS ? otherSubject.trim() : subject.trim();
}

/**
 * Who/what the complaint is filed against.  "Others" is last and reveals a
 * free-text field whose value becomes the complaintAgainst.
 */
export const COMPLAINT_AGAINST_OTHERS = "Others";

export const COMPLAINT_AGAINST_OPTIONS = [
  "Learner Government COMEA",
  "Teacher",
  "Learner",
  "Candidate",
  "Political Party",
  COMPLAINT_AGAINST_OTHERS,
] as const;

/** Resolve the stored complaint-against from the dropdown + "Others" text. */
export function resolveComplaintAgainst(against: string, otherAgainst: string): string {
  return against === COMPLAINT_AGAINST_OTHERS ? otherAgainst.trim() : against.trim();
}

export interface ComplaintFormInput {
  complaintAgainst: string;
  otherAgainst: string;
  subject: string;
  otherSubject: string;
  description: string;
  incidentDate: string;
  certified: boolean;
}

export interface ComplaintFormErrors {
  complaintAgainst?: string;
  subject?: string;
  description?: string;
  incidentDate?: string;
  certified?: string;
}

/** The exact wording the student agrees to before filing. */
export const COMPLAINT_CERTIFICATION =
  "I hereby certify that the information stated herein is true and correct to the best of my knowledge.";

/**
 * Today as a YYYY-MM-DD string (local time) — the latest selectable Date of
 * Incident.  An incident cannot be reported before it happens, so the filing
 * form only offers the current date or past dates (the input's `max` and the
 * validator below share this value).
 */
export function todayDateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Required-field validation for the filing form: Complaint Against, Nature of
 * Complaint, Narrative Report, Date of Incident, and the certification are all
 * mandatory.  The incident date may be today or in the past — the incident
 * being reported may well have already happened — but never in the future.
 * Returns one message per invalid field (empty object = valid).
 */
export function validateComplaintForm(input: ComplaintFormInput): ComplaintFormErrors {
  const errors: ComplaintFormErrors = {};
  if (!resolveComplaintAgainst(input.complaintAgainst, input.otherAgainst)) {
    errors.complaintAgainst = input.complaintAgainst === COMPLAINT_AGAINST_OTHERS
      ? "Please specify who or what the complaint is against."
      : "Please select who the complaint is against.";
  }
  if (!resolveComplaintSubject(input.subject, input.otherSubject)) {
    errors.subject = input.subject === COMPLAINT_SUBJECT_OTHERS
      ? "Please specify the nature of your complaint."
      : "Please select the nature of your complaint.";
  }
  if (!input.description.trim()) errors.description = "Please provide a narrative report.";
  if (!input.incidentDate) {
    errors.incidentDate = "Please select the date of the incident.";
  } else if (input.incidentDate > todayDateStr()) {
    errors.incidentDate = "The date of the incident cannot be in the future.";
  }
  if (!input.certified) errors.certified = "Please certify that the information is true and correct before filing.";
  return errors;
}

/**
 * The "filed at" stamp — date + 12-hour time from the raw submitted_at.  Falls
 * back to the date-only `submittedAt` when the exact timestamp is unavailable.
 */
export function formatSubmittedAt(complaint: Pick<Complaint, "submittedAt" | "submittedAtExact">): string {
  const raw = complaint.submittedAtExact;
  if (!raw) return complaint.submittedAt;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return complaint.submittedAt;
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} at ${time}`;
}

/** Map a raw complaints row (fetch/mapComplaint source) into the client shape. */
export function toComplaintDto(row: any): Complaint {
  const studentName = row.students ? `${row.students.first_name} ${row.students.last_name}` : "Student";
  return {
    id: row.id,
    studentName,
    subject: row.subject,
    description: row.description,
    complaintAgainst: row.complaint_against || undefined,
    status: row.status,
    submittedAt: row.submitted_at?.slice(0, 10) || "",
    submittedAtExact: row.submitted_at || undefined,
    decision: row.decision || undefined,
    sanctions: toSanctionArray(row.sanctions),
    disqualifiedCandidates: toDisqualifiedCandidates(
      row.disqualified_candidate_ids,
      row.disqualified_candidate_names
    ),
    evidence: toEvidenceArray(row.evidence_urls),
    findingsEvidence: toEvidenceArray(row.findings_evidence_urls),
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

/**
 * 097: the Grievance Commissioner's resolution classification.  114: ANY of
 * the three forces the Board's one-time Complaint Resolution and
 * Justification before winners are proclaimed — a Substantiated grievance
 * taints the election, while Unsubstantiated / Dismissed still owe the
 * public an explanation of how they were resolved.
 */
export const COMPLAINT_DECISION_VALUES = ["substantiated", "unsubstantiated", "dismissed"] as const;

export const COMPLAINT_DECISION_LABELS: Record<NonNullable<Complaint["decision"]>, string> = {
  substantiated: "Substantiated Grievance",
  unsubstantiated: "Unsubstantiated Grievance",
  dismissed: "Dismissed Grievance",
};

/** What each classification means — shown to the Commissioner as they pick. */
export const COMPLAINT_DECISION_DEFINITIONS: Record<NonNullable<Complaint["decision"]>, string> = {
  substantiated: "The complaint is supported by evidence.",
  unsubstantiated: "There is insufficient evidence to establish the allegation.",
  dismissed: "The complaint is closed without further action, according to the applicable rules.",
};

/** The definition for a decision, or "" when none is chosen. */
export function complaintDecisionDefinition(decision?: Complaint["decision"]): string {
  return decision ? COMPLAINT_DECISION_DEFINITIONS[decision] : "";
}

/** Human label for a decision; unclassified (legacy/NULL) rows read clearly. */
export function complaintDecisionLabel(decision?: Complaint["decision"]): string {
  return decision ? COMPLAINT_DECISION_LABELS[decision] : "Not classified";
}

/** The election's complaints classified as a Substantiated Grievance. */
export function substantiatedComplaints(rows: Complaint[]): Complaint[] {
  return rows.filter((c) => c.decision === "substantiated");
}

/**
 * 127: the sanctions a Grievance Commissioner may impose — only ever on a
 * Substantiated Grievance.  "Verbal Warning" is the lightest, so a
 * substantiated decision is never left without at least one sanction.
 */
export const COMPLAINT_SANCTION_VALUES = [
  "verbal_warning",
  "reprimand",
  "disqualification",
] as const;

export const COMPLAINT_SANCTION_LABELS: Record<ComplaintSanction, string> = {
  verbal_warning: "Verbal Warning",
  reprimand: "Reprimand Through Writing",
  disqualification: "Disqualification",
};

/** Human label for one sanction. */
export function complaintSanctionLabel(sanction: ComplaintSanction): string {
  return COMPLAINT_SANCTION_LABELS[sanction];
}

/** "Verbal Warning, Reprimand Through Writing" — "" when no sanction is set. */
export function complaintSanctionsSummary(sanctions?: ComplaintSanction[] | null): string {
  return (sanctions ?? []).map(complaintSanctionLabel).join(", ");
}

/** True when the sanction list carries a Disqualification. */
export function hasDisqualificationSanction(sanctions?: ComplaintSanction[] | null): boolean {
  return (sanctions ?? []).includes("disqualification");
}

/** "Juan Dela Cruz, Maria Santos" — "" when nobody is to be disqualified. */
export function disqualifiedCandidatesSummary(
  candidates?: DisqualifiedCandidate[] | null
): string {
  return (candidates ?? []).map((candidate) => candidate.name).filter(Boolean).join(", ");
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