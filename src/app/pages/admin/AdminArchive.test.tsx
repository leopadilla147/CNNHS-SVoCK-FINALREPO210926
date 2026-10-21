import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminArchive from "./AdminArchive";
import type { Candidate, Complaint } from "../../context/AppContext";

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return { ...actual, useApp: () => mockUseApp() };
});

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    surname: "Dela Cruz",
    givenName: "Juan",
    gradeLevel: "12",
    position: "President",
    gender: "Male",
    dateOfBirth: "2010-05-01",
    age: 16,
    email: "juan@cnnhs.edu",
    mobileNumber: "09171234567",
    homeAddress: "Daet, Camarines Norte",
    documents: {
      applicationForm: true,
      introductoryProfile: true,
      eafFront: true,
      eafBack: true,
    },
    eafFrontImage: "https://example.supabase.co/storage/v1/object/public/candidate-documents/eaf_front_1.jpg",
    eafBackImage: "https://example.supabase.co/storage/v1/object/public/candidate-documents/eaf_back_1.jpg",
    status: "approved",
    submittedAt: "2026-01-15",
    votes: 0,
    studentId: "student-1",
    ...overrides,
  };
}

function complaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: "complaint-1",
    studentName: "Maria Santos",
    subject: "Harassment during campaign",
    description: "Two students blocked my poster setup.",
    status: "rejected",
    submittedAt: "2026-01-10",
    rejectionReason: "No evidence provided",
    resolvedAt: "2026-01-12",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminArchive />
    </MemoryRouter>,
  );
}

describe("AdminArchive pending notification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the pending banner linking to the pending-filtered Candidate Review", () => {
    mockUseApp.mockReturnValue({
      candidates: [candidate({ status: "pending" }), candidate({ id: "cand-2", status: "pending" })],
      archivedCandidates: [],
      complaints: [],
    });

    renderPage();

    expect(screen.getByText(/2 candidate application\(s\) pending review/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Review now/i });
    expect(link).toHaveAttribute("href", "/admin/candidates?filter=pending");
  });

  it("hides the banner when nothing is pending", () => {
    mockUseApp.mockReturnValue({
      candidates: [candidate()],
      archivedCandidates: [],
      complaints: [],
    });

    renderPage();

    expect(screen.queryByText(/pending review/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Review now/i })).toBeNull();
  });
});

describe("AdminArchive document preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({
      candidates: [candidate()],
      archivedCandidates: [candidate({ id: "cand-2", givenName: "Ana", surname: "Reyes", status: "approved" })],
      complaints: [complaint()],
    });
  });

  it("previews a candidacy document with its checklist and EAF photos", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText("Application - Juan Dela Cruz").closest("div.cursor-pointer") as HTMLElement;
    await user.click(row);

    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText("Juan Dela Cruz")).toBeInTheDocument();
    // every submitted document is reported as submitted, none as missing
    expect(within(modal).getAllByText("Submitted").length).toBe(4);
    expect(within(modal).queryByText("Not submitted")).toBeNull();
    expect(within(modal).getByText(/4\/4 complete/)).toBeInTheDocument();
    expect(within(modal).getByAltText("EAF Front")).toBeInTheDocument();
    expect(within(modal).getByAltText("EAF Back")).toBeInTheDocument();
  });

  it("marks missing documents in the preview instead of claiming completeness", async () => {
    mockUseApp.mockReturnValue({
      candidates: [candidate({ documents: { ...candidate().documents, introductoryProfile: false } })],
      archivedCandidates: [],
      complaints: [],
    });
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText("Application - Juan Dela Cruz").closest("div.cursor-pointer") as HTMLElement;
    await user.click(row);

    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText("Not submitted")).toBeInTheDocument();
    expect(within(modal).getByText(/3\/4 complete/)).toBeInTheDocument();
  });

  // 092: complaint records moved to the dedicated Complaints Archive —
  // this page lists candidacy documents only.
  it("keeps complaint records off the renamed Candidates Archived Document page", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Candidates Archived Document" })).toBeInTheDocument();
    expect(screen.queryByText("Harassment during campaign")).toBeNull();
    expect(screen.queryByText("Application - Juan Dela Cruz")).toBeInTheDocument();
  });

  it("closes the preview with Escape", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = screen.getByText("Application - Juan Dela Cruz").closest("div.cursor-pointer") as HTMLElement;
    await user.click(row);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    // the modal unmounts after its exit animation
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
