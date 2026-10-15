import { describe, expect, it } from "vitest";
import {
  buildPartyOptions,
  buildPartyPositionBoard,
  candidatesInLivePeriod,
  isInPartyRace,
  isPartyFounder,
  isPartyPositionOpen,
  isPartyFullForGrade,
  isSeatSelectable,
  isSeatWinner,
  livePeriodId,
  livePeriodPartyId,
  livePeriodPartyNames,
  partyApprovalBlockForSubmit,
  partySeatSummaries,
} from "../partyScope";
import type { Candidate, ElectionPeriod } from "../../context/AppContext";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "c-1",
    studentId: "s-1",
    surname: "Dela Cruz",
    givenName: "Gabriel",
    gradeLevel: "Grade 12",
    position: "President",
    partyAffiliation: "Alpha",
    partyId: "p-alpha",
    gender: "Male",
    dateOfBirth: "2008-01-01",
    age: 17,
    email: "g@example.test",
    mobileNumber: "09",
    homeAddress: "Daet",
    documents: {
      applicationForm: true,
      introductoryProfile: true,
      screeningForm: true,
      reportCard: true,
      goodMoralCert: true,
    },
    positionApprovalStatus: "notRequired",
    status: "approved",
    submittedAt: "2026-05-01",
    votes: 0,
    electionPeriodId: "period-live",
    ...overrides,
  };
}

function period(overrides: Partial<ElectionPeriod> = {}): ElectionPeriod {
  return {
    id: "period-live",
    startDate: "2026-05-04",
    startTime: "08:00",
    endDate: "2026-05-04",
    endTime: "18:00",
    isActive: true,
    ...overrides,
  };
}

describe("candidatesInLivePeriod", () => {
  it("keeps only the live period's candidacies", () => {
    const rows = [
      candidate({ id: "live", electionPeriodId: "period-live" }),
      candidate({ id: "past", electionPeriodId: "period-past", partyAffiliation: "Alpha" }),
    ];

    expect(candidatesInLivePeriod(rows, period()).map((c) => c.id)).toEqual(["live"]);
  });

  it("keeps legacy rows with no period so a fresh install still works", () => {
    const rows = [candidate({ id: "legacy", electionPeriodId: undefined })];

    expect(candidatesInLivePeriod(rows, period()).map((c) => c.id)).toEqual(["legacy"]);
  });

  it("returns every row when the live period has no id", () => {
    const rows = [
      candidate({ id: "a", electionPeriodId: "period-past" }),
      candidate({ id: "b", electionPeriodId: "period-live" }),
    ];

    expect(candidatesInLivePeriod(rows, period({ id: undefined }))).toHaveLength(2);
  });

  it("still scopes by id when the period is closed, because isActive is not the period", () => {
    // 058: isActive only means "voting is open" and is false through the whole
    // application and campaign stages. Keying the filter off it made every
    // candidate row in the database visible at once, which only stayed
    // harmless while a single election existed.
    const rows = [
      candidate({ id: "live", electionPeriodId: "period-live" }),
      candidate({ id: "past", electionPeriodId: "period-past" }),
    ];
    const closed = period({ isActive: false });

    expect(livePeriodId(closed)).toBe("period-live");
    expect(candidatesInLivePeriod(rows, closed).map((c) => c.id)).toEqual(["live"]);
  });
});

describe("livePeriodPartyNames", () => {
  const rows = [
    candidate({ id: "live-a", partyAffiliation: "Alpha" }),
    candidate({ id: "live-b", partyAffiliation: "Beta" }),
    candidate({ id: "past-a", partyAffiliation: "Alpha", electionPeriodId: "period-past" }),
    candidate({ id: "past-c", partyAffiliation: "Gamma", electionPeriodId: "period-past" }),
  ];

  it("offers each party of the live period once, sorted", () => {
    expect(livePeriodPartyNames(rows, period())).toEqual(["Alpha", "Beta"]);
  });

  it("only offers parties whose President cleared Screening", () => {
    const mixed = [
      // Alpha: approved President -> joinable.
      candidate({ id: "1", partyAffiliation: "Alpha", position: "President", status: "approved" }),
      // Beta: President still pending -> not yet a real slate.
      candidate({ id: "2", partyAffiliation: "Beta", position: "President", status: "pending" }),
      // Gamma: President rejected -> dead slate.
      candidate({ id: "3", partyAffiliation: "Gamma", position: "President", status: "rejected" }),
      // Delta: no President candidate at all, only a VP.
      candidate({ id: "4", partyAffiliation: "Delta", position: "Vice President" }),
    ];

    expect(livePeriodPartyNames(mixed, period())).toEqual(["Alpha"]);
  });

  it("never offers the Independent affiliation", () => {
    const mixed = [
      candidate({ id: "1", partyAffiliation: "Independent", position: "President", status: "approved" }),
      candidate({ id: "2", partyAffiliation: undefined, position: "President", status: "approved" }),
      candidate({ id: "3", partyAffiliation: "Alpha", position: "President", status: "approved" }),
    ];

    expect(livePeriodPartyNames(mixed, period())).toEqual(["Alpha"]);
  });
});

describe("livePeriodPartyId", () => {
  it("resolves the president of the live period's party", () => {
    const rows = [
      candidate({ id: "live", partyAffiliation: "Alpha", position: "President", partyId: "p-alpha" }),
      candidate({ id: "past", partyAffiliation: "Alpha", position: "President", partyId: "p-alpha-old", electionPeriodId: "period-past" }),
    ];

    expect(livePeriodPartyId(rows, period(), "Alpha")).toBe("p-alpha");
  });

  it("returns undefined without an approved president in that period", () => {
    const rows = [
      candidate({ id: "1", partyAffiliation: "Alpha", position: "Vice President", partyId: "p-alpha" }),
      candidate({ id: "2", partyAffiliation: "Alpha", position: "President", partyId: "p-alpha", status: "pending" }),
    ];

    expect(livePeriodPartyId(rows, period(), "Alpha")).toBeUndefined();
    expect(livePeriodPartyId(rows, period(), "Missing")).toBeUndefined();
  });
});

describe("isPartyFounder / isInPartyRace", () => {
  it("treats a party President candidacy as the founder", () => {
    expect(isPartyFounder(candidate({ partyAffiliation: "Alpha", position: "President" }))).toBe(true);
    expect(isPartyFounder(candidate({ partyAffiliation: "Alpha", position: "Vice President" }))).toBe(false);
    expect(isPartyFounder(candidate({ partyAffiliation: undefined, position: "President" }))).toBe(false);
  });

  it("keeps a candidate in the race only while the gate is live", () => {
    expect(isInPartyRace(candidate({ positionApprovalStatus: "presidentApprovalRequired" }))).toBe(true);
    expect(isInPartyRace(candidate({ positionApprovalStatus: "presidentApproved" }))).toBe(true);
    expect(isInPartyRace(candidate({ positionApprovalStatus: "presidentRejected" }))).toBe(false);
    expect(isInPartyRace(candidate({ positionApprovalStatus: "notRequired" }))).toBe(false);
  });
});

describe("isPartyPositionOpen", () => {
  const rows = [
    candidate({
      id: "vp-approved",
      partyId: "p-alpha",
      position: "Vice President",
      positionApprovalStatus: "presidentApproved",
    }),
    candidate({
      id: "sec-pending",
      partyId: "p-alpha",
      position: "Secretary",
      positionApprovalStatus: "presidentApprovalRequired",
    }),
    candidate({
      id: "sec-declined",
      partyId: "p-alpha",
      position: "Treasurer",
      positionApprovalStatus: "presidentRejected",
    }),
  ];

  it("is closed once a candidate has won the seat", () => {
    expect(isPartyPositionOpen(rows, period(), "p-alpha", "Vice President")).toBe(false);
  });

  // DELIBERATE REVERSAL of the old exclusive model.  055 drops 001:269 so an
  // office can be contested, and a mere request is not a win: refusing the
  // second applicant here would silently reinstate the one-candidate-per-seat
  // rule that 055 exists to remove.
  it("stays open while the seat is only contested", () => {
    expect(isPartyPositionOpen(rows, period(), "p-alpha", "Secretary")).toBe(true);
  });

  it("is open when nobody ever ran, or everyone was declined", () => {
    expect(isPartyPositionOpen(rows, period(), "p-alpha", "Auditor")).toBe(true);
    expect(isPartyPositionOpen(rows, period(), "p-alpha", "Treasurer")).toBe(true);
  });

  it("ignores other parties and other periods", () => {
    expect(isPartyPositionOpen(rows, period(), "p-beta", "Vice President")).toBe(true);
    expect(
      isPartyPositionOpen(
        [candidate({ id: "past-vp", partyId: "p-alpha", position: "Vice President", electionPeriodId: "period-past" })],
        period(),
        "p-alpha",
        "Vice President"
      )
    ).toBe(true);
  });

  it("lets a declined candidate re-apply for the seat they lost", () => {
    expect(
      isPartyPositionOpen(rows, period(), "p-alpha", "Treasurer", "sec-declined")
    ).toBe(true);
  });
});

describe("isSeatWinner", () => {
  it("treats a party-approved candidate as the winner", () => {
    expect(isSeatWinner(candidate({ positionApprovalStatus: "presidentApproved" }))).toBe(true);
  });

  it("does not treat a request as a win, even if Screening already approved it", () => {
    // 054's trigger should stop this combination reaching the table, but the
    // ordering matters: a queued request must never be read as settled.
    expect(
      isSeatWinner(candidate({ positionApprovalStatus: "presidentApprovalRequired", status: "approved" }))
    ).toBe(false);
  });

  it("lets Screening settle a candidacy that has no party gate", () => {
    // A party President's own candidacy, and every Independent run, carry
    // 'notRequired' — this is the branch that keeps a party's President from
    // being reported as an available seat to joiners.
    expect(isSeatWinner(candidate({ positionApprovalStatus: "notRequired", status: "approved" }))).toBe(true);
    expect(isSeatWinner(candidate({ positionApprovalStatus: "notRequired", status: "pending" }))).toBe(false);
  });

  it("never treats a declined candidacy as a winner", () => {
    expect(isSeatWinner(candidate({ positionApprovalStatus: "presidentRejected", status: "approved" }))).toBe(false);
  });
});

describe("partySeatSummaries", () => {
  const rows = [
    candidate({ id: "pres", partyId: "p-alpha", position: "President", positionApprovalStatus: "notRequired" }),
    candidate({ id: "vp-won", partyId: "p-alpha", position: "Vice President", positionApprovalStatus: "presidentApproved" }),
    candidate({ id: "vp-1", partyId: "p-alpha", position: "Vice President", positionApprovalStatus: "presidentApprovalRequired" }),
    candidate({ id: "vp-2", partyId: "p-alpha", position: "Vice President", positionApprovalStatus: "presidentApprovalRequired" }),
    candidate({ id: "sec-won", partyId: "p-alpha", position: "Secretary", positionApprovalStatus: "presidentApproved" }),
    candidate({ id: "treas-gone", partyId: "p-alpha", position: "Treasurer", positionApprovalStatus: "presidentRejected" }),
    candidate({ id: "beta-pres", partyId: "p-beta", position: "President", positionApprovalStatus: "notRequired" }),
  ];

  function stateOf(seats: ReturnType<typeof partySeatSummaries>, position: string) {
    return seats.find((seat) => seat.position === position);
  }

  it("marks a seat with an approved holder as filled", () => {
    const seats = partySeatSummaries(rows, period(), "p-alpha", "Grade 12");
    const secretary = stateOf(seats, "Secretary");

    expect(secretary?.state).toBe("filled");
    expect(secretary?.approved?.id).toBe("sec-won");
  });

  it("lets a second and third applicant into a contested seat", () => {
    const seats = partySeatSummaries(rows, period(), "p-alpha", "Grade 12");
    const vp = stateOf(seats, "Vice President");

    // Filled, because somebody already won it — but the two who lost are kept
    // visible as the rest of the field.
    expect(vp?.state).toBe("filled");
    expect(vp?.requesters.map((c) => c.id)).toEqual(["vp-1", "vp-2"]);
  });

  it("calls a seat with only requests contested, not filled", () => {
    const seats = partySeatSummaries(
      [candidate({ id: "sec-1", partyId: "p-alpha", position: "Secretary", positionApprovalStatus: "presidentApprovalRequired" })],
      period(),
      "p-alpha",
      "Grade 12"
    );

    expect(stateOf(seats, "Secretary")).toMatchObject({ state: "contested", requestCount: 1 });
    expect(isSeatSelectable(stateOf(seats, "Secretary")!)).toBe(true);
  });

  it("treats a declined candidacy as leaving the seat open", () => {
    const seats = partySeatSummaries(rows, period(), "p-alpha", "Grade 12");

    expect(stateOf(seats, "Treasurer")).toMatchObject({ state: "open", requestCount: 0 });
  });

  it("scopes the roster to the student's own grade", () => {
    const seats = partySeatSummaries(rows, period(), "p-alpha", "Grade 11");

    expect(seats.map((seat) => seat.position)).toContain("Grade 11 Representative");
    expect(seats.map((seat) => seat.position)).not.toContain("Grade 12 Representative");
  });

  it("keeps the other party's seats out", () => {
    const seats = partySeatSummaries(rows, period(), "p-alpha", "Grade 12");

    // Both parties have a President row; Alpha's must resolve to its own, and
    // Beta's President must not fill Alpha's seat.
    expect(stateOf(seats, "President")?.approved?.id).toBe("pres");
  });

  it("reads the Independent race when no party id is given", () => {
    const independent = [
      candidate({ id: "ind-1", partyId: undefined, partyAffiliation: undefined, position: "Auditor", positionApprovalStatus: "notRequired", status: "pending" }),
    ];

    expect(stateOf(partySeatSummaries(independent, period(), undefined, "Grade 12"), "Auditor")).toMatchObject({
      state: "contested",
    });
    expect(stateOf(partySeatSummaries(independent, period(), "p-alpha", "Grade 12"), "Auditor")?.state).toBe("open");
  });

  it("hides a candidate from their own seat so re-applying is allowed", () => {
    const seats = partySeatSummaries(rows, period(), "p-alpha", "Grade 12", "vp-won");

    expect(stateOf(seats, "Vice President")).toMatchObject({ state: "contested", requestCount: 2 });
  });
});

describe("isSeatSelectable", () => {
  const filled = { position: "Auditor", state: "filled" as const, requestCount: 0, requesters: [] };
  const open = { position: "Auditor", state: "open" as const, requestCount: 0, requesters: [] };
  const president = { position: "President", state: "open" as const, requestCount: 0, requesters: [] };

  it("refuses a filled seat", () => {
    expect(isSeatSelectable(filled)).toBe(false);
  });

  it("refuses the President seat when joining an existing party", () => {
    expect(isSeatSelectable(president, true)).toBe(false);
    // ...but never when creating the party or running Independent.
    expect(isSeatSelectable(president, false)).toBe(true);
  });

  it("accepts an open seat", () => {
    expect(isSeatSelectable(open, true)).toBe(true);
  });
});

describe("isPartyFullForGrade", () => {
  const filled = { position: "Auditor", state: "filled" as const, requestCount: 0, requesters: [] };
  const open = { position: "Secretary", state: "open" as const, requestCount: 0, requesters: [] };

  it("is full only when every seat on the roster has a winner", () => {
    expect(isPartyFullForGrade([filled, open])).toBe(false);
    expect(isPartyFullForGrade([filled, filled])).toBe(true);
  });

  it("treats an empty roster as not full", () => {
    expect(isPartyFullForGrade([])).toBe(false);
  });
});

describe("buildPartyOptions", () => {
  const parties = [
    { id: "p-alpha", name: "Alpha", electionPeriodId: "period-live" },
    { id: "p-gamma", name: "Gamma", electionPeriodId: "period-live" },
    { id: "p-old", name: "Alpha", electionPeriodId: "period-past" },
  ];

  const candidates = [
    candidate({ id: "a-pres", partyId: "p-alpha", partyAffiliation: "Alpha", position: "President", positionApprovalStatus: "notRequired" }),
    candidate({ id: "g-pres", partyId: "p-gamma", partyAffiliation: "Gamma", position: "President", positionApprovalStatus: "notRequired", status: "pending" }),
  ];

  it("lists every live party, not just the ones with a screened-in President", () => {
    const options = buildPartyOptions(parties, candidates, period(), "Grade 12");

    // This is the bug the Apply page had: Gamma has no approved President yet
    // but still exists and must be shown, disabled, with a reason.
    expect(options.map((party) => party.name)).toEqual(["Alpha", "Gamma"]);
  });

  it("excludes another period's party even when the name matches", () => {
    const options = buildPartyOptions(parties, candidates, period(), "Grade 12");

    expect(options.map((party) => party.electionPeriodId)).toEqual(["period-live", "period-live"]);
  });

  it("blocks a party with no approved President", () => {
    const gamma = buildPartyOptions(parties, candidates, period(), "Grade 12").find(
      (party) => party.name === "Gamma"
    );

    expect(gamma?.hasApprovedPresident).toBe(false);
    expect(gamma?.blockedReason).toBe("awaiting-president");
  });

  it("leaves a party with an approved President joinable", () => {
    const alpha = buildPartyOptions(parties, candidates, period(), "Grade 12").find(
      (party) => party.name === "Alpha"
    );

    expect(alpha?.hasApprovedPresident).toBe(true);
    expect(alpha?.blockedReason).toBeUndefined();
  });

  it("blocks a party whose every seat already has a winner", () => {
    // A Grade 12 roster is 9 seats: the 8 executive offices plus that grade's
    // own representative seat, so all nine have to be filled before the party
    // counts as full.
    const full = [
      "President",
      "Vice President",
      "Secretary",
      "Treasurer",
      "Auditor",
      "PRO",
      "PIO",
      "Protocol Officer",
      "Grade 12 Representative",
    ].map((position, index) =>
      candidate({
        id: `f-${index}`,
        partyId: "p-alpha",
        position,
        positionApprovalStatus: position === "President" ? "notRequired" : "presidentApproved",
      })
    );

    const options = buildPartyOptions(parties, [...full, ...candidates], period(), "Grade 12");
    const alpha = options.find((party) => party.name === "Alpha");

    expect(alpha?.isFull).toBe(true);
    expect(alpha?.blockedReason).toBe("full");
  });

  it("is not full while the student's own grade seat is still open", () => {
    const executive = [
      "President",
      "Vice President",
      "Secretary",
      "Treasurer",
      "Auditor",
      "PRO",
      "PIO",
      "Protocol Officer",
    ].map((position, index) =>
      candidate({
        id: `f-${index}`,
        partyId: "p-alpha",
        position,
        positionApprovalStatus: position === "President" ? "notRequired" : "presidentApproved",
      })
    );

    const alpha = buildPartyOptions(parties, [...executive, ...candidates], period(), "Grade 12").find(
      (party) => party.name === "Alpha"
    );

    // The same party is still open to a Grade 11 student.
    expect(alpha?.isFull).toBe(false);
    expect(alpha?.blockedReason).toBeUndefined();
  });

  it("falls back to candidate rows when the parties read came back empty", () => {
    const options = buildPartyOptions([], candidates, period(), "Grade 12");

    expect(options.map((party) => party.id)).toEqual(["p-alpha", "p-gamma"]);
  });

  it("never lists Independent", () => {
    const options = buildPartyOptions(
      parties,
      [...candidates, candidate({ id: "x", partyId: undefined, partyAffiliation: "Independent" })],
      period(),
      "Grade 12"
    );

    expect(options.map((party) => party.name)).not.toContain("Independent");
  });
});

describe("buildPartyPositionBoard", () => {
  it("splits a slate into open seats, approved holders and pending requests", () => {
    const rows = [
      candidate({ id: "pres", partyId: "p-alpha", position: "President" }),
      candidate({
        id: "vp-yes",
        partyId: "p-alpha",
        position: "Vice President",
        givenName: "Ana",
        positionApprovalStatus: "presidentApproved",
      }),
      candidate({
        id: "vp-wait",
        partyId: "p-alpha",
        position: "Vice President",
        givenName: "Bela",
        positionApprovalStatus: "presidentApprovalRequired",
      }),
      candidate({
        id: "sec-wait",
        partyId: "p-alpha",
        position: "Secretary",
        givenName: "Cid",
        positionApprovalStatus: "presidentApprovalRequired",
      }),
      candidate({
        id: "treas-gone",
        partyId: "p-alpha",
        position: "Treasurer",
        positionApprovalStatus: "presidentRejected",
      }),
    ];

    const board = buildPartyPositionBoard(rows, "p-alpha", period());

    expect(board.map((slot) => slot.position)).toEqual(["Secretary", "Vice President"]);

    const [secretary, vicePresident] = board;
    expect(secretary.approved).toBeUndefined();
    expect(secretary.pending.map((c) => c.id)).toEqual(["sec-wait"]);

    expect(vicePresident.approved?.id).toBe("vp-yes");
    expect(vicePresident.pending.map((c) => c.id)).toEqual(["vp-wait"]);

    // The President never judges their own seat, and a declined candidate
    // is not shown as a live request.
    expect(board.map((s) => s.position)).not.toContain("President");
    expect(board.map((s) => s.position)).not.toContain("Treasurer");
  });

  it("returns nothing for a party that is not in the live period", () => {
    const rows = [
      candidate({
        id: "past-vp",
        partyId: "p-alpha",
        position: "Vice President",
        electionPeriodId: "period-past",
        positionApprovalStatus: "presidentApproved",
      }),
    ];

    expect(buildPartyPositionBoard(rows, "p-alpha", period())).toEqual([]);
  });
});

describe("partyApprovalBlockForSubmit", () => {
  const partySeat = (overrides: Partial<Candidate> = {}) =>
    candidate({
      id: "vp",
      partyId: "p-alpha",
      partyAffiliation: "Alpha",
      position: "Vice President",
      status: "ongoingSubmission",
      positionApprovalStatus: "notRequired",
      ...overrides,
    });

  it("blocks a party candidate whose President has not decided yet", () => {
    expect(
      partyApprovalBlockForSubmit(partySeat({ positionApprovalStatus: "presidentApprovalRequired" }))
    ).toBe("awaiting-party-president");
  });

  it("clears once the party President approves", () => {
    expect(partyApprovalBlockForSubmit(partySeat({ positionApprovalStatus: "presidentApproved" }))).toBe(
      null
    );
  });

  it("reports a closed seat separately from an outstanding approval", () => {
    expect(partyApprovalBlockForSubmit(partySeat({ positionApprovalStatus: "presidentRejected" }))).toBe(
      "seat-closed"
    );
  });

  it("never blocks an Independent candidate, whatever the gate says", () => {
    for (const gate of [
      "notRequired",
      "presidentApprovalRequired",
      "presidentApproved",
      "presidentRejected",
    ] as const) {
      expect(
        partyApprovalBlockForSubmit(
          candidate({
            partyId: undefined,
            partyAffiliation: undefined,
            position: "Auditor",
            status: "ongoingSubmission",
            positionApprovalStatus: gate,
          })
        )
      ).toBe(null);
    }
  });

  it("never blocks the party's own President, who is vetted by Screening", () => {
    expect(
      partyApprovalBlockForSubmit(
        candidate({
          partyId: "p-alpha",
          partyAffiliation: "Alpha",
          position: "President",
          status: "ongoingSubmission",
          positionApprovalStatus: "presidentApprovalRequired",
        })
      )
    ).toBe(null);
  });

  it("trusts partyId over the display name, so a party named Independent stays gated", () => {
    // "Independent" is only a frontend fallback string; the database keys on
    // the party_id foreign key, so this candidate IS gated.
    expect(
      partyApprovalBlockForSubmit(
        candidate({
          partyId: "p-alpha",
          partyAffiliation: "Independent",
          position: "Secretary",
          status: "ongoingSubmission",
          positionApprovalStatus: "presidentApprovalRequired",
        })
      )
    ).toBe("awaiting-party-president");
  });

  it("clears a party candidate that never needed a gate at all", () => {
    expect(partyApprovalBlockForSubmit(partySeat())).toBe(null);
  });
});
