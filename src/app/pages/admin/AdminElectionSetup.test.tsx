import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminElectionSetup, { resolveStage } from "./AdminElectionSetup";
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
  mockCloseElectionRpc,
  mockReopenVotingRpc,
  mockEndVotingStageRpc,
  mockGetProclamationTallyRpc,
  mockProclaimWinnersRpc,
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
  mockCloseElectionRpc: vi.fn(),
  mockReopenVotingRpc: vi.fn(),
  mockEndVotingStageRpc: vi.fn(),
  mockGetProclamationTallyRpc: vi.fn(),
  mockProclaimWinnersRpc: vi.fn(),
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
  closeElectionRpc: mockCloseElectionRpc,
  reopenVotingRpc: mockReopenVotingRpc,
  endVotingStageRpc: mockEndVotingStageRpc,
  publishResultsRpc: vi.fn(),
  getProclamationTallyRpc: mockGetProclamationTallyRpc,
  proclaimWinnersRpc: mockProclaimWinnersRpc,
}));

// The confirm dialog is a generic utility with its own behaviour; these tests
// are about the page's stage logic, so every confirm resolves true.
vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

let electionPeriod: ElectionPeriod;
let complaints: { status: string; electionPeriodId?: string }[];
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
    mockReopenVotingRpc.mockResolvedValue(undefined);
    mockEndVotingStageRpc.mockResolvedValue(undefined);
  });

  it("locks the campaign stage until a period exists to hang the meeting on", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ id: undefined, lifecycleStage: "application", candidacyOpen: false });
    mockGetCurrentElectionId.mockResolvedValue(null);
    renderPage();

    await gotoStage(user, "Campaign");
    expect(screen.getByText("Open the Candidate Application Period first.")).toBeInTheDocument();
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
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    // Prev is closed on the first stage; Next walks forward one stage.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Next: Campaign/ }));
    expect(screen.getByText("Stage 2: Campaign Period")).toBeInTheDocument();

    // The stepper jumps straight to any stage...
    await gotoStage(user, "Results");
    expect(screen.getByText("Stage 5: Election Result")).toBeInTheDocument();

    // ...and Next is closed on the last stage.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Previous: Voting/ }));
    expect(screen.getByText("Stage 4: Voting Period")).toBeInTheDocument();
  });

  it("refuses to open voting before the campaign meeting is scheduled", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    // The vote is not startable while the Application Stage is still current:
    // the button stays closed and the standing lock note names the reason.
    await gotoStage(user, "Voting");
    expect(screen.getByText("Schedule the campaign meeting before opening voting.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Voting/ })).toBeDisabled();
  });

  it("Open Voting saves the schedule before opening the election", async () => {
    const user = userEvent.setup();
    // 082 follow-up — Stage 4 has no Save button: Open Voting persists the
    // voting window (dates, modality, venue) BEFORE calling open_election_rpc,
    // which opens the row as saved. Strict sequencing: the vote opens while
    // Stage 3 is current with a started enrolment window.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      fingerprintRegistrationStartAt: localIso(2, "08:00"),
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Open Voting/ }));

    await waitFor(() => {
      expect(mockSetElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String),
          electionModality: "digital",
          venue: "CNNHS Covered Court",
        }),
      );
      expect(mockOpenElectionRpc).toHaveBeenCalledWith(PERIOD_ID);
    });
    // The row must be saved before the stage flips.
    expect(mockSetElectionPeriod.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenElectionRpc.mock.invocationCallOrder[0],
    );
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
    expect(screen.getByRole("button", { name: /Open Voting/ })).toBeEnabled();
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

    // The 0-candidate gate is not a persistent block any more: the Open
    // Voting button is disabled and names the reason in its tooltip.
    await gotoStage(user, "Voting");
    const openVoting = screen.getByRole("button", { name: /Open Voting/ });
    expect(openVoting).toBeDisabled();
    expect(openVoting).toHaveAttribute(
      "title",
      "Every position needs an approved candidate before voting can open.",
    );
  });

  it("flags the cleared voting date pickers when Open Voting is clicked without them", async () => {
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
    await user.click(screen.getByRole("button", { name: /Open Voting/ }));

    expect(screen.getByText("Choose the voting start and end date before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Start Date")).toHaveClass("border-red-300");
    expect(screen.getByLabelText("End Date")).toHaveClass("border-red-300");
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("keeps Open Voting closed while the Campaign Stage is still active", async () => {
    const user = userEvent.setup();
    // Strict sequencing: the vote cannot open a stage that has not been
    // reached — the Campaign must end and Stage 3 start first.
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    const openVoting = screen.getByRole("button", { name: /Open Voting/ });
    expect(openVoting).toBeDisabled();
    expect(openVoting).toHaveAttribute(
      "title",
      "End the Campaign Period and start Fingerprint Registration first.",
    );
    expect(screen.getByText("End the Campaign Period and start Fingerprint Registration before opening voting.")).toBeInTheDocument();

    await user.click(openVoting);
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("keeps Open Voting closed until Fingerprint Registration has started", async () => {
    const user = userEvent.setup();
    // Stage 3 is active but its window was never recorded — a stage cannot
    // end without starting, so the vote stays closed.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    candidates = fullRoster();
    renderPage();

    await gotoStage(user, "Voting");
    const openVoting = screen.getByRole("button", { name: /Open Voting/ });
    expect(openVoting).toBeDisabled();
    expect(openVoting).toHaveAttribute(
      "title",
      "End the Campaign Period and start Fingerprint Registration first.",
    );

    await user.click(openVoting);
    expect(mockOpenElectionRpc).not.toHaveBeenCalled();
  });

  it("Close Voting pauses the vote and offers the password-gated actions", async () => {
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
    // close_election_rpc (084) only pauses: the row stays at stage 'voting'.
    const pausedRow = period({
      lifecycleStage: "voting",
      isActive: false,
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
      startDate: "2026-11-02",
      startTime: "08:00",
      endDate: "2026-11-02",
      endTime: "17:00",
    });
    mockReloadElectionPeriod.mockResolvedValue(pausedRow);
    renderPage();

    await gotoStage(user, "Voting");
    await user.click(screen.getByRole("button", { name: /Close Voting/ }));

    await waitFor(() => {
      expect(mockCloseElectionRpc).toHaveBeenCalledWith(PERIOD_ID);
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleStage: "voting", isActive: false }),
      );
    });
  });

  it("shows Reopen Voting and End Voting Stage while the vote is paused", async () => {
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
    // The pause is not the end: both consequential moves are offered.
    expect(screen.getByRole("button", { name: /Reopen Voting/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /End Voting Stage/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Close Voting/ })).toBeNull();

    // Stage 5 publishing stays locked until the stage was actually ENDED.
    await gotoStage(user, "Results");
    expect(screen.getByRole("button", { name: /Publish & Proclaim Winners/ })).toBeDisabled();
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
    // reopen_voting_rpc (084) flips is_active back on; the page mirrors the
    // row the server produced.
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

  it("End Voting Stage moves the election to Stage 5 once the password is accepted", async () => {
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
    // end_voting_stage_rpc (084) moves the stage to results; the page mirrors
    // the row the server produced.
    mockReloadElectionPeriod.mockResolvedValue(
      period({
        lifecycleStage: "results",
        isActive: false,
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
        expect.objectContaining({ lifecycleStage: "results", isActive: false }),
      );
    });
  });

  it("hides Open Voting once voting has concluded — no re-open", async () => {
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

    // Closing the vote moved the election to Stage 5 (the default view): the
    // publish flow takes over, and Stage 4 offers no way back in.
    expect(screen.getByRole("button", { name: /Publish & Proclaim Winners/ })).toBeEnabled();
    await gotoStage(user, "Voting");
    expect(screen.queryByRole("button", { name: /Open Voting/ })).toBeNull();
    expect(screen.getByText("Voting Closed")).toBeInTheDocument();
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

    expect(screen.getByText(/end date must be after the start date/)).toBeInTheDocument();
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

    // With no Save button, Open Voting is what commits the modality.
    await user.selectOptions(modality, "manual");
    await user.click(screen.getByRole("button", { name: /Open Voting/ }));

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
    await user.click(screen.getByRole("button", { name: /Open Voting/ }));

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

  it("locks Fingerprint Registration until the campaign meeting is scheduled", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "campaign", candidacyOpen: false });
    renderPage();

    await gotoStage(user, "Fingerprint");
    expect(screen.getByText("Save the meeting schedule in the Application Stage first.")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /Update Registration Window/ }));

    await waitFor(() => {
      expect(mockStartFingerprintRegistrationRpc).toHaveBeenCalled();
    });
    expect(mockInsertNotification).not.toHaveBeenCalled();
  });

  it("disables End Fingerprint Registration Early until the window has started", async () => {
    const user = userEvent.setup();
    // "End Campaign Early" can move the election here with no window recorded:
    // a stage cannot end without starting, so the end button stays closed.
    electionPeriod = period({
      lifecycleStage: "fingerprint_registration",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    const end = screen.getByRole("button", { name: /End Fingerprint Registration Early/ });
    expect(end).toBeDisabled();
    expect(end).toHaveAttribute("title", "Start the registration window first.");

    await user.click(end);
    expect(mockCloseFingerprintRegistrationRpc).not.toHaveBeenCalled();
  });

  it("blocks publish & proclaim while a complaint is filed — resolve it first", () => {
    electionPeriod = period({ lifecycleStage: "results", resultsPublished: false, isActive: false });
    complaints = [{ status: "filed", electionPeriodId: PERIOD_ID }];
    renderPage();

    // 089: the ELECT-02 gate is a hard block again — the board cannot
    // publish or proclaim until the Grievance Commissioner resolves it.
    const proclaim = screen.getByRole("button", { name: /Publish & Proclaim Winners/ });
    expect(proclaim).toBeDisabled();
    expect(screen.getByText(/must be resolved before results can be published/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Complaints" })).toHaveAttribute("href", "/admin/complaints");
  });

  it("reports the complaint count from the server when context has none — and blocks", async () => {
    electionPeriod = period({ lifecycleStage: "results", resultsPublished: false, isActive: false });
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
      period({ lifecycleStage: "results", resultsPublished: true, isActive: false });

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
      expect(within(dialog).getByText("Ada Leader")).toBeInTheDocument();
      // President is a clean win; Secretary is an all-zero tie.
      expect(within(dialog).getAllByText(/Tie/).length).toBeGreaterThan(0);
      expect(mockGetProclamationTallyRpc).toHaveBeenCalledWith(PERIOD_ID);
    });

    it("requires the board to choose a winner — with one shared tie resolution method", async () => {
      const user = userEvent.setup();
      electionPeriod = publishedPeriod();
      mockGetProclamationTallyRpc.mockResolvedValue(tallyRows);
      renderPage();

      await user.click(screen.getByRole("button", { name: /Publish & Proclaim Winners/ }));
      const dialog = await screen.findByRole("dialog");

      // 085b — the per-candidate confirm no longer asks for a method; the
      // ONE shared decision lives below the complaint note in the dialog.
      await user.click(within(dialog).getByRole("button", { name: /Cara One/ }));

      const alert = await screen.findByRole("alertdialog");
      await user.click(within(alert).getByRole("button", { name: /Confirm Winner/ }));

      await user.selectOptions(
        within(dialog).getByLabelText("How the tie was resolved"),
        "Coin Toss",
      );
      await user.click(within(dialog).getByRole("button", { name: /Publish & Proclaim Winners/ }));

      await waitFor(() => {
        expect(mockProclaimWinnersRpc).toHaveBeenCalledWith(
          PERIOD_ID,
          {
            Secretary: {
              method: "manual",
              candidateId: "s1",
              tieBreak: "Coin Toss",
            },
          },
          { complaintNote: undefined },
        );
      });
    });
  });
});
