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
  it("writes the v1.1 schedule columns (election_date + end_date + start_time/end_time)", () => {
    const payload = buildElectionPeriodSyncPayload(basePeriod());
    expect(payload).toHaveProperty("election_date", "2026-10-12");
    expect(payload).toHaveProperty("end_date", "2026-10-12");
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
      "nomination_open",
      "official_list_posted",
      "plan_finalized",
    ]) {
      expect(payload).not.toHaveProperty(dropped);
    }
  });

  it("no longer writes rules_discussion_at — 082 moved the meeting to its own Stage 1 RPC", () => {
    // save_meeting_schedule_rpc (082) guards the stage, so the plain editor
    // (Stage 4's Save Schedule) must not be able to clobber the meeting.
    const payload = buildElectionPeriodSyncPayload(basePeriod({ rulesDiscussionAt: "2026-09-30" }));
    expect("rules_discussion_at" in payload).toBe(false);
  });

  it("no longer writes the campaign window — 093 gave it its own guarded RPC", () => {
    // save_campaign_window_rpc (093) guards the stage and the commissioner
    // role, so the plain editor (Stage 4's Save Schedule) must not be able to
    // rewrite the campaign window behind its back.
    const payload = buildElectionPeriodSyncPayload(
      basePeriod({
        campaignStartDate: "2026-09-20T06:00:00.000Z",
        campaignEndDate: "2026-10-11T17:00:00.000Z",
      }),
    );
    expect("campaign_start_at" in payload).toBe(false);
    expect("campaign_end_at" in payload).toBe(false);
  });

  it("defaults election_modality to 'digital' when unset (082 column default)", () => {
    expect(buildElectionPeriodSyncPayload(basePeriod()).election_modality).toBe("digital");
  });

  it("accepts every modality in the fixed 082 set", () => {
    for (const modality of ["digital", "manual", "hybrid"]) {
      const payload = buildElectionPeriodSyncPayload(
        basePeriod({ electionModality: modality as ElectionPeriod["electionModality"] }),
      );
      expect(payload.election_modality).toBe(modality);
    }
  });

  it("never lets the plain schedule editor move the election between stages", () => {
    // 058 makes the RPCs the only writer of lifecycle_stage. If this payload
    // carried it, a "Save Schedule" click from Stage 3 would drag a live
    // campaign back to Stage 1.
    for (const stage of ["application", "campaign", "fingerprint_registration", "voting", "results", "completed"]) {
      const payload = buildElectionPeriodSyncPayload(basePeriod({ lifecycleStage: stage as ElectionPeriod["lifecycleStage"] }));
      expect("lifecycle_stage" in payload).toBe(false);
    }
  });

  it("leaves the 060 Fingerprint Registration window to its own RPCs", () => {
    // Same reasoning as lifecycle_stage: the enrolment window is opened and
    // closed by start/close_fingerprint_registration_rpc, so a plain
    // "Save Schedule" must not clobber the dates back to null.
    const payload = buildElectionPeriodSyncPayload(
      basePeriod({
        fingerprintRegistrationStartAt: "2026-10-05T08:00:00Z",
        fingerprintRegistrationEndAt: "2026-10-06T17:00:00Z",
      }),
    );
    expect("fingerprint_registration_start_at" in payload).toBe(false);
    expect("fingerprint_registration_end_at" in payload).toBe(false);
  });

  it("never writes school_year from the schedule editor either", () => {
    // school_year is UNIQUE (020) and identifies the election; only the
    // 058 RPCs allocate it.
    const payload = buildElectionPeriodSyncPayload(basePeriod({ schoolYear: "2027-2028" }));
    expect("school_year" in payload).toBe(false);
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