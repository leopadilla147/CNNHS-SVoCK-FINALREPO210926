import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  Archive,
  CalendarDays,
  ChevronRight,
  Gavel,
  History,
  Layers,
  Loader2,
  MapPin,
  ShieldAlert,
  Trophy,
  Users,
  Vote,
} from "lucide-react";
import { listPastElections, type PastElectionSummary } from "../lib/supabaseData";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center py-28 text-center"
            role="status"
          >
            <div className="relative mb-5">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-inner"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.08)" }}
              >
                <Loader2 className="animate-spin" size={32} style={{ color: "#5C0102" }} />
              </div>
            </div>
            <p className="text-gray-900 font-medium text-base">Loading past elections...</p>
            <p className="text-gray-500 text-sm mt-1">Fetching official historical records and tallies</p>
          </div>
        ) : hasError ? (
          <div
            className="bg-white rounded-3xl border border-red-100 shadow-sm p-8 sm:p-14 max-w-xl mx-auto text-center"
            role="alert"
          >
            <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-5 border border-red-100">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-2.5">
              Unable to Load Past Elections
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto">
              We could not retrieve the election history. Please try again later.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex items-center justify-center px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:opacity-90 shadow-sm"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : elections.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 sm:p-16 max-w-2xl mx-auto text-center">
            <div className="w-20 h-20 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Archive size={38} className="text-gray-400" />
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-100 mb-3">
              <History size={12} />
              Archives Empty
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-3 tracking-tight">
              No Past Elections Yet
            </h1>
            <p className="text-gray-500 text-sm sm:text-base leading-relaxed max-w-md mx-auto">
              An election is listed here once the Electoral Board starts a new one. The current official results live on the Official Results page.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                to="/official-results"
                className="px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:opacity-90 shadow-sm"
                style={{ backgroundColor: "#5C0102" }}
              >
                View Official Results
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ── Hero Banner ───────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative rounded-3xl overflow-hidden mb-10 text-white shadow-xl"
              style={{
                background: "linear-gradient(135deg, #5C0102 0%, #8B0103 60%, #6B0203 100%)",
              }}
            >
              {/* Decorative radial glows */}
              <div
                className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.08]"
                style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
              />
              <div
                className="pointer-events-none absolute -bottom-24 -left-20 w-80 h-80 rounded-full opacity-[0.05]"
                style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
              />

              <div className="relative px-6 py-8 sm:px-10 sm:py-12">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                  {/* School Seal */}
                  <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center flex-shrink-0 shadow-lg p-2.5">
                    <img
                      src={cnnhsLogo}
                      alt=""
                      className="w-13 h-13 sm:w-16 sm:h-16 rounded-full object-contain"
                    />
                  </div>

                  <div className="text-center sm:text-left">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-medium tracking-wider uppercase mb-3.5 text-white/90">
                      <Archive size={13} />
                      <span>Official election records</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight">
                      Past Elections
                    </h1>
                    <p className="text-white/75 mt-2.5 text-sm sm:text-base max-w-xl leading-relaxed">
                      Published results, full vote tallies, and proclaimed winners.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ── Election Cards List ───────────────────────────── */}
            <div className="space-y-6">
              {elections.map((election, index) => (
                <motion.article
                  key={election.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: index * 0.08 }}
                  className="group relative rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden"
                >
                  {/* Card hover accent bar */}
                  <div
                    className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                  />

                  {/* Top Row: Title, Date, Venue & Badges */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5 pb-5 border-b border-gray-100">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider mb-2 text-gray-500 bg-gray-100">
                        <History size={12} />
                        Academic Year
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 group-hover:text-[#5C0102] transition-colors tracking-tight">
                        {election.schoolYear || "School Year"}
                      </h2>
                      <div className="mt-2.5 flex flex-wrap items-center gap-y-2 gap-x-4 text-xs sm:text-sm text-gray-500">
                        <div className="flex items-center gap-1.5 font-medium text-gray-700">
                          <CalendarDays size={15} style={{ color: "#5C0102" }} />
                          <span>{formatDateRange(election)}</span>
                        </div>
                        {election.venue ? (
                          <div className="flex items-center gap-1.5 text-gray-600">
                            <MapPin size={15} className="text-gray-400" />
                            <span>{election.venue}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Status Badges */}
                    <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-2 shrink-0">
                      {election.proclaimed ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-3.5 py-1 text-xs font-semibold shadow-xs">
                          <Gavel size={13} className="text-emerald-600" />
                          Winners proclaimed
                        </span>
                      ) : null}
                      {election.hadTies ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-3.5 py-1 text-xs font-semibold shadow-xs">
                          <Gavel size={13} className="text-amber-600" />
                          Tie resolved
                        </span>
                      ) : null}
                      {election.hadComplaint ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 px-3.5 py-1 text-xs font-semibold shadow-xs">
                          <ShieldAlert size={13} className="text-rose-600" />
                          Complaint on record
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Middle Row: Metrics Grid */}
                  <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                    <div className="rounded-2xl bg-gray-50/80 border border-gray-100 p-4 transition-colors group-hover:bg-gray-50">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers size={13} className="text-gray-400" />
                        Positions
                      </div>
                      <div className="mt-1.5 text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                        {election.positionsContested}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50/80 border border-gray-100 p-4 transition-colors group-hover:bg-gray-50">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Users size={13} className="text-gray-400" />
                        Candidates
                      </div>
                      <div className="mt-1.5 text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                        {election.approvedCandidates}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50/80 border border-gray-100 p-4 transition-colors group-hover:bg-gray-50">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Trophy size={13} style={{ color: "#5C0102" }} />
                        Votes cast
                      </div>
                      <div className="mt-1.5 text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                        {election.votesCast}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50/80 border border-gray-100 p-4 transition-colors group-hover:bg-gray-50">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Vote size={13} className="text-gray-400" />
                        Abstentions
                      </div>
                      <div className="mt-1.5 text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                        {election.abstentions}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Row: CTA Button */}
                  <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-400 hidden sm:inline">
                      Official tally audited by COMEA
                    </span>
                    <Link
                      to={`/past-elections/${election.id}`}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all duration-200 shadow-sm hover:opacity-90 hover:shadow-md group/btn"
                      style={{ backgroundColor: "#5C0102" }}
                    >
                      <span>View Full Results</span>
                      <ChevronRight
                        size={16}
                        className="transition-transform duration-200 group-hover/btn:translate-x-0.5"
                      />
                    </Link>
                  </div>
                </motion.article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
