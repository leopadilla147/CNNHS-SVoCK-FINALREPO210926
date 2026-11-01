import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Search, CheckCircle, XCircle, AlertCircle, Clock, Eye, FileCheck, ChevronDown, ChevronUp, Users, Shield, FileSignature, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useApp, Candidate } from "../../context/AppContext";
import { positionRank } from "../../lib/partyScope";
import { reviewCandidacyRpc, insertAuditLog } from "../../lib/supabaseData";
import { isSupabaseConfigured } from "../../lib/supabase";
import { useConfirm } from "../../lib/useConfirm";

const PARTY_COLORS: Record<string, { bg: string; border: string; badge: string; text: string }> = {
  "Progress Party":  { bg: "#FFF5F5", border: "#5C0102", badge: "bg-red-100 text-red-700",    text: "#5C0102" },
  "Unity Alliance":  { bg: "#F0F4FF", border: "#1D4ED8", badge: "bg-blue-100 text-blue-700",   text: "#1D4ED8" },
  "Independent":     { bg: "#F9FAFB", border: "#6B7280", badge: "bg-gray-100 text-gray-600",   text: "#6B7280" },
};

const fallbackColor = { bg: "#F9FAFB", border: "#6B7280", badge: "bg-gray-100 text-gray-600", text: "#6B7280" };

// Deep links (dashboard stat cards, the pending banners) land here with a
// filter in the query string.  Anything that is not a filter chip of this
// page — notably "rejected", which this surface no longer offers — falls
// back to "all" instead of producing an empty, unexplained list.
const FILTER_VALUES = ["all", "pending", "approved"] as const;
const readStatusFilter = (param: string | null) =>
  param && FILTER_VALUES.includes(param as (typeof FILTER_VALUES)[number]) ? param : "all";

/**
 * The review surface keeps the Board's reading order instead of the database's
 * (candidates arrive newest submission first, which shuffles a party's slate):
 *   * panels read A→Z, with the Independent field last — it is not a party;
 *   * inside a panel, the canonical ballot order (President first, then the
 *     other executives and grade seats — see FULL_POSITION_ORDER), and
 *     surnames as the tie-breaker for two people in the same office.
 */
const byPartyOrder = (left: string, right: string) =>
  Number(left === "Independent") - Number(right === "Independent") ||
  left.localeCompare(right);

const byCandidateOrder = (left: Candidate, right: Candidate) =>
  positionRank(left.position) - positionRank(right.position) ||
  left.surname.localeCompare(right.surname) ||
  left.givenName.localeCompare(right.givenName);

/**
 * 112 — the rejection checklist as ONE merged list.  The low/high tier still
 * exists in the data model (it decides whether the student may revise or is
 * disqualified), but the modal no longer groups by it: the tier is derived —
 * any selected high-tier reason makes the rejection "high", otherwise "low".
 */
const REJECTION_REASONS: { reason: string; tier: "low" | "high" }[] = [
  { reason: "Unclear/Unacceptable Introduction Profile", tier: "low" },
  { reason: "Incomplete Documents", tier: "low" },
  { reason: "Form/Photo Errors", tier: "low" },
  { reason: "Failing Grade", tier: "high" },
  { reason: "Violation Record", tier: "high" },
  { reason: "Falsified Documents", tier: "high" },
  { reason: "Not a Bonafide Student", tier: "high" },
];

export default function AdminCandidates() {
  const { currentUser, candidates, setCandidates, electionPeriod, addLog, insertNotification, students } = useApp();
  const isChief = currentUser?.commissionerRole === "chief";
  const isScreening = currentUser?.commissionerRole === "screening_validation";
  // Phase 3 REMOVE-08: the 'appointment' commissioner role is gone — the
  // official-list surface is Chief/Screening gated only.
  const canReview = isChief || isScreening;
  const canAppoint = isChief;
  const logUser = currentUser?.name || "Administrator";
  const logRoleLabel = isChief ? "Chief Commissioner"
    : isScreening ? "Commissioner of Screening & Validation"
    : "Admin";
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(() => readStatusFilter(searchParams.get("filter")));
  const [expandedParty, setExpandedParty] = useState<string | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [officialListPosted, setOfficialListPosted] = useState(false);
  const [rejectDialog, setRejectDialog] = useState<Candidate | null>(null);
  const [rejectReasons, setRejectReasons] = useState<{ reason: string; tier: "low" | "high" }[]>([]);
  const [rejectOther, setRejectOther] = useState(false);
  const [rejectOtherText, setRejectOtherText] = useState("");
  const [rejectDetails, setRejectDetails] = useState("");
  // The tier is derived, never asked for: any high-tier reason disqualifies.
  // "Others" counts as low-tier (it only disqualifies alongside a high reason).
  const rejectTier = rejectReasons.some((r) => r.tier === "high")
    ? "high"
    : rejectReasons.length > 0 || (rejectOther && rejectOtherText.trim())
    ? "low"
    : null;
  const rejectReason = [
    ...rejectReasons.map((r) => r.reason),
    ...(rejectOther && rejectOtherText.trim() ? [rejectOtherText.trim()] : []),
  ].join("; ");
  const [actionError, setActionError] = useState<string | null>(null);
  const approveConfirm = useConfirm({ title: "Approve Candidate?", description: "This will approve the candidate's application for the election.", confirmText: "Approve" });
  const postListConfirm = useConfirm({ title: officialListPosted ? "Unpost Official List?" : "Post Official List?", description: officialListPosted ? "The official list will no longer be visible." : "The official list of candidates will be made visible.", confirmText: officialListPosted ? "Unpost" : "Post" });
  const informConfirm = useConfirm({ title: "Inform Candidates?", description: "Send notifications to all approved candidates about their status.", confirmText: "Send" });
  const meetingNoticeConfirm = useConfirm({ title: "Send Rules Discussion Meeting Notice?", description: "Send the meeting notice to all submitted and approved candidates.", confirmText: "Send Notice" });

  // Deep links (dashboard stat cards, banners, notification links) arrive
  // with ?filter=...; the chip is applied and the param is immediately
  // stripped from the address bar (replace, so Back doesn't resurrect it).
  // That way the tab always OPENS on "All" — the deep link only decides
  // which filter the very first view shows, it never sticks.
  useEffect(() => {
    const param = searchParams.get("filter");
    if (!param) return;
    setStatusFilter(readStatusFilter(param));
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  // A party candidate is only the Screening Office's business once their party
  // President has approved them.  The database refuses the action either way
  // (see 054's trigger); this keeps the queue honest for the Screening
  // Commissioner.  The Chief keeps the full picture.  Independents and party
  // Presidents are never gated.
  const awaitingPartyPresident = (c: Candidate) =>
    !!c.partyAffiliation &&
    c.position !== "President" &&
    c.positionApprovalStatus !== "presidentApproved";

  // Derive unique parties from all candidates, in the review reading order.
  const allParties = Array.from(
    new Set(candidates.map((c) => c.partyAffiliation || "Independent"))
  ).sort(byPartyOrder);

  const handleApprove = async (candidate: Candidate) => {
    const ok = await approveConfirm.confirm();
    if (!ok) return;
    setActionError(null);
    setProcessing(candidate.id);
    try {
      if (isSupabaseConfigured) {
        await reviewCandidacyRpc(candidate.id, "approve", undefined, undefined, undefined, currentUser?.id);
      }
      setCandidates(candidates.map((c) => c.id === candidate.id ? { ...c, status: "approved" } : c));
      const student = students.find((s) => s.id === candidate.studentId);
      if (student) {
        insertNotification({
          userId: student.id,
          role: "student",
          type: "candidacy_approved",
          title: "Candidacy Approved",
          message: `Your candidacy for ${candidate.position} has been approved by the Commissioner.`,
          link: "/student/dashboard",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setActionError(msg);
      addLog({
        user: logUser,
        role: "Admin",
        action: "Approval Failed",
        details: `Failed to approve ${candidate.givenName} ${candidate.surname}: ${msg}`,
        type: "error",
      });
    }
    setProcessing(null);
    setSelected(null);
  };

  const handleReject = async (candidate: Candidate) => {
    setRejectDialog(candidate);
    setRejectReasons([]);
    setRejectOther(false);
    setRejectOtherText("");
    setRejectDetails("");
  };

  const handleRejectWithReason = async () => {
    // 112: at least one reason (preset or a written "Others") AND the
    // Additional Remarks are both required before the RPC fires.
    if (!rejectDialog || !rejectReason || !rejectTier || !rejectDetails.trim()) return;
    setActionError(null);
    setProcessing(rejectDialog.id);
    try {
      if (isSupabaseConfigured) {
        await reviewCandidacyRpc(rejectDialog.id, "reject", rejectReason, rejectDetails || undefined, rejectTier, currentUser?.id);
      }
      const now = new Date().toISOString().split("T")[0];
      setCandidates(candidates.map((c) =>
        c.id === rejectDialog.id
          ? { ...c, status: "rejected" as const, rejectionReason: rejectReason, rejectionDetails: rejectDetails || undefined, rejectionTier: rejectTier }
          : c
      ));
      addLog({
        user: logUser,
        role: "Admin",
        action: "Rejected Candidacy",
        details: `Rejected ${rejectDialog.givenName} ${rejectDialog.surname} for ${rejectDialog.position}. Reason: ${rejectReason} (${rejectTier} tier)`,
        type: "warning",
      });
      const student = students.find((s) => s.id === rejectDialog.studentId);
      if (student) {
        insertNotification({
          userId: student.id,
          role: "student",
          type: "candidacy_rejected",
          title: "Candidacy Rejected",
          message: `Your candidacy for ${rejectDialog.position} has been rejected. Reason: ${rejectReason} (${rejectTier === "high" ? "Disqualified" : "Resubmission allowed"}).`,
          link: "/student/apply",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setActionError(msg);
      addLog({
        user: logUser,
        role: "Admin",
        action: "Rejection Failed",
        details: `Failed to reject ${rejectDialog.givenName} ${rejectDialog.surname}: ${msg}`,
        type: "error",
      });
    }
    setProcessing(null);
    setRejectDialog(null);
    setSelected(null);
  };

  const handlePostOfficialList = async () => {
    const ok = await postListConfirm.confirm();
    if (!ok) return;
    setOfficialListPosted(!officialListPosted);
    addLog({
      user: logUser,
      role: "Admin",
      action: officialListPosted ? "Unposted Official List" : "Posted Official List",
      details: officialListPosted
        ? "Official list of candidates has been unposted"
        : "Official list of candidates has been posted and made visible",
      type: officialListPosted ? "warning" : "success",
    });
    if (!officialListPosted) {
      const approvedCandidates = candidates.filter((c) => c.status === "approved");
      for (const c of approvedCandidates) {
        const student = students.find((s) => s.id === c.studentId);
        if (student) {
          insertNotification({
            userId: student.id,
            role: "student",
            type: "official_list_posted",
            title: "Official List Posted",
            message: "The official list of candidates has been posted. You are listed as an approved candidate.",
            link: "/student/candidates",
          });
        }
      }
    }
  };

  const handleInformCandidates = async () => {
    const ok = await informConfirm.confirm();
    if (!ok) return;
    await new Promise((r) => setTimeout(r, 500));
    addLog({
      user: logUser,
      role: "Admin",
      action: "Informed Candidates",
      details: `Notification sent to all approved candidates about their candidacy status`,
      type: "success",
    });
    const approvedCandidates = candidates.filter((c) => c.status === "approved");
    for (const c of approvedCandidates) {
      const student = students.find((s) => s.id === c.studentId);
      if (student) {
        insertNotification({
          userId: student.id,
          role: "student",
          type: "admin_notification",
          title: "Candidacy Status Update",
          message: `Your candidacy for ${c.position} has been reviewed. You are listed as an approved candidate.`,
          link: "/student/dashboard",
        });
      }
    }
  };

  const [meetingNotified, setMeetingNotified] = useState<Set<string>>(() => new Set());

  const handleSendMeetingNotice = async () => {
    // 058: a notice without a date is worse than no notice — it tells
    // candidates to show up to a meeting that was never scheduled. Stage 2 in
    // Election Setup owns rulesDiscussionAt; refuse to send until it exists.
    if (!electionPeriod.rulesDiscussionAt) {
      setActionError("Schedule the Rules Discussion Meeting in Election Setup before sending meeting notices.");
      return;
    }
    const ok = await meetingNoticeConfirm.confirm();
    if (!ok) return;
    setActionError(null);
    setProcessing("meeting-notice");
    const meetingDate = new Date(electionPeriod.rulesDiscussionAt);
    const meetingText = Number.isNaN(meetingDate.getTime())
      ? electionPeriod.rulesDiscussionAt
      : meetingDate.toLocaleString(undefined, {
          year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
    try {
      const recipients = candidates.filter(
        (c) => (c.status === "pending" || c.status === "approved") && !meetingNotified.has(c.id)
      );
      for (const c of recipients) {
        const student = students.find((s) => s.id === c.studentId);
        if (!student) continue;
        insertNotification({
          userId: student.id,
          role: "student",
          type: "rules_discussion_meeting",
          title: "Rules Discussion Meeting",
          message: `You are invited to attend the Rules Discussion Meeting on ${meetingText}. See you there!`,
          link: "/student/dashboard",
        });
        setMeetingNotified((prev) => new Set(prev).add(c.id));
      }
      const methodLabel =
        electionPeriod.votingMethod === "plurality_with_run_off" ? "plurality with run-off"
        : electionPeriod.votingMethod === "ranked_choice" ? "ranked choice"
        : "plurality";
      addLog({
        user: logUser,
        role: "Admin",
        action: "Sent Rules Discussion Meeting Notice",
        details: `Meeting notice sent to ${recipients.length} submitted/approved candidate(s). Rules discussion date: ${meetingText}, voting method: ${methodLabel}`,
        type: "success",
      });
      if (currentUser?.id) {
        await insertAuditLog({
          user: logUser,
          role: "Admin",
          action: "Sent Rules Discussion Meeting Notice",
          details: `Meeting notice sent to ${recipients.length} submitted/approved candidate(s). Rules discussion date: ${meetingText}, voting method: ${methodLabel}`,
          type: "success",
        }, currentUser.id);
      }
      setActionError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setActionError(msg);
      addLog({
        user: logUser,
        role: "Admin",
        action: "Meeting Notice Failed",
        details: `Failed to send rules discussion meeting notice: ${msg}`,
        type: "error",
      });
    }
    setProcessing(null);
  };

  const getStatusBadge = (status: string) => {
    if (status === "approved") return <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1 w-fit"><CheckCircle size={11} /> Approved</span>;
    if (status === "rejected") return <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium flex items-center gap-1 w-fit"><XCircle size={11} /> Rejected</span>;
    if (status === "ongoingSubmission") return <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center gap-1 w-fit"><Clock size={11} /> Ongoing Submission</span>;
    return <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1 w-fit"><Clock size={11} /> Pending</span>;
  };

  const docsComplete = (docs: Candidate["documents"]) => Object.values(docs).every(Boolean);

  // Filter candidates for inside a party panel, in canonical ballot order.
  const getPartyMembers = (party: string) => {
    return candidates
      .filter((c) => {
        const matchParty = (c.partyAffiliation || "Independent") === party;
        const matchSearch = search === "" ||
          `${c.givenName} ${c.surname} ${c.position}`.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "all" || c.status === statusFilter;
        // A screening commissioner only sees what is ready to be screened.
        const matchGate = isChief || !awaitingPartyPresident(c);
        // Rejected candidacies are no longer part of this review surface.
        const notRejected = c.status !== "rejected";
        return matchParty && matchSearch && matchStatus && matchGate && notRejected;
      })
      .sort(byCandidateOrder);
  };

  // Party summary stats
  const getPartySummary = (party: string) => {
    const members = candidates.filter(
      (c) => (c.partyAffiliation || "Independent") === party && c.status !== "rejected"
    );
    return {
      total: members.length,
      pending: members.filter((c) => c.status === "pending").length,
    };
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-gray-900 mb-1">Candidate Management</h1>
              {isChief && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Chief Commissioner</span>}
            </div>
            <p className="text-gray-500 text-sm">
              {isChief && "Full control over candidates and the official list."}
              {isScreening && "Review and validate candidate applications."}
            </p>
          </div>
        </div>
      </motion.div>

      {actionError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Action failed</p>
            <p className="text-xs text-red-600 mt-0.5">{actionError}</p>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {canAppoint && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <h3 className="text-gray-900 text-sm flex items-center gap-2 mb-4">
            <Shield size={16} style={{ color: "#5C0102" }} /> Official List &amp; Notices
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handlePostOfficialList}
              className={`px-4 py-2 rounded-xl text-xs font-medium ${
                officialListPosted
                  ? "bg-green-100 text-green-700 border border-green-200"
                  : "text-white"
              }`}
              style={!officialListPosted ? { backgroundColor: "#5C0102" } : {}}
            >
              {officialListPosted ? "✓ Official List Posted" : "Post Official List"}
            </button>
            <button
              onClick={handleInformCandidates}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
            >
              Inform Candidates
            </button>
            <button
              onClick={handleSendMeetingNotice}
              disabled={processing === "meeting-notice"}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Calendar size={14} />
              {processing === "meeting-notice" ? "Sending Notice..." : "Send Meeting Notice"}
            </button>
          </div>
        </div>
      )}

      {/* Overall Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total Applications", count: candidates.length, color: "#5C0102" },
          { label: "Pending", count: candidates.filter((c) => c.status === "pending").length, color: "#F59E0B" },
          { label: "Approved", count: candidates.filter((c) => c.status === "approved").length, color: "#10B981" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <div className="text-2xl font-bold mb-0.5" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + Status filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or position..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {["all", "pending", "approved"].map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${statusFilter === f ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={statusFilter === f ? { backgroundColor: "#5C0102" } : {}}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Party Cards */}
      <div className="space-y-4">
        {allParties.map((party, pi) => {
          const summary = getPartySummary(party);
          const members = getPartyMembers(party);
          const color = PARTY_COLORS[party] ?? fallbackColor;
          const isOpen = expandedParty === party;

          return (
            <motion.div
              key={party}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: pi * 0.06 }}
              className="bg-white rounded-2xl shadow-sm overflow-hidden"
              style={{ border: `2px solid ${isOpen ? color.border : "#E5E7EB"}` }}
            >
              {/* Party Header — clickable */}
              <button
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors text-left"
                onClick={() => setExpandedParty(isOpen ? null : party)}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: color.bg, border: `1.5px solid ${color.border}` }}
                  >
                    <Shield size={22} style={{ color: color.text }} />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{party}</div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Users size={11} /> {summary.total} member{summary.total !== 1 ? "s" : ""}
                      </span>
                      {summary.pending > 0 && (
                        <span className="text-xs text-amber-600 font-medium">{summary.pending} pending</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${color.badge}`}>
                    {party}
                  </span>
                  {isOpen
                    ? <ChevronUp size={18} className="text-gray-400" />
                    : <ChevronDown size={18} className="text-gray-400" />}
                </div>
              </button>

              {/* Expanded Member Table */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-gray-100">
                      {members.length === 0 ? (
                        <div className="py-10 text-center text-gray-400 text-sm">
                          No members match the current filter.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr style={{ backgroundColor: color.bg }}>
                                <th className="text-left py-3 px-5 text-xs font-medium text-gray-500">Candidate</th>
                                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Position</th>
                                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Grade</th>
                                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Documents</th>
                                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Status</th>
                                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {members.map((candidate) => (
                                <tr key={candidate.id} className="hover:bg-gray-50 transition-colors">
                                  <td className="py-3 px-5">
                                    <div className="flex items-center gap-2">
                                      {candidate.picture ? (
                                        <img src={candidate.picture} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-gray-200" />
                                      ) : (
                                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs flex-shrink-0">
                                          {candidate.givenName.charAt(0)}
                                        </div>
                                      )}
                                      <div>
                                        <div className="font-medium text-gray-900 text-sm">
                                          {candidate.givenName} {candidate.surname}
                                        </div>
                                        <div className="text-xs text-gray-400">{candidate.email}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 text-gray-600 text-xs">
                                    {candidate.position}
                                    {/* The Chief sees every candidate, so say plainly
                                        which ones their party President has not
                                        vouched for yet. */}
                                    {isChief && awaitingPartyPresident(candidate) && (
                                      <div className="text-[10px] text-amber-600 mt-0.5">
                                        Awaiting party President
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-gray-500 text-xs">{candidate.gradeLevel}</td>
                                  <td className="py-3 px-4">
                                    {docsComplete(candidate.documents) ? (
                                      <span className="flex items-center gap-1 text-xs text-green-600">
                                        <FileCheck size={12} /> Complete
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-xs text-red-500">
                                        <XCircle size={12} /> Incomplete
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4">
                                    {getStatusBadge(candidate.status)}
                                    {candidate.status === "rejected" && candidate.rejectionReason && (
                                      <div className="text-[10px] text-red-500 mt-0.5 max-w-[120px] truncate" title={candidate.rejectionReason}>
                                        {candidate.rejectionReason}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3 px-4">
                                    {/* 112: one action only — the decision
                                        (approve/reject) lives inside the
                                        details modal. */}
                                    <button
                                      onClick={() => setSelected(candidate)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 transition-colors"
                                    >
                                      <Eye size={13} /> View Application Details
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
          onClick={() => setSelected(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-white" style={{ backgroundColor: "#5C0102" }}>
              <div className="flex items-center gap-4">
                {selected.picture ? (
                  <img src={selected.picture} alt="" className="w-16 h-16 rounded-full object-cover border-4 border-white/30 flex-shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold flex-shrink-0">
                    {selected.givenName.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="text-white">
                    {selected.givenName} {selected.middleName} {selected.surname} {selected.extensionName}
                  </h3>
                  <p className="text-white/70 text-sm">{selected.position}</p>
                  <p className="text-white/60 text-xs mt-0.5">{selected.partyAffiliation || "Independent"}</p>
                  <div className="mt-1">{getStatusBadge(selected.status)}</div>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Party", selected.partyAffiliation || "Independent"],
                  ["Grade Level", selected.gradeLevel],
                  ["Gender", selected.gender],
                  ["Age", `${selected.age} years old`],
                  ["Date of Birth", selected.dateOfBirth],
                  ["Mobile", selected.mobileNumber],
                  ["Email", selected.email],
                  ["Address", selected.homeAddress],
                  ...(selected.landline ? [["Landline", selected.landline]] : []),
                ].map(([label, val]) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-400 mb-0.5">{label}</div>
                    <div className="text-gray-800 font-medium text-xs break-all">{val}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">EAF Documents</div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  {selected.eafFrontImage && selected.eafBackImage ? (
                    <span className="text-green-600">Front & back photos uploaded</span>
                  ) : selected.eafFrontImage || selected.eafBackImage ? (
                    <span className="text-amber-600">Partial upload — only one side</span>
                  ) : (
                    <span className="text-gray-400">No EAF photos uploaded yet</span>
                  )}
                </div>
              </div>

              {/* EAF Document Images */}
              {(selected.eafFrontImage || selected.eafBackImage) && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">EAF Document Photos</div>
                  <div className="grid grid-cols-2 gap-3">
                    {selected.eafFrontImage && (
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Front side</div>
                        <img
                          src={selected.eafFrontImage}
                          alt="EAF Front"
                          className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(selected.eafFrontImage, "_blank")}
                        />
                      </div>
                    )}
                    {selected.eafBackImage && (
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Back side</div>
                        <img
                          src={selected.eafBackImage}
                          alt="EAF Back"
                          className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(selected.eafBackImage, "_blank")}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Leadership Profile */}
              {selected.leadershipProfile && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Introductory Profile</div>
                  <div className="space-y-3 text-sm">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">Leadership Qualities</div>
                      <div className="text-gray-800 whitespace-pre-wrap">{selected.leadershipProfile.qualities}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">Organizational Skills</div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {selected.leadershipProfile.skills.map((skill) => (
                          <span key={skill} className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">{skill}</span>
                        ))}
                      </div>
                      <div className="text-gray-800 text-xs whitespace-pre-wrap">{selected.leadershipProfile.skillsExplanation}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">3-Year Vision</div>
                      <div className="text-gray-800 whitespace-pre-wrap">{selected.leadershipProfile.threeYearVision}</div>
                    </div>
                  </div>
                </div>
              )}

              {selected.status === "rejected" && selected.rejectionReason && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="text-xs font-medium text-red-700 mb-1 uppercase tracking-wide">Rejection Reason</div>
                  <div className="text-sm text-red-800 font-medium">{selected.rejectionReason}</div>
                  {selected.rejectionTier && (
                    <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      selected.rejectionTier === "low" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    }`}>
                      {selected.rejectionTier === "low" ? "Low Severity — Resubmission Allowed" : "High Severity — Disqualified"}
                    </span>
                  )}
                  {selected.rejectionDetails && (
                    <div className="mt-2 text-xs text-red-600">{selected.rejectionDetails}</div>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                {selected.status === "pending" && canReview && (
                  <>
                    <button
                      onClick={() => handleApprove(selected)}
                      disabled={processing === selected.id}
                      className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => handleReject(selected)}
                      disabled={processing === selected.id}
                      className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      ✗ Reject
                    </button>
                  </>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {/* Rejection Reason Dialog */}
      {rejectDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
          onClick={() => setRejectDialog(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-white" style={{ backgroundColor: "#5C0102" }}>
              <h3 className="text-white">Reject Candidate</h3>
              <p className="text-white/70 text-sm mt-1">
                {rejectDialog.givenName} {rejectDialog.surname} &mdash; {rejectDialog.position}
              </p>
            </div>
            <div className="p-5 space-y-4 text-sm">
              {/* 112: one merged checklist — severity is derived, not asked. */}
              <div>
                <h4 className="font-medium text-gray-800 mb-2 text-xs uppercase tracking-wide">
                  Reason for Rejection <span className="text-red-500">*</span>
                </h4>
                <div className="space-y-1.5">
                  {REJECTION_REASONS.map(({ reason, tier }) => {
                    const checked = rejectReasons.some((r) => r.reason === reason);
                    return (
                      <label
                        key={reason}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                          checked ? "border-[#5C0102] bg-red-50" : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setRejectReasons((prev) =>
                              checked
                                ? prev.filter((r) => r.reason !== reason)
                                : [...prev, { reason, tier }]
                            );
                          }}
                          className="accent-[#5C0102]"
                        />
                        <span className="text-gray-700">{reason}</span>
                      </label>
                    );
                  })}
                  <label
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      rejectOther ? "border-[#5C0102] bg-red-50" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={rejectOther}
                      onChange={() => setRejectOther((prev) => !prev)}
                      className="accent-[#5C0102]"
                    />
                    <span className="text-gray-700">Others</span>
                  </label>
                  {rejectOther && (
                    <input
                      type="text"
                      value={rejectOtherText}
                      onChange={(e) => setRejectOtherText(e.target.value)}
                      placeholder="Specify the reason..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1.5">
                  Additional Remarks <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectDetails}
                  onChange={(e) => setRejectDetails(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                  placeholder="Explain the decision for the student..."
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setRejectDialog(null)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectWithReason}
                  disabled={!rejectReason || !rejectDetails.trim() || processing === rejectDialog.id}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {processing === rejectDialog.id ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                      Rejecting...
                    </span>
                  ) : (
                    "Reject Candidate"
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {approveConfirm.dialog}
      {postListConfirm.dialog}
      {informConfirm.dialog}
      {meetingNoticeConfirm.dialog}
    </div>
  );
}
