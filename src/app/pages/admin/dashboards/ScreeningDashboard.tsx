import { motion } from "motion/react";
import { Link } from "react-router";
import { useApp } from "../../../context/AppContext";
import { ClipboardList, Trophy, Archive, Activity, Clock, ArrowRight, Send, CheckCircle } from "lucide-react";
import ElectionStageBanner from "../../../components/ElectionStageBanner";

export default function ScreeningDashboard() {
  const { candidates, electionPeriod } = useApp();

  const pendingCandidates = candidates.filter((c) => c.status === "pending").length;
  const approvedCandidates = candidates.filter((c) => c.status === "approved").length;

  const stats = [
    { label: "Pending Review", value: pendingCandidates, icon: <ClipboardList size={20} />, color: "#EAB308", link: "/admin/candidates?filter=pending" },
    { label: "Approved", value: approvedCandidates, icon: <Trophy size={20} />, color: "#22C55E", link: "/admin/candidates?filter=approved" },
    { label: "Total Applications", value: candidates.length, icon: <Activity size={20} />, color: "#5C0102", link: "/admin/candidates" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Screening & Validation Dashboard</h1>
      </motion.div>

      {/* Election Stage announcement */}
      <ElectionStageBanner className="mb-6" />

      {pendingCandidates > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6">
          <Link
            to="/admin/candidates?filter=pending"
            className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-2 text-amber-800 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            <Clock size={16} /> {pendingCandidates} candidate application(s) pending your review
          </Link>
        </motion.div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <a href="/admin/screening-checklist"
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center justify-between group">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#5C0102" }}>
              <ClipboardList size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Screening Checklist</div>
              <div className="text-xs text-gray-500">Review pending candidates with document checklist</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
        </a>

        <a href="/admin/candidates"
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center justify-between group">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#22C55E" }}>
              <Trophy size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Candidates Review</div>
              <div className="text-xs text-gray-500">Full candidate management view</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
        </a>
      </div>

      {!electionPeriod.candidacyOpen && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <div className="flex items-center gap-2 text-blue-700 text-sm">
            <Archive size={16} /> Candidacy applications are currently closed. Waiting for Electoral Board to open the period.
          </div>
        </div>
      )}
    </div>
  );
}
