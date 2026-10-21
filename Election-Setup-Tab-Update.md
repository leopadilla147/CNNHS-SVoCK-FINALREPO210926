# Election Setup Tab Update — Election Lifecycle

Status: **implemented** (058 four stages, extended by 060)
Applies to: Electoral Board → Election Setup (`/admin/election`, `src/app/pages/admin/AdminElectionSetup.tsx`)

Requirement source: the original outline, plus the later request for a Fingerprint Registration
window. Implementation notes are added beneath each requirement so the spec and the change can be
read side by side.

Every DB change ships as a numbered migration —
`supabase/migrations/058_election_lifecycle_stages.sql` for the base lifecycle and
`supabase/migrations/060_fingerprint_registration_stage.sql` for the Fingerprint Registration
stage — and is applied in Supabase manually (per AGENTS.md — never apply to Supabase directly).

Current order: `application → campaign → fingerprint_registration → voting → results`.

---

## Stage 1 — Candidate Application Period

**Requirement**
- If start, the student can now apply for candidacy and send their applications to Screening
  and Validation Commissioner.
- The System will also create the election_id when the Candidate Application Period starts.

**Implementation**
- New `lifecycle_stage` column on `election_periods`
  (`application | campaign | voting | results | completed`, default `application`).
  This replaces the current approach of inferring the stage from a pile of booleans in
  `AdminElectionSetup.tsx:33-55`, and makes the stage DB-authoritative.
- New RPC `start_candidacy_period_rpc(p_school_year text) -> uuid`:
  - reuses the open period if one exists, otherwise INSERTs a new `election_periods` row
    (`school_year`, `candidacy_open = true`, `lifecycle_stage = 'application'`,
    `created_by = current_session_user_id()`). **This is the "create the election_id" behavior.**
- New RPC `close_candidacy_period_rpc()` sets `candidacy_open = false` without advancing the
  stage, so applications can be paused and resumed.
- **Server-side enforcement added.** `submit_candidacy_rpc` currently has *no* `candidacy_open`
  check at all — `candidacy_open` is purely a UI flag today. A guard is added to the `'create'`
  branch: refuse unless the resolved period has `candidacy_open = true`.
  Server-side text: "The Candidate Application Period is closed. Applications are not being
  accepted right now."
- The period-resolution order inside `submit_candidacy_rpc` also changes. It currently prefers
  `is_active = true` (`052:659-670`), but during application/campaign `is_active` is false, so
  the `order by election_date desc nulls last` fallback could select an **archived** period.
  It will prefer `lifecycle_stage in ('application','campaign')`.
- The Open/Close Candidacy toggle moves off the Electoral Board dashboard
  (`ElectoralDashboard.tsx:94`) and into Stage 1 of this tab, so every lifecycle change goes
  through a guarded RPC.
- `StudentApplyCandidacy.tsx` shows a "Candidate Application Period is closed" banner and
  disables the wizard while closed. The RPC refuses independently of the UI.

---

## Stage 2 — Campaign Period

**Requirement**
- In this stage, the commissioner can schedule a Meeting, the scheduled date of the meeting
  will be announce in the "Apply for Candidacy" Tab in the students page when the student is
  approved as a Candidate.
- Also after scheduling the Candidate Application Period will end.

**Implementation**
- **Blocking gap fixed:** `rules_discussion_at` was dropped in migration `036_domain_trim.sql:762`,
  so the meeting has no column. That is why `AdminCandidates.tsx:246` currently always sends
  candidates *"a date to be announced"*. The column is re-added in migration 058.
  The original name is kept (not renamed) because `AppContext.tsx:157` and the notification type
  `rules_discussion_meeting` (`AppContext.tsx:221`) already reference it.
- New RPC `end_candidacy_and_schedule_meeting_rpc(p_election_id uuid, p_meeting_at timestamptz)`
  performs both halves of the requirement in **one** action: sets `rules_discussion_at`,
  `candidacy_open = false`, and `lifecycle_stage = 'campaign'`. Refuses unless the current
  stage is `application`.
- The meeting date is rendered in `StudentApplyCandidacy.tsx` in the approved-candidate branch
  and the pending branch, so a candidate sees it as soon as it is set.
- `AdminCandidates.tsx:246,259` now resolve a real date. The "Send Rules Discussion Meeting
  Notice" button is disabled when no meeting date is set, instead of sending a placeholder.
- `supabaseData.ts:613` currently hardcodes `rulesDiscussionAt: undefined`; it is mapped properly.

**093 — the Campaign window is a locked record**
- The window (`campaign_start_at` / `campaign_end_at`) used to be written by the plain schedule
  editor — a bare `UPDATE` on `election_periods` whose RLS policy only checks
  `current_app_role() = 'admin'`. Every other stage action goes through a role-guarded RPC;
  the campaign window was the one window any administrator could rewrite at will.
- New RPC `save_campaign_window_rpc(p_election_id uuid, p_campaign_start_at timestamptz,
  p_campaign_end_at timestamptz)` records the window. Guards, in order: the admin gate, the
  commissioner gate (`current_commissioner_role() in ('electoral_board','chief')`), both dates
  present, end after start, and the election still being in the `campaign` stage. It writes only
  the two window columns — never `lifecycle_stage` — and inserts its own `audit_logs` row.
- `buildElectionPeriodSyncPayload` no longer carries `campaign_start_at` / `campaign_end_at`,
  so a Stage 4 "Save Schedule" click cannot rewrite the window behind the RPC's stage guard.
  The RPC is the single writer.
- **UI rule:** once the window is saved, both date pickers are **disabled** and the
  "Update Campaign Window" button goes **dead** (greyed out, with a tooltip pointing at the
  edit icon). The **Commissioner of Electoral Board** is offered an **icon-only pencil button
  beside the Campaign End picker** that unlocks the pickers and enables the save button; the
  icon then becomes an **X** that discards the edit and re-locks the window. Other commissioners
  see the window read-only. The editor closes itself when the stage leaves `campaign`
  (End Campaign Early, Open Voting).

---

## Stage 3 — Fingerprint Registration (060)

**Requirement**
- Voters register their fingerprint at the IoT biometric kiosks during this stage.
- It must not overlap the Voting Period and must come before it.
- It ends when Voting starts.

**Implementation**
- Two columns on `election_periods`: `fingerprint_registration_start_at` and
  `fingerprint_registration_end_at` (both nullable `timestamptz`).
- The `lifecycle_stage` CHECK is re-issued to allow `fingerprint_registration`
  (`application | campaign | fingerprint_registration | voting | results | completed`).
- New RPC `start_fingerprint_registration_rpc(p_election_id, p_start_at, p_end_at)`. It refuses
  unless the current stage is `campaign`, so enrolment can only open once the campaign meeting has
  been scheduled — that is what keeps the stage order true. Role gate is the same Election Setup
  gate as the other stage RPCs: `current_commissioner_role() in ('electoral_board','chief')`.
- New RPC `close_fingerprint_registration_rpc(p_election_id)` closes the window early without
  leaving the stage, mirroring `close_candidacy_period_rpc`.
- The UI gate is data-driven: the card stays locked until `rules_discussion_at` is set.
- **No overlap is structural, not a check that can race:** the enrolment window is only ever
  closed in the same statement that opens voting (see Stage 4), so there is never a moment at
  which both are open.

---

## Stage 4 — Voting Period

**Requirement**
- Keep the current set up of Voting Period Schedule
- Starting the Voting Period ends the Campaign Period.

**Implementation**
- The schedule card (date / time / venue / voting method) and the Open Voting / Close Voting
  actions are kept as they are.
- **`open_election_rpc` is re-issued in 060.** It keeps the admin gate and the already-active guard
  from `036_domain_trim.sql:391`, and additionally:
  - moves `lifecycle_stage` to `'voting'` — *this is what ends the Campaign Period*. There is no
    `campaign_end_at` column (036 dropped it), so "the campaign is over" is expressed purely by the
    stage leaving `'campaign'`.
  - stamps `fingerprint_registration_end_at = least(coalesce(end, now()), now())` in the same
    statement, closing an open enrolment window at the exact moment voting opens.
  - writes an audit entry, like every other stage RPC.
- It remains callable to re-open after `close_election_rpc`, where the stage is already `'voting'`.
- It can start from either `'campaign'` **or** `'fingerprint_registration'`: skipping the
  enrolment window does not block the vote.
- The stage label becomes Stage 4 of 5 and reads its state from `lifecycle_stage = 'voting'`
  rather than from `isActive` / `startDate` inference.

---

## Stage 5 — Election Result

**Requirement**
- Check for complaint before announcing the Election result in Homepage (thru "official Result tab")

**Implementation**
- The server-side gate **already exists** and is correct: `publish_results_rpc` calls
  `has_active_complaint_rpc` and raises *"Results cannot be published while a complaint is
  filed."* (`036_domain_trim.sql:472-474`, helper at `028_complaint_lifecycle_rls.sql:177`).
- **The problem was that the UI never surfaced it.** `has_active_complaint_rpc` is already
  granted to `anon`/`authenticated` (`028:199-200`) and was never called from the frontend, so
  the commissioner just hit a raw exception. Now:
  - Stage 5 calls `has_active_complaint_rpc` on mount and again before publishing.
  - A red banner shows the filed-complaint count with a link to `/admin/complaints`.
  - The Publish button is disabled with an explanatory tooltip.
- **Bypass closed:** `ElectoralDashboard.tsx:92-126` has three buttons (Open Candidacy /
  Start Voting / Publish Results) that call `setElectionPeriod` directly — a raw table UPDATE
  that skipped `publish_results_rpc` entirely, and therefore skipped the complaint gate.
  Those buttons are removed; the stat cards stay as read-only.
- "Official Result tab" = the public **Official Results** page (`HomePage.tsx:56-61` ->
  `/past-elections`). It is already gated in the database on `results_published`
  (`053:76-77`), so unpublished results can never leak.

---

## Additional Info — Reset the whole Election Plan

**Requirement**
- Add a Button to reset the whole Election Plan (This is a critical button, Need a Password of
  the electoral Board to continue)

**Implementation**
- New RPC `reset_election_plan_rpc(p_password text, p_school_year text default null) -> jsonb`.
- **Password source correction:** the Electoral Board has **no `auth.users` row**.
  `035_adminprofiles_core.sql:14-16,100-102` moved staff passwords into
  `adminprofiles.password_hash`, and `037` deleted the non-Chief auth identities. So the password
  verifies against `adminprofiles.password_hash` using the exact `023` D-10 branch
  (bcrypt `crypt()` for `$2`-prefixed, SHA-256 fallback) copied from
  `login_staff_direct_v2` (`035:408-418`). The caller's own password is required — it is not a
  shared code.
- Role gate: `current_commissioner_role() in ('electoral_board','chief')`.
- **A delete-based reset is impossible** and is not attempted. Migration 052 makes it
  structurally impossible:
  - `forbid_history_deletion` BEFORE DELETE trigger that always raises (`052:351-359, 386-389`)
  - `revoke delete` on `election_periods`, `candidates`, `votes`, `proclamations`,
    `complaints`, ... (`052:393-407`)
- So the reset is **adaptive**:
  - **Period is clean** (no `candidates` and no `votes`): clear the flags in place —
    `candidacy_open`, `is_active`, `results_published`, `proclaimed`, `proclaimed_at`,
    `election_date`, `end_date`, `rules_discussion_at` -> back to `lifecycle_stage = 'application'`.
  - **Period is dirty** (any candidate or any vote): set it to `lifecycle_stage = 'completed'`
    and INSERT a fresh `election_periods` row. A distinct `school_year` is required because
    `school_year` is UNIQUE (`020:404`); the RPC raises a clear error if it collides.
  - Either way **nothing is deleted.** Archived candidates/votes stay attached to the archived
    row and stay invisible publicly, because `results_published` is false there.
- Writes an `audit_logs` row with `type = 'warning'`.
- UI: destructive button in a password modal at the bottom of the tab. `useConfirm` has no
  input slot, so a small local `PasswordConfirmDialog` is added to this page rather than
  widening the shared hook.

---

## Incidental fixes required by the above

These are not in the original outline but are forced by it:

1. **`syncElectionPeriod:445` hardcodes `school_year: "2026-2027"`** on its lazy insert. Once a
   second period can exist, that insert violates the `020:404` unique index. Must be replaced.
2. **`getCurrentElectionId:1165` and `syncElectionPeriod:435`** both do
   `.maybeSingle()` on `order by election_date desc limit 1` with no stage filter. They must
   filter out `lifecycle_stage = 'completed'` rows, or they can resolve the wrong period.
3. **`livePeriodId` (`partyScope.ts:26-28`) keys off `isActive`**, so after an archive + reset
   two periods mix in the UI. It must key off the period id.
4. **`partyScope.test.ts:86,92`** assert the current `isActive` behavior and must be updated.
5. **`electionSetup.test.ts:48-62` asserts `rules_discussion_at` is *absent*** from the sync
   payload. That test was written when `036` dropped the column and must be updated.
6. **`ElectoralDashboard.tsx:49` links to `/admin/campaign-calendar`**, which is not a registered
   route in `routes.tsx:67-80`. Dead link.

---

## File-by-file change list

**New**
- `supabase/migrations/058_election_lifecycle_stages.sql`
- `supabase/migrations/060_fingerprint_registration_stage.sql`
- `src/app/pages/admin/AdminElectionSetup.test.tsx`

**Modified**
- `supabase/migrations/058` — columns + 4 new RPCs + `submit_candidacy_rpc` guard + grants
- `supabase/migrations/060` — Fingerprint Registration columns, extended stage CHECK,
  `start_fingerprint_registration_rpc`, `close_fingerprint_registration_rpc`, re-issued
  `open_election_rpc` (sets `voting` + closes enrolment) and `reset_election_plan_rpc`, grants
- `src/app/lib/supabaseData.ts` — payload builder (`:417-431`), `mapElectionPeriod` (`:589-616`),
  `getCurrentElectionId` (`:1165`), `syncElectionPeriod` (`:433-466`), 6 new RPC wrappers
- `src/app/context/AppContext.tsx` — `ElectionPeriod` (`:138-161`) + `emptyElectionPeriod` (`:281-300`)
- `src/app/pages/admin/AdminElectionSetup.tsx` — 5-stage machine, Stage 1/2/3 cards, complaint
  pre-check, password-gated reset
- `src/app/pages/admin/dashboards/ElectoralDashboard.tsx` — remove `:92-126`, fix dead `:49` link
- `src/app/pages/admin/AdminCandidates.tsx` — disable meeting notice when no date set
- `src/app/pages/student/StudentApplyCandidacy.tsx` — closed-period gate + meeting date display
- `src/app/lib/partyScope.ts` — `livePeriodId` keys off period id
- `src/app/lib/__tests__/electionSetup.test.ts` — payload assertions
- `src/app/lib/__tests__/partyScope.test.ts` — livePeriodId assertions

**Deliberately NOT changed**
- The six dead fields on `ElectionPeriod` (`nominationOpen`, `officialListPosted`,
  `campaignStartDate/Time`, `campaignEndDate/Time`, `planFinalized`) are hardcoded constants
  since migration `036` dropped their columns. They are left alone because `officialListPosted`
  is still read by `StudentCandidates.tsx:27` and `DashboardSidebar.tsx:187-192` — removing it
  is a behavior change, not a cleanup.

---

## Verification

`npm run typecheck` -> `npm test` -> `npm run build`.

The dev server is not started and the site is not manually tested (per AGENTS.md).

No pgtap / SQL tests are added: the repo has none, and `npm run test:db` has no fixtures to
extend. All new test coverage is vitest.

---

## Defaults chosen (pending confirmation)

Two points in the original outline were underspecified. Implementation defaults were picked so
work is not blocked; both are one-line changes if you want them different.

1. **Who may run the reset** — `electoral_board` **and** `chief`. Rationale: the Chief appoints
   the commissioners, so locking them out of a recovery action is worse than allowing it. Change
   to `= 'electoral_board'` if you want it strictly Electoral Board.
2. **How strictly the application window is gated** — on `candidacy_open` alone, not on
   `lifecycle_stage`. Rationale: a student who is mid-submission is not locked out by a stage
   transition. The stricter version adds
   `and lifecycle_stage = 'application'` to the `submit_candidacy_rpc` guard.
