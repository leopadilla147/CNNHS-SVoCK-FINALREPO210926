import { ClipboardList, Users } from "lucide-react";
import type { CandidateProfile, PositionTally } from "./ProclamationDialog";

/** One substantiated grievance with its read-only findings (097). */
export interface SubstantiatedGrievance {
  id: string;
  subject: string;
  findings?: string | null;
}

/** 114 — a resolved complaint classified Unsubstantiated or Dismissed.
 *  It gets the same click-to-reveal Findings as a substantiated grievance. */
export interface OtherResolvedComplaint {
  id: string;
  subject: string;
  decisionLabel: string;
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
  /** 114 — the election's Unsubstantiated / Dismissed resolutions. */
  otherResolved: OtherResolvedComplaint[];
  /** Candidate profiles (photo, grade level) keyed by candidateId — the
   *  detailed winners list needs them for the pictures. */
  profiles?: Record<string, CandidateProfile>;
  /** 113b — the FINAL confirmation lists every selected winner with their
   *  picture, name and position; the review dialog's bottom summary shows
   *  only how many winners are selected. */
  winnersDetail?: boolean;
}

const NOT_RECORDED = "Not recorded yet";

/**
 * The board's whole proclamation at a glance — how many winners are
 * selected, the shared tie resolution, and the complaint note/reason.
 * Two shapes: at the bottom of the proclamation review dialog it stays a
 * compact count, and inside the final confirmation (`winnersDetail`) each
 * selected winner is listed with their picture, name and position, so the
 * Electoral Board signs off on exactly the candidates it chose.
 */
export function ProclamationSummary({
  positions,
  resolutions,
  tieBreakLabel,
  complaintNote,
  complaintReason,
  complaintSubjects,
  substantiated,
  otherResolved,
  profiles = {},
  winnersDetail = false,
}: ProclamationSummaryProps) {
  const hasTies = positions.some((p) => p.isTie);

  // The winner of every position: the clean-win leader straight from the
  // tally, or the tied candidate the board picked.  A tie without a pick
  // has no winner yet — it counts as unselected.
  const winners = positions.map((p) => {
    const resolution = resolutions[p.position];
    const picked =
      p.isTie && resolution?.method === "manual"
        ? p.tied.find((c) => c.candidateId === resolution.candidateId)
        : undefined;
    return {
      position: p.position,
      isTie: p.isTie,
      selected: !p.isTie || !!picked,
      winner: picked ?? p.candidates[0],
    };
  });
  const selectedCount = winners.filter((w) => w.selected).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-gray-900">
        <ClipboardList size={15} /> Proclamation Summary
      </div>
      <div className="mt-2 space-y-2 text-xs text-gray-700">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Winners to proclaim — {selectedCount} of {positions.length} selected
          </div>
          {winnersDetail ? (
            /* Final confirmation: every selected winner with their picture,
                name and position — the candidates the Board is about to
                proclaim. */
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {winners.map((w) => {
                const profile = w.winner ? profiles[w.winner.candidateId] : undefined;
                const name = w.winner?.candidateName ?? "—";
                return (
                  <div
                    key={w.position}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2"
                  >
                    {profile?.picture ? (
                      <img
                        src={profile.picture}
                        alt={name}
                        className="w-10 h-10 rounded-full object-cover border-2 shrink-0"
                        style={{ borderColor: "#5C0102" }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center border-2 shrink-0"
                        style={{ borderColor: "#5C0102" }}
                      >
                        <Users size={16} className="text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      {/* The FULL name and position — no truncation: the
                          final confirmation is where the board signs off on
                          exactly who is being proclaimed. */}
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 break-words">
                        {w.position}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 leading-snug break-words">
                        {name}
                      </div>
                    </div>
                    {w.isTie && (
                      <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                        Tie — board choice
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Review-dialog bottom summary: just the number of selected
                winners — the tally above already names them. */
            <div className="mt-1">
              <span className="font-semibold text-gray-900">
                {selectedCount} of {positions.length} winners selected
              </span>
            </div>
          )}
        </div>
        {hasTies && (
          <div>
            <span className="font-medium text-gray-500">Tie resolution: </span>
            {tieBreakLabel || <span className="italic text-amber-600">{NOT_RECORDED}</span>}
          </div>
        )}
        {(substantiated.length > 0 || otherResolved.length > 0 || complaintReason.trim() !== "") && (
          <div>
            <span className="font-medium text-gray-500">Complaint Resolution and Justification: </span>
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
        {otherResolved.length > 0 && (
          <div>
            <span className="font-medium text-gray-500">
              Complaint decision{otherResolved.length === 1 ? "" : "s"} on record:{" "}
            </span>
            {otherResolved.map((c) => `${c.subject} (${c.decisionLabel})`).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
