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
  ListChecks,
  Monitor,
  Search,
  Users,
  UserCheck,
  UserX,
  MinusCircle,
} from "lucide-react";
import { buildVoterRows, type VoteListRow } from "../../../lib/voterList";
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

/** Voter List status pills. */
const VOTER_FILTERS = [
  { value: "all", label: "All" },
  { value: "voted", label: "Voted" },
  { value: "not-voted", label: "Not Voted" },
] as const;

type VoterFilter = (typeof VOTER_FILTERS)[number]["value"];

/** Compact "Voted At" cell text; "—" for not-voted rows. */
function formatVotedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ElectoralDashboard() {
  const { electionPeriod, students } = useApp();

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

  // Raw votes rows for the active period — shared by the turnout snapshot
  // above and the Voter List below. One lightweight select (RLS lets staff
  // read votes); soft-fail keeps the previous rows, mirroring Live Results.
  const [voteRows, setVoteRows] = useState<VoteListRow[]>([]);

  useEffect(() => {
    const periodId = electionPeriod.id;
    if (!periodId) return;

    let cancelled = false;

    const loadVotes = async () => {
      const { data, error } = await supabase!
        .from("votes")
        .select("voter_id, abstained, kiosk_id, transaction_id, voted_at")
        .eq("election_period_id", periodId);
      if (cancelled || error || !data) return;
      setVoteRows(data as VoteListRow[]);
    };

    loadVotes();
    const timer = setInterval(loadVotes, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [electionPeriod.id]);

  // Same formula as the DB's approved_voters turnout (033): a voter counts
  // once even when every position row is an abstain.
  const turnout = useMemo(() => {
    const voted = new Set(voteRows.map((v) => v.voter_id)).size;
    return {
      voted,
      notVoted: Math.max(0, approvedVoters - voted),
      abstains: voteRows.filter((v) => v.abstained).length,
    };
  }, [voteRows, approvedVoters]);

  const turnoutStats: Stat[] = [
    { label: "Total Voters", value: approvedVoters.toLocaleString(), sub: "Approved student voters", icon: <Users size={20} />, color: "#8B0103" },
    { label: "Voted", value: turnout.voted.toLocaleString(), sub: `${pct(turnout.voted, approvedVoters)}% turnout`, icon: <UserCheck size={20} />, color: "#22C55E" },
    { label: "Not Voted", value: turnout.notVoted.toLocaleString(), sub: `${pct(turnout.notVoted, approvedVoters)}% of voters`, icon: <UserX size={20} />, color: "#EF4444" },
    { label: "Abstains", value: turnout.abstains.toLocaleString(), sub: "Across all positions", icon: <MinusCircle size={20} />, color: "#EAB308" },
  ];

  // ---- Voter List (search + voted/not-voted pills + kiosk dropdown) ----
  const [voterSearch, setVoterSearch] = useState("");
  const [voterFilter, setVoterFilter] = useState<VoterFilter>("all");
  const [kioskFilter, setKioskFilter] = useState("all");

  const approvedStudents = useMemo(
    () => students.filter((s) => s.status === "approved"),
    [students],
  );

  const voterRows = useMemo(
    () => buildVoterRows(approvedStudents, voteRows),
    [approvedStudents, voteRows],
  );

  // Per-kiosk voter counts (distinct students per kiosk label), in numeric
  // order ("Kiosk 2" before "Kiosk 10"; "Unknown" last).
  const kioskCounts = useMemo(() => {
    const votersByKiosk = new Map<string, Set<string>>();
    for (const row of voterRows) {
      if (!row.voted || !row.kioskLabel) continue;
      let voters = votersByKiosk.get(row.kioskLabel);
      if (!voters) {
        voters = new Set();
        votersByKiosk.set(row.kioskLabel, voters);
      }
      voters.add(row.student.id);
    }
    return [...votersByKiosk.entries()]
      .map(([label, voters]) => ({ label, count: voters.size }))
      .sort((a, b) => {
        const na = parseInt(a.label.replace(/\D+/g, ""), 10);
        const nb = parseInt(b.label.replace(/\D+/g, ""), 10);
        const va = Number.isNaN(na) ? Number.MAX_SAFE_INTEGER : na;
        const vb = Number.isNaN(nb) ? Number.MAX_SAFE_INTEGER : nb;
        return va - vb || a.label.localeCompare(b.label);
      });
  }, [voterRows]);

  // Dropdown options = the same kiosk labels as the turnout cards above.
  const kioskOptions = useMemo(() => kioskCounts.map((k) => k.label), [kioskCounts]);

  // Kiosk turnout cards (between the stat cards and Live Results).
  const kioskStats: Stat[] = kioskCounts.map((k) => ({
    label: k.label,
    value: k.count.toLocaleString(),
    icon: <Monitor size={20} />,
    color: "#3B82F6",
    sub: `${pct(k.count, approvedVoters)}% turnout`,
  }));

  const filteredVoters = useMemo(() => {
    const q = voterSearch.trim().toLowerCase();
    return voterRows.filter((row) => {
      const matchSearch =
        !q ||
        `${row.student.firstName} ${row.student.lastName} ${row.student.lrn}`
          .toLowerCase()
          .includes(q);
      const matchStatus =
        voterFilter === "all" || (voterFilter === "voted" ? row.voted : !row.voted);
      // Only voted students were physically at a kiosk.
      const matchKiosk =
        kioskFilter === "all" || (row.voted && row.kioskLabel === kioskFilter);
      return matchSearch && matchStatus && matchKiosk;
    });
  }, [voterRows, voterSearch, voterFilter, kioskFilter]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Electoral Board Dashboard</h1>
      </motion.div>

      {/* Election Stage announcement */}
      <ElectionStageBanner className="mb-8" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <StatCard key={stat.label} stat={stat} index={i} />
        ))}
      </div>

      {/* Per-kiosk turnout — how many students voted on each kiosk (K1, K2, ...) */}
      {kioskStats.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {kioskStats.map((stat, i) => (
            <StatCard key={stat.label} stat={stat} index={i} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6 text-sm text-gray-400">
          Kiosk turnout will appear here once students start voting.
        </div>
      )}

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

      {/* Voter List — who has voted, who hasn't, and which kiosk (K1/K2) each ballot was cast on */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="flex items-center justify-between p-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#5C0102" }}>
              <ListChecks size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Voter List</div>
              <div className="text-xs text-gray-500">Voted / not voted per student and the kiosk each ballot was cast on</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-gray-900">
              {turnout.voted.toLocaleString()}
              <span className="text-gray-400 text-sm font-medium"> / {approvedVoters.toLocaleString()}</span>
            </div>
            <div className="text-[11px] text-gray-400">students voted</div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-5 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or LRN..."
                value={voterSearch}
                onChange={(e) => setVoterSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {VOTER_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setVoterFilter(f.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${voterFilter === f.value ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  style={voterFilter === f.value ? { backgroundColor: "#5C0102" } : {}}
                >
                  {f.label}
                </button>
              ))}
              <select
                value={kioskFilter}
                onChange={(e) => setKioskFilter(e.target.value)}
                className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
              >
                <option value="all">All Kiosks</option>
                {kioskOptions.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#FFF5F5" }}>
                <th className="text-left py-3 px-5 text-xs font-medium text-gray-500">Student</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">LRN</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Grade</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Kiosk</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Voted At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredVoters.map((row) => (
                <tr key={row.student.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-5">
                    <div className="flex items-center gap-2">
                      {row.student.profilePictureUrl ? (
                        <img src={row.student.profilePictureUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: "#5C0102" }}>
                          {row.student.firstName.charAt(0)}{row.student.lastName.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-gray-900">
                          {row.student.firstName} {row.student.middleName ? row.student.middleName + " " : ""}{row.student.lastName}
                        </div>
                        <div className="text-xs text-gray-400">{row.student.email || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600 font-mono text-xs">{row.student.lrn}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{row.student.gradeLevel}</td>
                  <td className="py-3 px-4">
                    {row.voted ? (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1 w-fit">
                        <UserCheck size={11} /> Voted
                      </span>
                    ) : (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium flex items-center gap-1 w-fit">
                        <UserX size={11} /> Not Voted
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {row.voted && row.kioskLabel ? (
                      row.kioskLabel === "Unknown" ? (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 font-medium">Unknown</span>
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">{row.kioskLabel}</span>
                      )
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{formatVotedAt(row.votedAt)}</td>
                </tr>
              ))}
              {filteredVoters.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                    No students match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Showing {filteredVoters.length.toLocaleString()} of {voterRows.length.toLocaleString()} approved students
        </div>
      </section>
    </div>
  );
}
