import { motion } from "motion/react";
import { Link } from "react-router";
import { useApp } from "../../../context/AppContext";
import { complaintsForElection, formatSubmittedAt } from "../../../lib/complaints";
import { AlertCircle, CheckCircle, HelpCircle, Activity, Clock, ArrowRight } from "lucide-react";
import ElectionStageBanner from "../../../components/ElectionStageBanner";

export default function GrievanceDashboard() {
  const { complaints, electionPeriod } = useApp();

  // 089: complaints stay with the election they were filed under — the
  // dashboard counts only the current election's rows.
  const electionComplaints = complaintsForElection(complaints, electionPeriod.id);

  const filedComplaints = electionComplaints.filter((c) => c.status === "filed").length;
  const unresolved = electionComplaints
    .filter((c) => c.status === "filed")
    .sort((a, b) => {
      const av = a.submittedAtExact ?? a.submittedAt;
      const bv = b.submittedAtExact ?? b.submittedAt;
      return av < bv ? 1 : av > bv ? -1 : 0;
    });
  const acceptedComplaints = electionComplaints.filter((c) => c.status === "accepted").length;

  const stats = [
    { label: "Total Complaints", value: electionComplaints.length, icon: <HelpCircle size={20} />, color: "#5C0102", link: "/admin/complaints" },
    { label: "Filed Complaints", value: filedComplaints, icon: <AlertCircle size={20} />, color: "#EF4444", link: "/admin/complaints?filter=filed" },
    { label: "Resolved", value: acceptedComplaints, icon: <Activity size={20} />, color: "#22C55E", link: "/admin/complaints?filter=accepted" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Commissioner of Grievance Dashboard</h1>
      </motion.div>

      {/* Election Stage announcement */}
      <ElectionStageBanner className="mb-6" />

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

      {/* Unresolved complaints — the Commissioner's working queue.  Rows and
          the header link deep-link into the Complaints tab Filed filter. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-8">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-900">Unresolved Complaints</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${unresolved.length > 0 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
              {unresolved.length}
            </span>
          </div>
          <Link to="/admin/complaints?filter=filed" className="text-xs font-medium hover:underline" style={{ color: "#5C0102" }}>
            View all
          </Link>
        </div>
        {unresolved.length > 0 ? (
          <div className="space-y-2">
            {unresolved.map((complaint) => (
              <Link
                key={complaint.id}
                to="/admin/complaints?filter=filed"
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{complaint.subject}</div>
                  <div className="text-xs text-gray-500">From {complaint.studentName} · Filed {formatSubmittedAt(complaint)}</div>
                </div>
                <ArrowRight size={16} className="text-gray-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
            <CheckCircle size={16} className="text-green-500" /> No unresolved complaints — everything is handled.
          </div>
        )}
      </div>
    </div>
  );
}
