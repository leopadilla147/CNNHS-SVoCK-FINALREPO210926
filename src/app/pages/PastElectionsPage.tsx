import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  Archive,
  CalendarDays,
  ChevronRight,
  Gavel,
  Loader2,
  MapPin,
  ShieldAlert,
  Trophy,
  Users,
} from "lucide-react";
import { listPastElections, type PastElectionSummary } from "../lib/supabaseData";

function formatDateRange(election: PastElectionSummary): string {
  if (!election.electionDate) return "Date not recorded";
  if (election.endDate && election.endDate !== election.electionDate) {
    return `${election.electionDate} – ${election.endDate}`;
  }
  return election.electionDate;
}

/**
 * Most recent first.  electionDate is a YYYY-MM-DD string, so a plain compare
 * is chronological; rows with no recorded date sink below the dated ones and
 * fall back to the school year (itself descending).  The server already orders
 * the RPC this way — this keeps the guarantee even for rows whose dates are
 * missing or when an older RPC is deployed.
 */
export function sortPastElectionsByRecency(
  elections: PastElectionSummary[],
): PastElectionSummary[] {
  return [...elections].sort((left, right) => {
    if (left.electionDate && right.electionDate) {
      if (left.electionDate !== right.electionDate) {
        return left.electionDate < right.electionDate ? 1 : -1;
      }
    } else if (left.electionDate !== right.electionDate) {
      return left.electionDate ? -1 : 1;
    }
    return right.schoolYear.localeCompare(left.schoolYear);
  });
}

export default function PastElectionsPage() {
  const [elections, setElections] = useState<PastElectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHasError(false);

    listPastElections()
      .then((result) => {
        if (active) setElections(sortPastElectionsByRecency(result));
      })
      .catch(() => {
        if (active) {
          setElections([]);
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <Loader2 className="animate-spin mb-4" size={36} style={{ color: "#5C0102" }} />
            <p className="text-gray-600">Loading past elections...</p>
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl text-gray-900 mb-2">Unable to Load Past Elections</h1>
            <p className="text-gray-500 max-w-md">
              We could not retrieve the election history. Please try again later.
            </p>
            <Link
              to="/"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : elections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-5">
              <Archive size={36} className="text-gray-400" />
            </div>
            <h1 className="text-3xl text-gray-900 mb-3">No Past Elections Yet</h1>
            <p className="text-gray-500 max-w-md">
              An election is listed here once the Electoral Board starts a new
              one. The current official results live on the Official Results page.
            </p>
            <Link
              to="/official-results"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              View Official Results
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
                  <span>Official election records</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-semibold">Past Elections</h1>
                <p className="text-white/75 mt-2">
                  Published results, full vote tallies, and proclaimed winners.
                </p>
              </div>
            </motion.div>

            <div className="space-y-4">
              {elections.map((election) => (
                <article
                  key={election.id}
                  className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-xl text-gray-900">
                        {election.schoolYear || "School Year"}
                      </h2>
                      <div className="mt-2 space-y-1.5 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                          <CalendarDays size={15} className="text-gray-400" />
                          <span>{formatDateRange(election)}</span>
                        </div>
                        {election.venue ? (
                          <div className="flex items-center gap-2">
                            <MapPin size={15} className="text-gray-400" />
                            <span>{election.venue}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                      {election.proclaimed ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 text-xs font-medium">
                          <Gavel size={13} />
                          Winners proclaimed
                        </span>
                      ) : null}
                      {election.hadTies ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 text-xs font-medium">
                          <Gavel size={13} />
                          Tie resolved
                        </span>
                      ) : null}
                      {election.hadComplaint ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 text-xs font-medium">
                          <ShieldAlert size={13} />
                          Complaint on record
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                      <div className="text-xs text-gray-500">Positions</div>
                      <div className="mt-0.5 text-gray-900">{election.positionsContested}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Users size={12} />
                        Candidates
                      </div>
                      <div className="mt-0.5 text-gray-900">{election.approvedCandidates}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Trophy size={12} />
                        Votes cast
                      </div>
                      <div className="mt-0.5 text-gray-900">{election.votesCast}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                      <div className="text-xs text-gray-500">Abstentions</div>
                      <div className="mt-0.5 text-gray-900">{election.abstentions}</div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <Link
                      to={`/past-elections/${election.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium"
                      style={{ backgroundColor: "#5C0102" }}
                    >
                      View Full Results
                      <ChevronRight size={16} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
