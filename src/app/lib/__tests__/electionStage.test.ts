import { describe, expect, it } from "vitest";
import { applicationStageEnded, resolveStage } from "../electionStage";
import { emptyElectionPeriod } from "../../context/AppContext";
import type { ElectionPeriod } from "../../context/AppContext";

const period = (overrides: Partial<ElectionPeriod> = {}): ElectionPeriod => ({
  ...emptyElectionPeriod,
  id: "period-1",
  ...overrides,
});

describe("resolveStage", () => {
  it("trusts lifecycle_stage when the column is populated", () => {
    expect(resolveStage(period({ lifecycleStage: "application" }))).toBe("application");
    expect(resolveStage(period({ lifecycleStage: "campaign" }))).toBe("campaign");
    expect(resolveStage(period({ lifecycleStage: "fingerprint_registration" }))).toBe("fingerprint_registration");
    expect(resolveStage(period({ lifecycleStage: "voting" }))).toBe("voting");
    expect(resolveStage(period({ lifecycleStage: "results" }))).toBe("results");
  });

  it("falls back to the legacy booleans for pre-058 rows", () => {
    expect(resolveStage(period({ lifecycleStage: undefined }))).toBe("application");
    expect(resolveStage(period({ lifecycleStage: undefined, rulesDiscussionAt: "2026-09-30T09:00:00Z" }))).toBe("campaign");
    expect(
      resolveStage(period({ lifecycleStage: undefined, fingerprintRegistrationStartAt: "2026-10-05T08:00:00Z" }))
    ).toBe("fingerprint_registration");
    expect(resolveStage(period({ lifecycleStage: undefined, isActive: true }))).toBe("voting");
    expect(resolveStage(period({ lifecycleStage: undefined, resultsPublished: true }))).toBe("results");
    expect(resolveStage(period({ lifecycleStage: undefined, proclaimed: true }))).toBe("results");
  });

  it("lets a completed period read as application for the admin tabs", () => {
    // resolveStage deliberately falls through 'completed' to the legacy
    // booleans — the admin setup tabs re-open at Stage 1 for a retired
    // period.  applicationStageEnded() is what must special-case it.
    expect(resolveStage(period({ lifecycleStage: "completed" }))).toBe("application");
  });
});

describe("applicationStageEnded", () => {
  it("is open while the Candidacy Application Stage is current", () => {
    expect(applicationStageEnded(period({ lifecycleStage: "application" }))).toBe(false);
    // Paused but not ended: the window can close while Stage 1 is still the
    // current stage (candidacy_open = false, lifecycle_stage = 'application').
    expect(applicationStageEnded(period({ lifecycleStage: "application", candidacyOpen: false }))).toBe(false);
  });

  it("is ended from the Campaign Stage onward", () => {
    expect(applicationStageEnded(period({ lifecycleStage: "campaign" }))).toBe(true);
    expect(applicationStageEnded(period({ lifecycleStage: "fingerprint_registration" }))).toBe(true);
    expect(applicationStageEnded(period({ lifecycleStage: "voting" }))).toBe(true);
    expect(applicationStageEnded(period({ lifecycleStage: "results" }))).toBe(true);
  });

  it("treats a completed period as ended even though resolveStage reads it as application", () => {
    expect(applicationStageEnded(period({ lifecycleStage: "completed" }))).toBe(true);
  });

  it("uses the legacy boolean fallbacks for pre-058 rows", () => {
    expect(applicationStageEnded(period({ lifecycleStage: undefined }))).toBe(false);
    expect(applicationStageEnded(period({ lifecycleStage: undefined, rulesDiscussionAt: "2026-09-30T09:00:00Z" }))).toBe(true);
    expect(applicationStageEnded(period({ lifecycleStage: undefined, isActive: true }))).toBe(true);
    expect(applicationStageEnded(period({ lifecycleStage: undefined, proclaimed: true }))).toBe(true);
  });
});
