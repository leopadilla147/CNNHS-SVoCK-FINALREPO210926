import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Ban,
  CalendarDays,
  Gavel,
  Loader2,
  MapPin,
  Trophy,
  Users,
} from "lucide-react";
import {
  getPastElectionResults,
  type PastElectionPositionResult,
  type PastElectionResults,
} from "../lib/supabaseData";

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

export function sortPositions(
  positions: PastElectionPositionResult[]
): PastElectionPositionResult[] {
  return [...positions].sort(
    (left, right) =>
      (POSITION_INDEX.get(left.position) ?? POSITION_ORDER.length) -
        (POSITION_INDEX.get(right.position) ?? POSITION_ORDER.length) || 0
  );
}

function formatDateRange(results: PastElectionResults): string {
  const { electionDate, endDate } = results.election;
  if (!electionDate) return "Date not recorded";
  if (endDate && endDate !== electionDate) return `${electionDate} – ${endDate}`;
  return electionDate;
}

function formatPercentage(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function PositionCard({ position }: { position: PastElectionPositionResult }) {
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
        <div className="text-xs text-white/80 flex items-center gap-3">
          <span>{position.votesCast} vote{position.votesCast === 1 ? "" : "s"} cast</span>
          <span className="inline-flex items-center gap-1">
            <Ban size={12} />
            {position.abstentions} abstention{position.abstentions === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">No approved candidates for this position.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {ranked.map((candidate) => {
            const share = formatPercentage(candidate.votes, position.votesCast);
            return (
              <li
                key={candidate.candidateId}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {candidate.picture ? (
                    <img
                      src={candidate.picture}
                      alt={candidate.name}
                      className="w-12 h-12 rounded-full object-cover border-2 flex-shrink-0"
                      style={{ borderColor: candidate.proclaimedWinner ? "#B45309" : "#5C0102" }}
                    />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"
                      style={{
                        border: "2px solid",
                        borderColor: candidate.proclaimedWinner ? "#B45309" : "#5C0102",
                      }}
                    >
                      <Users size={20} className="text-gray-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-gray-900 truncate">{candidate.name}</h3>
                      {candidate.proclaimedWinner ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[11px] font-medium">
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
                    <p className="text-sm text-gray-500 truncate">
                      {candidate.partyName || "Independent"} · {candidate.gradeLevel}
                    </p>
                  </div>
                </div>

                <div className="sm:text-right sm:w-40">
                  <div className="text-lg text-gray-900">
                    {candidate.votes}
                    <span className="text-sm text-gray-500"> · {share}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${leaderVotes > 0 ? Math.max((candidate.votes / leaderVotes) * 100, 3) : 3}%`,
                        backgroundColor: candidate.proclaimedWinner ? "#B45309" : "#5C0102",
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

export default function PastElectionDetailPage() {
  const { electionId } = useParams<{ electionId: string }>();
  const [results, setResults] = useState<PastElectionResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!electionId) return;
    let active = true;
    setLoading(true);
    setHasError(false);

    getPastElectionResults(electionId)
      .then((result) => {
        if (active) setResults(result);
      })
      .catch(() => {
        if (active) {
          setResults(null);
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [electionId]);

  const positions = useMemo(
    () => (results ? sortPositions(results.positions) : []),
    [results],
  );

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          to="/past-elections"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft size={16} />
          All past elections
        </Link>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <Loader2 className="animate-spin mb-4" size={36} style={{ color: "#5C0102" }} />
            <p className="text-gray-600">Loading official results...</p>
          </div>
        ) : hasError || !results ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl text-gray-900 mb-2">Results Not Available</h1>
            <p className="text-gray-500 max-w-md">
              These results are either not published yet or the election does not exist.
            </p>
            <Link
              to="/past-elections"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Back to Past Elections
            </Link>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden mb-8 text-white"
              style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
            >
              <div className="px-6 py-8 sm:px-10 sm:py-10">
                <div className="flex items-center gap-2 text-sm text-white/75 mb-3">
                  <Archive size={18} />
                  <span>Official results</span>
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
        )}
      </div>
    </div>
  );
}
