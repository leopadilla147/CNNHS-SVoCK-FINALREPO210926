import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProclamationSummary } from "./ProclamationSummary";
import type { PositionTally } from "./ProclamationDialog";

// 117 — fixtures carry the full seat-aware shape: seats, picksNeeded,
// pickGroup, autoWinners and bothWin, exactly as groupTally derives them.
const positions: PositionTally[] = [
  {
    position: "President",
    seats: 1,
    candidates: [
      { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
      { position: "President", candidateId: "p2", candidateName: "Bea Runner", partyName: "Beta", votes: 4 },
    ],
    topVotes: 10,
    tied: [{ position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 }],
    isTie: false,
    picksNeeded: 0,
    pickGroup: [],
    autoWinners: [
      { position: "President", candidateId: "p1", candidateName: "Ada Leader", partyName: "Alpha", votes: 10 },
    ],
    bothWin: false,
  },
  {
    position: "Secretary",
    seats: 1,
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
    picksNeeded: 1,
    pickGroup: [
      { position: "Secretary", candidateId: "s1", candidateName: "Cara One", partyName: null, votes: 0 },
      { position: "Secretary", candidateId: "s2", candidateName: "Dana Two", partyName: null, votes: 0 },
    ],
    autoWinners: [],
    bothWin: false,
  },
  {
    // 117 — a 2-way Grade Level Representative tie proclaims BOTH winners
    // automatically, with no board pick and no tie-break method needed.
    position: "Grade 12 Representative",
    seats: 2,
    candidates: [
      { position: "Grade 12 Representative", candidateId: "g1", candidateName: "Ella Tied", partyName: "Alpha", votes: 7 },
      { position: "Grade 12 Representative", candidateId: "g2", candidateName: "Fe Tied", partyName: "Beta", votes: 7 },
      { position: "Grade 12 Representative", candidateId: "g3", candidateName: "Gil Third", partyName: "Gamma", votes: 1 },
    ],
    topVotes: 7,
    tied: [
      { position: "Grade 12 Representative", candidateId: "g1", candidateName: "Ella Tied", partyName: "Alpha", votes: 7 },
      { position: "Grade 12 Representative", candidateId: "g2", candidateName: "Fe Tied", partyName: "Beta", votes: 7 },
    ],
    isTie: false,
    picksNeeded: 0,
    pickGroup: [],
    autoWinners: [
      { position: "Grade 12 Representative", candidateId: "g1", candidateName: "Ella Tied", partyName: "Alpha", votes: 7 },
      { position: "Grade 12 Representative", candidateId: "g2", candidateName: "Fe Tied", partyName: "Beta", votes: 7 },
    ],
    bothWin: true,
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
        hasComplaints={false}
        tieBreakLabel=""
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={substantiated}
        otherResolved={[]}
      />,
    );

    expect(screen.getByText("Proclamation Summary")).toBeInTheDocument();
    // 117 — the default winners (President's leader + BOTH tied Grade 12
    // representatives) count; the Secretary tie without a pick does not.
    expect(screen.getByText("Winners to proclaim — 3 of 4 selected")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 winners selected")).toBeInTheDocument();
    // No names and no per-position decisions on the compact summary.
    expect(screen.queryByText("Ada Leader")).not.toBeInTheDocument();
    expect(screen.queryByText("Tie — no winner chosen yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Tie — board choice")).not.toBeInTheDocument();
    // The other recorded rows stay.  (The both-win Grade Rep tie needs no
    // resolution method, so the tie-resolution row reflects the Secretary.)
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
        resolutions={{ Secretary: { method: "manual", candidateIds: ["s1"] } }}
        hasComplaints={false}
        tieBreakLabel="Coin Toss"
        complaintNote="Weighed against the turnout record."
        complaintReason="The grievance did not change the outcome."
        complaintSubjects={["Campaigning inside the precinct"]}
        substantiated={substantiated}
        otherResolved={otherResolved}
      />,
    );

    expect(screen.getByText("Winners to proclaim — 4 of 4 selected")).toBeInTheDocument();
    expect(screen.getByText("4 of 4 winners selected")).toBeInTheDocument();
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
        hasComplaints={false}
        profiles={{
          p1: { picture: "http://example.com/ada.png", gradeLevel: "Grade 12" },
        }}
        positions={positions}
        resolutions={{ Secretary: { method: "manual", candidateIds: ["s1"] } }}
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
    // 117 — BOTH tied Grade 12 representatives appear without a pick.
    expect(screen.getByText("Ella Tied")).toBeInTheDocument();
    expect(screen.getByText("Fe Tied")).toBeInTheDocument();
    // Each card names its position.
    expect(screen.getByText("President")).toBeInTheDocument();
    expect(screen.getByText("Secretary")).toBeInTheDocument();
    // Only the board's tie pick carries the board-choice badge; the 2-way
    // Grade Rep tie is marked as both proclaimed instead.
    expect(screen.getAllByText("Tie — board choice").length).toBe(1);
    expect(screen.getAllByText("Tie — both proclaimed").length).toBe(2);
  });

  it("flags a Winner stands affirmation on the affirmed default winner", () => {
    // 117 — with a complaint on record, the board affirms the default
    // winner stands; the final confirmation carries the badge.
    render(
      <ProclamationSummary
        winnersDetail
        positions={positions}
        resolutions={{
          Secretary: { method: "manual", candidateIds: ["s1"] },
          President: { remainWinner: true },
        }}
        hasComplaints
        tieBreakLabel="Coin Toss"
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={[]}
        otherResolved={[]}
      />,
    );

    expect(screen.getByText("Winner stands")).toBeInTheDocument();
    // The affirmation never lands on a board pick.
    expect(screen.getAllByText("Tie — board choice").length).toBe(1);
  });

  it("flags the affirmation on both winners of an affirmed 2-way Grade Rep tie (122)", () => {
    // 122 — the 2-way Grade Representative tie elects both by rule, and
    // the Board's "Keep Current Winner" affirmation covers BOTH of them.
    render(
      <ProclamationSummary
        winnersDetail
        positions={positions}
        resolutions={{
          Secretary: { method: "manual", candidateIds: ["s1"] },
          "Grade 12 Representative": { remainWinner: true },
        }}
        hasComplaints
        tieBreakLabel=""
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={[]}
        otherResolved={[]}
      />,
    );

    // Both affirmed winners carry the badge — the both-win mark yields to
    // the affirmation on the sign-off, and the board pick carries none.
    expect(screen.getAllByText("Winner stands").length).toBe(2);
    expect(screen.getAllByText("Tie — board choice").length).toBe(1);
    expect(screen.queryByText("Tie — both proclaimed")).not.toBeInTheDocument();
  });

  it("lists the board's chosen winners in choice mode when the affirmation is skipped (123)", () => {
    // 123 — with a complaint on record and NO affirmation, the board
    // chooses every seat itself from any candidate; each pick reads as
    // the Board's choice, and the skipped default winners appear nowhere.
    render(
      <ProclamationSummary
        winnersDetail
        hasComplaints
        positions={positions}
        resolutions={{
          Secretary: { method: "manual", candidateIds: ["s1"] },
          President: { method: "manual", candidateIds: ["p2"] },
          "Grade 12 Representative": { method: "manual", candidateIds: ["g1", "g3"] },
        }}
        tieBreakLabel=""
        complaintNote=""
        complaintReason=""
        complaintSubjects={[]}
        substantiated={[]}
        otherResolved={[]}
      />,
    );

    // The board's picks (Bea, Ella, Gil) carry the Board's-choice tag; the
    // Secretary's tie pick stays a tie pick.
    expect(screen.getAllByText("Board's choice").length).toBe(3);
    expect(screen.getAllByText("Tie — board choice").length).toBe(1);
    expect(screen.getByText("Bea Runner")).toBeInTheDocument();
    expect(screen.getByText("Ella Tied")).toBeInTheDocument();
    expect(screen.getByText("Gil Third")).toBeInTheDocument();
    // The skipped default winners are gone — the board replaced them.
    expect(screen.queryByText("Ada Leader")).not.toBeInTheDocument();
    expect(screen.queryByText("Fe Tied")).not.toBeInTheDocument();
    expect(screen.queryByText("Winner stands")).not.toBeInTheDocument();
    expect(screen.queryByText("Tie — both proclaimed")).not.toBeInTheDocument();
  });
});
