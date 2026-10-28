import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import {
  Calendar, Clock, MapPin, Save, Play, Square, Trophy,
  CheckCircle2, Lock, AlertCircle, Loader2, Eye, FileCheck2,
  Megaphone, Users, KeyRound, RotateCcw, ShieldAlert, X, Fingerprint,
  Gavel, ChevronDown, ChevronLeft, ChevronRight, Pencil,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import type { ElectionStage, ElectionPeriod } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import {
  getCurrentElectionId,
  reloadElectionPeriod,
  openElectionRpc,
  forceOpenVotingRpc,
  closeElectionRpc,
  reopenVotingRpc,
  endVotingStageRpc,
  publishResultsRpc,
  proclaimWinnersRpc,
  getProclaimedWinners,
  getProclamationTallyRpc,
  startCandidacyPeriodRpc,
  saveMeetingScheduleRpc,
  endCandidacyPeriodRpc,
  startFingerprintRegistrationRpc,
  stopCampaignRpc,
  saveCampaignWindowRpc,
  countActiveComplaintsRpc,
  resetElectionPlanRpc,
} from "../../lib/supabaseData";
import type { ProclaimedWinner, ProclamationTallyRow, TieResolution } from "../../lib/supabaseData";
import { isSupabaseConfigured } from "../../lib/supabase";
import { FULL_POSITION_ORDER } from "../../lib/partyScope";
import { resolveStage } from "../../lib/electionStage";
import type { Stage } from "../../lib/electionStage";
import { complaintsForElection, substantiatedComplaints, complaintDecisionLabel } from "../../lib/complaints";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { ProclamationDialog, groupTally } from "../../components/ProclamationDialog";
import type { ProclamationDecision, CandidateProfile } from "../../components/ProclamationDialog";
import { FindingsDisclosure } from "../../components/FindingsDisclosure";
import { ProclamationSummary } from "../../components/ProclamationSummary";
import type { SubstantiatedGrievance } from "../../components/ProclamationSummary";

interface StageConfig {
  id: Stage;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const STAGES: StageConfig[] = [
  { id: "application", label: "Application", icon: <Users size={18} />, description: "Open candidacy · set the meeting" },
  { id: "campaign", label: "Campaign", icon: <Megaphone size={18} />, description: "Set the campaign window" },
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
 * resolveStage() lives in lib/electionStage.ts now — the student Apply page
 * needs the same authoritative reading, and it must not import an admin page
 * to get it.  Re-exported here so existing imports keep working.
 */
export { resolveStage } from "../../lib/electionStage";
export type { Stage } from "../../lib/electionStage";

/**
 * The stage the tab opens on.
 *
 * 094 — opening the enrolment window hands the board on to the voting
 * schedule (the start handler moves the view itself). A reload must land in
 * the same place: while Enrolment is the active stage but its window is
 * already open, the board's next job is the Voting schedule, not the stage
 * it has finished scheduling. The stage itself does NOT advance — enrolment
 * stays live until the voting start date arrives or Early Voting Activation
 * runs.
 */
export function initialViewStage(electionPeriod: ElectionPeriod): Stage {
  const stage = resolveStage(electionPeriod);
  if (stage === "fingerprint_registration" && electionPeriod.fingerprintRegistrationStartAt) {
    return "voting";
  }
  return stage;
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
      // The board's Stage 3 work is done once the enrolment window is opened,
      // so the step takes its check mark then (the vote view follows it).
      // The window itself is NOT closed by this: enrolment stays live until
      // the voting start date arrives or Early Voting Activation runs — which
      // is what actually moves the election on to voting. The currentStage
      // clauses keep the step checked for a period that reached voting (or
      // past it) without a recorded window.
      return !!electionPeriod.fingerprintRegistrationStartAt
        || currentStage === "voting" || currentStage === "results";
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

/** An ISO instant -> the "2026-10-20T08:00" a datetime-local input expects. */
function toLocalInput(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Voting hours are fixed by policy: 6:00 AM to 5:00 PM — only the dates move. */
const FIXED_VOTING_START = "06:00";
const FIXED_VOTING_END = "17:00";

/** Tomorrow as a YYYY-MM-DD string (local time) — the earliest bookable election day. */
function tomorrowDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The current calendar year — the earliest selectable school-year start. */
function currentYear(): number {
  return new Date().getFullYear();
}

/**
 * 082 venue options. The stored `venue` value is the composed string; the
 * dropdown choice is reverse-mapped best-effort when a saved venue loads.
 */
type VenueChoice = "covered_court" | "classroom" | "others";

function parseVenue(venue?: string): { choice: VenueChoice; detail: string } {
  if (!venue) return { choice: "covered_court", detail: "" };
  if (venue === "CNNHS Covered Court") return { choice: "covered_court", detail: "" };
  if (venue === "CNNHS Classroom") return { choice: "classroom", detail: "" };
  if (venue.startsWith("CNNHS Classroom")) {
    return { choice: "classroom", detail: venue.replace(/^CNNHS Classroom\s*[—–-]?\s*/, "").trim() };
  }
  return { choice: "others", detail: venue };
}

function composeVenue(choice: VenueChoice, detail: string): string {
  if (choice === "covered_court") return "CNNHS Covered Court";
  if (choice === "classroom") return detail.trim() ? `CNNHS Classroom — ${detail.trim()}` : "CNNHS Classroom";
  return detail.trim();
}

/** A date-only value + a fixed hour -> an ISO instant. Date-only windows
 *  (Campaign, Fingerprint Registration) open 06:00 and close 17:00. */
function dateInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/** Every date/time picker on the Election Setup tab, keyed for the
 *  field-level red highlight shown when a save finds one empty. */
type PickerField =
  | "meetingDate" | "meetingTime"
  | "campaignStart" | "campaignEnd"
  | "fpStart" | "fpEnd"
  | "votingStart" | "votingEnd";

const PICKER_BASE_CLASS = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50";

/** A picker flagged by a failed save gets the red missing-field highlight.
 *  The gray tokens are swapped (not appended) so the red always wins. */
function pickerClassName(flagged: boolean | undefined, base: string = PICKER_BASE_CLASS): string {
  if (!flagged) return base;
  return base
    .replace("border-gray-200", "border-red-300")
    .replace("bg-gray-50", "bg-red-50");
}

/** Validation for a paired start/end date window: flags exactly the empty
 *  pickers and names them in the banner message. Null when both are set. */
function missingWindow(
  startValue: string,
  endValue: string,
  startKey: PickerField,
  endKey: PickerField,
  label: string,
): { fields: PickerField[]; message: string } | null {
  if (startValue && endValue) return null;
  const fields: PickerField[] = [];
  if (!startValue) fields.push(startKey);
  if (!endValue) fields.push(endKey);
  return {
    fields,
    message: !startValue && !endValue
      ? `Choose the ${label} start and end date before saving.`
      : !startValue
        ? `Choose the ${label} start date before saving.`
        : `Choose the ${label} end date before saving.`,
  };
}

export default function AdminElectionSetup() {
  const {
    electionPeriod, setElectionPeriod, applyElectionPeriod,
    addLog, currentUser, candidates, complaints,
    students, insertNotification,
  } = useApp();

  const [loading, setLoading] = useState(false);
  // Errors render INSIDE the stage card that caused them, below that stage's
  // inputs — keyed by stage instead of one global banner.
  const [stageErrors, setStageErrors] = useState<Partial<Record<Stage, string>>>({});
  // Field-level highlight: when a save finds a picker empty (or invalid),
  // the offending input is outlined red beside the stage's error banner.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PickerField, boolean>>>({});
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
  // Stage 1 year picker: a calendar-style popover grid. The window shows 12
  // years at a time; past years are never selectable, so ‹ is disabled while
  // the window already starts at the current year.
  const [schoolYearPickerOpen, setSchoolYearPickerOpen] = useState(false);
  const [schoolYearWindowStart, setSchoolYearWindowStart] = useState(currentYear);
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("09:00");
  // 082 — Stage 2 Campaign window, held as date-only strings (the hours are
  // fixed: opens 06:00 on the start day, closes 17:00 on the end day).
  const [campaignStart, setCampaignStart] = useState("");
  const [campaignEnd, setCampaignEnd] = useState("");
  // 093 — the committed Campaign window is locked: both pickers are
  // disabled and only the Commissioner of Electoral Board gets an "Edit"
  // button that re-enables them.  This flag is that unlock.
  const [campaignEditing, setCampaignEditing] = useState(false);
  // Fingerprint Registration window, also date-only since 082.
  const [fpStart, setFpStart] = useState("");
  const [fpEnd, setFpEnd] = useState("");
  // 094 — the saved enrolment window is a locked record too: both pickers go
  // disabled and only the Commissioner of Electoral Board gets the "Edit"
  // button that re-enables them.  This flag is that unlock.
  const [fpEditing, setFpEditing] = useState(false);
  // 094 — same for the voting schedule: once a schedule exists its dates,
  // venue and modality are locked (the Save button becomes "Save Changes")
  // and only the Commissioner of Electoral Board can unlock them.
  const [votingEditing, setVotingEditing] = useState(false);
  // 082 — venue dropdown; the composed string lands in the `venue` column.
  const [venueChoice, setVenueChoice] = useState<VenueChoice>("covered_court");
  const [venueDetail, setVenueDetail] = useState("");
  const [activeComplaints, setActiveComplaints] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  // 084 — password gate for the two consequential voting moves (reopen /
  // end stage). Mirrors the reset-dialog flow: the password is verified
  // server-side by the RPC, never stored.
  const [voteGate, setVoteGate] = useState<null | "reopen" | "end">(null);
  const [gatePassword, setGatePassword] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [votingScheduleSaved, setVotingScheduleSaved] = useState(false);
  // Single-stage view: only the viewed stage's card renders. The stepper and
  // the prev/next row navigate between stages; the view follows the
  // election's active stage whenever it moves.
  const [viewStage, setViewStage] = useState<Stage>(() => initialViewStage(electionPeriod));

  const currentStage = resolveStage(electionPeriod);
  const hasPeriod = isUuid(electionPeriod.id || "") || !!electionId;
  // Opening the vote is what ends both earlier stages. From "voting" on
  // (including "results") the Stage 1/2 cards must stop offering actions:
  // the RPCs already refuse them, and in mock mode the handlers would walk
  // the election backwards to application/campaign.
  const pastCampaign = currentStage === "voting" || currentStage === "results";

  // When the election's active stage moves, the view follows it — and on a
  // reload it opens on the stage that still has work (see initialViewStage).
  useEffect(() => {
    setViewStage(initialViewStage(electionPeriod));
  }, [currentStage]);

  // 093 — the Campaign window unlocks only while the campaign stage is
  // current.  Once the stage moves on (End Campaign Early, Open Voting) the
  // window is final, so the editor closes itself.
  // 094 — same for the enrolment window: it can only be edited while the
  // Fingerprint Registration stage is current.
  useEffect(() => {
    if (currentStage !== "campaign") setCampaignEditing(false);
    if (currentStage !== "fingerprint_registration") setFpEditing(false);
  }, [currentStage]);

  // 094 — the voting schedule can only be edited while the vote has not
  // started: once it is running (or results are out) the saved row is final.
  useEffect(() => {
    if (electionPeriod.isActive || currentStage === "results") setVotingEditing(false);
  }, [electionPeriod.isActive, currentStage]);

  // Results unlock only after the vote was actually opened (stage voting /
  // results) and then closed: saving the schedule alone leaves the period at
  // campaign / fingerprint_registration.  publish_results_rpc is itself what
  // moves the stage to 'results', so that stage cannot be the gate.
  // 084 — Stage 5 unlocks only when the Voting Stage was ENDED (the
  // password action), not while the vote is merely paused after a close.
  const votingConcluded = currentStage === "results";

  const [form, setForm] = useState({
    startDate: electionPeriod.startDate || tomorrowDateStr(),
    startTime: FIXED_VOTING_START,
    endDate: electionPeriod.endDate || electionPeriod.startDate || tomorrowDateStr(),
    endTime: FIXED_VOTING_END,
    electionModality: electionPeriod.electionModality || "digital",
  });

  // 082 follow-up — there is no separate Save button in Stage 4: Open Voting
  // commits the schedule (dates, modality, venue) and then opens the election.
  const openConfirm = useConfirm({ title: "Open Voting?", description: "This saves the voting schedule (dates, modality and venue), starts the Voting Period, and enables kiosk voting.", confirmText: "Open Voting" });
  const closeConfirm = useConfirm({ title: "Close Voting?", description: "This pauses the voting period. Students will no longer be able to cast votes. Reopen Voting or End Voting Stage (Electoral Board password) afterwards.", confirmText: "Close Voting", destructive: true });
  const startCandidacyConfirm = useConfirm({ title: "Start the Candidate Application Period?", description: "Students will be able to apply for candidacy. Applications are sent to the Screening and Validation Commissioner.", confirmText: "Start Application Period" });
  // 082 — the meeting is saved from Stage 1 and no longer ends candidacy;
  // "End Application Stage" is the separate, one-way transition.
  const saveMeetingConfirm = useConfirm({ title: "Save the Meeting Schedule?", description: "This records the Rules Discussion Meeting date and time. It can still be changed until the Application Stage ends.", confirmText: "Save Schedule" });
  const endCandidacyConfirm = useConfirm({ title: "End the Application Stage?", description: "Applications close for the rest of this election and cannot be reopened. The election moves to the Campaign Stage and the meeting schedule locks.", confirmText: "End Application Stage", destructive: true });
  const startCampaignConfirm = useConfirm({ title: "Start the Campaign Period?", description: "This records the Campaign Period start and end dates and sets the campaign in motion. The window is then locked — it can only be changed by the Commissioner of Electoral Board from the Edit button.", confirmText: "Start Campaign" });
  // 093 — the update path gets its own wording: the window is already
  // running, this moves its start and end dates.
  const updateCampaignConfirm = useConfirm({ title: "Update the Campaign Period?", description: "This moves the Campaign Period start and end dates. The window locks again as soon as it is saved.", confirmText: "Update Window" });
  const stopCampaignConfirm = useConfirm({ title: "End the Campaign Period Early?", description: "This ends the Campaign Period early. The election moves to Fingerprint Registration; the enrolment window stays unscheduled until you start it.", confirmText: "End Campaign Early", destructive: true });
  const fpConfirm = useConfirm({ title: "Start Fingerprint Registration?", description: "Voters may enrol their fingerprint at the biometric kiosks for the window you set.", confirmText: "Start Registration" });
  // 081 — one confirm covers the merged publish + proclaim action.
  const proclaimConfirm = useConfirm({ title: "Publish Results & Proclaim Winners?", description: "Results become publicly visible on the Official Results page and the winners are officially proclaimed per position. This action is irreversible.", confirmText: "Publish & Proclaim", destructive: true });

  const approvedCount = candidates.filter((c) => c.status === "approved").length;
  // The vote cannot open while any standard position has no approved
  // candidate standing in it.
  const emptyPositions = useMemo(() => {
    const approvedByPosition = new Map<string, number>();
    for (const c of candidates) {
      if (c.status === "approved") {
        approvedByPosition.set(c.position, (approvedByPosition.get(c.position) ?? 0) + 1);
      }
    }
    return FULL_POSITION_ORDER.filter((p) => (approvedByPosition.get(p) ?? 0) === 0);
  }, [candidates]);
  const logUser = currentUser?.name || "Electoral Board";
  const stageLabel = STAGE_LABELS[electionPeriod.lifecycleStage || "application"];

  // Complaints stay with the election they were filed under (089): only the
  // current period's rows count.  The count is a UI affordance — the
  // authoritative gate lives in publish_results_rpc / proclaim_winners_rpc
  // (089 restores ELECT-02).  An RPC is only consulted when the period
  // exists and context has nothing to say.
  const electionComplaints = complaintsForElection(complaints, electionPeriod.id);
  const filedComplaints = electionComplaints.filter((c) => c.status === "filed").length;
  const knownComplaintCount = filedComplaints > 0 ? filedComplaints : activeComplaints;
  const complaintsPending = (knownComplaintCount ?? 0) > 0;
  const filedComplaintSubjects = electionComplaints
    .filter((c) => c.status === "filed")
    .map((c) => c.subject);

  // 097 — already-resolved complaints, classified by the Grievance
  // Commissioner.  A substantiated grievance forces a Complaint Reason in
  // the proclamation dialog; the rest are only noted in Stage 5.  Each
  // substantiated grievance also shows its read-only Findings.
  const resolvedComplaints = electionComplaints.filter((c) => c.status === "accepted");
  const substantiatedGrievances: SubstantiatedGrievance[] = substantiatedComplaints(electionComplaints)
    .map((c) => ({ id: c.id, subject: c.subject, findings: c.findings ?? null }));
  // Substantiated grievances have their own red section below — this list
  // only notes the classifications that do not block proclamation.
  const otherResolvedComplaints = resolvedComplaints.filter((c) => c.decision !== "substantiated");

  // The proclamation tally carries only names — join each candidate's
  // profile details (photo, grade level) by id so the review dialog shows
  // the full candidate row, matching the Official Results page.
  const candidateProfiles = useMemo(() => {
    const map: Record<string, CandidateProfile> = {};
    for (const c of candidates) {
      map[c.id] = { picture: c.picture, gradeLevel: c.gradeLevel };
    }
    return map;
  }, [candidates]);

  const clearErrors = useCallback(() => {
    setStageErrors({});
    setFieldErrors({});
  }, []);

  const showError = useCallback((msg: string, stage: Stage) => {
    setStageErrors((prev) => ({ ...prev, [stage]: msg }));
    setSuccess(null);
  }, []);

  /** Flag the offending pickers (red border) and show the stage banner — the
   *  action buttons stay clickable so the reason is visible on click. */
  const showFieldError = useCallback((stage: Stage, message: string, fields: PickerField[]) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) next[field] = true;
      return next;
    });
    showError(message, stage);
  }, [showError]);

  /** Clear a picker's red highlight as soon as a value is chosen. */
  const clearFieldError = useCallback((field: PickerField) => {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: false } : prev));
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setStageErrors({});
    setFieldErrors({});
  }, []);

  /** A stage's error banner — rendered inside the stage card, below its inputs. */
  const renderStageError = (stage: Stage) => {
    const message = stageErrors[stage];
    if (!message) return null;
    return (
      <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-sm text-red-700">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>{message}</span>
      </div>
    );
  };

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

  // The proclaim RPC returns the winners only once, at the moment of
  // proclaiming; they are then held in component state.  The rows persist in
  // the `proclamations` ledger, so rehydrate them when the period is already
  // proclaimed (fresh mount after a reload, or the effect re-firing after
  // commitProclaim's refreshPeriod flips the flag) — photos included.
  useEffect(() => {
    if (!isSupabaseConfigured || !electionPeriod.proclaimed) return;
    const id = electionPeriod.id || electionId;
    if (!id) return;
    let cancelled = false;
    getProclaimedWinners(id)
      .then((winners) => { if (!cancelled) setProclaimedWinners(winners); })
      .catch(() => { /* the fallback text covers the failure */ });
    return () => { cancelled = true; };
  }, [electionPeriod.id, electionId, electionPeriod.proclaimed]);

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
    // Date-only since 082: the pickers hold YYYY-MM-DD; the fixed hours are
    // applied when the window is saved.
    setFpStart(toLocalInput(electionPeriod.fingerprintRegistrationStartAt).slice(0, 10));
    setFpEnd(toLocalInput(electionPeriod.fingerprintRegistrationEndAt).slice(0, 10));
  }, [electionPeriod.fingerprintRegistrationStartAt, electionPeriod.fingerprintRegistrationEndAt]);

  useEffect(() => {
    if (electionPeriod.startDate) {
      setVotingScheduleSaved(true);
    } else {
      setVotingScheduleSaved(false);
    }
  }, [electionPeriod.startDate]);

  useEffect(() => {
    if (!electionPeriod.startDate) return;
    const check = async () => {
      try {
        const start = new Date(`${electionPeriod.startDate}T${electionPeriod.startTime || '06:00'}:00`);
        if (isNaN(start.getTime())) return;
        if (new Date() >= start) {
          // 094 — the saved voting start is what ends enrolment: a scheduled
          // close date is only a plan, so it must not keep the window "live"
          // past the start of the vote.
          if (electionPeriod.fingerprintRegistrationStartAt && !electionPeriod.isActive) {
            // A saved start date is the gate (the early return above), so read
            // no other state here: `votingScheduleSaved` is set by an effect
            // one render later, and this effect captures it as false forever.
            if (isSupabaseConfigured && (electionPeriod.id || electionId) && votingSequenced) {
              try {
                await forceOpenVotingRpc(electionPeriod.id || electionId!);
                await refreshPeriod();
              } catch {}
            }
          }
        }
      } catch {}
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [electionPeriod.startDate, electionPeriod.startTime, electionPeriod.fingerprintRegistrationStartAt, electionPeriod.fingerprintRegistrationEndAt, electionPeriod.isActive]);

  // 082 — mirror the saved Campaign window into the Stage 2 date pickers.
  useEffect(() => {
    setCampaignStart(toLocalInput(electionPeriod.campaignStartDate).slice(0, 10));
    setCampaignEnd(toLocalInput(electionPeriod.campaignEndDate).slice(0, 10));
  }, [electionPeriod.campaignStartDate, electionPeriod.campaignEndDate]);

  // 082 — reverse-map the saved venue onto the dropdown + detail input.
  useEffect(() => {
    const parsed = parseVenue(electionPeriod.venue);
    setVenueChoice(parsed.choice);
    setVenueDetail(parsed.detail);
  }, [electionPeriod.venue]);

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
    clearErrors();
    if (pastCampaign) {
      showError("The Candidate Application Period is over — reset the election plan to start a new one.", "application");
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
      showError(err.message || "Failed to start the Candidate Application Period.", "application");
    } finally {
      setLoading(false);
    }
  };

  /** 082 — ends the Application Stage: applications close permanently and the
   *  election moves to the Campaign Stage.  The meeting must be saved first
   *  (its schedule locks with the stage), and every position needs an
   *  approved candidate — the vote could never open otherwise. */
  const handleEndApplication = async () => {
    clearErrors();
    if (pastCampaign) {
      showError("The Candidate Application Period is already over.", "application");
      return;
    }
    if (!hasMeeting) {
      showError("Save the Rules Discussion Meeting schedule before ending the Application Stage.", "application");
      return;
    }
    if (emptyPositions.length > 0) {
      showError(
        `The Candidacy Application Stage cannot end — no approved candidate for: ${emptyPositions.join(", ")}. Every position needs at least one approved candidate.`,
        "application",
      );
      return;
    }
    const ok = await endCandidacyConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to end.");
        await endCandidacyPeriodRpc(id);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, candidacyOpen: false, lifecycleStage: "campaign" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Candidate Application Period Ended",
        details: "Applications are closed for the rest of this election. The election moved to the Campaign Stage.",
        type: "warning",
      });
      showSuccess("The Application Stage has ended. The election is now in the Campaign Stage.");
    } catch (err: any) {
      showError(err.message || "Failed to end the Application Stage.", "application");
    } finally {
      setLoading(false);
    }
  };

  /** 082 — saves (or re-saves) the Rules Discussion Meeting from Stage 1.
   *  This no longer ends candidacy or moves the stage: the schedule is
   *  editable until the board ends the Application Stage, and the RPC
   *  refuses once it has. */
  const handleSaveMeeting = async () => {
    clearErrors();
    if (pastCampaign || currentStage !== "application") {
      showError("The Application Stage has ended — the meeting schedule can no longer be changed.", "application");
      return;
    }
    if (!hasPeriod) {
      showError("Start the Candidate Application Period first.", "application");
      return;
    }
    // The button is open while the Application Stage is active; an empty
    // picker surfaces here: the banner names it and the input is outlined red.
    if (!meetingDate || !meetingTime) {
      const fields: PickerField[] = [];
      if (!meetingDate) fields.push("meetingDate");
      if (!meetingTime) fields.push("meetingTime");
      showFieldError(
        "application",
        !meetingDate && !meetingTime
          ? "Choose a meeting date and time before saving the schedule."
          : !meetingDate
            ? "Choose a meeting date before saving the schedule."
            : "Choose a meeting time before saving the schedule.",
        fields,
      );
      return;
    }
    // Policy: the meeting is booked for tomorrow or later, inside the fixed
    // daily hours.  The date floor only fires when the date was actually
    // moved, so re-saving an already-saved meeting is never blocked.
    const savedMeeting = electionPeriod.rulesDiscussionAt
      ? toLocalInput(electionPeriod.rulesDiscussionAt)
      : "";
    if (meetingDate !== savedMeeting.slice(0, 10) && meetingDate < tomorrowDateStr()) {
      showFieldError("application", "The meeting date must be tomorrow or later.", ["meetingDate"]);
      return;
    }
    if (meetingTime < FIXED_VOTING_START || meetingTime > FIXED_VOTING_END) {
      showFieldError("application", "The meeting time must be between 6:00 AM and 5:00 PM.", ["meetingTime"]);
      return;
    }
    const ok = await saveMeetingConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("Start the Candidate Application Period first.");
        await saveMeetingScheduleRpc(id, toMeetingIso(meetingDate, meetingTime));
        await refreshPeriod();
      } else {
        applyElectionPeriod({
          ...electionPeriod,
          rulesDiscussionAt: toMeetingIso(meetingDate, meetingTime),
        });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Campaign Meeting Scheduled",
        details: `Rules Discussion Meeting set for ${meetingDate} ${meetingTime}. The schedule can still be changed until the Application Stage ends.`,
        type: "success",
      });
      showSuccess("The meeting schedule has been saved.");
    } catch (err: any) {
      showError(err.message || "Failed to save the meeting schedule.", "application");
    } finally {
      setLoading(false);
    }
  };

  const handleStopCampaign = async () => {
    clearErrors();
    if (pastCampaign) {
      showError("The Campaign Period is already over.", "campaign");
      return;
    }
    // A stage cannot end without starting: the window must be recorded first.
    if (!hasCampaignWindow) {
      showError("Start the Campaign Period before ending it early.", "campaign");
      return;
    }
    const ok = await stopCampaignConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("Start the Candidate Application Period first.");
        await stopCampaignRpc(id);
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, lifecycleStage: "fingerprint_registration" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Campaign Period Ended Early",
        details: "The Campaign Period was ended early. The election moved to the Fingerprint Registration stage; the enrolment window is not scheduled yet.",
        type: "warning",
      });
      showSuccess("Campaign Period ended early. The election is now at Fingerprint Registration.");
    } catch (err: any) {
      showError(err.message || "Failed to end the Campaign Period.", "campaign");
    } finally {
      setLoading(false);
    }
  };

  /** 082 follow-up — "Start Campaign" commits the Campaign Period window.
   *  The stage transition itself stays with "End Application Stage"; this is
   *  the plain schedule record the campaign runs on.
   *
   *  093 — once the window exists it is locked, so this handler is reachable
   *  in two ways: the first save (Start Campaign) and an explicit update
   *  after the Commissioner of Electoral Board clicked "Edit".  The write
   *  goes through save_campaign_window_rpc, which re-checks the role and the
   *  stage server-side. */
  const handleStartCampaign = async () => {
    clearErrors();
    if (!hasPeriod) {
      showError("Start the Candidate Application Period first.", "campaign");
      return;
    }
    // A locked window cannot be written: the pickers are disabled, so the
    // only way here is a stale click.  Say so instead of silently saving.
    if (campaignWindowLocked) {
      showError("Click Edit to change the Campaign Period.", "campaign");
      return;
    }
    // The button stays clickable, so empty pickers surface here: the banner
    // names them and the inputs are outlined red.
    const missingCampaign = missingWindow(campaignStart, campaignEnd, "campaignStart", "campaignEnd", "campaign");
    if (missingCampaign) {
      showFieldError("campaign", missingCampaign.message, missingCampaign.fields);
      return;
    }
    if (campaignEnd < campaignStart) {
      showFieldError("campaign", "The campaign end date must be after the start date.", ["campaignEnd"]);
      return;
    }
    // Calendar rule: tomorrow or later, but only when a date is being moved —
    // updating the saved window is never blocked.
    const savedStart = toLocalInput(electionPeriod.campaignStartDate).slice(0, 10);
    const savedEnd = toLocalInput(electionPeriod.campaignEndDate).slice(0, 10);
    if (campaignStart !== savedStart && campaignStart < tomorrowDateStr()) {
      showFieldError("campaign", "The campaign start date must be tomorrow or later.", ["campaignStart"]);
      return;
    }
    if (campaignEnd !== savedEnd && campaignEnd < tomorrowDateStr()) {
      showFieldError("campaign", "The campaign end date must be tomorrow or later.", ["campaignEnd"]);
      return;
    }
    const isUpdate = hasCampaignWindow;
    const ok = isUpdate
      ? await updateCampaignConfirm.confirm()
      : await startCampaignConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      const startIso = dateInstant(campaignStart, FIXED_VOTING_START);
      const endIso = dateInstant(campaignEnd, FIXED_VOTING_END);
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("Start the Candidate Application Period first.");
        await saveCampaignWindowRpc(id, startIso, endIso);
        await refreshPeriod();
      } else {
        applyElectionPeriod({
          ...electionPeriod,
          campaignStartDate: startIso,
          campaignEndDate: endIso,
        });
      }
      // The window is committed — lock it again.  The pickers go back to
      // their saved values through the mirror effect below.
      setCampaignEditing(false);
      addLog({
        user: logUser, role: "Admin",
        action: isUpdate ? "Campaign Period Window Updated" : "Campaign Period Started",
        details: `Campaign period: ${campaignStart} - ${campaignEnd}.`,
        type: "success",
      });
      showSuccess(isUpdate
        ? "The Campaign Period window has been updated."
        : "The Campaign Period window has been saved.");
    } catch (err: any) {
      showError(err.message || "Failed to save the Campaign Period.", "campaign");
    } finally {
      setLoading(false);
    }
  };

  /** 093 — leave edit mode without saving: the pickers snap back to the
   *  saved window and lock again. */
  const handleCancelCampaignEdit = () => {
    clearErrors();
    setCampaignStart(toLocalInput(electionPeriod.campaignStartDate).slice(0, 10));
    setCampaignEnd(toLocalInput(electionPeriod.campaignEndDate).slice(0, 10));
    setCampaignEditing(false);
  };

  const handleStartFingerprintRegistration = async () => {
    clearErrors();
    // 094 — a locked window cannot be written: the pickers are disabled, so
    // the only way here is a stale click.  Say so instead of saving.
    if (fpWindowLocked) {
      showError("Click Edit to change the registration window.", "fingerprint_registration");
      return;
    }
    // The button stays clickable, so empty pickers surface here: the banner
    // names them and the inputs are outlined red.
    const missingFp = missingWindow(fpStart, fpEnd, "fpStart", "fpEnd", "registration");
    if (missingFp) {
      showFieldError("fingerprint_registration", missingFp.message, missingFp.fields);
      return;
    }
    if (fpEnd < fpStart) {
      showFieldError("fingerprint_registration", "The Fingerprint Registration end date must be after the start date.", ["fpEnd"]);
      return;
    }
    // Policy (082, date-only): the window opens 6:00 AM on the opening date
    // and closes 5:00 PM on the closing date.  The tomorrow floor only fires
    // when a field was actually moved, so re-saving the saved window is never
    // blocked.
    const savedFpStart = toLocalInput(electionPeriod.fingerprintRegistrationStartAt).slice(0, 10);
    const savedFpEnd = toLocalInput(electionPeriod.fingerprintRegistrationEndAt).slice(0, 10);
    if (fpStart !== savedFpStart && fpStart < tomorrowDateStr()) {
      showFieldError("fingerprint_registration", "The registration opening date must be tomorrow or later.", ["fpStart"]);
      return;
    }
    if (fpEnd !== savedFpEnd && fpEnd < tomorrowDateStr()) {
      showFieldError("fingerprint_registration", "The registration closing date must be tomorrow or later.", ["fpEnd"]);
      return;
    }
    // Stage 3 is announced to every voter ONCE, when the board opens it.
    // "Update Registration Window" clicks land here too and must not
    // re-notify the whole student body.
    const firstOpen = !electionPeriod.fingerprintRegistrationStartAt;
    const ok = await fpConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      const startIso = dateInstant(fpStart, FIXED_VOTING_START);
      const endIso = dateInstant(fpEnd, FIXED_VOTING_END);
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
      // The window is committed — lock it again (the mirror effect restores
      // the saved dates into the pickers).
      setFpEditing(false);
      showSuccess("Fingerprint Registration is now open.");
      setViewStage("voting");
    } catch (err: any) {
      showError(err.message || "Failed to start Fingerprint Registration.", "fingerprint_registration");
    } finally {
      setLoading(false);
    }
  };

  /** 094 — leave edit mode without saving: the pickers snap back to the saved
   *  window and lock again. */
  const handleCancelFpEdit = () => {
    clearErrors();
    setFpStart(toLocalInput(electionPeriod.fingerprintRegistrationStartAt).slice(0, 10));
    setFpEnd(toLocalInput(electionPeriod.fingerprintRegistrationEndAt).slice(0, 10));
    setFpEditing(false);
  };

  const handleSaveVotingSchedule = async () => {
    clearErrors();
    // 094 — a locked schedule cannot be written: the fields are disabled, so
    // the only way here is a stale click. Say so instead of saving.
    if (votingScheduleLocked) {
      showError("Click Edit to change the voting schedule.", "voting");
      return;
    }
    if (!hasMeeting) {
      showError("Schedule the campaign meeting before saving voting schedule.", "voting");
      return;
    }
    if (!votingSequenced) {
      showError("End the Campaign Period and start Fingerprint Registration before saving voting schedule.", "voting");
      return;
    }
    const missingVoting = missingWindow(form.startDate, form.endDate, "votingStart", "votingEnd", "voting");
    if (missingVoting) {
      showFieldError("voting", missingVoting.message, missingVoting.fields);
      return;
    }
    if (form.endDate < form.startDate) {
      showFieldError("voting", "End date must be after start date.", ["votingEnd"]);
      return;
    }
    if (form.startDate !== electionPeriod.startDate && form.startDate < tomorrowDateStr()) {
      showFieldError("voting", "The voting start date must be tomorrow or later.", ["votingStart"]);
      return;
    }
    if (venueChoice === "classroom" && !venueDetail.trim()) {
      showError("Enter the classroom number or name.", "voting");
      return;
    }
    if (venueChoice === "others" && !venueDetail.trim()) {
      showError("Specify the venue.", "voting");
      return;
    }
    if (emptyPositions.length > 0) {
      showError(
        `The election cannot start — no approved candidate for: ${emptyPositions.join(", ")}.`,
        "voting",
      );
      return;
    }
    setLoading(true);
    try {
      const venue = composeVenue(venueChoice, venueDetail);
      const res = await setElectionPeriod({ ...electionPeriod, ...form, venue });
      if (!res.ok) throw new Error(res.message || "Failed to save the voting schedule.");
      await refreshPeriod();
      setVotingScheduleSaved(true);
      // The schedule is committed — lock it again.
      setVotingEditing(false);
      addLog({
        user: logUser, role: "Admin",
        action: "Voting Schedule Saved",
        details: `Voting schedule saved: ${form.startDate} ${form.startTime} - ${form.endDate} ${form.endTime}, Modality: ${form.electionModality}, Venue: ${venue}.`,
        type: "success",
      });
      showSuccess("Voting schedule saved.");
    } catch (err: any) {
      showError(err.message || "Failed to save voting schedule.", "voting");
    } finally {
      setLoading(false);
    }
  };

  /** 094 — leave edit mode without saving: the fields snap back to the saved
   *  row and lock again. `form` has no mirror effect of its own, so the dates,
   *  modality and venue are restored from the period explicitly. */
  const handleCancelVotingEdit = () => {
    clearErrors();
    const savedVenue = parseVenue(electionPeriod.venue);
    setForm({
      startDate: electionPeriod.startDate || tomorrowDateStr(),
      startTime: FIXED_VOTING_START,
      endDate: electionPeriod.endDate || electionPeriod.startDate || tomorrowDateStr(),
      endTime: FIXED_VOTING_END,
      electionModality: electionPeriod.electionModality || "digital",
    });
    setVenueChoice(savedVenue.choice);
    setVenueDetail(savedVenue.detail);
    setVotingEditing(false);
  };

  /** 082 follow-up — there is no separate Save button: Open Voting commits
   *  the schedule (dates, modality, venue) and then opens the election, so
   *  the row the kiosk and the public pages read is always what was on
   *  screen. */
  const handleOpenElection = async (force: boolean = false) => {
    clearErrors();
    // The button is open only while the vote is actually startable (the
    // disabled state covers the meeting / roster gates); the guards below
    // catch empty pickers and any period filled from outside this form.
    if (!hasMeeting) {
      showError("Schedule the campaign meeting before opening voting.", "voting");
      return;
    }
    // Strict sequencing: Stage 3 must be the active stage (or the vote is
    // being re-opened after an early close) with a started enrolment window.
    if (!votingSequenced) {
      showError("End the Campaign Period and start Fingerprint Registration before opening voting.", "voting");
      return;
    }
    if (!votingScheduleSaved && !electionPeriod.startDate) {
      showError("Save the voting schedule first.", "voting");
      return;
    }
    const missingVoting = missingWindow(form.startDate, form.endDate, "votingStart", "votingEnd", "voting");
    if (missingVoting) {
      showFieldError("voting", missingVoting.message, missingVoting.fields);
      return;
    }
    if (form.endDate < form.startDate) {
      showFieldError("voting", "End date must be after start date.", ["votingEnd"]);
      return;
    }
    // Voting hours are fixed (06:00-17:00), so only the dates are validated.
    // The tomorrow floor applies only when the date is being moved: re-opening
    // an election whose saved day is today must keep working.
    if (form.startDate !== electionPeriod.startDate && form.startDate < tomorrowDateStr()) {
      showFieldError("voting", "The voting start date must be tomorrow or later.", ["votingStart"]);
      return;
    }
    // The venue dropdown needs its detail filled in for the composite
    // choices; the covered court needs nothing.
    if (venueChoice === "classroom" && !venueDetail.trim()) {
      showError("Enter the classroom number or name.", "voting");
      return;
    }
    if (venueChoice === "others" && !venueDetail.trim()) {
      showError("Specify the venue.", "voting");
      return;
    }
    // The vote cannot open while a position stands empty: the button is
    // disabled for the same reason, so this guard is the last line of
    // defence against a period filled from outside this form.
    if (emptyPositions.length > 0) {
      showError(
        `The election cannot start — no approved candidate for: ${emptyPositions.join(", ")}.`,
        "voting",
      );
      return;
    }
    const ok = await openConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      const venue = composeVenue(venueChoice, venueDetail);
      // Persist the schedule BEFORE the stage flip: open_election_rpc opens
      // the row as saved, and the kiosk and public pages read that row.
      const res = await setElectionPeriod({ ...electionPeriod, ...form, venue });
      if (!res.ok) throw new Error(res.message || "Failed to save the voting schedule.");
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to open.");
        if (force) {
          await forceOpenVotingRpc(id);
        } else {
          await openElectionRpc(id);
        }
        await refreshPeriod();
      } else {
        applyElectionPeriod({ ...electionPeriod, ...form, venue, candidacyOpen: false, isActive: true, lifecycleStage: "voting" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: force ? "Early Voting Activated" : "Election Opened",
        details: `Voting period: ${form.startDate} ${form.startTime} - ${form.endDate} ${form.endTime}, Modality: ${form.electionModality}, Venue: ${venue}. The voting period has been opened.`,
        type: "success",
      });
      showSuccess("Voting is now open.");
    } catch (err: any) {
      showError(err.message || "Failed to open voting.", "voting");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseVoting = async () => {
    clearErrors();
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
        // 084 — closing only pauses the vote; Reopen/End Voting Stage
        // (password) do the consequential moves.
        applyElectionPeriod({ ...electionPeriod, isActive: false });
      }
      addLog({
        user: logUser, role: "Admin",
        action: "Election Closed",
        details: "The voting period was paused. Reopen Voting or End Voting Stage (Electoral Board password) to continue.",
        type: "warning",
      });
      showSuccess("Voting is now closed. Reopen it or end the Voting Stage below.");
    } catch (err: any) {
      showError(err.message || "Failed to close voting.", "voting");
    } finally {
      setLoading(false);
    }
  };

  /** 084 — the password gate behind "Reopen Voting" / "End Voting Stage".
   *  The RPC verifies the Electoral Board password server-side; the
   *  refreshed row is what moves the stage. */
  const submitVoteGate = async () => {
    setGateError(null);
    if (!gatePassword) {
      setGateError("Enter the Electoral Board password to continue.");
      return;
    }
    const action = voteGate;
    if (!action) return;
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const id = electionPeriod.id || electionId;
        if (!id) throw new Error("There is no election period to update.");
        if (action === "reopen") await reopenVotingRpc(id, gatePassword);
        else await endVotingStageRpc(id, gatePassword);
        await refreshPeriod();
      } else if (action === "reopen") {
        // Mock mode has no server to verify against — mirror the reset.
        applyElectionPeriod({ ...electionPeriod, isActive: true });
      } else {
        applyElectionPeriod({ ...electionPeriod, isActive: false, lifecycleStage: "results" });
      }
      addLog({
        user: logUser, role: "Admin",
        action: action === "reopen" ? "Voting Period Reopened" : "Voting Stage Ended",
        details: action === "reopen"
          ? "The voting period was reopened with the Electoral Board password. Students can cast votes again."
          : "The Voting Stage was ended with the Electoral Board password. The election moved to the Results stage.",
        type: "warning",
      });
      showSuccess(
        action === "reopen"
          ? "Voting has been reopened. Students can cast votes again."
          : "The Voting Stage has ended. The election moved to the Results stage.",
      );
      setVoteGate(null);
      setGatePassword("");
    } catch (err: any) {
      // Keep the dialog open so the board can correct the password and retry.
      setGateError(err.message || "The Electoral Board password was not accepted.");
    } finally {
      setLoading(false);
    }
  };

  // 081 — ONE merged action: "Publish & Proclaim Winners".  Clicking it
  // opens the review dialog and loads the running order for every position;
  // the commit publishes first (the complaint gate is relaxed by 081), then
  // proclaims.  Mock mode has no tally to show, so it keeps a one-shot flow.
  const handlePublishAndProclaim = async () => {
    clearErrors();
    if (!isSupabaseConfigured) {
      const ok = await proclaimConfirm.confirm();
      if (!ok) return;
      applyElectionPeriod({
        ...electionPeriod,
        resultsPublished: true,
        lifecycleStage: "results",
        proclaimed: true,
        proclaimedAt: new Date().toISOString(),
      });
      addLog({
        user: logUser, role: "Admin",
        action: "Results Published & Winners Proclaimed",
        details: "Results published and winners proclaimed (offline mode).",
        type: "success",
      });
      showSuccess("Results published and winners proclaimed.");
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

  // 081 — the dialog has collected a resolution (with how the tie was
  // resolved) for every tie, plus the complaint note when a complaint is on
  // record.  Publish first, then proclaim; both RPCs are safe to retry after
  // a partial failure.  The final confirm carries the same proclamation
  // summary shown at the bottom of the review dialog.
  const commitProclaim = async (
    resolutions: Record<string, TieResolution>,
    decision: ProclamationDecision,
  ) => {
    setTallyError(null);
    const ok = await proclaimConfirm.confirm({
      content: (
        <ProclamationSummary
          positions={groupTally(tally)}
          resolutions={resolutions}
          tieBreakLabel={decision.tieBreak}
          complaintNote={decision.complaintNote}
          complaintReason={decision.complaintReason}
          complaintSubjects={filedComplaintSubjects}
          substantiated={substantiatedGrievances}
        />
      ),
    });
    if (!ok) return;
    setProclaiming(true);
    try {
      const id = electionPeriod.id || electionId;
      if (!id) throw new Error("There is no election period to proclaim winners for.");
      if (!electionPeriod.resultsPublished) {
        await publishResultsRpc(id);
      }
      const winners = await proclaimWinnersRpc(id, resolutions, {
        complaintNote: decision.complaintNote || undefined,
        decisionReason: decision.complaintReason || undefined,
      });
      await refreshPeriod();
      setProclaimedWinners(winners);
      setProclamationOpen(false);
      addLog({
        user: logUser, role: "Admin",
        action: "Results Published & Winners Proclaimed",
        details: `Results published and winners proclaimed for ${winners.length} positions.`
          + (decision.tieBreak ? ` Tie resolution: ${decision.tieBreak}.` : "")
          + (decision.complaintReason ? ` Complaint reason: ${decision.complaintReason}.` : "")
          + (decision.complaintNote ? ` Complaint note: ${decision.complaintNote}.` : ""),
        type: "success",
      });
      showSuccess(`Results published and winners proclaimed for ${winners.length} positions.`);
    } catch (err: any) {
      // Keep the dialog open so the board can see what went wrong and retry.
      setTallyError(err.message || "Failed to publish and proclaim.");
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
      // 078: the School Year is no longer asked for here.  A dirty period is
      // archived without starting a new one; the Commissioner then sets the
      // School Year in Stage 1, which is what creates the next period.
      const result = isSupabaseConfigured
        ? await resetElectionPlanRpc(resetPassword)
        : null;
      // Keep the cached fallback id in step with the reset outcome, so
      // hasPeriod drops and Stage 1 offers the School Year input when the
      // reset retired the period without starting a new one.
      setElectionId(result?.electionPeriodId ?? null);
      await refreshPeriod();
      setResetOpen(false);
      setResetPassword("");
      const mode = result?.mode;
      const detail =
        mode === "noop"
          ? "There was no election period in progress, so there was nothing to reset."
          : mode === "archived" && !result?.electionPeriodId
            ? "The previous election period was archived with all its candidates and votes intact. Set the School Year in Stage 1 to start the next election."
            : result?.archivedPrevious
              ? "The previous election period was archived with all its candidates and votes intact. A new period was created."
              : "The election plan was cleared back to Stage 1.";
      addLog({
        user: logUser, role: "Admin",
        action: "Election Plan Reset",
        details: detail,
        type: "warning",
      });
      showSuccess(detail);
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

  // 082 follow-up — with no Save button in Stage 4, the inputs lock once the
  // schedule is committed (vote running or results out); editing them
  // afterwards would silently change nothing.
  // 094 — a saved voting schedule is a locked record: its dates, venue and
  // modality go disabled and Save becomes "Save Changes" until the
  // Commissioner of Electoral Board unlocks it with the edit icon. The vote
  // running (or results being out) locks the row for good.
  const votingScheduleLocked = votingScheduleSaved && !votingEditing;
  const scheduleLocked =
    electionPeriod.isActive || currentStage === "results" || votingScheduleLocked;
  const hasMeeting = !!electionPeriod.rulesDiscussionAt;
  // The Campaign window is committed by "Start Campaign"; once saved, the
  // button becomes "Update Campaign Window".
  const hasCampaignWindow = !!(electionPeriod.campaignStartDate && electionPeriod.campaignEndDate);
  // 093 — the committed window is a locked record.  Both pickers go
  // disabled and only the Commissioner of Electoral Board is offered the
  // "Edit" button that re-enables them.  The database enforces the same
  // rule (save_campaign_window_rpc); this is the affordance that reaches it.
  const isElectoralBoard = currentUser?.commissionerRole === "electoral_board";
  const campaignWindowLocked = hasCampaignWindow && !campaignEditing;
  // Strict sequencing — only one stage is active at a time: the vote may only
  // open while Stage 3 is the current stage, and the enrolment window must
  // have actually started. A stage cannot end without starting — and once
  // voting closes, the election moves to the Results stage: there is no
  // re-opening the vote.
  const hasFpWindow = !!electionPeriod.fingerprintRegistrationStartAt;
  // 094 — the saved enrolment window is a locked record: the pickers go
  // disabled and the "Update Registration Window" button goes dead until the
  // Commissioner of Electoral Board unlocks it with the edit icon.
  const fpWindowLocked = hasFpWindow && !fpEditing;
  const votingReachable = currentStage === "fingerprint_registration";
  const votingSequenced = votingReachable && hasFpWindow;
  // The vote exists as an openable action only before it concludes: Close
  // Voting moves the election to the Results stage, after which the Stage 4
  // card is read-only and the publish flow takes over.
  const votingOpenable = !electionPeriod.isActive && !electionPeriod.resultsPublished && !pastCampaign;
  // 095 — the open action is "Early Voting Activation" until the SAVED voting
  // start instant arrives; from the due time on it is the scheduled "Open
  // Voting". The label and the RPC follow the same flag: activating early is
  // what ends the enrolment window (force_open_voting_rpc), and 095 clamps a
  // scheduled close date to now() so the window really does finish. Without
  // that, a timing-based "Early Voting Activation" would still call
  // open_election_rpc, which leaves enrolment live.
  const earlyVotingActivation = (() => {
    if (!electionPeriod.startDate) return false;
    const start = new Date(
      `${electionPeriod.startDate}T${electionPeriod.startTime || FIXED_VOTING_START}:00`,
    );
    return !Number.isNaN(start.getTime()) && Date.now() < start.getTime();
  })();
  // Position of the viewed stage in the STAGES order — drives the prev/next row.
  const viewIndex = STAGES.findIndex((s) => s.id === viewStage);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-gray-900">Election Planning</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Electoral Board</span>
          {electionPeriod.schoolYear ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#5C0102]/10 text-[#5C0102] font-medium flex items-center gap-1">
              <Calendar size={12} /> S.Y. {electionPeriod.schoolYear}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium flex items-center gap-1">
              <Calendar size={12} /> No active school year
            </span>
          )}
        </div>
        <p className="text-gray-500 text-sm">
          Five stages, in order: open candidacy and set the meeting, set the campaign window, open
          Fingerprint Registration at the kiosks, run the vote, then announce the result.
        </p>
      </motion.div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {/* Progress Indicator — doubles as stage navigation: click a step to
          view that stage. The maroon step is the ACTIVE stage; the ring marks
          the stage currently on screen. */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center justify-between">
          {STAGES.map((stage, i) => {
            const status = stageStatus(stage.id);
            const viewed = viewStage === stage.id;
            return (
              <div key={stage.id} className="flex items-center flex-1">
                <button
                  type="button"
                  onClick={() => setViewStage(stage.id)}
                  aria-label={`View ${stage.label} stage`}
                  aria-current={viewed ? "step" : undefined}
                  className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C0102]/40"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    viewed && status !== "current" ? "bg-white text-[#5C0102] ring-2 ring-[#5C0102]/40" :
                    status === "complete" ? "bg-green-500 text-white" :
                    status === "current" ? "bg-[#5C0102] text-white" :
                    status === "locked" ? "bg-gray-100 text-gray-400" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {status === "complete" ? <CheckCircle2 size={16} /> : stage.icon}
                  </div>
                  <div className="hidden sm:block text-left">
                    <div className={`text-xs font-medium ${
                      viewed ? "text-gray-900" :
                      status === "complete" ? "text-green-600" :
                      status === "current" ? "text-[#5C0102]" :
                      "text-gray-400"
                    }`}>{stage.label}</div>
                    <div className="text-[10px] text-gray-400">{stage.description}</div>
                  </div>
                </button>
                {i < STAGES.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${status === "complete" ? "bg-green-500" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage 1 � Candidate Application Period */}
      {viewStage === "application" && (
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
          {hasPeriod && electionPeriod.schoolYear && (
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-gray-400" />
              School Year: <strong className="text-gray-700">{electionPeriod.schoolYear}</strong>
            </div>
          )}
          <div className="flex items-center gap-2">
            <FileCheck2 size={14} className="text-gray-400" />
            Students apply here and send their applications to the Screening and Validation Commissioner.
          </div>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-gray-400" />
            Submitted applications: <strong className="text-gray-700">{candidates.filter((c) => c.status === "pending").length}</strong>
            {" "}· Approved candidates: <strong className="text-gray-700">{approvedCount}</strong>
          </div>
        </div>

        {!hasPeriod && (
          <div className="mb-4">
            <label className="block text-xs text-gray-600 mb-1" htmlFor="stage1-school-year">
              School Year
            </label>
            <Popover open={schoolYearPickerOpen} onOpenChange={setSchoolYearPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  id="stage1-school-year"
                  type="button"
                  className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 flex items-center justify-between hover:border-gray-300 transition-colors ${
                    schoolYear ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Calendar size={14} className="text-gray-400" />
                    {schoolYear ? schoolYear.slice(0, 4) : "Select starting year\u2026"}
                  </span>
                  <ChevronDown size={14} className="text-gray-400" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-3">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => setSchoolYearWindowStart((s) => s - 12)}
                    disabled={schoolYearWindowStart - 12 < currentYear()}
                    aria-label="Previous years"
                    className="p-1 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs font-semibold text-gray-700">
                    {schoolYearWindowStart} &ndash; {schoolYearWindowStart + 11}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSchoolYearWindowStart((s) => s + 12)}
                    aria-label="Next years"
                    className="p-1 rounded-md text-gray-500 hover:bg-gray-100"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 12 }, (_, i) => schoolYearWindowStart + i).map((y) => {
                    const disabled = y < currentYear();
                    const picked = schoolYear.slice(0, 4) === String(y);
                    return (
                      <button
                        key={y}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setSchoolYear(`${y}-${y + 1}`);
                          setSchoolYearPickerOpen(false);
                        }}
                        className={`py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                          picked ? "text-white" : "text-gray-700 hover:bg-gray-100"
                        }`}
                        style={picked ? { backgroundColor: "#5C0102" } : undefined}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-2 text-center">
                  Pick the first year of the school year.
                </p>
              </PopoverContent>
            </Popover>
            {schoolYear && (
              <p className="text-xs text-gray-500 mt-1">
                &rarr; This will create School Year <strong className="text-gray-700">{schoolYear}</strong>
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Starting this period creates the election record that every candidacy, vote and result row attaches to.
            </p>
          </div>
        )}

        {renderStageError("application")}

        {pastCampaign ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Candidate Application Period ended when Voting opened.
          </div>
        ) : currentStage !== "application" ? (
          // The Application Stage ended: candidacy is closed for the rest of
          // this election and the meeting schedule locked with it — only
          // resetting the election plan reopens either.
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Candidate Application Period ended when the Campaign Stage started.
            It stays closed for the rest of this election.
          </div>
        ) : (
          <div className="space-y-4">
            {!electionPeriod.candidacyOpen && (
              <button
                onClick={handleStartCandidacy}
                disabled={loading || (!hasPeriod && !schoolYear)}
                title={!hasPeriod && !schoolYear ? "Select the school year first." : undefined}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Start Application Period
              </button>
            )}

            {/* 082 — the Rules Discussion Meeting is scheduled HERE, in Stage 1.
                Saving it does not end candidacy or move the stage: that is the
                "End Application Stage" action below. */}
            <div className="p-3 border border-gray-100 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Rules Discussion Meeting</h4>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div>
                  <label htmlFor="meeting-date" className="block text-xs text-gray-600 mb-1">Meeting Date</label>
                  <input
                    id="meeting-date"
                    type="date"
                    min={tomorrowDateStr()}
                    value={meetingDate}
                    onChange={(e) => { setMeetingDate(e.target.value); clearFieldError("meetingDate"); }}
                    className={pickerClassName(fieldErrors.meetingDate)}
                  />
                </div>
                <div>
                  <label htmlFor="meeting-time" className="block text-xs text-gray-600 mb-1">Time</label>
                  <input
                    id="meeting-time"
                    type="time"
                    min="06:00"
                    max="17:00"
                    value={meetingTime}
                    onChange={(e) => { setMeetingTime(e.target.value); clearFieldError("meetingTime"); }}
                    className={pickerClassName(fieldErrors.meetingTime)}
                  />
                </div>
              </div>
              {hasMeeting && (
                <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle2 size={12} /> Meeting Scheduled
                </div>
              )}
              <p className="text-xs text-gray-400">The meeting is booked for tomorrow or later, between 6:00 AM and 5:00 PM. It can still be changed until the Application Stage ends.</p>
              {/* Open only while the Application Stage is active (a period
                  exists). An empty picker still shows the banner error and a
                  red outline instead of disabling the button. */}
              <button
                onClick={handleSaveMeeting}
                aria-label="Save Meeting Schedule"
                disabled={loading || !hasPeriod}
                title={!hasPeriod ? "Start the Application Period first." : undefined}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Schedule
              </button>
            </div>

            {/* Always clickable: clicking without the prerequisites shows
                the reason in the stage's error banner. */}
            {hasPeriod && (
              <button
                onClick={handleEndApplication}
                disabled={loading}
                className="px-5 py-2.5 bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                End Application Stage
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Stage 2 � Campaign Period */}
      {viewStage === "campaign" && (
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !isStageAccessible("campaign", electionPeriod, currentStage, hasPeriod) ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Megaphone size={16} style={{ color: "#5C0102" }} />
            Stage 2: Campaign Period
          </h3>
        </div>

        {pastCampaign ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Campaign Period ended when Voting opened.
          </div>
        ) : currentStage === "fingerprint_registration" ? (
          // Fingerprint Registration is underway: the campaign stage is over and
          // its controls stay locked until the election plan is reset.
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Campaign Period ended when Fingerprint Registration started.
          </div>
        ) : !isStageAccessible("campaign", electionPeriod, currentStage, hasPeriod) ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Open the Candidate Application Period first.
          </div>
        ) : currentStage === "application" ? (
          // The Application Stage is still current: the campaign window opens
          // for editing once the board ends it.
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Campaign Period starts after the Application Stage ends.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              The Campaign Period runs between the dates below. The Rules Discussion
              Meeting is scheduled in Stage 1 and announced on every approved
              candidate&rsquo;s Apply for Candidacy page.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
              <div>
                <label htmlFor="campaign-start" className="block text-xs text-gray-600 mb-1">Campaign Start</label>
                <input
                  id="campaign-start"
                  type="date"
                  min={tomorrowDateStr()}
                  value={campaignStart}
                  disabled={campaignWindowLocked}
                  onChange={(e) => { setCampaignStart(e.target.value); clearFieldError("campaignStart"); }}
                  className={pickerClassName(fieldErrors.campaignStart, `${PICKER_BASE_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`)}
                />
              </div>
              <div>
                <label htmlFor="campaign-end" className="block text-xs text-gray-600 mb-1">Campaign End</label>
                <div className="flex items-center gap-2">
                  <input
                    id="campaign-end"
                    type="date"
                    min={tomorrowDateStr()}
                    value={campaignEnd}
                    disabled={campaignWindowLocked}
                    onChange={(e) => { setCampaignEnd(e.target.value); clearFieldError("campaignEnd"); }}
                    className={pickerClassName(fieldErrors.campaignEnd, `${PICKER_BASE_CLASS} flex-1 min-w-0 disabled:opacity-50 disabled:cursor-not-allowed`)}
                  />
                  {/* 093 — the lock toggle lives beside the end date: a pencil
                      unlocks the window, an X puts the saved dates back.  Only
                      the Commissioner of Electoral Board is offered it. */}
                  {hasCampaignWindow && isElectoralBoard && (
                    <button
                      type="button"
                      onClick={campaignEditing
                        ? handleCancelCampaignEdit
                        : () => { clearErrors(); setCampaignEditing(true); }}
                      disabled={loading}
                      aria-label={campaignEditing
                        ? "Cancel editing the Campaign Period"
                        : "Edit the Campaign Period"}
                      title={campaignEditing
                        ? "Discard the changes and lock the Campaign Period."
                        : "Unlock the Campaign Period start and end dates."}
                      className="shrink-0 h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-[#5C0102] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {campaignEditing ? <X size={16} /> : <Pencil size={16} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              The window is booked for tomorrow or later, 6:00 AM to 5:00 PM each day.
              {campaignWindowLocked && " It is locked — use the edit icon to move the dates."}
            </p>

            {renderStageError("campaign")}

            <div className="flex flex-wrap items-center gap-3">
              {/* 093 — the committed window is locked.  The primary action
                  stays on screen but goes dead while the window is locked;
                  the edit icon beside the end date is the way in. */}
              <button
                onClick={handleStartCampaign}
                disabled={loading || campaignWindowLocked}
                title={campaignWindowLocked
                  ? "Click the edit icon to change the Campaign Period."
                  : undefined}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : hasCampaignWindow ? <Save size={16} /> : <Play size={16} />}
                {hasCampaignWindow ? "Update Campaign Window" : "Start Campaign"}
              </button>
              {currentStage === "campaign" && (
                <button
                  onClick={handleStopCampaign}
                  disabled={loading || !hasCampaignWindow}
                  title={!hasCampaignWindow
                    ? "Start the Campaign Period first."
                    : "End the Campaign Period early and move to Fingerprint Registration."}
                  className="px-5 py-2.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-amber-200 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                  End Campaign Early
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Stage 3 — Fingerprint Registration */}
      {viewStage === "fingerprint_registration" && (
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        currentStage !== "fingerprint_registration" ? "opacity-60" : ""
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
          {/* 094 — a saved enrolment window (both dates) is only SCHEDULED:
              it does not close until the voting start date arrives or Early
              Voting Activation runs. The old "Registration Closed" wording
              read the scheduled end stamp as a closure. */}
          {electionPeriod.fingerprintRegistrationStartAt && electionPeriod.fingerprintRegistrationEndAt && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <CheckCircle2 size={12} /> Registration Scheduled
            </span>
          )}
        </div>

        {pastCampaign ? (
          // Voting has opened: open_election_rpc force-closes the enrolment
          // window, so Stage 3 stays locked until the election plan is reset.
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Fingerprint Registration closed when Voting opened.
          </div>
        ) : !isStageAccessible("fingerprint_registration", electionPeriod, currentStage, hasPeriod) ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Save the meeting schedule in the Application Stage first.
          </div>
        ) : currentStage !== "fingerprint_registration" ? (
          // Strict sequencing — only one stage active at a time: while the
          // Campaign Stage is current, Stage 3 stays locked. "End Campaign
          // Early" (in the Stage 2 card) is what moves the election here.
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> The Campaign Period must end before Fingerprint Registration opens.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              Voters visit the IoT biometric kiosks during this window to enrol their fingerprint.
              Saving both dates only schedules the window — enrolment stays open until the voting
              start date arrives or Early Voting Activation is clicked, which is what ends it.
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
                  type="date"
                  min={tomorrowDateStr()}
                  value={fpStart}
                  disabled={fpWindowLocked}
                  onChange={(e) => { setFpStart(e.target.value); clearFieldError("fpStart"); }}
                  className={pickerClassName(fieldErrors.fpStart, `${PICKER_BASE_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`)}
                />
              </div>
              <div>
                <label htmlFor="fp-end" className="block text-xs text-gray-600 mb-1">Registration Closes</label>
                <div className="flex items-center gap-2">
                  <input
                    id="fp-end"
                    type="date"
                    min={tomorrowDateStr()}
                    value={fpEnd}
                    disabled={fpWindowLocked}
                    onChange={(e) => { setFpEnd(e.target.value); clearFieldError("fpEnd"); }}
                    className={pickerClassName(fieldErrors.fpEnd, `${PICKER_BASE_CLASS} flex-1 min-w-0 disabled:opacity-50 disabled:cursor-not-allowed`)}
                  />
                  {/* 094 — the lock toggle lives beside the closing date: a
                      pencil unlocks the window, an X puts the saved dates
                      back.  Only the Commissioner of Electoral Board is
                      offered it. */}
                  {hasFpWindow && isElectoralBoard && (
                    <button
                      type="button"
                      onClick={fpEditing
                        ? handleCancelFpEdit
                        : () => { clearErrors(); setFpEditing(true); }}
                      disabled={loading}
                      aria-label={fpEditing
                        ? "Cancel editing the Registration Window"
                        : "Edit the Registration Window"}
                      title={fpEditing
                        ? "Discard the changes and lock the registration window."
                        : "Unlock the Registration Opens and Registration Closes dates."}
                      className="shrink-0 h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-[#5C0102] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {fpEditing ? <X size={16} /> : <Pencil size={16} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              The window opens 6:00 AM on the opening date and closes 5:00 PM on the closing date, tomorrow or later.
              {fpWindowLocked && " It is locked — use the edit icon to move the dates."}
            </p>

            {renderStageError("fingerprint_registration")}

            <div className="flex flex-wrap gap-3">
              {/* 094 — the committed window is locked.  The primary action
                  stays on screen but goes dead while the window is locked;
                  the edit icon beside the closing date is the way in. */}
              <button
                onClick={handleStartFingerprintRegistration}
                disabled={loading || fpWindowLocked}
                title={fpWindowLocked
                  ? "Click the edit icon to change the registration window."
                  : undefined}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
                {electionPeriod.fingerprintRegistrationStartAt ? "Update Registration Window" : "Open Fingerprint Registration"}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Stage 4 — Voting Period */}
      {viewStage === "voting" && (
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
          {!electionPeriod.isActive && hasMeeting && (currentStage === "voting" || currentStage === "results") && (
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
                <label htmlFor="voting-start" className="block text-xs text-gray-600 mb-1">Start Date</label>
                <input id="voting-start" type="date" value={form.startDate} min={tomorrowDateStr()}
                  onChange={(e) => { setForm({ ...form, startDate: e.target.value }); clearFieldError("votingStart"); }}
                  disabled={scheduleLocked}
                  className={pickerClassName(fieldErrors.votingStart, "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed")} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Start Time</label>
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-100 text-gray-500 flex items-center gap-2">
                  <Clock size={14} /> 6:00 AM
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="voting-end" className="block text-xs text-gray-600 mb-1">End Date</label>
                <input id="voting-end" type="date" value={form.endDate} min={tomorrowDateStr()}
                  onChange={(e) => { setForm({ ...form, endDate: e.target.value }); clearFieldError("votingEnd"); }}
                  disabled={scheduleLocked}
                  className={pickerClassName(fieldErrors.votingEnd, "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed")} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">End Time</label>
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-100 text-gray-500 flex items-center gap-2">
                  <Clock size={14} /> 5:00 PM
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Voting hours are fixed (6:00 AM &ndash; 5:00 PM); only the dates can be set.
              {votingScheduleLocked && " The schedule is locked — use the edit icon to change the dates, venue and modality."}
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Election Configuration</h4>
            <div>
              <label htmlFor="election-modality" className="block text-xs text-gray-600 mb-1">Election Modalities</label>
              <select
                id="election-modality"
                value={form.electionModality}
                onChange={(e) => setForm({ ...form, electionModality: e.target.value })}
                disabled={scheduleLocked}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="digital">Digital Election</option>
                <option value="manual">Manual Election</option>
                <option value="hybrid">Hybrid Election</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">How the election is conducted. Digital runs on the biometric kiosks. The schedule is saved when voting opens.</p>
            </div>
          </div>
        </div>

        {/* Venue row — full card width: the venue dropdown takes a third, the
            classroom / others detail input takes the rest, and the save
            button ("Save Schedule" / "Save Changes" with the edit icon beside
            it) sits at the far right. */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <label htmlFor="venue-choice" className="block text-xs text-gray-600 mb-1">Venue</label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-2 w-full sm:w-1/3 shrink-0">
              <MapPin size={14} className="text-gray-400 shrink-0" />
              <select
                id="venue-choice"
                value={venueChoice}
                onChange={(e) => setVenueChoice(e.target.value as VenueChoice)}
                disabled={scheduleLocked}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="covered_court">CNNHS Covered Court</option>
                <option value="classroom">CNNHS Classroom</option>
                <option value="others">Others</option>
              </select>
            </div>
            <div className="flex-1 min-w-0">
              {venueChoice === "classroom" && (
                <input
                  aria-label="Classroom number or name"
                  value={venueDetail}
                  onChange={(e) => setVenueDetail(e.target.value)}
                  disabled={scheduleLocked}
                  placeholder="Classroom number or name"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              )}
              {venueChoice === "others" && (
                <input
                  aria-label="Specify venue"
                  value={venueDetail}
                  onChange={(e) => setVenueDetail(e.target.value)}
                  disabled={scheduleLocked}
                  placeholder="Specify the venue"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              )}
            </div>
            <div className="shrink-0 sm:ml-8 flex items-center gap-3">
              {/* 094 — the lock toggle for the whole saved schedule (dates,
                  venue and modality). Only the Commissioner of Electoral
                  Board is offered it. */}
              {votingScheduleSaved && isElectoralBoard && !electionPeriod.isActive && currentStage !== "results" && (
                <button
                  type="button"
                  onClick={votingEditing
                    ? handleCancelVotingEdit
                    : () => { clearErrors(); setVotingEditing(true); }}
                  disabled={loading}
                  aria-label={votingEditing
                    ? "Cancel editing the Voting Schedule"
                    : "Edit the Voting Schedule"}
                  title={votingEditing
                    ? "Discard the changes and lock the voting schedule."
                    : "Unlock the voting dates, venue and modality."}
                  className="h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-[#5C0102] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {votingEditing ? <X size={16} /> : <Pencil size={16} />}
                </button>
              )}
              {!electionPeriod.isActive && !electionPeriod.resultsPublished && votingSequenced && hasMeeting && (currentStage === "fingerprint_registration" || currentStage === "voting") && (
                <button onClick={handleSaveVotingSchedule}
                  disabled={loading || emptyPositions.length > 0 || votingScheduleLocked}
                  title={
                    emptyPositions.length > 0
                      ? "Every position needs an approved candidate before saving the schedule."
                      : votingScheduleLocked
                        ? "Click the edit icon to change the voting schedule."
                        : undefined
                  }
                  className="whitespace-nowrap px-5 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {votingScheduleSaved ? "Save Changes" : "Save Schedule"}
                </button>
              )}
            </div>
          </div>
        </div>

        {renderStageError("voting")}

        <div className="flex items-center justify-end mt-6 pt-4 border-t border-gray-100">
          <div className="flex gap-3">
            {/* Open only under strict sequencing */}
            {votingOpenable && votingScheduleSaved && (
              <button onClick={() => handleOpenElection(earlyVotingActivation)}
                disabled={loading || !hasMeeting || emptyPositions.length > 0 || !votingSequenced}
                title={
                  emptyPositions.length > 0
                    ? "Every position needs an approved candidate before voting can open."
                    : !votingSequenced
                      ? "End the Campaign Period and start Fingerprint Registration first."
                      : undefined
                }
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {earlyVotingActivation ? "Early Voting Activation" : "Open Voting"}
              </button>
            )}
            {electionPeriod.isActive && (
              <button onClick={handleCloseVoting} disabled={loading}
                className="px-5 py-2.5 bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-200 disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                Close Voting
              </button>
            )}
            {/* 084 — paused vote: the two consequential moves, both behind
                the Electoral Board password. Offered whenever the vote is
                paused (including after a reload), not only in the session
                that closed it. */}
            {currentStage === "voting" && !electionPeriod.isActive && !electionPeriod.resultsPublished && (
              <>
                <button
                  onClick={() => { setGateError(null); setGatePassword(""); setVoteGate("reopen"); }}
                  disabled={loading}
                  className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#5C0102" }}>
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  Reopen Voting
                </button>
                <button
                  onClick={() => { setGateError(null); setGatePassword(""); setVoteGate("end"); }}
                  disabled={loading}
                  className="px-5 py-2.5 bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-200 disabled:opacity-50">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                  End Voting Stage
                </button>
              </>
            )}
            {electionPeriod.isActive && (
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
        {hasMeeting && !votingSequenced && votingOpenable && (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg mt-4">
            <Lock size={14} /> End the Campaign Period and start Fingerprint Registration before opening voting.
          </div>
        )}

        {hasMeeting && votingSequenced && votingOpenable && (
          <div className="flex items-center gap-2 text-xs text-amber-600 p-3 bg-amber-50 border border-amber-100 rounded-lg mt-4">
            <AlertCircle size={14} /> Opening voting saves the schedule and starts the Voting Period. Fingerprint Registration ends with it if it is still running.
          </div>
        )}
      </div>
      )}

      {/* Stage 5 � Results */}
      {viewStage === "results" && (
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
          {complaintsPending && !electionPeriod.proclaimed && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-sm text-red-800">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">
                  {knownComplaintCount ?? 0} unresolved {(knownComplaintCount ?? 0) === 1 ? "complaint must" : "complaints must"} be resolved
                  before results can be published and winners proclaimed.
                </div>
                <div className="text-xs mt-0.5">
                  Resolve {(knownComplaintCount ?? 0) === 1 ? "it" : "them"} to unlock publishing.
                </div>
              </div>
            </div>
          )}

          {/* 097 — how each resolved complaint was classified.  Substantiated
              grievances never appear in this list — they have their own red
              section below, since only they force a Complaint Reason. */}
          {otherResolvedComplaints.length > 0 && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={16} className="shrink-0" />
                Complaint decisions ({otherResolvedComplaints.length})
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {otherResolvedComplaints.map((c) => (
                  <li key={c.id} className="text-xs flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{c.subject}</span>
                    {c.complaintAgainst && (
                      <span className="text-gray-500">(against {c.complaintAgainst})</span>
                    )}
                    <span className="text-gray-400">·</span>
                    <span>{complaintDecisionLabel(c.decision)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 097 — the ONLY place a substantiated grievance appears on this
              stage.  Each Nature of Complaint toggles its findings (text
              only — no evidence files) at the bottom of the row. */}
          {substantiatedGrievances.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
              {!electionPeriod.proclaimed ? (
                <div className="flex items-start gap-2 text-xs font-medium">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  <span>A Complaint Reason is required when proclaiming winners due to:</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs font-medium">
                  <ShieldAlert size={14} className="shrink-0" />
                  <span>Substantiated grievances on record ({substantiatedGrievances.length})</span>
                </div>
              )}
              <ul className="mt-1.5 space-y-1.5">
                {substantiatedGrievances.map((g) => (
                  <FindingsDisclosure
                    key={g.id}
                    id={`stage5-findings-${g.id}`}
                    subject={g.subject}
                    decisionLabel="Substantiated Grievance"
                    findings={g.findings}
                  />
                ))}
              </ul>
            </div>
          )}

          {!electionPeriod.resultsPublished && !electionPeriod.proclaimed && !votingConcluded && (
            <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
              <Lock size={14} /> Open and close the voting period first to access results.
            </div>
          )}

          <div className="flex gap-3">
            {!electionPeriod.proclaimed && (
              <button
                onClick={handlePublishAndProclaim}
                disabled={loading || !votingConcluded || complaintsPending}
                title={
                  !votingConcluded
                    ? "Open and close the voting period first."
                    : complaintsPending
                      ? "Resolve all complaints before publishing results and proclaiming winners."
                      : undefined
                }
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
                Publish & Proclaim Winners
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
                  <div key={w.position} className="bg-white p-3 rounded-lg border border-amber-100 text-sm flex items-center gap-3">
                    {w.picture ? (
                      <img
                        src={w.picture}
                        alt={w.winnerName}
                        className="w-11 h-11 rounded-full object-cover border-2 flex-shrink-0"
                        style={{ borderColor: "#5C0102" }}
                      />
                    ) : (
                      <div
                        className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"
                        style={{ border: "2px solid #5C0102" }}
                      >
                        <Users size={18} className="text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500 truncate">{w.position}</div>
                      <div className="font-medium text-gray-900 truncate">{w.winnerName}</div>
                      <div className="text-xs text-gray-400">{w.votes} vote{w.votes !== 1 ? "s" : ""}</div>
                      {w.resolutionMethod === "manual" && (
                        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
                          <Gavel size={11} /> Tie — board choice
                        </div>
                      )}
                    </div>
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
      )}

      {/* Stage navigation — prev/next around the viewed card */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => setViewStage(STAGES[viewIndex - 1].id)}
          disabled={viewIndex === 0}
          title={viewIndex === 0 ? "This is the first stage." : undefined}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center gap-1.5 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={14} /> {viewIndex > 0 ? `Previous: ${STAGES[viewIndex - 1].label}` : "Previous"}
        </button>
        <button
          type="button"
          onClick={() => setViewStage(STAGES[viewIndex + 1].id)}
          disabled={viewIndex === STAGES.length - 1}
          title={viewIndex === STAGES.length - 1 ? "This is the last stage." : undefined}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center gap-1.5 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {viewIndex < STAGES.length - 1 ? `Next: ${STAGES[viewIndex + 1].label}` : "Next"} <ChevronRight size={14} />
        </button>
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
              candidates or votes, it is archived and kept permanently as history, and the School Year
              is set in Stage 1 to start the next election. This requires the Electoral Board password.
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
      {saveMeetingConfirm.dialog}
      {endCandidacyConfirm.dialog}
      {startCampaignConfirm.dialog}
      {updateCampaignConfirm.dialog}
      {stopCampaignConfirm.dialog}
      {fpConfirm.dialog}
      {openConfirm.dialog}
      {closeConfirm.dialog}
      {proclaimConfirm.dialog}

      <ProclamationDialog
        open={proclamationOpen}
        loading={tallyLoading}
        confirming={proclaiming}
        error={tallyError}
        tally={tally}
        profiles={candidateProfiles}
        complaintSubjects={filedComplaintSubjects}
        substantiatedGrievances={substantiatedGrievances}
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
              retained permanently. If the period already has candidates or votes, it is archived
              and you set the School Year in Stage 1 to start the next election.
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

      {voteGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !loading && setVoteGate(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vote-gate-title"
            className="relative bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-full max-w-md"
          >
            <button
              onClick={() => setVoteGate(null)}
              disabled={loading}
              aria-label="Close"
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={18} style={{ color: "#DC2626" }} />
              <h3 id="vote-gate-title" className="text-gray-900 text-sm font-semibold">
                {voteGate === "reopen" ? "Reopen the Voting Period?" : "End the Voting Stage?"}
              </h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {voteGate === "reopen"
                ? "The voting period resumes immediately: students can cast votes again. This requires the Electoral Board password."
                : "The Voting Stage is finalized and the election moves to the Results stage. This requires the Electoral Board password."}
            </p>

            <label className="block text-xs text-gray-600 mb-1" htmlFor="vote-gate-password">
              Electoral Board Password
            </label>
            <input
              id="vote-gate-password"
              type="password"
              value={gatePassword}
              onChange={(e) => setGatePassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50"
            />
            {gateError && (
              <p className="text-xs text-red-600 mt-2" role="alert">{gateError}</p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setVoteGate(null)}
                disabled={loading}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitVoteGate}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
                {voteGate === "reopen" ? "Reopen Voting" : "End Voting Stage"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
