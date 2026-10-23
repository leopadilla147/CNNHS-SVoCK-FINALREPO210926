import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Gavel,
  Loader2,
  ShieldAlert,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import type { ProclamationTallyRow, TieResolution } from "../lib/supabaseData";
import { FULL_POSITION_ORDER as POSITION_ORDER } from "../lib/partyScope";
import { FindingsDisclosure } from "./FindingsDisclosure";
import { ProclamationSummary } from "./ProclamationSummary";
import type { SubstantiatedGrievance } from "./ProclamationSummary";

const POSITION_INDEX = new Map<string, number>(
  POSITION_ORDER.map((position, index) => [position, index]),
);

export interface PositionTally {
  position: string;
  /** Candidates in running order — highest vote first. */
  candidates: ProclamationTallyRow[];
  topVotes: number;
  /** Every candidate sharing the top count (> 1 means a tie). */
  tied: ProclamationTallyRow[];
  isTie: boolean;
}

/** The candidate's profile details joined onto a tally row by id. */
export interface CandidateProfile {
  /** The candidate's submitted profile photo URL, when they have one. */
  picture?: string;
  gradeLevel?: string;
}

/** Group the flat tally rows into positions, ranked highest-vote-first. */
export function groupTally(tally: ProclamationTallyRow[]): PositionTally[] {
  const byPosition = new Map<string, ProclamationTallyRow[]>();
  for (const row of tally) {
    const list = byPosition.get(row.position);
    if (list) list.push(row);
    else byPosition.set(row.position, [row]);
  }

  return [...byPosition.entries()]
    .map(([position, rows]) => {
      const candidates = [...rows].sort(
        (a, b) => b.votes - a.votes || a.candidateName.localeCompare(b.candidateName),
      );
      const topVotes = candidates[0]?.votes ?? 0;
      const tied = candidates.filter((c) => c.votes === topVotes);
      return { position, candidates, topVotes, tied, isTie: tied.length > 1 };
    })
    .sort(
      (a, b) =>
        (POSITION_INDEX.get(a.position) ?? POSITION_ORDER.length) -
        (POSITION_INDEX.get(b.position) ?? POSITION_ORDER.length),
    );
}

/**
 * A per-tie draft: only the board's chosen winner lives here.  085b — the
 * resolution METHOD is one shared decision for the whole election (recorded
 * below the complaint note), so a tie is resolved once its winner is picked.
 */
type DraftResolution = { method: "manual"; candidateId?: string };

function isResolved(resolution: DraftResolution | undefined): boolean {
  return !!resolution?.candidateId;
}

function tallyVoteLabel(votes: number): string {
  return `${votes} vote${votes === 1 ? "" : "s"}`;
}

/** What the board records about the announcement itself (081). */
export interface ProclamationDecision {
  complaintNote: string;
  /** 097 — the one-time explanation required when a substantiated grievance is on record. */
  complaintReason: string;
  /** 085b — the ONE shared tie resolution method, written onto every tie. */
  tieBreak: string;
}

interface ProclamationDialogProps {
  open: boolean;
  /** The tally is being fetched. */
  loading: boolean;
  /** The proclamation RPC is in flight. */
  confirming: boolean;
  error: string | null;
  tally: ProclamationTallyRow[];
  /** Candidate profiles (photo, grade level) keyed by candidateId — rows
   *  without one fall back to a generic avatar. */
  profiles?: Record<string, CandidateProfile>;
  /** Subjects of the complaints still filed against this election (081). */
  complaintSubjects: string[];
  /** 097 — the election's SUBSTANTIATED grievances (already resolved), each
   *  with its read-only findings shown beside the subject. */
  substantiatedGrievances: SubstantiatedGrievance[];
  onCancel: () => void;
  onConfirm: (
    resolutions: Record<string, TieResolution>,
    decision: ProclamationDecision,
  ) => void;
}

/**
 * 069 — the proclaim-winners review.  Shows the tally for every position
 * with the highest vote on top, flags ties, and asks the Electoral Board
 * to pick the winner of each tied position.  085b — ONE resolution method
 * for the whole election is recorded below the complaint note and applies
 * to every tie, instead of being re-entered inside each per-candidate
 * confirm.  When a complaint is still filed, the board decides the
 * winners and records a note on the complaint.
 */
export function ProclamationDialog({
  open,
  loading,
  confirming,
  error,
  tally,
  profiles = {},
  complaintSubjects,
  substantiatedGrievances,
  onCancel,
  onConfirm,
}: ProclamationDialogProps) {
  const positions = useMemo(() => groupTally(tally), [tally]);
  const [resolutions, setResolutions] = useState<Record<string, DraftResolution>>({});
  const [pendingPick, setPendingPick] = useState<{ position: string; candidate: ProclamationTallyRow } | null>(null);
  // 081 — the complaint note required when a complaint is on record.  085b —
  // ONE tie-break method for the whole election, recorded below the complaint
  // note instead of inside every per-candidate confirm.
  const [tieMethod, setTieMethod] = useState("");
  const [tieOther, setTieOther] = useState("");
  const [complaintNote, setComplaintNote] = useState("");
  // 097 — required one-time explanation when a substantiated grievance exists.
  const [complaintReason, setComplaintReason] = useState("");

  // Each fresh open starts from a clean slate — a stale resolution from a
  // previous attempt must never leak into a new proclamation.
  useEffect(() => {
    if (open) {
      setResolutions({});
      setPendingPick(null);
      setTieMethod("");
      setTieOther("");
      setComplaintNote("");
      setComplaintReason("");
    }
  }, [open]);

  if (!open) return null;

  const tiePositions = positions.filter((p) => p.isTie);
  const unresolvedTies = tiePositions.filter((p) => !isResolved(resolutions[p.position]));
  const complaintsPending = complaintSubjects.length > 0;
  const decisionReady = !complaintsPending || complaintNote.trim() !== "";
  // 097 — a substantiated grievance requires the Board's one-time explanation.
  const substantiatedPending = substantiatedGrievances.length > 0;
  const reasonReady = !substantiatedPending || complaintReason.trim() !== "";
  // 085b — one method covers every tie; "Others" needs its text.
  const tieMethodReady =
    tiePositions.length === 0 ||
    (tieMethod !== "" && (tieMethod !== "others" || tieOther.trim() !== ""));
  // The board cannot pick a winner of a tied position until the Complaint
  // Reason (097) and the shared tie resolution method are both recorded —
  // the choice is only final once the reasoning behind it is on record.
  const picksLocked = !reasonReady || !tieMethodReady;
  const lockedBecause = [
    !reasonReady ? "the Complaint Reason" : null,
    !tieMethodReady ? "how the tie" + (tiePositions.length === 1 ? " was" : "s were") + " resolved" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const sharedTieBreak =
    tieMethod === "coin_toss" ? "Coin Toss"
    : tieMethod === "draw_lots" ? "Draw Lots"
    : tieOther.trim();
  const canProclaim =
    !loading && !confirming && positions.length > 0 && unresolvedTies.length === 0 && decisionReady && reasonReady && tieMethodReady;

  const setResolution = (position: string, resolution: DraftResolution) => {
    setResolutions((prev) => ({ ...prev, [position]: resolution }));
  };

  const openPick = (position: string, candidate: ProclamationTallyRow) => {
    setPendingPick({ position, candidate });
  };

  const confirmPick = () => {
    if (!pendingPick) return;
    setResolution(pendingPick.position, {
      method: "manual",
      candidateId: pendingPick.candidate.candidateId,
    });
    setPendingPick(null);
  };

  const handleConfirm = () => {
    const payload: Record<string, TieResolution> = {};
    for (const p of positions) {
      const resolution = resolutions[p.position];
      if (!p.isTie || !isResolved(resolution)) continue;
      if (resolution && resolution.method === "manual" && resolution.candidateId) {
        payload[p.position] = {
          method: "manual",
          candidateId: resolution.candidateId,
          // 085b — the one shared decision, written onto every tie.
          tieBreak: sharedTieBreak,
        };
      }
    }
    onConfirm(payload, {
      complaintNote: complaintNote.trim(),
      complaintReason: complaintReason.trim(),
      tieBreak: sharedTieBreak,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !confirming && onCancel()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="proclaim-dialog-title"
        className="relative bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Trophy size={18} style={{ color: "#5C0102" }} />
            <div>
              <h3 id="proclaim-dialog-title" className="text-gray-900 text-sm font-semibold">Publish & Proclaim Winners</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Review the tally for every position. Highest vote is on top; resolve any tie before proclaiming.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={confirming}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" /> Loading the vote tally…
            </div>
          ) : positions.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              There are no approved candidates to proclaim for this election.
            </div>
          ) : (
            <div className="space-y-4">
              {complaintsPending && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                  <div className="flex items-start gap-2 text-xs text-amber-800">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold uppercase tracking-wider text-[11px]">
                        {complaintSubjects.length} unresolved {complaintSubjects.length === 1 ? "complaint" : "complaints"} — the Board decides
                      </div>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {complaintSubjects.map((subject, i) => (
                          <li key={i}>{subject}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="proclaim-complaint-note" className="block text-xs font-medium text-gray-700 mb-1">
                      Note on the complaint{complaintSubjects.length === 1 ? "" : "s"}
                    </label>
                    <textarea
                      id="proclaim-complaint-note"
                      value={complaintNote}
                      onChange={(e) => setComplaintNote(e.target.value)}
                      rows={2}
                      placeholder="How the complaint(s) were weighed in this decision."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#5C0102]/20 focus:border-[#5C0102]/40"
                    />
                  </div>
                </div>
              )}

              {/* 097 — a substantiated grievance taints the election, so the
                  Board must record a Complaint Reason (one-time explanation)
                  before proclaiming.  Sits ABOVE the tie-break decision.
                  Each grievance also shows its read-only Findings. */}
              {substantiatedPending && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-4 space-y-3">
                  <div className="flex items-start gap-2 text-xs text-red-800">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold uppercase tracking-wider text-[11px]">
                        {substantiatedGrievances.length} substantiated {substantiatedGrievances.length === 1 ? "grievance" : "grievances"} — a Complaint Reason is required
                      </div>
                      <ul className="mt-1 space-y-1.5">
                        {substantiatedGrievances.map((g) => (
                          <FindingsDisclosure
                            key={g.id}
                            id={`proclaim-findings-${g.id}`}
                            subject={g.subject}
                            findings={g.findings}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="proclaim-complaint-reason" className="block text-xs font-medium text-gray-700 mb-1">
                      Complaint Reason (one-time explanation)
                    </label>
                    <textarea
                      id="proclaim-complaint-reason"
                      value={complaintReason}
                      onChange={(e) => setComplaintReason(e.target.value)}
                      rows={2}
                      placeholder="Explain how the substantiated grievance affected this proclamation."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#5C0102]/20 focus:border-[#5C0102]/40"
                    />
                  </div>
                </div>
              )}

              {/* 085b — ONE tie-break decision for the whole election,
                  directly below the complaint reason / complaint note (or
                  first, when there is neither).  The per-candidate confirms
                  only pick the winner; this method is written onto every tie. */}
              {tiePositions.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                  <div className="flex items-start gap-2 text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold uppercase tracking-wider text-[11px]">
                        {tiePositions.length} {tiePositions.length === 1 ? "position ends" : "positions end"} in a tie — one decision for all
                      </div>
                      <p className="mt-1 text-[11px] text-amber-700">
                        Pick the winner of each tied position below{complaintsPending ? ", then record here how the tie was resolved" : ""}. The Board&rsquo;s chosen method applies to every tie.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="tie-break"
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      How the tie{tiePositions.length === 1 ? " was" : "s were"} resolved
                    </label>
                    <select
                      id="tie-break"
                      value={tieMethod}
                      onChange={(e) => setTieMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#5C0102]/20 focus:border-[#5C0102]/40"
                    >
                      <option value="">Select how it was resolved&hellip;</option>
                      <option value="coin_toss">Coin Toss</option>
                      <option value="draw_lots">Draw Lots</option>
                      <option value="others">Others (specify)</option>
                    </select>
                  </div>
                  {tieMethod === "others" && (
                    <div>
                      <label
                        htmlFor="tie-break-other"
                        className="block text-xs font-medium text-gray-700 mb-1"
                      >
                        Specify how the tie{tiePositions.length === 1 ? " was" : "s were"} resolved
                      </label>
                      <input
                        id="tie-break-other"
                        value={tieOther}
                        onChange={(e) => setTieOther(e.target.value)}
                        placeholder="e.g. recount, board vote."
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#5C0102]/20 focus:border-[#5C0102]/40"
                      />
                    </div>
                  )}
                </div>
              )}

              {positions.map((p) => {
                const resolution = resolutions[p.position];
                return (
                  <section key={p.position} className="rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <h4 className="text-sm font-semibold text-gray-900">{p.position}</h4>
                      {p.isTie ? (
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          Tie
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                          Winner
                        </span>
                      )}
                    </div>

                    <div className="p-2 space-y-1.5">
                      {p.candidates.map((c) => {
                        const isTop = c.votes === p.topVotes;
                        const isLeader = isTop;
                        const percentage = p.topVotes > 0 ? (c.votes / p.topVotes) * 100 : 0;
                        const manualPick = resolution?.method === "manual" && resolution.candidateId === c.candidateId;
                        // 081 — the tally rows ARE the choice: for a tied
                        // position every top-count candidate is a pick target,
                        // so no separate tie list is rendered below.  The
                        // board can only pick once the Complaint Reason (097)
                        // and the shared tie method are both recorded.
                        const selectable = p.isTie && isTop && !picksLocked;
                        // Greyed out while the Complaint Reason (097) or the
                        // shared tie method is still missing — the choice
                        // exists but cannot be made yet.
                        const pickLockedRow = p.isTie && isTop && picksLocked;
                        // The trophy marks ONLY a winner: the clean-win leader,
                        // or the tied candidate the board actually chose.  The
                        // whole winner row wears the proclamation colour.
                        const showTrophy = manualPick || (!p.isTie && isTop);
                        const profile = profiles[c.candidateId];
                        const rowClass = `relative overflow-hidden rounded-xl border px-3 py-2 flex items-center gap-3 w-full text-left ${
                          showTrophy
                            ? "border-[#5C0102] bg-[#5C0102] text-white shadow-sm"
                            : pickLockedRow
                              ? "bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed"
                              : isLeader
                                ? `bg-amber-50/40 border-amber-200${selectable ? " hover:border-[#5C0102]/40 cursor-pointer" : ""}`
                                : "bg-white border-transparent"
                        }`;
                        const row = (
                          <>
                            <div
                              className={`absolute left-0 top-0 bottom-0 ${
                                showTrophy
                                  ? "bg-white opacity-[0.14]"
                                  : `opacity-[0.08] ${!isLeader ? "bg-[#5C0102]" : "bg-amber-500"}`
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                            <div className="relative w-5 shrink-0 flex items-center justify-center">
                              {showTrophy && (
                                <Trophy
                                  size={15}
                                  className="text-amber-300 drop-shadow-sm"
                                />
                              )}
                            </div>
                            {/* The candidate's profile photo, or the generic
                                avatar when none was submitted (matches the
                                Official Results page). */}
                            <div className="relative shrink-0">
                              {profile?.picture ? (
                                <img
                                  src={profile.picture}
                                  alt={c.candidateName}
                                  className="w-9 h-9 rounded-full object-cover border-2 flex-shrink-0"
                                  style={{ borderColor: showTrophy ? "#FFFFFF" : "#5C0102" }}
                                />
                              ) : (
                                <div
                                  className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 border-2"
                                  style={{ borderColor: showTrophy ? "#FFFFFF" : "#5C0102" }}
                                >
                                  <Users size={15} className="text-gray-400" />
                                </div>
                              )}
                            </div>
                            <div className="relative flex-1 min-w-0">
                              <div
                                className={`text-sm truncate flex items-center gap-2 ${
                                  showTrophy ? "text-white font-semibold" : "text-gray-900"
                                }`}
                              >
                                {c.candidateName}
                                {manualPick && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider bg-white text-[#5C0102] rounded-full px-1.5 py-0.5 shrink-0">
                                    Chosen
                                  </span>
                                )}
                              </div>
                              <div className={`text-[11px] truncate ${showTrophy ? "text-white/70" : "text-gray-500"}`}>
                                {c.partyName || "Independent"}
                                {profile?.gradeLevel ? ` · ${profile.gradeLevel}` : ""}
                              </div>
                            </div>
                            <div className={`relative text-xs font-semibold shrink-0 ${showTrophy ? "text-white" : "text-gray-600"}`}>
                              {tallyVoteLabel(c.votes)}
                            </div>
                          </>
                        );
                        return selectable ? (
                          <button
                            key={c.candidateId}
                            type="button"
                            onClick={() => openPick(p.position, c)}
                            title="Choose this candidate as the winner."
                            className={rowClass}
                          >
                            {row}
                          </button>
                        ) : (
                          <div
                            key={c.candidateId}
                            className={rowClass}
                            title={
                              pickLockedRow
                                ? `Record ${lockedBecause} above before choosing a winner.`
                                : undefined
                            }
                          >
                            {row}
                          </div>
                        );
                      })}
                    </div>

                    {p.isTie && (
                      <div className="border-t border-amber-100 bg-amber-50/60 p-3 space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                          <AlertTriangle size={13} /> Tie — the Electoral Board chooses
                        </div>
                        <div className="flex items-start gap-2 text-xs text-gray-700">
                          <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                            <Gavel size={13} />
                          </div>
                          <span>
                            <span className="font-medium text-gray-900 flex items-center gap-1">
                              Pick a highlighted candidate above
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              The one resolution method recorded above covers every tie in this election.
                            </span>
                          </span>
                        </div>

                        {!isResolved(resolution) && (
                          <div className="text-[11px] text-amber-700">
                            {picksLocked
                              ? `Record ${lockedBecause} above before choosing a winner.`
                              : "Select the candidate to proclaim as the winner."}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {/* The board's whole proclamation at a glance, at the very bottom
              of the review — the same summary shown in the final confirm. */}
          {positions.length > 0 && (
            <ProclamationSummary
              positions={positions}
              resolutions={resolutions}
              tieBreakLabel={sharedTieBreak}
              complaintNote={complaintNote}
              complaintReason={complaintReason}
              complaintSubjects={complaintSubjects}
              substantiated={substantiatedGrievances}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canProclaim}
            title={
              unresolvedTies.length > 0
                ? "Proclaim a winner for every tied position first."
                : !tieMethodReady
                  ? "Record how the tie was resolved first."
                  : !reasonReady
                    ? "Record the Complaint Reason first."
                    : !decisionReady
                      ? "Record the Board's decision reason and the complaint note first."
                      : undefined
            }
            className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#5C0102" }}
          >
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
            Publish & Proclaim Winners
          </button>
        </div>
      </div>

      <AlertDialog open={!!pendingPick} onOpenChange={(o) => { if (!o) setPendingPick(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Proclaim this candidate?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPick
                ? `The Electoral Board will proclaim ${pendingPick.candidate.candidateName} as ${pendingPick.position}. This choice is final once winners are proclaimed. The shared tie resolution method is recorded in the main dialog.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPick(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPick}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Winner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
