import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Search, CheckCircle, XCircle, Clock, Eye, AlertTriangle, Upload, Loader2, Download, Ban, ShieldAlert, X } from "lucide-react";
import { motion } from "motion/react";
import { useApp, Student, StudentMasterlistEntry } from "../../context/AppContext";
import { reviewStudentRpc, importStudentMasterlistDocx, findExistingLrns, verifyAdviserPasswordRpc, disableStudentAccountsRpc } from "../../lib/supabaseData";
import {
  extractAndParseMasterlist,
  partitionMasterlistMatches,
  describeSkippedLrn,
  extractSchoolYear,
  splitFullName,
  toIsoBirthdate,
} from "../../lib/masterlistDocx";
import { isSupabaseConfigured } from "../../lib/supabase";
import { useConfirm } from "../../lib/useConfirm";
import { toast } from "sonner";

const STATUS_RANK: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
/** Downloadable blank copy of the official CNNHS masterlist format
 *  (Based Documents/CNNHS-MASTER-LIST-FORMAT.docx, served from /public). */
const MASTERLIST_TEMPLATE_URL = "/templates/CNNHS-MASTER-LIST-FORMAT.docx";

export default function AdminStudents() {
  const {
    currentUser,
    students,
    setStudents,
    addLog,
    insertNotification,
    studentMasterlist,
    setStudentMasterlist,
    electionPeriod,
  } = useApp();
  const logUser = currentUser?.name || "Administrator";
  // SSLG Adviser owns this enrollment surface (DashboardSidebar's
  // "Student Enrollment" link is adviser-only): they upload the masterlist
  // (which writes student_masterlist), review pending registrations, and
  // approve/reject.
  const isSslgAdviser = currentUser?.role === "sslg_adviser";
  const logRole = isSslgAdviser ? "SSLG Adviser" : "Admin";
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  // "rejected" was removed from the surface (107) — a deep link to it
  // falls back to "all".
  const FILTERS = ["all", "awaiting", "pending", "approved"];
  const [filter, setFilter] = useState(() => {
    const urlFilter = searchParams.get("filter");
    return urlFilter && FILTERS.includes(urlFilter) ? urlFilter : "all";
  });

  useEffect(() => {
    const urlFilter = searchParams.get("filter");
    if (urlFilter && FILTERS.includes(urlFilter)) setFilter(urlFilter);
  }, [searchParams]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadBanner, setUploadBanner] = useState<{
    /** Rows written to student_masterlist this upload. */
    inserted: number;
    /** Valid rows with no registered account yet (system state). */
    awaiting: number;
    autoApproved: number;
    /** Valid rows NOT re-uploaded because the LRN already exists. */
    duplicateRows: number;
    duplicateMessages: string[];
    /** Rows rejected by the 5-column validation (whole row invalid). */
    invalidRows: number;
    invalidMessages: string[];
    failures?: string[];
  } | null>(null);
  const approveConfirm = useConfirm({ title: "Approve Student?", description: "This will approve the student's registration and grant them access to the election system.", confirmText: "Approve", destructive: false });
  const rejectConfirm = useConfirm({ title: "Reject Student?", description: "This will reject the student's registration. They will not be able to participate in the election.", confirmText: "Reject", destructive: true });

  // 107 — Disable Student Accounts: a password-gated dialog behind the
  // upload row.  Step "gate" verifies the acting adviser's OWN password
  // (verify_adviser_password_rpc) BEFORE the panel is shown; the panel
  // collects the reason (Graduated / Transferring to Another School) and
  // the accounts to disable, and the RPC re-verifies the password when
  // the consequential move happens.
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableStep, setDisableStep] = useState<"gate" | "panel">("gate");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableReason, setDisableReason] = useState<"graduated" | "transferred">("graduated");
  const [disableSelection, setDisableSelection] = useState<Set<string>>(new Set());
  const [disableSearch, setDisableSearch] = useState("");
  const [disabling, setDisabling] = useState(false);
  // Graduated mode: upload a CNNHS-format masterlist and auto-select every
  // parsed LRN that matches an approved account.
  const [parsingGraduated, setParsingGraduated] = useState(false);
  const [graduatedReport, setGraduatedReport] = useState<{ matched: number; unknownLrns: string[]; invalidRows: number } | null>(null);

  // Only APPROVED, not-yet-disabled accounts can be disabled.
  const disableCandidates = useMemo(
    () => students.filter((s) => s.status === "approved" && !s.disabled),
    [students]
  );
  const selectedDisableStudents = useMemo(
    () => disableCandidates.filter((s) => disableSelection.has(s.id)),
    [disableCandidates, disableSelection]
  );
  const filteredDisableCandidates = useMemo(
    () =>
      disableCandidates.filter((s) =>
        `${s.firstName} ${s.lastName} ${s.lrn}`.toLowerCase().includes(disableSearch.toLowerCase())
      ),
    [disableCandidates, disableSearch]
  );

  const openDisableDialog = () => {
    setDisableStep("gate");
    setDisablePassword("");
    setDisableError(null);
    setDisableReason("graduated");
    setDisableSelection(new Set());
    setDisableSearch("");
    setGraduatedReport(null);
    setDisableOpen(true);
  };

  /**
   * Graduated mode: parse the uploaded CNNHS-format masterlist (same parser
   * as the enrollment upload — 5-column validation, title/header rows
   * excluded) and auto-select every LRN that matches an APPROVED account.
   * LRNs with no approved account are reported, not selected.
   */
  const handleGraduatedUpload = async (file: File | null) => {
    if (!file) return;
    setParsingGraduated(true);
    setDisableError(null);
    try {
      const {
        parsed: { rows, skipped },
      } = await extractAndParseMasterlist(file);
      const candidateByLrn = new Map(disableCandidates.map((s) => [s.lrn, s] as const));
      const matched = rows.filter((r) => candidateByLrn.has(r.lrn));
      const unknownLrns = rows.filter((r) => !candidateByLrn.has(r.lrn)).map((r) => r.lrn);
      setDisableSelection(new Set(matched.map((m) => candidateByLrn.get(m.lrn)!.id)));
      setGraduatedReport({ matched: matched.length, unknownLrns, invalidRows: skipped });
    } catch (err: any) {
      setDisableError(err.message || "Could not read the masterlist file.");
    } finally {
      setParsingGraduated(false);
    }
  };

  const submitDisableGate = async () => {
    if (!disablePassword) {
      setDisableError("Enter the SSLG Adviser password to continue.");
      return;
    }
    setDisabling(true);
    setDisableError(null);
    try {
      if (isSupabaseConfigured) {
        await verifyAdviserPasswordRpc(disablePassword);
      }
      setDisableStep("panel");
    } catch (err: any) {
      setDisableError(err.message || "The SSLG Adviser password was not accepted.");
    } finally {
      setDisabling(false);
    }
  };

  const toggleDisableSelection = (id: string) => {
    setDisableSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitDisableAccounts = async () => {
    if (disableSelection.size === 0) {
      setDisableError("Select at least one student account to disable.");
      return;
    }
    setDisabling(true);
    setDisableError(null);
    try {
      const ids = Array.from(disableSelection);
      let disabledCount = ids.length;
      if (isSupabaseConfigured) {
        // The RPC re-verifies the password server-side and writes the
        // audit entry (107).
        const { disabled } = await disableStudentAccountsRpc(ids, disableReason, disablePassword);
        disabledCount = disabled;
      }
      const reasonLabel = disableReason === "graduated" ? "Graduated" : "Transferred to another school";
      addLog({
        user: logUser,
        role: logRole,
        action: "Student Accounts Disabled",
        details: `Disabled ${disabledCount} student account(s) — reason: ${reasonLabel}.`,
        type: "warning",
      });
      setStudents(
        students.map((s) =>
          disableSelection.has(s.id)
            ? { ...s, disabled: true, disabledReason: disableReason }
            : s
        )
      );
      setDisableOpen(false);
    } catch (err: any) {
      // Keep the dialog open so the adviser can correct the password and retry.
      setDisableError(err.message || "Failed to disable the selected student accounts.");
    } finally {
      setDisabling(false);
    }
  };

  // MASTER-01 display flow: masterlist rows whose LRN has no registered
  // account yet surface in this tab as "awaiting student registration".
  const awaitingEntries = useMemo(
    () =>
      studentMasterlist.filter(
        (e) => e.enrollmentStatus === "enrolled" && !students.some((s) => s.lrn === e.lrn)
      ),
    [studentMasterlist, students]
  );

  const filtered = students.filter((s) => {
    const matchSearch = `${s.firstName} ${s.lastName} ${s.lrn}`.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || filter === "awaiting" || s.status === filter;
    return matchSearch && matchFilter;
  });
  const filteredAwaiting = awaitingEntries.filter((e) => {
    const matchSearch = `${e.firstName} ${e.lastName} ${e.lrn}`.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  // MASTER-02 / D-11: pending/unverified first (pending → approved → rejected)
  const sortedStudents = [...filtered].sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3));
  const showAwaiting = filter === "all" || filter === "awaiting";

  const handleMasterlistUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setUploadBanner(null);
    try {
      const {
        parsed: { rows, skipped, errors },
        text,
      } = await extractAndParseMasterlist(file);
      const schoolYear = extractSchoolYear(text) || electionPeriod?.schoolYear || "";
      if (!schoolYear) {
        throw new Error(
          'Could not determine the school year. Keep the "SY: 2026-2027" header line in the document, or set up the election period first.'
        );
      }
      // Partial import (MASTER-01): every row is validated independently.
      // Invalid rows are reported below and skipped — the valid rows around
      // them still import.
      if (rows.length === 0) {
        setUploadBanner({
          inserted: 0,
          awaiting: 0,
          autoApproved: 0,
          duplicateRows: 0,
          duplicateMessages: [],
          invalidRows: skipped,
          invalidMessages: errors,
        });
        return;
      }

      // Which rows already exist in the system?  An LRN may not be
      // re-uploaded (school year is ignored — an LRN identifies one
      // learner), but a clash now only SKIPS that row: the rest of the
      // sheet still imports, so re-uploading the same masterlist works.
      let duplicateRows = 0;
      let duplicateMessages: string[] = [];
      let importRows = rows;
      if (isSupabaseConfigured) {
        const conflicts = await findExistingLrns(rows.map((r) => r.lrn));
        const skippedRows = rows.filter((r) => conflicts.has(r.lrn));
        importRows = rows.filter((r) => !conflicts.has(r.lrn));
        duplicateRows = skippedRows.length;
        duplicateMessages = skippedRows.map((r) => describeSkippedLrn(r, conflicts.get(r.lrn)!));
      }

      // MASTER-01 insert flow: persist every NEW row so students who
      // register LATER are matched against this sheet (upsert on
      // lrn + school_year — re-uploads update instead of duplicate).
      const { imported, errors: importErrors } = await importStudentMasterlistDocx(
        importRows,
        schoolYear
      );

      // Refresh the local masterlist copy so "awaiting registration" rows
      // render immediately — merged by LRN so the skipped (already
      // existing) rows stay in the list (optimistic; the next boot load
      // re-syncs ids).
      const importedEntries: StudentMasterlistEntry[] = importRows.map((row) => {
        const parts = splitFullName(row.fullName);
        return {
          id: row.lrn,
          lrn: row.lrn,
          firstName: parts.firstName || row.fullName,
          lastName: parts.lastName || row.fullName,
          birthdate: toIsoBirthdate(row.birthdate),
          gradeLevel: row.gradeLevel,
          gender: row.sex || undefined,
          schoolYear,
          enrollmentStatus: "enrolled" as const,
          importedAt: new Date().toISOString().slice(0, 10),
        };
      });
      const yearEntries = new Map(
        studentMasterlist.filter((e) => e.schoolYear === schoolYear).map((e) => [e.lrn, e as StudentMasterlistEntry])
      );
      for (const entry of importedEntries) yearEntries.set(entry.lrn, entry);
      setStudentMasterlist([
        ...studentMasterlist.filter((e) => e.schoolYear !== schoolYear),
        ...yearEntries.values(),
      ]);

      // Locked flow: LRN + full name + birthdate + sex + grade must ALL match
      // the sheet for an automatic approval.  Runs over EVERY valid row —
      // including the ones skipped as duplicates — so re-uploading the same
      // masterlist after students register approves matched pending
      // accounts.  Already-approved students are only re-stamped (no
      // duplicate notification); an explicit rejection is never overturned.
      const { pendingIds, alreadyApprovedIds, forReview, awaiting, alreadyRejected } =
        partitionMasterlistMatches(rows, students);
      const autoApproveIds = [...pendingIds, ...alreadyApprovedIds];

      const appliedIds = new Set<string>();
      const failures: string[] = [];

      for (const id of autoApproveIds) {
        const student = students.find((s) => s.id === id);
        const wasPending = student?.status === "pending";
        try {
          if (isSupabaseConfigured) {
            await reviewStudentRpc(id, "approve", currentUser?.id, "automatic");
          }
          appliedIds.add(id);
          if (wasPending) {
            addLog({
              user: logUser,
              role: logRole,
              action: "Approved Student Registration",
              details: `Auto-approved ${student?.firstName || ""} ${student?.lastName || ""} (LRN: ${student?.lrn || id}) — full masterlist match (name + LRN + birthdate + sex + grade level)`,
              type: "success",
            });
            insertNotification({
              userId: id,
              role: "student",
              type: "student_approved",
              title: "Registration Approved",
              message:
                "You have been automatically approved through the Student Masterlist match. You can now log in and access the election system.",
              link: "/student/dashboard",
            });
          }
        } catch (err: any) {
          // Isolated: one failed stamp must not abort the rest of the sheet.
          failures.push(
            `${student?.firstName || "Student"} ${student?.lastName || ""} (LRN: ${student?.lrn || id}): ${err.message || "auto-approval failed"}`
          );
        }
      }

      if (appliedIds.size > 0) {
        setStudents(
          students.map((s) =>
            appliedIds.has(s.id)
              ? { ...s, status: "approved" as const, verificationStatus: "automatic" as const }
              : s
          )
        );
      }

      setUploadBanner({
        inserted: imported,
        awaiting,
        autoApproved: appliedIds.size,
        duplicateRows,
        duplicateMessages,
        invalidRows: skipped,
        invalidMessages: [...errors, ...importErrors],
        failures,
      });
      addLog({
        user: logUser,
        role: logRole,
        action: "Masterlist Imported",
        details: `Imported ${imported} new masterlist row(s) for SY ${schoolYear}: ${duplicateRows} skipped (LRN already exists), ${skipped} invalid, ${appliedIds.size} auto-approved, ${awaiting} awaiting registration, ${forReview} for review, ${alreadyRejected} matching-rejected left unchanged, ${failures.length} failed.`,
        type: failures.length > 0 || skipped > 0 ? "warning" : "info",
      });
    } catch (err: any) {
      toast.error(err.message || "Could not read the masterlist file. Make sure it is a valid .docx in the CNNHS masterlist format.");
      addLog({
        user: logUser,
        role: logRole,
        action: "Masterlist Import Failed",
        details: err.message || "Could not parse the uploaded masterlist.",
        type: "error",
      });
    } finally {
      // Always clear the reader — the early returns above (validation error,
      // LRN clash) and any thrown error must not leave the box stuck on
      // "Reading masterlist..." with the file input disabled.
      setUploading(false);
    }
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
        details: `Approved registration of ${student.firstName} ${student.lastName} (LRN: ${student.lrn})${student.verificationStatus === "manual" && student.mismatchCount ? " and accepted submitted correction over masterlist mismatch" : ""}`,
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
        message: "Your student registration has been rejected. Please contact the SSLG Adviser for assistance.",
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

      {/* Masterlist upload (MASTER-01) — SSLG Adviser only (the sole role
          with the Student Enrollment tab).  Rows are inserted into
          student_masterlist and surface here as "awaiting registration". */}
      {isSslgAdviser && (
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex-1 block border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-[#5C0102] transition-colors cursor-pointer bg-white">
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
            <p className="text-xs text-gray-400 mt-1.5">
              Only rows with an LRN are read. Required per row: LRN (12 digits), Full Name
              (Last Name, First Name, Middle Initial), Sex (Male/Female), Birthdate (MM/DD/YYYY),
              and Grade Level (Grade 7–12). Rows are listed as "Awaiting Registration".
            </p>
          </label>
          <a
            href={MASTERLIST_TEMPLATE_URL}
            download="CNNHS-MASTER-LIST-FORMAT.docx"
            className="flex flex-col items-center justify-center gap-2 sm:w-56 bg-white border border-gray-200 rounded-xl p-6 text-center hover:border-[#5C0102] hover:bg-[#FFF5F5] transition-colors"
            title="Download a blank copy of the official CNNHS masterlist format"
          >
            <Download size={20} className="text-[#5C0102] flex-shrink-0" />
            <span className="text-sm font-medium text-gray-700">Download Masterlist Format</span>
            <span className="text-xs text-gray-400">Blank .docx copy of the official template</span>
          </a>
          {/* 107 — Disable Student Accounts (SSLG Adviser password gate). */}
          <button
            type="button"
            onClick={openDisableDialog}
            className="flex flex-col items-center justify-center gap-2 sm:w-56 bg-white border border-gray-200 rounded-xl p-6 text-center hover:border-red-300 hover:bg-red-50 transition-colors"
            title="Disable approved student accounts — Graduated / Transferred (SSLG Adviser password required)"
          >
            <Ban size={20} className="flex-shrink-0" style={{ color: "#DC2626" }} />
            <span className="text-sm font-medium text-gray-700">Disable Student Accounts</span>
            <span className="text-xs text-gray-400">Graduated / Transferred (password required)</span>
          </button>
        </div>

        {uploadBanner && (
          <div className="mt-3 space-y-2">
            {(uploadBanner.inserted > 0 || uploadBanner.autoApproved > 0 || uploadBanner.awaiting > 0 || uploadBanner.invalidRows > 0 || uploadBanner.duplicateRows > 0 || (uploadBanner.failures?.length ?? 0) > 0) ? (
              <>
                {uploadBanner.inserted > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-start gap-2">
                    <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.inserted} masterlist row{uploadBanner.inserted === 1 ? "" : "s"} inserted.</span>
                  </div>
                )}
                {uploadBanner.awaiting > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-start gap-2">
                    <Clock size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.awaiting} student{uploadBanner.awaiting === 1 ? "" : "s"} listed as awaiting student registration.</span>
                  </div>
                )}
                {uploadBanner.autoApproved > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-start gap-2">
                    <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{uploadBanner.autoApproved} registered student{uploadBanner.autoApproved === 1 ? "" : "s"} auto-approved via the masterlist match.</span>
                  </div>
                )}
                {uploadBanner.duplicateRows > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-start gap-2">
                    <Clock size={15} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <div>
                        {uploadBanner.duplicateRows} row{uploadBanner.duplicateRows === 1 ? "" : "s"} skipped — their LRN{uploadBanner.duplicateRows === 1 ? "" : "s"} already exist{uploadBanner.duplicateRows === 1 ? "s" : ""} in the system, so {uploadBanner.duplicateRows === 1 ? "it was" : "they were"} not re-uploaded:
                      </div>
                      <ul className="mt-1.5 ml-1 list-disc list-inside space-y-0.5 text-xs">
                        {uploadBanner.duplicateMessages.slice(0, 8).map((message, i) => (
                          <li key={i}>{message}</li>
                        ))}
                      </ul>
                      {uploadBanner.duplicateMessages.length > 8 && (
                        <div className="mt-1 text-xs">...and {uploadBanner.duplicateMessages.length - 8} more.</div>
                      )}
                    </div>
                  </div>
                )}
                {uploadBanner.invalidRows > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <div>
                        {uploadBanner.invalidRows} row{uploadBanner.invalidRows === 1 ? "" : "s"} could not be imported —{" "}
                        {uploadBanner.inserted > 0
                          ? "the valid rows were still imported. "
                          : "nothing was imported. "}
                        Fix the highlighted rows and upload the sheet again:
                      </div>
                      <ul className="mt-1.5 ml-1 list-disc list-inside space-y-0.5 text-xs">
                        {uploadBanner.invalidMessages.slice(0, 8).map((message, i) => (
                          <li key={i}>{message}</li>
                        ))}
                      </ul>
                      {uploadBanner.invalidMessages.length > 8 && (
                        <div className="mt-1 text-xs">...and {uploadBanner.invalidMessages.length - 8} more.</div>
                      )}
                      <div className="mt-1.5 text-xs">
                        Each row needs: a 12-digit LRN (numbers only); a "Last Name, First Name, Middle Initial"
                        name; Sex as Male/Female; Birthdate as MM/DD/YYYY; and Grade Level as Grade 7–12.
                      </div>
                    </div>
                  </div>
                )}
                {(uploadBanner.failures?.length ?? 0) > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-start gap-2">
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <div>
                        {uploadBanner.failures!.length} matching student{uploadBanner.failures!.length === 1 ? "" : "s"} could not be auto-approved — the rest of the sheet was still imported:
                      </div>
                      <ul className="mt-1.5 ml-1 list-disc list-inside space-y-0.5 text-xs">
                        {uploadBanner.failures!.slice(0, 8).map((failure, i) => (
                          <li key={i}>{failure}</li>
                        ))}
                      </ul>
                    </div>
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

      {/* 107 — Disable Student Accounts dialog: password gate first, then
          the reason + selection panel.  The RPC re-verifies the password
          when the accounts are actually disabled. */}
      {disableOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !disabling && setDisableOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="disable-dialog-title"
            className={`relative bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-full ${
              disableStep === "panel" ? "max-w-3xl" : "max-w-md"
            } max-h-[85vh] overflow-y-auto`}
          >
            <button
              onClick={() => !disabling && setDisableOpen(false)}
              disabled={disabling}
              aria-label="Close"
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <Ban size={18} style={{ color: "#DC2626" }} />
              <h3 id="disable-dialog-title" className="text-gray-900 text-sm font-semibold">
                Disable Student Accounts
              </h3>
            </div>

            {disableStep === "gate" ? (
              <>
                <p className="text-xs text-gray-500 mb-4">
                  This action disables approved student accounts so they can no longer log in.
                  Enter the SSLG Adviser password to continue.
                </p>
                <label className="block text-xs text-gray-600 mb-1" htmlFor="disable-gate-password">
                  SSLG Adviser Password
                </label>
                <input
                  id="disable-gate-password"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitDisableGate(); }}
                  disabled={disabling}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50"
                />
                {disableError && (
                  <p className="text-xs text-red-600 mt-2" role="alert">{disableError}</p>
                )}
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setDisableOpen(false)}
                    disabled={disabling}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitDisableGate}
                    disabled={disabling}
                    className="px-4 py-2 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    {disabling ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-3">
                  Choose a reason and select the approved accounts to disable. Disabled
                  students can no longer log in.
                </p>

                {/* Reason */}
                <span className="block text-xs text-gray-600 mb-1.5">Reason</span>
                <div className="flex gap-2 flex-wrap mb-3">
                  {([["graduated", "Graduated"], ["transferred", "Transferring to Another School"]] as const).map(
                    ([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setDisableReason(value);
                          setGraduatedReport(null);
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          disableReason === value ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                        style={disableReason === value ? { backgroundColor: "#5C0102" } : {}}
                      >
                        {label}
                      </button>
                    )
                  )}
                </div>

                {/* Graduated mode: upload a CNNHS-format masterlist (the same
                    format used for registration) to auto-select every LRN
                    that matches an approved account. */}
                {disableReason === "graduated" && (
                  <div className="mb-3 space-y-2">
                    <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg p-3 text-center hover:border-[#5C0102] cursor-pointer bg-white text-xs text-gray-600">
                      <input
                        type="file"
                        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="hidden"
                        disabled={parsingGraduated}
                        onChange={(e) => {
                          handleGraduatedUpload(e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                      />
                      {parsingGraduated ? (
                        <Loader2 size={14} className="animate-spin text-[#5C0102]" />
                      ) : (
                        <Upload size={14} className="text-gray-400 flex-shrink-0" />
                      )}
                      {parsingGraduated
                        ? "Reading masterlist..."
                        : "Upload Graduated Masterlist (.docx) — auto-selects matching students"}
                    </label>
                    {graduatedReport && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-700">
                        {graduatedReport.matched} student{graduatedReport.matched === 1 ? "" : "s"} matched and selected.
                        {graduatedReport.unknownLrns.length > 0 && (
                          <>
                            {" "}
                            {graduatedReport.unknownLrns.length} LRN{graduatedReport.unknownLrns.length === 1 ? "" : "s"} in the
                            sheet have no approved account — skipped: {graduatedReport.unknownLrns.slice(0, 5).join(", ")}
                            {graduatedReport.unknownLrns.length > 5 && ", ..."}.
                          </>
                        )}
                        {graduatedReport.invalidRows > 0 && (
                          <> {graduatedReport.invalidRows} invalid row{graduatedReport.invalidRows === 1 ? "" : "s"} ignored.</>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Search + selection */}
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search approved students..."
                    value={disableSearch}
                    onChange={(e) => setDisableSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs bg-gray-50"
                  />
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">{disableSelection.size} selected</span>
                  <button
                    type="button"
                    onClick={() => setDisableSelection(new Set(filteredDisableCandidates.map((s) => s.id)))}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Select all shown
                  </button>
                </div>
                <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-64 overflow-y-auto">
                  {filteredDisableCandidates.length === 0 && (
                    <div className="p-4 text-xs text-gray-400 text-center">No approved student accounts available.</div>
                  )}
                  {filteredDisableCandidates.map((s) => (
                    <label key={s.id} className="flex items-center gap-3 p-2.5 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={disableSelection.has(s.id)}
                        onChange={() => toggleDisableSelection(s.id)}
                        className="w-4 h-4 accent-[#5C0102]"
                      />
                      <span className="flex-1 text-sm text-gray-700">{s.firstName} {s.lastName}</span>
                      <span className="text-xs text-gray-500 font-mono">{s.lrn}</span>
                      <span className="text-xs text-gray-400">{s.gradeLevel}</span>
                    </label>
                  ))}
                </div>
                </div>

                {/* Summary of the list beside the selection — the adviser's
                    "check" list of exactly what will be disabled. */}
                <div className="lg:w-64 shrink-0">
                  <div className="border border-gray-100 rounded-lg bg-gray-50 p-3 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-700">Selected for Disable</span>
                      <span className="text-xs text-gray-500">{selectedDisableStudents.length}</span>
                    </div>
                    {selectedDisableStudents.length === 0 ? (
                      <div className="text-xs text-gray-400 py-6 text-center flex-1 flex items-center justify-center">
                        No students selected yet.
                      </div>
                    ) : (
                      <div className="space-y-1.5 overflow-y-auto max-h-72 flex-1">
                        {selectedDisableStudents.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2 py-1.5">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-700 truncate">{s.firstName} {s.lastName}</div>
                              <div className="text-[11px] text-gray-400 font-mono">{s.lrn}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleDisableSelection(s.id)}
                              className="text-gray-300 hover:text-red-500 flex-shrink-0"
                              title={`Remove ${s.firstName} ${s.lastName} from the list`}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-[11px] text-gray-400 mt-2">
                      Reason: {disableReason === "graduated" ? "Graduated" : "Transferred to another school"}
                    </div>
                  </div>
                </div>
                </div>

                {disableError && (
                  <p className="text-xs text-red-600 mt-2" role="alert">{disableError}</p>
                )}
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setDisableOpen(false)}
                    disabled={disabling}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitDisableAccounts}
                    disabled={disabling || disableSelection.size === 0}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {disabling ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                    Disable{disableSelection.size > 0 ? ` ${disableSelection.size}` : ""} Account{disableSelection.size === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total", count: students.length + awaitingEntries.length, color: "#5C0102" },
          { label: "Awaiting Registration", count: awaitingEntries.length, color: "#3B82F6" },
          { label: "Pending", count: students.filter((s) => s.status === "pending").length, color: "#F59E0B" },
          { label: "Approved", count: students.filter((s) => s.status === "approved").length, color: "#10B981" },
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
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium ${f === "awaiting" ? "capitalize" : "capitalize"} transition-all ${filter === f ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={filter === f ? { backgroundColor: "#5C0102" } : {}}
              >
                {f === "awaiting" ? "Awaiting Registration" : f}
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
              {/* MASTER-01 display flow: masterlist rows with no registered
                  account yet — read-only, awaiting student registration. */}
              {showAwaiting && filteredAwaiting.map((entry) => (
                <tr key={`awaiting-${entry.lrn}`} className="hover:bg-blue-50/40 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 text-xs font-bold flex-shrink-0 bg-gray-100 border border-dashed border-gray-300">
                        {entry.firstName.charAt(0)}{entry.lastName.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-700">{entry.firstName} {entry.lastName}</div>
                        <div className="text-xs text-gray-400">No account yet — from masterlist upload</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600 font-mono text-xs">{entry.lrn}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{entry.gradeLevel}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{entry.gender || "—"}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{entry.birthdate}</td>
                  <td className="py-3 px-4 text-gray-300 text-xs">—</td>
                  <td className="py-3 px-4 text-xs"><span className="text-gray-400">—</span></td>
                  <td className="py-3 px-4">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center gap-1 w-fit">
                      <Clock size={11} /> Awaiting Registration
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300 text-xs">—</td>
                </tr>
              ))}
              {sortedStudents.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {student.profilePictureUrl ? (
                        <img src={student.profilePictureUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: "#5C0102" }}>
                          {student.firstName.charAt(0)}{student.lastName.charAt(0)}
                        </div>
                      )}
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
                    {student.verificationStatus === "automatic" ? (
                      <span className="text-green-700 bg-green-50 px-2 py-1 rounded-full">Automatic</span>
                    ) : student.verificationStatus === "manual" && student.mismatchCount === 1 ? (
                      <span className="text-amber-700 bg-amber-50 px-2 py-1 rounded-full">Manual (1 mismatch)</span>
                    ) : student.verificationStatus === "manual" ? (
                      <span className="text-amber-700 bg-amber-50 px-2 py-1 rounded-full">Manual</span>
                    ) : (
                      <span className="text-gray-500">Manual</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {student.disabled ? (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-200 text-gray-600 font-medium flex items-center gap-1 w-fit">
                        <Ban size={11} /> Disabled ({student.disabledReason === "transferred" ? "Transferred" : "Graduated"})
                      </span>
                    ) : (
                      getStatusBadge(student.status)
                    )}
                  </td>
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
              {sortedStudents.length === 0 && (!showAwaiting || filteredAwaiting.length === 0) && (
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
              {selected.profilePictureUrl ? (
                <img src={selected.profilePictureUrl} alt="" className="w-16 h-16 rounded-full object-cover mx-auto mb-3 border-2 border-white/30" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3 text-2xl font-bold text-white">
                  {selected.firstName.charAt(0)}{selected.lastName.charAt(0)}
                </div>
              )}
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
              {selected.verificationStatus === "manual" && !!selected.mismatchCount && (
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
