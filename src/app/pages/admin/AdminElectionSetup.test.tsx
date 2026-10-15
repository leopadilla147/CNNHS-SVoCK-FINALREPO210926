import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminElectionSetup, { resolveStage } from "./AdminElectionSetup";
import { emptyElectionPeriod } from "../../context/AppContext";
import type { ElectionPeriod } from "../../context/AppContext";

const PERIOD_ID = "3f1d0b1e-9c4a-4a7f-8b21-2c0e5d7a1b33";

const {
  mockApplyElectionPeriod,
  mockGetCurrentElectionId,
  mockReloadElectionPeriod,
  mockStartCandidacyPeriodRpc,
  mockCloseCandidacyPeriodRpc,
  mockEndCandidacyAndScheduleMeetingRpc,
  mockStartFingerprintRegistrationRpc,
  mockCloseFingerprintRegistrationRpc,
  mockCountActiveComplaintsRpc,
  mockResetElectionPlanRpc,
  mockConfirm,
} = vi.hoisted(() => ({
  mockApplyElectionPeriod: vi.fn(),
  mockGetCurrentElectionId: vi.fn(),
  mockReloadElectionPeriod: vi.fn(),
  mockStartCandidacyPeriodRpc: vi.fn(),
  mockCloseCandidacyPeriodRpc: vi.fn(),
  mockEndCandidacyAndScheduleMeetingRpc: vi.fn(),
  mockStartFingerprintRegistrationRpc: vi.fn(),
  mockCloseFingerprintRegistrationRpc: vi.fn(),
  mockCountActiveComplaintsRpc: vi.fn(),
  mockResetElectionPlanRpc: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ isSupabaseConfigured: true }));

vi.mock("../../lib/supabaseData", () => ({
  getCurrentElectionId: mockGetCurrentElectionId,
  reloadElectionPeriod: mockReloadElectionPeriod,
  startCandidacyPeriodRpc: mockStartCandidacyPeriodRpc,
  closeCandidacyPeriodRpc: mockCloseCandidacyPeriodRpc,
  endCandidacyAndScheduleMeetingRpc: mockEndCandidacyAndScheduleMeetingRpc,
  startFingerprintRegistrationRpc: mockStartFingerprintRegistrationRpc,
  closeFingerprintRegistrationRpc: mockCloseFingerprintRegistrationRpc,
  countActiveComplaintsRpc: mockCountActiveComplaintsRpc,
  resetElectionPlanRpc: mockResetElectionPlanRpc,
  openElectionRpc: vi.fn(),
  closeElectionRpc: vi.fn(),
  publishResultsRpc: vi.fn(),
  proclaimWinnersRpc: vi.fn().mockResolvedValue([]),
}));

// The confirm dialog is a generic utility with its own behaviour; these tests
// are about the page's stage logic, so every confirm resolves true.
vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

let electionPeriod: ElectionPeriod;
let complaints: { status: string }[];

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return {
    ...actual,
    useApp: () => ({
      electionPeriod,
      setElectionPeriod: vi.fn().mockResolvedValue({ ok: true }),
      applyElectionPeriod: mockApplyElectionPeriod,
      addLog: vi.fn(),
      currentUser: { id: "admin-1", name: "Chief" },
      candidates: [],
      complaints,
    }),
  };
});

function period(overrides: Partial<ElectionPeriod> = {}): ElectionPeriod {
  return { ...emptyElectionPeriod, id: PERIOD_ID, ...overrides };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminElectionSetup />
    </MemoryRouter>,
  );
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
    mockConfirm.mockResolvedValue(true);
    mockGetCurrentElectionId.mockResolvedValue(PERIOD_ID);
    mockReloadElectionPeriod.mockImplementation(async () => electionPeriod);
    mockCountActiveComplaintsRpc.mockResolvedValue(0);
    mockStartCandidacyPeriodRpc.mockResolvedValue(PERIOD_ID);
    mockCloseCandidacyPeriodRpc.mockResolvedValue(PERIOD_ID);
    mockEndCandidacyAndScheduleMeetingRpc.mockResolvedValue("2026-09-30T09:00:00.000Z");
    mockStartFingerprintRegistrationRpc.mockResolvedValue(undefined);
    mockCloseFingerprintRegistrationRpc.mockResolvedValue(undefined);
    mockResetElectionPlanRpc.mockResolvedValue({
      electionPeriodId: PERIOD_ID,
      archivedPrevious: false,
      schoolYear: "2027-2028",
      mode: "cleared",
    });
  });

  it("locks the campaign stage until a period exists to hang the meeting on", () => {
    electionPeriod = period({ id: undefined, lifecycleStage: "application", candidacyOpen: false });
    mockGetCurrentElectionId.mockResolvedValue(null);
    renderPage();

    expect(screen.getByText("Open the Candidate Application Period first.")).toBeInTheDocument();
  });

  it("keeps the campaign stage reachable while Stage 1 is still current", () => {
    // Scheduling the meeting is what ENDS the application period, so gating
    // Stage 2 on having left Stage 1 would deadlock the whole page.
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    expect(screen.queryByText("Open the Candidate Application Period first.")).toBeNull();
    expect(screen.getByLabelText("Meeting Date")).toBeInTheDocument();
  });

  it("refuses to open voting before the campaign meeting is scheduled", () => {
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    expect(screen.getByText("Schedule the campaign meeting before opening voting.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Voting/ })).toBeDisabled();
  });

  it("will not end candidacy until a meeting date is chosen", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    renderPage();

    const schedule = screen.getByRole("button", { name: /Schedule Meeting & End Candidacy/ });
    expect(schedule).toBeDisabled();

    await user.click(schedule);

    expect(mockEndCandidacyAndScheduleMeetingRpc).not.toHaveBeenCalled();
  });

  it("re-reads the period from the server after a stage transition", async () => {
    const user = userEvent.setup();
    electionPeriod = period({ lifecycleStage: "application", candidacyOpen: true });
    // The RPC moves the period to campaign; the page must reflect the row the
    // server produced rather than the one it happened to be holding.
    mockReloadElectionPeriod.mockResolvedValue(
      period({ lifecycleStage: "campaign", candidacyOpen: false, rulesDiscussionAt: "2026-09-30T09:00:00.000Z" }),
    );
    renderPage();

    await user.type(screen.getByLabelText("Meeting Date"), "2026-09-30");
    await user.click(screen.getByRole("button", { name: /Schedule Meeting & End Candidacy/ }));

    await waitFor(() => {
      expect(mockEndCandidacyAndScheduleMeetingRpc).toHaveBeenCalledWith(
        PERIOD_ID,
        expect.any(String),
      );
    });
    await waitFor(() => {
      expect(mockApplyElectionPeriod).toHaveBeenCalledWith(
        expect.objectContaining({ lifecycleStage: "campaign" }),
      );
    });
  });

  it("locks Fingerprint Registration until the campaign meeting is scheduled", () => {
    electionPeriod = period({ lifecycleStage: "campaign", candidacyOpen: false });
    renderPage();

    expect(screen.getByText("Schedule the campaign meeting first.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Registration Opens")).toBeNull();
  });

  it("opens Fingerprint Registration with the window the board chose", async () => {
    const user = userEvent.setup();
    electionPeriod = period({
      lifecycleStage: "campaign",
      candidacyOpen: false,
      rulesDiscussionAt: "2026-09-30T09:00:00.000Z",
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("Registration Opens"), {
      target: { value: "2026-10-05T08:00" },
    });
    fireEvent.change(screen.getByLabelText("Registration Closes"), {
      target: { value: "2026-10-06T17:00" },
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

  it("blocks publishing results while a complaint is filed", () => {
    electionPeriod = period({ lifecycleStage: "results", resultsPublished: false, isActive: false });
    complaints = [{ status: "filed" }];
    renderPage();

    const publish = screen.getByRole("button", { name: /Publish Results/ });
    expect(publish).toBeDisabled();
    expect(screen.getByText(/blocking the announcement/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Complaints" })).toHaveAttribute("href", "/admin/complaints");
  });

  it("reports the complaint count from the server when context has none", async () => {
    electionPeriod = period({ lifecycleStage: "results", resultsPublished: false, isActive: false });
    mockCountActiveComplaintsRpc.mockResolvedValue(2);
    renderPage();

    expect(await screen.findByText(/2 unresolved complaints are blocking/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish Results/ })).toBeDisabled();
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

  it("sends the password and the new school year to the reset RPC", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Reset Plan/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("New School Year"), "2027-2028");
    await user.type(within(dialog).getByLabelText("Electoral Board Password"), "chief123");
    await user.click(within(dialog).getByRole("button", { name: "Reset Plan" }));

    await waitFor(() => {
      expect(mockResetElectionPlanRpc).toHaveBeenCalledWith("chief123", "2027-2028");
    });
  });

  it("explains that a reset with history archives instead of deleting", () => {
    renderPage();

    expect(screen.getByText(/archived and kept permanently as history/)).toBeInTheDocument();
  });
});
