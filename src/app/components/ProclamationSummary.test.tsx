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

const otherResolved = [
  { id: "c2", subject: "Late filing", decisionLabel: "Unsubstantiated Grievance" },
];

describe("ProclamationSummary", () => {
  it("shows only the number of selected winners at the bottom of the review", () => {
    // 113b — the review dialog's bottom summary is a count, not a name
    // list: the tally sections above already name every candidate.
    render(
      <ProclamationSummary
        positions={positions}
        resolutions={{}}
        tieBreakLabel=""
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={substantiated}
        otherResolved={[]}
      />,
    );

    expect(screen.getByText("Proclamation Summary")).toBeInTheDocument();
    // The clean win counts; the tie without a pick does not yet.
    expect(screen.getByText("Winners to proclaim — 1 of 2 selected")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 winners selected")).toBeInTheDocument();
    // No names and no per-position decisions on the compact summary.
    expect(screen.queryByText("Ada Leader")).not.toBeInTheDocument();
    expect(screen.queryByText("Tie — no winner chosen yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Tie — board choice")).not.toBeInTheDocument();
    // The other recorded rows stay.
    expect(screen.getByText(/Tie resolution:/)).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded yet").length).toBeGreaterThan(0);
    expect(screen.getByText(/Complaint Resolution and Justification:/)).toBeInTheDocument();
    expect(screen.getByText(/Substantiated grievance on record:/)).toBeInTheDocument();
    expect(screen.getByText(/Vote buying/)).toBeInTheDocument();
  });

  it("counts the board's resolved ties once they are made", () => {
    render(
      <ProclamationSummary
        positions={positions}
        resolutions={{ Secretary: { method: "manual", candidateId: "s1" } }}
        tieBreakLabel="Coin Toss"
        complaintNote="Weighed against the turnout record."
        complaintReason="The grievance did not change the outcome."
        complaintSubjects={["Campaigning inside the precinct"]}
        substantiated={substantiated}
        otherResolved={otherResolved}
      />,
    );

    expect(screen.getByText("Winners to proclaim — 2 of 2 selected")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 winners selected")).toBeInTheDocument();
    expect(screen.getByText("Coin Toss")).toBeInTheDocument();
    expect(screen.getByText(/The grievance did not change the outcome\./)).toBeInTheDocument();
    expect(screen.getByText(/Weighed against the turnout record\./)).toBeInTheDocument();
    // 114 — the Unsubstantiated / Dismissed decisions are on the summary too.
    expect(screen.getByText(/Complaint decisions? on record:/)).toBeInTheDocument();
    expect(screen.getByText(/Late filing \(Unsubstantiated Grievance\)/)).toBeInTheDocument();
    expect(screen.queryByText("Not recorded yet")).not.toBeInTheDocument();
  });

  it("lists each selected winner with picture, name and position in the final confirmation", () => {
    // 113b — the final confirmation spells out exactly who is about to be
    // proclaimed: picture, name and position, tie picks flagged.
    render(
      <ProclamationSummary
        winnersDetail
        profiles={{
          p1: { picture: "http://example.com/ada.png", gradeLevel: "Grade 12" },
        }}
        positions={positions}
        resolutions={{ Secretary: { method: "manual", candidateId: "s1" } }}
        tieBreakLabel="Coin Toss"
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={[]}
        otherResolved={[]}
      />,
    );

    // Ada's submitted photo joins her card; Cara without a profile falls
    // back to the generic avatar (no image element).
    expect(screen.getByRole("img", { name: "Ada Leader" })).toHaveAttribute(
      "src",
      "http://example.com/ada.png",
    );
    expect(screen.queryByRole("img", { name: "Cara One" })).not.toBeInTheDocument();
    expect(screen.getByText("Ada Leader")).toBeInTheDocument();
    expect(screen.getByText("Cara One")).toBeInTheDocument();
    // Each card names its position.
    expect(screen.getByText("President")).toBeInTheDocument();
    expect(screen.getByText("Secretary")).toBeInTheDocument();
    // Only the board's tie pick carries the badge; the clean win does not.
    expect(screen.getAllByText("Tie — board choice").length).toBe(1);
  });
});
