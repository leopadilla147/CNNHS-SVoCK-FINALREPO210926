import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminComplaints from "./AdminComplaints";
import type { Complaint } from "../../context/AppContext";

const { mockUseApp, mockSaveForm, mockDecideRpc, mockConfirm, mockVerifyPassword } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockSaveForm: vi.fn(),
  mockDecideRpc: vi.fn(),
  mockConfirm: vi.fn(),
  mockVerifyPassword: vi.fn(),
}));

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return { ...actual, useApp: () => mockUseApp() };
});

// The repo convention: the confirm dialog auto-confirms (tests assert on the
// RPC, not on the dialog).
vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

vi.mock("../../lib/supabaseData", () => ({
  decideComplaintRpc: (...args: unknown[]) => mockDecideRpc(...args),
  uploadComplaintEvidence: vi.fn(),
  verifyGrievancePasswordRpc: (...args: unknown[]) => mockVerifyPassword(...args),
}));

vi.mock("../../lib/docxGrievanceResponseForm", () => ({
  saveGrievanceResponseFormDocx: (...args: unknown[]) => mockSaveForm(...args),
  GRIEVANCE_RESPONSE_FORM_FILENAME: "CNNHS-Grievance-Commissioner-Response-Form.docx",
}));

function complaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: "complaint-1",
    studentName: "Maria Santos",
    subject: "Impersonation",
    description: "A candidate used another student's identity.",
    status: "filed",
    submittedAt: "2026-10-20",
    electionPeriodId: "ep-1",
    ...overrides,
  };
}

const grievanceUser = {
  id: "u1",
  name: "IVY DENICE M. ABOGADO, RGC",
  role: "admin",
  email: "grievance@test.local",
  commissionerRole: "grievance",
  mustChangePassword: false,
};

const chiefUser = { ...grievanceUser, id: "u2", name: "Chief Commissioner", commissionerRole: "chief" };

function appState(overrides: Record<string, unknown> = {}) {
  return {
    complaints: [complaint()],
    setComplaints: vi.fn(),
    candidates: [],
    setCandidates: vi.fn(),
    addLog: vi.fn(),
    currentUser: grievanceUser,
    electionPeriod: { id: "ep-1", schoolYear: "2026-2027" },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminComplaints />
    </MemoryRouter>
  );
}

describe("AdminComplaints response form download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveForm.mockResolvedValue(undefined);
  });

  it("shows the Response Form download to the Grievance Commissioner and fills it from the complaint", async () => {
    const user = userEvent.setup();
    mockUseApp.mockReturnValue(appState());
    renderPage();

    await waitFor(() => expect(screen.getByText("Impersonation")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /download cnnhs-grievance-commissioner-response-form/i }));

    expect(mockSaveForm).toHaveBeenCalledWith(
      expect.objectContaining({
        complaint: expect.objectContaining({ id: "complaint-1", subject: "Impersonation" }),
        commissionerName: "IVY DENICE M. ABOGADO, RGC",
        schoolYear: "2026-2027",
      })
    );
  });

  it("keeps the Resolved button on filed cards alongside the download", async () => {
    mockUseApp.mockReturnValue(appState());
    renderPage();

    await waitFor(() => expect(screen.getByText("Impersonation")).toBeInTheDocument());
    // Two "Resolved" buttons: the filter chip and the card's resolve control.
    expect(screen.getAllByRole("button", { name: "Resolved" })).toHaveLength(2);
  });

  it("hides the download from the Chief Commissioner", async () => {
    mockUseApp.mockReturnValue(appState({ currentUser: chiefUser }));
    renderPage();

    await waitFor(() => expect(screen.getByText("Impersonation")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /download cnnhs-grievance-commissioner-response-form/i })).toBeNull();
    // The Chief still sees the resolve control (chip + card button).
    expect(screen.getAllByRole("button", { name: "Resolved" })).toHaveLength(2);
  });

  it("offers no download on resolved cards", async () => {
    mockUseApp.mockReturnValue(
      appState({
        complaints: [complaint({ status: "accepted", findings: "Verified.", resolvedAt: "2026-10-21" })],
      })
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Impersonation")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /download cnnhs-grievance-commissioner-response-form/i })).toBeNull();
    // Only the filter chip remains — the card's resolve button is gone.
    expect(screen.getAllByRole("button", { name: "Resolved" })).toHaveLength(1);
  });
});

const approvedCandidate = {
  id: "cand-1",
  givenName: "Juan",
  surname: "Dela Cruz",
  position: "President",
  status: "approved",
};

const secondCandidate = {
  id: "cand-2",
  givenName: "Maria",
  surname: "Santos",
  position: "Vice President",
  status: "approved",
};

describe("AdminComplaints sanctions (127)", () => {
  const openFindings = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByText("Impersonation"));
    return user;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecideRpc.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue(true);
    mockVerifyPassword.mockResolvedValue(true);
  });

  it("offers exactly one sanction (radio) only when the decision is a Substantiated Grievance", async () => {
    mockUseApp.mockReturnValue(appState());
    renderPage();
    const user = await openFindings();

    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    expect(screen.getByText(/Sanction .+pick one/i)).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Verbal Warning" })).toBeInTheDocument();

    // Only ONE sanction can be picked — choosing another clears the first.
    await user.click(screen.getByRole("radio", { name: "Verbal Warning" }));
    expect(screen.getByRole("radio", { name: "Verbal Warning" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Disqualification" }));
    expect(screen.getByRole("radio", { name: "Disqualification" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Verbal Warning" })).not.toBeChecked();

    await user.selectOptions(screen.getByLabelText("Complaint decision"), "unsubstantiated");
    expect(screen.queryByText(/Sanction .+pick one/i)).toBeNull();
    expect(screen.queryByRole("radio", { name: "Verbal Warning" })).toBeNull();
  });

  it("blocks resolving a Substantiated Grievance without a sanction", async () => {
    mockUseApp.mockReturnValue(appState());
    renderPage();
    const user = await openFindings();

    await user.type(screen.getByPlaceholderText(/Explain the decision/i), "Verified by the Commission on Ethics.");
    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    await user.click(screen.getAllByRole("button", { name: "Resolved" })[1]);

    expect(
      await screen.findByText(/Select the sanction imposed for this Substantiated Grievance\./i)
    ).toBeInTheDocument();
    expect(mockDecideRpc).not.toHaveBeenCalled();
  });

  it("requires at least one candidate to be disqualified when Disqualification is imposed", async () => {
    mockUseApp.mockReturnValue(appState({ candidates: [approvedCandidate] }));
    renderPage();
    const user = await openFindings();

    await user.type(screen.getByPlaceholderText(/Explain the decision/i), "Verified by the Commission on Ethics.");
    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    await user.click(screen.getByRole("radio", { name: "Disqualification" }));
    await user.click(screen.getAllByRole("button", { name: "Resolved" })[1]);

    expect(
      await screen.findByText(/Select at least one candidate to be disqualified\./i)
    ).toBeInTheDocument();
    expect(mockDecideRpc).not.toHaveBeenCalled();
  });

  it("searches candidates and lists the checked ones who will be disqualified", async () => {
    mockUseApp.mockReturnValue(appState({ candidates: [approvedCandidate, secondCandidate] }));
    renderPage();
    const user = await openFindings();

    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    await user.click(screen.getByRole("radio", { name: "Disqualification" }));

    // The search narrows the picker by name or position.
    await user.type(screen.getByLabelText("Search candidates to disqualify"), "vice");
    expect(screen.getByRole("checkbox", { name: "Maria Santos — Vice President" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Juan Dela Cruz — President" })).toBeNull();

    await user.clear(screen.getByLabelText("Search candidates to disqualify"));
    await user.click(screen.getByRole("checkbox", { name: "Juan Dela Cruz — President" }));
    await user.click(screen.getByRole("checkbox", { name: "Maria Santos — Vice President" }));

    // The checked candidates collect in the "will be disqualified" list.
    // Each name appears twice (picker row + the checked list).
    expect(screen.getByText("Will be disqualified (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Juan Dela Cruz — President").length).toBe(2);
    expect(screen.getAllByText("Maria Santos — Vice President").length).toBe(2);

    // Removing one drops it from the checked list (the picker row remains).
    await user.click(screen.getByRole("button", { name: /remove maria santos from the disqualification/i }));
    expect(screen.getByText("Will be disqualified (1)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove maria santos from the disqualification/i })).toBeNull();
  });

  it("gates a Disqualification resolve behind the Commissioner's password and the confirmation", async () => {
    const setCandidates = vi.fn();
    mockUseApp.mockReturnValue(appState({ candidates: [approvedCandidate], setCandidates }));
    renderPage();
    const user = await openFindings();

    await user.type(screen.getByPlaceholderText(/Explain the decision/i), "Verified by the Commission on Ethics.");
    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    await user.click(screen.getByRole("radio", { name: "Disqualification" }));
    await user.click(screen.getByRole("checkbox", { name: "Juan Dela Cruz — President" }));

    // chip "Resolved" + the card's resolve control.
    await user.click(screen.getAllByRole("button", { name: "Resolved" })[1]);

    // The password gate comes FIRST, listing exactly who will be disqualified.
    const gate = await screen.findByRole("dialog", { name: "Confirm disqualification" });
    expect(within(gate).getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(within(gate).getByText(/candidate\(s\) who will be disqualified \(1\)/i)).toBeInTheDocument();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDecideRpc).not.toHaveBeenCalled();

    // Continue verifies the password, then the "Mark as Resolved?" confirm runs.
    await user.type(within(gate).getByLabelText("Grievance Commissioner password"), "grievance-secret");
    await user.click(within(gate).getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(mockVerifyPassword).toHaveBeenCalledWith("grievance-secret"));
    await waitFor(() =>
      expect(mockDecideRpc).toHaveBeenCalledWith(
        "complaint-1",
        "accepted",
        undefined,
        "Verified by the Commission on Ethics.",
        [],
        "substantiated",
        ["disqualification"],
        [{ id: "cand-1", name: "Juan Dela Cruz" }],
        "grievance-secret"
      )
    );
    // The local candidate list mirrors the server-side disqualification.
    await waitFor(() =>
      expect(setCandidates).toHaveBeenCalledWith([
        expect.objectContaining({ id: "cand-1", status: "rejected", rejectionTier: "high" }),
      ])
    );
  });

  it("keeps the password gate open and resolves nothing on a wrong password", async () => {
    mockVerifyPassword.mockRejectedValue(new Error("The Grievance Commissioner password was not accepted."));
    mockUseApp.mockReturnValue(appState({ candidates: [approvedCandidate] }));
    renderPage();
    const user = await openFindings();

    await user.type(screen.getByPlaceholderText(/Explain the decision/i), "Verified by the Commission on Ethics.");
    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    await user.click(screen.getByRole("radio", { name: "Disqualification" }));
    await user.click(screen.getByRole("checkbox", { name: "Juan Dela Cruz — President" }));
    await user.click(screen.getAllByRole("button", { name: "Resolved" })[1]);

    const gate = await screen.findByRole("dialog", { name: "Confirm disqualification" });
    await user.type(within(gate).getByLabelText("Grievance Commissioner password"), "wrong-password");
    await user.click(within(gate).getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/The Grievance Commissioner password was not accepted\./i)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Confirm disqualification" })).toBeInTheDocument();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDecideRpc).not.toHaveBeenCalled();
  });

  it("resolves a Verbal Warning grievance without the password gate", async () => {
    mockUseApp.mockReturnValue(appState({ candidates: [approvedCandidate] }));
    renderPage();
    const user = await openFindings();

    await user.type(screen.getByPlaceholderText(/Explain the decision/i), "Issued a verbal warning.");
    await user.selectOptions(screen.getByLabelText("Complaint decision"), "substantiated");
    await user.click(screen.getByRole("radio", { name: "Verbal Warning" }));
    await user.click(screen.getAllByRole("button", { name: "Resolved" })[1]);

    await waitFor(() =>
      expect(mockDecideRpc).toHaveBeenCalledWith(
        "complaint-1",
        "accepted",
        undefined,
        "Issued a verbal warning.",
        [],
        "substantiated",
        ["verbal_warning"],
        [],
        undefined
      )
    );
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("shows the imposed sanction on a resolved substantiated grievance", () => {
    mockUseApp.mockReturnValue(
      appState({
        complaints: [
          complaint({
            status: "accepted",
            findings: "Verified.",
            decision: "substantiated",
            sanctions: ["disqualification"],
            disqualifiedCandidates: [{ id: "cand-1", name: "Juan Dela Cruz" }],
          }),
        ],
      })
    );
    renderPage();

    expect(screen.getByText("Sanction(s) imposed")).toBeInTheDocument();
    expect(screen.getByText("Disqualification")).toBeInTheDocument();
    expect(screen.getByText(/Candidate\(s\) to be disqualified: Juan Dela Cruz/)).toBeInTheDocument();
  });
});
