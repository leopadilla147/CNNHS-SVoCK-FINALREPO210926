import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminComplaintsArchive from "./AdminComplaintsArchive";
import type { Complaint } from "../../context/AppContext";

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return { ...actual, useApp: () => mockUseApp() };
});

vi.mock("../../lib/supabaseData", () => ({
  listElectionPeriodLabels: vi.fn(async () => ({ "ep-1": "2025-2026", "ep-2": "2024-2025" })),
}));

function complaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: "complaint-1",
    studentName: "Maria Santos",
    subject: "Harassment during campaign",
    description: "Two students blocked my poster setup.",
    status: "filed",
    submittedAt: "2026-01-10",
    ...overrides,
  };
}

const allComplaints = (): Complaint[] => [
  complaint({ electionPeriodId: "ep-1" }),
  complaint({
    id: "complaint-2",
    studentName: "Juan Dela Cruz",
    subject: "Vote buying at precinct 4",
    status: "accepted",
    findings: "The evidence was verified and the incident confirmed.",
    resolvedAt: "2026-01-12",
    resolvedByName: "Atty. Maria Luna",
    electionPeriodId: "ep-2",
  }),
];

describe("AdminComplaintsArchive", () => {
  beforeEach(() => vi.clearAllMocks());

  // 092: no election-period restriction — complaints from EVERY election
  // are listed, each labelled with the school year it was filed under.
  it("lists complaints from every election with their school year", async () => {
    mockUseApp.mockReturnValue({ complaints: allComplaints() });
    render(<AdminComplaintsArchive />);

    await waitFor(() => expect(screen.getByText("Vote buying at precinct 4")).toBeInTheDocument());
    expect(screen.getByText("Harassment during campaign")).toBeInTheDocument();
    expect(screen.getByText(/2024-2025/)).toBeInTheDocument();
    expect(screen.getByText(/2025-2026/)).toBeInTheDocument();
  });

  it("shows totals for every complaint ever filed, not the live election only", () => {
    mockUseApp.mockReturnValue({ complaints: allComplaints() });
    render(<AdminComplaintsArchive />);

    const statsGrid = screen.getByText("Total").closest("div.grid") as HTMLElement;
    expect(within(statsGrid).getByText("2")).toBeInTheDocument();
    // one filed + one resolved across the two elections
    expect(within(statsGrid).getAllByText("1")).toHaveLength(2);
  });

  it("filters by status chips", async () => {
    const user = userEvent.setup();
    mockUseApp.mockReturnValue({ complaints: allComplaints() });
    render(<AdminComplaintsArchive />);

    await user.click(screen.getByRole("button", { name: "Resolved" }));
    expect(screen.queryByText("Harassment during campaign")).toBeNull();
    expect(screen.getByText("Vote buying at precinct 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filed" }));
    expect(screen.getByText("Harassment during campaign")).toBeInTheDocument();
    expect(screen.queryByText("Vote buying at precinct 4")).toBeNull();
  });

  it("previews a complaint with its findings and the deciding Commissioner", async () => {
    const user = userEvent.setup();
    mockUseApp.mockReturnValue({ complaints: allComplaints() });
    render(<AdminComplaintsArchive />);

    const row = screen.getByText("Vote buying at precinct 4").closest("div.cursor-pointer") as HTMLElement;
    await user.click(row);

    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText("Findings")).toBeInTheDocument();
    expect(within(modal).getByText(/evidence was verified/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Atty\. Maria Luna/)).toBeInTheDocument();
  });

  it("keeps the response letter student-only — no download control on the archive", async () => {
    const user = userEvent.setup();
    mockUseApp.mockReturnValue({ complaints: allComplaints() });
    render(<AdminComplaintsArchive />);

    const row = screen.getByText("Vote buying at precinct 4").closest("div.cursor-pointer") as HTMLElement;
    await user.click(row);

    const modal = screen.getByRole("dialog");
    expect(within(modal).queryByTitle("Download")).toBeNull();
    expect(within(modal).queryByRole("button", { name: /download/i })).toBeNull();
  });
});
