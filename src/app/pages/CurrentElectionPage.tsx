import { useEffect, useMemo, useRef, useState } from "react";
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

interface PartyTheme {
  primary: string;
  primaryHover: string;
  gradient: string;
  cardBg: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  shadowColor: string;
}

const THEME_PALETTE: PartyTheme[] = [
  {
    primary: "#5C0102",
    primaryHover: "#7A0103",
    gradient: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)",
    cardBg: "linear-gradient(180deg, #FFFFFF 0%, #FDF7F7 100%)",
    badgeBg: "rgba(92, 1, 2, 0.08)",
    badgeText: "#5C0102",
    badgeBorder: "rgba(92, 1, 2, 0.2)",
    shadowColor: "rgba(92, 1, 2, 0.22)",
  },
  {
    primary: "#1D4ED8",
    primaryHover: "#1E40AF",
    gradient: "linear-gradient(135deg, #1E40AF 0%, #2563EB 100%)",
    cardBg: "linear-gradient(180deg, #FFFFFF 0%, #F4F7FF 100%)",
    badgeBg: "rgba(29, 78, 216, 0.08)",
    badgeText: "#1D4ED8",
    badgeBorder: "rgba(29, 78, 216, 0.2)",
    shadowColor: "rgba(29, 78, 216, 0.22)",
  },
  {
    primary: "#047857",
    primaryHover: "#065F46",
    gradient: "linear-gradient(135deg, #065F46 0%, #059669 100%)",
    cardBg: "linear-gradient(180deg, #FFFFFF 0%, #F2FBF6 100%)",
    badgeBg: "rgba(4, 120, 87, 0.08)",
    badgeText: "#047857",
    badgeBorder: "rgba(4, 120, 87, 0.2)",
    shadowColor: "rgba(4, 120, 87, 0.22)",
  },
  {
    primary: "#6D28D9",
    primaryHover: "#5B21B6",
    gradient: "linear-gradient(135deg, #5B21B6 0%, #7C3AED 100%)",
    cardBg: "linear-gradient(180deg, #FFFFFF 0%, #F8F5FE 100%)",
    badgeBg: "rgba(109, 40, 217, 0.08)",
    badgeText: "#6D28D9",
    badgeBorder: "rgba(109, 40, 217, 0.2)",
    shadowColor: "rgba(109, 40, 217, 0.22)",
  },
  {
    primary: "#D97706",
    primaryHover: "#B45309",
    gradient: "linear-gradient(135deg, #B45309 0%, #D97706 100%)",
    cardBg: "linear-gradient(180deg, #FFFFFF 0%, #FEFBF3 100%)",
    badgeBg: "rgba(217, 119, 6, 0.08)",
    badgeText: "#B45309",
    badgeBorder: "rgba(217, 119, 6, 0.2)",
    shadowColor: "rgba(217, 119, 6, 0.22)",
  },
];

const INDEPENDENT_THEME: PartyTheme = {
  primary: "#475569",
  primaryHover: "#334155",
  gradient: "linear-gradient(135deg, #334155 0%, #475569 100%)",
  cardBg: "linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)",
  badgeBg: "rgba(71, 85, 105, 0.08)",
  badgeText: "#334155",
  badgeBorder: "rgba(71, 85, 105, 0.2)",
  shadowColor: "rgba(71, 85, 105, 0.22)",
};

function getPartyTheme(partyName: string, partyIndex: number): PartyTheme {
  if (partyName.trim().toLowerCase() === "independent") {
    return INDEPENDENT_THEME;
  }
  return THEME_PALETTE[partyIndex % THEME_PALETTE.length];
}

export default function CurrentElectionPage() {
  const [election, setElection] = useState<PublicCurrentElection | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [activeParty, setActiveParty] = useState<string>("");
  const tabsContainerRef = useRef<HTMLDivElement>(null);

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

  const selectedParty =
    activeParty && partyGroups.some((g) => g.name === activeParty)
      ? activeParty
      : (partyGroups[0]?.name ?? "");

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-[1440px] 2xl:max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
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
              className="relative rounded-3xl overflow-hidden mb-10 text-white shadow-[0_16px_36px_-6px_rgba(92,1,2,0.35),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-2px_0_rgba(0,0,0,0.2)]"
              style={{
                background: "linear-gradient(135deg, #4A0102 0%, #5C0102 45%, #8B0103 85%, #6B0203 100%)",
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
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.3)]">
                      <img
                        src={cnnhsLogo}
                        alt=""
                        className="w-11 h-11 sm:w-14 sm:h-14 rounded-full object-contain"
                      />
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs font-semibold tracking-wider uppercase mb-3 text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                        <ShieldCheck size={13} />
                        <span>Public election information</span>
                      </div>
                      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight drop-shadow-sm">
                        Current Election
                      </h1>
                      <p className="text-white/80 mt-2.5 text-sm sm:text-base max-w-xl leading-relaxed">
                        {election.stage === "application"
                          ? "Current stage: Application of Candidacy"
                          : "Meet the approved candidates for the active election."}
                      </p>
                    </div>
                  </div>

                  {/* Stage Pill */}
                  <div
                    className={`inline-flex items-center gap-2.5 self-start rounded-full px-4 py-2 text-xs sm:text-sm font-semibold backdrop-blur-md border shadow-[0_4px_12px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.25)] ${STAGE_BADGES[election.stage].badgeBg}`}
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
                  <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex items-start gap-3.5 shadow-[0_4px_14px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/15 hover:shadow-[0_8px_20px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] flex items-center justify-center flex-shrink-0 text-white/95">
                      <CalendarDays size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-white/70 font-semibold">Date</div>
                      <div className="mt-1 font-semibold text-white text-sm sm:text-base truncate">
                        {formatDateRange(election)}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex items-start gap-3.5 shadow-[0_4px_14px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/15 hover:shadow-[0_8px_20px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] flex items-center justify-center flex-shrink-0 text-white/95">
                      <Clock size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-white/70 font-semibold">Voting window</div>
                      <div className="mt-1 font-semibold text-white text-sm sm:text-base truncate">
                        {formatVotingWindow(election)}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex items-start gap-3.5 shadow-[0_4px_14px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/15 hover:shadow-[0_8px_20px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 transition-all duration-200">
                    <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] flex items-center justify-center flex-shrink-0 text-white/95">
                      <MapPin size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-white/70 font-semibold">Venue</div>
                      <div className="mt-1 font-semibold text-white text-sm sm:text-base truncate">
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
              /* ── Tabbed Interface + Card Grid ───────────────── */
              <div className="space-y-6 sm:space-y-8">
                {/* ── Party List Title & Draggable Tab Bar ───────── */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-1.5 px-1">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase text-[#5C0102]">
                        <Shield size={14} />
                        <span>Political Affiliations</span>
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight mt-0.5">
                        Party List
                      </h2>
                    </div>
                    <span className="text-xs text-gray-400 hidden sm:inline-flex items-center gap-1">
                      Drag horizontally or click a party to view candidates
                    </span>
                  </div>

                  {/* ── Upper Section: Draggable Horizontal Tab Bar ── */}
                  <div
                    ref={tabsContainerRef}
                    className="bg-white/80 backdrop-blur-md rounded-2xl p-2 sm:p-2.5 border border-gray-200/80 shadow-[0_4px_16px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] overflow-hidden cursor-grab active:cursor-grabbing select-none"
                  >
                    <motion.div
                      role="tablist"
                      aria-label="Political Parties and Slates"
                      drag="x"
                      dragConstraints={tabsContainerRef}
                      dragElastic={0.12}
                      className="flex items-center gap-2.5 w-max min-w-full"
                    >
                      {partyGroups.map((group, groupIndex) => {
                        const isSelected = selectedParty === group.name;
                        const theme = getPartyTheme(group.name, groupIndex);
                        const tabId = `tab-${group.name.toLowerCase().replace(/\s+/g, "-")}`;
                        const panelId = `panel-${group.name.toLowerCase().replace(/\s+/g, "-")}`;
                        return (
                          <button
                            key={group.name}
                            id={tabId}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            aria-controls={panelId}
                            onClick={() => setActiveParty(group.name)}
                            style={{
                              background: isSelected ? theme.gradient : undefined,
                              borderBottomColor: isSelected ? "rgba(0,0,0,0.25)" : undefined,
                              boxShadow: isSelected
                                ? `0 6px 16px -2px ${theme.shadowColor}, inset 0 1px 0 rgba(255,255,255,0.35)`
                                : undefined,
                            }}
                            className={`group relative flex items-center gap-2.5 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer flex-shrink-0 ${
                              isSelected
                                ? "text-white scale-[1.02] border-b-[3px]"
                                : "bg-white/60 hover:bg-white text-gray-700 hover:text-gray-950 border border-gray-200/60 shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.8)] hover:shadow-[0_4px_10px_rgba(0,0,0,0.05)] hover:-translate-y-0.5 border-b-[2px] border-b-gray-300"
                            }`}
                          >
                            <Shield
                              size={16}
                              className={
                                isSelected
                                  ? "text-white drop-shadow-sm"
                                  : "text-gray-400 group-hover:text-gray-600 transition-colors"
                              }
                            />
                            <h2
                              className={`text-sm sm:text-base font-bold tracking-tight leading-none ${
                                isSelected ? "text-white" : "text-gray-800"
                              }`}
                            >
                              {group.name}
                            </h2>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
                                isSelected
                                  ? "bg-white/20 text-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]"
                                  : "bg-gray-100 text-gray-600 group-hover:bg-gray-200/70 shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)]"
                              }`}
                            >
                              {group.candidates.length}
                            </span>
                          </button>
                        );
                      })}
                    </motion.div>
                  </div>
                </div>

                {/* ── Lower Section: Candidate Cards Grid ────────── */}
                <div>
                  {partyGroups.map((group, groupIndex) => {
                    const isSelected = selectedParty === group.name;
                    const theme = getPartyTheme(group.name, groupIndex);
                    const tabId = `tab-${group.name.toLowerCase().replace(/\s+/g, "-")}`;
                    const panelId = `panel-${group.name.toLowerCase().replace(/\s+/g, "-")}`;
                    return (
                      <div
                        key={group.name}
                        id={panelId}
                        role="tabpanel"
                        aria-labelledby={tabId}
                        className={isSelected ? "block" : "hidden"}
                      >
                        <div className="space-y-6">
                          {/* Active Party Slate Banner */}
                          <div
                            className="bg-white rounded-3xl border border-gray-200/80 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4 transition-all duration-300"
                            style={{
                              boxShadow: `0 8px 24px -4px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 1)`,
                              borderBottomWidth: "3px",
                              borderBottomColor: theme.badgeBorder,
                            }}
                          >
                            <div className="flex items-center gap-4">
                              <div
                                className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-white shrink-0 border border-white/25"
                                style={{
                                  background: theme.gradient,
                                  boxShadow: `0 6px 16px -2px ${theme.shadowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.4)`,
                                }}
                              >
                                <Users size={24} className="drop-shadow-sm" />
                              </div>
                              <div>
                                <div
                                  className="text-xs font-bold uppercase tracking-wider"
                                  style={{ color: theme.primary }}
                                >
                                  Party Slate
                                </div>
                                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                                  {group.name}
                                </h3>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs sm:text-sm font-bold rounded-full px-4 py-1.5 border transition-all"
                                style={{
                                  backgroundColor: theme.badgeBg,
                                  color: theme.badgeText,
                                  borderColor: theme.badgeBorder,
                                  borderBottomWidth: "2px",
                                  boxShadow: `0 2px 6px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.7)`,
                                }}
                              >
                                {group.candidates.length} Official Candidate{group.candidates.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          </div>

                          {/* Candidate Cards Grid */}
                          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {group.candidates.map((candidate, candidateIndex) => (
                              <motion.article
                                key={`${group.name}-${candidate.id}`}
                                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                                animate={
                                  isSelected
                                    ? { opacity: 1, y: 0, scale: 1 }
                                    : { opacity: 0, y: 18, scale: 0.96 }
                                }
                                transition={{
                                  duration: 0.38,
                                  delay: isSelected ? Math.min(candidateIndex * 0.045, 0.36) : 0,
                                  ease: [0.22, 1, 0.36, 1],
                                }}
                                whileHover={{
                                  y: -6,
                                  transition: { duration: 0.2, ease: "easeOut" },
                                }}
                                className="group relative rounded-3xl border border-gray-200/90 p-5 sm:p-6 flex flex-col justify-between overflow-hidden transition-all duration-300 cursor-default select-none hover:shadow-xl"
                                style={{
                                  background: theme.cardBg,
                                  boxShadow: `0 4px 14px -2px rgba(0, 0, 0, 0.05), 0 2px 6px -1px rgba(0, 0, 0, 0.02), inset 0 1px 0 rgba(255, 255, 255, 1)`,
                                  borderBottomWidth: "3.5px",
                                  borderBottomColor: theme.badgeBorder,
                                }}
                              >
                                {/* Card Bottom Accent on hover */}
                                <div
                                  className="absolute inset-x-0 bottom-0 h-1.5 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:h-2"
                                  style={{
                                    background: theme.gradient,
                                    boxShadow: `0 -2px 12px ${theme.shadowColor}`,
                                  }}
                                />

                                <div>
                                  {/* Avatar & Info Header */}
                                  <div className="flex items-start gap-4">
                                    {candidate.picture ? (
                                      <div className="relative flex-shrink-0">
                                        <img
                                          src={candidate.picture}
                                          alt={candidate.name}
                                          className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl object-cover ring-2 ring-white border border-gray-200/70 transition-transform duration-300 group-hover:scale-105"
                                          style={{
                                            boxShadow: `0 4px 12px rgba(0, 0, 0, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.8)`,
                                            borderColor: theme.badgeBorder,
                                          }}
                                        />
                                      </div>
                                    ) : (
                                      <div
                                        className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl border flex items-center justify-center flex-shrink-0 text-gray-400 group-hover:text-gray-700 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)] group-hover:scale-105"
                                        style={{
                                          background: "linear-gradient(135deg, #ffffff 0%, rgba(243, 244, 246, 0.9) 100%)",
                                          borderColor: "rgba(229, 231, 235, 0.9)",
                                        }}
                                      >
                                        <UserRound size={28} />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1 pt-0.5">
                                      <div
                                        className="inline-block px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide uppercase mb-1.5 border shadow-[0_1px_3px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.8)]"
                                        style={{
                                          backgroundColor: theme.badgeBg,
                                          color: theme.badgeText,
                                          borderColor: theme.badgeBorder,
                                          borderBottomWidth: "2px",
                                        }}
                                      >
                                        {candidate.position}
                                      </div>
                                      <h4
                                        className="font-bold text-gray-900 transition-colors duration-200 text-sm sm:text-[15px] leading-snug break-words group-hover:text-gray-950"
                                        title={candidate.name}
                                      >
                                        {candidate.name}
                                      </h4>
                                    </div>
                                  </div>
                                </div>

                                {/* Candidate Meta info */}
                                <div className="mt-5 pt-4 border-t border-gray-100/90 text-xs sm:text-sm text-gray-500 space-y-2">
                                  <div className="flex items-center justify-between gap-3 bg-white/70 px-3 py-1.5 rounded-xl border border-gray-200/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)]">
                                    <span className="flex items-center gap-1.5 text-gray-400 font-medium">
                                      <Shield size={14} />
                                      Party
                                    </span>
                                    <span className="text-gray-900 font-bold text-right truncate">
                                      {candidate.partyAffiliation || "Independent"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3 bg-white/70 px-3 py-1.5 rounded-xl border border-gray-200/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)]">
                                    <span className="flex items-center gap-1.5 text-gray-400 font-medium">
                                      <GraduationCap size={14} />
                                      Grade Level
                                    </span>
                                    <span className="text-gray-900 font-bold">
                                      {candidate.gradeLevel}
                                    </span>
                                  </div>
                                </div>
                              </motion.article>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
