import { useState } from "react";
import { motion } from "motion/react";
import { Link } from "react-router";
import { Users, GraduationCap, Trophy, CheckCircle, XCircle, Clock, KeyRound, Loader2 } from "lucide-react";
import { useApp } from "../../../context/AppContext";
import { resetPassword } from "../../../lib/supabaseData";
import { TempPasswordModal } from "../../../components/TempPasswordModal";
import { useConfirm } from "../../../lib/useConfirm";

export default function SslgAdviserDashboard() {
  const { students, candidates, complaints, addLog } = useApp();

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetError, setResetError] = useState("");
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);
  const resetConfirm = useConfirm({
    title: "Reset Password?",
    description: "This generates a new one-time temporary password for the student. Every existing session is signed out immediately and the next login forces a password change (D-04).",
    confirmText: "Reset Password",
    destructive: true,
  });

  const approvedStudents = students.filter((s) => s.status === "approved");
  const pendingStudents = students.filter((s) => s.status === "pending").length;
  const rejectedStudents = students.filter((s) => s.status === "rejected").length;
  const approvedCandidates = candidates.filter((c) => c.status === "approved").length;
  const pendingCandidates = candidates.filter((c) => c.status === "pending").length;
  const openComplaints = complaints.filter((c) => c.status === "filed").length;
  const gradeLevels = [...new Set(students.map((s) => s.gradeLevel).filter(Boolean))].sort();
  const gradeStats = gradeLevels.map((grade) => ({
    grade,
    total: students.filter((s) => s.gradeLevel === grade).length,
    approved: students.filter((s) => s.gradeLevel === grade && s.status === "approved").length,
  }));
  const recentPending = [...students].filter((s) => s.status === "pending").sort((a, b) => {
    const dateA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
    const dateB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
    return dateB - dateA;
  }).slice(0, 5);

  const stats = [
    { label: "Total Students", value: students.length, sub: `${approvedStudents.length} approved`, icon: <Users size={20} />, color: "#5C0102", link: "/admin/students" },
    { label: "Pending Review", value: pendingStudents, sub: "awaiting approval", icon: <Clock size={20} />, color: "#F59E0B", link: "/admin/students?filter=pending" },
    { label: "Approved Candidates", value: approvedCandidates, sub: `${pendingCandidates} pending`, icon: <Trophy size={20} />, color: "#10B981", link: "/admin/candidates" },
    { label: "Open Complaints", value: openComplaints, sub: "student grievances filed", icon: <CheckCircle size={20} />, color: "#3B82F6" },
  ];

  // 05-02 (D-05 / ACCT-04): reset an approved student's password.  The
  // reset generates a one-time temp password (shown once), sets the 030
  // must_change_password flag and kills the student's sessions (D-14).
  const resetStudentPassword = async (studentId: string) => {
    const ok = await resetConfirm.confirm();
    if (!ok) return;
    setResetError("");
    setResettingId(studentId);
    try {
      const result = await resetPassword("student", studentId);
      setTempPassword({ name: result.name, email: result.email, password: result.password });
      addLog({
        user: "SSLG Adviser",
        role: "sslg_adviser",
        action: "Reset Password",
        details: `Reset password for student ${result.name} (${result.email})`,
        type: "warning",
      });
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset the password.");
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">SSLG Adviser Dashboard</h1>
        <p className="text-gray-500 text-sm">Student supervision and election oversight overview.</p>
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
              <div className="text-xs text-gray-400 mt-0.5">{stat.sub}</div>
            </motion.div>
          );
          return stat.link ? <Link key={stat.label} to={stat.link}>{card}</Link> : card;
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-4 text-sm flex items-center gap-2">
            <GraduationCap size={16} style={{ color: "#5C0102" }} /> Student Enrollment by Grade Level
          </h3>
          <div className="space-y-3">
            {gradeStats.map((g) => (
              <div key={g.grade}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600 font-medium">{g.grade}</span>
                  <span className="text-gray-500">{g.approved}/{g.total} approved</span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000 flex"
                    style={{ backgroundColor: "#5C0102", width: `${g.total > 0 ? (g.approved / g.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-3 text-sm flex items-center gap-2">
            <Clock size={16} style={{ color: "#5C0102" }} /> Pending Actions
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-amber-50 rounded-lg p-3">
              <span className="text-xs text-amber-700">Pending Student Approvals</span>
              <span className="text-sm font-bold text-amber-700">{pendingStudents}</span>
            </div>
            <div className="flex items-center justify-between bg-blue-50 rounded-lg p-3">
              <span className="text-xs text-blue-700">Pending Candidate Reviews</span>
              <span className="text-sm font-bold text-blue-700">{pendingCandidates}</span>
            </div>
            <div className="flex items-center justify-between bg-red-50 rounded-lg p-3">
              <span className="text-xs text-red-700">Open Complaints</span>
              <span className="text-sm font-bold text-red-700">{openComplaints}</span>
            </div>
            <div className="flex items-center justify-between bg-green-50 rounded-lg p-3">
              <span className="text-xs text-green-700">Rejected Students</span>
              <span className="text-sm font-bold text-green-700">{rejectedStudents}</span>
            </div>
          </div>
        </div>
      </div>

      {recentPending.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-gray-900 mb-3 text-sm flex items-center gap-2">
            <Clock size={16} style={{ color: "#F59E0B" }} /> Recent Pending Student Registrations
          </h3>
          <div className="space-y-2">
            {recentPending.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold">
                    {s.firstName.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.firstName} {s.lastName}</div>
                    <div className="text-xs text-gray-500">{s.gradeLevel} · LRN: {s.lrn}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.verificationStatus === "forReview" && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                      <Clock size={10} /> Mismatch
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    s.status === "pending" ? "bg-amber-100 text-amber-700" :
                    s.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}>{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 05-02 (D-05 / ACCT-04): approved students — reset action. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-gray-900 mb-3 text-sm flex items-center gap-2">
          <KeyRound size={16} style={{ color: "#5C0102" }} /> Approved Students
          <span className="text-xs text-gray-400 font-normal">{approvedStudents.length} approved</span>
        </h3>
        {resetError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{resetError}</div>
        )}
        {approvedStudents.length === 0 ? (
          <p className="text-sm text-gray-400">No approved students yet.</p>
        ) : (
          <div className="space-y-2">
            {approvedStudents.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-xs font-bold">
                    {s.firstName.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.firstName} {s.lastName}</div>
                    <div className="text-xs text-gray-500">{s.gradeLevel} · LRN: {s.lrn}</div>
                  </div>
                </div>
                <button
                  onClick={() => resetStudentPassword(s.id)}
                  disabled={resettingId === s.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                  title="Reset password — the next login forces a change (D-04)"
                >
                  {resettingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                  {resettingId === s.id ? "Resetting..." : "Reset password"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {tempPassword && (
        <TempPasswordModal
          name={tempPassword.name}
          email={tempPassword.email}
          password={tempPassword.password}
          onClose={() => setTempPassword(null)}
        />
      )}

      {resetConfirm.dialog}
    </div>
  );
}
