import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CurrentElectionPage, { groupCandidatesByParty } from "./CurrentElectionPage";
import type { PublicCurrentCandidate, PublicCurrentElection } from "../lib/supabaseData";

const { mockGetCurrentPublicElection } = vi.hoisted(() => ({
  mockGetCurrentPublicElection: vi.fn(),
}));

vi.mock("../lib/supabaseData", () => ({
  getCurrentPublicElection: mockGetCurrentPublicElection,
}));

function candidate(overrides: Partial<PublicCurrentCandidate> = {}): PublicCurrentCandidate {
  return {
    id: "candidate-1",
    name: "Candidate One",
    position: "President",
    gradeLevel: "12",
    partyAffiliation: "Alpha",
    ...overrides,
  };
}

function election(overrides: Partial<PublicCurrentElection> = {}): PublicCurrentElection {
  return {
    id: "election-1",
    stage: "voting",
    electionDate: "2026-09-25",
    startTime: "08:00",
    endDate: "2026-09-25",
    endTime: "18:00",
    venue: "CNNHS Gym",
    votingMethod: "plurality",
    candidates: [],
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <CurrentElectionPage />
    </MemoryRouter>,
  );
}

describe("CurrentElectionPage", () => {
  beforeEach(() => {
    mockGetCurrentPublicElection.mockReset();
  });

  it("shows no current election when no active election exists", async () => {
    mockGetCurrentPublicElection.mockResolvedValue(null);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No Current Election" })).toBeTruthy();
    });
  });

  it("groups active approved candidates by party", async () => {
    mockGetCurrentPublicElection.mockResolvedValue(
      election({
        candidates: [
          candidate(),
          candidate({ id: "candidate-2", name: "Candidate Two", partyAffiliation: "Beta" }),
          candidate({ id: "candidate-3", name: "Candidate Three", partyAffiliation: undefined }),
        ],
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Independent" })).toBeTruthy();
    });

    expect(screen.getByText("Candidate One")).toBeTruthy();
    expect(screen.getByText("Candidate Two")).toBeTruthy();
    expect(screen.getByText("Candidate Three")).toBeTruthy();
    expect(screen.queryByText(/votes/i)).toBeNull();
  });

  it("shows an active election with no approved candidates", async () => {
    mockGetCurrentPublicElection.mockResolvedValue(election());

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No Approved Candidates Yet" })).toBeTruthy();
    });
  });

  it("publicizes the approved slate during the campaign stage", async () => {
    mockGetCurrentPublicElection.mockResolvedValue(
      election({ stage: "campaign", candidates: [candidate()] }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Campaign period")).toBeTruthy();
      expect(screen.getByText("Candidate One")).toBeTruthy();
    });
  });

  it("keeps the voting badge while voting is in progress", async () => {
    mockGetCurrentPublicElection.mockResolvedValue(election());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Voting in progress")).toBeTruthy();
    });
  });

  it.each([
    ["fingerprint_registration", "Fingerprint Registration"],
    ["results", "Voting concluded"],
  ] as const)("shows the %s stage badge", async (stage, label) => {
    mockGetCurrentPublicElection.mockResolvedValue(election({ stage }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(label)).toBeTruthy();
    });
  });

  it("announces the underway election during the Application of Candidacy stage", async () => {
    mockGetCurrentPublicElection.mockResolvedValue(
      election({ stage: "application", candidates: [candidate()] }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("The election is underway")).toBeTruthy();
      expect(screen.getByText("Current stage: Application of Candidacy")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Application of Candidacy" })).toBeTruthy();
    });

    // Stage 1 publicizes the period only — the slate stays hidden.
    expect(screen.queryByText("Candidate One")).toBeNull();
    expect(screen.queryByRole("heading", { name: "No Current Election" })).toBeNull();
  });

  it("shows an error state when the election query fails", async () => {
    mockGetCurrentPublicElection.mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Unable to Load Current Election" })).toBeTruthy();
    });
  });
});

describe("groupCandidatesByParty", () => {
  it("groups independents separately and sorts positions within each party", () => {
    const groups = groupCandidatesByParty([
      candidate({ id: "secretary", name: "Alpha Secretary", position: "Secretary" }),
      candidate({ id: "president", name: "Alpha President", position: "President" }),
      candidate({ id: "independent", name: "Independent Candidate", partyAffiliation: undefined }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Alpha", "Independent"]);
    expect(groups[0].candidates.map((entry) => entry.position)).toEqual(["President", "Secretary"]);
  });
});
