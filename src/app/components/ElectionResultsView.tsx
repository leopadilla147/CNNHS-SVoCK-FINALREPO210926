import { useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Archive,
  Award,
  Ban,
  CalendarDays,
  Gavel,
  Layers,
  MapPin,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import type {
  PastElectionPositionResult,
  PastElectionResults,
} from "../lib/supabaseData";
import { FULL_POSITION_ORDER as POSITION_ORDER } from "../lib/partyScope";
import { ComplaintRecordSection } from "./ComplaintRecordSection";

const POSITION_INDEX = new Map<string, number>(
  POSITION_ORDER.map((position, index) => [position, index]),
);

/** Normalized token view of a personal name — case/punctuation-insensitive. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Whether an archived candidate row is the viewer: a token-subset match in
 * either direction.  The archive name may carry an extension the student
 * record lacks ("Jr.") or drop the middle name, so exact equality alone is
 * too strict — but both names must carry at least two tokens so a bare
 * first name can never match.
 */
export function candidateNameMatches(candidateName: string, myName: string): boolean {
  if (!candidateName || !myName) return false;
  const cand = nameTokens(candidateName);
  const mine = nameTokens(myName);
  if (cand.length < 2 || mine.length < 2) return false;
  const supersetOf = (big: string[], small: string[]) => small.every((t) => big.includes(t));
  return supersetOf(cand, mine) || supersetOf(mine, cand);
}

export function sortPositions(
  positions: PastElectionPositionResult[]
): PastElectionPositionResult[] {
  return [...positions].sort(
    (left, right) =>
      (POSITION_INDEX.get(left.position) ?? POSITION_ORDER.length) -
        (POSITION_INDEX.get(right.position) ?? POSITION_ORDER.length) || 0
  );
}

export function formatDateRange(results: PastElectionResults): string {
  const { electionDate, endDate } = results.election;
  if (!electionDate) return "Date not recorded";
  if (endDate && endDate !== electionDate) return `${electionDate} – ${endDate}`;
  return electionDate;
}

function formatPercentage(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export function PositionCard({
  position,
  highlightName,
}: {
  position: PastElectionPositionResult;
  /** The viewer's own candidate name — matching rows are ringed "You". */
  highlightName?: string | null;
}) {
  const ranked = position.candidates;
  const leaderVotes = ranked[0]?.votes ?? 0;

  return (
    <section
      aria-labelledby={`position-${position.position.toLowerCase().replace(/\s+/g, "-")}`}
      className="rounded-3xl border border-stone-200/90 border-b-[4px] border-b-stone-300 bg-gradient-to-b from-white via-[#fefefe] to-[#faf7f7] shadow-[0_12px_32px_-6px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] overflow-hidden transition-all duration-300"
    >
      <div
        className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-white bg-gradient-to-r from-[#6e0102] via-[#5C0102] to-[#8B0103] border-b border-black/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
      >
        <h2
          id={`position-${position.position.toLowerCase().replace(/\s+/g, "-")}`}
          className="text-lg sm:text-xl font-extrabold tracking-tight drop-shadow-xs"
        >
          {position.position}
        </h2>
        <div className="text-xs text-white/90 flex items-center gap-2.5 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-full bg-white/15 border border-white/20 shadow-[0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.2)] font-semibold">
            {position.votesCast} vote{position.votesCast === 1 ? "" : "s"} cast
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 border border-white/20 shadow-[0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.2)] font-semibold">
            <Ban size={12} />
            {position.abstentions} abstention{position.abstentions === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500 font-medium">No approved candidates for this position.</p>
      ) : (
        <ul className="p-2 sm:p-3 space-y-2">
          {ranked.map((candidate, index) => {
            const share = formatPercentage(candidate.votes, position.votesCast);
            const isMe = highlightName ? candidateNameMatches(candidate.name, highlightName) : false;
            return (
              <li
                key={`${candidate.name}-${index}`}
                className={`px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl transition-all duration-200 ${
                  candidate.proclaimedWinner
                    ? "bg-gradient-to-r from-[#6e0102] via-[#5C0102] to-[#780103] text-white border border-[#450001] border-b-[3.5px] border-b-[#2e0001] shadow-[0_8px_22px_rgba(92,1,2,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] relative overflow-hidden"
                    : "bg-gradient-to-b from-white to-stone-50/70 border border-gray-100 border-b-[2.5px] border-b-gray-200/90 hover:border-gray-300/80 hover:shadow-[0_4px_14px_rgba(0,0,0,0.04)]"
                } ${
                  isMe
                    ? candidate.proclaimedWinner
                      ? "ring-2 ring-amber-300"
                      : "border-[#5C0102] ring-2 ring-[#5C0102]/20"
                    : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* The trophy marks the proclaimed winner — the same column
                      pattern as the Proclamation Dialog (empty on the other
                      rows so every candidate stays aligned). */}
                  <div className="flex items-center justify-center w-6 shrink-0">
                    {candidate.proclaimedWinner && (
                      <Trophy size={20} className="text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
                    )}
                  </div>
                  {candidate.picture ? (
                    <img
                      src={candidate.picture}
                      alt={candidate.name}
                      className={`w-12 h-12 rounded-full object-cover flex-shrink-0 ${
                        candidate.proclaimedWinner
                          ? "border-[2.5px] border-white shadow-[0_3px_8px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.5)]"
                          : "border-2 border-[#5C0102] shadow-[0_2px_6px_rgba(92,1,2,0.15)]"
                      }`}
                    />
                  ) : (
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                        candidate.proclaimedWinner
                          ? "bg-white/15 border-[2.5px] border-white shadow-[0_3px_8px_rgba(0,0,0,0.25)]"
                          : "bg-stone-100 border-2 border-[#5C0102] shadow-[0_2px_6px_rgba(92,1,2,0.15)]"
                      }`}
                    >
                      <Users size={20} className={candidate.proclaimedWinner ? "text-white/80" : "text-gray-400"} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold tracking-tight truncate ${candidate.proclaimedWinner ? "text-white" : "text-gray-900"}`}>{candidate.name}</h3>
                      {candidate.proclaimedWinner ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white text-[#5C0102] border border-white border-b-2 border-b-stone-300 px-2.5 py-0.5 text-[11px] font-bold shadow-[0_2px_5px_rgba(0,0,0,0.15)]">
                          <Gavel size={11} />
                          Proclaimed winner
                        </span>
                      ) : candidate.isWinner && !position.wasTie ? (
                        /* A tie has no single highest-vote winner of record —
                           the tied candidate(s) the Board did NOT pick must
                           not wear the "Highest vote" tag (the proclaimed
                           one(s) carry "Proclaimed winner" instead). */
                        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-b from-emerald-50 to-emerald-100/70 text-emerald-800 border border-emerald-200 border-b-2 border-b-emerald-300 px-2.5 py-0.5 text-[11px] font-bold shadow-[0_1px_3px_rgba(16,185,129,0.1)]">
                          <Trophy size={11} />
                          Highest vote
                        </span>
                      ) : null}
                      {position.wasTie && candidate.proclaimedWinner && (
                        /* The tie-resolution record explains how THIS
                           candidate won, so it sits right of the "Proclaimed
                           winner" badge. 117 — a 2-way both-proclaimed tie has
                           no board pick, so no resolution method exists for it. */
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 text-[#5C0102] border border-amber-200/80 border-b-2 border-b-amber-500 px-2.5 py-0.5 text-[11px] font-bold shadow-[0_2px_5px_rgba(0,0,0,0.2)]">
                          <Gavel size={11} />
                          {position.tieResolutionMethod === "tie_both"
                            ? "Tie — Both Proclaimed"
                            : position.tieBreakNote
                              ? `Tie Resolved By Electoral Board Using ${position.tieBreakNote}`
                              : "Tie Resolved By Electoral Board"}
                        </span>
                      )}
                      {isMe && (
                        /* The viewer's own row — the Apply-for-Candidacy
                           Stage 5 view rings it and badges it "You". */
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            candidate.proclaimedWinner
                              ? "bg-amber-300 text-[#5C0102] shadow-[0_2px_5px_rgba(0,0,0,0.2)]"
                              : "bg-[#5C0102] text-white shadow-[0_2px_5px_rgba(92,1,2,0.25)]"
                          }`}
                        >
                          You
                        </span>
                      )}
                    </div>
                    <p className={`text-sm truncate font-medium ${candidate.proclaimedWinner ? "text-white/80" : "text-gray-500"}`}>
                      {candidate.partyName || "Independent"} · {candidate.gradeLevel}
                    </p>
                  </div>
                </div>

                <div className="sm:text-right sm:w-44">
                  <div className={`text-lg font-bold ${candidate.proclaimedWinner ? "text-white" : "text-gray-900"}`}>
                    {candidate.votes}
                    <span className={`text-sm font-semibold ${candidate.proclaimedWinner ? "text-white/80" : "text-gray-500"}`}> · {share}</span>
                  </div>
                  <div className={`mt-1.5 h-2 rounded-full overflow-hidden p-0.5 ${candidate.proclaimedWinner ? "bg-black/25 shadow-inner" : "bg-gray-100 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]"}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        candidate.proclaimedWinner
                          ? "bg-gradient-to-r from-amber-200 via-white to-amber-100 shadow-[0_1px_3px_rgba(255,255,255,0.6)]"
                          : "bg-gradient-to-r from-[#7A0203] to-[#5C0102] shadow-[0_1px_3px_rgba(92,1,2,0.3)]"
                      }`}
                      style={{
                        width: `${leaderVotes > 0 ? Math.max((candidate.votes / leaderVotes) * 100, 3) : 3}%`,
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export interface ElectionResultsViewProps {
  results: PastElectionResults;
  /** Small label above the school year. Defaults to "Official results". */
  eyebrow?: string;
  /** Optional icon rendered beside the eyebrow. Defaults to the archive icon. */
  eyebrowIcon?: ReactNode;
  /** When true, renders the horizontal draggable position tab bar */
  showPositionTabs?: boolean;
  /** The viewer's own candidate name — matching rows are ringed and
   *  badged "You" (the Apply-for-Candidacy Stage 5 view). */
  highlightName?: string | null;
}

/**
 * The published tally for one election: header, headline totals and every
 * position card.  Shared by the Official Results page (the current,
 * not-yet-superseded election) and the Past Election detail page.
 */
export default function ElectionResultsView({
  results,
  eyebrow = "Official results",
  eyebrowIcon,
  showPositionTabs = false,
  highlightName = null,
}: ElectionResultsViewProps) {
  const positions = useMemo(() => sortPositions(results.positions), [results]);
  const [selectedPosition, setSelectedPosition] = useState<string>("All Positions");
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const positionTabs = useMemo(() => {
    return ["All Positions", ...positions.map((p) => p.position)];
  }, [positions]);

  const displayedPositions = useMemo(() => {
    if (!showPositionTabs || selectedPosition === "All Positions") {
      return positions;
    }
    return positions.filter((p) => p.position === selectedPosition);
  }, [positions, selectedPosition, showPositionTabs]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl overflow-hidden mb-8 text-white border border-red-950/40 border-b-[4px] border-b-[#380001] shadow-[0_20px_45px_-10px_rgba(92,1,2,0.35),0_4px_12px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.25)] relative"
        style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
      >
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-white/5 blur-2xl pointer-events-none" />

        <div className="px-6 py-8 sm:px-10 sm:py-10 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 border border-white/25 backdrop-blur-xs text-xs font-bold text-white/95 uppercase tracking-wider mb-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.3)]">
            {eyebrowIcon ?? <Archive size={16} />}
            <span>{eyebrow}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight drop-shadow-xs">
            {results.election.schoolYear || "School Year"}
          </h1>
          <p className="text-white/85 text-sm sm:text-base mt-2 font-medium">
            {results.election.proclaimed
              ? "Results published and winners proclaimed."
              : "Results published by the Electoral Board."}
          </p>
          <div className="grid gap-3.5 sm:grid-cols-3 mt-8 text-sm">
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/10 backdrop-blur-xs border border-white/15 border-b-2 border-b-black/20 shadow-[0_2px_6px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.2)]">
              <CalendarDays size={18} className="mt-0.5 text-white/80 shrink-0" />
              <div>
                <div className="text-white/70 text-xs font-semibold uppercase tracking-wider">Date</div>
                <div className="mt-0.5 font-bold text-white text-sm">{formatDateRange(results)}</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/10 backdrop-blur-xs border border-white/15 border-b-2 border-b-black/20 shadow-[0_2px_6px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.2)]">
              <MapPin size={18} className="mt-0.5 text-white/80 shrink-0" />
              <div>
                <div className="text-white/70 text-xs font-semibold uppercase tracking-wider">Venue</div>
                <div className="mt-0.5 font-bold text-white text-sm">{results.election.venue || "Not recorded"}</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/10 backdrop-blur-xs border border-white/15 border-b-2 border-b-black/20 shadow-[0_2px_6px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.2)]">
              <Gavel size={18} className="mt-0.5 text-white/80 shrink-0" />
              <div>
                <div className="text-white/70 text-xs font-semibold uppercase tracking-wider">Voting method</div>
                <div className="mt-0.5 font-bold text-white text-sm">{results.election.votingMethod || "Not recorded"}</div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="mb-8">
        <ComplaintRecordSection
          entries={results.election.complaints ?? []}
          complaintNote={results.election.complaintNote}
          decisionReason={results.election.decisionReason}
          decisionReasonLabel="Complaint Resolution and Justification"
          showFindings={false}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-8">
        <div className="rounded-2xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] px-4 py-3.5 shadow-[0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#5C0102]/30 hover:border-b-[#5C0102]/60 hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(92,1,2,0.08)] transition-all duration-200">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Positions</div>
          <div className="mt-1 text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">{results.totals.positionsContested}</div>
        </div>
        <div className="rounded-2xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] px-4 py-3.5 shadow-[0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#5C0102]/30 hover:border-b-[#5C0102]/60 hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(92,1,2,0.08)] transition-all duration-200">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Candidates</div>
          <div className="mt-1 text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">{results.totals.approvedCandidates}</div>
        </div>
        <div className="rounded-2xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] px-4 py-3.5 shadow-[0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#5C0102]/30 hover:border-b-[#5C0102]/60 hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(92,1,2,0.08)] transition-all duration-200">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Votes cast</div>
          <div className="mt-1 text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">{results.totals.votesCast}</div>
        </div>
        <div className="rounded-2xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] px-4 py-3.5 shadow-[0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#5C0102]/30 hover:border-b-[#5C0102]/60 hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(92,1,2,0.08)] transition-all duration-200">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Abstentions</div>
          <div className="mt-1 text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">{results.totals.abstentions}</div>
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-3xl border border-gray-200/90 border-b-[4px] border-b-gray-300 bg-gradient-to-b from-white via-stone-50/60 to-stone-100/50 py-16 px-6 text-center shadow-[0_12px_32px_-6px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)]">
          <div className="w-16 h-16 rounded-2xl bg-stone-100 border border-stone-200 border-b-2 border-b-stone-300 flex items-center justify-center mx-auto mb-4 shadow-[0_2px_6px_rgba(0,0,0,0.04)]">
            <Users size={32} className="text-gray-400" />
          </div>
          <h2 className="text-xl font-extrabold text-gray-900 mb-2 tracking-tight">No Recorded Results</h2>
          <p className="text-gray-500 text-sm">This election has no approved candidates on record.</p>
        </div>
      ) : (
        <>
          {showPositionTabs && (
            <section aria-labelledby="position-tabs-heading" className="mb-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1 mb-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase text-[#5C0102]">
                    <Sparkles size={14} />
                    <span>Contested Offices & Ballots</span>
                  </div>
                  <h2
                    id="position-tabs-heading"
                    className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight mt-0.5 flex items-center gap-2.5"
                  >
                    <span>Election Positions</span>
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-[#5C0102] border border-red-200 shadow-2xs">
                      {positions.length}
                    </span>
                  </h2>
                </div>
                <span className="text-xs text-gray-500 hidden sm:inline-flex items-center gap-1 font-medium">
                  Drag horizontally or click a tab to view candidate tallies
                </span>
              </div>

              {/* Horizontal Draggable & Scrollable Tab Bar */}
              <div
                ref={tabsContainerRef}
                className="bg-white/90 backdrop-blur-md rounded-2xl p-2 sm:p-2.5 border border-gray-200/90 shadow-[0_4px_16px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] border-b-[3px] border-b-gray-300 overflow-x-auto no-scrollbar cursor-grab active:cursor-grabbing select-none"
              >
                <motion.div
                  role="tablist"
                  aria-label="Election Positions"
                  drag="x"
                  dragConstraints={tabsContainerRef}
                  dragElastic={0.12}
                  className="flex items-center gap-2 w-max min-w-full"
                >
                  {positionTabs.map((posName) => {
                    const isSelected = selectedPosition === posName;
                    const isAll = posName === "All Positions";
                    const tabId = `tab-position-${posName.toLowerCase().replace(/\s+/g, "-")}`;
                    return (
                      <button
                        key={posName}
                        id={tabId}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        onClick={() => setSelectedPosition(posName)}
                        style={{
                          backgroundColor: isSelected ? "#5C0102" : undefined,
                        }}
                        className={`group relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer flex-shrink-0 ${
                          isSelected
                            ? "text-white shadow-[0_4px_14px_rgba(92,1,2,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] scale-[1.02] border-b-[3px] border-b-[#380001]"
                            : "bg-white/80 hover:bg-white text-gray-700 hover:text-gray-950 border border-gray-200/80 border-b-2 border-b-gray-300 shadow-[0_2px_4px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,0.8)] hover:shadow-md hover:-translate-y-0.5"
                        }`}
                      >
                        {isAll ? (
                          <Layers
                            size={14}
                            className={
                              isSelected ? "text-white" : "text-gray-400 group-hover:text-gray-600 transition-colors"
                            }
                          />
                        ) : (
                          <Award
                            size={14}
                            className={
                              isSelected ? "text-white" : "text-[#5C0102]/70 group-hover:text-[#5C0102] transition-colors"
                            }
                          />
                        )}
                        <span>{posName}</span>
                      </button>
                    );
                  })}
                </motion.div>
              </div>
            </section>
          )}

          <div className="space-y-6">
            <AnimatePresence mode="wait">
              {displayedPositions.map((position) => (
                <motion.div
                  key={position.position}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.22 }}
                >
                  <PositionCard position={position} highlightName={highlightName} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </>
  );
}
