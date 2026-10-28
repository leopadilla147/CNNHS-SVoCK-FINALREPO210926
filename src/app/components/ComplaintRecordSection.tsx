import { CheckCircle2, ShieldAlert } from "lucide-react";
import type { ElectionComplaintRecord } from "../lib/supabaseData";
import { complaintDecisionLabel } from "../lib/complaints";
import { FindingsDisclosure } from "./FindingsDisclosure";

interface ComplaintRecordSectionProps {
  /** 099 — the election's sanitized public complaint record. */
  entries: ElectionComplaintRecord[];
  /** 081 — the Board's public note on the complaint(s) of record. */
  complaintNote?: string;
  /** 097 — the Board's one-time explanation for a substantiated grievance. */
  decisionReason?: string;
  /** Label for the Board's explanation.  The public results pages call it
   *  the "Complaint Resolution and Justification"; the live page keeps the
   *  Stage-5 wording "Complaint Reason". */
  decisionReasonLabel?: string;
  /** Whether the Grievance Commissioner's findings are shown with their
   *  click-to-reveal toggle.  The public results pages omit them. */
  showFindings?: boolean;
}

const DEFAULT_DECISION_REASON_LABEL = "Complaint Reason";

/**
 * The public complaint record of an election — the same treatment the
 * Electoral Board sees in Stage 5: every resolved grievance (substantiated
 * or not) with its click-to-reveal findings, and whatever is still on file.
 * Renders nothing for an election with no complaint record at all, so pages
 * without one look exactly as before.
 */
export function ComplaintRecordSection({
  entries,
  complaintNote,
  decisionReason,
  decisionReasonLabel = DEFAULT_DECISION_REASON_LABEL,
  showFindings = true,
}: ComplaintRecordSectionProps) {
  const substantiated = entries.filter((e) => e.decision === "substantiated");
  const otherResolved = entries.filter(
    (e) => e.status === "accepted" && e.decision !== "substantiated",
  );
  const filed = entries.filter((e) => e.status === "filed");

  if (entries.length === 0 && !complaintNote && !decisionReason) return null;

  return (
    <div className="space-y-3">
      {substantiated.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="flex items-center gap-2 font-medium">
            <ShieldAlert size={16} className="shrink-0" />
            Substantiated grievance{substantiated.length === 1 ? "" : "s"} on record (
            {substantiated.length})
          </div>
          <ul className="mt-2 space-y-1.5">
            {substantiated.map((e) =>
              showFindings ? (
                <FindingsDisclosure
                  key={e.id}
                  id={`record-findings-${e.id}`}
                  subject={e.subject}
                  decisionLabel="Substantiated Grievance"
                  findings={e.findings}
                />
              ) : (
                <li key={e.id} className="text-xs flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">{e.subject}</span>
                  <span className="opacity-70">· Substantiated Grievance</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {otherResolved.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} className="shrink-0" />
            Complaint decisions ({otherResolved.length})
          </div>
          {/* 114 — the same click-to-reveal Findings a substantiated
              grievance gets; the public results pages keep the plain row. */}
          <ul className="mt-1.5 space-y-1.5">
            {otherResolved.map((e) =>
              showFindings ? (
                <FindingsDisclosure
                  key={e.id}
                  id={`record-other-findings-${e.id}`}
                  subject={e.subject}
                  decisionLabel={complaintDecisionLabel(e.decision ?? undefined)}
                  findings={e.findings}
                />
              ) : (
                <li key={e.id} className="text-xs flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">{e.subject}</span>
                  <span className="opacity-70">· {complaintDecisionLabel(e.decision ?? undefined)}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {filed.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-2 text-sm text-amber-800">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              {filed.length} {filed.length === 1 ? "complaint is" : "complaints are"} still on
              file.
            </div>
            <ul className="list-disc list-inside text-xs mt-1 space-y-0.5">
              {filed.map((e) => (
                <li key={e.id}>{e.subject}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {(complaintNote || decisionReason) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
          {decisionReason && (
            <div className="text-xs">{decisionReasonLabel}: {decisionReason}</div>
          )}
          {complaintNote && (
            <div className="text-xs">Electoral Board note: {complaintNote}</div>
          )}
        </div>
      )}
    </div>
  );
}
