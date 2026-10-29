import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminElectionSetup, { initialViewStage, resolveStage } from "./AdminElectionSetup";
import { emptyElectionPeriod } from "../../context/AppContext";
import type { Candidate, CommissionerRole, ElectionPeriod } from "../../context/AppContext";
import { FULL_POSITION_ORDER } from "../../lib/partyScope";

const PERIOD_ID = "3f1d0b1e-9c4a-4a7f-8b21-2c0e5d7a1b33";

const {
  mockApplyElectionPeriod,
  mockGetCurrentElectionId,
  mockReloadElectionPeriod,
  mockSetElectionPeriod,
  mockStartCandidacyPeriodRpc,
  mockSaveMeetingScheduleRpc,
  mockEndCandidacyPeriodRpc,
  mockStartFingerprintRegistrationRpc,
  mockCloseFingerprintRegistrationRpc,
  mockStopCampaignRpc,
  mockSaveCampaignWindowRpc,
  mockCountActiveComplaintsRpc,
  mockResetElectionPlanRpc,
  mockOpenElectionRpc,
  mockForceOpenVotingRpc,
  mockCloseElectionRpc,
  mockReopenVotingRpc,
  mockEndVotingStageRpc,
  mockVoidElectionRpc,
  mockGetProclamationTallyRpc,
  mockProclaimWinnersRpc,
  mockGetProclaimedWinners,
  mockInsertNotification,
  mockConfirm,
} = vi.hoisted(() => ({
  mockApplyElectionPeriod: vi.fn(),
  mockGetCurrentElectionId: vi.fn(),
  mockReloadElectionPeriod: vi.fn(),
  mockSetElectionPeriod: vi.fn(),
  mockStartCandidacyPeriodRpc: vi.fn(),
  mockSaveMeetingScheduleRpc: vi.fn(),
  mockEndCandidacyPeriodRpc: vi.fn(),
  mockStartFingerprintRegistrationRpc: vi.fn(),
  mockCloseFingerprintRegistrationRpc: vi.fn(),
  mockStopCampaignRpc: vi.fn(),
  mockSaveCampaignWindowRpc: vi.fn(),
  mockCountActiveComplaintsRpc: vi.fn(),
  mockResetElectionPlanRpc: vi.fn(),
  mockOpenElectionRpc: vi.fn(),
  mockForceOpenVotingRpc: vi.fn(),
  mockCloseElectionRpc: vi.fn(),
  mockReopenVotingRpc: vi.fn(),
  mockEndVotingStageRpc: vi.fn(),
  mockVoidElectionRpc: vi.fn(),
  mockGetProclamationTallyRpc: vi.fn(),
  mockProclaimWinnersRpc: vi.fn(),
  mockGetProclaimedWinners: vi.fn(() => Promise.resolve([])),
  mockInsertNotification: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ isSupabaseConfigured: true }));

vi.mock("../../lib/supabaseData", () => ({
  getCurrentElectionId: mockGetCurrentElectionId,
  reloadElectionPeriod: mockReloadElectionPeriod,
  startCandidacyPeriodRpc: mockStartCandidacyPeriodRpc,
  saveMeetingScheduleRpc: mockSaveMeetingScheduleRpc,
  endCandidacyPeriodRpc: mockEndCandidacyPeriodRpc,
  startFingerprintRegistrationRpc: mockStartFingerprintRegistrationRpc,
  closeFingerprintRegistrationRpc: mockCloseFingerprintRegistrationRpc,
  stopCampaignRpc: mockStopCampaignRpc,
  saveCampaignWindowRpc: mockSaveCampaignWindowRpc,
  countActiveComplaintsRpc: mockCountActiveComplaintsRpc,
  resetElectionPlanRpc: mockResetElectionPlanRpc,
  openElectionRpc: mockOpenElectionRpc,
  forceOpenVotingRpc: mockForceOpenVotingRpc,
  closeElectionRpc: mockCloseElectionRpc,
  reopenVotingRpc: mockReopenVotingRpc,
  endVotingStageRpc: mockEndVotingStageRpc,
  voidElectionRpc: mockVoidElectionRpc,
  publishResultsRpc: vi.fn(),
  getProclaimedWinners: mockGetProclaimedWinners,
  getProclamationTallyRpc: mockGetProclamationTallyRpc,
  proclaimWinnersRpc: mockProclaimWinnersRpc,
}));

// The confirm dialog is a generic utility with its own behaviour; these tests
// are about the page's stage logic, so every confirm resolves true.
vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

let electionPeriod: ElectionPeriod;
let complaints: { id?: string; status: string; subject?: string; electionPeriodId?: string; decision?: string; findings?: string }[];
// Voters the Stage 3 announcement is sent to; reset per test like complaints.
let students: { id: string; status: string }[];
// The approved-candidate roster — drives the "0 candidates per position"
// Open-Voting gate, so tests can seed a full or partial roster.
let candidates: Candidate[] = [];
// 093 — the signed-in commissioner's role.  Only the Commissioner of Electoral
// Board is offered the Campaign window's Edit button.
let commissionerRole: CommissionerRole | undefined = "electoral_board";

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return {
    ...actual,
    useApp: () => ({
      electionPeriod,
      setElectionPeriod: mockSetElectionPeriod,
      applyElectionPeriod: mockApplyElectionPeriod,
      addLog: vi.fn(),
      currentUser: { id: "admin-1", name: "Chief", role: "admin", commissionerRole },
      candidates,
      complaints,
      students,
      insertNotification: mockInsertNotification,
    }),
  };
});

function period(overrides: Partial<ElectionPeriod> = {}): ElectionPeriod {
  return { ...emptyElectionPeriod, id: PERIOD_ID, ...overrides };
}

/** One approved candidate for every standard position — the full roster the
 *  Open-Voting gate requires. The page only reads id/position/status. */
function fullRoster(): Candidate[] {
  return FULL_POSITION_ORDER.map((position, i) => ({
    id: `cand-${i}`,
    position,
    status: "approved",
  } as Candidate));
}

/** A future local date (tomorrow + offsetDays) as YYYY-MM-DD — always past
 *  the booking floor the page enforces, so fixtures never rot. */
function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An ISO instant whose LOCAL wall time is `time` on `futureDate(offsetDays)` —
 *  timezone-proof, so toLocalInput round-trips to the same in-hours value. */
function localIso(offsetDays: number, time: string): string {
  return new Date(`${futureDate(offsetDays)}T${time}:00`).toISOString();
}

/** The LOCAL YYYY-MM-DD a date-only picker holds for an ISO instant. */
function toLocalDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminElectionSetup />
    </MemoryRouter>,
  );
}

/** Single-stage view: navigate to a stage via the clickable stepper. */
async function gotoStage(user: UserEvent, label: string) {
  await user.click(screen.getByRole("button", { name: `View ${label} stage` }));
}

describe("resolveStage", () => {
  it("trusts lifecycle_stage when the migration has been applied", () => {
    expect(resolveStage(period({ lifecycleStage: "application" }))).toBe("application");
    expect(resolveStage(period({ lifecycleStage: "campaign" }))).toBe("campaign");
    expect(resolveStage(period({ lifecycleStage: "fingerprint_registration" }))).toBe("fingerprint_registration");
    expect(resolveStage(period({ lifecycleStage: "voting" }))).toBe("voting");
    expect(resolveStage(period({ lifecycleStage: "results" }))).toBe("results");
  });

  it("falls back to the legacy booleans when lifecycle_stage is missing", () => {
    // isActive is false through the whole application and campaign stage, so
    // it cannot be the first test — a period with a meeting date but no
    // voting yet has to read as campaign, not voting.
    expect(resolveStage(period({ lifecycleStage: undefined }))).toBe("application");
    expect(resolveStage(period({ lifecycleStage: undefined, rulesDiscussionAt: "2026-09-30T09:00:00Z" }))).toBe("campaign");
    expect(
      resolveStage(period({ lifecycleStage: undefined, fingerprintRegistrationStartAt: "2026-10-05T08:00:00Z" })),
    ).toBe("fingerprint_registration");
    expect(resolveStage(period({ lifecycleStage: undefined, isActive: true }))).toBe("voting");
    expect(resolveStage(period({ lifecycleStage: undefined, resultsPublished: true }))).toBe("results");
    expect(resolveStage(period({ lifecycleStage: undefined, proclaimed: true }))).toBe("results");
  });

  it("treats an archived period as a finished one", () => {
    expect(resolveStage(period({ lifecycleStage: "completed" }))).toBe("application");
  });
});

describe("initialViewStage", () => {
  it("opens on the Voting stage while Enrolment is current but its window is already open", () => {
    // The board's Stage 3 job is done and the handler moved the view to
    // Stage 4; a reload must land in the same place, without the stage itself
    // advancing (enrolment is still live).
    expect(
      initialViewStage(period({
        lifecycleStage: "fingerprint_registration",
        fingerprintRegistrationStartAt: "2026-10-05T08:00:00.000Z",
      })),
    ).toBe("voting");
  });

  it("stays on Enrolment until the window is actually opened", () => {
    expect(initialViewStage(period({ lifecycleStage: "fingerprint_registration" }))).toBe(
      "fingerprint_registration",
    );
  });

  it("leaves every other stage alone", () => {
    expect(initialViewStage(period({ lifecycleStage: "application" }))).toBe("application");
    expect(initialViewStage(period({ lifecycleStage: "campaign", rulesDiscussionAt: "2026-09-30T09:00:00.000Z" }))).toBe("campaign");
    expect(initialViewStage(period({ lifecycleStage: "voting", isActive: true }))).toBe("voting");
    expect(initialViewStage(period({ lifecycleStage: "results", resultsPublished: true }))).toBe("results");
  });

  it("does not jump to Stage 5 while the vote is merely closed (113)", () => {
    // Close Voting moves the row to 'results' without ending the stage:
    // the page stays on the Voting view, where Reopen / End are offered.
    expect(initialViewStage(period({ lifecycleStage: "results", isActive: false }))).toBe("voting");
    // The End stamp is what finally moves the view on to Stage 5.
    expect(
      initialViewStage(period({ lifecycleStage: "results", isActive: false, votingEndedAt: "2026-11-02T17:30:00.000Z" })),
    ).toBe("results");
  });
});

describe("AdminElectionSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electionPeriod = period();
    complaints = [];
    students = [];
    candidates = [];
    commissionerRole = "electoral_board";
    mockConfirm.mockResolvedValue(true);
    // clearAllMocks keeps mockImplementations, so re-establish the no-op
    // default for tests that do not swap the period underneath the page.
    mockApplyElectionPeriod.mockImplementation(() => {});
    mockSetElectionPeriod.mockResolvedValue({ ok: true });
    mockGetCurrentElectionId.mockResolvedValue(PERIOD_ID);
    mockReloadElectionPeriod.mockImplementation(async () => electionPeriod);
    mockCountActiveComplaintsRpc.mockResolvedValue(0);
    mockGetProclamationTallyRpc.mockResolvedValue([]);
    mockProclaimWinnersRpc.mockResolvedValue([]);
    mockStartCandidacyPeriodRpc.mockResolvedValue(PERIOD_ID);
    mockSaveMeetingScheduleRpc.mockResolvedValue(undefined);
    mockEndCandidacyPeriodRpc.mockResolvedValue(undefined);
    mockStartFingerprintRegistrationRpc.mockResolvedValue(undefined);
    mockCloseFingerprintRegistrationRpc.mockResolvedValue(undefined);
    mockStopCampaignRpc.mockResolvedValue(undefined);
    mockSaveCampaignWindowRpc.mockResolvedValue(undefined);
    mockResetElectionPlanRpc.mockResolvedValue({
      electionPeriodId: PERIOD_ID,
      archivedPrevious: false,
      schoolYear: "2027-2028",
      mode: "cleared",
    });
    mockForceOpenVotingRpc.mockResolvedValue(undefined);
    mockReopenVotingRpc.mockResolvedValue(undefined);
    mockEndVotingStageRpc.mockResolvedValue(undefined);
  });

  it("locks the campaign stage until a period exists to hang the meeting on", async () => {
    electionPeriod = period({ id: undefined, lifecycleStage: "application", candidacyOpen: false });
    mockGetCurrentElectionId.mockResolvedValue(null);
    renderPage();

    // 113 — a locked step is a dead end, not a preview: the stepper step is
    // disabled and the locked card never renders.
    expect(screen.getByRole("button", { name: /View Campaign stage/ })).toBeDisabled();
    expect(screen.queryByText("Stage 2: Campaign Period")).toBeNull();
  });

  it("keeps the campaign stage reachable while Stage 1 is still current", async () => {
    const user = userEvent.setup();
    // Scheduling the meeting is what ENDS the application period, so gating
    // Stage 2 on having left Stage 1 would deadlock the whole page. Stage 2
    // stays navigable and shows its not-yet-started lock note instead.
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    expect(screen.getByLabelText("Meeting Date")).toBeInTheDocument();
    await gotoStage(user, "Campaign");
    expect(screen.getByText("The Campaign Period starts after the Application Stage ends.")).toBeInTheDocument();
  });

  it("renders only the viewed stage's card at a time", () => {
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    // The Campaign card is on screen; every other stage card is unmounted.
    expect(screen.getByText("Stage 2: Campaign Period")).toBeInTheDocument();
    expect(screen.queryByText("Stage 1: Candidate Application Period")).toBeNull();
    expect(screen.queryByText("Stage 3: Fingerprint Registration")).toBeNull();
    expect(screen.queryByText("Stage 4: Voting Period")).toBeNull();
    expect(screen.queryByText("Stage 5: Election Result")).toBeNull();
  });

  it("navigates between stages with the stepper and the prev/next row", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "application",
      candidacyOpen: true,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    // Prev is closed on the first stage; Next walks forward one stage.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Next: Campaign/ }));
    expect(screen.getByText("Stage 2: Campaign Period")).toBeInTheDocument();

    // The stepper jumps straight to any unlocked stage...
    await gotoStage(user, "Voting");
    expect(screen.getByText("Stage 4: Voting Period")).toBeInTheDocument();

    // 113 — ...but a locked stage is refused: Stage 5 opens only once the
    // Voting Stage was ENDED, so both the stepper step and the Next button
    // are dead ends here.
    expect(screen.getByRole("button", { name: /View Results stage/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /View Results stage/ }));
    expect(screen.queryByText("Stage 5: Election Result")).toBeNull();
    expect(screen.getByRole("button", { name: /Next: Results/ })).toBeDisabled();

    // ...and Prev walks back.
    await user.click(screen.getByRole("button", { name: /Previous: Fingerprint/ }));
    expect(screen.getByText("Stage 3: Fingerprint Registration")).toBeInTheDocument();
  });

  it("refuses to open voting before the campaign meeting is scheduled", async () => {
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    // The vote is not startable while the Application Stage is still current
    // and no meeting exists: Stage 4 is locked outright, so the card — and
    // with it the schedule and open actions — is unreachable (113).
    expect(screen.getByRole("button", { name: /View Voting stage/ })).toBeDisabled();
    expect(screen.queryByText("Stage 4: Voting Period")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save Schedule/ })).toBeNull();
  });

  it("Save Schedule commits the voting window, then Open Voting opens the election", async () => {
    const user = userEvent.setup();
    // 094 — Stage 4 is a two-step flow: "Save Schedule" persists the voting
    // window (dates, modality, venue) and only then does "Open Voting" appear.
    // Strict sequencing: the vote opens while Stage 3 is current with a
    // started enrolment window.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");

    // Step 1 — save the schedule. Opening must NOT happen yet.
    await user.click(screen.getByRole("button", { name: /Save Schedule/ }));
    await waitFor(() => {
      expect(mockSetElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String),
          electionModality: "digital",
          venue: "CNNHS Covered Court",
        }),
      );
    });
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();

    // Step 2 — the saved schedule unlocks the open action.
    await user.click(screen.getByRole("button", { name: /Open Voting/ }));
    await waitFor(() => {
      expect(mockOpenElectionRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    // The row must be saved before the stage flips.
    expect(mockSetElectionPeriod.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenElectionRpc.mock.invocationCallOrder[0],
    );
  });

  it("Early Voting Activation ends enrolment and opens the vote in one move", async () => {
    const user = userEvent.setup();
    // 094 — when a schedule is saved while the enrolment window is still open
    // (started, no end stamp), the action becomes "Early Voting Activation" and
    // the matching RPC — not open_election_rpc — closes enrolment as it opens.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Early Voting Activation/ }));

    await waitFor(() => {
      expect(mockForceOpenVotingRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("still activates early when a close date was scheduled before the start", async () => {
    const user = userEvent.setup();
    // 095 — the label follows the CLOCK, not the enrolment stamp: a window
    // that was scheduled to close later must not turn the action back into
    // "Open Voting". Activating early is what ends enrolment, so it takes the
    // force path either way.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(3, "17:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Early Voting Activation/ }));

    await waitFor(() => {
      expect(mockForceOpenVotingRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("shows Open Voting — not Early Voting Activation — once the saved start has arrived", async () => {
    const user = userEvent.setup();
    // The saved voting start is in the past, so this is the scheduled open.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(-3, "08:00"),
      startDate: futureDate(-1),
      startTime: "06:00",
      endDate: futureDate(-1),
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.queryByRole("button", { name: /Early Voting Activation/ })).toBeNull();

    // The due-time auto-open timer fires on mount; clear it so the click's
    // own RPC choice is what gets asserted.
    await waitFor(() => {
      expect(mockForceOpenVotingRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    mockForceOpenVotingRpc.mockClear();

    await user.click(screen.getByRole("button", { name: /Open Voting/ }));

    await waitFor(() => {
      expect(mockOpenElectionRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    expect(mockForceOpenVotingRpc).not.toHaveBeenCalled();
  });

  it("auto-ends enrolment when the saved voting start arrives, even with a close date scheduled", async () => {
    // 094/095 — the saved voting start is what ends enrolment. A scheduled
    // close date is only a plan, so it must not leave the window (or the vote)
    // waiting: the Stage 4 card force-opens by itself.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(-3, "08:00"),
      fingerprintRegistrationEndAt: localIso(2, "17:00"),
      startDate: futureDate(-1),
      startTime: "06:00",
      endDate: futureDate(-1),
      endTime: "17:00",
    });
    renderPage();

    await waitFor(() => {
      expect(mockForceOpenVotingRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("disables Save Schedule while a position stands empty", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
    });
    candidates = fullRoster().filter((c) => c.position !== "Treasurer");
    renderPage();

    await gotoStage(user, "Voting");
    const save = screen.getByRole("button", { name: /Save Schedule/ });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute(
      "title",
      "Every position needs an approved candidate before saving the schedule.",
    );

    await user.click(save);
    expect(mockSetElectionPeriod).not.toHaveBeenCalled();
  });

  it("keeps the amber open-now note under a ready voting schedule", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    // Enrolment is scheduled but still open, so this is the early-activation
    // variant of the open action.
    expect(screen.getByRole("button", { name: /Early Voting Activation/ })).toBeEnabled();
    expect(screen.getByText(/Opening voting saves the schedule/)).toBeInTheDocument();
  });

  it("refuses to open voting while a position stands empty", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    // Every position filled except one — the vote may not open.
    candidates = fullRoster().filter((c) => c.position !== "Treasurer");
    renderPage();

    // The 0-candidate gate is not a persistent block any more: the open
    // action is disabled and names the reason in its tooltip.
    await gotoStage(user, "Voting");
    const openVoting = screen.getByRole("button", { name: /Early Voting Activation/ });
    expect(openVoting).toBeDisabled();
    expect(openVoting).toHaveAttribute(
      "title",
      "Every position needs an approved candidate before voting can open.",
    );
  });

  it("locks the saved Voting schedule and offers Edit to the Electoral Board", async () => {
    const user = userEvent.setup();
    // 094 — a saved schedule is a locked record: the dates, venue and modality
    // all go disabled and Save becomes "Save Changes" — the edit icon is the
    // way in.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.getByLabelText("Start Date")).toBeDisabled();
    expect(screen.getByLabelText("End Date")).toBeDisabled();
    expect(screen.getByLabelText("Venue")).toBeDisabled();
    expect(screen.getByLabelText("Election Modalities")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save Changes/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit the Voting Schedule" })).toBeInTheDocument();
  });

  it("hides the Voting schedule edit icon from a commissioner who is not the Electoral Board", async () => {
    const user = userEvent.setup();
    commissionerRole = "screening_validation";
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.queryByRole("button", { name: "Edit the Voting Schedule" })).toBeNull();
    expect(screen.getByLabelText("Start Date")).toBeDisabled();
    expect(screen.getByLabelText("Venue")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save Changes/ })).toBeDisabled();
  });

  it("unlocks the Voting schedule on the edit icon and saves the changed venue and modality", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: "Edit the Voting Schedule" }));

    // Unlocking re-enables the whole schedule and opens the save button; the
    // icon becomes a cancel.
    expect(screen.getByLabelText("Start Date")).toBeEnabled();
    expect(screen.getByLabelText("Venue")).toBeEnabled();
    expect(screen.getByLabelText("Election Modalities")).toBeEnabled();
    expect(screen.getByRole("button", { name: /Save Changes/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel editing the Voting Schedule" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Election Modalities"), "manual");
    await user.selectOptions(screen.getByLabelText("Venue"), "classroom");
    await user.type(screen.getByLabelText("Classroom number or name"), "203");
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));

    await waitFor(() => {
      expect(mockSetElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({
          electionModality: "manual",
          venue: "CNNHS Classroom — 203",
        }),
      );
    });
  });

  it("discards a Voting schedule edit on the cancel icon and locks the fields again", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
      electionModality: "hybrid",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: "Edit the Voting Schedule" }));
    await user.selectOptions(screen.getByLabelText("Election Modalities"), "manual");
    await user.selectOptions(screen.getByLabelText("Venue"), "others");
    await user.click(screen.getByRole("button", { name: "Cancel editing the Voting Schedule" }));

    // The fields snap back to the saved row and lock again.
    expect(screen.getByLabelText("Election Modalities")).toHaveValue("hybrid");
    expect(screen.getByLabelText("Election Modalities")).toBeDisabled();
    expect(screen.getByLabelText("Venue")).toHaveValue("covered_court");
    expect(screen.getByRole("button", { name: /Save Changes/ })).toBeDisabled();
    expect(mockSetElectionPeriod).not.toHaveBeenCalled();
  });

  it("flags the cleared voting date pickers when Save Schedule is clicked without them", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    // The schedule prefills with tomorrow, so clear both pickers first.
    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /Save Schedule/ }));

    expect(screen.getByText("Choose the voting start and end date before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Start Date")).toHaveClass("border-red-300");
    expect(screen.getByLabelText("End Date")).toHaveClass("border-red-300");
    expect(mockSetElectionPeriod).not.toHaveBeenCalled();
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("keeps Open Voting hidden while the Campaign Stage is still active", async () => {
    const user = userEvent.setup();
    // Strict sequencing: the vote cannot open a stage that has not been
    // reached — the Campaign must end and Stage 3 start first. Neither the
    // schedule nor the open action is offered, and the lock note says why.
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.getByText("End the Campaign Period and start Fingerprint Registration before opening voting.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save Schedule/ })).toBeNull();
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("keeps Open Voting hidden until Fingerprint Registration has started", async () => {
    const user = userEvent.setup();
    // Stage 3 is active but its window was never recorded — a stage cannot
    // end without starting, so the vote stays closed and its schedule is not
    // offered yet either.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.getByText("End the Campaign Period and start Fingerprint Registration before opening voting.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save Schedule/ })).toBeNull();
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("Close Voting moves the election to the Results stage and offers the password-gated actions", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "voting",
      isActive: true,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    // close_election_rpc (113) closes AND moves: the row lands at stage
    // 'results' with voting_ended_at still null — closed, not ended.
    const closedRow = period({
      lifecycleStage: "results",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    mockReloadElectionPeriod.mockResolvedValue(closedRow);
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Close Voting/ }));

    await waitFor(() => {
      expect(mockCloseElectionRpc).toHaveBeenCalledWith(PERIOD_ID);
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleStage: "results", isActive: false }),
      );
    });
  });

  it("shows Reopen Voting and End Voting Stage while the vote is closed but not ended", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.getByText("Voting Closed")).toBeInTheDocument();
    // The close is not the end: both consequential moves are offered.
    expect(screen.getByRole("button", { name: /Reopen Voting/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /End Voting Stage/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Close Voting/ })).toBeNull();
    // 113 — but the schedule stays final after opening and closing: no
    // edit icon in the closed state (only a Void re-opens it).
    expect(screen.queryByRole("button", { name: "Edit the Voting Schedule" })).toBeNull();

    // 113 — Stage 5 stays LOCKED until the stage was ENDED: the stepper
    // refuses it, and the Next button will not walk into it either.
    expect(screen.getByRole("button", { name: /View Results stage/ })).toBeDisabled();
  });

  it("after End Voting Stage only Reopen is refused — the moves disappear and Stage 4 is checked", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    // 113 — ending the stage is what finally moves the page on to Stage 5:
    // the default view lands there, publish unlocked.
    expect(screen.getByRole("button", { name: /Publish & Proclaim Winners/ })).toBeEnabled();

    await gotoStage(user, "Voting");
    expect(screen.getByText("Voting Stage Ended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reopen Voting/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /End Voting Stage/ })).toBeNull();
  });

  it("after a Void the period sits paused in the Voting Stage — only Reopen is offered", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "voting",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.getByText("Voting Closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reopen Voting/ })).toBeEnabled();
    // Ending a voided (zero-vote) run straight away is not offered: the
    // board resumes voting with Reopen instead.
    expect(screen.queryByRole("button", { name: /End Voting Stage/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    // 113 — the voided run may be re-planned: the schedule edit icon is
    // offered again for the re-run.
    expect(screen.getByRole("button", { name: "Edit the Voting Schedule" })).toBeInTheDocument();
  });

  it("after a Void the Voting schedule can be edited and saved for the re-run", async () => {
    const user = userEvent.setup();
    // 113 — Void rewinds the election to a paused Voting Stage: the board
    // may move the re-run to a new modality, venue or dates before
    // reopening. Sequencing is long since done, so no Stage 3 gate applies.
    electionPeriod = period({
      lifecycleStage: "voting",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: "2026-10-05T08:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: "Edit the Voting Schedule" }));

    expect(screen.getByLabelText("Start Date")).toBeEnabled();
    expect(screen.getByLabelText("Venue")).toBeEnabled();
    expect(screen.getByLabelText("Election Modalities")).toBeEnabled();
    expect(screen.getByRole("button", { name: /Save Changes/ })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Election Modalities"), "manual");
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));

    await waitFor(() => {
      expect(mockSetElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({
          electionModality: "manual",
          lifecycleStage: "voting",
          isActive: false,
        }),
      );
    });
  });

  it("keeps the plain tomorrow floor on the voting start and allows a same-day end (113)", () => {
    // The spacing logic was rolled back: the start picker opens tomorrow,
    // and the end may share the start's day.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(1, "08:00"),
      campaignStartDate: localIso(2, "08:00"),
      campaignEndDate: localIso(4, "17:00"),
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    renderPage();

    expect(screen.getByLabelText("Start Date")).toHaveAttribute("min", futureDate(1));
    expect(screen.getByLabelText("End Date")).toHaveAttribute("min", "2026-11-02");
  });

  it("Reopen Voting refuses an empty or wrong Electoral Board password", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "voting",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    mockReopenVotingRpc.mockRejectedValue(new Error("Password is incorrect."));
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Reopen Voting/ }));

    const dialog = await screen.findByRole("dialog");
    // Empty password never reaches the RPC.
    await user.click(within(dialog).getByRole("button", { name: /Reopen Voting/ }));
    expect(screen.getByText("Enter the Electoral Board password to continue.")).toBeInTheDocument();
    expect(mockReopenVotingRpc).not.toHaveBeenCalled();

    // A wrong password is rejected by the RPC and the dialog stays open.
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "wrong-password");
    await user.click(within(dialog).getByRole("button", { name: /Reopen Voting/ }));
    await waitFor(() => {
      expect(mockReopenVotingRpc).toHaveBeenCalledWith(PERIOD_ID, "wrong-password");
    });
    expect(screen.getByText("Password is incorrect.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Electoral Board Password")).toBeInTheDocument();
  });

  it("Reopen Voting resumes the vote once the password is accepted", async () => {
    const user = userEvent.setup();
    // 113 — Reopen works from the CLOSED state: Close Voting leaves the row
    // at stage 'results', inactive, not yet ended.
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    // reopen_voting_rpc (113) moves the stage back to 'voting' and flips
    // is_active on; the page mirrors the row the server produced.
    mockReloadElectionPeriod.mockResolvedValue(
      period({
        lifecycleStage: "voting",
        isActive: true,
        candidacyOpen: false,
        rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
        startDate: "2026-11-02",
        startTime: "08:00",
        endDate: "2026-11-02",
        endTime: "17:00",
      }),
    );
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Reopen Voting/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "chief123");
    await user.click(within(dialog).getByRole("button", { name: /Reopen Voting/ }));

    await waitFor(() => {
      expect(mockReopenVotingRpc).toHaveBeenCalledWith(PERIOD_ID, "chief123");
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleStage: "voting", isActive: true }),
      );
    });
  });

  it("End Voting Stage stamps the stage as ended once the password is accepted", async () => {
    const user = userEvent.setup();
    // 113 — End runs from the closed state (stage 'results', inactive).
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    // end_voting_stage_rpc (113) stamps voting_ended_at; the page mirrors
    // the row the server produced.
    mockReloadElectionPeriod.mockResolvedValue(
      period({
        lifecycleStage: "results",
        isActive: false,
        votingEndedAt: "2026-11-02T17:30:00.000Z",
        candidacyOpen: false,
        rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
        startDate: "2026-11-02",
        startTime: "08:00",
        endDate: "2026-11-02",
        endTime: "17:00",
      }),
    );
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /End Voting Stage/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "chief123");
    await user.click(within(dialog).getByRole("button", { name: /End Voting Stage/ }));

    await waitFor(() => {
      expect(mockEndVotingStageRpc).toHaveBeenCalledWith(PERIOD_ID, "chief123");
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycleStage: "results",
          isActive: false,
          votingEndedAt: expect.any(String),
        }),
      );
    });
  });

  it("Void Election discards the votes and returns the period to the Voting Stage, paused", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    // void_election_rpc (113) rewinds the SAME period to the Voting Stage,
    // paused, with the votes gone; the page mirrors the row the server
    // produced.
    mockReloadElectionPeriod.mockResolvedValue(
      period({
        lifecycleStage: "voting",
        isActive: false,
        votingEndedAt: null,
        candidacyOpen: false,
        rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
        startDate: "2026-11-02",
        startTime: "08:00",
        endDate: "2026-11-02",
        endTime: "17:00",
      }),
    );
    renderPage();

    await gotoStage(user, "Results");
    await user.click(screen.getByRole("button", { name: /Void Election/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "chief123");
    await user.click(within(dialog).getByRole("button", { name: /Void Election/ }));

    await waitFor(() => {
      expect(mockVoidElectionRpc).toHaveBeenCalledWith(PERIOD_ID, "chief123");
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleStage: "voting", isActive: false, votingEndedAt: null }),
      );
    });
  });

  it("Void Election disappears once results are published and winners are proclaimed", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      resultsPublished: true,
      proclaimed: true,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    renderPage();

    await gotoStage(user, "Results");
    expect(screen.queryByRole("button", { name: /Void Election/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish & Proclaim Winners/ })).toBeNull();
  });

  it("hides Open Voting once voting has concluded — no re-open", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    candidates = fullRoster();
    renderPage();

    // Ending the vote moved the election to Stage 5 (the default view): the
    // publish flow takes over, and Stage 4 offers no way back in.
    expect(screen.getByRole("button", { name: /Publish & Proclaim Winners/ })).toBeEnabled();
    await gotoStage(user, "Voting");
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.getByText("Voting Stage Ended")).toBeInTheDocument();
  });

  it("turns candidacy and the campaign period off once voting opens", async () => {
    const user = userEvent.setup();
    // Even a period that somehow still carries candidacyOpen = true must stop
    // offering Stage 1/2 actions while the vote is running — the RPCs would
    // refuse them, and in mock mode they would rewind the election.
    electionPeriod = period({
      lifecycleStage: "voting",
      isActive: true,
      candidacyOpen: true,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    renderPage();

    // Stage 1 view: the application controls are gone.
    await gotoStage(user, "Application");
    expect(screen.getByText("Period Ended")).toBeInTheDocument();
    expect(screen.getByText("The Candidate Application Period ended when Voting opened.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Candidacy/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /End Application Stage/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save Meeting Schedule/ })).toBeNull();
    expect(screen.queryByLabelText("Meeting Date")).toBeNull();

    // Stage 2 view: the campaign controls are gone too.
    await gotoStage(user, "Campaign");
    expect(screen.getByText("The Campaign Period ended when Voting opened.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /End Campaign Early/ })).toBeNull();
  });

  it("keeps the earlier stages turned off through the results stage", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "results",
      isActive: false,
      // 113 — an ended stage is what makes Stage 5 (and this test) reachable.
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    // The results stage itself stays reachable — only 1 and 2 are read-only.
    expect(screen.getByRole("button", { name: /Publish & Proclaim Winners/ })).toBeInTheDocument();
    await gotoStage(user, "Application");
    expect(screen.getByText("The Candidate Application Period ended when Voting opened.")).toBeInTheDocument();
    await gotoStage(user, "Campaign");
    expect(screen.getByText("The Campaign Period ended when Voting opened.")).toBeInTheDocument();
  });

  it("saves the meeting schedule from Stage 1 without ending candidacy", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    // 082 — the meeting picker lives in Stage 1 and only records the date:
    // it must not close applications or move the stage any more.
    await user.type(screen.getByLabelText("Meeting Date"), futureDate(2));
    await user.click(screen.getByRole("button", { name: /Save Meeting Schedule/ }));

    await waitFor(() => {
      expect(mockSaveMeetingScheduleRpc).toHaveBeenCalledWith(PERIOD_ID, expect.any(String));
    });
    expect(mockEndCandidacyPeriodRpc).not.toHaveBeenCalled();
    expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycleStage: "application", candidacyOpen: true }),
    );
  });

  it("flags the empty meeting date picker and shows the banner on Save Schedule", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    // The button is open even with nothing chosen: clicking it outlines the
    // empty picker in red and names it in the stage banner. The time defaults
    // to 09:00, so only the date is missing.
    await user.click(screen.getByRole("button", { name: /Save Meeting Schedule/ }));

    expect(screen.getByText("Choose a meeting date before saving the schedule.")).toBeInTheDocument();
    expect(screen.getByLabelText("Meeting Date")).toHaveClass("border-red-300");
    expect(screen.getByLabelText("Time")).not.toHaveClass("border-red-300");
    expect(mockSaveMeetingScheduleRpc).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("flags the cleared meeting time picker and names the time in the banner", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    await user.type(screen.getByLabelText("Meeting Date"), futureDate(2));
    // The commissioner cleared the time input: a date alone is not enough.
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /Save Meeting Schedule/ }));

    expect(screen.getByText("Choose a meeting time before saving the schedule.")).toBeInTheDocument();
    expect(screen.getByLabelText("Meeting Date")).not.toHaveClass("border-red-300");
    expect(screen.getByLabelText("Time")).toHaveClass("border-red-300");
    expect(mockSaveMeetingScheduleRpc).not.toHaveBeenCalled();
  });

  it("shows the Meeting Scheduled indicator under the meeting inputs in Stage 1 only", () => {
    electionPeriod = period({
      lifecycleStage: "application",
      candidacyOpen: true,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    // The indicator moved out of the Campaign card (its header chip and
    // banner are gone) and now sits under the meeting date/time inputs.
    expect(screen.getAllByText("Meeting Scheduled")).toHaveLength(1);
    const indicator = screen.getByText("Meeting Scheduled");
    expect(indicator.closest("div.space-y-3")).not.toBeNull();
    expect(within(indicator.closest("div.space-y-3")!).getByLabelText("Meeting Date")).toBeInTheDocument();
  });

  it("refuses to end the Application Stage before the meeting schedule is saved", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    // The schedule locks when the stage ends, so ending without a saved
    // meeting would deadlock Fingerprint Registration forever. The button
    // stays clickable and the banner carries the reason instead.
    const end = screen.getByRole("button", { name: /End Application Stage/ });
    expect(end).toBeEnabled();
    await user.click(end);

    expect(screen.getByText("Save the Rules Discussion Meeting schedule before ending the Application Stage.")).toBeInTheDocument();
    expect(mockEndCandidacyPeriodRpc).not.toHaveBeenCalled();
  });

  it("refuses to end the Application Stage while a position stands empty", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "application",
      candidacyOpen: true,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    // Every position filled except one — ending the stage closes applications
    // for the rest of the election, so the transition into Stage 2 is blocked
    // until every position has an approved candidate.
    candidates = fullRoster().filter((c) => c.position !== "Treasurer");
    renderPage();

    const end = screen.getByRole("button", { name: /End Application Stage/ });
    expect(end).toBeEnabled();
    await user.click(end);

    expect(screen.getByText(/The Candidacy Application Stage cannot end/)).toBeInTheDocument();
    expect(screen.getByText(/no approved candidate for: Treasurer/)).toBeInTheDocument();
    expect(mockEndCandidacyPeriodRpc).not.toHaveBeenCalled();
  });

  it("ends the Application Stage and re-reads the period the server produced", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "application",
      candidacyOpen: true,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    // Ending the stage needs a full approved roster.
    candidates = fullRoster();
    // The RPC moves the period to campaign; the page must reflect the row the
    // server produced rather than the one it happened to be holding.
    mockReloadElectionPeriod.mockResolvedValue(
      period({ lifecycleStage: "campaign", candidacyOpen: false, rulesDiscussionAt: "2026-09-30T09:00:00.000Z" }),
    );
    renderPage();

    await user.click(screen.getByRole("button", { name: /End Application Stage/ }));

    await waitFor(() => {
      expect(mockEndCandidacyPeriodRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    await waitFor(() => {
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleStage: "campaign" }),
      );
    });
  });

  it("starts the Campaign Period from Stage 2 once the Application Stage has ended", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await user.type(screen.getByLabelText("Campaign Start"), futureDate(2));
    await user.type(screen.getByLabelText("Campaign End"), futureDate(4));
    await user.click(screen.getByRole("button", { name: /Start Campaign/ }));

    // 093 — the window is written by its own guarded RPC, not the plain
    // schedule editor.
    await waitFor(() => {
      expect(mockSaveCampaignWindowRpc).toHaveBeenCalledWith(
        PERIOD_ID,
        expect.any(String),
        expect.any(String),
      );
    });
  });

  it("refuses an inverted Campaign window", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await user.type(screen.getByLabelText("Campaign Start"), futureDate(4));
    await user.type(screen.getByLabelText("Campaign End"), futureDate(2));
    await user.click(screen.getByRole("button", { name: /Start Campaign/ }));

    expect(screen.getByText(/must end at least one day after it starts/)).toBeInTheDocument();
    expect(mockSaveCampaignWindowRpc).not.toHaveBeenCalled();
  });

  it("flags the empty campaign pickers and clears the flag once a date is chosen", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: /Start Campaign/ }));

    expect(screen.getByText("Choose the campaign start and end date before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign Start")).toHaveClass("border-red-300");
    expect(screen.getByLabelText("Campaign End")).toHaveClass("border-red-300");
    expect(mockSaveCampaignWindowRpc).not.toHaveBeenCalled();

    // Choosing a date clears its red outline immediately.
    await user.type(screen.getByLabelText("Campaign Start"), futureDate(2));
    expect(screen.getByLabelText("Campaign Start")).not.toHaveClass("border-red-300");
    expect(screen.getByLabelText("Campaign End")).toHaveClass("border-red-300");
  });

  it("locks the Campaign window while the Application Stage is still current", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    await gotoStage(user, "Campaign");
    expect(screen.getByText(/The Campaign Period starts after the Application Stage ends/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start Campaign/ })).toBeNull();
    expect(screen.queryByLabelText("Campaign Start")).toBeNull();
  });

  it("locks the saved Campaign window and offers the Electoral Board an edit icon", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      campaignStartDate: "2026-11-05T06:00:00.000Z",
      campaignEndDate: "2026-11-12T17:00:00.000Z",
    });
    renderPage();

    // The committed window is a locked record: both pickers are disabled and
    // the save button is dead — the edit icon is the way in.
    expect(screen.getByLabelText("Campaign Start")).toBeDisabled();
    expect(screen.getByLabelText("Campaign End")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Update Campaign Window/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit the Campaign Period" })).toBeInTheDocument();

    // The saved window still mirrors back into the (disabled) pickers.
    expect(screen.getByLabelText("Campaign Start")).toHaveValue(
      toLocalDate("2026-11-05T06:00:00.000Z"),
    );
  });

  it("hides the Campaign edit icon from a commissioner who is not the Electoral Board", () => {
    commissionerRole = "screening_validation";
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      campaignStartDate: "2026-11-05T06:00:00.000Z",
      campaignEndDate: "2026-11-12T17:00:00.000Z",
    });
    renderPage();

    expect(screen.queryByRole("button", { name: "Edit the Campaign Period" })).toBeNull();
    expect(screen.getByLabelText("Campaign Start")).toBeDisabled();
    expect(screen.getByLabelText("Campaign End")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Update Campaign Window/ })).toBeDisabled();
  });

  it("unlocks the Campaign pickers on the edit icon and saves the moved window", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      campaignStartDate: localIso(2, "08:00"),
      campaignEndDate: localIso(4, "17:00"),
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Edit the Campaign Period" }));

    expect(screen.getByLabelText("Campaign Start")).toBeEnabled();
    expect(screen.getByLabelText("Campaign End")).toBeEnabled();
    // Unlocking opens the save button; the icon becomes a cancel.
    expect(screen.getByRole("button", { name: /Update Campaign Window/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel editing the Campaign Period" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Campaign Start"));
    await user.type(screen.getByLabelText("Campaign Start"), futureDate(3));
    await user.click(screen.getByRole("button", { name: /Update Campaign Window/ }));

    await waitFor(() => {
      expect(mockSaveCampaignWindowRpc).toHaveBeenCalledWith(
        PERIOD_ID,
        expect.any(String),
        expect.any(String),
      );
    });
  });

  it("discards a Campaign window edit on the cancel icon and locks the pickers again", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      campaignStartDate: localIso(2, "08:00"),
      campaignEndDate: localIso(4, "17:00"),
    });
    renderPage();

    const savedStart = toLocalDate(localIso(2, "08:00"));
    await user.click(screen.getByRole("button", { name: "Edit the Campaign Period" }));
    await user.clear(screen.getByLabelText("Campaign Start"));
    await user.type(screen.getByLabelText("Campaign Start"), futureDate(3));
    await user.click(screen.getByRole("button", { name: "Cancel editing the Campaign Period" }));

    // The picker snaps back to the saved window and locks again.
    expect(screen.getByLabelText("Campaign Start")).toHaveValue(savedStart);
    expect(screen.getByLabelText("Campaign Start")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Update Campaign Window/ })).toBeDisabled();
    expect(mockSaveCampaignWindowRpc).not.toHaveBeenCalled();
  });

  it("opens the Campaign End picker the day after the chosen start (113)", () => {
    // 113 — the window may not open and close on the same day: with the
    // saved window loaded, the end picker's floor is start + 1.  The start
    // picker keeps the plain tomorrow floor.
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      campaignStartDate: localIso(2, "08:00"),
      campaignEndDate: localIso(4, "17:00"),
    });
    renderPage();

    expect(screen.getByLabelText("Campaign Start")).toHaveAttribute("min", futureDate(1));
    expect(screen.getByLabelText("Campaign End")).toHaveAttribute("min", futureDate(3));
  });

  it("refuses a Campaign window that opens and closes on the same day (113)", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      campaignStartDate: localIso(2, "08:00"),
      campaignEndDate: localIso(4, "17:00"),
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Edit the Campaign Period" }));
    // Move the end onto the start's day — the window must run at least a
    // full day.
    await user.clear(screen.getByLabelText("Campaign End"));
    await user.type(screen.getByLabelText("Campaign End"), futureDate(2));
    await user.click(screen.getByRole("button", { name: /Update Campaign Window/ }));

    expect(mockSaveCampaignWindowRpc).not.toHaveBeenCalled();
    expect(screen.getByText("The Campaign Period must end at least one day after it starts.")).toBeInTheDocument();
  });

  it("ends the Campaign Period early via the End Campaign Early button", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      // A stage cannot end without starting: the window must be recorded.
      campaignStartDate: localIso(2, "08:00"),
      campaignEndDate: localIso(4, "17:00"),
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: /End Campaign Early/ }));

    await waitFor(() => {
      expect(mockStopCampaignRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
  });

  it("disables End Campaign Early until the Campaign Period has started", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      // No window recorded yet — the campaign has not started.
    });
    renderPage();

    const end = screen.getByRole("button", { name: /End Campaign Early/ });
    expect(end).toBeDisabled();
    expect(end).toHaveAttribute("title", "Start the Campaign Period first.");

    await user.click(end);
    expect(mockStopCampaignRpc).not.toHaveBeenCalled();
  });

  it("replaced the Voting Method dropdown with Election Modalities", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    // The old D-06 dropdown is gone; the modality select defaults to digital.
    expect(screen.queryByLabelText("Voting Method")).toBeNull();
    const modality = screen.getByLabelText("Election Modalities");
    expect(modality).toHaveValue("digital");

    // Save Schedule is what commits the modality.
    await user.selectOptions(modality, "manual");
    await user.click(screen.getByRole("button", { name: /Save Schedule/ }));

    await waitFor(() => {
      expect(mockSetElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ electionModality: "manual" }),
      );
    });
  });

  it("composes the venue from the dropdown and its detail input", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.selectOptions(screen.getByLabelText("Venue"), "classroom");
    await user.type(screen.getByLabelText("Classroom number or name"), "203");
    await user.click(screen.getByRole("button", { name: /Save Schedule/ }));

    await waitFor(() => {
      expect(mockSetElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ venue: "CNNHS Classroom — 203" }),
      );
    });
  });

  it("reverse-maps a saved free-text venue onto the Others choice", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      venue: "CNNHS Gym",
    });
    renderPage();

    await gotoStage(user, "Voting");
    expect(screen.getByLabelText("Venue")).toHaveValue("others");
    expect(screen.getByLabelText("Specify venue")).toHaveValue("CNNHS Gym");
  });

  it("keeps candidacy controls locked once the Campaign Stage has started", async () => {
    const user = userEvent.setup();
    // Scheduling the meeting ended the application period; reopening it is
    // refused for the rest of the election (only a reset rewinds the stage).
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await gotoStage(user, "Application");
    expect(
      screen.getByText(/The Candidate Application Period ended when the Campaign Stage started/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Candidacy/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /End Application Stage/ })).toBeNull();
  });

  it("locks the Campaign stage once Fingerprint Registration has started", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await gotoStage(user, "Campaign");
    expect(
      screen.getByText(/The Campaign Period ended when Fingerprint Registration started/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Meeting Date")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save Meeting Schedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /End Campaign Early/ })).toBeNull();
  });

  it("locks Fingerprint Registration once Voting has opened", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "voting",
      isActive: true,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await gotoStage(user, "Fingerprint");
    expect(screen.getByText(/Fingerprint Registration closed when Voting opened/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Registration Opens")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Fingerprint Registration/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Update Registration Window/ })).toBeNull();
  });

  it("locks Fingerprint Registration until the campaign meeting is scheduled", () => {
    electionPeriod = period({ lifecycleStage: "campaign", candidacyOpen: false });
    renderPage();

    // 113 — the locked step is a dead end, not a preview.
    expect(screen.getByRole("button", { name: /View Fingerprint stage/ })).toBeDisabled();
    expect(screen.queryByLabelText("Registration Opens")).toBeNull();
  });

  it("locks Fingerprint Registration while the Campaign Stage is still active", async () => {
    const user = userEvent.setup();
    // Strict sequencing — only one stage active at a time: the Stage 3
    // controls stay locked until "End Campaign Early" moves the election on.
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await gotoStage(user, "Fingerprint");
    expect(screen.getByText("The Campaign Period must end before Fingerprint Registration opens.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Registration Opens")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Fingerprint Registration/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Update Registration Window/ })).toBeNull();
  });

  it("opens Fingerprint Registration with the window the board chose", async () => {
    const user = userEvent.setup();
    // Strict sequencing: Stage 3 only becomes interactive once the Campaign
    // Stage has ended, so the window is recorded while Stage 3 is current.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("Registration Opens"), {
      target: { value: futureDate(2) },
    });
    fireEvent.change(screen.getByLabelText("Registration Closes"), {
      target: { value: futureDate(3) },
    });
    await user.click(screen.getByRole("button", { name: /Open Fingerprint Registration/ }));

    await waitFor(() => {
      expect(mockStartFingerprintRegistrationRpc).toHaveBeenCalledWith(
        PERIOD_ID,
        expect.any(String),
        expect.any(String),
      );
    });
  });

  it("flags the empty registration pickers when opened without dates", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: /Open Fingerprint Registration/ }));

    expect(screen.getByText("Choose the registration start and end date before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Registration Opens")).toHaveClass("border-red-300");
    expect(screen.getByLabelText("Registration Closes")).toHaveClass("border-red-300");
    expect(mockStartFingerprintRegistrationRpc).not.toHaveBeenCalled();
  });

  it("announces Stage 3 to every student voter when the window first opens", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    // Candidacy status is irrelevant to voting, but only approved accounts
    // are registered voters — pending/rejected ones must not be reminded.
    students = [
      { id: "voter-1", status: "approved" },
      { id: "onboarding", status: "pending" },
    ];
    renderPage();

    fireEvent.change(screen.getByLabelText("Registration Opens"), {
      target: { value: futureDate(2) },
    });
    fireEvent.change(screen.getByLabelText("Registration Closes"), {
      target: { value: futureDate(3) },
    });
    await user.click(screen.getByRole("button", { name: /Open Fingerprint Registration/ }));

    await waitFor(() => {
      expect(mockInsertNotification).toHaveBeenCalledTimes(1);
    });
    expect(mockInsertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "voter-1",
        role: "student",
        type: "fingerprint_registration",
        link: "/student/dashboard",
      }),
    );
  });

  it("does not re-announce when the window is updated", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      // Stage 3 stays gated on the campaign meeting having been scheduled.
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      // An in-hours future window: the re-save must pass the booking guards.
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(3, "17:00"),
    });
    students = [{ id: "voter-1", status: "approved" }];
    renderPage();

    // 094 — a reload lands on Stage 4 once the window is open, so walk back
    // to the enrolment card; the saved window is locked, so unlock it with
    // the edit icon first.
    await gotoStage(user, "Fingerprint");
    await user.click(screen.getByRole("button", { name: "Edit the Registration Window" }));
    await user.click(screen.getByRole("button", { name: /Update Registration Window/ }));

    await waitFor(() => {
      expect(mockStartFingerprintRegistrationRpc).toHaveBeenCalled();
    });
    expect(mockInsertNotification).not.toHaveBeenCalled();
  });

  it("locks the Registration pickers once the window is saved, and offers Edit to the Electoral Board", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(3, "17:00"),
    });
    renderPage();
    await gotoStage(user, "Fingerprint");

    // The committed window is a locked record: both pickers are disabled and
    // the save button is dead — the edit icon is the way in.
    expect(screen.getByLabelText("Registration Opens")).toBeDisabled();
    expect(screen.getByLabelText("Registration Closes")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Update Registration Window/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit the Registration Window" })).toBeInTheDocument();

    // The saved window still mirrors back into the (disabled) pickers.
    expect(screen.getByLabelText("Registration Opens")).toHaveValue(
      toLocalDate(localIso(2, "08:00")),
    );
  });

  it("hides the Registration edit icon from a commissioner who is not the Electoral Board", async () => {
    const user = userEvent.setup();
    commissionerRole = "screening_validation";
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(3, "17:00"),
    });
    renderPage();
    await gotoStage(user, "Fingerprint");

    expect(screen.queryByRole("button", { name: "Edit the Registration Window" })).toBeNull();
    expect(screen.getByLabelText("Registration Opens")).toBeDisabled();
    expect(screen.getByLabelText("Registration Closes")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Update Registration Window/ })).toBeDisabled();
  });

  it("unlocks the Registration pickers on the edit icon and saves the moved window", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(4, "17:00"),
    });
    renderPage();
    await gotoStage(user, "Fingerprint");

    await user.click(screen.getByRole("button", { name: "Edit the Registration Window" }));

    expect(screen.getByLabelText("Registration Opens")).toBeEnabled();
    expect(screen.getByLabelText("Registration Closes")).toBeEnabled();
    // Unlocking opens the save button; the icon becomes a cancel.
    expect(screen.getByRole("button", { name: /Update Registration Window/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel editing the Registration Window" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Registration Opens"));
    await user.type(screen.getByLabelText("Registration Opens"), futureDate(3));
    await user.click(screen.getByRole("button", { name: /Update Registration Window/ }));

    await waitFor(() => {
      expect(mockStartFingerprintRegistrationRpc).toHaveBeenCalledWith(
        PERIOD_ID,
        expect.any(String),
        expect.any(String),
      );
    });
  });

  it("discards a Registration window edit on the cancel icon and locks the pickers again", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(4, "17:00"),
    });
    renderPage();

    const savedStart = toLocalDate(localIso(2, "08:00"));
    await gotoStage(user, "Fingerprint");
    await user.click(screen.getByRole("button", { name: "Edit the Registration Window" }));
    await user.clear(screen.getByLabelText("Registration Opens"));
    await user.type(screen.getByLabelText("Registration Opens"), futureDate(3));
    await user.click(screen.getByRole("button", { name: "Cancel editing the Registration Window" }));

    // The picker snaps back to the saved window and locks again.
    expect(screen.getByLabelText("Registration Opens")).toHaveValue(savedStart);
    expect(screen.getByLabelText("Registration Opens")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Update Registration Window/ })).toBeDisabled();
    expect(mockStartFingerprintRegistrationRpc).not.toHaveBeenCalled();
  });

  it("removes End Fingerprint Registration Early button", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    expect(screen.queryByRole("button", { name: /End Fingerprint Registration Early/ })).not.toBeInTheDocument();
  });

  it("checks the Fingerprint step once the window is opened, without closing enrolment", async () => {
    const user = userEvent.setup();
    // 094 — opening the window is the board's Stage 3 work, so the stepper
    // takes its check mark then. The window itself is only SCHEDULED: enrolment
    // is not closed, which happens when the voting start date arrives or Early
    // Voting Activation runs.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(3, "17:00"),
    });
    renderPage();
    await gotoStage(user, "Fingerprint");

    // The stepper marks Stage 3 done as soon as the window is recorded.
    const fpStep = screen.getByRole("button", { name: "View Fingerprint stage" });
    expect(fpStep.querySelector(".lucide-circle-check")).not.toBeNull();

    // The check mark does not mean the window is closed: the card still reads
    // "Scheduled" (not "Closed") and keeps its controls.
    expect(screen.getByText("Registration Scheduled")).toBeInTheDocument();
    expect(screen.queryByText("Registration Closed")).toBeNull();
    expect(screen.getByRole("button", { name: /Update Registration Window/ })).toBeInTheDocument();
  });

  it("opens on the Voting stage after a reload once the enrolment window is open", () => {
    // 094 — the board is handed on to the voting schedule when it opens
    // enrolment; a reload lands in the same place instead of dropping back on
    // the stage it has finished scheduling.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
      fingerprintRegistrationEndAt: localIso(3, "17:00"),
    });
    renderPage();

    expect(screen.getByText("Stage 4: Voting Period")).toBeInTheDocument();
    expect(screen.queryByText("Stage 3: Fingerprint Registration")).toBeNull();
    // The stage itself has not advanced: Stage 4 is only the opened view, and
    // the Fingerprint step keeps its (finished) check mark.
    expect(screen.getByRole("button", { name: "View Voting stage" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "View Fingerprint stage" })).not.toHaveAttribute("aria-current");
  });

  it("blocks publish & proclaim while a complaint is filed — resolve it first", () => {
    electionPeriod = period({
      lifecycleStage: "results",
      resultsPublished: false,
      // 113 — the ended stamp is what makes Stage 5 reachable at all.
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      isActive: false,
    });
    complaints = [{ status: "filed", electionPeriodId: PERIOD_ID }];
    renderPage();

    // 089: the ELECT-02 gate is a hard block again — the board cannot
    // publish or proclaim until the Grievance Commissioner resolves it.
    const proclaim = screen.getByRole("button", { name: /Publish & Proclaim Winners/ });
    expect(proclaim).toBeDisabled();
    expect(screen.getByText(/must be resolved before results can be published/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Complaints" })).toBeNull();
    expect(screen.getByText(/Resolve it to unlock publishing/)).toBeInTheDocument();
  });

  it("reports the complaint count from the server when context has none — and blocks", async () => {
    electionPeriod = period({
      lifecycleStage: "results",
      resultsPublished: false,
      votingEndedAt: "2026-11-02T17:30:00.000Z",
      isActive: false,
    });
    mockCountActiveComplaintsRpc.mockResolvedValue(2);
    renderPage();

    expect(await screen.findByText(/2 unresolved complaints must be resolved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish & Proclaim Winners/ })).toBeDisabled();
  });

  it("will not reset the plan without a password", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Reset Plan/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reset Plan" }));

    expect(mockResetElectionPlanRpc).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Enter the Electoral Board password to continue.")).toBeInTheDocument();
  });

  it("sends only the password to the reset RPC — the school year is set in Stage 1", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Reset Plan/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("New School Year")).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "chief123");
    await user.click(within(dialog).getByRole("button", { name: "Reset Plan" }));

    await waitFor(() => {
      expect(mockResetElectionPlanRpc).toHaveBeenCalledWith("chief123");
    });
  });

  it("after a reset that only archives, Stage 1 asks for the school year again", async () => {
    const user = userEvent.setup();
    // 078: the reset retires the period without starting a new one, so the
    // refreshed period is empty and Stage 1 offers the School Year input.
    mockResetElectionPlanRpc.mockImplementation(async () => {
      mockReloadElectionPeriod.mockResolvedValue({ ...emptyElectionPeriod });
      return { electionPeriodId: null, archivedPrevious: true, mode: "archived" };
    });
    mockApplyElectionPeriod.mockImplementation((fresh: ElectionPeriod) => {
      electionPeriod = fresh;
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: /Reset Plan/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "chief123");
    await user.click(within(dialog).getByRole("button", { name: "Reset Plan" }));

    expect(await screen.findByLabelText("School Year")).toBeInTheDocument();
    expect(await screen.findByText("No active school year")).toBeInTheDocument();
  });

  it("shows the current school year period next to the title", () => {
    electionPeriod = period({ schoolYear: "2027-2028" });
    renderPage();

    expect(screen.getByText(/S\.Y\. 2027-2028/)).toBeInTheDocument();
    const stage1Row = screen.getByText("School Year:").closest("div");
    expect(stage1Row).toHaveTextContent("2027-2028");
  });

  it("shows that no school year is active when there is no period", async () => {
    electionPeriod = { ...emptyElectionPeriod };
    mockGetCurrentElectionId.mockResolvedValue(null);
    renderPage();

    expect(screen.getByText("No active school year")).toBeInTheDocument();
    expect(await screen.findByLabelText("School Year")).toBeInTheDocument();
  });

  it("explains that a reset with history archives instead of deleting", () => {
    renderPage();

    expect(screen.getByText(/archived and kept permanently as history/)).toBeInTheDocument();
  });

  describe("proclaim winners", () => {
    const publishedPeriod = () =>
      period({
        lifecycleStage: "results",
        resultsPublished: true,
        // 113 — publishing requires the Voting Stage to have been ENDED.
        votingEndedAt: "2026-11-02T17:30:00.000Z",
        isActive: false,
      });

    const tallyRows = [
      { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
      { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
      { position: "Secretary", candidateId: "s1", candidateName: "Cara One", partyName: null, votes: 0 },
      { position: "Secretary", candidateId: "s2", candidateName: "Dana Two", partyName: null, votes: 0 },
    ];

    it("shows the tally with the highest vote on top when the merged action is clicked", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      mockGetProclamationTallyRpc.mockResolvedValue(tallyRows);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));

      const dialog = await screen.findByRole("dialog");
      // Ada Leader appears in the President tally section and in the summary.
      expect(within(dialog).getAllByText("Ada Leader").length).toBeGreaterThan(0);
      // President is a clean win; Secretary is an all-zero tie.
      expect(within(dialog).getAllByText(/Tie/).length).toBeGreaterThan(0);
      expect(mockGetProclamationTallyRpc).toHaveBeenCalledWith(PERIOD_ID);
    });

    it("shows each candidate's profile — photo when submitted, generic avatar otherwise", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      // Only Ada's profile exists in context; every other tally row falls back.
      candidates = [
        { id: "p1", picture: "http://example.com/ada.png", gradeLevel: "Grade 12" } as Candidate,
      ];
      mockGetProclamationTallyRpc.mockResolvedValue(tallyRows);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      // Ada's submitted photo and grade level join her tally row.
      expect(
        within(dialog).getByRole("img", { name: "Ada Leader" }),
      ).toHaveAttribute("src", "http://example.com/ada.png");
      expect(within(dialog).getByText("Alpha · Grade 12")).toBeInTheDocument();
      // Candidates without a profile fall back to the generic avatar line.
      expect(within(dialog).getAllByText("Independent").length).toBeGreaterThan(0);
    });

    it("requires the board to choose a winner — with one shared tie resolution method", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      mockGetProclamationTallyRpc.mockResolvedValue(tallyRows);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      // The board cannot pick a winner until the shared tie method is
      // recorded — the tied candidates are not selectable yet and are
      // greyed out until it is.
      expect(within(dialog).queryByRole("button", { name: /Cara One/ })).not.toBeInTheDocument();
      expect(
        within(dialog).getByText(/Record how the tie was resolved above before choosing a winner/),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("Cara One").closest("div.opacity-60")).not.toBeNull();
      // Only the clean-win President carries a trophy — tied candidates earn
      // it only by being chosen.  (Scoped to the tally sections; the dialog
      // header and action button carry their own trophy icons.)
      expect(dialog.querySelectorAll("section svg.lucide-trophy").length).toBe(1);

      await user.selectOptions(
        within(dialog).getByLabelText("How the tie was resolved"),
        "Coin Toss",
      );

      // 085b — the per-candidate confirm no longer asks for a method; the
      // ONE shared decision lives below the complaint note in the dialog.
      await user.click(within(dialog).getByRole("button", { name: /Cara One/ }));

      const alert = await screen.findByRole("alertdialog");
      await user.click(within(alert).getByRole("button", { name: /Confirm Winner/ }));

      // The chosen winner now carries the trophy too — still exactly one per
      // position, and never on an unpicked tied candidate.
      expect(dialog.querySelectorAll("section svg.lucide-trophy").length).toBe(2);

      await user.click(within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ }));

      await waitFor(() => {
        expect(mockProclaimWinnersRpc).toHaveBeenCalledWith(
          PERIOD_ID,
          {
            Secretary: {
              method: "manual",
              candidateIds: ["s1"],
              tieBreak: "Coin Toss",
            },
          },
          { complaintNote: undefined, decisionReason: undefined },
        );
      });
      // The final confirm carries the same proclamation summary shown at the
      // bottom of the review dialog.
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.anything() }),
      );
    });

    it("requires a Complaint Resolution and Justification to proclaim when a substantiated grievance is on record (097)", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      // An already-RESOLVED complaint classified as a substantiated grievance,
      // with the Grievance Commissioner's findings on record.
      complaints = [{
        id: "c1",
        status: "accepted",
        subject: "Vote buying",
        electionPeriodId: PERIOD_ID,
        decision: "substantiated",
        findings: "Ballot receipts confirmed a proxy vote.",
      }];
      // A tie-free tally, so the only thing blocking the action is the reason.
      mockGetProclamationTallyRpc.mockResolvedValue([
        { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
        { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
      ]);
      renderPage();

      // Stage 5 — the substantiated grievance appears ONLY in the red
      // section below, as the reason the board owes a Complaint Resolution
      // and Justification.
      // Its findings are hidden until the Nature of Complaint is clicked.
      expect(
        screen.getByText(/A Complaint Resolution and Justification is required when proclaiming winners due to:/),
      ).toBeInTheDocument();
      expect(screen.queryByText("Ballot receipts confirmed a proxy vote.")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Vote buying/ }));
      expect(screen.getByText("Ballot receipts confirmed a proxy vote.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      const proclaim = within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ });
      expect(within(dialog).getByLabelText(/Complaint Resolution and Justification/)).toBeInTheDocument();
      expect(proclaim).toBeDisabled();

      // The grievance's findings are revealed the same way inside the dialog.
      const dialogRow = within(dialog).getByRole("button", { name: /Vote buying/ });
      expect(within(dialog).queryByText("Ballot receipts confirmed a proxy vote.")).not.toBeInTheDocument();
      await user.click(dialogRow);
      expect(within(dialog).getByText("Ballot receipts confirmed a proxy vote.")).toBeInTheDocument();

      await user.type(within(dialog).getByLabelText(/Complaint Resolution and Justification/), "Results were tainted by the substantiated grievance.");

      // 117 — a complaint is on record, so the default President winner
      // must be affirmed with "Remain Winner" before proclaiming unlocks.
      expect(proclaim).toBeDisabled();
      await user.click(within(dialog).getByRole("button", { name: "Remain Winner" }));
      expect(proclaim).toBeEnabled();
    });

    it("requires a Complaint Resolution and Justification for unsubstantiated and dismissed decisions too (114)", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      // Resolved complaints classified Unsubstantiated and Dismissed — 097
      // left these without any owed explanation; 114 makes them eligible
      // (and required) for the Board's one-time resolution + justification.
      complaints = [
        {
          id: "c1",
          status: "accepted",
          subject: "Late filing",
          electionPeriodId: PERIOD_ID,
          decision: "unsubstantiated",
          findings: "No evidence supported the claim.",
        },
        {
          id: "c2",
          status: "accepted",
          subject: "Campaign past hours",
          electionPeriodId: PERIOD_ID,
          decision: "dismissed",
          findings: "Filed outside the complaint window.",
        },
      ];
      // A tie-free tally, so the only thing blocking the action is the
      // resolution and justification.
      mockGetProclamationTallyRpc.mockResolvedValue([
        { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
        { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
      ]);
      renderPage();

      // Stage 5 — the gray decisions card carries the requirement note for
      // every decision on record.
      expect(
        screen.getByText(/A Complaint Resolution and Justification is required when proclaiming winners/),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      const proclaim = within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ });
      // Both decisions are listed with click-to-reveal findings (just like a
      // substantiated grievance), and the field is required.
      expect(within(dialog).getByText("2 complaint decisions on record")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /Late filing/ })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /Campaign past hours/ })).toBeInTheDocument();
      expect(within(dialog).getByLabelText(/Complaint Resolution and Justification/)).toBeInTheDocument();
      expect(proclaim).toBeDisabled();

      // The findings reveal the same way inside the dialog.
      expect(within(dialog).queryByText("No evidence supported the claim.")).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: /Late filing/ }));
      expect(within(dialog).getByText("No evidence supported the claim.")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: /Campaign past hours/ }));
      expect(within(dialog).getByText("Filed outside the complaint window.")).toBeInTheDocument();

      await user.type(
        within(dialog).getByLabelText(/Complaint Resolution and Justification/),
        "The grievance did not change the outcome.",
      );

      // 117 — the complaint on record obliges the board to affirm the
      // default President winner before proclaiming.
      await user.click(within(dialog).getByRole("button", { name: "Remain Winner" }));
      expect(proclaim).toBeEnabled();

      await user.click(proclaim);
      await waitFor(() => {
        expect(mockProclaimWinnersRpc).toHaveBeenCalledWith(
          PERIOD_ID,
          { President: { remainWinner: true } },
          { complaintNote: undefined, decisionReason: "The grievance did not change the outcome." },
        );
      });
    });

    it("locks tie picks until the Complaint Resolution and Justification and tie method are recorded (097)", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      complaints = [{
        id: "c1",
        status: "accepted",
        subject: "Vote buying",
        electionPeriodId: PERIOD_ID,
        decision: "substantiated",
        findings: "Ballot receipts confirmed a proxy vote.",
      }];
      mockGetProclamationTallyRpc.mockResolvedValue(tallyRows);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      // Neither requirement answered yet — tied candidates are not pickable,
      // and the pickable rows are greyed out.
      expect(within(dialog).queryByRole("button", { name: /Cara One/ })).not.toBeInTheDocument();
      expect(
        within(dialog).getByText(
          /Record the Complaint Resolution and Justification and how the tie was resolved above before choosing a winner/,
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("Cara One").closest("div.opacity-60")).not.toBeNull();

      await user.type(within(dialog).getByLabelText(/Complaint Resolution and Justification/), "The grievance did not change the outcome.");
      await user.selectOptions(within(dialog).getByLabelText("How the tie was resolved"), "Coin Toss");

      // Both recorded — the grey-out lifts and the tie opens for picks.
      expect(within(dialog).getByText("Cara One").closest("div.opacity-60")).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: /Cara One/ }));
      const alert = await screen.findByRole("alertdialog");
      await user.click(within(alert).getByRole("button", { name: /Confirm Winner/ }));
      expect(within(dialog).getByText("Chosen")).toBeInTheDocument();
      // The chosen winner row carries the proclamation colour.  (117 — the
      // row locks once the seat is filled, so find it by its rounded row
      // class; the name also appears in the bottom summary — take the
      // tally-section match.)
      const chosenRow = within(dialog).getAllByText("Cara One")[0].closest(".rounded-xl");
      expect(chosenRow).toHaveClass("bg-[#5C0102]");
    });

    it("summarizes the proclamation at the bottom of the dialog", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      mockGetProclamationTallyRpc.mockResolvedValue(tallyRows);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText("Proclamation Summary")).toBeInTheDocument();
      // 113b — the bottom summary is a count: the clean-win President is
      // selected, the all-zero Secretary tie is not picked yet.
      expect(within(dialog).getByText("Winners to proclaim — 1 of 2 selected")).toBeInTheDocument();
      expect(within(dialog).getByText("1 of 2 winners selected")).toBeInTheDocument();
      expect(within(dialog).getByText("Not recorded yet")).toBeInTheDocument();

      await user.selectOptions(within(dialog).getByLabelText("How the tie was resolved"), "Coin Toss");
      await user.click(within(dialog).getByRole("button", { name: /Cara One/ }));
      const alert = await screen.findByRole("alertdialog");
      await user.click(within(alert).getByRole("button", { name: /Confirm Winner/ }));

      // The summary now counts the board's decision too.
      expect(within(dialog).getByText("Winners to proclaim — 2 of 2 selected")).toBeInTheDocument();
      expect(within(dialog).getByText("2 of 2 winners selected")).toBeInTheDocument();
      expect(within(dialog).getByText("Tie resolution:")).toBeInTheDocument();
      expect(within(dialog).queryByText("Not recorded yet")).not.toBeInTheDocument();
    });

    it("proclaims BOTH winners of a 2-way Grade Level Representative tie without a board pick (117)", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      mockGetProclamationTallyRpc.mockResolvedValue([
        { position: "Grade 12 Representative", candidateId: "g1", candidateName: "Ella Tied", partyName: "Alpha", votes: 7 },
        { position: "Grade 12 Representative", candidateId: "g2", candidateName: "Fe Tied", partyName: "Beta", votes: 7 },
        { position: "Grade 12 Representative", candidateId: "g3", candidateName: "Gil Third", partyName: "Gamma", votes: 1 },
        { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
        { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
      ]);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      // The 2-way Grade Rep tie elects both by the standing rule — no
      // resolution method, no pick, and both tied rows carry the trophy
      // beside the clean-win President's.
      expect(within(dialog).getByText("2-way tie — both win")).toBeInTheDocument();
      expect(within(dialog).queryByLabelText("How the tie was resolved")).not.toBeInTheDocument();
      expect(dialog.querySelectorAll("section svg.lucide-trophy").length).toBe(3);
      expect(within(dialog).getByText("Winners to proclaim — 3 of 3 selected")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ }));
      await waitFor(() => {
        expect(mockProclaimWinnersRpc).toHaveBeenCalledWith(
          PERIOD_ID,
          {},
          { complaintNote: undefined, decisionReason: undefined },
        );
      });
    });

    it("requires the board to pick 2 winners when 3 or more tie for a Grade Level Representative seat (117)", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      mockGetProclamationTallyRpc.mockResolvedValue([
        { position: "Grade 12 Representative", candidateId: "h1", candidateName: "Hana Tie", partyName: "Alpha", votes: 5 },
        { position: "Grade 12 Representative", candidateId: "h2", candidateName: "Ivy Tie", partyName: "Beta", votes: 5 },
        { position: "Grade 12 Representative", candidateId: "h3", candidateName: "May Tie", partyName: "Gamma", votes: 5 },
        { position: "Grade 12 Representative", candidateId: "h4", candidateName: "Noa Third", partyName: "Delta", votes: 1 },
        { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
        { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
      ]);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText("3-way tie — pick 2")).toBeInTheDocument();
      await user.selectOptions(within(dialog).getByLabelText("How the tie was resolved"), "Coin Toss");

      // First pick lands; one more is still owed.
      await user.click(within(dialog).getByRole("button", { name: /Hana Tie/ }));
      const firstAlert = await screen.findByRole("alertdialog");
      await user.click(within(firstAlert).getByRole("button", { name: /Confirm Winner/ }));
      expect(within(dialog).getByText("Winners to proclaim — 2 of 3 selected")).toBeInTheDocument();
      expect(within(dialog).getByText("1 more pick to go.")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: /Ivy Tie/ }));
      const secondAlert = await screen.findByRole("alertdialog");
      await user.click(within(secondAlert).getByRole("button", { name: /Confirm Winner/ }));
      expect(within(dialog).getByText("Winners to proclaim — 3 of 3 selected")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ }));
      await waitFor(() => {
        expect(mockProclaimWinnersRpc).toHaveBeenCalledWith(
          PERIOD_ID,
          {
            "Grade 12 Representative": {
              method: "manual",
              candidateIds: ["h1", "h2"],
              tieBreak: "Coin Toss",
            },
          },
          { complaintNote: undefined, decisionReason: undefined },
        );
      });
    });

    it("requires Remain Winner on every default winner while a complaint is on record (117)", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      // A resolved complaint is on record — publishing may proceed, but
      // every default (highest-vote) winner must be affirmed first.
      complaints = [{
        id: "c1",
        status: "accepted",
        subject: "Late filing",
        electionPeriodId: PERIOD_ID,
        decision: "unsubstantiated",
        findings: "No evidence supported the claim.",
      }];
      mockGetProclamationTallyRpc.mockResolvedValue([
        { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
        { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
        { position: "Grade 7 Representative", candidateId: "r1", candidateName: "Omar Rep", partyName: null, votes: 6 },
        { position: "Grade 7 Representative", candidateId: "r2", candidateName: "Pia Rep", partyName: null, votes: 3 },
      ]);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      const proclaim = within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ });
      // The reason is owed for the decision on record, and BOTH positions
      // with a default winner show the "Remain Winner" affirmation.
      await user.type(within(dialog).getByLabelText(/Complaint Resolution and Justification/), "The grievance did not change the outcome.");
      expect(within(dialog).getAllByText("Complaint on record").length).toBe(2);
      expect(proclaim).toBeDisabled();

      // Affirming one position is not enough — the other still blocks.
      const remainButtons = within(dialog).getAllByRole("button", { name: "Remain Winner" });
      expect(remainButtons.length).toBe(2);
      await user.click(remainButtons[0]);
      expect(within(dialog).getByRole("button", { name: "Remain Winner — affirmed" })).toBeInTheDocument();
      expect(proclaim).toBeDisabled();

      await user.click(within(dialog).getByRole("button", { name: "Remain Winner" }));
      expect(proclaim).toBeEnabled();

      await user.click(proclaim);
      await waitFor(() => {
        expect(mockProclaimWinnersRpc).toHaveBeenCalledWith(
          PERIOD_ID,
          {
            President: { remainWinner: true },
            "Grade 7 Representative": { remainWinner: true },
          },
          { complaintNote: undefined, decisionReason: "The grievance did not change the outcome." },
        );
      });
    });
  });
});
