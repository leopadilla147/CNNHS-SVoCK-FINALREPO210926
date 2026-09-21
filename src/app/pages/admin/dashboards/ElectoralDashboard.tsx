import { motion } from "motion/react";
import { Link } from "react-router";
import { useApp } from "../../../context/AppContext";
import { Calendar, BarChart2, Activity, Clock, CheckCircle, XCircle, ArrowRight, Play, Square, Trophy } from "lucide-react";

export default function ElectoralDashboard() {
  const { electionPeriod, candidates, setElectionPeriod } = useApp();

  const approvedCandidates = candidates.filter((c) => c.status === "approved").length;

  const stats = [
    { label: "Election Status", value: electionPeriod.isActive ? "Active" : "Inactive", icon: <Activity size={20} />, color: electionPeriod.isActive ? "#22C55E" : "#9CA3AF" },
    { label: "Approved Candidates", value: approvedCandidates, icon: <BarChart2 size={20} />, color: "#5C0102", link: "/admin/candidates" },
    { label: "Candidacy Open", value: electionPeriod.candidacyOpen ? "Yes" : "No", icon: <CheckCircle size={20} />, color: electionPeriod.candidacyOpen ? "#22C55E" : "#EF4444" },
    { label: "Results Published", value: electionPeriod.resultsPublished ? "Yes" : "No", icon: <Calendar size={20} />, color: electionPeriod.resultsPublished ? "#22C55E" : "#9CA3AF" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Electoral Board Dashboard</h1>
        <p className="text-gray-500 text-sm">Manage election periods and oversee the voting process.</p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => {
          const card = (
            <motion.div
              key={stat.label}
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
            </motion.div>
          );
          return stat.link ? <Link key={stat.label} to={stat.link}>{card}</Link> : card;
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <a href="/admin/campaign-calendar"
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center justify-between group">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#5C0102" }}>
              <Calendar size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Campaign Calendar</div>
              <div className="text-xs text-gray-500">Manage dates and proclamation</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
        </a>

        <a href="/admin/election"
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center justify-between group">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#22C55E" }}>
              <BarChart2 size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Election Setup</div>
              <div className="text-xs text-gray-500">Configure dates, venue, and periods</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
        </a>

        <a href="/admin/live-results"
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center justify-between group">
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
        </a>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={() => setElectionPeriod({ ...electionPeriod, candidacyOpen: !electionPeriod.candidacyOpen })}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 ${
            electionPeriod.candidacyOpen
              ? "bg-amber-100 text-amber-700 border border-amber-200"
              : "text-white"
          }`}
          style={!electionPeriod.candidacyOpen ? { backgroundColor: "#5C0102" } : {}}
        >
          {electionPeriod.candidacyOpen ? "Close Candidacy" : "Open Candidacy"}
        </button>
        <button
          onClick={() => setElectionPeriod({ ...electionPeriod, isActive: !electionPeriod.isActive })}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 ${
            electionPeriod.isActive
              ? "bg-red-100 text-red-700 border border-red-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {electionPeriod.isActive ? <Square size={16} /> : <Play size={16} />}
          {electionPeriod.isActive ? "End Voting" : "Start Voting"}
        </button>
        <button
          onClick={() => setElectionPeriod({ ...electionPeriod, resultsPublished: !electionPeriod.resultsPublished })}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 ${
            electionPeriod.resultsPublished
              ? "bg-green-100 text-green-700 border border-green-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          <CheckCircle size={16} />
          {electionPeriod.resultsPublished ? "Results Published" : "Publish Results"}
        </button>
      </div>

      {electionPeriod.startDate && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="text-gray-900 text-sm mb-3">Current Election Schedule</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Start:</span>
              <p className="font-medium">{electionPeriod.startDate} {electionPeriod.startTime}</p>
            </div>
            <div>
              <span className="text-gray-500">End:</span>
              <p className="font-medium">{electionPeriod.endDate} {electionPeriod.endTime}</p>
            </div>
            <div>
              <span className="text-gray-500">Venue:</span>
              <p className="font-medium">{electionPeriod.venue || "Not set"}</p>
            </div>
            <div>
              <span className="text-gray-500">Candidacy Period:</span>
              <p className="font-medium">{electionPeriod.candidacyOpen ? "Open" : "Closed"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
