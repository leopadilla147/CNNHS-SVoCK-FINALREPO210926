import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProclamationSummary } from "./ProclamationSummary";
import type { PositionTally } from "./ProclamationDialog";

const positions: PositionTally[] = [
  {
    position: "President",
    candidates: [
      { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
      { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
    ],
    topVotes: 10,
    tied: [],
    isTie: false,
  },
  {
    position: "Secretary",
    candidates: [
      { position: "Secretary", candidateId: "s1", candidateName: "Cara One", partyName: null, votes: 0 },
      { position: "Secretary", candidateId: "s2", candidateName: "Dana Two", partyName: null, votes: 0 },
    ],
    topVotes: 0,
    tied: [
      { position: "Secretary", candidateId: "s1", candidateName: "Cara One", partyName: null, votes: 0 },
      { position: "Secretary", candidateId: "s2", candidateName: "Dana Two", partyName: null, votes: 0 },
    ],
    isTie: true,
  },
];

const substantiated = [
  { id: "c1", subject: "Vote buying", findings: "Ballot receipts confirmed a proxy vote." },
];

describe("ProclamationSummary", () => {
  it("lists every position with its winner and flags decisions not yet made", () => {
    render(
      <ProclamationSummary
        positions={positions}
        resolutions={{}}
        tieBreakLabel=""
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={substantiated}
      />,
    );

    expect(screen.getByText("Proclamation Summary")).toBeInTheDocument();
    // Clean win straight from the tally.
    expect(screen.getByText("President:")).toBeInTheDocument();
    expect(screen.getByText("Ada Leader")).toBeInTheDocument();
    // The tie has no pick yet — flagged, not hidden.
    expect(screen.getByText("Tie — no winner chosen yet")).toBeInTheDocument();
    expect(screen.getByText("Tie resolution:")).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded yet").length).toBeGreaterThan(0);
    // 097 — the owed Complaint Reason is on the summary too.
    expect(screen.getByText("Complaint Reason:")).toBeInTheDocument();
    expect(screen.getByText(/Substantiated grievance on record:/)).toBeInTheDocument();
    expect(screen.getByText(/Vote buying/)).toBeInTheDocument();
  });

  it("reflects the board's recorded decisions once they are made", () => {
    render(
      <ProclamationSummary
        positions={positions}
        resolutions={{ Secretary: { method: "manual", candidateId: "s1" } }}
        tieBreakLabel="Coin Toss"
        complaintNote="Weighed against the turnout record."
        complaintReason="The grievance did not change the outcome."
        complaintSubjects={["Campaigning inside the precinct"]}
        substantiated={substantiated}
      />,
    );

    expect(screen.getByText("Tie — board choice")).toBeInTheDocument();
    expect(screen.getByText("Cara One")).toBeInTheDocument();
    expect(screen.getByText("Coin Toss")).toBeInTheDocument();
    expect(screen.getByText(/The grievance did not change the outcome\./)).toBeInTheDocument();
    expect(screen.getByText(/Weighed against the turnout record\./)).toBeInTheDocument();
    expect(screen.queryByText("Not recorded yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Tie — no winner chosen yet")).not.toBeInTheDocument();
  });
});
