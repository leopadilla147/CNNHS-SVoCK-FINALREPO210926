import { useState } from "react";
import { motion } from "motion/react";
import {
  Trophy,
  Calendar,
  Clock,
  FileText,
  ChevronRight,
  Bell,
  CheckCircle,
  XCircle,
  Users,
  ShieldCheck,
  Award,
  Vote,
  AlertTriangle,
  ArrowUpRight,
  Fingerprint,
} from "lucide-react";
import { Link } from "react-router";
import { useApp } from "../../context/AppContext";
import { reviewPartyCandidacyRpc } from "../../lib/supabaseData";
import { useConfirm } from "../../lib/useConfirm";
import { buildPartyPositionBoard, candidatesInLivePeriod } from "../../lib/partyScope";

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

/** A period timestamp as a Date, or null when it is absent/unparseable. */
function parseFpDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatFpDate(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function StudentDashboard() {
  const {
    candidates,
    setCandidates,
    electionPeriod,
    currentUser,
    students,
    notifications,
    unreadCount,
    markAsRead,
    addLog,
  } = useApp();

  const [processingCandidate, setProcessingCandidate] = useState<string | null>(null);
  const approveConfirm = useConfirm({
    title: "Approve Candidate?",
    description:
      "Approving this student confirms them for that position in your party. Every other request for the same position will be declined automatically.",
    confirmText: "Approve",
  });
  const rejectConfirm = useConfirm({
    title: "Decline Candidate?",
    description:
      "Decline this student's request? They can re-apply if the position opens up again.",
    confirmText: "Decline",
    destructive: true,
  });

  const currentStudent = students.find((s) => s.id === currentUser?.id);
  // A candidacy belongs to one election period, so the dashboard works on the
  // live period's slate: a past application is history, not "my application".
  const periodCandidates = candidatesInLivePeriod(candidates, electionPeriod);
  const myApplication = periodCandidates.find((c) => c.studentId === currentUser?.id);
  const myParty = myApplication?.status === "approved" ? (myApplication.partyAffiliation ?? null) : null;

  // Only the screening-APPROVED President of a party presides over it.  That is
  // the same rule the database enforces, so the board and the RPC agree.
  const isPartyPresident =
    myApplication?.status === "approved" && myApplication?.position === "President";
  const myPartyId = myApplication?.partyId;

  // Every contested seat in the President's party, each with its approved
  // candidate and whoever is still waiting on a decision.
  const partyBoard = myPartyId ? buildPartyPositionBoard(candidates, myPartyId, electionPeriod) : [];
  const pendingSeatCount = partyBoard.reduce((total, slot) => total + slot.pending.length, 0);

  // Where the student's own party candidacy sits.  Independents and party
  // Presidents carry 'notRequired' and are not gated.
  const myGate = myApplication?.partyAffiliation
    ? myApplication.positionApprovalStatus
    : undefined;

  const handleReviewCandidacy = async (
    candidateId: string,
    position: string,
    candidateName: string,
    action: "approve" | "reject"
  ) => {
    const confirmed =
      action === "approve" ? await approveConfirm.confirm() : await rejectConfirm.confirm();
    if (!confirmed) return;
    setProcessingCandidate(candidateId);
    try {
      await reviewPartyCandidacyRpc(candidateId, action);
      // The RPC returns the raw row with no parties(name) join, so patch only
      // the gate fields rather than replacing the candidate wholesale.
      setCandidates(
        candidates.map((c) =>
          c.id === candidateId
            ? {
                ...c,
                positionApprovalStatus:
                  action === "approve" ? "presidentApproved" : "presidentRejected",
                partyDecidedAt: new Date().toISOString(),
              }
            : // Approving one candidate declines every other request for the
              // same seat, so mirror that locally instead of refetching.
              c.partyId === myPartyId &&
              c.position === position &&
              c.id !== candidateId &&
              c.positionApprovalStatus === "presidentApprovalRequired" && action === "approve"
              ? { ...c, positionApprovalStatus: "presidentRejected" as const, partyDecidedAt: new Date().toISOString() }
              : c
        )
      );
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: action === "approve" ? "Approved Party Candidate" : "Declined Party Candidate",
        details: `${candidateName} for ${position}`,
        type: action === "approve" ? "success" : "warning",
      });
    } catch (err) {
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Party Decision Failed",
        details: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    }
    setProcessingCandidate(null);
  };

  const unreadNotifications = notifications.filter((n) => !n.isRead).slice(0, 5);

  // Stage 3 (060): the Fingerprint Registration window, announced to EVERY
  // voter — candidacy status is irrelevant here, because kiosk voting needs
  // an enrolled fingerprint either way. Derived straight from the period, so
  // it can never drift: closing the window early and opening voting both
  // land endAt at now(), and a plan reset clears the columns — all three
  // simply hide the card.
  const fpStartAt = parseFpDate(electionPeriod.fingerprintRegistrationStartAt);
  const fpEndAt = parseFpDate(electionPeriod.fingerprintRegistrationEndAt);
  const fpVisible = !!fpStartAt && (!fpEndAt || Date.now() < fpEndAt.getTime());
  const fpNotStarted = !!fpStartAt && Date.now() < fpStartAt.getTime();

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

      {/* Stage 3 (060) enrolment reminder — for every voter, only while the
          Fingerprint Registration window is still live */}
      {fpVisible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3 bg-blue-50 border border-blue-200 text-blue-900"
        >
          <Fingerprint size={20} className="text-blue-600 shrink-0" />
          <div>
            <div className="text-xs font-bold text-blue-900">
              {fpNotStarted
                ? "Fingerprint Registration — Scheduled"
                : "Fingerprint Registration is Open"}
            </div>
            <div className="text-xs text-blue-700 mt-0.5">
              {fpNotStarted && fpStartAt ? (
                <>It opens on <strong>{formatFpDate(fpStartAt)}</strong>. </>
              ) : fpEndAt ? (
                <>Enrolment closes on <strong>{formatFpDate(fpEndAt)}</strong>. </>
              ) : (
                <>Enrolment stays open until voting begins. </>
              )}
              Please attend the IoT biometric kiosk to enrol your fingerprint — you need an
              enrolled fingerprint before you can vote.
            </div>
          </div>
        </motion.div>
      )}

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
                onClick={async () => {
                  // The click navigates with a full page reload, which would
                  // abort an in-flight request — wait for the read to persist
                  // first, but never let a slow RPC block navigation.
                  await Promise.race([
                    markAsRead(notif.id),
                    new Promise((resolve) => setTimeout(resolve, 1500)),
                  ]);
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

      {/* Party President: the approval board for their own slate */}
      {isPartyPresident && partyBoard.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xs border border-amber-200 p-6"
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700">
              <Users size={16} />
            </div>
            <div>
              <span className="font-bold text-gray-900 text-sm">{myParty} — Candidacy Requests</span>
              <p className="text-xs text-gray-500">
                {pendingSeatCount > 0
                  ? `${pendingSeatCount} request${pendingSeatCount === 1 ? "" : "s"} waiting on your decision.`
                  : "Every position in your slate has a confirmed candidate."}
              </p>
            </div>
          </div>

          <div className="space-y-3 mt-4">
            {partyBoard.map((slot) => (
              <div key={slot.position} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="text-sm font-bold text-gray-900">{slot.position}</span>
                  {slot.approved ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                      <CheckCircle size={12} />
                      {slot.approved.givenName} {slot.approved.surname}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-gray-500">Open seat</span>
                  )}
                </div>

                {slot.pending.length > 0 ? (
                  <div className="space-y-2">
                    {slot.pending.map((req) => {
                      const fullName = `${req.givenName} ${req.surname}`;
                      const busy = processingCandidate === req.id;
                      return (
                        <div
                          key={req.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-white border border-gray-200 gap-3"
                        >
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{fullName}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              Grade {req.gradeLevel} &middot; applied for {req.position}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                              onClick={() => handleReviewCandidacy(req.id, slot.position, fullName, "approve")}
                              disabled={busy || !!slot.approved}
                              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {busy ? (
                                <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <CheckCircle size={13} />
                              )}
                              Approve
                            </button>
                            <button
                              onClick={() => handleReviewCandidacy(req.id, slot.position, fullName, "reject")}
                              disabled={busy}
                              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <XCircle size={13} /> Decline
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  !slot.approved && (
                    <p className="text-xs text-gray-500 italic">No applicants for this seat yet.</p>
                  )
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Where the student's own party candidacy sits with their President */}
      {myGate === "presidentApprovalRequired" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900"
        >
          <Clock size={20} className="text-amber-600 shrink-0" />
          <div>
            <div className="text-xs font-bold text-amber-900">Waiting for your party President</div>
            <div className="text-xs text-amber-700 mt-0.5">
              Upload both EAF photos, then the President of {myApplication?.partyAffiliation} has to
              approve your candidacy for {myApplication?.position} before you can submit it to
              Screening.
            </div>
          </div>
        </motion.div>
      )}

      {myGate === "presidentApproved" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-900"
        >
            <CheckCircle size={20} className="text-emerald-600 shrink-0" />
            <div>
              <div className="text-xs font-bold text-emerald-900">Approved by your party President</div>
              <div className="text-xs text-emerald-700 mt-0.5">
                Your candidacy for {myApplication?.position} is cleared for submission. The EAF is
                now with the Commissioner on Screening and Validation.
              </div>
            </div>

        </motion.div>
      )}

      {myGate === "presidentRejected" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3 bg-red-50 border border-red-200 text-red-900"
        >
          <XCircle size={20} className="text-red-600 shrink-0" />
          <div>
            <div className="text-xs font-bold text-red-900">Position already filled</div>
            <div className="text-xs text-red-700 mt-0.5">
              Another candidate was approved for {myApplication?.position}. You can re-apply from your
              candidacy page if that seat opens up again.
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
