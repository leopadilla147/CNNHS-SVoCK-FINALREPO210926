import { motion } from "motion/react";
import { Link } from "react-router";
import { useApp } from "../../../context/AppContext";
import { AlertCircle, HelpCircle, Activity, Clock, ArrowRight, Calendar } from "lucide-react";

export default function GrievanceDashboard() {
  const { complaints } = useApp();

  const filedComplaints = complaints.filter((c) => c.status === "filed").length;
  const acceptedComplaints = complaints.filter((c) => c.status === "accepted").length;

  const stats = [
    { label: "Filed Complaints", value: filedComplaints, icon: <AlertCircle size={20} />, color: "#EF4444", link: "/admin/complaints" },
    { label: "Accepted", value: acceptedComplaints, icon: <Activity size={20} />, color: "#22C55E", link: "/admin/complaints" },
    { label: "Total Complaints", value: complaints.length, icon: <HelpCircle size={20} />, color: "#5C0102", link: "/admin/complaints" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Commissioner of Grievance Dashboard</h1>
        <p className="text-gray-500 text-sm">Handle complaints and the election help desk.</p>
      </motion.div>

      {filedComplaints > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
            <Clock size={16} /> Pending actions: {filedComplaints} complaint(s)
          </div>
        </motion.div>
      )}

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
        <Link to="/admin/hearings"
          className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center justify-between group">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: "#5C0102" }}>
              <Calendar size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Schedule Hearings</div>
              <div className="text-xs text-gray-500">Set hearing dates for pending complaints</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
        </Link>
      </div>
    </div>
  );
} 
