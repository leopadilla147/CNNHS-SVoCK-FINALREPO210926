import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OfficialResultsPage from "./OfficialResultsPage";
import type { PastElectionResults } from "../lib/supabaseData";

const { mockGetOfficialResults } = vi.hoisted(() => ({
  mockGetOfficialResults: vi.fn(),
}));

vi.mock("../lib/supabaseData", () => ({
  getOfficialResults: mockGetOfficialResults,
}));

function results(overrides: Partial<PastElectionResults> = {}): PastElectionResults {
  return {
    election: {
      id: "election-1",
      schoolYear: "2025-2026",
      electionDate: "2026-05-04",
      endDate: "2026-05-05",
      venue: "CNNHS Gym",
      votingMethod: "plurality",
      proclaimed: true,
      proclaimedAt: "2026-05-06T09:00:00+08:00",
    },
    totals: {
      positionsContested: 1,
      approvedCandidates: 2,
      votesCast: 150,
      abstentions: 5,
      totalBallots: 155,
    },
    positions: [
      {
        position: "President",
        votesCast: 150,
        abstentions: 5,
        candidates: [
          {
            name: "Dela Cruz, Gabriel",
            gradeLevel: "Grade 12",
            partyName: "Alpha",
            votes: 90,
            totalVotes: 150,
            isWinner: true,
            proclaimedWinner: true,
          },
          {
            name: "Santos, Adrian",
            gradeLevel: "Grade 12",
            partyName: undefined,
            votes: 60,
            totalVotes: 150,
            isWinner: false,
            proclaimedWinner: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <OfficialResultsPage />
    </MemoryRouter>,
  );
}

describe("OfficialResultsPage", () => {
  beforeEach(() => {
    mockGetOfficialResults.mockReset();
  });

  it("renders the current election's official results", async () => {
    mockGetOfficialResults.mockResolvedValue(results());

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "2025-2026" })).toBeTruthy();
    });

    expect(screen.getByText("Official results")).toBeTruthy();
    expect(screen.getByText("Proclaimed winner")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dela Cruz, Gabriel" })).toBeTruthy();
    expect(screen.getByText("Alpha · Grade 12")).toBeTruthy();
    expect(screen.getByText(/150 votes cast/)).toBeTruthy();
    expect(screen.getByText("Results published and winners proclaimed.")).toBeTruthy();
    expect(screen.queryByText(/No Official Results Yet/i)).toBeNull();
  });

  it("marks a tied position and shows the complaint note on the record", async () => {
    mockGetOfficialResults.mockResolvedValue({
      ...results(),
      election: {
        ...results().election,
        complaintNote: "The complaint was reviewed and weighed before the announcement.",
      },
      positions: [
        {
          ...results().positions[0],
          wasTie: true,
          tieBreakNote: "Coin Toss",
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Tie — resolved via Coin Toss")).toBeTruthy();
    });

    expect(screen.getByText("A complaint was on record for this election.")).toBeTruthy();
    expect(
      screen.getByText(/Electoral Board note: The complaint was reviewed/),
    ).toBeTruthy();
  });

  it("shows a friendly empty state when nothing is published yet", async () => {
    mockGetOfficialResults.mockResolvedValue(null);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No Official Results Yet" })).toBeTruthy();
    });

    expect(screen.getByRole("link", { name: /Past Elections/i })).toBeTruthy();
  });

  it("shows an error state when the query fails", async () => {
    mockGetOfficialResults.mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Unable to Load Official Results" })).toBeTruthy();
    });
  });
});
