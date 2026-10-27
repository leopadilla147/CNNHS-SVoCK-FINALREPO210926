import { useState } from "react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router";
import { Users, GraduationCap, Clock } from "lucide-react";
import { useApp } from "../../../context/AppContext";
import ElectionStageBanner from "../../../components/ElectionStageBanner";

export default function SslgAdviserDashboard() {
  const { students } = useApp();
  const navigate = useNavigate();

  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [showPendingModal, setShowPendingModal] = useState(false);

  const approvedStudents = students.filter((s) => s.status === "approved");
  const pendingStudents = students.filter((s) => s.status === "pending").length;
  const pendingList = students
    .filter((s) => s.status === "pending")
    .slice()
    .sort((a, b) => {
      const dateA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
      const dateB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
      return dateB - dateA;
    });
  const gradeLevels = [...new Set(students.map((s) => s.gradeLevel).filter(Boolean))].sort();
  const filteredStudents = (gradeFilter === "all" ? students : students.filter((s) => s.gradeLevel === gradeFilter))
    .slice()
    .sort((a, b) => {
      const dateA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
      const dateB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
      return dateB - dateA;
    });

  const stats: {
    label: string;
    value: number;
    sub: string;
    icon: React.ReactNode;
    color: string;
    link?: string;
    onClick?: () => void;
  }[] = [
    { label: "Total Students", value: students.length, sub: `${approvedStudents.length} approved`, icon: <Users size={20} />, color: "#5C0102", link: "/admin/students" },
    { label: "Pending Review", value: pendingStudents, sub: "awaiting approval", icon: <Clock size={20} />, color: "#F59E0B", onClick: () => setShowPendingModal(true) },
  ];

  const reviewPendingStudents = () => {
    setShowPendingModal(false);
    navigate("/admin/students?filter=pending");
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">SSLG Adviser Dashboard</h1>
      </motion.div>

      {/* Election Stage announcement */}
      <ElectionStageBanner className="mb-6" />

      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4 mb-8">
        {stats.map((stat, i) => {
          const card = (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-all"
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
          if (stat.link) return <Link key={stat.label} to={stat.link}>{card}</Link>;
          return (
            <div
              key={stat.label}
              onClick={stat.onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  stat.onClick?.();
                }
              }}
            >
              {card}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <GraduationCap size={16} style={{ color: "#5C0102" }} /> Student Enrollment
          </h3>
          <div className="flex items-center gap-2">
            <label htmlFor="enrollment-grade-filter" className="text-xs text-gray-500 font-medium">
              Grade Level
            </label>
            <select
              id="enrollment-grade-filter"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#5C0102]/20 focus:border-[#5C0102]/40"
            >
              <option value="all">All Grade Levels</option>
              {gradeLevels.map((grade) => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-xs text-gray-500">
            Total: <span className="font-bold text-gray-900">{filteredStudents.length}</span>{" "}
            {gradeFilter === "all" ? "students" : `students in ${gradeFilter}`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Student</th>
                <th className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Grade Level</th>
                <th className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">LRN</th>
                <th className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Status</th>
                <th className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Registered</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                    No students found.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold shrink-0">
                          {s.firstName.charAt(0)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{s.firstName} {s.lastName}</div>
                          {s.email && <div className="text-xs text-gray-400">{s.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-700">{s.gradeLevel}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-500">{s.lrn}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        s.status === "pending" ? "bg-amber-100 text-amber-700" :
                        s.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>{s.status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-500">
                      {s.registeredAt ? new Date(s.registeredAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Review modal: preview of pending registrations + jump to
          the Student Enrollment page pre-filtered to pending. */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50" onClick={() => setShowPendingModal(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-white" style={{ backgroundColor: "#5C0102" }}>
              <div className="flex items-center gap-2">
                <Clock size={18} />
                <h3 className="text-white">Pending Student Registrations</h3>
              </div>
              <p className="text-white/80 text-sm mt-1">
                {pendingStudents === 0
                  ? "No students are awaiting review."
                  : `${pendingStudents} student${pendingStudents === 1 ? " is" : "s are"} awaiting your review.`}
              </p>
            </div>

            <div className="p-4">
              {pendingList.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nothing to review — all caught up!</p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {pendingList.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5">
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-bold shrink-0">
                        {s.firstName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{s.firstName} {s.lastName}</div>
                        <div className="text-xs text-gray-500">{s.gradeLevel} · LRN: {s.lrn}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 p-4 pt-0">
              <button
                onClick={() => setShowPendingModal(false)}
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              {pendingList.length > 0 && (
                <button
                  onClick={reviewPendingStudents}
                  className="flex-1 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  Review Pending Students
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/*
        05-02 (D-05 / ACCT-04): the "Approved Students" section with the
        student reset-password action was removed from this dashboard at the
        adviser's request.  supabaseData.resetPassword("student", ...) is
        untouched, so the flow can be re-homed elsewhere if needed.
      */}
    </div>
  );
}