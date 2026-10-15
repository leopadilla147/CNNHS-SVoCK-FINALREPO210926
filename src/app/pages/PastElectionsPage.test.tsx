import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PastElectionsPage from "./PastElectionsPage";
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

  it("shows an error state when the query fails", async () => {
    mockListPastElections.mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Unable to Load Past Elections" })).toBeTruthy();
    });
  });
});
