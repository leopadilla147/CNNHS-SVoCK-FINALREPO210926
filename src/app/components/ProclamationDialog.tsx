import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Gavel,
  Loader2,
  Trophy,
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

const POSITION_ORDER = [
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "PRO",
  "PIO",
  "Protocol Officer",
  "Grade 7 Representative",
  "Grade 8 Representative",
  "Grade 9 Representative",
  "Grade 10 Representative",
  "Grade 11 Representative",
  "Grade 12 Representative",
];

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
 * A per-tie draft: only manual selection is allowed.
 */
type DraftResolution = { method: "manual"; candidateId?: string };

function isResolved(resolution: DraftResolution | undefined): boolean {
  if (!resolution) return false;
  return !!resolution.candidateId;
}

function tallyVoteLabel(votes: number): string {
  return `${votes} vote${votes === 1 ? "" : "s"}`;
}

interface ProclamationDialogProps {
  open: boolean;
  /** The tally is being fetched. */
  loading: boolean;
  /** The proclamation RPC is in flight. */
  confirming: boolean;
  error: string | null;
  tally: ProclamationTallyRow[];
  onCancel: () => void;
  onConfirm: (resolutions: Record<string, TieResolution>) => void;
}

/**
 * 069 — the proclaim-winners review.  Shows the tally for every position
 * with the highest vote on top, flags ties, and asks the Electoral Board
 * to pick the winner of each tied position, confirmed before it locks in.
 */
export function ProclamationDialog({
  open,
  loading,
  confirming,
  error,
  tally,
  onCancel,
  onConfirm,
}: ProclamationDialogProps) {
  const positions = useMemo(() => groupTally(tally), [tally]);
  const [resolutions, setResolutions] = useState<Record<string, DraftResolution>>({});
  const [pendingPick, setPendingPick] = useState<{ position: string; candidate: ProclamationTallyRow } | null>(null);

  // Each fresh open starts from a clean slate — a stale resolution from a
  // previous attempt must never leak into a new proclamation.
  useEffect(() => {
    if (open) {
      setResolutions({});
      setPendingPick(null);
    }
  }, [open]);

  if (!open) return null;

  const tiePositions = positions.filter((p) => p.isTie);
  const unresolvedTies = tiePositions.filter((p) => !isResolved(resolutions[p.position]));
  const canProclaim = !loading && !confirming && positions.length > 0 && unresolvedTies.length === 0;

  const setResolution = (position: string, resolution: DraftResolution) => {
    setResolutions((prev) => ({ ...prev, [position]: resolution }));
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
        payload[p.position] = { method: "manual", candidateId: resolution.candidateId };
      }
    }
    onConfirm(payload);
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
              <h3 id="proclaim-dialog-title" className="text-gray-900 text-sm font-semibold">Proclaim Winners</h3>
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
              {tiePositions.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>
                    {tiePositions.length} position{tiePositions.length === 1 ? "" : "s"} end
                    {tiePositions.length === 1 ? "s" : ""} in a tie. Choose how each is resolved
                    {unresolvedTies.length > 0
                      ? ` (${unresolvedTies.length} still unresolved).`
                      : " — all resolved."}
                  </span>
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
                        return (
                          <div
                            key={c.candidateId}
                            className={`relative overflow-hidden rounded-xl border px-3 py-2 flex items-center gap-3 ${
                              isLeader ? "bg-amber-50/40 border-amber-200" : "bg-white border-transparent"
                            }`}
                          >
                            <div
                              className={`absolute left-0 top-0 bottom-0 opacity-[0.08] ${isLeader ? "bg-amber-500" : "bg-[#5C0102]"}`}
                              style={{ width: `${percentage}%` }}
                            />
                            <div className="relative w-5 shrink-0 flex items-center justify-center">
                              {isLeader && <Trophy size={15} className="text-amber-500" />}
                            </div>
                            <div className="relative flex-1 min-w-0">
                              <div className="text-sm text-gray-900 truncate flex items-center gap-2">
                                {c.candidateName}
                                {manualPick && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#5C0102]">
                                    Chosen
                                  </span>
                                )}
                              </div>
                              {c.partyName && <div className="text-[11px] text-gray-500 truncate">{c.partyName}</div>}
                            </div>
                            <div className="relative text-xs font-semibold text-gray-600 shrink-0">
                              {tallyVoteLabel(c.votes)}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {p.isTie && (
                      <div className="border-t border-amber-100 bg-amber-50/60 p-3 space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                          <AlertTriangle size={13} /> How should this tie be broken?
                        </div>
                        <div className="flex items-start gap-2 text-xs text-gray-700">
                          <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                            <Gavel size={13} />
                          </div>
                          <span>
                            <span className="font-medium text-gray-900 flex items-center gap-1">
                              Electoral Board chooses
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              Pick the winner below. You will confirm your choice before it locks in.
                            </span>
                          </span>
                        </div>

                        <div className="space-y-1.5 pt-1">
                          {p.tied.map((c) => {
                            const selected = resolution?.candidateId === c.candidateId;
                            return (
                              <button
                                key={c.candidateId}
                                type="button"
                                onClick={() => setPendingPick({ position: p.position, candidate: c })}
                                className={`w-full text-left rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                                  selected
                                    ? "border-[#5C0102] bg-white text-gray-900 font-semibold"
                                    : "border-gray-200 bg-white hover:border-[#5C0102]/40 text-gray-700"
                                }`}
                              >
                                <span className="truncate">{c.candidateName}</span>
                                <span className="shrink-0 text-gray-500">{tallyVoteLabel(c.votes)}</span>
                              </button>
                            );
                          })}
                        </div>

                        {!isResolved(resolution) && (
                          <div className="text-[11px] text-amber-700">
                            Select the candidate the Board is proclaiming.
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
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
            title={unresolvedTies.length > 0 ? "Resolve every tie before proclaiming." : undefined}
            className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#5C0102" }}
          >
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
            Proclaim Winners
          </button>
        </div>
      </div>

      <AlertDialog open={!!pendingPick} onOpenChange={(o) => { if (!o) setPendingPick(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Proclaim this candidate?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPick
                ? `The Electoral Board will proclaim ${pendingPick.candidate.candidateName} as ${pendingPick.position}. This choice is final once winners are proclaimed.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPick(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPick} className="bg-red-600 hover:bg-red-700 text-white">
              Confirm Winner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
