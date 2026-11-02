import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
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
import type { SubstantiatedGrievance, OtherResolvedComplaint } from "./ProclamationSummary";

const POSITION_INDEX = new Map<string, number>(
  POSITION_ORDER.map((position, index) => [position, index]),
);

export interface PositionTally {
  position: string;
  /** Seats the position elects — 2 for Grade Level Representatives (117). */
  seats: number;
  /** Candidates in running order — highest vote first. */
  candidates: ProclamationTallyRow[];
  topVotes: number;
  /** Every candidate sharing the top count. */
  tied: ProclamationTallyRow[];
  /** True when the board must resolve something before proclaiming. */
  isTie: boolean;
  /** How many winners the board must pick (0 = proclaimed automatically). */
  picksNeeded: number;
  /** The tied candidates the board picks from when picksNeeded > 0. */
  pickGroup: ProclamationTallyRow[];
  /** Winners proclaimed automatically, without a board pick. */
  autoWinners: ProclamationTallyRow[];
  /** 117 — exactly `seats` candidates tie at the top and ALL win. */
  bothWin: boolean;
}

/** The candidate's profile details joined onto a tally row by id. */
export interface CandidateProfile {
  /** The candidate's submitted profile photo URL, when they have one. */
  picture?: string;
  gradeLevel?: string;
  /** The party the candidate ran under (undefined for an Independent). */
  party?: string;
}

/** 127 — a candidate a substantiated grievance's Disqualification sanction
 *  removed (candidates.status = 'rejected', rejection_tier = 'high').
 *  Listed in the review beside the running candidates — read-only, never
 *  pickable — each carrying the complaint that disqualified it. */
export interface DisqualifiedCandidateRow {
  candidateId: string;
  candidateName: string;
  partyName: string | null;
  position: string;
  /** The Nature of Complaint that disqualified the candidate. */
  subject: string;
  /** The Grievance Commissioner's findings behind the disqualification. */
  findings?: string | null;
  /** The sanctions that complaint imposed, as display labels. */
  sanctions?: string[];
  /** The complaint's id — dedupes its disclosure within a position. */
  grievanceId: string;
}

/** 117 — Grade Level Representative positions elect two winners; every
 *  other position elects one. */
export function seatsForPosition(position: string): number {
  return position.endsWith(" Representative") ? 2 : 1;
}

/**
 * Group the flat tally rows into positions, ranked highest-vote-first, and
 * work out what (if anything) the board must resolve per position:
 *   - fewer top-count candidates than seats → they win outright; the next
 *     count fills the remaining seat(s), and a tie there (2+ candidates
 *     sharing the next count) needs exactly one board pick;
 *   - exactly `seats` tied at the top → ALL win (117: a 2-way Grade Rep
 *     tie elects both, no pick needed);
 *   - more tied candidates than seats → the board picks `seats` of them.
 */
export function groupTally(tally: ProclamationTallyRow[]): PositionTally[] {
  const byPosition = new Map<string, ProclamationTallyRow[]>();
  for (const row of tally) {
    const list = byPosition.get(row.position);
    if (list) list.push(row);
    else byPosition.set(row.position, [row]);
  }

  return [...byPosition.entries()]
    .map(([position, rows]) => {
      const seats = seatsForPosition(position);
      const candidates = [...rows].sort(
        (a, b) => b.votes - a.votes || a.candidateName.localeCompare(b.candidateName),
      );
      const topVotes = candidates[0]?.votes ?? 0;
      const tied = candidates.filter((c) => c.votes === topVotes);
      const autoWinners: ProclamationTallyRow[] = [];
      let picksNeeded = 0;
      let pickGroup: ProclamationTallyRow[] = [];

      if (tied.length < seats) {
        // The top count fills fewer seats than the position elects: every
        // top-count candidate is a default winner.
        autoWinners.push(...tied);
        const rest = candidates.filter((c) => c.votes < topVotes);
        if (rest.length > 0) {
          const nextVotes = rest[0].votes;
          const nextTied = rest.filter((c) => c.votes === nextVotes);
          const remaining = seats - autoWinners.length;
          if (nextTied.length <= remaining) {
            // Unique runner-up (or not enough candidates) — fills the seat.
            autoWinners.push(...nextTied);
          } else {
            // A tie for the last seat: the board picks one.
            picksNeeded = remaining;
            pickGroup = nextTied;
          }
        }
      } else if (tied.length === seats) {
        // Exactly `seats` candidates tie at the top — they all fit.
        autoWinners.push(...tied);
      } else {
        // More tied candidates than seats: the board picks `seats`.
        picksNeeded = seats;
        pickGroup = tied;
      }

      return {
        position,
        seats,
        candidates,
        topVotes,
        tied,
        isTie: picksNeeded > 0,
        picksNeeded,
        pickGroup,
        autoWinners,
        bothWin: picksNeeded === 0 && seats > 1 && tied.length === seats,
      };
    })
    .sort(
      (a, b) =>
        (POSITION_INDEX.get(a.position) ?? POSITION_ORDER.length) -
        (POSITION_INDEX.get(b.position) ?? POSITION_ORDER.length),
    );
}

/**
 * A per-position draft: the board's chosen winner(s) of a tie (117 — up to
 * two for a Grade Level Representative tie) and/or the "Keep Current
 * Winner" affirmation of the default winner(s) when a complaint is on
 * record.  085b —
 * the resolution METHOD is one shared decision for the whole election
 * (recorded below the complaint note), so a tie is resolved once its
 * winner(s) are picked.
 */
type DraftResolution = { method?: "manual"; candidateIds?: string[]; remainWinner?: boolean };

/**
 * 123 — the seats the board must fill by hand for this position.  With a
 * complaint on record and NO "Keep Current Winner" affirmation, that is
 * EVERY seat of the position — the board chooses the winner(s) itself from
 * any of its candidates; otherwise just the tied seat(s) (0 when the
 * default outcome stands).
 */
function requiredPicks(
  p: PositionTally,
  hasComplaints: boolean,
  resolution: DraftResolution | undefined,
): number {
  if (hasComplaints && !resolution?.remainWinner && (p.tied.length === 1 || p.bothWin)) {
    return p.seats;
  }
  return p.picksNeeded;
}

/** The board has filled every seat it must fill by hand. */
function isResolved(
  p: PositionTally,
  hasComplaints: boolean,
  resolution: DraftResolution | undefined,
): boolean {
  const required = requiredPicks(p, hasComplaints, resolution);
  return required === 0 || (resolution?.candidateIds?.length ?? 0) === required;
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
  /** 117 — TRUE when ANY complaint is on record for this election (filed
   *  or resolved): every position whose winners are the default outcome
   *  must then be either affirmed with "Keep Current Winner" or have all
   *  of its seats chosen by the board before it may proclaim (123). */
  hasComplaints: boolean;
  /** 097 — the election's SUBSTANTIATED grievances (already resolved), each
   *  with its read-only findings shown beside the subject. */
  substantiatedGrievances: SubstantiatedGrievance[];
  /** 127 — the candidates the substantiated grievances' Disqualification
   *  sanctions removed: listed beside the running candidates, read-only and
   *  never pickable, each with the complaint that disqualified it. */
  disqualifiedCandidates?: DisqualifiedCandidateRow[];
  /** 114 — the election's Unsubstantiated / Dismissed resolutions.  Every
   *  Findings decision now owes the Board's one-time explanation. */
  otherResolved: OtherResolvedComplaint[];
  onCancel: () => void;
  onConfirm: (
    resolutions: Record<string, TieResolution>,
    decision: ProclamationDecision,
  ) => void;
}

/**
 * 069 — the proclaim-winners review.  Shows the tally for every position
 * with the highest vote on top, flags ties, and asks the Electoral Board to
 * pick the winner of each tied position.  117 — Grade Level Representative
 * positions elect TWO winners: a unique 1-2 finish or a 2-way top tie
 * proclaims both automatically, a 3+-way tie needs two picks, and a tie for
 * the remaining seat needs one.  When a complaint is on record, every
 * position whose winners are the default outcome — including both winners
 * of a 2-way Grade Rep tie (122) — is the board's to settle: either affirm
 * "Keep Current Winner", or choose every seat of the position itself from
 * any of its candidates (123).  124 — inside this review nothing is final:
 * a chosen winner can be withdrawn (click it again) or replaced (click
 * another candidate, oldest pick out first), and affirming "Keep Current
 * Winner" overrides the board's picks until it is deactivated again.  The
 * choices become final only when the proclamation is confirmed.
 * 085b — ONE resolution method for the whole election is recorded below the
 * complaint note and applies to every resolved tie, instead of being
 * re-entered inside each per-candidate confirm.  When a complaint is still
 * filed, the board decides the winners and records a note on the complaint.
 */
export function ProclamationDialog({
  open,
  loading,
  confirming,
  error,
  tally,
  profiles = {},
  complaintSubjects,
  hasComplaints,
  substantiatedGrievances,
  disqualifiedCandidates = [],
  otherResolved,
  onCancel,
  onConfirm,
}: ProclamationDialogProps) {
  const positions = useMemo(() => groupTally(tally), [tally]);
  // 127 — the disqualified candidates grouped by position.  The tally RPC
  // only returns approved candidates, so the removed ones travel in their
  // own prop and are pinned under their position's running candidates.
  const disqualifiedByPosition = useMemo(() => {
    const map = new Map<string, DisqualifiedCandidateRow[]>();
    for (const d of disqualifiedCandidates) {
      const list = map.get(d.position);
      if (list) list.push(d);
      else map.set(d.position, [d]);
    }
    return map;
  }, [disqualifiedCandidates]);
  const [resolutions, setResolutions] = useState<Record<string, DraftResolution>>({});
  const [pendingPick, setPendingPick] = useState<{
    position: string;
    candidate: ProclamationTallyRow;
    /** 124 — the oldest pick this choice replaces, when the seats are full. */
    replaces?: ProclamationTallyRow | null;
  } | null>(null);
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

  const tiePositions = positions.filter((p) => p.picksNeeded > 0);
  // 127 — positions whose EVERY candidate was disqualified have no tally
  // section at all (the RPC returns no approved rows for them); their
  // removed candidates still get their own section so the review shows
  // why nothing can be proclaimed there.
  const orphanDisqualified = [...disqualifiedByPosition.entries()].filter(
    ([position]) => !positions.some((p) => p.position === position),
  );
  // 123 — a position is settled once the board either affirmed its default
  // winner(s) or manually named every seat itself; with no complaint only
  // ties need resolving.
  const unresolved = positions.filter((p) => !isResolved(p, hasComplaints, resolutions[p.position]));
  // 123 — an unresolved complaint-gated position (default winners neither
  // affirmed nor replaced) drives the affirm-or-choose message.
  const needsAffirmOrChoose = unresolved.some(
    (p) => hasComplaints && (p.tied.length === 1 || p.bothWin) && !resolutions[p.position]?.remainWinner,
  );
  const complaintsPending = complaintSubjects.length > 0;
  const decisionReady = !complaintsPending || complaintNote.trim() !== "";
  // 097/114 — a substantiated grievance requires the Board's one-time
  // explanation, and 114 widens the debt to EVERY Findings decision:
  // Unsubstantiated and Dismissed resolutions owe it just the same.
  const substantiatedPending = substantiatedGrievances.length > 0;
  const otherResolvedPending = otherResolved.length > 0;
  const anyDecidedGrievance = substantiatedPending || otherResolvedPending;
  const reasonReady = !anyDecidedGrievance || complaintReason.trim() !== "";
  // 085b — one method covers every tie the board resolves; "Others" needs
  // its text.  (A 2-way Grade Rep tie proclaims both automatically and
  // needs no method — only picksNeeded ties count here.)
  const tieMethodReady =
    tiePositions.length === 0 ||
    (tieMethod !== "" && (tieMethod !== "others" || tieOther.trim() !== ""));
  // The board cannot pick a winner of a tied position until the Complaint
  // Resolution and Justification (097/114) and the shared tie resolution
  // method are both recorded — the choice is only final once the reasoning
  // behind it is on record.
  const picksLocked = !reasonReady || !tieMethodReady;
  const lockedBecause = [
    !reasonReady ? "the Complaint Resolution and Justification" : null,
    !tieMethodReady ? "how the tie" + (tiePositions.length === 1 ? " was" : "s were") + " resolved" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const sharedTieBreak =
    tieMethod === "coin_toss" ? "Coin Toss"
    : tieMethod === "draw_lots" ? "Draw Lots"
    : tieOther.trim();
  const canProclaim =
    !loading && !confirming && positions.length > 0 && unresolved.length === 0 && decisionReady && reasonReady && tieMethodReady;

  const setResolution = (position: string, resolution: DraftResolution) => {
    setResolutions((prev) => ({ ...prev, [position]: resolution }));
  };

  const openPick = (position: string, candidate: ProclamationTallyRow) => {
    // 124 — a full position still accepts a click: it REPLACES the oldest
    // pick, and the confirm says so.
    const target = positions.find((x) => x.position === position);
    const current = resolutions[position];
    const ids = current?.candidateIds ?? [];
    const required = target ? requiredPicks(target, hasComplaints, current) : 0;
    const replaces =
      required > 0 && ids.length >= required
        ? target?.candidates.find((c) => c.candidateId === ids[0]) ?? null
        : null;
    setPendingPick({ position, candidate, replaces });
  };

  const confirmPick = () => {
    if (!pendingPick) return;
    const target = positions.find((x) => x.position === pendingPick.position);
    setResolutions((prev) => {
      const current = prev[pendingPick.position] ?? {};
      const ids = current.candidateIds ?? [];
      const required = target ? requiredPicks(target, hasComplaints, current) : 0;
      // 124 — when the seats are already filled, the new pick replaces the
      // oldest one instead of being refused.
      const nextIds =
        required > 0 && ids.length >= required
          ? [...ids.slice(ids.length - required + 1), pendingPick.candidate.candidateId]
          : [...ids, pendingPick.candidate.candidateId];
      return {
        ...prev,
        [pendingPick.position]: { ...current, method: "manual", candidateIds: nextIds },
      };
    });
    setPendingPick(null);
  };

  // 124 — withdraw a pick: a choice is never final inside the review modal.
  const unpick = (position: string, candidateId: string) => {
    setResolutions((prev) => {
      const current = prev[position];
      if (!current?.candidateIds?.includes(candidateId)) return prev;
      const ids = current.candidateIds.filter((id) => id !== candidateId);
      const next: DraftResolution = { ...current, candidateIds: ids };
      if (ids.length === 0) delete next.method;
      return { ...prev, [position]: next };
    });
  };

  // 117/122 — the "Keep Current Winner" affirmation of the default winners.
  // 124 — affirming OVERRIDES the board's picks: the default winner(s)
  // stand and every manual pick for the position is dropped.  Deactivating
  // it re-opens the choice with a clean slate.
  const toggleRemainWinner = (position: string) => {
    setResolutions((prev) => {
      const current = prev[position] ?? {};
      return { ...prev, [position]: { remainWinner: !current.remainWinner } };
    });
  };

  const handleConfirm = () => {
    const payload: Record<string, TieResolution> = {};
    for (const p of positions) {
      const resolution = resolutions[p.position];
      const entry: TieResolution = {};
      // 123 — the board's picks: the tied seat(s), or EVERY seat when the
      // board chose instead of affirming (complaint on record).
      const required = requiredPicks(p, hasComplaints, resolution);
      if (required > 0 && resolution?.method === "manual" && (resolution.candidateIds?.length ?? 0) === required) {
        entry.method = "manual";
        entry.candidateIds = resolution.candidateIds;
        // 085b — the one shared decision, written onto every resolved tie.
        entry.tieBreak = sharedTieBreak;
      }
      if (hasComplaints && resolution?.remainWinner && (p.tied.length === 1 || p.bothWin)) {
        entry.remainWinner = true;
      }
      if (entry.method || entry.remainWinner) {
        payload[p.position] = entry;
      }
    }
    onConfirm(payload, {
      complaintNote: complaintNote.trim(),
      complaintReason: complaintReason.trim(),
      tieBreak: sharedTieBreak,
    });
  };

  // 127 — one position's disqualified block: the removed candidates as
  // read-only rows (no pick, no vote count) plus the Complaint that took
  // them out — click its subject to reveal the Grievance Commissioner's
  // findings.  Never rendered as a button: a disqualified candidate is
  // not in the running and cannot be proclaimed.
  const renderDisqualified = (positionKey: string, rows: DisqualifiedCandidateRow[]) => {
    // One disclosure per complaint, however many candidates it removed here.
    const grievances = rows.filter(
      (d, i) => rows.findIndex((x) => x.grievanceId === d.grievanceId) === i,
    );
    const idSlug = positionKey.replace(/[^a-zA-Z0-9]+/g, "-");
    return (
      <div className="border-t border-red-100 bg-red-50/40 p-2 space-y-1.5">
        <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-red-700 flex items-center gap-1.5">
          <Ban size={12} /> Disqualified — excluded from the tally
        </div>
        {rows.map((d) => {
          const profile = profiles[d.candidateId];
          return (
            <div
              key={d.candidateId}
              className="rounded-xl border border-red-200 bg-white px-3 py-2 flex items-center gap-3 opacity-75 cursor-not-allowed"
              title="Disqualified through a substantiated grievance — not in the running."
            >
              {profile?.picture ? (
                <img
                  src={profile.picture}
                  alt={d.candidateName}
                  className="w-9 h-9 rounded-full object-cover border-2 border-red-200 flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 border-2 border-red-200">
                  <Users size={15} className="text-gray-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate text-gray-500">{d.candidateName}</div>
                <div className="text-[11px] truncate text-gray-400">
                  {d.partyName || "Independent"}
                  {profile?.gradeLevel ? ` · ${profile.gradeLevel}` : ""}
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                Disqualified
              </span>
            </div>
          );
        })}
        <ul className="px-1 space-y-1.5">
          {grievances.map((g) => (
            <FindingsDisclosure
              key={g.grievanceId}
              id={`proclaim-disq-findings-${g.grievanceId}-${idSlug}`}
              subject={g.subject}
              decisionLabel="Substantiated Grievance"
              findings={g.findings}
              sanctions={g.sanctions}
            />
          ))}
        </ul>
      </div>
    );
  };

  // 127 — a full section for a position with no running candidates left:
  // only its disqualified block, under a red status badge.
  const renderDisqualifiedSection = (position: string, rows: DisqualifiedCandidateRow[]) => (
    <section key={position} className="rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <h4 className="text-sm font-semibold text-gray-900">{position}</h4>
        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
          All candidates disqualified
        </span>
      </div>
      <div className="p-2">
        {renderDisqualified(position, rows)}
      </div>
    </section>
  );

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
            <div className="space-y-4">
              <div className="py-12 text-center text-sm text-gray-500">
                There are no approved candidates to proclaim for this election.
              </div>
              {/* 127 — even with nothing left to proclaim, the review still
                  names who was removed and why. */}
              {orphanDisqualified.map(([position, rows]) =>
                renderDisqualifiedSection(position, rows),
              )}
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

              {/* 097/114 — a grievance decision taints (or at least closes)
                  the election, so the Board must record a Complaint
                  Resolution and Justification (one-time explanation) before
                  proclaiming — for EVERY decision: Substantiated,
                  Unsubstantiated, or Dismissed.  Sits ABOVE the tie-break
                  decision.  Substantiated grievances also show their
                  read-only Findings. */}
              {anyDecidedGrievance && (
                <div className={`rounded-xl border p-4 space-y-3 ${substantiatedPending ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
                  {substantiatedPending && (
                    <div className="flex items-start gap-2 text-xs text-red-800">
                      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <div className="font-bold uppercase tracking-wider text-[11px]">
                          {substantiatedGrievances.length} substantiated {substantiatedGrievances.length === 1 ? "grievance" : "grievances"} — a Complaint Resolution and Justification is required
                        </div>
                        <ul className="mt-1 space-y-1.5">
                          {substantiatedGrievances.map((g) => (
                            <FindingsDisclosure
                              key={g.id}
                              id={`proclaim-findings-${g.id}`}
                              subject={g.subject}
                              findings={g.findings}
                              sanctions={g.sanctions}
                              disqualifiedNames={g.disqualifiedNames}
                            />
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  {otherResolvedPending && (
                    <div className="flex items-start gap-2 text-xs text-gray-700">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <div className="font-bold uppercase tracking-wider text-[11px] text-gray-600">
                          {otherResolved.length} complaint decision{otherResolved.length === 1 ? "" : "s"} on record
                        </div>
                        {/* 114 — the same click-to-reveal Findings a
                            substantiated grievance gets. */}
                        <ul className="mt-1 space-y-1.5">
                          {otherResolved.map((c) => (
                            <FindingsDisclosure
                              key={c.id}
                              id={`proclaim-other-findings-${c.id}`}
                              subject={c.subject}
                              decisionLabel={c.decisionLabel}
                              findings={c.findings}
                            />
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <div>
                    <label htmlFor="proclaim-complaint-reason" className="block text-xs font-medium text-gray-700 mb-1">
                      Complaint Resolution and Justification (one-time explanation)
                    </label>
                    <textarea
                      id="proclaim-complaint-reason"
                      value={complaintReason}
                      onChange={(e) => setComplaintReason(e.target.value)}
                      rows={2}
                      placeholder="Explain how the grievance decisions were weighed in this proclamation."
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

              {positions.map((p, index) => {
                const resolution = resolutions[p.position];
                const picksSoFar = resolution?.candidateIds?.length ?? 0;
                // 127 — the candidates a substantiated grievance removed
                // from this position; rendered read-only below the tally.
                const disqualifiedHere = disqualifiedByPosition.get(p.position);
                // 117 — the pick targets are the tied group the board must
                // resolve: the top-count candidates themselves when more
                // are tied than there are seats, or the next-count
                // candidates when a unique leader leaves one seat to a tie.
                const pickVotes = p.pickGroup[0]?.votes ?? null;
                // 117/122 — with a complaint on record the DEFAULT winners
                // (a unique highest-vote winner, or both winners of a 2-way
                // Grade Rep tie) keep their seats only once the board
                // affirms it: "Keep Current Winner".  Tie-resolved seats
                // need no affirmation — the board's pick there already IS
                // the decision.  One affirmation covers the position's
                // winner(s), one or two alike.
                const remainApplies = hasComplaints && (p.tied.length === 1 || p.bothWin);
                const remainAffirmed = remainApplies && !!resolution?.remainWinner;
                const remainTitle = remainAffirmed
                  ? "Affirmed — the record shows the Board weighed the complaint and the winner(s) stand."
                  : p.bothWin
                    ? "A complaint is on record. Affirm that both tied winners keep their seats, or choose the 2 winners yourself below."
                    : p.autoWinners.length > 1
                      ? "A complaint is on record. Affirm that both highest-vote winners keep their seats, or choose the 2 winners yourself below."
                      : "A complaint is on record. Affirm that the highest-vote winner keeps the seat, or choose the winner yourself below.";
                // 123 — choice mode: a complaint is on record and the board
                // has NOT affirmed, so every seat of the position is the
                // board's to fill — ANY candidate below is pickable.
                const required = requiredPicks(p, hasComplaints, resolution);
                const choiceMode = remainApplies && !remainAffirmed;
                // The slate splits into the elected officers and the Grade
                // Level Representatives — a labelled divider marks the break
                // before the first two-winner position.
                const showGradeRepDivider =
                  p.seats > 1 && !positions.slice(0, index).some((x) => x.seats > 1);
                return (
                  <Fragment key={p.position}>
                    {showGradeRepDivider && (
                      <div className="flex items-center gap-3 pt-2" aria-hidden="true">
                        <div className="h-px flex-1 bg-gray-200" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          Grade Level Representatives
                        </span>
                        <div className="h-px flex-1 bg-gray-200" />
                      </div>
                    )}
                    <section className="rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <h4 className="text-sm font-semibold text-gray-900">
                        {p.position}
                        {p.seats > 1 && (
                          <span className="ml-2 text-[11px] font-normal text-gray-500">2 winners</span>
                        )}
                      </h4>
                      {/* 117/122 — the affirmation lives on the header's
                          right side, beside the position's status: the board
                          either keeps the standing winner(s) or, for a tie,
                          picks new one(s) from the highlighted candidates
                          below.  One toggle covers both winners of a Grade
                          Level Representative position. */}
                      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                        {remainApplies && (
                          <button
                            type="button"
                            onClick={() => toggleRemainWinner(p.position)}
                            disabled={confirming || loading}
                            title={remainTitle}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-colors disabled:opacity-50 ${
                              remainAffirmed
                                ? "bg-green-600 border-green-600 text-white hover:bg-green-700"
                                : "bg-white border-gray-300 text-gray-700 hover:border-[#5C0102]/40 hover:text-gray-900"
                            }`}
                          >
                            {remainAffirmed ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}
                            {remainAffirmed ? "Current Winner Stands" : "Keep Current Winner"}
                          </button>
                        )}
                        {p.picksNeeded > 0 ? (
                          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            {p.pickGroup.length}-way tie — pick {choiceMode ? required : p.picksNeeded}
                          </span>
                        ) : p.bothWin ? (
                          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            {choiceMode ? `2-way tie — pick ${required}` : "2-way tie — both win"}
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                            {p.autoWinners.length > 1 ? "Winners" : "Winner"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-2 space-y-1.5">
                      {p.candidates.map((c) => {
                        const percentage = p.topVotes > 0 ? (c.votes / p.topVotes) * 100 : 0;
                        const isPickTarget = pickVotes !== null && c.votes === pickVotes;
                        const manualPick = resolution?.method === "manual" && !!resolution.candidateIds?.includes(c.candidateId);
                        const isAutoWinner = p.autoWinners.some((w) => w.candidateId === c.candidateId);
                        // 081 — the tally rows ARE the choice: for a tied
                        // position every candidate in the pick group is a
                        // pick target, so no separate tie list is rendered
                        // below.  123 — in choice mode (complaint on
                        // record, no affirmation) EVERY candidate of the
                        // position is a pick target instead.  The board can
                        // only pick once the Complaint Resolution and
                        // Justification (097/114) and the shared tie method
                        // are both recorded.  124 — a pick is never final
                        // inside the modal: a picked row withdraws on
                        // click, and a full position still accepts another
                        // candidate as a replacement for the oldest pick.
                        const inPickPool = choiceMode || isPickTarget;
                        const selectable = manualPick || (inPickPool && !picksLocked);
                        // Greyed out while the Complaint Resolution and
                        // Justification (097/114) or the shared tie method is
                        // still missing — the choice exists but cannot be
                        // made yet.
                        const pickLockedRow = inPickPool && !selectable;
                        // The trophy marks ONLY a winner: a default winner
                        // (117 — includes both winners of a 2-way Grade Rep
                        // tie), or the tied candidate(s) the board chose.
                        // 123 — in choice mode the board's picks alone wear
                        // it: an unaffirmed default winner has not kept the
                        // seat yet.
                        const showTrophy = choiceMode ? manualPick : isAutoWinner || manualPick;
                        const isLeader = !choiceMode && (isAutoWinner || isPickTarget);
                        const profile = profiles[c.candidateId];
                        const rowClass = `relative overflow-hidden rounded-xl border px-3 py-2 flex items-center gap-3 w-full text-left ${
                          showTrophy
                            ? "border-[#5C0102] bg-[#5C0102] text-white shadow-sm"
                            : pickLockedRow
                              ? "bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed"
                              : isLeader
                                ? "bg-amber-50/40 border-amber-200"
                                : "bg-white border-transparent"
                        }${selectable ? " hover:border-[#5C0102]/40 cursor-pointer" : ""}`;
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
                            onClick={() => (manualPick ? unpick(p.position, c.candidateId) : openPick(p.position, c))}
                            title={
                              manualPick
                                ? "Click again to withdraw this choice."
                                : "Choose this candidate as the winner."
                            }
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

                    {/* 127 — the candidates the Grievance Commissioner
                        disqualified from this position: read-only rows,
                        each with the Complaint (click to reveal its
                        Findings) that removed them. */}
                    {disqualifiedHere && renderDisqualified(p.position, disqualifiedHere)}

                    {/* 081 — the tie footer; 123 — in choice mode (complaint
                        on record, no affirmation) it renders for non-tie
                        positions too, offering the board's own choice. */}
                    {(p.picksNeeded > 0 || choiceMode) && (
                      <div className="border-t border-amber-100 bg-amber-50/60 p-3 space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                          <AlertTriangle size={13} />
                          {choiceMode && p.picksNeeded === 0
                            ? "Complaint on record — the Electoral Board chooses"
                            : "Tie — the Electoral Board chooses"}
                        </div>
                        <div className="flex items-start gap-2 text-xs text-gray-700">
                          <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                            <Gavel size={13} />
                          </div>
                          <span>
                            <span className="font-medium text-gray-900 flex items-center gap-1">
                              {choiceMode
                                ? required === 1
                                  ? "Pick any candidate above — or affirm the current winner instead"
                                  : `Pick any ${required} candidates above — or affirm the current winners instead`
                                : p.picksNeeded === 1
                                  ? "Pick a highlighted candidate above"
                                  : "Pick 2 highlighted candidates above"}
                            </span>
                            {p.picksNeeded > 0 && (
                              <span className="block text-[11px] text-gray-500">
                                The one resolution method recorded above covers every tie in this election.
                              </span>
                            )}
                          </span>
                        </div>

                        {!isResolved(p, hasComplaints, resolution) && (
                          <div className="text-[11px] text-amber-700">
                            {picksLocked
                              ? `Record ${lockedBecause} above before choosing a winner.`
                              : picksSoFar > 0
                                ? `${required - picksSoFar} more pick${required - picksSoFar === 1 ? "" : "s"} to go.`
                                : required === 1
                                  ? "Select the candidate to proclaim as the winner."
                                  : "Select both candidates to proclaim as winners."}
                          </div>
                        )}
                        {/* 124 — choices are provisional until the final
                            confirmation; a click on a chosen row withdraws
                            it, a click on another row replaces it. */}
                        <div className="text-[11px] text-gray-500">
                          Choices can be replaced or withdrawn until the winners are proclaimed.
                        </div>
                      </div>
                    )}
                  </section>
                  </Fragment>
                );
              })}

              {/* 127 — a position whose every candidate was disqualified has
                  no tally at all: its removed candidates still get their
                  section so the review shows why nothing can be proclaimed
                  there. */}
              {orphanDisqualified.map(([position, rows]) =>
                renderDisqualifiedSection(position, rows),
              )}
            </div>
          )}

          {/* The board's whole proclamation at a glance, at the very bottom
              of the review — the same summary shown in the final confirm. */}
          {positions.length > 0 && (
            <ProclamationSummary
              positions={positions}
              resolutions={resolutions}
              hasComplaints={hasComplaints}
              tieBreakLabel={sharedTieBreak}
              complaintNote={complaintNote}
              complaintReason={complaintReason}
              complaintSubjects={complaintSubjects}
              substantiated={substantiatedGrievances}
              otherResolved={otherResolved}
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
              unresolved.length > 0
                ? needsAffirmOrChoose
                  ? 'Affirm "Keep Current Winner" or choose the winner of every position with a complaint first.'
                  : "Proclaim a winner for every tied position first."
                : !tieMethodReady
                    ? "Record how the tie was resolved first."
                    : !reasonReady
                      ? "Record the Complaint Resolution and Justification first."
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
                ? pendingPick.replaces
                  ? `The Electoral Board will proclaim ${pendingPick.candidate.candidateName} instead of ${pendingPick.replaces.candidateName} as ${pendingPick.position}. The choice can still be replaced or withdrawn until the winners are proclaimed.${tiePositions.length > 0 ? " The shared tie resolution method is recorded in the main dialog." : ""}`
                  : `The Electoral Board will proclaim ${pendingPick.candidate.candidateName} as ${pendingPick.position}. The choice can still be replaced or withdrawn until the winners are proclaimed.${tiePositions.length > 0 ? " The shared tie resolution method is recorded in the main dialog." : ""}`
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
