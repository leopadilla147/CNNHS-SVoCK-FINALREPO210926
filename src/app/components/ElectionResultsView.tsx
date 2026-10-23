import { useMemo, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Archive,
  Ban,
  CalendarDays,
  Gavel,
  MapPin,
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

export function PositionCard({ position }: { position: PastElectionPositionResult }) {
  const ranked = position.candidates;
  const leaderVotes = ranked[0]?.votes ?? 0;

  return (
    <section
      aria-labelledby={`position-${position.position.toLowerCase().replace(/\s+/g, "-")}`}
      className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
    >
      <div
        className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-white"
        style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
      >
        <h2
          id={`position-${position.position.toLowerCase().replace(/\s+/g, "-")}`}
          className="text-lg"
        >
          {position.position}
        </h2>
        <div className="text-xs text-white/80 flex items-center gap-3 flex-wrap">
          <span>{position.votesCast} vote{position.votesCast === 1 ? "" : "s"} cast</span>
          <span className="inline-flex items-center gap-1">
            <Ban size={12} />
            {position.abstentions} abstention{position.abstentions === 1 ? "" : "s"}
          </span>
          {position.wasTie && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 border border-amber-300/60 px-2 py-0.5 text-[11px] font-medium text-amber-100">
              <Gavel size={12} />
              {position.tieBreakNote ? `Tie — resolved via ${position.tieBreakNote}` : "Tie resolved by the Board"}
            </span>
          )}
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">No approved candidates for this position.</p>
      ) : (
        <ul className="p-2 space-y-1.5">
          {ranked.map((candidate, index) => {
            const share = formatPercentage(candidate.votes, position.votesCast);
            return (
              <li
                key={`${candidate.name}-${index}`}
                className={`px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl ${
                  candidate.proclaimedWinner ? "bg-[#5C0102] shadow-sm" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* The trophy marks the proclaimed winner — the same column
                      pattern as the Proclamation Dialog (empty on the other
                      rows so every candidate stays aligned). */}
                  <div className="flex items-center justify-center w-6 shrink-0">
                    {candidate.proclaimedWinner && (
                      <Trophy size={18} className="text-amber-300 drop-shadow-sm" />
                    )}
                  </div>
                  {candidate.picture ? (
                    <img
                      src={candidate.picture}
                      alt={candidate.name}
                      className="w-12 h-12 rounded-full object-cover border-2 flex-shrink-0"
                      style={{ borderColor: candidate.proclaimedWinner ? "#FFFFFF" : "#5C0102" }}
                    />
                  ) : (
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                        candidate.proclaimedWinner
                          ? "bg-white/10"
                          : "bg-gray-100"
                      }`}
                      style={{
                        border: "2px solid",
                        borderColor: candidate.proclaimedWinner ? "#FFFFFF" : "#5C0102",
                      }}
                    >
                      <Users size={20} className={candidate.proclaimedWinner ? "text-white/70" : "text-gray-400"} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-medium truncate ${candidate.proclaimedWinner ? "text-white" : "text-gray-900"}`}>{candidate.name}</h3>
                      {candidate.proclaimedWinner ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white text-[#5C0102] border border-white px-2 py-0.5 text-[11px] font-medium">
                          <Gavel size={11} />
                          Proclaimed winner
                        </span>
                      ) : candidate.isWinner ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium">
                          <Trophy size={11} />
                          Highest vote
                        </span>
                      ) : null}
                    </div>
                    <p className={`text-sm truncate ${candidate.proclaimedWinner ? "text-white/70" : "text-gray-500"}`}>
                      {candidate.partyName || "Independent"} · {candidate.gradeLevel}
                    </p>
                  </div>
                </div>

                <div className="sm:text-right sm:w-40">
                  <div className={`text-lg ${candidate.proclaimedWinner ? "text-white" : "text-gray-900"}`}>
                    {candidate.votes}
                    <span className={`text-sm ${candidate.proclaimedWinner ? "text-white/70" : "text-gray-500"}`}> · {share}</span>
                  </div>
                  <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden ${candidate.proclaimedWinner ? "bg-white/20" : "bg-gray-100"}`}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${leaderVotes > 0 ? Math.max((candidate.votes / leaderVotes) * 100, 3) : 3}%`,
                        backgroundColor: candidate.proclaimedWinner ? "#FFFFFF" : "#5C0102",
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
}: ElectionResultsViewProps) {
  const positions = useMemo(() => sortPositions(results.positions), [results]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden mb-8 text-white"
        style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
      >
        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex items-center gap-2 text-sm text-white/75 mb-3">
            {eyebrowIcon ?? <Archive size={18} />}
            <span>{eyebrow}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold">
            {results.election.schoolYear || "School Year"}
          </h1>
          <p className="text-white/75 mt-2">
            {results.election.proclaimed
              ? "Results published and winners proclaimed."
              : "Results published by the Electoral Board."}
          </p>
          <div className="grid gap-4 sm:grid-cols-3 mt-8 text-sm">
            <div className="flex items-start gap-2">
              <CalendarDays size={17} className="mt-0.5 text-white/75" />
              <div>
                <div className="text-white/60">Date</div>
                <div className="mt-0.5">{formatDateRange(results)}</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin size={17} className="mt-0.5 text-white/75" />
              <div>
                <div className="text-white/60">Venue</div>
                <div className="mt-0.5">{results.election.venue || "Not recorded"}</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Gavel size={17} className="mt-0.5 text-white/75" />
              <div>
                <div className="text-white/60">Voting method</div>
                <div className="mt-0.5">{results.election.votingMethod || "Not recorded"}</div>
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
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-gray-500">Positions</div>
          <div className="mt-0.5 text-lg text-gray-900">{results.totals.positionsContested}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-gray-500">Candidates</div>
          <div className="mt-0.5 text-lg text-gray-900">{results.totals.approvedCandidates}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-gray-500">Votes cast</div>
          <div className="mt-0.5 text-lg text-gray-900">{results.totals.votesCast}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-gray-500">Abstentions</div>
          <div className="mt-0.5 text-lg text-gray-900">{results.totals.abstentions}</div>
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white py-20 px-6 text-center shadow-sm">
          <Users size={40} className="mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl text-gray-900 mb-2">No Recorded Results</h2>
          <p className="text-gray-500">This election has no approved candidates on record.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {positions.map((position) => (
            <PositionCard key={position.position} position={position} />
          ))}
        </div>
      )}
    </>
  );
}
