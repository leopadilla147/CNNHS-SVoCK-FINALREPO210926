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
      expect(screen.getByText("Tie Resolved Using Coin Toss")).toBeTruthy();
    });

    expect(
      screen.getByText(/Electoral Board note: The complaint was reviewed/),
    ).toBeTruthy();
  });

  it("labels a both-proclaimed tie and hides the highest-vote tag on tied positions", async () => {
    // 117 — a 2-way Grade-Rep tie proclaims both (no method of record), and
    // a tied candidate the Board did NOT pick must not wear "Highest vote".
    mockGetOfficialResults.mockResolvedValue({
      ...results(),
      positions: [
        {
          ...results().positions[0],
          wasTie: true,
          tieResolutionMethod: "tie_both" as const,
          candidates: [
            {
              name: "Dela Cruz, Gabriel",
              gradeLevel: "Grade 12",
              partyName: "Alpha",
              votes: 75,
              totalVotes: 150,
              isWinner: true,
              proclaimedWinner: true,
            },
            {
              name: "Santos, Adrian",
              gradeLevel: "Grade 12",
              partyName: undefined,
              votes: 75,
              totalVotes: 150,
              isWinner: true,
              proclaimedWinner: true,
            },
          ],
        },
        {
          position: "Vice President",
          votesCast: 150,
          abstentions: 5,
          wasTie: true,
          tieResolutionMethod: "manual" as const,
          tieBreakNote: "Coin Toss",
          candidates: [
            {
              name: "Reyes, Maria",
              gradeLevel: "Grade 11",
              partyName: "Beta",
              votes: 70,
              totalVotes: 150,
              isWinner: true,
              proclaimedWinner: true,
            },
            {
              name: "Cruz, Pedro",
              gradeLevel: "Grade 11",
              partyName: undefined,
              votes: 70,
              totalVotes: 150,
              isWinner: true,
              proclaimedWinner: false,
            },
          ],
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("Tie — Both Proclaimed")).toBeTruthy();
    expect(screen.getByText("Tie Resolved Using Coin Toss")).toBeTruthy();
    // The tied runner-up who lost the board's pick wears no "Highest vote".
    expect(screen.queryByText("Highest vote")).toBeNull();
  });

  it("shows the election's complaint record with click-to-reveal findings", async () => {
    mockGetOfficialResults.mockResolvedValue({
      ...results(),
      election: {
        ...results().election,
        complaintNote: "Weighed against the turnout record.",
        decisionReason: "The grievance did not change the outcome.",
        complaints: [
          {
            id: "c1",
            subject: "Vote buying",
            status: "accepted",
            decision: "substantiated",
            findings: "Ballot receipts confirmed a proxy vote.",
          },
        ],
      },
    });

    renderPage();

    // 099 — the sanitized complaint record joins the official results, but
    // the findings are not part of the public record.
    expect(
      await screen.findByText(/Substantiated grievances? on record \(1\)/),
    ).toBeTruthy();
    expect(screen.queryByText("Ballot receipts confirmed a proxy vote.")).toBeNull();
    expect(screen.queryByRole("button", { name: /Vote buying/ })).toBeNull();
    expect(
      screen.getByText(
        /Complaint Resolution and Justification: The grievance did not change the outcome\./,
      ),
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
