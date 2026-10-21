import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScreeningDashboard from "./ScreeningDashboard";
import type { Candidate } from "../../../context/AppContext";

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../../context/AppContext")>("../../../context/AppContext");
  return { ...actual, useApp: () => mockUseApp() };
});

function candidate(status: Candidate["status"], id: string): Candidate {
  return {
    id,
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
    },
    status,
    submittedAt: "2026-01-15",
    votes: 0,
    studentId: `student-${id}`,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ScreeningDashboard />
    </MemoryRouter>,
  );
}

describe("ScreeningDashboard stat cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({
      candidates: [
        candidate("pending", "1"),
        candidate("pending", "2"),
        candidate("approved", "3"),
      ],
      electionPeriod: { candidacyOpen: true },
      currentUser: { name: "Screening Commissioner" },
    });
  });

  it("sends the Pending card to Candidate Review pre-filtered to pending", () => {
    renderPage();

    // the card is wrapped in its link, so assert on the anchor around the label
    const pendingCard = screen.getByText("Pending Review").closest("a");
    expect(pendingCard).toHaveAttribute("href", "/admin/candidates?filter=pending");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("sends the Approved card to Candidate Review pre-filtered to approved", () => {
    renderPage();

    const approvedCard = screen.getByText("Approved").closest("a");
    expect(approvedCard).toHaveAttribute("href", "/admin/candidates?filter=approved");
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("sends the Total Applications card to unfiltered Candidate Review", () => {
    renderPage();

    const totalCard = screen.getByText("Total Applications").closest("a");
    expect(totalCard).toHaveAttribute("href", "/admin/candidates");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("makes the pending banner itself jump to the pending queue", () => {
    renderPage();

    const banner = screen.getByText(/candidate application\(s\) pending your review/).closest("a");
    expect(banner).toHaveAttribute("href", "/admin/candidates?filter=pending");
  });
});
