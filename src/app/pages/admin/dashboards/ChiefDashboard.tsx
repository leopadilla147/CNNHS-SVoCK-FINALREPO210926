import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { motion } from "motion/react";
import {
  Users,
  TrendingUp,
  Clock,
  Eye,
  Activity,
  AlertCircle,
  Shield,
  ArrowUpRight,
  Sparkles,
  FileText,
} from "lucide-react";
import { useApp, type CommissionerRole } from "../../../context/AppContext";
import { listStaffRosterRpc, type StaffRosterRow } from "../../../lib/supabaseData";
import { useReportImages } from "../../../lib/reportImages";

// adminprofiles officer roles (035): chief + the three commissioner roles.
const TOTAL_OFFICER_ROLES = 4;

export default function ChiefDashboard() {
  const {
    students,
    candidates,
    complaints,
    electionPeriod,
    logs,
    currentUser,
  } = useApp();

  const approvedStudents = students.filter((s) => s.status === "approved").length;
  const pendingStudents = students.filter((s) => s.status === "pending").length;
  const totalVotes = candidates
    .filter((c) => c.status === "approved")
    .reduce((sum, c) => sum + c.votes, 0);

  // 046/068: the officer roster is read through the chief-gated
  // list_staff_roster_rpc.  fetchSupabaseState always returns an empty
  // commissioners array (037 dropped that table), so without this fetch the
  // KPI stat, the missing-role callout and the registration progress bar
  // were all stuck at zero.  Only the Chief reaches this component
  // (AdminDashboard routes on commissionerRole), so the chief-gated RPC is
  // safe to call here.
  const [roster, setRoster] = useState<StaffRosterRow[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listStaffRosterRpc()
      .then((rows) => { if (!cancelled) setRoster(rows); })
      // Degrade to zeroes — the dashboard stays usable without the roster.
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setRosterLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const allCommissionerRoles: CommissionerRole[] = [
    "screening_validation",
    "electoral_board",
    "grievance",
  ];
  const activeCommissioners = roster.filter(
    (r) => (r.role_type === "commissioner" || r.role_type === "co_commissioner") && r.status === "active"
  );
  const appointedRoles = new Set(
    activeCommissioners
      .map((r) => r.commissioner_role)
      .filter((role): role is CommissionerRole => role != null)
  );
  // Held at zero until the roster resolves so the callout never flashes
  // "unappointed" on a fresh load.
  const missingCommissioners = rosterLoaded
    ? allCommissionerRoles.filter((r) => !appointedRoles.has(r)).length
    : 0;
  // The Chief's own row is always present, so it counts toward the
  // appointed officer total once the roster has resolved.
  const appointedOfficerCount = activeCommissioners.length + (rosterLoaded ? 1 : 0);
  const openComplaints = complaints.filter((c) => c.status === "filed").length;

  const activityData = Array.from(
    logs.reduce((map, log) => {
      const day = log.timestamp.slice(5, 10) || "Today";
      const entry = map.get(day) || { day, logins: 0, registrations: 0 };
      if (log.action.toLowerCase().includes("login")) entry.logins += 1;
      if (log.action.toLowerCase().includes("registration")) entry.registrations += 1;
      map.set(day, entry);
      return map;
    }, new Map<string, { day: string; logins: number; registrations: number }>())
  ).slice(0, 5);

  const recentLogs = logs.slice(0, 5);

  // Session-only photo documentation shared with the Election Reports page.
  const reportImages = useReportImages();

  const stats = [
    {
      label: "Active Commissioners",
      value: activeCommissioners.length,
      sub: "commissioners & co-commissioners",
      icon: <Users size={20} />,
      color: "#5C0102",
      link: "/admin/officers",
    },
    {
      label: "Total Votes Cast",
      value: totalVotes.toLocaleString(),
      sub: "Across all ballots",
      icon: <TrendingUp size={20} />,
      color: "#8B0103",
      link: "/admin/live-results",
    },
    {
      label: "Live Results Status",
      value: electionPeriod.isActive || electionPeriod.resultsPublished ? "Available" : "Locked",
      sub: electionPeriod.isActive ? "Election active" : "Awaiting opening",
      icon: <Eye size={20} />,
      color:
        electionPeriod.isActive || electionPeriod.resultsPublished ? "#059669" : "#64748B",
      link: "/admin/live-results",
    },
  ];

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Banner / Command Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-3xl p-6 border border-gray-200/90 shadow-xs"
      >
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-200/70 text-[#5C0102] text-xs font-semibold uppercase tracking-wider mb-2">
            <Shield size={13} className="text-[#5C0102]" />
            <span>Chief Electoral Commissioner</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Commission Command Center
          </h1>
          <p className="text-sm font-semibold text-gray-800 mt-1">{currentUser?.name}</p>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            System overview and supervisory controls for the CNNHS Online Voting & Election System.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-2xl bg-gray-50 border border-gray-200/80 text-right">
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
              Voter Turnout Rate
            </div>
            <div className="text-lg font-extrabold text-gray-900">
              {students.length > 0
                ? `${Math.round((approvedStudents / students.length) * 100)}%`
                : "0%"}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Primary KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((stat, i) => {
          const card = (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              whileHover={{ y: -3, transition: { duration: 0.15 } }}
              className="bg-white rounded-2xl p-5 border border-gray-200/90 shadow-xs hover:border-[#5C0102] hover:shadow-md transition-all group cursor-pointer flex flex-col justify-between h-full"
            >
              <div className="flex items-start justify-between mb-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform"
                  style={{ backgroundColor: stat.color }}
                >
                  {stat.icon}
                </div>
                <ArrowUpRight
                  size={16}
                  className="text-gray-400 group-hover:text-[#5C0102] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <div className="text-2xl font-black text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors">
                  {stat.value}
                </div>
                <div className="text-xs font-bold text-gray-800 mt-1">{stat.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{stat.sub}</div>
              </div>
            </motion.div>
          );
          return stat.link ? (
            <Link key={stat.label} to={stat.link}>
              {card}
            </Link>
          ) : (
            <React.Fragment key={stat.label}>{card}</React.Fragment>
          );
        })}
      </div>

      {/* Chief Commissioner Election Report */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-gray-200/90 shadow-xs p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-[#5C0102] shrink-0">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">Chief Commissioner Election Report</h3>
              <p className="text-gray-500 text-xs sm:text-sm mt-1 max-w-2xl">
                Official LG-COMEA Accomplishment Report for the SSLG Election — open it to read and edit
                the text on the page, print it, download the filled .docx, and attach photo documentation
                that is inserted into the document.
              </p>
              {reportImages.length > 0 && (
                <p className="text-xs font-semibold text-emerald-700 mt-2">
                  {reportImages.length} photo{reportImages.length !== 1 ? "s" : ""} attached this session
                </p>
              )}
            </div>
          </div>
          <Link
            to="/admin/reports"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-semibold transition-all hover:opacity-90 shrink-0"
            style={{ backgroundColor: "#5C0102" }}
          >
            <span>Open Election Report</span>
            <ArrowUpRight size={15} />
          </Link>
        </div>

        {reportImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
            {reportImages.map((image) => (
              <img
                key={image.id}
                src={image.dataUrl}
                alt={image.caption || image.name}
                className="w-16 h-16 rounded-xl object-cover border border-gray-200 bg-gray-50"
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* Pending Actions Required Callout */}
      {(pendingStudents > 0 ||
        missingCommissioners > 0 ||
        openComplaints > 0) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 shadow-xs"
        >
          <div className="flex items-center gap-2 text-amber-900 text-sm font-bold mb-3">
            <Clock size={17} className="text-amber-700" />
            <span>Pending Commission Actions Required</span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {missingCommissioners > 0 && (
              <Link
                to="/admin/officers"
                className="inline-flex items-center gap-1.5 bg-amber-100/90 hover:bg-amber-200/90 text-amber-900 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
              >
                <AlertCircle size={13} />
                <span>{missingCommissioners} commissioner role{missingCommissioners !== 1 ? "s" : ""} unappointed</span>
              </Link>
            )}
            {pendingStudents > 0 && (
              <Link
                to="/admin/students"
                className="inline-flex items-center gap-1.5 bg-amber-100/90 hover:bg-amber-200/90 text-amber-900 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
              >
                <AlertCircle size={13} />
                <span>{pendingStudents} student registration{pendingStudents !== 1 ? "s" : ""} pending review</span>
              </Link>
            )}
            {openComplaints > 0 && (
              <Link
                to="/admin/complaints"
                className="inline-flex items-center gap-1.5 bg-amber-100/90 hover:bg-amber-200/90 text-amber-900 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
              >
                <AlertCircle size={13} />
                <span>{openComplaints} open grievance{openComplaints !== 1 ? "s" : ""} filed</span>
              </Link>
            )}
          </div>
        </motion.div>
      )}

      {/* Analytics Visualizations */}
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6">
          <div className="mb-4">
            <h3 className="font-bold text-gray-900 text-sm">System Traffic</h3>
            <p className="text-gray-400 text-xs mt-0.5">Logins & registrations (last 5 days)</p>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={activityData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  border: "1px solid #e5e7eb",
                }}
              />
              <Line
                type="monotone"
                dataKey="logins"
                stroke="#5C0102"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                isAnimationActive
                animationDuration={1000}
              />
              <Line
                type="monotone"
                dataKey="registrations"
                stroke="#DC2626"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive
                animationDuration={1000}
                strokeDasharray="4 4"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity & Registration Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
              <Activity size={16} className="text-[#5C0102]" />
              <span>Recent Audit Events</span>
            </h3>
            <Link
              to="/admin/logs"
              className="text-xs font-semibold text-[#5C0102] hover:underline flex items-center gap-1"
            >
              <span>View full log</span>
              <ArrowUpRight size={13} />
            </Link>
          </div>

          <div className="space-y-3">
            {recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-gray-50/80 transition-colors text-xs"
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                    log.type === "success"
                      ? "bg-emerald-500"
                      : log.type === "error"
                      ? "bg-red-500"
                      : log.type === "warning"
                      ? "bg-amber-500"
                      : "bg-blue-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 font-bold truncate">{log.action}</div>
                  <div className="text-gray-500 truncate mt-0.5">{log.details}</div>
                  <div className="text-gray-400 text-[10px] mt-0.5">{log.timestamp}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6">
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-4">
            <Users size={16} className="text-[#5C0102]" />
            <span>Student Registration Overview</span>
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                <span className="text-gray-600">Commissioners Appointed</span>
                <span className="font-bold text-gray-900">
                  {appointedOfficerCount}/{TOTAL_OFFICER_ROLES}
                </span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-1000"
                  style={{
                    width: `${Math.min(
                      100,
                      (appointedOfficerCount / TOTAL_OFFICER_ROLES) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {[
              {
                label: "Approved Voters",
                count: students.filter((s) => s.status === "approved").length,
                color: "bg-emerald-500",
              },
              {
                label: "Pending Verification",
                count: students.filter((s) => s.status === "pending").length,
                color: "bg-amber-500",
              },
              {
                label: "Rejected / Blocked",
                count: students.filter((s) => s.status === "rejected").length,
                color: "bg-red-500",
              },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-bold text-gray-900">{item.count}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${item.color}`}
                    style={{
                      width: `${
                        students.length > 0 ? (item.count / students.length) * 100 : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            ))}

            <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
              <span className="text-gray-500">Total Registered Students</span>
              <span className="font-black text-gray-900 text-sm">{students.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
