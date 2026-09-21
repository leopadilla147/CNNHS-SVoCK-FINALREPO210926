import React from "react";
import { Link } from "react-router";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from "recharts";
import { motion } from "motion/react";
import { Users, GraduationCap, Trophy, Activity, TrendingUp, Clock, Eye } from "lucide-react";
import { useApp, type CommissionerRole } from "../../../context/AppContext";

const COLORS = ["#5C0102", "#8B0103", "#B91C1C", "#DC2626", "#EF4444", "#F87171"];

export default function ChiefDashboard() {
  const {
    students, candidates, commissioners,
    complaints, electionPeriod, logs,
  } = useApp();

  const approvedStudents = students.filter((s) => s.status === "approved").length;
  const pendingStudents = students.filter((s) => s.status === "pending").length;
  const approvedCandidates = candidates.filter((c) => c.status === "approved").length;
  const pendingCandidates = candidates.filter((c) => c.status === "pending").length;
  const totalVotes = candidates.filter((c) => c.status === "approved").reduce((sum, c) => sum + c.votes, 0);
  // Phase 3 REMOVE-08: no 'appointment' role — chief + the three live
  // commissioner roles are the full appointment surface.
  const allCommissionerRoles: CommissionerRole[] = ["screening_validation", "electoral_board", "grievance"];
  const appointedRoles = new Set(commissioners.filter((c) => c.status === "active").map((c) => c.role));
  const missingCommissioners = allCommissionerRoles.filter((r) => !appointedRoles.has(r)).length;
  const openComplaints = complaints.filter((c) => c.status === "filed").length;

  const voteData = candidates
    .filter((c) => c.status === "approved")
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 8)
    .map((c) => ({
      name: `${c.givenName.charAt(0)}. ${c.surname}`,
      votes: c.votes,
      position: c.position,
    }));

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

  const activeCommissioners = commissioners.filter((c) => c.status === "active");
  const stats = [
    { label: "Active Commissioners", value: activeCommissioners.length, sub: "of 4 appointment roles", icon: <Users size={20} />, color: "#B91C1C", link: "/admin/officers" },
    { label: "Total Votes Cast", value: totalVotes.toLocaleString(), sub: "Across all positions", icon: <TrendingUp size={20} />, color: "#5C0102", link: "/admin/live-results" },
    { label: "Live Results", value: electionPeriod.isActive || electionPeriod.resultsPublished ? "Available" : "Locked", sub: electionPeriod.isActive ? "Election active" : "Awaiting opening", icon: <Eye size={20} />, color: electionPeriod.isActive || electionPeriod.resultsPublished ? "#10B981" : "#9CA3AF", link: "/admin/live-results" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Chief Commissioner Dashboard</h1>
        <p className="text-gray-500 text-sm">System overview and command center for the CNNHS Online Voting System.</p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => {
          const linkTarget = stat.label === "Total Students" ? "/admin/students" : stat.label === "Total Candidates" ? "/admin/candidates" : null;
          const card = (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${stat.link ? "cursor-pointer hover:shadow-md transition-all" : ""}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: stat.color }}>
                  {stat.icon}
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-0.5">{stat.value}</div>
              <div className="text-xs text-gray-700 font-medium">{stat.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{stat.sub}</div>
            </motion.div>
          );
          return stat.link ? <Link key={stat.label} to={stat.link}>{card}</Link> : <React.Fragment key={stat.label}>{card}</React.Fragment>;
        })}
      </div>

      {(pendingStudents > 0 || pendingCandidates > 0 || missingCommissioners > 0 || openComplaints > 0) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-2">
            <Clock size={16} /> Pending Actions Required
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-amber-700">
            {missingCommissioners > 0 && <span className="bg-amber-100 px-2.5 py-1 rounded-full">{missingCommissioners} commissioner role{missingCommissioners !== 1 ? "s" : ""} not yet appointed</span>}
            {pendingStudents > 0 && <span className="bg-amber-100 px-2.5 py-1 rounded-full">{pendingStudents} student registration{pendingStudents !== 1 ? "s" : ""} awaiting approval</span>}
            {pendingCandidates > 0 && <span className="bg-amber-100 px-2.5 py-1 rounded-full">{pendingCandidates} candidacy application{pendingCandidates !== 1 ? "s" : ""} awaiting approval</span>}
            {openComplaints > 0 && <span className="bg-amber-100 px-2.5 py-1 rounded-full">{openComplaints} open complaint{openComplaints !== 1 ? "s" : ""} awaiting decision</span>}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-1 text-sm">Vote Distribution</h3>
          <p className="text-gray-400 text-xs mb-4">Top candidates by vote count</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={voteData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(val, _, props) => [val, props.payload.position]} />
              <Bar dataKey="votes" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={1200}>
                {voteData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-1 text-sm">System Activity</h3>
          <p className="text-gray-400 text-xs mb-4">Logins & registrations (last 5 days)</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={activityData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="logins" stroke="#5C0102" strokeWidth={2} dot={{ r: 3 }} isAnimationActive animationDuration={1200} />
              <Line type="monotone" dataKey="registrations" stroke="#DC2626" strokeWidth={2} dot={{ r: 3 }} isAnimationActive animationDuration={1200} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-4 text-sm flex items-center gap-2">
            <Activity size={16} style={{ color: "#5C0102" }} /> Recent System Activity
          </h3>
          <div className="space-y-3">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 text-xs">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${log.type === "success" ? "bg-green-500" : log.type === "error" ? "bg-red-500" : log.type === "warning" ? "bg-amber-500" : "bg-blue-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 font-medium truncate">{log.action}</div>
                  <div className="text-gray-400 truncate">{log.details}</div>
                  <div className="text-gray-300 mt-0.5">{log.timestamp}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-4 text-sm flex items-center gap-2">
            <Users size={16} style={{ color: "#5C0102" }} /> Student Registration Overview
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600">Commissioners Appointed</span>
                <span className="font-bold text-gray-900">{commissioners.filter((c) => c.status === "active").length}/4</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all duration-1000" style={{ width: `${Math.min(100, (commissioners.filter((c) => c.status === "active").length / 4) * 100)}%` }} />
              </div>
            </div>
            {[
              { label: "Approved", count: students.filter((s) => s.status === "approved").length, color: "bg-green-500" },
              { label: "Pending", count: students.filter((s) => s.status === "pending").length, color: "bg-amber-500" },
              { label: "Rejected", count: students.filter((s) => s.status === "rejected").length, color: "bg-red-500" },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-bold text-gray-900">{item.count}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${item.color}`} style={{ width: `${students.length > 0 ? (item.count / students.length) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Total Registered</span>
                <span className="font-bold text-gray-900">{students.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
