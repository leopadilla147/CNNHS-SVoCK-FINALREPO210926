import { useState } from "react";
import { motion } from "motion/react";
import {
  Trophy,
  Calendar,
  Clock,
  FileText,
  ChevronRight,
  Bell,
  UserPlus,
  CheckCircle,
  XCircle,
  Users,
  ShieldCheck,
  Award,
  Vote,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "react-router";
import { useApp } from "../../context/AppContext";
import { requestPartyMembershipRpc, reviewPartyMembershipRpc } from "../../lib/supabaseData";
import { useConfirm } from "../../lib/useConfirm";

const formatCandidateStatus = (status: string) =>
  status === "ongoingSubmission" ? "Ongoing Submission" : status.charAt(0).toUpperCase() + status.slice(1);

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function StudentDashboard() {
  const {
    candidates,
    electionPeriod,
    currentUser,
    students,
    notifications,
    unreadCount,
    markAsRead,
    partyMembers,
    fetchPartyMembers,
    insertNotification,
    addLog,
  } = useApp();

  const [requestingParty, setRequestingParty] = useState<string | null>(null);
  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const approveConfirm = useConfirm({
    title: "Approve Member?",
    description: "Approve this student's request to join your party?",
    confirmText: "Approve",
  });
  const rejectConfirm = useConfirm({
    title: "Reject Member?",
    description: "Reject this student's request to join your party?",
    confirmText: "Reject",
    destructive: true,
  });

  const currentStudent = students.find((s) => s.id === currentUser?.id);
  const myApplication = candidates.find((c) => c.studentId === currentUser?.id);
  const myParty = myApplication?.status === "approved" ? (myApplication.partyAffiliation ?? null) : null;

  // Determine if current user is a party president
  const isPartyPresident = myApplication?.status === "approved" && myApplication?.position === "President";
  const myPartyId = myApplication?.partyId;

  // Pending membership requests for party president
  const pendingRequests = partyMembers.filter(
    (pm) => pm.status === "pending" && myParty && pm.partyId === myPartyId
  );

  // Available parties for requesting membership
  const existingParties = Array.from(
    new Set(
      candidates
        .filter((c) => c.status === "approved" && c.partyAffiliation && c.partyAffiliation !== "Independent")
        .map((c) => c.partyAffiliation as string)
    )
  );

  // Check if student already has a pending/approved membership
  const myMemberships = partyMembers.filter((pm) => pm.studentId === currentUser?.id);
  const hasPendingMembership = myMemberships.some((pm) => pm.status === "pending");
  const hasApprovedMembership = myMemberships.some((pm) => pm.status === "approved");

  // Resolve a party's real id from its president's candidacy
  const getPartyId = (partyName: string) =>
    candidates.find(
      (c) => c.partyAffiliation === partyName && c.position === "President" && c.status === "approved"
    )?.partyId;

  const handleRequestMembership = async (partyName: string) => {
    if (!currentUser?.id || requestingParty) return;
    setRequestingParty(partyName);
    try {
      const partyId = getPartyId(partyName);
      if (!partyId) {
        addLog({
          user: currentUser?.name || "Student",
          role: "Student",
          action: "Party Request Failed",
          details: "No party president found for " + partyName,
          type: "error",
        });
        return;
      }
      await requestPartyMembershipRpc(partyId, currentUser.id);
      await fetchPartyMembers();
      insertNotification({
        userId: currentUser.id,
        role: "student",
        type: "party_membership_request",
        title: "Membership Request Sent",
        message: `Your request to join ${partyName} has been sent to the party president.`,
        link: "/student/dashboard",
      });
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Requested Party Membership",
        details: `Requested to join ${partyName}`,
        type: "info",
      });
    } catch (err) {
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Party Request Failed",
        details: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    }
    setRequestingParty(null);
  };

  const handleReviewMembership = async (memberId: string, action: "approve" | "reject") => {
    const confirmed = action === "approve" ? await approveConfirm.confirm() : await rejectConfirm.confirm();
    if (!confirmed) return;
    if (!currentUser?.id) return;
    setProcessingMember(memberId);
    try {
      await reviewPartyMembershipRpc(memberId, action, currentUser.id);
      await fetchPartyMembers();
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: action === "approve" ? "Approved Party Member" : "Rejected Party Member",
        details: `Member request ${action}d`,
        type: action === "approve" ? "success" : "warning",
      });
    } catch (err) {
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Review Failed",
        details: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    }
    setProcessingMember(null);
  };

  const unreadNotifications = notifications.filter((n) => !n.isRead).slice(0, 5);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6">

      {/* Quick Action Navigation Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            title: "Official Candidates",
            subtitle: "View party rosters & platforms",
            to: "/student/candidates",
            icon: Vote,
            color: "#5C0102",
          },
          {
            title: "Candidacy Filing",
            subtitle: myApplication ? "Check application status" : "Submit candidacy application",
            to: "/student/apply",
            icon: Award,
            color: "#8B0103",
          },
          {
            title: "File Grievance / Report",
            subtitle: "Submit concerns to Electoral Board",
            to: "/student/complaints",
            icon: AlertTriangle,
            color: "#B91C1C",
          },
          {
            title: "Voter Profile",
            subtitle: "View credentials & LRN record",
            to: "/student/profile",
            icon: ShieldCheck,
            color: "#475569",
          },
        ].map((action, i) => {
          const Icon = action.icon;
          return (
            <Link key={action.title} to={action.to}>
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
                className="bg-white rounded-2xl p-5 border border-gray-200/90 shadow-xs hover:border-[#5C0102] hover:shadow-md transition-all group flex flex-col justify-between h-full"
              >
                <div className="flex items-start justify-between mb-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform"
                    style={{ backgroundColor: action.color }}
                  >
                    <Icon size={20} />
                  </div>
                  <ArrowUpRight
                    size={16}
                    className="text-gray-400 group-hover:text-[#5C0102] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm group-hover:text-[#5C0102] transition-colors">
                    {action.title}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {action.subtitle}
                  </p>
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>

      {/* Notifications Section */}
      {unreadNotifications.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-[#5C0102]">
                <Bell size={16} />
              </div>
              <div>
                <span className="font-bold text-gray-900 text-sm">Recent Election Notices</span>
                <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full text-white bg-red-600">
                  {unreadCount} unread
                </span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {unreadNotifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => {
                  markAsRead(notif.id);
                  if (notif.link) window.location.href = notif.link;
                }}
                className="w-full text-left flex items-start gap-3 p-3.5 rounded-xl hover:bg-gray-50/90 border border-transparent hover:border-gray-200 transition-all cursor-pointer"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0 mt-2"
                  style={{ backgroundColor: "#5C0102" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-gray-900">{notif.title}</div>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 leading-relaxed">
                    {notif.message}
                  </p>
                </div>
                <span className="text-[11px] text-gray-400 shrink-0 font-medium">
                  {timeAgo(notif.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Party President: Pending Membership Requests */}
      {isPartyPresident && pendingRequests.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xs border border-amber-200 p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700">
              <Users size={16} />
            </div>
            <div>
              <span className="font-bold text-gray-900 text-sm">
                Pending Party Membership Requests ({pendingRequests.length})
              </span>
              <p className="text-xs text-gray-500">
                As Party President, review students requesting to join your party.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {pendingRequests.map((req) => {
              const memberName = req.studentName || "Student";
              return (
                <div
                  key={req.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 gap-3"
                >
                  <div>
                    <div className="text-sm font-bold text-gray-900">{memberName}</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {req.partyName ? `${req.partyName} · ` : ""}
                      {req.studentGrade ? `Grade ${req.studentGrade}` : "Grade N/A"} &middot; Requested{" "}
                      {timeAgo(req.requestedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={() => handleReviewMembership(req.id, "approve")}
                      disabled={processingMember === req.id}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {processingMember === req.id ? (
                        <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <CheckCircle size={13} />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={() => handleReviewMembership(req.id, "reject")}
                      disabled={processingMember === req.id}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      <XCircle size={13} /> Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Party Membership Request UI — hidden for approved candidates */}
      {!myParty && myApplication?.status !== "approved" && !hasPendingMembership && !hasApprovedMembership && existingParties.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-[#5C0102]">
              <UserPlus size={16} />
            </div>
            <span className="font-bold text-gray-900 text-sm">Join an Existing Political Party</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Request membership to an accredited party. Your request will be evaluated by the party president.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {existingParties.map((partyName) => {
              const alreadyRequested = partyMembers.some(
                (pm) => pm.partyId === getPartyId(partyName) && pm.status === "pending"
              );
              return (
                <button
                  key={partyName}
                  onClick={() => handleRequestMembership(partyName)}
                  disabled={requestingParty === partyName || alreadyRequested}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 text-white cursor-pointer hover:brightness-105 active:scale-98 shadow-xs"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  {requestingParty === partyName ? (
                    <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <UserPlus size={13} />
                  )}
                  {alreadyRequested ? "Requested" : `Join ${partyName}`}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Membership status alerts */}
      {hasPendingMembership && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900"
        >
          <Clock size={20} className="text-amber-600 shrink-0" />
          <div>
            <div className="text-xs font-bold text-amber-900">Party Membership Request Pending</div>
            <div className="text-xs text-amber-700 mt-0.5">
              Waiting for the {myMemberships[0]?.partyName ? `${myMemberships[0].partyName} president` : "party president"} to review your application.
            </div>
          </div>
        </motion.div>
      )}

      {hasApprovedMembership && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-900"
        >
          <CheckCircle size={20} className="text-emerald-600 shrink-0" />
          <div>
            <div className="text-xs font-bold text-emerald-900">Official Party Member</div>
            <div className="text-xs text-emerald-700 mt-0.5">
              You are recognized as an affiliated member of your political party.
            </div>
          </div>
        </motion.div>
      )}

      {/* My Candidacy Application Status Card */}
      {myApplication && (
        <Link to="/student/apply" className="block">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6 hover:border-[#5C0102] hover:shadow-md transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center text-[#5C0102]">
                  <FileText size={18} />
                </div>
                <div>
                  <span className="font-bold text-gray-900 text-sm">My Candidacy Application</span>
                  <div className="text-xs text-gray-500">Click to view details or upload requirements</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-3 py-1 rounded-full font-bold ${
                    myApplication.status === "approved"
                      ? "bg-emerald-100 text-emerald-800"
                      : myApplication.status === "rejected"
                      ? "bg-red-100 text-red-800"
                      : myApplication.status === "ongoingSubmission"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {formatCandidateStatus(myApplication.status)}
                </span>
                <ChevronRight size={18} className="text-gray-400" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100 text-xs">
              <div className="bg-gray-50/70 p-3 rounded-xl">
                <span className="text-gray-400 block mb-1">Target Position</span>
                <span className="font-bold text-gray-800">{myApplication.position}</span>
              </div>
              <div className="bg-gray-50/70 p-3 rounded-xl">
                <span className="text-gray-400 block mb-1">Party Affiliation</span>
                <span className="font-bold text-gray-800">
                  {myApplication.status === "approved"
                    ? (myApplication.partyAffiliation || "Independent")
                    : "Pending verification"}
                </span>
              </div>
              <div className="bg-gray-50/70 p-3 rounded-xl">
                <span className="text-gray-400 block mb-1">Submission Date</span>
                <span className="font-bold text-gray-800">{myApplication.submittedAt}</span>
              </div>
            </div>
          </motion.div>
        </Link>
      )}

      {/* Party Banner if Candidate */}
      {myParty && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-5 flex items-center justify-between shadow-xs text-white"
          style={{ background: "linear-gradient(135deg, #5C0102, #8B0103)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Trophy size={20} className="text-amber-300" />
            </div>
            <div>
              <div className="text-white text-sm font-bold">Your Party: {myParty}</div>
              <div className="text-white/70 text-xs mt-0.5">
                Official slate running in the Camarines Norte NHS General Elections
              </div>
            </div>
          </div>
          <Link
            to="/student/candidates"
            className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-semibold text-white transition-colors"
          >
            <span>View Slate</span>
            <ChevronRight size={14} />
          </Link>
        </motion.div>
      )}

      {/* Campaign & Election Info for approved candidates */}
      {myApplication?.status === "approved" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-[#5C0102]">
              <Calendar size={16} />
            </div>
            <h3 className="font-bold text-gray-900 text-sm">Official Campaign & Election Schedule</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-gray-50/80 rounded-xl p-3.5 border border-gray-100">
              <div className="text-gray-400 mb-1">Affiliation</div>
              <div className="font-bold text-gray-900">{myParty || "Independent"}</div>
            </div>
            <div className="bg-gray-50/80 rounded-xl p-3.5 border border-gray-100">
              <div className="text-gray-400 mb-1">Candidacy Status</div>
              <div className="font-bold text-emerald-700">Official Candidate</div>
            </div>
            <div className="bg-gray-50/80 rounded-xl p-3.5 border border-gray-100">
              <div className="text-gray-400 mb-1">Voting Day</div>
              <div className="font-bold text-gray-900">{electionPeriod.startDate || "To be scheduled"}</div>
            </div>
            <div className="bg-gray-50/80 rounded-xl p-3.5 border border-gray-100">
              <div className="text-gray-400 mb-1">Voting Hours</div>
              <div className="font-bold text-gray-900">
                {electionPeriod.startTime && electionPeriod.endTime
                  ? `${electionPeriod.startTime} – ${electionPeriod.endTime}`
                  : "Standard school hours"}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {approveConfirm.dialog}
      {rejectConfirm.dialog}
    </div>
  );
}
