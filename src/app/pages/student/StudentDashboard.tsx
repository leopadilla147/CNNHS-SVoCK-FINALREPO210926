import { useState } from "react";
import { motion } from "motion/react";
import { Trophy, Calendar, Clock, FileText, ChevronRight, Bell, UserPlus, CheckCircle, XCircle, Users, Shield } from "lucide-react";
import { Link } from "react-router";
import { useApp, AppNotification } from "../../context/AppContext";
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
    candidates, electionPeriod, currentUser, students,
    notifications, unreadCount, markAsRead,
    partyMembers, setPartyMembers, fetchPartyMembers, insertNotification,
    addLog,
  } = useApp();
  const [requestingParty, setRequestingParty] = useState<string | null>(null);
  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const approveConfirm = useConfirm({ title: "Approve Member?", description: "Approve this student's request to join your party?", confirmText: "Approve" });
  const rejectConfirm = useConfirm({ title: "Reject Member?", description: "Reject this student's request to join your party?", confirmText: "Reject", destructive: true });

  const currentStudent = students.find((s) => s.id === currentUser?.id);
  const myApplication = candidates.find((c) => c.studentId === currentUser?.id);
  const myParty = myApplication?.status === "approved" ? (myApplication.partyAffiliation ?? null) : null;

  // Determine if current user is a party president
  const isPartyPresident = myApplication?.status === "approved" && myApplication?.position === "President";

  // The party id for the president's party (candidate.partyId references parties.id)
  const myPartyId = myApplication?.partyId;

  // Pending membership requests for party president
  const pendingRequests = partyMembers.filter(
    (pm) => pm.status === "pending" && myParty && pm.partyId === myPartyId
  );

  // Available parties for requesting membership
  const existingParties = Array.from(new Set(
    candidates.filter((c) => c.status === "approved" && c.partyAffiliation && c.partyAffiliation !== "Independent")
      .map((c) => c.partyAffiliation as string)
  ));

  // Check if student already has a pending/approved membership
  const myMemberships = partyMembers.filter((pm) => pm.studentId === currentUser?.id);
  const hasPendingMembership = myMemberships.some((pm) => pm.status === "pending");
  const hasApprovedMembership = myMemberships.some((pm) => pm.status === "approved");

  // Resolve a party's real id (parties.id) from its president's candidacy
  const getPartyId = (partyName: string) =>
    candidates.find(
      (c) => c.partyAffiliation === partyName && c.position === "President" && c.status === "approved"
    )?.partyId;

  const handleRequestMembership = async (partyName: string) => {
    if (!currentUser?.id || requestingParty) return;
    setRequestingParty(partyName);
    try {
      // Resolve the party's real id from its President candidate's candidacy
      const partyId = getPartyId(partyName);
      if (!partyId) {
        addLog({ user: currentUser?.name || "Student", role: "Student", action: "Party Request Failed", details: "No party president found for " + partyName, type: "error" });
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
      addLog({ user: currentUser?.name || "Student", role: "Student", action: "Requested Party Membership", details: `Requested to join ${partyName}`, type: "info" });
    } catch (err) {
      addLog({ user: currentUser?.name || "Student", role: "Student", action: "Party Request Failed", details: err instanceof Error ? err.message : "Unknown error", type: "error" });
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
      addLog({ user: currentUser?.name || "Student", role: "Student", action: action === "approve" ? "Approved Party Member" : "Rejected Party Member", details: `Member request ${action}d`, type: action === "approve" ? "success" : "warning" });
    } catch (err) {
      addLog({ user: currentUser?.name || "Student", role: "Student", action: "Review Failed", details: err instanceof Error ? err.message : "Unknown error", type: "error" });
    }
    setProcessingMember(null);
  };

  const unreadNotifications = notifications.filter((n) => !n.isRead).slice(0, 5);

  const stats = [
    ...(electionPeriod.isActive
      ? [
          { label: "Voting Date", value: electionPeriod.startDate, icon: <Calendar size={20} />, color: "#8B0103" },
          { label: "Voting Hours", value: `${electionPeriod.startTime} – ${electionPeriod.endTime}`, icon: <Clock size={20} />, color: "#5C0102" },
        ]
      : [
          { label: "Election Status", value: "Not Active", icon: <Clock size={20} />, color: "#9CA3AF" },
        ]),
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Welcome */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Welcome back, {currentUser?.name.split(" ")[0]}!</h1>
        <p className="text-gray-500 text-sm">Here's your election overview for this period.</p>
      </motion.div>

      {/* Recent Notifications Card */}
      {unreadNotifications.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bell size={16} style={{ color: "#5C0102" }} />
              <span className="font-medium text-gray-900 text-sm">Recent Notifications</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: "#EF4444" }}>{unreadCount} new</span>
            </div>
          </div>
          <div className="space-y-2">
            {unreadNotifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => { markAsRead(notif.id); if (notif.link) window.location.href = notif.link; }}
                className="w-full text-left flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: "#5C0102" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{notif.title}</div>
                  <p className="text-xs text-gray-500 mt-0.5">{notif.message}</p>
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(notif.createdAt)}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: stat.color }}>
                {stat.icon}
              </div>
            </div>
            <div className="text-lg font-bold text-gray-900">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Party President: Pending Membership Requests */}
      {isPartyPresident && pendingRequests.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm border border-amber-200 p-5 mb-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} style={{ color: "#D97706" }} />
            <span className="font-medium text-gray-900 text-sm">Pending Party Membership Requests ({pendingRequests.length})</span>
          </div>
          <div className="space-y-3">
            {pendingRequests.map((req) => {
              const memberName = req.studentName || "Student";
              return (
                <div key={req.id} className="flex items-center justify-between p-3 rounded-lg bg-amber-50 border border-amber-100">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{memberName}</div>
                    <div className="text-xs text-gray-500">{req.partyName ? `${req.partyName} · ` : ""}{req.studentGrade || "N/A"} &middot; Requested {timeAgo(req.requestedAt)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReviewMembership(req.id, "approve")}
                      disabled={processingMember === req.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 transition-colors disabled:opacity-60"
                    >
                      {processingMember === req.id ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={12} />}
                      Approve
                    </button>
                    <button
                      onClick={() => handleReviewMembership(req.id, "reject")}
                      disabled={processingMember === req.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      <XCircle size={12} /> Reject
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
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <UserPlus size={16} style={{ color: "#5C0102" }} />
            <span className="font-medium text-gray-900 text-sm">Join a Party</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">Request to join an existing party. The party president will review your request.</p>
          <div className="flex flex-wrap gap-2">
            {existingParties.map((partyName) => {
              const alreadyRequested = partyMembers.some(
                (pm) => pm.partyId === getPartyId(partyName) && pm.status === "pending"
              );
              return (
                <button
                  key={partyName}
                  onClick={() => handleRequestMembership(partyName)}
                  disabled={requestingParty === partyName || alreadyRequested}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-50 text-white"
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

      {/* Membership status info */}
      {hasPendingMembership && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-4 mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200"
        >
          <Clock size={18} className="text-amber-600" />
          <div>
            <div className="text-sm font-medium text-amber-800">Membership Request Pending</div>
            <div className="text-xs text-amber-600">Waiting for the {myMemberships[0]?.partyName ? `${myMemberships[0].partyName} president` : "party president"} to review your request.</div>
          </div>
        </motion.div>
      )}

      {hasApprovedMembership && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-4 mb-6 flex items-center gap-3 bg-green-50 border border-green-200"
        >
          <CheckCircle size={18} className="text-green-600" />
          <div>
            <div className="text-sm font-medium text-green-800">Party Member</div>
            <div className="text-xs text-green-600">You are a member of a party.</div>
          </div>
        </motion.div>
      )}

      {/* My Application Status — clickable */}
      {myApplication && (
        <Link to="/student/apply">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-8 hover:shadow-md transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText size={18} style={{ color: "#5C0102" }} />
                <span className="font-medium text-gray-900 text-sm">My Candidacy Application</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    myApplication.status === "approved"
                      ? "bg-green-100 text-green-700"
                      : myApplication.status === "rejected"
                      ? "bg-red-100 text-red-700"
                      : myApplication.status === "ongoingSubmission"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {formatCandidateStatus(myApplication.status)}
                </span>
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
              <span>Position: <strong>{myApplication.position}</strong></span>
              <span>Party: <strong>{myApplication.status === "approved" ? (myApplication.partyAffiliation || "Independent") : "Pending approval"}</strong></span>
              <span>Submitted: <strong>{myApplication.submittedAt}</strong></span>
            </div>
          </motion.div>
        </Link>
      )}

      {/* Party banner */}
      {myParty && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-4 mb-6 flex items-center gap-3"
          style={{ background: "linear-gradient(135deg, #5C0102, #8B0103)" }}
        >
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
            <Trophy size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white text-sm font-medium">Your Party: {myParty}</div>
            <div className="text-white/70 text-xs">Showing candidates from your party below</div>
          </div>
        </motion.div>
      )}

      {/* Campaign & Election Info for approved candidates */}
      {myApplication?.status === "approved" && electionPeriod.isActive && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6"
        >
          <h3 className="text-gray-900 text-sm mb-4 flex items-center gap-2">
            <Calendar size={16} style={{ color: "#5C0102" }} />
            Campaign & Election Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Your Party</div>
              <div className="font-medium text-gray-900">{myParty || "Independent"}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Position</div>
              <div className="font-medium text-gray-900">{myApplication.position}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Voting Date</div>
              <div className="font-medium text-gray-900">{electionPeriod.startDate}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Voting Hours</div>
              <div className="font-medium text-gray-900">{electionPeriod.startTime} – {electionPeriod.endTime}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Venue</div>
              <div className="font-medium text-gray-900">{electionPeriod.venue || "IoT biometric kiosk precinct"}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Status</div>
              <div className="font-medium text-green-600">Approved Candidate</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Campaign Info when election is not yet active but candidate is approved */}
      {myApplication?.status === "approved" && !electionPeriod.isActive && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6"
        >
          <h3 className="text-gray-900 text-sm mb-4 flex items-center gap-2">
            <Calendar size={16} style={{ color: "#5C0102" }} />
            My Candidacy — Campaign Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Your Party</div>
              <div className="font-medium text-gray-900">{myParty || "Independent"}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Position</div>
              <div className="font-medium text-gray-900">{myApplication.position}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Status</div>
              <div className="font-medium text-green-600">Approved Candidate</div>
            </div>
          </div>
          {electionPeriod.startDate && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              Election is scheduled for <strong>{electionPeriod.startDate}</strong> at <strong>{electionPeriod.startTime}</strong>.
              Campaign guidelines will be released by the Electoral Board.
            </div>
          )}
        </motion.div>
      )}

      {approveConfirm.dialog}
      {rejectConfirm.dialog}
    </div>
  );
}
