import { describe, expect, it } from "vitest";
import {
  isInLivePeriod,
  replaceLiveCandidates,
  splitCandidatesByPeriod,
} from "../partyScope";
import type { Candidate, ElectionPeriod } from "../../context/AppContext";

/**
 * The AppContext store keeps every candidate row and derives the two exposed
 * lists from it.  These tests pin the split rule, which is what stops a past
 * election's candidates from ever appearing in the current one.
 */

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

describe("isInLivePeriod", () => {
  it("matches the live period's rows", () => {
    expect(isInLivePeriod(candidate(), period())).toBe(true);
  });

  it("rejects a past period's rows", () => {
    expect(isInLivePeriod(candidate({ electionPeriodId: "period-past" }), period())).toBe(false);
  });

  it("keeps legacy rows with no period id, like candidatesInLivePeriod", () => {
    expect(isInLivePeriod(candidate({ electionPeriodId: undefined }), period())).toBe(true);
  });

  it("hides everything when there is no live period id", () => {
    // No period row (every election completed/cancelled, or none yet): the
    // whole store is history, so a past election's roster can never read as
    // current.  AppContext sets candidates and the period in one batched
    // update, so an empty id never describes "loaded but not yet scoped".
    expect(isInLivePeriod(candidate({ electionPeriodId: "period-past" }), period({ id: undefined }))).toBe(false);
    expect(isInLivePeriod(candidate({ electionPeriodId: undefined }), period({ id: undefined }))).toBe(false);
  });
});

describe("splitCandidatesByPeriod", () => {
  it("routes only the live period's rows into live", () => {
    const rows = [
      candidate({ id: "live", electionPeriodId: "period-live" }),
      candidate({ id: "past", electionPeriodId: "period-past" }),
      candidate({ id: "older", electionPeriodId: "period-older" }),
    ];

    const { live, archived } = splitCandidatesByPeriod(rows, period());

    expect(live.map((c) => c.id)).toEqual(["live"]);
    expect(archived.map((c) => c.id)).toEqual(["past", "older"]);
  });

  it("is a partition: no row is lost or duplicated", () => {
    const rows = [
      candidate({ id: "a", electionPeriodId: "period-live" }),
      candidate({ id: "b", electionPeriodId: "period-past" }),
      candidate({ id: "c", electionPeriodId: undefined }),
    ];

    const { live, archived } = splitCandidatesByPeriod(rows, period());

    expect(live.length + archived.length).toBe(rows.length);
  });

  it("archives everything when the live period has no id", () => {
    // No period = no current election: past rosters stay reachable for the
    // archive surfaces, but no current-election screen may show them.
    const rows = [
      candidate({ id: "a", electionPeriodId: "period-live" }),
      candidate({ id: "b", electionPeriodId: "period-past" }),
    ];

    const { live, archived } = splitCandidatesByPeriod(rows, period({ id: undefined }));

    expect(live).toHaveLength(0);
    expect(archived).toHaveLength(2);
  });
});

describe("replaceLiveCandidates", () => {
  it("replaces the live rows and carries archived history over untouched", () => {
    const previous = [
      candidate({ id: "live-a", electionPeriodId: "period-live" }),
      candidate({ id: "past-a", electionPeriodId: "period-past" }),
    ];
    const next = [candidate({ id: "live-b", electionPeriodId: "period-live" })];

    const merged = replaceLiveCandidates(previous, next, period());

    expect(merged.map((c) => c.id)).toEqual(["past-a", "live-b"]);
  });

  it("supports optimistic writes that append a new row", () => {
    const previous = [candidate({ id: "past-a", electionPeriodId: "period-past" })];
    const next = [candidate({ id: "live-new", electionPeriodId: "period-live" })];

    const merged = replaceLiveCandidates(previous, next, period());

    expect(merged.map((c) => c.id).sort()).toEqual(["live-new", "past-a"]);
  });

  it("treats legacy no-period rows as live, so setCandidates never strands them", () => {
    const previous = [
      candidate({ id: "legacy", electionPeriodId: undefined }),
      candidate({ id: "past-a", electionPeriodId: "period-past" }),
    ];

    const merged = replaceLiveCandidates(previous, [], period());

    expect(merged.map((c) => c.id)).toEqual(["past-a"]);
  });

  it("leaves the store untouched when there is no live period to replace", () => {
    // The exposed live list is empty without a period, so callers pass an
    // empty next; appending anything would file rows into retired history.
    const previous = [candidate({ id: "past-a", electionPeriodId: "period-past" })];

    const merged = replaceLiveCandidates(previous, [], period({ id: undefined }));

    expect(merged).toEqual(previous);
  });
});
