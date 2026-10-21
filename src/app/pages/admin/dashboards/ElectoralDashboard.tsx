import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Link } from "react-router";
import { useApp } from "../../../context/AppContext";
import ElectionStageBanner from "../../../components/ElectionStageBanner";
import { supabase } from "../../../lib/supabase";
import {
  Calendar,
  Activity,
  CheckCircle,
  ArrowRight,
  Trophy,
  Fingerprint,
  Users,
  UserCheck,
  UserX,
  MinusCircle,
} from "lucide-react";
import type { ReactNode } from "react";

/** A period timestamp as a Date, or null when it is absent/unparseable. */
function parseFpDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatFpDate(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Short fingerprint registration status for the dashboard stat card. */
function fingerprintStatus(startAt?: string, endAt?: string): { value: string; detail: string; color: string } {
  const start = parseFpDate(startAt);
  const end = parseFpDate(endAt);
  const now = Date.now();
  if (start && now >= start.getTime() && (!end || now < end.getTime())) {
    return { value: "Open", detail: end ? `Open until ${formatFpDate(end)}` : "Registration is open", color: "#22C55E" };
  }
  if (start && now < start.getTime()) {
    return { value: "Scheduled", detail: `Starts ${formatFpDate(start)}`, color: "#3B82F6" };
  }
  if (end && now >= end.getTime()) {
    return { value: "Closed", detail: "Registration has closed", color: "#EF4444" };
  }
  return { value: "Not Set", detail: "Schedule it in Election Setup", color: "#9CA3AF" };
}

/** One decimal place, e.g. "82.4". */
function pct(part: number, whole: number): string {
  if (whole <= 0) return "0.0";
  return (Math.round((part / whole) * 1000) / 10).toFixed(1);
}

type Stat = {
  label: string;
  value: string;
  icon: ReactNode;
  color: string;
  /** Hover tooltip (used by the fingerprint card for the full schedule). */
  detail?: string;
  /** Small sub-line under the label, e.g. a percentage. */
  sub?: string;
  /** When set, the whole card becomes a link. */
  to?: string;
};

function StatCard({ stat, index }: { stat: Stat; index: number }) {
  const card = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      title={stat.detail}
      className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 h-full${stat.to ? " hover:shadow-md transition-shadow" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: stat.color }}>
          {stat.icon}
        </div>
        {stat.to && <ArrowRight size={16} className="text-gray-300" />}
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-0.5">{stat.value}</div>
      <div className="text-xs text-gray-700 font-medium">{stat.label}</div>
      {stat.sub && <div className="text-[11px] text-gray-400 mt-1">{stat.sub}</div>}
    </motion.div>
  );
  return stat.to ? (
    <Link to={stat.to} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}

/** Per-position abstain rows share these shapes with the votes table (018). */
interface VoteRow {
  voter_id: string;
  abstained: boolean;
}

export default function ElectoralDashboard() {
  const { electionPeriod, currentUser, students } = useApp();

  const fp = fingerprintStatus(electionPeriod.fingerprintRegistrationStartAt, electionPeriod.fingerprintRegistrationEndAt);

  const stats: Stat[] = [
    { label: "Election Status", value: electionPeriod.isActive ? "Active" : "Inactive", icon: <Activity size={20} />, color: electionPeriod.isActive ? "#22C55E" : "#9CA3AF" },
    { label: "Candidacy Open", value: electionPeriod.candidacyOpen ? "Yes" : "Closed", icon: <CheckCircle size={20} />, color: electionPeriod.candidacyOpen ? "#22C55E" : "#EF4444" },
    { label: "Results Published", value: electionPeriod.resultsPublished ? "Published" : "Unpublished", icon: <Calendar size={20} />, color: electionPeriod.resultsPublished ? "#22C55E" : "#9CA3AF" },
    { label: "Fingerprint Registration", value: fp.value, icon: <Fingerprint size={20} />, color: fp.color, detail: fp.detail, to: "/admin/election" },
  ];

  // "Voters" are approved students — same formula as the DB's approved_voters (033).
  const approvedVoters = useMemo(
    () => students.filter((s) => s.status === "approved").length,
    [students],
  );

  const [turnout, setTurnout] = useState({ voted: 0, notVoted: 0, abstains: 0 });

  // One lightweight select covers all turnout counts (RLS lets staff read votes).
  // Soft-fail keeps the previous values, mirroring the Live Results pattern.
  useEffect(() => {
    const periodId = electionPeriod.id;
    if (!periodId) return;

    let cancelled = false;

    const loadTurnout = async () => {
      const { data, error } = await supabase!
        .from("votes")
        .select("voter_id, abstained")
        .eq("election_period_id", periodId);
      if (cancelled || error || !data) return;
      const rows = data as VoteRow[];
      const votedVoters = new Set(rows.map((v) => v.voter_id)).size;
      setTurnout({
        voted: votedVoters,
        notVoted: Math.max(0, approvedVoters - votedVoters),
        abstains: rows.filter((v) => v.abstained).length,
      });
    };

    loadTurnout();
    const timer = setInterval(loadTurnout, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [electionPeriod.id, approvedVoters]);

  const turnoutStats: Stat[] = [
    { label: "Total Voters", value: approvedVoters.toLocaleString(), sub: "Approved student voters", icon: <Users size={20} />, color: "#8B0103" },
    { label: "Voted", value: turnout.voted.toLocaleString(), sub: `${pct(turnout.voted, approvedVoters)}% turnout`, icon: <UserCheck size={20} />, color: "#22C55E" },
    { label: "Not Voted", value: turnout.notVoted.toLocaleString(), sub: `${pct(turnout.notVoted, approvedVoters)}% of voters`, icon: <UserX size={20} />, color: "#EF4444" },
    { label: "Abstains", value: turnout.abstains.toLocaleString(), sub: "Across all positions", icon: <MinusCircle size={20} />, color: "#EAB308" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Electoral Board Dashboard</h1>
        <p className="text-gray-800 text-sm font-semibold">{currentUser?.name}</p>
        <p className="text-gray-500 text-sm">Manage election periods and oversee the voting process.</p>
      </motion.div>

      {/* Election Stage announcement */}
      <ElectionStageBanner className="mb-8" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <StatCard key={stat.label} stat={stat} index={i} />
        ))}
      </div>

      {/* Live Results with a voter turnout snapshot */}
      <Link
        to="/admin/live-results"
        className="block bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow group mb-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#EAB308" }}>
              <Trophy size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Live Results</div>
              <div className="text-xs text-gray-500">Monitor real-time vote counts</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {turnoutStats.map((stat) => (
            <div key={stat.label} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white mb-2" style={{ backgroundColor: stat.color }}>
                {stat.icon}
              </div>
              <div className="text-xl font-bold text-gray-900 mb-0.5">{stat.value}</div>
              <div className="text-xs text-gray-700 font-medium">{stat.label}</div>
              {stat.sub && <div className="text-[11px] text-gray-400 mt-0.5">{stat.sub}</div>}
            </div>
          ))}
        </div>
      </Link>
    </div>
  );
}
