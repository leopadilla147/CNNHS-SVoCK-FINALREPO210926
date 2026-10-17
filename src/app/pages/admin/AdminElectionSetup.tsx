import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import {
  Calendar, Clock, MapPin, Save, Play, Square, Trophy,
  CheckCircle2, Lock, AlertCircle, Loader2, Eye, FileCheck2,
  Megaphone, Users, KeyRound, RotateCcw, ShieldAlert, X, Fingerprint,
  Gavel,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import type { ElectionStage, ElectionPeriod } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import {
  getCurrentElectionId,
  reloadElectionPeriod,
  openElectionRpc,
  closeElectionRpc,
  publishResultsRpc,
  proclaimWinnersRpc,
  getProclamationTallyRpc,
  startCandidacyPeriodRpc,
  closeCandidacyPeriodRpc,
  endCandidacyAndScheduleMeetingRpc,
  startFingerprintRegistrationRpc,
  closeFingerprintRegistrationRpc,
  countActiveComplaintsRpc,
  resetElectionPlanRpc,
} from "../../lib/supabaseData";
import type { ProclaimedWinner, ProclamationTallyRow, TieResolution } from "../../lib/supabaseData";
import { isSupabaseConfigured } from "../../lib/supabase";
import { ProclamationDialog } from "../../components/ProclamationDialog";

type Stage = "application" | "campaign" | "fingerprint_registration" | "voting" | "results";

interface StageConfig {
  id: Stage;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const STAGES: StageConfig[] = [
  { id: "application", label: "Application", icon: <Users size={18} />, description: "Open or pause candidacy" },
  { id: "campaign", label: "Campaign", icon: <Megaphone size={18} />, description: "Schedule the meeting" },
  { id: "fingerprint_registration", label: "Fingerprint", icon: <Fingerprint size={18} />, description: "Voter biometric enrolment" },
  { id: "voting", label: "Voting", icon: <Play size={18} />, description: "Open and close the voting period" },
  { id: "results", label: "Results", icon: <Trophy size={18} />, description: "Publish results and proclaim winners" },
];

const STAGE_LABELS: Record<ElectionStage, string> = {
  application: "Candidate Application Period",
  campaign: "Campaign Period",
  fingerprint_registration: "Fingerprint Registration",
  voting: "Voting Period",
  results: "Election Result",
  completed: "Completed",
};

/**
 * The stage the tab is on.
 *
 * 058 introduced `lifecycle_stage` as the authoritative value, but the
 * boolean fallback is kept so a database that has not been migrated yet � or
 * a row written before the column existed � still lands somewhere sensible
 * instead of pretending to be in Stage 1.
 */
export function resolveStage(electionPeriod: ElectionPeriod): Stage {
  const stage = electionPeriod.lifecycleStage;
  if (
    stage === "application" ||
    stage === "campaign" ||
    stage === "fingerprint_registration" ||
    stage === "voting" ||
    stage === "results"
  ) {
    return stage;
  }
  if (electionPeriod.proclaimed || electionPeriod.resultsPublished) return "results";
  if (electionPeriod.isActive) return "voting";
  if (electionPeriod.fingerprintRegistrationStartAt) return "fingerprint_registration";
  if (electionPeriod.rulesDiscussionAt) return "campaign";
  return "application";
}

function isStageComplete(stage: Stage, electionPeriod: ElectionPeriod, currentStage: Stage): boolean {
  switch (stage) {
    case "application":
      // Reached once the meeting has been scheduled, which is what closes it.
      return electionPeriod.candidacyOpen !== true
        && !!electionPeriod.rulesDiscussionAt
        && currentStage !== "application";
    case "campaign":
      return !!electionPeriod.rulesDiscussionAt && currentStage !== "campaign" && currentStage !== "application";
    case "fingerprint_registration":
      // Done once the election has moved on to voting (or past it). Starting
      // the vote is what closes the enrolment window.
      return currentStage === "voting" || currentStage === "results";
    case "voting":
      return currentStage === "results";
    case "results":
      return !!electionPeriod.proclaimed;
  }
}

/**
 * Which stages this period has actually reached.
 *
 * These gates are data-driven, not ordinal. An ordinal "you may only work on
 * your current stage" rule deadlocks Stage 2: scheduling the campaign meeting
 * is what *ends* the application period, so while Stage 1 is current there
 * would be no way to ever leave it.
 */
function isStageAccessible(
  stage: Stage,
  electionPeriod: ElectionPeriod,
  currentStage: Stage,
  hasPeriod: boolean
): boolean {
  switch (stage) {
    case "application":
      return true;
    case "campaign":
      // Needs a period to hang the meeting on; the Start button creates one.
      return hasPeriod;
    case "fingerprint_registration":
      // Enrolment sits after the campaign meeting, so the meeting must exist.
      return !!electionPeriod.rulesDiscussionAt;
    case "voting":
      return !!electionPeriod.rulesDiscussionAt;
    case "results":
      return currentStage === "results";
  }
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** "2026-09-30" + "14:00" -> an ISO instant the timestamptz column accepts. */
function toMeetingIso(date: string, time: string): string {
  return new Date(`${date}T${time || "09:00"}:00`).toISOString();
}

function formatMeeting(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "2026-10-20T08:00" (a datetime-local value) -> an ISO instant, or null. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** An ISO instant -> the "2026-10-20T08:00" a datetime-local input expects. */
function toLocalInput(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminElectionSetup() {
  const {
    electionPeriod, setElectionPeriod, applyElectionPeriod,
    addLog, currentUser, candidates, complaints,
    students, insertNotification,
  } = useApp();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [electionId, setElectionId] = useState<string | null>(null);
  const [proclaimedWinners, setProclaimedWinners] = useState<ProclaimedWinner[]>([]);
  // 069 — the proclaim flow reviews the tally first and resolves any tie.
  const [proclamationOpen, setProclamationOpen] = useState(false);
  const [tally, setTally] = useState<ProclamationTallyRow[]>([]);
  const [tallyLoading, setTallyLoading] = useState(false);
  const [tallyError, setTallyError] = useState<string | null>(null);
  const [proclaiming, setProclaiming] = useState(false);
  const [schoolYear, setSchoolYear] = useState(electionPeriod.schoolYear || "");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("09:00");
  // Fingerprint Registration window, held as datetime-local strings.
  const [fpStart, setFpStart] = useState("");
  const [fpEnd, setFpEnd] = useState("");
  const [activeComplaints, setActiveComplaints] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSchoolYear, setResetSchoolYear] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  const currentStage = resolveStage(electionPeriod);
  const hasPeriod = isUuid(electionPeriod.id || "") || !!electionId;
  // Opening the vote is what ends both earlier stages. From "voting" on
  // (including "results") the Stage 1/2 cards must stop offering actions:
  // the RPCs already refuse them, and in mock mode the handlers would walk
  // the election backwards to application/campaign.
  const pastCampaign = currentStage === "voting" || currentStage === "results";

  // Results unlock only after the vote was actually opened (stage voting /
  // results) and then closed: saving the schedule alone leaves the period at
  // campaign / fingerprint_registration.  publish_results_rpc is itself what
  // moves the stage to 'results', so that stage cannot be the gate.
  const votingConcluded = pastCampaign && !electionPeriod.isActive;

  const [form, setForm] = useState({
    startDate: electionPeriod.startDate,
    startTime: electionPeriod.startTime,
    endDate: electionPeriod.endDate,
    endTime: electionPeriod.endTime,
    venue: electionPeriod.venue || "IoT biometric kiosk precinct",
    votingMethod: electionPeriod.votingMethod || "plurality",
  });

  const saveConfirm = useConfirm({ title: "Save Voting Schedule?", description: "This will save the voting period schedule.", confirmText: "Save" });
  const openConfirm = useConfirm({ title: "Open Voting?", description: "This starts the Voting Period, ends the Campaign Period and closes Fingerprint Registration, and enables kiosk voting.", confirmText: "Open Voting" });
  const closeConfirm = useConfirm({ title: "Close Voting?", description: "This will end the voting period early. Students will no longer be able to cast votes.", confirmText: "Close Voting", destructive: true });
  const startCandidacyConfirm = useConfirm({ title: "Start the Candidate Application Period?", description: "Students will be able to apply for candidacy. Applications are sent to the Screening and Validation Commissioner.", confirmText: "Start Application Period" });
  const closeCandidacyConfirm = useConfirm({ title: "Pause Candidacy?", description: "No new applications can be filed. Students who already started an application can still finish it. You can reopen this at any time.", confirmText: "Pause Candidacy" });
  const meetingConfirm = useConfirm({ title: "Schedule the Campaign Meeting?", description: "This records the Rules Discussion Meeting and ends the Candidate Application Period.", confirmText: "Schedule & End Candidacy" });
  const fpConfirm = useConfirm({ title: "Start Fingerprint Registration?", description: "Voters may enrol their fingerprint at the biometric kiosks for the window you set. Starting the Voting Period closes this window automatically.", confirmText: "Start Registration" });
  const fpCloseConfirm = useConfirm({ title: "Close Fingerprint Registration?", description: "The enrolment window ends early. Voters will no longer be able to register a fingerprint for this election.", confirmText: "Close Registration", destructive: true });
  const publishConfirm = useConfirm({ title: "Publish Results?", description: "Election results become publicly visible on the Official Results page.", confirmText: "Publish" });
  const proclaimConfirm = useConfirm({ title: "Proclaim Winners?", description: "This will officially compute and proclaim the winners per position. This action is irreversible.", confirmText: "Proclaim Winners", destructive: true });

  const approvedCount = candidates.filter((c) => c.status === "approved").length;
  const logUser = currentUser?.name || "Electoral Board";
  const stageLabel = STAGE_LABELS[electionPeriod.lifecycleStage || "application"];

  // Complaints are counted from the rows already in context: the complaint
  // count is a UI affordance, and the authoritative gate lives in
  // publish_results_rpc (036:472).  An RPC is only consulted when the period
  // exists and context has nothing to say.
  const filedComplaints = complaints.filter((c) => c.status === "filed").length;
  const knownComplaintCount = filedComplaints > 0 ? filedComplaints : activeComplaints;

  const showError = useCallback((msg: string) => {
    setError(msg);
    setSuccess(null);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getCurrentElectionId().then((id) => setElectionId(id));
  }, []);

  // Re-read the stage flag whenever the period identity changes, so a reset
  // that swaps the row underneath us cannot leave a stale stage on screen.
  useEffect(() => {
    if (!isSupabaseConfigured || !isUuid(electionPeriod.id || "")) return;
    let cancelled = false;
    reloadElectionPeriod()
      .then((fresh) => { if (!cancelled) applyElectionPeriod(fresh); })
      .catch(() => { /* the tab still renders from context state */ });
    return () => { cancelled = true; };
  }, [electionPeriod.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const id = electionPeriod.id || electionId;
    if (!id) { setActiveComplaints(null); return; }
    let cancelled = false;
    countActiveComplaintsRpc(id)
      .then((n) => { if (!cancelled) setActiveComplaints(n); })
      .catch(() => { if (!cancelled) setActiveComplaints(null); });
    return () => { cancelled = true; };
  }, [electionPeriod.id, electionId]);

  useEffect(() => {
    if (electionPeriod.rulesDiscussionAt) {
      const d = new Date(electionPeriod.rulesDiscussionAt);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        setMeetingDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
        setMeetingTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      }
    }
  }, [electionPeriod.rulesDiscussionAt]);

  useEffect(() => {
    setFpStart(toLocalInput(electionPeriod.fingerprintRegistrationStartAt));
    setFpEnd(toLocalInput(electionPeriod.fingerprintRegistrationEndAt));
  }, [electionPeriod.fingerprintRegistrationStartAt, electionPeriod.fingerprintRegistrationEndAt]);

  useEffect(() => {
    if (electionPeriod.schoolYear) setSchoolYear(electionPeriod.schoolYear);
  }, [electionPeriod.schoolYear]);

  /** Pull the authoritative row after an RPC and mirror it into local state. */
  const refreshPeriod = async () => {
    if (!isSupabaseConfigured) return;
    const fresh = await reloadElectionPeriod();
    applyElectionPeriod(fresh);
    if (fresh.id) setElectionId(fresh.id);
  };

  const handleStartCandidacy = async () => {
    setError(null);
    if (pastCampaign) {
      showError("The Candidate Application Period is over — reset the election plan to start a new one.");
      return;
    }
    const ok = await startCandidacyConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        await startCandidacyPeriodRpc(schoolYear.trim() || undefined);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, candidacyOpen: true, lifecycleStage: "application" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Candidate Application Period Started",
        details: schoolYear.trim()
          ? `Candidacy opened for school year ${schoolYear.trim()}.`
          : "Candidacy reopened on the current election period.",
        type: "success",
      });
      showSuccess("The Candidate Application Period is now open.");
    } catch (err: any) {
      showError(err.message || "Failed to start the Candidate Application Period.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseCandidacy = async () => {
    setError(null);
    if (pastCampaign) {
      showError("The Candidate Application Period is already over.");
      return;
    }
    const ok = await closeCandidacyConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        await closeCandidacyPeriodRpc();
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, candidacyOpen: false });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Candidate Application Period Paused",
        details: "New candidacy applications are no longer accepted. Existing applications may still be finished.",
        type: "warning",
      });
      showSuccess("Candidacy is paused.");
    } catch (err: any) {
      showError(err.message || "Failed to pause the Candidate Application Period.");
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleMeeting = async () => {
    setError(null);
    if (pastCampaign) {
      showError("The Campaign Period is over — the meeting can no longer be scheduled.");
      return;
    }
    if (!meetingDate) {
      showError("Choose a date for the Rules Discussion Meeting.");
      return;
    }
    const ok = await meetingConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("Start the Candidate Application Period first.");
        await endCandidacyAndScheduleMeetingRpc(id, toMeetingIso(meetingDate, meetingTime));
        await refreshPeriod();
      } else {
        applyElectionPeriod({
          ...electionPeriod,
          candidacyOpen: false,
          lifecycleStage: "campaign",
          rulesDiscussionAt: toMeetingIso(meetingDate, meetingTime),
        });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Campaign Meeting Scheduled",
        details: `Rules Discussion Meeting set for ${meetingDate} ${meetingTime}. The Candidate Application Period has ended.`,
        type: "success",
      });
      showSuccess("Meeting scheduled. The Candidate Application Period has ended.");
    } catch (err: any) {
      showError(err.message || "Failed to schedule the campaign meeting.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartFingerprintRegistration = async () => {
    setError(null);
    if (!fpStart && !fpEnd) {
      showError("Set the Fingerprint Registration window before starting.");
      return;
    }
    if (fpStart && fpEnd && fpEnd <= fpStart) {
      showError("The Fingerprint Registration window must end after it starts.");
      return;
    }
    // Stage 3 is announced to every voter ONCE, when the board opens it.
    // "Update Registration Window" clicks land here too and must not
    // re-notify the whole student body.
    const firstOpen = currentStage !== "fingerprint_registration";
    const ok = await fpConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      const startIso = fromLocalInput(fpStart);
      const endIso = fromLocalInput(fpEnd);
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("Schedule the campaign meeting first.");
        await startFingerprintRegistrationRpc(id, startIso, endIso);
        await refreshPeriod();
      } else {
        applyElectionPeriod({
          ...electionPeriod,
          lifecycleStage: "fingerprint_registration",
          fingerprintRegistrationStartAt: startIso || undefined,
          fingerprintRegistrationEndAt: endIso || undefined,
        });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Fingerprint Registration Started",
        details: `Voters may enrol their fingerprint at the biometric kiosks${endIso ? ` until ${formatMeeting(endIso)}` : ""}.`,
        type: "success",
      });
      if (firstOpen) {
        // Every voter, not just candidates: enrolment is what makes kiosk
        // voting possible for them. Pending/rejected accounts are not voters.
        const recipients = students.filter((s) => s.status === "approved");
        for (const voter of recipients) {
          insertNotification({
            userId: voter.id,
            role: "student",
            type: "fingerprint_registration",
            title: "Fingerprint Registration is Open",
            message: `Please attend the IoT biometric kiosk to enrol your fingerprint${endIso ? ` by ${formatMeeting(endIso)}` : ""}. You need an enrolled fingerprint before you can vote.`,
            link: "/student/dashboard",
          });
        }
        addLog({
          user: logUser, role: "Admin",
          action: "Fingerprint Registration Announced",
          details: `Attendance reminder sent to ${recipients.length} student voter(s).`,
          type: "info",
        });
      }
      showSuccess("Fingerprint Registration is now open.");
    } catch (err: any) {
      showError(err.message || "Failed to start Fingerprint Registration.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseFingerprintRegistration = async () => {
    setError(null);
    const ok = await fpCloseConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to close.");
        await closeFingerprintRegistrationRpc(id);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, fingerprintRegistrationEndAt: new Date().toISOString() });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Fingerprint Registration Closed",
        details: "The Fingerprint Registration window was closed early.",
        type: "warning",
      });
      showSuccess("Fingerprint Registration is closed.");
    } catch (err: any) {
      showError(err.message || "Failed to close Fingerprint Registration.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    setError(null);
    if (!form.startDate || !form.startTime || !form.endDate || !form.endTime) {
      showError("Complete all voting period fields before saving.");
      return;
    }
    if (form.endDate < form.startDate) {
      showError("End date must be after start date.");
      return;
    }
    if (form.endDate === form.startDate && form.endTime <= form.startTime) {
      showError("End time must be after start time.");
      return;
    }
    const ok = await saveConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      const res = await setElectionPeriod({ ...electionPeriod, ...form });
      if (!res.ok) throw new Error(res.message || "Failed to save the voting schedule.");
      addLog({
        user: logUser, role: "Admin",
        action: "Voting Schedule Updated",
        details: `Voting period: ${form.startDate} ${form.startTime} - ${form.endDate} ${form.endTime}, Voting method: ${form.votingMethod}`,
        type: "info",
      });
      showSuccess("Voting schedule saved.");
    } catch (err: any) {
      showError(err.message || "Failed to save the voting schedule.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenElection = async () => {
    setError(null);
    // The button is disabled without a schedule, but the period can also be
    // filled from outside this form — never open an inverted or empty window.
    // The SAVED period is what opens, so it is what gets validated.
    if (!votingScheduleSaved) {
      showError("Set the voting period start and end date and time, then save the schedule, before opening voting.");
      return;
    }
    if (electionPeriod.endDate < electionPeriod.startDate) {
      showError("End date must be after start date.");
      return;
    }
    if (electionPeriod.endDate === electionPeriod.startDate && electionPeriod.endTime <= electionPeriod.startTime) {
      showError("End time must be after start time.");
      return;
    }
    const ok = await openConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to open.");
        await openElectionRpc(id);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, candidacyOpen: false, isActive: true, lifecycleStage: "voting" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Election Opened",
        details: "The voting period has been opened.",
        type: "success",
      });
      showSuccess("Voting is now open.");
    } catch (err: any) {
      showError(err.message || "Failed to open voting.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseVoting = async () => {
    setError(null);
    const ok = await closeConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to close.");
        await closeElectionRpc(id);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, isActive: false });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Election Closed",
        details: "The voting period has been closed.",
        type: "warning",
      });
      showSuccess("Voting is now closed.");
    } catch (err: any) {
      showError(err.message || "Failed to close voting.");
    } finally {
      setLoading(false);
    }
  };

  const handlePublishResults = async () => {
    setError(null);
    if (knownComplaintCount && knownComplaintCount > 0) {
      showError("Results cannot be published while a complaint is filed. Resolve the complaint in Complaints first.");
      return;
    }
    const ok = await publishConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to publish results for.");
        await publishResultsRpc(id);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, resultsPublished: true, lifecycleStage: "results" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Results Published",
        details: "Election results have been published and are visible on the Official Results page.",
        type: "success",
      });
      showSuccess("Results published.");
    } catch (err: any) {
      showError(err.message || "Failed to publish results.");
    } finally {
      setLoading(false);
    }
  };

  // 069 — clicking "Proclaim Winners" opens the review dialog and loads the
  // running order for every position.  Mock mode has no tally to show, so it
  // keeps the old one-shot behaviour.
  const handleProclaim = async () => {
    setError(null);
    if (!isSupabaseConfigured) {
      const ok = await proclaimConfirm.confirm();
      if (!ok) return;
      applyElectionPeriod({ ...electionPeriod, proclaimed: true, proclaimedAt: new Date().toISOString() });
      addLog({
        user: logUser, role: "Admin",
        action: "Winners Proclaimed",
        details: "Winners proclaimed (offline mode).",
        type: "success",
      });
      showSuccess("Winners proclaimed.");
      return;
    }

    setTally([]);
    setTallyError(null);
    setProclamationOpen(true);

    const id = electionPeriod.id || electionId;
    if (!id) {
      setTallyError("There is no election period to proclaim winners for.");
      return;
    }
    setTallyLoading(true);
    try {
      setTally(await getProclamationTallyRpc(id));
    } catch (err: any) {
      setTallyError(err.message || "Failed to load the vote tally.");
    } finally {
      setTallyLoading(false);
    }
  };

  // 069 — the dialog has collected a resolution for every tie; this commits
  // the proclamation and reports the winners it produced.
  const commitProclaim = async (resolutions: Record<string, TieResolution>) => {
    setTallyError(null);
    const ok = await proclaimConfirm.confirm();
    if (!ok) return;
    setProclaiming(true);
    try {
      const id = electionPeriod.id || electionId;
      if (!id) throw new Error("There is no election period to proclaim winners for.");
      const winners = await proclaimWinnersRpc(id, resolutions);
      await refreshPeriod();
      setProclaimedWinners(winners);
      setProclamationOpen(false);
      addLog({
        user: logUser, role: "Admin",
        action: "Winners Proclaimed",
        details: `Winners proclaimed for ${winners.length} positions.`,
        type: "success",
      });
      showSuccess(`Winners proclaimed for ${winners.length} positions.`);
    } catch (err: any) {
      // Keep the dialog open so the board can see what went wrong and retry.
      setTallyError(err.message || "Failed to proclaim winners.");
    } finally {
      setProclaiming(false);
    }
  };

  const closeProclamation = () => {
    if (proclaiming) return;
    setProclamationOpen(false);
  };

  const submitReset = async () => {
    setResetError(null);
    if (!resetPassword) {
      setResetError("Enter the Electoral Board password to continue.");
      return;
    }
    setLoading(true);
    try {
      const result = isSupabaseConfigured
        ? await resetElectionPlanRpc(resetPassword, resetSchoolYear.trim() || undefined)
        : null;
      if (result) await refreshPeriod();
      setResetOpen(false);
      setResetPassword("");
      setResetSchoolYear("");
      const detail = result?.archivedPrevious
        ? "The previous election period was archived with all its candidates and votes intact. A new period was created."
        : "The election plan was cleared back to Stage 1.";
      addLog({
        user: logUser, role: "Admin",
        action: "Election Plan Reset",
        details: detail,
        type: "warning",
      });
      showSuccess("The election plan has been reset.");
    } catch (err: any) {
      setResetError(err.message || "Failed to reset the election plan.");
    } finally {
      setLoading(false);
    }
  };

  const stageStatus = (stage: Stage) => {
    const complete = isStageComplete(stage, electionPeriod, currentStage);
    const current = currentStage === stage;
    if (complete) return "complete";
    if (current) return "current";
    if (!isStageAccessible(stage, electionPeriod, currentStage, hasPeriod)) return "locked";
    return "upcoming";
  };

  const scheduleLocked = !!electionPeriod.startDate && currentStage === "results";
  const hasMeeting = !!electionPeriod.rulesDiscussionAt;
  // Stage 4 must not open without a saved voting window: open_election_rpc
  // flips the stage without checking one, so the UI is the only gate. The
  // SAVED period is what counts — that is the row the kiosk and the public
  // pages read — so fields typed but never saved do not qualify.
  const votingScheduleSaved = !!(
    electionPeriod.startDate &&
    electionPeriod.startTime &&
    electionPeriod.endDate &&
    electionPeriod.endTime
  );
  const complaintBlocked = (knownComplaintCount ?? 0) > 0;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-gray-900">Election Planning</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Electoral Board</span>
        </div>
        <p className="text-gray-500 text-sm">
          Five stages, in order: open candidacy, schedule the campaign meeting, open Fingerprint
          Registration at the kiosks, run the vote, then announce the result.
        </p>
      </motion.div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {/* Progress Indicator */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center justify-between">
          {STAGES.map((stage, i) => {
            const status = stageStatus(stage.id);
            return (
              <div key={stage.id} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    status === "complete" ? "bg-green-500 text-white" :
                    status === "current" ? "bg-[#5C0102] text-white" :
                    status === "locked" ? "bg-gray-100 text-gray-400" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {status === "complete" ? <CheckCircle2 size={16} /> : stage.icon}
                  </div>
                  <div className="hidden sm:block">
                    <div className={`text-xs font-medium ${
                      status === "complete" ? "text-green-600" :
                      status === "current" ? "text-[#5C0102]" :
                      "text-gray-400"
                    }`}>{stage.label}</div>
                    <div className="text-[10px] text-gray-400">{stage.description}</div>
                  </div>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${status === "complete" ? "bg-green-500" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage 1 � Candidate Application Period */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        stageStatus("application") === "locked" ? "border-gray-100 opacity-60" : "border-gray-100"
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Users size={16} style={{ color: "#5C0102" }} />
            Stage 1: Candidate Application Period
          </h3>
          {electionPeriod.candidacyOpen && !pastCampaign ? (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <Play size={12} /> Accepting Applications
            </span>
          ) : (
            <span className="text-xs flex items-center gap-1 text-gray-400 font-medium">
              <Square size={12} /> {pastCampaign ? "Period Ended" : "Not Accepting Applications"}
            </span>
          )}
        </div>

        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <div className="flex items-center gap-2">
            <FileCheck2 size={14} className="text-gray-400" />
            Students apply here and send their applications to the Screening and Validation Commissioner.
          </div>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-gray-400" />
            Submitted applications: <strong className="text-gray-700">{candidates.filter((c) => c.status === "pending").length}</strong>
            {" "}� Approved candidates: <strong className="text-gray-700">{approvedCount}</strong>
          </div>
        </div>

        {!hasPeriod && (
          <div className="mb-4">
            <label className="block text-xs text-gray-600 mb-1">School Year</label>
            <input
              value={schoolYear}
              onChange={(e) => setSchoolYear(e.target.value)}
              placeholder="2027-2028"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
            <p className="text-xs text-gray-400 mt-1">
              Starting this period creates the election record that every candidacy, vote and result row attaches to.
            </p>
          </div>
        )}

        {pastCampaign ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Candidate Application Period ended when Voting opened.
          </div>
        ) : electionPeriod.candidacyOpen ? (
          <button
            onClick={handleCloseCandidacy}
            disabled={loading}
            className="px-5 py-2.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-amber-200 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
            Pause Candidacy
          </button>
        ) : (
          <button
            onClick={handleStartCandidacy}
            disabled={loading}
            className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#5C0102" }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {hasPeriod ? "Open Candidacy" : "Start Application Period"}
          </button>
        )}
      </div>

      {/* Stage 2 � Campaign Period */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !isStageAccessible("campaign", electionPeriod, currentStage, hasPeriod) ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Megaphone size={16} style={{ color: "#5C0102" }} />
            Stage 2: Campaign Period
          </h3>
          {hasMeeting && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <CheckCircle2 size={14} /> Meeting Scheduled
            </span>
          )}
        </div>

        {pastCampaign ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Campaign Period ended when Voting opened.
          </div>
        ) : !isStageAccessible("campaign", electionPeriod, currentStage, hasPeriod) ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Open the Candidate Application Period first.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              The meeting date is announced in each approved candidate&rsquo;s
              {" "}Apply for Candidacy page. Scheduling it ends the Candidate Application Period.
            </div>

            {hasMeeting && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                <Calendar size={15} />
                Rules Discussion Meeting: <strong>{formatMeeting(electionPeriod.rulesDiscussionAt)}</strong>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
              <div>
                <label htmlFor="meeting-date" className="block text-xs text-gray-600 mb-1">Meeting Date</label>
                <input
                  id="meeting-date"
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
                />
              </div>
              <div>
                <label htmlFor="meeting-time" className="block text-xs text-gray-600 mb-1">Time</label>
                <input
                  id="meeting-time"
                  type="time"
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
                />
              </div>
            </div>

            <button
              onClick={handleScheduleMeeting}
              disabled={loading || !meetingDate}
              title={!meetingDate ? "Choose a meeting date first." : undefined}
              className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "#5C0102" }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Calendar size={16} />}
              {hasMeeting ? "Reschedule & End Candidacy" : "Schedule Meeting & End Candidacy"}
            </button>
          </div>
        )}
      </div>

      {/* Stage 3 — Fingerprint Registration */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !isStageAccessible("fingerprint_registration", electionPeriod, currentStage, hasPeriod) ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Fingerprint size={16} style={{ color: "#5C0102" }} />
            Stage 3: Fingerprint Registration
          </h3>
          {electionPeriod.fingerprintRegistrationStartAt && !electionPeriod.fingerprintRegistrationEndAt && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <Play size={12} /> Registration Open
            </span>
          )}
          {electionPeriod.fingerprintRegistrationEndAt && (
            <span className="text-xs flex items-center gap-1 text-gray-400 font-medium">
              <Square size={12} /> Registration Closed
            </span>
          )}
        </div>

        {!isStageAccessible("fingerprint_registration", electionPeriod, currentStage, hasPeriod) ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Schedule the campaign meeting first.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              Voters visit the IoT biometric kiosks during this window to enrol their fingerprint.
              It sits between the campaign and the vote: starting the Voting Period closes it
              automatically, so the two can never overlap.
            </div>

            {electionPeriod.fingerprintRegistrationStartAt && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                <Clock size={15} />
                Registration window:
                <strong>
                  {formatMeeting(electionPeriod.fingerprintRegistrationStartAt)}
                  {electionPeriod.fingerprintRegistrationEndAt
                    ? ` to ${formatMeeting(electionPeriod.fingerprintRegistrationEndAt)}`
                    : " (open)"}
                </strong>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
              <div>
                <label htmlFor="fp-start" className="block text-xs text-gray-600 mb-1">Registration Opens</label>
                <input
                  id="fp-start"
                  type="datetime-local"
                  value={fpStart}
                  onChange={(e) => setFpStart(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
                />
              </div>
              <div>
                <label htmlFor="fp-end" className="block text-xs text-gray-600 mb-1">Registration Closes</label>
                <input
                  id="fp-end"
                  type="datetime-local"
                  value={fpEnd}
                  onChange={(e) => setFpEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleStartFingerprintRegistration}
                disabled={loading || (!fpStart && !fpEnd)}
                title={!fpStart && !fpEnd ? "Set the registration window first." : undefined}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
                {currentStage === "fingerprint_registration" ? "Update Registration Window" : "Open Fingerprint Registration"}
              </button>
              {currentStage === "fingerprint_registration" && !electionPeriod.fingerprintRegistrationEndAt && (
                <button
                  onClick={handleCloseFingerprintRegistration}
                  disabled={loading}
                  className="px-5 py-2.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-amber-200 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                  Close Registration Early
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Stage 4 — Voting Period */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !isStageAccessible("voting", electionPeriod, currentStage, hasPeriod) ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Play size={16} style={{ color: "#5C0102" }} />
            Stage 4: Voting Period
          </h3>
          {electionPeriod.isActive && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <Play size={12} /> Voting Active
            </span>
          )}
          {!electionPeriod.isActive && hasMeeting && currentStage === "voting" && (
            <span className="text-xs flex items-center gap-1 text-gray-400 font-medium">
              <Square size={12} /> Voting Closed
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Voting Period</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                <input type="date" value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  disabled={scheduleLocked}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Start Time</label>
                <input type="time" value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  disabled={scheduleLocked}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">End Date</label>
                <input type="date" value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  disabled={scheduleLocked}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">End Time</label>
                <input type="time" value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  disabled={scheduleLocked}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Venue</label>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-gray-400" />
                <input value={form.venue}
                  onChange={(e) => setForm({ ...form, venue: e.target.value })}
                  disabled={scheduleLocked}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Voting Method</h4>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Voting Method</label>
              <select value={form.votingMethod}
                onChange={(e) => setForm({ ...form, votingMethod: e.target.value })}
                disabled={scheduleLocked}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                <option value="plurality">Plurality (highest votes wins)</option>
                <option value="plurality_with_run_off">Plurality with Run-off</option>
                <option value="ranked_choice">Ranked Choice</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">How winners are determined for each position.</p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSaveSchedule}
                disabled={loading || scheduleLocked}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save Schedule
              </button>
            </div>
            {scheduleLocked && (
              <div className="text-xs text-gray-400">The schedule is locked once results are published.</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
          <div className="text-xs text-gray-400">
            Voting period: {electionPeriod.startDate || "Not set"} {electionPeriod.startTime} &rarr; {electionPeriod.endDate || "Not set"} {electionPeriod.endTime}
          </div>
          <div className="flex gap-3">
            {!electionPeriod.isActive && !electionPeriod.resultsPublished && (
              <button onClick={handleOpenElection} disabled={loading || !hasMeeting || !votingScheduleSaved}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Open Voting
              </button>
            )}
            {electionPeriod.isActive && (
              <button onClick={handleCloseVoting} disabled={loading}
                className="px-5 py-2.5 bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-200 disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                Close Voting
              </button>
            )}
            {!electionPeriod.isActive && hasMeeting && !electionPeriod.resultsPublished && (
              <div className="flex items-center gap-2 text-xs text-gray-400 ml-2">
                <Eye size={14} />
                Or wait until the voting period ends automatically
              </div>
            )}
          </div>
        </div>

        {!hasMeeting && (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg mt-4">
            <Lock size={14} /> Schedule the campaign meeting before opening voting.
          </div>
        )}

        {hasMeeting && !votingScheduleSaved && !electionPeriod.isActive && !electionPeriod.resultsPublished && (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg mt-4">
            <Lock size={14} /> Set the voting period start and end date and time, then save the
            schedule, before opening voting.
          </div>
        )}

        {hasMeeting && votingScheduleSaved && !electionPeriod.isActive && !electionPeriod.resultsPublished && (
          <div className="flex items-center gap-2 text-xs text-amber-600 p-3 bg-amber-50 border border-amber-100 rounded-lg mt-4">
            <AlertCircle size={14} /> Opening voting ends the Campaign Period and closes Fingerprint Registration.
          </div>
        )}
      </div>

      {/* Stage 5 � Results */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !votingConcluded ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Trophy size={16} style={{ color: "#5C0102" }} />
            Stage 5: Election Result
          </h3>
          {electionPeriod.resultsPublished && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <CheckCircle2 size={14} /> Results Published
            </span>
          )}
          {electionPeriod.proclaimed && (
            <span className="text-xs flex items-center gap-1 text-amber-600 font-medium">
              <Trophy size={14} /> Winners Proclaimed
            </span>
          )}
        </div>

        <div className="space-y-4">
          {complaintBlocked && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-sm text-red-700">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">
                  {knownComplaintCount} unresolved {knownComplaintCount === 1 ? "complaint is" : "complaints are"} blocking the announcement.
                </div>
                <div className="text-xs mt-0.5">
                  Results cannot be published while a complaint is filed. Resolve it first in{" "}
                  <a href="/admin/complaints" className="underline font-medium">Complaints</a>.
                </div>
              </div>
            </div>
          )}

          {!electionPeriod.resultsPublished && !electionPeriod.proclaimed && !votingConcluded && (
            <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
              <Lock size={14} /> Open and close the voting period first to access results.
            </div>
          )}

          <div className="flex gap-3">
            {!electionPeriod.resultsPublished && (
              <button
                onClick={handlePublishResults}
                disabled={loading || complaintBlocked || !votingConcluded}
                title={complaintBlocked ? "Resolve the filed complaint before publishing results." : undefined}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
                Publish Results
              </button>
            )}
            {electionPeriod.resultsPublished && !electionPeriod.proclaimed && (
              <button onClick={handleProclaim} disabled={loading}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
                Proclaim Winners
              </button>
            )}
          </div>

          {proclaimedWinners.length > 0 && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <h4 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                <Trophy size={16} /> Proclaimed Winners
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {proclaimedWinners.map((w) => (
                  <div key={w.position} className="bg-white p-3 rounded-lg border border-amber-100 text-sm">
                    <div className="text-xs text-gray-500">{w.position}</div>
                    <div className="font-medium text-gray-900">{w.winnerName}</div>
                    <div className="text-xs text-gray-400">{w.votes} vote{w.votes !== 1 ? "s" : ""}</div>
                    {w.resolutionMethod === "manual" && (
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
                        <Gavel size={11} /> Tie — board choice
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {electionPeriod.proclaimed && proclaimedWinners.length === 0 && (
            <div className="text-sm text-gray-500 italic">
              Winners have been proclaimed. View full details on the Official Results page.
            </div>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-red-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-gray-900 text-sm flex items-center gap-2 mb-1">
              <RotateCcw size={16} style={{ color: "#DC2626" }} />
              Reset Election Plan
            </h3>
            <p className="text-xs text-gray-500 max-w-xl">
              Returns the plan to Stage 1. Nothing is ever deleted: if the current period already has
              candidates or votes, it is archived and kept permanently as history, and a new period is started.
              This requires the Electoral Board password.
            </p>
            {stageLabel !== "Completed" && (
              <p className="text-xs text-gray-400 mt-1">Current stage: {stageLabel}</p>
            )}
          </div>
          <button
            onClick={() => { setResetError(null); setResetPassword(""); setResetOpen(true); }}
            disabled={loading}
            className="px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-100 disabled:opacity-50 shrink-0"
          >
            <RotateCcw size={15} /> Reset Plan
          </button>
        </div>
      </div>

      {startCandidacyConfirm.dialog}
      {closeCandidacyConfirm.dialog}
      {meetingConfirm.dialog}
      {fpConfirm.dialog}
      {fpCloseConfirm.dialog}
      {saveConfirm.dialog}
      {openConfirm.dialog}
      {closeConfirm.dialog}
      {publishConfirm.dialog}
      {proclaimConfirm.dialog}

      <ProclamationDialog
        open={proclamationOpen}
        loading={tallyLoading}
        confirming={proclaiming}
        error={tallyError}
        tally={tally}
        onCancel={closeProclamation}
        onConfirm={commitProclaim}
      />

      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !loading && setResetOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-plan-title"
            className="relative bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-full max-w-md"
          >
            <button
              onClick={() => setResetOpen(false)}
              disabled={loading}
              aria-label="Close"
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={18} style={{ color: "#DC2626" }} />
              <h3 id="reset-plan-title" className="text-gray-900 text-sm font-semibold">Reset the whole election plan?</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Every stage is cleared back to Stage 1. Candidates, votes and published results are
              retained permanently.
            </p>

            <label className="block text-xs text-gray-600 mb-1" htmlFor="reset-school-year">
              New School Year
            </label>
            <input
              id="reset-school-year"
              value={resetSchoolYear}
              onChange={(e) => setResetSchoolYear(e.target.value)}
              placeholder="2027-2028"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 mb-1"
            />
            <p className="text-[11px] text-gray-400 mb-4">
              Only needed if this election already has candidates or votes � those cannot be
              discarded, so a new period is started instead.
            </p>

            <label className="block text-xs text-gray-600 mb-1" htmlFor="reset-password">
              Electoral Board Password
            </label>
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-gray-400 shrink-0" />
              <input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitReset(); }}
                placeholder="Your account password"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
              />
            </div>

            {resetError && (
              <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                {resetError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setResetOpen(false)}
                disabled={loading}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReset}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                Reset Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
