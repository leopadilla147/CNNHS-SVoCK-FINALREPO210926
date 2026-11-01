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
  /** Every position in the running order, with its seat-aware winners. */
  positions: PositionTally[];
  /** The board's picks and "Keep Current Winner" affirmations per position —
   *  candidateIds are still optional while the board works inside the
   *  review dialog. */
  resolutions: Record<string, { method?: "manual"; candidateIds?: string[]; remainWinner?: boolean }>;
  /** 123 — TRUE when ANY complaint is on record: positions whose default
   *  winners are neither affirmed nor replaced by the board are still open,
   *  and the board's picks in choice mode may be ANY candidate. */
  hasComplaints: boolean;
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
  hasComplaints,
  tieBreakLabel,
  complaintNote,
  complaintReason,
  complaintSubjects,
  substantiated,
  otherResolved,
  profiles = {},
  winnersDetail = false,
}: ProclamationSummaryProps) {
  const hasTies = positions.some((p) => p.picksNeeded > 0);

  // The winner(s) of every position.  123 — with a complaint on record the
  // board either affirms the default winner(s) ("Keep Current Winner") or
  // chooses every seat itself from ANY candidate: in choice mode the rows
  // are the board's picks alone, otherwise the default winners straight
  // from the tally (117 — one for most positions, up to two for a Grade
  // Level Representative) plus the tied candidate(s) the board picked.  A
  // position without the required picks has winner slots still open.
  const winners = positions.map((p) => {
    const resolution = resolutions[p.position];
    const affirmed = hasComplaints && !!resolution?.remainWinner && (p.tied.length === 1 || p.bothWin);
    const choiceMode = hasComplaints && !affirmed && (p.tied.length === 1 || p.bothWin);
    // The seats the board must fill by hand: every seat in choice mode,
    // otherwise just the tied seat(s).
    const required = choiceMode ? p.seats : p.picksNeeded;
    const picked =
      required > 0 && resolution?.method === "manual"
        ? p.candidates.filter((c) => resolution.candidateIds?.includes(c.candidateId))
        : [];
    return {
      position: p.position,
      seats: p.seats,
      picksNeeded: required,
      bothWin: p.bothWin,
      choiceMode,
      selected: required === 0 || picked.length === required,
      rows: choiceMode
        ? picked.map((c) => ({ candidate: c, kind: "pick" as const }))
        : [
            ...p.autoWinners.map((c) => ({ candidate: c, kind: "auto" as const })),
            ...picked.map((c) => ({ candidate: c, kind: "pick" as const })),
          ],
      // 117/122 — the affirmation lands on the default winners only (a
      // unique top candidate, or both winners of a 2-way Grade Rep tie);
      // seats the board picked never carry it.
      remainWinner: affirmed,
    };
  });
  // 123 — in choice mode the board's picks fill every seat, which equals
  // autoWinners.length + picksNeeded in every outcome, so the slot count
  // holds for both modes.
  const totalSlots = positions.reduce((n, p) => n + p.autoWinners.length + p.picksNeeded, 0);
  const selectedCount = winners.reduce((n, w) => n + w.rows.length, 0);

  // The slate splits into the elected officers and the Grade Level
  // Representatives — the detailed list renders them as two labelled
  // groups so the two-winner positions read as their own block.
  const officerWinners = winners.filter((w) => w.seats === 1);
  const gradeRepWinners = winners.filter((w) => w.seats > 1);

  const renderWinnerCards = (group: typeof winners) =>
    group.flatMap((w) =>
      w.rows.map(({ candidate, kind }) => {
        const profile = profiles[candidate.candidateId];
        // 122/123 — the card's status tag, rendered below the name
        // so it never squeezes the name out of the card.
        const tag =
          kind === "pick"
            ? { label: w.choiceMode ? "Board's choice" : "Tie — board choice", tone: "amber" as const }
            : w.remainWinner
              ? { label: "Winner stands", tone: "green" as const }
              : w.bothWin
                ? { label: "Tie — both proclaimed", tone: "amber" as const }
                : null;
        return (
          <div
            key={`${w.position}:${candidate.candidateId}`}
            className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-2.5"
          >
            {profile?.picture ? (
              <img
                src={profile.picture}
                alt={candidate.candidateName}
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
            <div className="min-w-0 flex-1">
              {/* The FULL name and position — no truncation: the
                  final confirmation is where the board signs off
                  on exactly who is being proclaimed. */}
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 break-words leading-snug">
                {w.position}
              </div>
              <div className="mt-0.5 text-sm font-semibold text-gray-900 leading-snug break-words">
                {candidate.candidateName}
              </div>
              {tag && (
                <div className="mt-1.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                      tag.tone === "green"
                        ? "bg-green-50 border-green-200 text-green-700"
                        : "bg-amber-50 border-amber-200 text-amber-700"
                    }`}
                  >
                    {tag.label}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      }),
    );

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-gray-900">
        <ClipboardList size={15} /> Proclamation Summary
      </div>
      <div className="mt-2 space-y-2 text-xs text-gray-700">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {/* 117 — a Grade Level Representative position elects two
                winners, so the count is winner slots, not positions. */}
            Winners to proclaim — {selectedCount} of {totalSlots} selected
          </div>
          {winnersDetail ? (
            /* Final confirmation: every selected winner with their picture,
                name and position — the candidates the Board is about to
                proclaim — grouped into the elected officers and the Grade
                Level Representatives (117 — up to two per Grade Level
                Representative position).  Four columns on wide screens; the
                status tag sits on its own line under the name so the full
                name and position always fit (122/123). */
            <div className="mt-2 space-y-3">
              {officerWinners.some((w) => w.rows.length > 0) && (
                <div>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Elected Officers
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {renderWinnerCards(officerWinners)}
                  </div>
                </div>
              )}
              {gradeRepWinners.some((w) => w.rows.length > 0) && (
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <div className="h-px flex-1 bg-gray-200" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Grade Level Representatives
                    </span>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {renderWinnerCards(gradeRepWinners)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Review-dialog bottom summary: just the number of selected
                winners — the tally above already names them. */
            <div className="mt-1">
              <span className="font-semibold text-gray-900">
                {selectedCount} of {totalSlots} winners selected
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
