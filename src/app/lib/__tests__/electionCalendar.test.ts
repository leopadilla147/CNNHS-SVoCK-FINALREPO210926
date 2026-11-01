import { describe, expect, it } from "vitest";
import { addDays, endOfDay, startOfDay } from "date-fns";
import {
  buildElectionEvents,
  EVENT_CATEGORY_META,
  eventStatus,
  eventsOnDay,
  parseEventDate,
} from "../electionCalendar";
import { emptyElectionPeriod } from "../../context/AppContext";
import type { ElectionPeriod } from "../../context/AppContext";

const period = (overrides: Partial<ElectionPeriod> = {}): ElectionPeriod => ({
  ...emptyElectionPeriod,
  id: "period-1",
  ...overrides,
});

describe("buildElectionEvents", () => {
  it("returns no events for an unconfigured period", () => {
    expect(buildElectionEvents(emptyElectionPeriod)).toEqual([]);
  });

  it("builds the Voting Day window from the schedule editor fields", () => {
    const events = buildElectionEvents(
      period({
        startDate: "2026-02-10",
        startTime: "08:00",
        endDate: "2026-02-10",
        endTime: "17:00",
        venue: "CNNHS Covered Court",
      }),
    );
    const voting = events.find((event) => event.id === "voting-day");
    expect(voting).toBeDefined();
    expect(voting!.category).toBe("voting");
    expect(voting!.start).toEqual(startOfDay(new Date(2026, 1, 10)));
    expect(voting!.end).toEqual(endOfDay(new Date(2026, 1, 10)));
    expect(voting!.allDay).toBe(true);
    expect(voting!.timeLabel).toBe("8:00 AM – 5:00 PM");
    expect(voting!.location).toBe("CNNHS Covered Court");
  });

  it("spans multi-day windows through the end date", () => {
    const events = buildElectionEvents(
      period({ startDate: "2026-02-10", startTime: "08:00", endDate: "2026-02-12", endTime: "" }),
    );
    const voting = events.find((event) => event.id === "voting-day");
    expect(voting!.end).toEqual(endOfDay(new Date(2026, 1, 12)));
    // A bare end time only labels the start clock.
    expect(voting!.timeLabel).toBe("8:00 AM");
  });

  it("carries the Campaign window and Rules Discussion meeting", () => {
    const events = buildElectionEvents(
      period({
        campaignStartDate: "2026-02-01T08:00:00+08:00",
        campaignEndDate: "2026-02-06T17:00:00+08:00",
        rulesDiscussionAt: "2026-01-28T14:00:00+08:00",
      }),
    );
    expect(events.find((event) => event.id === "campaign-period")!.category).toBe("campaign");
    const meeting = events.find((event) => event.id === "rules-discussion");
    expect(meeting).toBeDefined();
    expect(meeting!.category).toBe("campaign_meeting");
    expect(meeting!.allDay).toBe(false);
    // Mid-window / same-day checks stay timezone-agnostic.
    expect(eventsOnDay([meeting!], new Date(2026, 0, 28, 12))).toHaveLength(1);
    const campaign = events.find((event) => event.id === "campaign-period")!;
    expect(eventsOnDay([campaign], new Date(2026, 1, 3, 12))).toHaveLength(1);
  });

  it("carries the Fingerprint Registration window", () => {
    const events = buildElectionEvents(
      period({
        fingerprintRegistrationStartAt: "2026-02-02T08:00:00+08:00",
        fingerprintRegistrationEndAt: "2026-02-04T17:00:00+08:00",
      }),
    );
    const fingerprint = events.find((event) => event.id === "fingerprint-registration");
    expect(fingerprint).toBeDefined();
    expect(fingerprint!.category).toBe("fingerprint");
    expect(eventsOnDay([fingerprint!], new Date(2026, 1, 3, 12))).toHaveLength(1);
  });

  it("expects results the day after voting closes, within a 48-hour window", () => {
    const events = buildElectionEvents(
      period({ startDate: "2026-02-10", startTime: "08:00", endDate: "2026-02-10", endTime: "17:00" }),
    );
    const results = events.find((event) => event.id === "results-publication");
    expect(results!.title).toBe("Results Publication (Expected)");
    expect(results!.start).toEqual(startOfDay(addDays(new Date(2026, 1, 10), 1)));
    expect(results!.end).toEqual(endOfDay(addDays(new Date(2026, 1, 10), 2)));
  });

  it("prefers votingEndedAt over the scheduled end when anchoring expected results", () => {
    const events = buildElectionEvents(
      period({
        startDate: "2026-02-10",
        endDate: "2026-02-12",
        votingEndedAt: "2026-02-11T16:00:00+08:00",
      }),
    );
    const results = events.find((event) => event.id === "results-publication");
    // Feb 11 16:00+08 is Feb 11 everywhere relevant, so the day after is Feb 12.
    expect(eventsOnDay([results!], new Date(2026, 1, 13, 12))).toHaveLength(1);
    expect(eventsOnDay([results!], new Date(2026, 1, 15, 12))).toHaveLength(0);
  });

  it("drops the (Expected) label once results are published", () => {
    const events = buildElectionEvents(
      period({ startDate: "2026-02-10", endDate: "2026-02-10", resultsPublished: true }),
    );
    expect(events.find((event) => event.id === "results-publication")!.title).toBe("Results Publication");
  });

  it("replaces the expected window with the proclamation timestamp", () => {
    const events = buildElectionEvents(
      period({
        startDate: "2026-02-10",
        endDate: "2026-02-10",
        proclaimedAt: "2026-02-12T10:00:00+08:00",
      }),
    );
    expect(events.some((event) => event.id === "proclamation")).toBe(true);
    expect(events.some((event) => event.id === "results-publication")).toBe(false);
  });

  it("sorts the chronology by start", () => {
    const events = buildElectionEvents(
      period({
        campaignStartDate: "2026-02-01T08:00:00+08:00",
        campaignEndDate: "2026-02-06T17:00:00+08:00",
        startDate: "2026-02-10",
        startTime: "08:00",
        endDate: "2026-02-10",
        endTime: "17:00",
      }),
    );
    const starts = events.map((event) => event.start.getTime());
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("gives every category a display label and indicator colour", () => {
    const seen = new Set(buildElectionEvents(
      period({
        rulesDiscussionAt: "2026-01-28T14:00:00+08:00",
        campaignStartDate: "2026-02-01T08:00:00+08:00",
        campaignEndDate: "2026-02-06T17:00:00+08:00",
        fingerprintRegistrationStartAt: "2026-02-02T08:00:00+08:00",
        fingerprintRegistrationEndAt: "2026-02-04T17:00:00+08:00",
        startDate: "2026-02-10",
        startTime: "08:00",
        endDate: "2026-02-10",
        endTime: "17:00",
        proclaimedAt: "2026-02-12T10:00:00+08:00",
      }),
    ).map((event) => event.category));
    for (const category of seen) {
      expect(EVENT_CATEGORY_META[category].label.length).toBeGreaterThan(0);
      expect(EVENT_CATEGORY_META[category].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("eventsOnDay", () => {
  const events = buildElectionEvents(
    period({
      startDate: "2026-02-10",
      startTime: "08:00",
      endDate: "2026-02-12",
      endTime: "17:00",
    }),
  );

  it("matches the first day, middle days, and the last day of a window", () => {
    const ids = (day: Date) => eventsOnDay(events, day).map((event) => event.id);
    expect(ids(new Date(2026, 1, 10))).toContain("voting-day");
    expect(ids(new Date(2026, 1, 11))).toContain("voting-day");
    expect(ids(new Date(2026, 1, 12))).toContain("voting-day");
  });

  it("does not match days outside the window", () => {
    expect(eventsOnDay(events, new Date(2026, 1, 9))).toHaveLength(0);
  });
});

describe("eventStatus", () => {
  const voting = buildElectionEvents(
    period({ startDate: "2026-02-10", startTime: "08:00", endDate: "2026-02-10", endTime: "17:00" }),
  ).find((event) => event.id === "voting-day")!;

  it("reads upcoming, ongoing, and done against a fixed now", () => {
    expect(eventStatus(voting, new Date(2026, 1, 9))).toBe("upcoming");
    expect(eventStatus(voting, new Date(2026, 1, 10, 12))).toBe("ongoing");
    expect(eventStatus(voting, new Date(2026, 1, 11))).toBe("done");
  });
});

describe("parseEventDate", () => {
  it("combines a bare date with an HH:mm clock value", () => {
    expect(parseEventDate("2026-02-10", "08:30")).toEqual(new Date(2026, 1, 10, 8, 30));
    // Postgres `time` values arrive as "08:30:00".
    expect(parseEventDate("2026-02-10", "08:30:00")).toEqual(new Date(2026, 1, 10, 8, 30));
  });

  it("defaults to midnight when no time is given", () => {
    expect(parseEventDate("2026-02-10")).toEqual(startOfDay(new Date(2026, 1, 10)));
  });

  it("parses ISO timestamps and rejects empty input", () => {
    expect(parseEventDate("2026-02-10T08:00:00Z")).toEqual(new Date("2026-02-10T08:00:00Z"));
    expect(parseEventDate("")).toBeNull();
    expect(parseEventDate(undefined)).toBeNull();
    expect(parseEventDate("not-a-date")).toBeNull();
  });
});
