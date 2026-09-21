# Grade-Level Voting Rules (APPROV-02)

**Decision:** Fixed rule — recorded verbatim in 04-PLAN.md 04-07 Task 1 (the user chose **(a) fixed rule** on 2026-09-18; both Q1/Q2 answers are locked and non-changeable for phase 04).

This document is the single source of truth for the grade↔position eligibility rule enforced when a candidate applies for an elective position (APPROV-02).

## Eligibility population

Eligibility is evaluated against the **approved Enrolled Student roster** — students whose enrollment record is present in the `students` masterlist table and in an approved state. Candidates outside this population (e.g., not in the roster, or in a pending/rejected enrollment state) are not eligible to run.

## Grade↔position mapping (fixed, DB-enforced)

The mapping is enforced at the database layer by the fixed constraint `candidates_grade_position_match` (migration 001:282-288):

```sql
check (
  position not like '%Representative'
  or grade_level = replace(position, ' Representative', '')
)
```

In plain terms:

| Position | Eligible grade level(s) |
|----------|--------------------------|
| President, Vice President, Secretary, Treasurer, Auditor, PRO, PIO, Protocol Officer | Any grade level (7–12) in the approved roster (`position not like '%Representative'` — unconstrained by grade) |
| `{Grade} Representative` (e.g., "Grade 7 Representative") | The candidate's `grade_level` must equal the position's named grade (`replace(position, ' Representative', '')`) — e.g., Grade 7 only for "Grade 7 Representative" |

This keeps representative seats grade-locked while executive positions remain open to the full student body.

## Enforcement point

1. The constraint is declared on the `candidates` table (migration 001:282-288) and is evaluated by Postgres on every `INSERT`/`UPDATE` of a candidate row — an attempted application with a mismatched grade/position is rejected by the database, regardless of the calling role.
2. The candidacy application UI (`StudentApplyCandidacy.tsx`) presents grade-appropriate position choices (executive positions plus `<Grade Level> Representative`) so the mismatch path is never reachable through the normal flow.
3. No configurable mapping table or admin UI exists — this is a deliberate, locked decision (option (a) of the 04-07 Task 1 checkpoint); changing the mapping requires a migration, which is out of scope for phase 04.

## Verification

- `npm run test:db` (user-owned) — pgTAP suite asserts the constraint's existence on the `candidates` table (028 contract).
- `npm run typecheck` — guards the client-side position-list wiring.