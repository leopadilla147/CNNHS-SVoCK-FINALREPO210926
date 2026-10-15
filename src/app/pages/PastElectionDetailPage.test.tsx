import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PastElectionDetailPage, { sortPositions } from "./PastElectionDetailPage";
import type { PastElectionPositionResult, PastElectionResults } from "../lib/supabaseData";

const { mockGetPastElectionResults } = vi.hoisted(() => ({
  mockGetPastElectionResults: vi.fn(),
}));

vi.mock("../lib/supabaseData", () => ({
  getPastElectionResults: mockGetPastElectionResults,
}));

function position(
  overrides: Partial<PastElectionPositionResult> = {}
): PastElectionPositionResult {
  return {
    position: "President",
    votesCast: 150,
    abstentions: 5,
    candidates: [
      {
        candidateId: "c-1",
        name: "Dela Cruz, Gabriel",
        gradeLevel: "Grade 12",
        partyId: "p-1",
        partyName: "Alpha",
        votes: 90,
        picture: undefined,
        isWinner: true,
        proclaimedWinner: true,
      },
      {
        candidateId: "c-2",
        name: "Santos, Adrian",
        gradeLevel: "Grade 12",
        partyId: undefined,
        partyName: undefined,
        votes: 60,
        picture: undefined,
        isWinner: false,
        proclaimedWinner: false,
      },
    ],
    ...overrides,
  };
}

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
    positions: [position()],
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/past-elections/election-1"]}>
      <Routes>
        <Route path="/past-elections/:electionId" element={<PastElectionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PastElectionDetailPage", () => {
  beforeEach(() => {
    mockGetPastElectionResults.mockReset();
  });

  it("requests results for the election id in the route", async () => {
    mockGetPastElectionResults.mockResolvedValue(results());

    renderPage();

    await waitFor(() => {
      expect(mockGetPastElectionResults).toHaveBeenCalledWith("election-1");
    });
  });

  it("renders every approved candidate tally, abstentions and the proclaimed winner", async () => {
    mockGetPastElectionResults.mockResolvedValue(results());

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dela Cruz, Gabriel" })).toBeTruthy();
    });

    expect(mockGetPastElectionResults).toHaveBeenCalledWith("election-1");
    expect(screen.getByText("Proclaimed winner")).toBeTruthy();
    expect(screen.queryByText("Highest vote")).toBeNull();
    expect(screen.getByText("Dela Cruz, Gabriel")).toBeTruthy();
    expect(screen.getByText("Santos, Adrian")).toBeTruthy();
    expect(screen.getByText("Alpha · Grade 12")).toBeTruthy();
    expect(screen.getByText("Independent · Grade 12")).toBeTruthy();
    expect(screen.getByText(/150 votes cast/)).toBeTruthy();
    expect(screen.getByText(/5 abstentions/)).toBeTruthy();
    expect(screen.getByText("2026-05-04 – 2026-05-05")).toBeTruthy();
    expect(screen.getByText("Results published and winners proclaimed.")).toBeTruthy();
  });

  it("marks a highest-vote candidate when winners were not proclaimed", async () => {
    const unproclaimed = results();
    unproclaimed.election.proclaimed = false;
    unproclaimed.election.proclaimedAt = undefined;
    unproclaimed.positions = [
      position({
        candidates: [
          {
            candidateId: "c-1",
            name: "Dela Cruz, Gabriel",
            gradeLevel: "Grade 12",
            partyName: "Alpha",
            votes: 90,
            isWinner: true,
            proclaimedWinner: false,
          },
        ],
      }),
    ];
    mockGetPastElectionResults.mockResolvedValue(unproclaimed);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Highest vote")).toBeTruthy();
    });

    expect(screen.getByText("Results published by the Electoral Board.")).toBeTruthy();
  });

  it("shows an empty state when a published election has no approved candidates", async () => {
    mockGetPastElectionResults.mockResolvedValue(
      results({
        totals: {
          positionsContested: 0,
          approvedCandidates: 0,
          votesCast: 0,
          abstentions: 0,
          totalBallots: 0,
        },
        positions: [],
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No Recorded Results" })).toBeTruthy();
    });
  });

  it("hides results that are not published", async () => {
    mockGetPastElectionResults.mockRejectedValue(new Error("Election is not published"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Results Not Available" })).toBeTruthy();
    });

    expect(screen.getByText(/either not published yet or the election does not exist/i)).toBeTruthy();
  });
});

describe("sortPositions", () => {
  it("orders known positions by precedence and keeps unknown ones last", () => {
    const sorted = sortPositions([
      position({ position: "Grade 11 Representative", candidates: [] }),
      position({ position: "Auditor", candidates: [] }),
      position({ position: "Special Position", candidates: [] }),
      position({ position: "President", candidates: [] }),
    ]);

    expect(sorted.map((entry) => entry.position)).toEqual([
      "President",
      "Auditor",
      "Grade 11 Representative",
      "Special Position",
    ]);
  });
});
