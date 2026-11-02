import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  CalendarDays,
  Clock,
  GraduationCap,
  Loader2,
  MapPin,
  Shield,
  ShieldCheck,
  UserRound,
  Users,
  Vote,
} from "lucide-react";
import {
  getCurrentPublicElection,
  type PublicCurrentCandidate,
  type PublicCurrentElection,
  type PublicCurrentStage,
} from "../lib/supabaseData";
import { FULL_POSITION_ORDER as POSITION_ORDER } from "../lib/partyScope";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

const POSITION_INDEX = new Map<string, number>(
  POSITION_ORDER.map((position, index) => [position, index]),
);

/** Pill shown on the hero — the label follows the period's lifecycle stage. */
const STAGE_BADGES: Record<
  PublicCurrentStage,
  { label: string; dotClass: string; badgeBg: string; pulse: boolean }
> = {
  application: {
    label: "The election is underway",
    dotClass: "bg-emerald-400",
    badgeBg: "bg-emerald-500/20 text-emerald-100 border-emerald-400/30",
    pulse: true,
  },
  campaign: {
    label: "Campaign period",
    dotClass: "bg-amber-300",
    badgeBg: "bg-amber-500/20 text-amber-100 border-amber-300/30",
    pulse: true,
  },
  fingerprint_registration: {
    label: "Fingerprint Registration",
    dotClass: "bg-sky-300",
    badgeBg: "bg-sky-500/20 text-sky-100 border-sky-300/30",
    pulse: true,
  },
  voting: {
    label: "Voting in progress",
    dotClass: "bg-emerald-400",
    badgeBg: "bg-emerald-500/20 text-emerald-100 border-emerald-400/30",
    pulse: true,
  },
  results: {
    label: "Voting concluded",
    dotClass: "bg-gray-300",
    badgeBg: "bg-white/15 text-white/90 border-white/20",
    pulse: false,
  },
};

export interface CandidatePartyGroup {
  name: string;
  candidates: PublicCurrentCandidate[];
}

export function groupCandidatesByParty(candidates: PublicCurrentCandidate[]): CandidatePartyGroup[] {
  const groups = new Map<string, CandidatePartyGroup>();

  candidates.forEach((candidate) => {
    const name = candidate.partyAffiliation?.trim() || "Independent";
    const key = name.toLowerCase();
    const group = groups.get(key);

    if (group) {
      group.candidates.push(candidate);
    } else {
      groups.set(key, { name, candidates: [candidate] });
    }
  });

  return [...groups.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({
      ...group,
      candidates: [...group.candidates].sort((left, right) => {
        const positionDifference =
          (POSITION_INDEX.get(left.position) ?? POSITION_ORDER.length) -
          (POSITION_INDEX.get(right.position) ?? POSITION_ORDER.length);
        return positionDifference || left.name.localeCompare(right.name);
      }),
    }));
}

function formatDateRange(election: PublicCurrentElection): string {
  if (!election.electionDate) return "Date to be announced";
  if (election.endDate && election.endDate !== election.electionDate) {
    return `${election.electionDate} – ${election.endDate}`;
  }
  return election.electionDate;
}

function formatVotingWindow(election: PublicCurrentElection): string {
  if (election.startTime && election.endTime) {
    return `${election.startTime} – ${election.endTime}`;
  }
  return election.startTime || election.endTime || "Time to be announced";
}

export default function CurrentElectionPage() {
  const [election, setElection] = useState<PublicCurrentElection | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHasError(false);

    getCurrentPublicElection()
      .then((result) => {
        if (active) setElection(result);
      })
      .catch(() => {
        if (active) {
          setElection(null);
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

  const partyGroups = useMemo(
    () => (election ? groupCandidatesByParty(election.candidates) : []),
    [election],
  );

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
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
            <p className="text-gray-900 font-medium text-base">Loading current election details...</p>
            <p className="text-gray-500 text-sm mt-1">Checking active election period and slates</p>
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
              Unable to Load Current Election
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto">
              We could not retrieve the current election information. Please check your connection or try again later.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex items-center justify-center px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:opacity-90 shadow-sm"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : !election ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 sm:p-16 max-w-2xl mx-auto text-center">
            <div className="w-20 h-20 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-6 shadow-sm">
              <CalendarDays size={38} className="text-gray-400" />
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-100 mb-3">
              <Clock size={12} />
              Status Update
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-3 tracking-tight">
              No Current Election
            </h1>
            <p className="text-gray-500 text-sm sm:text-base leading-relaxed max-w-md mx-auto">
              No election is being publicized right now. Approved candidates will appear here once the
              Campaign Period begins.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                to="/"
                className="px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:opacity-90 shadow-sm"
                style={{ backgroundColor: "#5C0102" }}
              >
                Return Home
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ── Modern Hero Section ───────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative rounded-3xl overflow-hidden mb-10 text-white shadow-xl"
              style={{
                background: "linear-gradient(135deg, #5C0102 0%, #8B0103 60%, #6B0203 100%)",
              }}
            >
              {/* Decorative background ambient glows */}
              <div
                className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.08]"
                style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
              />
              <div
                className="pointer-events-none absolute -bottom-24 -left-20 w-80 h-80 rounded-full opacity-[0.05]"
                style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
              />

              <div className="relative px-6 py-8 sm:px-10 sm:py-12">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 pb-8 border-b border-white/10">
                  <div className="flex flex-col sm:flex-row items-start gap-5">
                    {/* Seal / Logo */}
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center flex-shrink-0 shadow-inner">
                      <img
                        src={cnnhsLogo}
                        alt=""
                        className="w-11 h-11 sm:w-14 sm:h-14 rounded-full object-contain"
                      />
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-medium tracking-wider uppercase mb-3 text-white/90">
                        <ShieldCheck size={13} />
                        <span>Public election information</span>
                      </div>
                      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight">
                        Current Election
                      </h1>
                      <p className="text-white/75 mt-2.5 text-sm sm:text-base max-w-xl leading-relaxed">
                        {election.stage === "application"
                          ? "Current stage: Application of Candidacy"
                          : "Meet the approved candidates for the active election."}
                      </p>
                    </div>
                  </div>

                  {/* Stage Pill */}
                  <div
                    className={`inline-flex items-center gap-2.5 self-start rounded-full px-4 py-2 text-xs sm:text-sm font-medium backdrop-blur-md border shadow-sm ${STAGE_BADGES[election.stage].badgeBg}`}
                  >
                    <span className="relative flex h-2.5 w-2.5">
                      {STAGE_BADGES[election.stage].pulse && (
                        <span
                          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${STAGE_BADGES[election.stage].dotClass}`}
                        />
                      )}
                      <span
                        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${STAGE_BADGES[election.stage].dotClass}`}
                      />
                    </span>
                    <span>{STAGE_BADGES[election.stage].label}</span>
                  </div>
                </div>

                {/* Info Bar cards */}
                <div className="grid gap-3 sm:gap-4 sm:grid-cols-3 mt-6 pt-2">
                  <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-4 flex items-start gap-3.5 transition-colors hover:bg-white/15">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 text-white/90">
                      <CalendarDays size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-white/60 font-medium">Date</div>
                      <div className="mt-1 font-medium text-white text-sm sm:text-base truncate">
                        {formatDateRange(election)}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-4 flex items-start gap-3.5 transition-colors hover:bg-white/15">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 text-white/90">
                      <Clock size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-white/60 font-medium">Voting window</div>
                      <div className="mt-1 font-medium text-white text-sm sm:text-base truncate">
                        {formatVotingWindow(election)}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-4 flex items-start gap-3.5 transition-colors hover:bg-white/15">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 text-white/90">
                      <MapPin size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-white/60 font-medium">Venue</div>
                      <div className="mt-1 font-medium text-white text-sm sm:text-base truncate">
                        {election.venue || "To be announced"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ── Stage 1: Application of Candidacy State ──────── */}
            {election.stage === "application" ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="rounded-3xl border border-gray-100 bg-white py-16 px-6 sm:px-12 text-center shadow-sm relative overflow-hidden"
              >
                <div
                  className="absolute top-0 left-0 right-0 h-1.5"
                  style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                />
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-gray-100 shadow-sm"
                  style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
                >
                  <CalendarDays size={30} />
                </div>
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider mb-3"
                  style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
                >
                  <Vote size={12} />
                  Filing in progress
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-3 tracking-tight">
                  Application of Candidacy
                </h2>
                <p className="text-gray-700 font-medium max-w-xl mx-auto mb-2 text-sm sm:text-base">
                  The election is underway — candidates are filing their candidacies during this stage.
                </p>
                <p className="text-gray-500 text-sm max-w-md mx-auto leading-relaxed">
                  Approved candidates will appear here once the Campaign Period begins.
                </p>
              </motion.div>
            ) : election.candidates.length === 0 ? (
              /* ── No Approved Candidates Yet ─────────────────── */
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="rounded-3xl border border-gray-100 bg-white py-16 px-6 sm:px-12 text-center shadow-sm"
              >
                <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-5 text-gray-400 shadow-sm">
                  <Users size={32} />
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2.5 tracking-tight">
                  No Approved Candidates Yet
                </h2>
                <p className="text-gray-500 text-sm max-w-md mx-auto leading-relaxed">
                  Approved candidates will appear here when they are posted.
                </p>
              </motion.div>
            ) : (
              /* ── Party Groups & Slates ──────────────────────── */
              <div className="space-y-12">
                {partyGroups.map((group, groupIndex) => {
                  const headingId = `party-${group.name.toLowerCase().replace(/\s+/g, "-")}`;
                  return (
                    <motion.section
                      key={group.name.toLowerCase()}
                      aria-labelledby={headingId}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: groupIndex * 0.1 }}
                      className="space-y-5"
                    >
                      {/* Section Header */}
                      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-gray-200">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-sm"
                            style={{ backgroundColor: "#5C0102" }}
                          >
                            <Users size={20} />
                          </div>
                          <div>
                            <div
                              className="text-xs font-semibold uppercase tracking-wider"
                              style={{ color: "#5C0102" }}
                            >
                              Party Slate
                            </div>
                            <h2
                              id={headingId}
                              className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight"
                            >
                              {group.name}
                            </h2>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded-full px-3.5 py-1">
                            {group.candidates.length} candidate{group.candidates.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>

                      {/* Candidate Cards Grid */}
                      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {group.candidates.map((candidate, candidateIndex) => (
                          <motion.article
                            key={candidate.id}
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35, delay: 0.05 * candidateIndex }}
                            className="group relative rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
                          >
                            {/* Card Accent on hover */}
                            <div
                              className="absolute inset-x-0 bottom-0 h-1 rounded-b-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                              style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                            />

                            <div>
                              {/* Avatar & Info Header */}
                              <div className="flex items-start gap-4">
                                {candidate.picture ? (
                                  <img
                                    src={candidate.picture}
                                    alt={candidate.name}
                                    className="w-16 h-16 rounded-2xl object-cover ring-2 ring-gray-100 flex-shrink-0 shadow-sm group-hover:ring-[#5C0102]/30 transition-all duration-300"
                                  />
                                ) : (
                                  <div
                                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200/80 flex items-center justify-center flex-shrink-0 text-gray-400 group-hover:text-[#5C0102] group-hover:border-[#5C0102]/30 transition-all duration-300 shadow-sm"
                                  >
                                    <UserRound size={26} />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 pt-0.5">
                                  <div
                                    className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide uppercase mb-1"
                                    style={{
                                      backgroundColor: "rgba(92, 1, 2, 0.07)",
                                      color: "#5C0102",
                                    }}
                                  >
                                    {candidate.position}
                                  </div>
                                  <h3 className="font-semibold text-gray-900 truncate group-hover:text-[#5C0102] transition-colors duration-200 text-base">
                                    {candidate.name}
                                  </h3>
                                </div>
                              </div>
                            </div>

                            {/* Candidate Meta info */}
                            <div className="mt-4 pt-3.5 border-t border-gray-100 text-xs text-gray-500 space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-1.5 text-gray-400 font-medium">
                                  <Shield size={13} />
                                  Party
                                </span>
                                <span className="text-gray-800 font-medium text-right truncate">
                                  {candidate.partyAffiliation || "Independent"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-1.5 text-gray-400 font-medium">
                                  <GraduationCap size={13} />
                                  Grade
                                </span>
                                <span className="text-gray-800 font-medium">
                                  {candidate.gradeLevel}
                                </span>
                              </div>
                            </div>
                          </motion.article>
                        ))}
                      </div>
                    </motion.section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
