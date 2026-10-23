import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminComplaints from "./AdminComplaints";
import type { Complaint } from "../../context/AppContext";

const { mockUseApp, mockSaveForm } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockSaveForm: vi.fn(),
}));

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return { ...actual, useApp: () => mockUseApp() };
});

vi.mock("../../lib/supabaseData", () => ({
  decideComplaintRpc: vi.fn(),
  uploadComplaintEvidence: vi.fn(),
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
