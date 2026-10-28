import type { ElectionPeriod } from "../context/AppContext";

/**
 * The five working stages the election moves through.  `completed` is a
 * retired period (AppContext's ElectionStage) — never a stage anything is
 * working on, which is why it is absent here.
 */
export type Stage =
  | "application"
  | "campaign"
  | "fingerprint_registration"
  | "voting"
  | "results";

/**
 * The stage the election is actually on.
 *
 * 058 introduced `lifecycle_stage` as the authoritative value, but the
 * boolean fallback is kept so a database that has not been migrated yet — or
 * a row written before the column existed — still lands somewhere sensible
 * instead of pretending to be in Stage 1.
 */
export function resolveStage(electionPeriod: ElectionPeriod): Stage {
  const stage = electionPeriod.lifecycleStage;
  if (
    stage === "application" ||
    stage === "campaign" ||
    stage === "fingerprint_registration" ||
    stage === "voting" ||
    stage === "results"
  ) {
    return stage;
  }
  if (electionPeriod.proclaimed || electionPeriod.resultsPublished) return "results";
  if (electionPeriod.isActive) return "voting";
  if (electionPeriod.fingerprintRegistrationStartAt) return "fingerprint_registration";
  if (electionPeriod.rulesDiscussionAt) return "campaign";
  return "application";
}

/**
 * Whether the Candidacy Application Stage (Stage 1) is over for this period.
 *
 * The Electoral Board ends Stage 1 by scheduling the Rules Discussion Meeting
 * and running end_candidacy_period_rpc (082), which moves the period to
 * 'campaign' — a one-way step only an election-plan reset rewinds.  From that
 * point on the roster is final: nothing may be filed, revised, resubmitted,
 * or re-applied for (109 gates the RPCs; the UI shows the friendly version).
 *
 * `completed` is checked explicitly because resolveStage() deliberately lets
 * a retired period fall through to the legacy booleans and land on
 * 'application' for the admin tabs — a reading that must never reopen this
 * gate.  A period without `lifecycle_stage` (pre-058 data) falls back to the
 * booleans via resolveStage().
 */
export function applicationStageEnded(electionPeriod: ElectionPeriod): boolean {
  if (electionPeriod.lifecycleStage === "completed") return true;
  return resolveStage(electionPeriod) !== "application";
}
