import { ClipboardList } from "lucide-react";
import type { PositionTally } from "./ProclamationDialog";

/** One substantiated grievance with its read-only findings (097). */
export interface SubstantiatedGrievance {
  id: string;
  subject: string;
  findings?: string | null;
}

interface ProclamationSummaryProps {
  /** Every position in the running order, ties flagged. */
  positions: PositionTally[];
  /** The board's chosen winner per tied position — candidateId is still
   *  optional while the board works inside the review dialog. */
  resolutions: Record<string, { method: "manual"; candidateId?: string }>;
  /** The shared tie-break decision, e.g. "Coin Toss" ("" until recorded). */
  tieBreakLabel: string;
  complaintNote: string;
  complaintReason: string;
  /** Subjects of the complaints still filed against this election. */
  complaintSubjects: string[];
  /** The election's substantiated grievances (097). */
  substantiated: SubstantiatedGrievance[];
}

const NOT_RECORDED = "Not recorded yet";

/**
 * The board's whole proclamation at a glance — winners per position, the
 * shared tie resolution, and the complaint note/reason — rendered at the
 * bottom of the proclamation review dialog and inside its final
 * confirmation, so the Electoral Board signs off on exactly one summary.
 */
export function ProclamationSummary({
  positions,
  resolutions,
  tieBreakLabel,
  complaintNote,
  complaintReason,
  complaintSubjects,
  substantiated,
}: ProclamationSummaryProps) {
  const hasTies = positions.some((p) => p.isTie);
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-gray-900">
        <ClipboardList size={15} /> Proclamation Summary
      </div>
      <div className="mt-2 space-y-2 text-xs text-gray-700">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Winners to proclaim
          </div>
          <ul className="mt-1 space-y-0.5">
            {positions.map((p) => {
              const resolution = resolutions[p.position];
              const picked =
                p.isTie && resolution?.method === "manual"
                  ? p.tied.find((c) => c.candidateId === resolution.candidateId)
                  : undefined;
              return (
                <li key={p.position} className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-gray-900">{p.position}:</span>
                  {picked ? (
                    <>
                      <span>{picked.candidateName}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                        Tie — board choice
                      </span>
                    </>
                  ) : p.isTie ? (
                    <span className="italic text-amber-600">Tie — no winner chosen yet</span>
                  ) : (
                    <span>{p.candidates[0]?.candidateName ?? "—"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {hasTies && (
          <div>
            <span className="font-medium text-gray-500">Tie resolution: </span>
            {tieBreakLabel || <span className="italic text-amber-600">{NOT_RECORDED}</span>}
          </div>
        )}
        {(substantiated.length > 0 || complaintReason.trim() !== "") && (
          <div>
            <span className="font-medium text-gray-500">Complaint Reason: </span>
            {complaintReason.trim() || <span className="italic text-amber-600">{NOT_RECORDED}</span>}
          </div>
        )}
        {complaintSubjects.length > 0 && (
          <div>
            <span className="font-medium text-gray-500">Note on the complaint{complaintSubjects.length === 1 ? "" : "s"}: </span>
            {complaintNote.trim() || <span className="italic text-amber-600">{NOT_RECORDED}</span>}
          </div>
        )}
        {substantiated.length > 0 && (
          <div>
            <span className="font-medium text-gray-500">
              Substantiated grievance{substantiated.length === 1 ? "" : "s"} on record:{" "}
            </span>
            {substantiated.map((g) => g.subject).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
