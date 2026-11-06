import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLiveResults from "./AdminLiveResults";
import type { Candidate, Complaint, ElectionPeriod } from "../../context/AppContext";

const PERIOD_ID = "5c1a33e2-8b4d-4c1e-9a7f-1d2e3f4a5b6c";

const {
  mockRpc,
  mockMaybeSingle,
  mockGetLiveAbstainSummaryRpc,
  mockGetProclamationAnnotations,
} = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockMaybeSingle: vi.fn(),
  mockGetLiveAbstainSummaryRpc: vi.fn(),
  mockGetProclamationAnnotations: vi.fn(),
}));

// The realtime builder chain: channel().on(...).subscribe(cb).  Only the
// subscribe callback matters — it flips the "Live System" indicator.
const channel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    cb?.("SUBSCRIBED");
    return channel;
  }),
};

vi.mock("../../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: mockRpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        neq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: mockMaybeSingle,
            })),
          })),
        })),
      })),
    })),
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  },
}));

vi.mock("../../lib/supabaseData", () => ({
  getLiveAbstainSummaryRpc: mockGetLiveAbstainSummaryRpc,
  getProclamationAnnotations: mockGetProclamationAnnotations,
}));

let candidates: Candidate[];
let electionPeriod: ElectionPeriod;
let complaints: Complaint[];

vi.mock("../../context/AppContext", () => ({
  useApp: () => ({ candidates, electionPeriod, complaints }),
}));

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    id: "candidate-id",
    surname: "Doe",
    givenName: "Jane",
    gradeLevel: "Grade 10",
    position: "President",
    gender: "female",
    dateOfBirth: "2010-01-01",
    age: 16,
    email: "jane.doe@cnnhs.edu",
    mobileNumber: "09170000000",
    homeAddress: "Cebu",
    documents: { applicationForm: true },
    status: "approved",
    submittedAt: "2026-10-01T00:00:00Z",
    votes: 0,
    studentId: "student-1",
    ...overrides,
  } as Candidate;
}

function period(overrides: Partial<ElectionPeriod> = {}): ElectionPeriod {
  // The page reads the lifecycle stage via resolveStage() (129) — with the
  // isActive / resultsPublished / proclaimed booleans as the fallback.
  return {
    lifecycleStage: "voting",
    isActive: true,
    resultsPublished: false,
    proclaimed: false,
    ...overrides,
  } as ElectionPeriod;
}

function liveRow(candidateId: string, position: string, votes: number) {
  return {
    election_period_id: PERIOD_ID,
    position,
    candidate_id: candidateId,
    given_name: "Jane",
    surname: "Doe",
    party_name: null,
    votes,
  };
}

describe("AdminLiveResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    candidates = [];
    electionPeriod = period();
    complaints = [];
    mockRpc.mockResolvedValue({ data: [], error: null });
    mockMaybeSingle.mockResolvedValue({ data: { id: PERIOD_ID } });
    mockGetLiveAbstainSummaryRpc.mockResolvedValue([]);
    mockGetProclamationAnnotations.mockResolvedValue({ ties: [], complaintNote: undefined });
  });

  it("marks the current leader while the winners are not proclaimed yet", async () => {
    candidates = [candidate({ id: "c1" }), candidate({ id: "c2", givenName: "John" })];
    mockRpc.mockResolvedValue({
      data: [liveRow("c1", "President", 100), liveRow("c2", "President", 25)],
      error: null,
    });
    render(<AdminLiveResults />);

    expect(await screen.findByText("Leading")).toBeInTheDocument();
    // The runner-up is not marked as leading.
    expect(screen.queryByText("Proclaimed winner")).toBeNull();
  });

  it("stays locked before the voting stage begins", async () => {
    electionPeriod = period({ lifecycleStage: "application", isActive: false });
    render(<AdminLiveResults />);

    expect(await screen.findByText("Results Locked")).toBeInTheDocument();
    expect(screen.queryByText("Total Votes")).toBeNull();
  });

  it("stays visible once voting closes, before the results are published", async () => {
    // 129 — Close Voting moves the period to 'results' with is_active
    // false: the tallies stay readable while the board reviews.
    electionPeriod = period({ lifecycleStage: "results", isActive: false });
    candidates = [candidate({ id: "c1" }), candidate({ id: "c2", givenName: "John" })];
    mockRpc.mockResolvedValue({
      data: [liveRow("c1", "President", 100), liveRow("c2", "President", 25)],
      error: null,
    });
    render(<AdminLiveResults />);

    expect(screen.queryByText("Results Locked")).toBeNull();
    expect(await screen.findByText("Total Votes")).toBeInTheDocument();
    expect(screen.getByText("125")).toBeInTheDocument();
    expect(screen.getByText("Vote counting has ended")).toBeInTheDocument();
  });

  it("stays visible after a Void Election — voting paused with the tallies reset", async () => {
    // 129 — Void returns the same period to 'voting' (paused) after
    // deleting its votes: the page stays up and every count reads 0.
    electionPeriod = period({ lifecycleStage: "voting", isActive: false });
    candidates = [candidate({ id: "c1" }), candidate({ id: "c2", givenName: "John" })];
    mockRpc.mockResolvedValue({ data: [], error: null });
    render(<AdminLiveResults />);

    expect(screen.queryByText("Results Locked")).toBeNull();
    expect(await screen.findByText("President")).toBeInTheDocument();
    expect(screen.getByText(/0 votes 0 abstains/)).toBeInTheDocument();
    expect(screen.getByText("Voting is paused")).toBeInTheDocument();
  });

  it("does not dress tied candidates as leaders before the winners are proclaimed", async () => {
    // 129 — a tie at the top is unresolved until Result and Proclaim
    // Winners: no trophy, no amber, no Leading badge on the tied pair.
    candidates = [candidate({ id: "c1" }), candidate({ id: "c2", givenName: "John" })];
    mockRpc.mockResolvedValue({
      data: [liveRow("c1", "President", 50), liveRow("c2", "President", 50)],
      error: null,
    });
    render(<AdminLiveResults />);

    await screen.findByText("President");
    expect(screen.queryByText("Leading")).toBeNull();
    expect(screen.queryByText(/Tie resolved/)).toBeNull();
    expect(screen.queryByText("Proclaimed winner")).toBeNull();
  });

  it("names the recorded resolution method and the both-proclaimed tie", async () => {
    // 129 — a board-picked tie reads "Tie Resolved By Electoral Board Using {method}", while a
    // 2-way Grade-Rep tie proclaimed both has no method of record.
    electionPeriod = period({ proclaimed: true });
    candidates = [
      candidate({ id: "c1" }),
      candidate({ id: "c2", givenName: "John", position: "Grade 10 Representative" }),
    ];
    mockRpc.mockResolvedValue({
      data: [liveRow("c1", "President", 50), liveRow("c2", "Grade 10 Representative", 30)],
      error: null,
    });
    mockGetProclamationAnnotations.mockResolvedValue({
      ties: [
        {
          position: "President",
          wasTie: true,
          resolutionMethod: "manual" as const,
          tieBreakNote: "Draw Lots",
          candidateId: "c1",
        },
        {
          position: "Grade 10 Representative",
          wasTie: true,
          resolutionMethod: "tie_both" as const,
          candidateId: "c2",
        },
      ],
    });
    render(<AdminLiveResults />);

    expect(await screen.findByText("Tie Resolved By Electoral Board Using Draw Lots")).toBeInTheDocument();
    expect(screen.getByText("Tie — Both Proclaimed")).toBeInTheDocument();
  });

  it("reveals the complaint sanctions with the findings", async () => {
    electionPeriod = period({ id: PERIOD_ID });
    complaints = [
      {
        id: "c1",
        subject: "Vote buying",
        description: "desc",
        status: "accepted",
        decision: "substantiated",
        findings: "Ballot receipts confirmed a proxy vote.",
        sanctions: ["disqualification"],
        disqualifiedCandidates: [{ id: "cand-1", name: "Jane Doe" }],
        electionPeriodId: PERIOD_ID,
      },
    ] as Complaint[];
    render(<AdminLiveResults />);

    expect(
      await screen.findByText(/Substantiated grievances? on record \(1\)/),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Vote buying/ }));
    expect(screen.getByText("Sanction(s) imposed")).toBeInTheDocument();
    expect(screen.getByText("Disqualification")).toBeInTheDocument();
    expect(
      screen.getByText(/Candidate\(s\) to be disqualified: Jane Doe/),
    ).toBeInTheDocument();
  });

  it("shows the proclaimed winner, the tie badge and the complaint note after proclaiming", async () => {
    electionPeriod = period({ proclaimed: true });
    candidates = [candidate({ id: "c1" }), candidate({ id: "c2", givenName: "John" })];
    mockRpc.mockResolvedValue({
      data: [liveRow("c1", "President", 50), liveRow("c2", "President", 50)],
      error: null,
    });
    mockGetProclamationAnnotations.mockResolvedValue({
      ties: [
        {
          position: "President",
          wasTie: true,
          resolutionMethod: "manual" as const,
          tieBreakNote: "Coin Toss",
          candidateId: "c1",
        },
      ],
      complaintNote: "The complaint was weighed before the announcement.",
    });
    render(<AdminLiveResults />);

    expect(await screen.findByText("Proclaimed winner")).toBeInTheDocument();
    expect(screen.getByText("Tie Resolved By Electoral Board Using Coin Toss")).toBeInTheDocument();
    expect(
      screen.getByText(/Electoral Board note: The complaint was weighed/),
    ).toBeInTheDocument();
    // With the proclamation on record, the live "Leading" badge is replaced.
    expect(screen.queryByText("Leading")).toBeNull();
  });

  it("shows the election's complaint record with click-to-reveal findings", async () => {
    electionPeriod = period({ id: PERIOD_ID });
    complaints = [
      {
        id: "c1",
        subject: "Vote buying",
        description: "desc",
        status: "accepted",
        decision: "substantiated",
        findings: "Ballot receipts confirmed a proxy vote.",
        electionPeriodId: PERIOD_ID,
      },
      {
        id: "c2",
        subject: "Campaigning inside the precinct",
        description: "desc",
        status: "filed",
        electionPeriodId: PERIOD_ID,
      },
    ] as Complaint[];
    mockGetProclamationAnnotations.mockResolvedValue({
      ties: [],
      decisionReason: "The grievance did not change the outcome.",
    });
    render(<AdminLiveResults />);

    // Substantiated grievance on record — findings hidden until clicked.
    expect(
      await screen.findByText(/Substantiated grievances? on record \(1\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ballot receipts confirmed a proxy vote.")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Vote buying/ }));
    expect(screen.getByText("Ballot receipts confirmed a proxy vote.")).toBeInTheDocument();

    // The still-filed complaint is flagged, and the Board's reason is shown.
    expect(screen.getByText(/1 complaint is still on file/)).toBeInTheDocument();
    expect(
      screen.getByText(/Complaint Reason: The grievance did not change the outcome\./),
    ).toBeInTheDocument();
  });

  it("shows the abstain count beside the per-position vote count", async () => {
    candidates = [candidate({ id: "c1" }), candidate({ id: "c2", givenName: "John" })];
    mockRpc.mockResolvedValue({
      data: [liveRow("c1", "President", 100), liveRow("c2", "President", 25)],
      error: null,
    });
    mockGetLiveAbstainSummaryRpc.mockResolvedValue([
      { election_period_id: PERIOD_ID, position: "President", abstain_count: 3 },
    ]);
    render(<AdminLiveResults />);

    const card = await screen.findByText("President");
    expect(within(card.closest("div")!).getByText(/125 votes 3 abstains/)).toBeInTheDocument();
  });

  it("shows zero abstains for positions that have none", async () => {
    candidates = [candidate({ id: "c1" })];
    mockRpc.mockResolvedValue({ data: [liveRow("c1", "President", 100)], error: null });
    mockGetLiveAbstainSummaryRpc.mockResolvedValue([]);
    render(<AdminLiveResults />);

    await screen.findByText("President");
    await waitFor(() => {
      expect(screen.getByText(/100 votes 0 abstains/)).toBeInTheDocument();
    });
  });

  it("shows the total votes across every position in the header", async () => {
    candidates = [
      candidate({ id: "c1" }),
      candidate({ id: "c2", givenName: "John" }),
      candidate({ id: "c3", position: "Vice President", givenName: "Max" }),
    ];
    mockRpc.mockResolvedValue({
      data: [
        liveRow("c1", "President", 100),
        liveRow("c2", "President", 25),
        liveRow("c3", "Vice President", 10),
      ],
      error: null,
    });
    mockGetLiveAbstainSummaryRpc.mockResolvedValue([
      { election_period_id: PERIOD_ID, position: "President", abstain_count: 3 },
      { election_period_id: PERIOD_ID, position: "Vice President", abstain_count: 2 },
    ]);
    render(<AdminLiveResults />);

    // 100 + 25 + 10 candidate votes; abstains are excluded from the total.
    await waitFor(() => {
      expect(screen.getByText("Total Votes")).toBeInTheDocument();
      expect(screen.getByText("135")).toBeInTheDocument();
    });
  });

  it("shows the total abstain count across every position in the header", async () => {
    candidates = [
      candidate({ id: "c1" }),
      candidate({ id: "c2", givenName: "John" }),
      candidate({ id: "c3", position: "Vice President", givenName: "Max" }),
    ];
    mockRpc.mockResolvedValue({
      data: [
        liveRow("c1", "President", 100),
        liveRow("c2", "President", 25),
        liveRow("c3", "Vice President", 10),
      ],
      error: null,
    });
    mockGetLiveAbstainSummaryRpc.mockResolvedValue([
      { election_period_id: PERIOD_ID, position: "President", abstain_count: 3 },
      { election_period_id: PERIOD_ID, position: "Vice President", abstain_count: 2 },
    ]);
    render(<AdminLiveResults />);

    // 3 + 2 abstains across both positions, shown beside the vote total.
    await waitFor(() => {
      expect(screen.getByText("Total Abstains")).toBeInTheDocument();
    });
    const abstainBlock = screen.getByText("Total Abstains").parentElement!;
    expect(within(abstainBlock).getByText("5")).toBeInTheDocument();
  });
});
