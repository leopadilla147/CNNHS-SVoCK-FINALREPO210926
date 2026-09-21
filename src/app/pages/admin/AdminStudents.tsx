import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { Search, CheckCircle, XCircle, Clock, Eye, AlertTriangle, Upload, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useApp, Student } from "../../context/AppContext";
import { reviewStudentRpc } from "../../lib/supabaseData";
import { extractMasterlistText, parseMasterlist, isFullMasterlistMatch } from "../../lib/masterlistDocx";
import { isSupabaseConfigured } from "../../lib/supabase";
import { useConfirm } from "../../lib/useConfirm";
import { toast } from "sonner";

const STATUS_RANK: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };

export default function AdminStudents() {
  const { currentUser, students, setStudents, addLog, insertNotification } = useApp();
  const logUser = currentUser?.name || "Administrator";
  // SSLG Adviser shares this enrollment surface (DashboardSidebar's
  // "Student Enrollment" link).  The adviser reviews/approves/rejects
  // pending registrations; the masterlist upload stays with the
  // Chief/Grievance-commissioner workflow (it writes student_masterlist,
  // which advisers have no grant for).
  const isSslgAdviser = currentUser?.role === "sslg_adviser";
  const logRole = isSslgAdviser ? "SSLG Adviser" : "Admin";
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(searchParams.get("filter") || "all");

  useEffect(() => {
    const urlFilter = searchParams.get("filter");
    if (urlFilter) setFilter(urlFilter);
  }, [searchParams]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadBanner, setUploadBanner] = useState<{ autoApproved: number; forReview: number; notMatched: number; skipped: number } | null>(null);
  const approveConfirm = useConfirm({ title: "Approve Student?", description: "This will approve the student's registration and grant them access to the election system.", confirmText: "Approve", destructive: false });
  const rejectConfirm = useConfirm({ title: "Reject Student?", description: "This will reject the student's registration. They will not be able to participate in the election.", confirmText: "Reject", destructive: true });

  const filtered = students.filter((s) => {
    const matchSearch = `${s.firstName} ${s.lastName} ${s.lrn}`.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || s.status === filter;
    return matchSearch && matchFilter;
  });

  // MASTER-02 / D-11: pending/unverified first (pending → approved → rejected)
  const sortedStudents = [...filtered].sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3));

  const handleMasterlistUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setUploadBanner(null);
    try {
      const text = await extractMasterlistText(file);
      const { rows, skipped } = parseMasterlist(text);
      if (rows.length === 0) {
        setUploadBanner({ autoApproved: 0, forReview: 0, notMatched: 0, skipped });
        return;
      }

      const autoApprovedIds: string[] = [];
      let forReview = 0;
      let notMatched = 0;

      for (const row of rows) {
        const existing = students.find((s) => s.lrn === row.lrn);
        if (!existing) {
          notMatched += 1;
          continue;
        }
        // Locked D-10: LRN AND full name AND birthdate — auto-accept.
        if (isFullMasterlistMatch(row, existing)) {
          autoApprovedIds.push(existing.id);
        } else {
          // LRN matches but name/birthdate differs — pending for manual review.
          forReview += 1;
        }
      }

      if (autoApprovedIds.length > 0) {
        for (const id of autoApprovedIds) {
          if (isSupabaseConfigured) {
            await reviewStudentRpc(id, "approve", currentUser?.id);
          }
          const student = students.find((s) => s.id === id);
          if (!student) continue;
          setStudents(students.map((s) => (s.id === id ? { ...s, status: "approved" } : s)));
          addLog({
            user: logUser,
            role: "Admin",
            action: "Approved Student Registration",
            details: `Auto-approved ${student.firstName} ${student.lastName} (LRN: ${student.lrn}) — full masterlist match (name + LRN + birthdate)`,
            type: "success",
          });
          insertNotification({
            userId: id,
            role: "student",
            type: "student_approved",
            title: "Registration Approved",
            message: "Your student registration has been approved. You can now access the election system.",
            link: "/student/dashboard",
          });
        }
      }

      setUploadBanner({ autoApproved: autoApprovedIds.length, forReview, notMatched, skipped });
    } catch (err: any) {
      toast.error(err.message || "Could not read the masterlist file. Make sure it is a valid .docx in the CNNHS masterlist format.");
      addLog({
        user: logUser,
        role: "Admin",
        action: "Masterlist Import Failed",
        details: err.message || "Could not parse the uploaded masterlist.",
        type: "error",
      });
    }
    setUploading(false);
  };

  const handleApprove = async (student: Student) => {
    const ok = await approveConfirm.confirm();
    if (!ok) return;
    setProcessing(student.id);
    try {
      if (isSupabaseConfigured) {
        await reviewStudentRpc(student.id, "approve", currentUser?.id);
      }
      setStudents(students.map((s) => s.id === student.id ? { ...s, status: "approved" } : s));
      addLog({
        user: logUser,
        role: "Admin",
        action: "Approved Student Registration",
        details: `Approved registration of ${student.firstName} ${student.lastName} (LRN: ${student.lrn})${student.verificationStatus === "forReview" ? " and accepted submitted correction over masterlist mismatch" : ""}`,
        type: "success",
      });
      insertNotification({
        userId: student.id,
        role: "student",
        type: "student_approved",
        title: "Registration Approved",
        message: "Your student registration has been approved. You can now access the election system.",
        link: "/student/dashboard",
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to approve student");
      addLog({
        user: logUser,
        role: "Admin",
        action: "Approve Failed",
        details: `Failed to approve ${student.firstName} ${student.lastName}: ${err.message}`,
        type: "error",
      });
    }
    setProcessing(null);
    setSelected(null);
  };

  const handleReject = async (student: Student) => {
    const ok = await rejectConfirm.confirm();
    if (!ok) return;
    setProcessing(student.id);
    try {
      if (isSupabaseConfigured) {
        await reviewStudentRpc(student.id, "reject", currentUser?.id);
      }
      setStudents(students.map((s) => s.id === student.id ? { ...s, status: "rejected" } : s));
      addLog({
        user: logUser,
        role: "Admin",
        action: "Rejected Student Registration",
        details: `Rejected registration of ${student.firstName} ${student.lastName} (LRN: ${student.lrn})`,
        type: "warning",
      });
      insertNotification({
        userId: student.id,
        role: "student",
        type: "student_rejected",
        title: "Registration Rejected",
        message: "Your student registration has been rejected. Please contact the Commissioner of Grievance for assistance.",
        link: "/",
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to reject student");
      addLog({
        user: logUser,
        role: "Admin",
        action: "Reject Failed",
        details: `Failed to reject ${student.firstName} ${student.lastName}: ${err.message}`,
        type: "error",
      });
    }
    setProcessing(null);
    setSelected(null);
  };

  const getStatusBadge = (status: string) => {
    if (status === "approved") return <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1 w-fit"><CheckCircle size={11} /> Approved</span>;
    if (status === "rejected") return <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium flex items-center gap-1 w-fit"><XCircle size={11} /> Rejected</span>;
    return <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1 w-fit"><Clock size={11} /> Pending</span>;
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-gray-900">Student Enrollment Verification</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isSslgAdviser ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
            {isSslgAdviser ? "SSLG Adviser" : "Grievance"}
          </span>
        </div>
        <p className="text-gray-500 text-sm">
          {isSslgAdviser
            ? "Review and approve or reject pending student registrations."
            : "Review registrations that did not fully match the master list."}
        </p>
      </motion.div>

      {/* Masterlist upload (MASTER-01) — Chief/Grievance only. */}
      {!isSslgAdviser && (
      <div className="mb-6">
        <label className="block border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-[#5C0102] transition-colors cursor-pointer bg-white">
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              handleMasterlistUpload(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <div className="flex items-center justify-center gap-2">
            {uploading ? (
              <Loader2 size={20} className="animate-spin text-[#5C0102] flex-shrink-0" />
            ) : (
              <Upload size={20} className="text-gray-400 flex-shrink-0" />
            )}
            <span className="text-sm font-medium text-gray-700">{uploading ? "Reading masterlist..." : "Upload Masterlist (.docx)"}</span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Full name + LRN + birthdate matches are auto-approved.</p>
        </label>

        {uploadBanner && (
          <div className="mt-3 space-y-2">
            {(uploadBanner.autoApproved > 0 || uploadBanner.forReview > 0 || uploadBanner.notMatched > 0 || uploadBanner.skipped > 0) ? (
              <>
                {uploadBanner.autoApproved > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-start gap-2">
                    <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.autoApproved} student{uploadBanner.autoApproved === 1 ? "" : "s"} auto-approved.</span>
                  </div>
                )}
                {uploadBanner.forReview > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700 flex items-start gap-2">
                    <Clock size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.forReview} student{uploadBanner.forReview === 1 ? "" : "s"} need manual review.</span>
                  </div>
                )}
                {uploadBanner.notMatched > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-600 flex items-start gap-2">
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.notMatched} row{uploadBanner.notMatched === 1 ? "" : "s"} had no matching registered LRN.</span>
                  </div>
                )}
                {uploadBanner.skipped > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-600 flex items-start gap-2">
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.skipped} malformed row{uploadBanner.skipped === 1 ? "" : "s"} skipped.</span>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>Could not read the masterlist file. Make sure it is a valid .docx in the CNNHS masterlist format.</span>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total", count: students.length, color: "#5C0102" },
          { label: "Pending", count: students.filter((s) => s.status === "pending").length, color: "#F59E0B" },
          { label: "Approved", count: students.filter((s) => s.status === "approved").length, color: "#10B981" },
          { label: "Rejected", count: students.filter((s) => s.status === "rejected").length, color: "#EF4444" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <div className="text-2xl font-bold mb-0.5" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or LRN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {["all", "pending", "approved", "rejected"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${filter === f ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={filter === f ? { backgroundColor: "#5C0102" } : {}}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#FFF5F5" }}>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Student</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">LRN</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Grade</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Gender</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Birthdate</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Registered</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Verification</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedStudents.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: "#5C0102" }}>
                        {student.firstName.charAt(0)}{student.lastName.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{student.firstName} {student.middleName ? student.middleName + " " : ""}{student.lastName}</div>
                        <div className="text-xs text-gray-400">{student.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600 font-mono text-xs">{student.lrn}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{student.gradeLevel}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{student.gender}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{student.birthdate}</td>
                  <td className="py-3 px-4 text-gray-400 text-xs">{student.registeredAt}</td>
                  <td className="py-3 px-4 text-xs">
                    {student.verificationStatus === "autoApproved" ? (
                      <span className="text-green-700 bg-green-50 px-2 py-1 rounded-full">Masterlist match</span>
                    ) : student.verificationStatus === "forReview" && student.mismatchCount === 1 ? (
                      <span className="text-amber-700 bg-amber-50 px-2 py-1 rounded-full">1 mismatch</span>
                    ) : student.verificationStatus === "forReview" ? (
                      <span className="text-amber-700 bg-amber-50 px-2 py-1 rounded-full">Pending</span>
                    ) : (
                      <span className="text-gray-400">Manual</span>
                    )}
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(student.status)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setSelected(student)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500" title="View">
                        <Eye size={14} />
                      </button>
                      {student.status === "pending" && (
                        <>
                          <button
                            onClick={() => handleApprove(student)}
                            disabled={processing === student.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 transition-colors disabled:opacity-60"
                          >
                            {processing === student.id ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={12} />}
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(student)}
                            disabled={processing === student.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 transition-colors disabled:opacity-60"
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {sortedStudents.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400 text-sm">No students found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50" onClick={() => setSelected(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-white text-center" style={{ backgroundColor: "#5C0102" }}>
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3 text-2xl font-bold text-white">
                {selected.firstName.charAt(0)}{selected.lastName.charAt(0)}
              </div>
              <h3 className="text-white">
                {selected.firstName} {selected.middleName ? selected.middleName + " " : ""}{selected.lastName}
              </h3>
              <div className="mt-1">{getStatusBadge(selected.status)}</div>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">First Name</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.firstName}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Middle Name</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.middleName || "—"}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Last Name</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.lastName}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">LRN</div>
                  <div className="text-gray-800 font-medium text-sm font-mono">{selected.lrn}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Grade Level</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.gradeLevel}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Gender</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.gender}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Birthdate</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.birthdate}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Email</div>
                  <div className="text-gray-800 font-medium text-sm break-all">{selected.email || "—"}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Registered Date</div>
                  <div className="text-gray-800 font-medium text-sm">{selected.registeredAt}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Status</div>
                  <div>{getStatusBadge(selected.status)}</div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                {selected.status === "pending" && (
                  <>
                    <button onClick={() => handleApprove(selected)} className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
                      ✓ Approve
                    </button>
                    <button onClick={() => handleReject(selected)} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors">
                      ✗ Reject
                    </button>
                  </>
                )}
                <button onClick={() => setSelected(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
              {selected.verificationStatus === "forReview" && selected.mismatchCount === 1 && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2 text-left">
                  <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Approving this account accepts the student's submitted detail and replaces the
                    mismatched information currently held in the master list.
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
      {approveConfirm.dialog}
      {rejectConfirm.dialog}
    </div>
  );
}
