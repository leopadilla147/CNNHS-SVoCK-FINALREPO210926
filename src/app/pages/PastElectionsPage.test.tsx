import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PastElectionsPage, { sortPastElectionsByRecency } from "./PastElectionsPage";
import type { PastElectionSummary } from "../lib/supabaseData";

const { mockListPastElections } = vi.hoisted(() => ({
  mockListPastElections: vi.fn(),
}));

vi.mock("../lib/supabaseData", () => ({
  listPastElections: mockListPastElections,
}));

function election(overrides: Partial<PastElectionSummary> = {}): PastElectionSummary {
  return {
    id: "election-1",
    schoolYear: "2025-2026",
    electionDate: "2026-05-04",
    endDate: "2026-05-05",
    venue: "CNNHS Gym",
    votingMethod: "plurality",
    proclaimed: true,
    proclaimedAt: "2026-05-06T09:00:00+08:00",
    positionsContested: 13,
    approvedCandidates: 40,
    votesCast: 900,
    abstentions: 12,
    totalBallots: 912,
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <PastElectionsPage />
    </MemoryRouter>,
  );
}

describe("PastElectionsPage", () => {
  beforeEach(() => {
    mockListPastElections.mockReset();
  });

  it("lists published elections with tallies, abstentions and a proclaimed badge", async () => {
    mockListPastElections.mockResolvedValue([election()]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "2025-2026" })).toBeTruthy();
    });

    expect(screen.getByText("2026-05-04 – 2026-05-05")).toBeTruthy();
    expect(screen.getByText("CNNHS Gym")).toBeTruthy();
    expect(screen.getByText("Winners proclaimed")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View Full Results/i }).getAttribute("href")).toBe(
      "/past-elections/election-1",
    );
    expect(screen.queryByText(/unavailable to load past elections/i)).toBeNull();
  });

  it("does not mark an unpublished-proclamation election as proclaimed", async () => {
    mockListPastElections.mockResolvedValue([
      election({ id: "election-2", proclaimed: false, proclaimedAt: undefined }),
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "2025-2026" })).toBeTruthy();
    });

    expect(screen.queryByText("Winners proclaimed")).toBeNull();
  });

  it("shows an empty state when nothing has been published", async () => {
    mockListPastElections.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No Past Elections Yet" })).toBeTruthy();
    });
  });

  it("lists elections most recent first, even when the server returns them unordered", async () => {
    mockListPastElections.mockResolvedValue([
      election({ id: "oldest", electionDate: "2024-03-01" }),
      election({ id: "newest", electionDate: "2026-05-04" }),
      election({ id: "middle", electionDate: "2025-04-10" }),
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: /View Full Results/i })).toHaveLength(3);
    });

    const orderedIds = screen
      .getAllByRole("link", { name: /View Full Results/i })
      .map((link) => link.getAttribute("href"));

    expect(orderedIds).toEqual([
      "/past-elections/newest",
      "/past-elections/middle",
      "/past-elections/oldest",
    ]);
  });

  it("shows an error state when the query fails", async () => {
    mockListPastElections.mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Unable to Load Past Elections" })).toBeTruthy();
    });
  });
});

describe("sortPastElectionsByRecency", () => {
  it("orders dated elections newest first", () => {
    expect(
      sortPastElectionsByRecency([
        election({ id: "a", electionDate: "2024-03-01" }),
        election({ id: "b", electionDate: "2026-05-04" }),
        election({ id: "c", electionDate: "2025-04-10" }),
      ]).map((e) => e.id),
    ).toEqual(["b", "c", "a"]);
  });

  it("sinks elections with no date and falls back to the school year", () => {
    const ids = sortPastElectionsByRecency([
      election({ id: "no-date-old", electionDate: undefined, schoolYear: "2023-2024" }),
      election({ id: "dated", electionDate: "2024-03-01", schoolYear: "2024-2025" }),
      election({ id: "no-date-new", electionDate: undefined, schoolYear: "2025-2026" }),
    ]).map((e) => e.id);

    expect(ids).toEqual(["dated", "no-date-new", "no-date-old"]);
  });

  it("breaks a same-date tie by school year, and does not mutate the input", () => {
    const input = [
      election({ id: "older", electionDate: "2026-05-04", schoolYear: "2024-2025" }),
      election({ id: "newer", electionDate: "2026-05-04", schoolYear: "2025-2026" }),
    ];

    expect(sortPastElectionsByRecency(input).map((e) => e.id)).toEqual(["newer", "older"]);
    expect(input.map((e) => e.id)).toEqual(["older", "newer"]);
  });
});
