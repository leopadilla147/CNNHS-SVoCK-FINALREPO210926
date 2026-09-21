import { describe, it, expect } from "vitest";
import { buildElectionPeriodSyncPayload } from "../supabaseData";
import type { ElectionPeriod } from "../../context/AppContext";

const basePeriod = (overrides: Partial<ElectionPeriod> = {}): ElectionPeriod => ({
  startDate: "2026-10-12",
  startTime: "08:00",
  endDate: "2026-10-12",
  endTime: "17:00",
  isActive: false,
  venue: "IoT biometric kiosk precinct",
  candidacyOpen: false,
  nominationOpen: false,
  resultsPublished: false,
  officialListPosted: false,
  campaignStartDate: "2026-09-20",
  campaignStartTime: "08:00",
  campaignEndDate: "2026-10-11",
  campaignEndTime: "17:00",
  planFinalized: false,
  proclaimed: false,
  proclaimedAt: "",
  ...overrides,
});

const D06_METHODS = ["plurality", "plurality_with_run_off", "ranked_choice"];

describe("buildElectionPeriodSyncPayload", () => {
  it("writes the v1.1 schedule columns (election_date + start_time/end_time)", () => {
    const payload = buildElectionPeriodSyncPayload(basePeriod());
    expect(payload).toHaveProperty("election_date", "2026-10-12");
    expect(payload).toHaveProperty("start_time", "08:00");
    expect(payload).toHaveProperty("end_time", "17:00");
  });

  it("keeps the surviving workflow flags", () => {
    const payload = buildElectionPeriodSyncPayload(
      basePeriod({ isActive: true, candidacyOpen: true, resultsPublished: true, proclaimed: true, venue: "Gym" })
    );
    expect(payload.is_active).toBe(true);
    expect(payload.candidacy_open).toBe(true);
    expect(payload.results_published).toBe(true);
    expect(payload.proclaimed).toBe(true);
    expect(payload.venue).toBe("Gym");
  });

  it("never references a 036-trimmed column", () => {
    const payload = buildElectionPeriodSyncPayload(basePeriod({ rulesDiscussionAt: "2026-09-30" }));
    for (const dropped of [
      "start_at",
      "end_at",
      "campaign_start_at",
      "campaign_end_at",
      "nomination_open",
      "official_list_posted",
      "plan_finalized",
      "rules_discussion_at",
    ]) {
      expect(payload).not.toHaveProperty(dropped);
    }
  });

  it("defaults voting_method to 'plurality' when unset (029 column default)", () => {
    expect(buildElectionPeriodSyncPayload(basePeriod()).voting_method).toBe("plurality");
  });

  it("accepts every method in the fixed D-06 set", () => {
    for (const method of D06_METHODS) {
      const payload = buildElectionPeriodSyncPayload(basePeriod({ votingMethod: method as ElectionPeriod["votingMethod"] }));
      expect(payload.voting_method).toBe(method);
    }
  });
});