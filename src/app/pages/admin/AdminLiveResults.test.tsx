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
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: mockMaybeSingle,
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
  // Only isActive / resultsPublished / proclaimed are read by the page.
  return { isActive: true, resultsPublished: false, proclaimed: false, ...overrides } as ElectionPeriod;
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
          tieBreakNote: "Coin Toss",
          candidateId: "c1",
        },
      ],
      complaintNote: "The complaint was weighed before the announcement.",
    });
    render(<AdminLiveResults />);

    expect(await screen.findByText("Proclaimed winner")).toBeInTheDocument();
    expect(screen.getByText("Tie — resolved via Coin Toss")).toBeInTheDocument();
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
});
