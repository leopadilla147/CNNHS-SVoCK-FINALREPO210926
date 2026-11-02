# Party Scope + Party-President Approval — implementation handoff

Status: **implemented, pending database application.** The frontend and all four migrations are
written and the frontend is verified (`npm run typecheck` clean, 140/140 tests pass, `npm run build`
succeeds). The SQL has been statically reviewed but never executed — there is no local PostgreSQL,
Supabase CLI or Docker in this environment, so **the migrations are unproven against a real
engine.** `052_party_election_scope.sql` has been applied to the live project. `053` failed on a
PL/pgSQL bug that has since been fixed but **not re-run**, and `054`/`055` have never been run, so
the live database may hold partial state from the `053` attempt.

Read §0 and §9 before touching anything. §0 lists the traps that already cost three failed
migration runs.

**Apply order is now `052` → `053` → `054` → `055`.** `052` is already applied — do not re-run it.

**What changed since this document was first written** (the sections below are the original spec
and still describe the intent — read them alongside these deltas):

- `055_party_seat_contests.sql` is new and makes party offices **contestable**, superseding §2's
  "first come, first served" seat rule. It has two parts:
  1. drops `001:269` `unique (election_period_id, party_id, position)`, which was the actual cause of
     `duplicate key value violates unique constraint
     candidates_election_period_id_party_id_position_key`. `001:268`
     `unique (student_id, election_period_id)` is **kept** — one candidacy per student per
     election. `054`'s `candidates_one_approved_per_party_position` and
     `candidates_one_approved_president_per_party` remain the guards that matter: many requests
     per office, exactly one winner.
  2. adds `candidates_one_president_per_party` (a `BEFORE INSERT OR UPDATE` trigger) requiring that
     the party agrees on its presidential nominee before the row is written. This part is **not
     optional.** `052:713-725` deliberately exempts a President applicant from the "party must have
     an approved President" check, and `269` was the only thing stopping a second President
     candidacy per party. Without the trigger, dropping `269` would let one through that nobody can
     ever resolve: `054:277` blocks the party President from deciding it, `054:281` closes the
     request, `054:462` blocks re-application, and Screening's approval would then violate
     `candidates_one_approved_president_per_party`.
  - Known gap `055` does not close: `052:694-705` recovers a same-name party race by adopting the
    winner's `parties` row, but the candidate insert that follows (`:737`) still collides. `055`'s
    trigger converts that collision into a readable message; fully fixing it means editing the
    already-applied `052` RPC, so it is left as a follow-up.
- Seat availability is now **grade-relative and winner-based** (§7). `partySeatSummaries` reports
  each seat of the student's own grade roster as `open` / `contested` / `filled`, and only `filled`
  blocks an applicant. A seat that merely has other requests in it stays open, which is what makes
  the contest real.
- The party picker now lists **every** party of the live period, read from `public.parties`, with
  blocked ones disabled and the reason shown (§7). Parties without a screening-approved President
  and full parties are both visible but cannot be selected, so the roster is never silently
  truncated.

- `052_party_election_scope.sql` was rewritten from 996 lines to ~790. Its backfill now has a
  candidate-side **repair pass**, labelled `SECTION 2b — REPAIR PASS` in the file, so a re-run after
  a half-applied backfill converges instead of aborting on the composite foreign key.
  `candidates_party_election_fkey` is now dropped before being re-added so a re-run does not fail
  on the constraint it already created.
- `submit_candidacy_rpc` now refuses a non-President joining a party that has no approved
  President. The Apply page already hid those parties, but the picker is a convenience, not a rule.
- `054_party_president_approval.sql` is new and contains everything in §5 and §6, plus:
  - `candidates_one_approved_president_per_party`, a second partial index. The index in §5.1 cannot
    catch this case, because a President is approved by Screening and so never passes through
    `presidentApproved`. Without it, `is_party_president()` and `parties.president_student_id` would
    both have to guess which of several approved Presidents actually presides.
  - `sync_party_president_on_screening` now also moves a party's already-pending candidates onto
    the gate at the moment its President is approved, which is what §5.5 claims but did not do.
    A party approved *after* this migration would otherwise hold candidates that the §5.4 trigger
    can never rule on, stranding the Screening Office on an error the student cannot act on.
- The frontend work in §7 is complete, including the §7 requirement to stop sending
  `positionApprovalStatus`: it is now stripped from `p_candidate_data` before the RPC is called.
  Two defects found while doing it are worth knowing about:
  - `StudentApplyCandidacy` chose its party mode once at mount, but the party list arrives with the
    async Supabase fetch, so a student landing mid-load was parked on "Independent" and never shown
    the picker. It now follows the list until the student picks for themselves.
  - `AdminCandidates` filtered its actionable list to party candidates waiting on their President
    for **all** roles; per §7 that filter is Chief-vs-Screening, so the Chief keeps full visibility
    and gets an "Awaiting party President" hint instead.

**Provenance:** every file path, line number, SQL signature, policy name and constraint name in
this document was verified against the working tree on the date it was written. In
particular these are confirmed, not assumed:

- `request_party_membership_rpc(uuid, uuid)` and `review_party_membership_rpc(uuid, text,
  uuid)` exist with **exactly** those signatures (`011_notifications_and_party_members.sql:83`
  and `:142`).
- `052_party_election_scope.sql` was 996 lines when written; it has since been rewritten, so the
  line numbers in §4 are historical. The section names are unchanged.
- The `nominations` and `proclamations` rows in the retention loops are skipped by
  `information_schema` / `to_regclass` guards, so those loops are safe as written.
- There is **no** `student_session_policies` helper anywhere in `supabase/migrations/`. The
  policy in §6 is a plain standalone policy, not a call into a shared helper. If you want the
  named-helper style it must be written from scratch in `054`.
- `Supabase` (the npm client) and `safeSelect` are already used in `supabaseData.ts`; both new
  RPC wrappers go in that file.
- Both session helpers exist and are `anon`-executable, which is what lets the §5 RPC bodies
  and the §6 policy read identity from inside the database:
  `public.current_app_role()` (`001:27`, redefined `022:144`, granted `022:266-267`) and
  `public.current_session_user_id()` (`022:114`, granted `022:272-273`).

---

## 0. Traps (read first)

1. **Never round-trip these files through PowerShell `Get-Content -Raw` + `WriteAllText`.**
   Windows PowerShell 5.1 decodes BOM-less UTF-8 as Windows-1252, so every em-dash becomes
   `â€”`. It already corrupted 20 characters in `052`/`053`, 5 of them inside user-facing
   string literals. Use the editor tools, which are UTF-8 safe. If you must script, use
   `[System.IO.File]::ReadAllText` + `[System.IO.File]::WriteAllText` with an explicit
   `New-Object System.Text.UTF8Encoding($false)`.
2. **The SQL runner commits between statements and may open a new session per batch.** A
   `create temp table … on commit drop` vanished mid-script (`relation
   "party_election_scope_map" does not exist`). Scratch state must be a real table.
3. **`public.election_periods` has NO `created_at`.** Only `updated_at` (from `001`).
   `036_domain_trim.sql` dropped `start_at`, `end_at`, `nomination_open`,
   `rules_discussion_at`, `campaign_*`, `official_list_posted`, `plan_finalized`. Recency
   ordering must use `election_date desc nulls last, school_year desc, id`.
4. **`public.nominations` no longer exists** (removed from the system). Any reference to it
   fails with `42P01`. `052` already skips it dynamically.
5. **RLS policies are OR'd.** You cannot hide rows by adding a policy. Restricting access
   requires dropping and re-creating the existing policy.
6. **The platform role is always `anon`.** This is not Supabase Auth; it is a custom session
   spine (`022_session_spine.sql`). Every RPC is granted to `anon` only, and the real gate is
   an in-body session check. Mirror the grant posture in
   `044_submit_candidacy_session_actor.sql:312-313`:
   `revoke all … from public, anon, authenticated` then `grant execute … to anon`.
7. DB changes ship as numbered files under `supabase/migrations/`. **The user applies them in
   Supabase.** Do not run them, do not run the dev server, do not commit.

---

## 1. Context: what already exists

- `001_initial_schema.sql:5` — `adminprofiles.commissioner_role` is `not null unique`, CHECK
  `('chief','screening_validation','appointment','electoral_board','grievance')`. So exactly
  one person holds each role and `current_commissioner_role() = 'chief'` reliably identifies
  the Chief.
- `001_initial_schema.sql:558` — policy `"candidates readable"`: `status = 'approved' OR
  current_app_role() = 'admin' OR own row (auth.uid)`.
- `043_student_session_self_access.sql:62` — policy `"candidates self session select"`:
  a student reads only their own row, any status.
  **Consequence: a student session cannot read pending candidates. The party President needs
  one new additive policy (§4) or their dashboard is impossible.**
- `001_initial_schema.sql:568` — policy `"candidates owner admin update"` (`for update`), the
  hole the §5.4 trigger closes.
- `036_domain_trim.sql:262` — `review_candidacy_rpc(candidate_id, action, reason, details,
  tier)`: admins only, requires `status = 'pending'`, sets `approved`/`rejected` plus
  `rejection_tier`, writes `audit_logs`, and sends **no** student notification.
- `001_initial_schema.sql:262` — `candidates.status` CHECK is
  `('ongoingSubmission','pending','approved','rejected')`.
- `001_initial_schema.sql:260` — `candidates.position_approval_status` CHECK is
  `('notRequired','presidentApprovalRequired','presidentApproved')`. **Nothing sets this
  column.** `017_party_president_notification.sql:228` and `052:795` copy it from the client
  payload — a hole to close.
- **`StudentApplyCandidacy.tsx` already implements the whole UI grammar** — do not rebuild it:
  - `:269` `partyMode: "existing" | "new" | "independent"`
  - `:435-436`, `:591` `"new"` forces `position = "President"` and files under `newPartyName`
    → this is the party bootstrap path
  - `:437`, `:438` `"independent"` allows any position
  - `:521-524` `"existing"` blocks an occupied position for the selected party
  - `:614` the client currently sends `positionApprovalStatus`
- No frontend code queries the `parties` table directly. Party names arrive by **PostgREST
  resource embedding**, `parties(name)`, on the candidate select:
  `AppContext.tsx:493` (mapped at `:499`), `supabaseData.ts:357` (mapped at `:619`),
  `supabaseData.ts:1096` (mapped at `:1118`). The embedding rides the `candidates.party_id`
  FK, so it keeps working after `052` adds the composite FK. `president_student_id` is read
  nowhere in `src/`.
- `candidates.position` CHECK (`001:11`) is the 13 positions: President, Vice President,
  Secretary, Treasurer, Auditor, PRO, PIO, Protocol Officer, Grade 7–12 Representative.
- Tests: 16 files, 105 cases, all green. `npm run typecheck` clean. `npm run build` warns
  the main chunk exceeds 500 kB (not a blocker).

---

## 2. Decisions (settled with the user — do not relitigate)

| # | Decision |
|---|---|
| D1 | `parties` gets `election_period_id`; one row **per party per election**. The same name may repeat in a later election. A new election requires new party rows. |
| D2 | `party_members` is **deleted entirely**, plus `request_party_membership_rpc` and `review_party_membership_rpc`. |
| D3 | `candidates.party_id` is the only link saying "this candidate is in that party in that election". Enforced by a composite FK. |
| D4 | A join request lives on the candidate row via `position_approval_status`. No new table. |
| D5 | Auto-rejected candidates get `position_approval_status='presidentRejected'`; their `status` is untouched and they may re-apply if the slot reopens. |
| D6 | Only the **party President** may approve/reject. No Chief fallback. |
| D7 | Screening is blocked until `presidentApproved`; the screening commissioner's list is filtered in the UI. **No restrictive RLS.** |
| D8 | A party becomes **joinable** only after its President is screening-approved. The Apply tab's `"new"` mode is how a party gets created. *(Superseded: the party list now shows every party of the live period, with the un-joinable ones disabled and the reason shown, rather than hiding them.)* |
| D9 | ~~Exclusivity is **one candidate per position per party**.~~ **SUPERSEDED by `055`: offices are contestable.** Several students may run for one office of one party; the party President picks the winner. Independents bypass the party gate and were always contestable (`001:269` treats NULL party ids as distinct). |
| D9b | A party is "full" for a given student only when **every seat on that student's own grade roster** already has a winner. A Grade 11 student's roster is 9 seats — the 8 executive offices plus `Grade 11 Representative` — so a party with all 8 executive seats filled is still open to a Grade 11 student. |
| D9c | **One President per party, per election**, enforced by trigger in `055`. The President seat is only claimable by creating the party; a joiner is never offered it. |
| D10 | The gate applies retroactively to still-`pending` live-period party candidates. |
| D11 | `parties.description` and `parties.president_student_id` stay. The president column is display-only; authorization derives from the candidate row. |

---

## 3. The flow being built

1. Student registers a new party (`"new"` mode) or picks an existing approved-President party,
   chooses a position, uploads the EAF. `finalize` sets
   `position_approval_status = 'presidentApprovalRequired'` — set by the database, not the
   client. The President and Independents get `'notRequired'`.
2. Once screening approves the President, that party appears in everyone's party list.
3. The party President's dashboard shows the party roster grouped by position, each pending
   request sitting under the position it wants.
4. President approves → that candidate becomes `'presidentApproved'`, and in the same
   transaction every other request at that position in that party flips to
   `'presidentRejected'`. Reject → `'presidentRejected'` directly.
5. `review_candidacy_rpc` is blocked by a trigger until the gate is `'presidentApproved'`.
6. If a slot reopens, the rejected student re-applies via `reapply_party_candidacy_rpc`;
   approving then auto-rejects the others again.

---

## 4. Migration `052_party_election_scope.sql` — rewrite in place

Idempotent, so re-running on a partially-migrated database is the intended recovery path.

### Keep
- `parties.election_period_id` (nullable on add; `set not null` in §4) at `:34`.
- `party_election_scope_map` scratch table at `:46-59` — a **real** table
  (`create table if not exists` + `truncate` + `enable row level security`), dropped at `:308`.
  Permanent because of trap §0.2. RLS with no policies keeps `anon` out.
- `alter table public.parties drop constraint if exists parties_name_key` at `:64` — must
  precede the clone backfill or a party in two periods cannot be cloned. (Dropped again at
  `:316` in Section 4; harmless.)
- Section 2 clone backfill `:67-180`: a legacy party keeps its own row for the period it
  already owns (or the one with the most candidates; oldest period as tie-break), is cloned
  for every other period it appears in; `candidates.party_id` remapped at `:174-176`.
- `parties_election_period_id_fkey`, `parties_election_period_name_key`,
  `parties_id_election_period_key`, `candidates_party_election_fkey` at `:313-337`.
- Section 5 retention (`:375-507`) minus the `party_members` entries, including the
  data-driven FK loop at `:389-400` (nominations rows at `:396-397` are skipped by an
  `information_schema` check) and the guarded `revoke delete` loop at `:495-503`.
- Section 6 `parties` policies: drops at `:536-537`, recreated at `:539-560`.
- Section 7 `submit_candidacy_rpc` (`:583-838`) minus the client-trust bug.

Section map for the rewrite: 1 = `:32-66`, 2 = `:67-180`, 3 = `:181-310`, 4 = `:311-374`,
5 = `:375-507`, 6 = `:508-582`, 7 = `:583-838`, 8 = `:839-996`.

### Delete
- `party_members` column + index (`:37`, `:43`).
- Section 3 entirely (`:181-310`): `party_members_scoped`, the two-pass membership split, the
  "would drop memberships" guard, the rebuild.
- Section 4 `party_members` constraints (`:339-372`).
- Section 6 `party_members` policies (`:563-580`, drops at `:563-565`).
- Section 8 entirely (`:839-996`): `request_party_membership_rpc`,
  `review_party_membership_rpc`.
- `party_members` from the retention link list, the `revoke delete` array (`:497`) and
  `forbid_student_deletion_with_history` (`:462`, trigger at `:482`; the `party_members`
  checks are `:470-471`) — the trigger then checks `candidates` + `votes` +
  `parties.president_student_id` only.

### Amend
- **Rewrite `is_party_president` (`:514-534`).** The current body at `:524-530` authorizes off
  `parties.president_student_id`, which D11 makes display-only. It must instead look for the
  caller's **approved President candidacy** on that party. Collapse to a single argument
  `is_party_president(p_party_id uuid)` — the period argument is redundant now that the party
  row carries its period — and rewrite the grants at `:533-534` to
  `is_party_president(uuid)`. This is the function the RLS policy in §6 depends on.
- "Unreferenced party" rule at `:143-152` becomes zero candidates (members no longer exist);
  the `v_member_count` query at `:146-147` goes away.
- New pass after the candidate remap, so a cloned row's president is the student who actually
  ran as President there rather than a copy of the old row's value:
  ```sql
  update public.parties p
  set president_student_id = c.student_id
  from public.candidates c
  where c.party_id = p.id
    and c.election_period_id = p.election_period_id
    and c.position = 'President'
    and c.status = 'approved'
    and p.president_student_id is distinct from c.student_id;
  ```
- New teardown block (run before the drop so no function is left pointing at a missing table):
  ```sql
  drop function if exists public.request_party_membership_rpc(uuid, uuid);
  drop function if exists public.review_party_membership_rpc(uuid, text, uuid);
  drop table if exists public.party_members;
  drop table if exists public.party_members_scoped;
  ```
  Both signatures are confirmed against
  `011_notifications_and_party_members.sql:83` (`request_party_membership_rpc(uuid, uuid)`)
  and `:142` (`review_party_membership_rpc(uuid, text, uuid)`) — match them exactly or the
  drop silently no-ops.
- `submit_candidacy_rpc` stops reading `p_candidate_data->>'positionApprovalStatus'` at
  **`:810`** and sets the gate itself: `'presidentApprovalRequired'` when a party was chosen
  and the position is not President, `'notRequired'` otherwise. `finalize` re-stamps it on
  first submission and raises "this position is filled" if the row is already
  `'presidentRejected'`.
- The party upsert in `create` stays keyed on `(election_period_id, name)` — it is the
  "register a new party" path from D8.

---

## 5. Migration `054_party_president_approval.sql` — new file

Order: `052` → `053` → `054`.

### 5.1 Vocabulary and decision record
```sql
alter table public.candidates drop constraint if exists candidates_position_approval_status_check;
alter table public.candidates
  add constraint candidates_position_approval_status_check
  check (position_approval_status in
    ('notRequired','presidentApprovalRequired','presidentApproved','presidentRejected'));

alter table public.candidates
  add column if not exists party_decided_by uuid references public.students(id) on delete restrict;
alter table public.candidates
  add column if not exists party_decided_at timestamptz;
```
Every decision also writes an `audit_logs` row — that is the permanent trail.

### 5.2 `review_party_candidacy_rpc(p_candidate_id uuid, p_action text) returns jsonb`
`security definer`, `set search_path = public, extensions`, granted to `anon` only.

- `v_actor := public.current_session_user_id()`; null → raise; `current_app_role()` must be
  `'student'`.
- Load the candidate. `party_id is null` → raise "Independent candidates do not need party
  approval." `status not in ('ongoingSubmission','pending')` → raise.
- Authorize — this is the whole security surface:
  ```sql
  select c.student_id into v_president_id
  from public.candidates c
  where c.party_id = v_candidate.party_id
    and c.election_period_id = v_candidate.election_period_id
    and c.position = 'President'
    and c.status = 'approved'
  limit 1;

  if v_president_id is distinct from v_actor then
    raise exception 'Only the approved President of that party can decide this request.';
  end if;
  ```
- Target must be `position_approval_status = 'presidentApprovalRequired'`, else raise
  "already decided".
- `approve`:
  - slot check (D9):
    ```sql
    if exists (
      select 1 from public.candidates c
      where c.party_id = v_candidate.party_id
        and c.election_period_id = v_candidate.election_period_id
        and c.position = v_candidate.position
        and c.id <> p_candidate_id
        and c.position_approval_status = 'presidentApproved'
    ) then
      raise exception '% already has an approved candidate for that position.', v_candidate.position;
    end if;
    ```
  - set the winner, then auto-reject the siblings in the same statement pair:
    ```sql
    update public.candidates
    set position_approval_status = 'presidentApproved',
        party_decided_by = v_actor, party_decided_at = now()
    where id = p_candidate_id;

    update public.candidates
    set position_approval_status = 'presidentRejected',
        party_decided_by = v_actor, party_decided_at = now()
    where party_id = v_candidate.party_id
      and election_period_id = v_candidate.election_period_id
      and position = v_candidate.position
      and id <> p_candidate_id
      and position_approval_status = 'presidentApprovalRequired';
    ```
  - notify every affected student (`party_membership_approved` / `_rejected`, with the
    position in the message).
- `reject`: set `'presidentRejected'` + `party_decided_*`, notify, audit.
- Re-assert `parties.president_student_id` from the approved President (self-heal).
- Return `row_to_json(c)`.

### 5.3 `reapply_party_candidacy_rpc(p_candidate_id uuid) returns jsonb`
`security definer`, `anon` execute only. Actor must be the candidate's own student. Requires
`position_approval_status = 'presidentRejected'` and `status in
('ongoingSubmission','pending')`. Requires a free slot (same `exists` check as above) and an
approved President in the party, else raise a message the UI shows. On success: back to
`'presidentApprovalRequired'`, clear `party_decided_*`, notify the President.

### 5.4 Screening gate — trigger, not a function rewrite
```sql
create or replace function public.guard_party_approval_before_screening()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','rejected')
     and new.party_id is not null
     and new.position <> 'President'
     and new.position_approval_status <> 'presidentApproved' then
    raise exception 'This candidate is still waiting for the party President''s approval.';
  end if;
  return new;
end $$;

create trigger candidates_require_party_approval
  before update on public.candidates
  for each row execute function public.guard_party_approval_before_screening();
```
Why a trigger: `review_candidacy_rpc` is `security definer` and already correct, and the
trigger also closes the pre-existing hole where any admin could `PATCH /rest/v1/candidates`
directly (`001:568` policy `"candidates owner admin update"`). It does not fire on
`finalize`, which only moves `status` to `'pending'`. **The `position <> 'President'`
exemption is mandatory** — the President cannot approve themselves, so screening must be able
to approve the President.

### 5.5 Retroactive gate (D10)
```sql
update public.candidates c
set position_approval_status = 'presidentApprovalRequired'
where c.party_id is not null
  and c.status = 'pending'
  and c.position <> 'President'
  and c.position_approval_status = 'notRequired'
  and c.election_period_id = (
    select id from public.election_periods
    where is_active = true
    order by election_date desc nulls last, school_year desc, id
    limit 1)
  and exists (
    select 1 from public.candidates p
    where p.party_id = c.party_id
      and p.election_period_id = c.election_period_id
      and p.position = 'President'
      and p.status = 'approved');
```
Narrow on purpose: live period only, still-`pending` only, and only for parties that already
have an approved President — so it never creates a request nobody can action.

---

## 6. RLS — one additive policy only

No restrictive policy (D7). The one grant that is missing is the President reading their own
party. Policies are OR'd, so this can only **add** access; the worst failure mode is the
President seeing an empty board, never a lockout.

```sql
drop policy if exists "candidates party president session select" on public.candidates;
create policy "candidates party president session select"
  on public.candidates
  for select
  using (
    public.current_app_role() = 'student'
    and public.is_party_president(candidates.party_id)
  );
```
`is_party_president` is `security definer`, which is what stops the policy from recursing into
itself. Fallback if you would rather not touch RLS at all: a `get_my_party_board_rpc()`
`security definer` returning the board, with zero policy changes.

Do **not** re-create `"candidates readable"` to hide gated rows from screening — that is the
one change that could lock the Chief out, and D7 says skip it.

---

## 7. Frontend changes

### `src/app/lib/partyScope.ts`
- `livePeriodPartyNames` (`:18-34`): switch from "any approved candidate carries this party
  name" to "this party has an **approved President** candidate". The `{approvedOnly}` option
  disappears — one rule everywhere (D8).
- `livePeriodPartyId` (`:36-47`) already resolves through the approved President. Keep.
- Add `buildPartyPositionBoard(candidates, partyId)` → per position
  `{ position, approved?, pending[] }`, live period only, President excluded. Pure function,
  unit-tested in `partyScope.test.ts`.

### `src/app/pages/student/StudentApplyCandidacy.tsx`
- `:263` picker = approved-President parties only.
- `:578` `occupiedPositions` must count only candidates still **in the race**
  (`presidentApprovalRequired` or `presidentApproved`). As written it excludes only
  `status === 'rejected'`, so an auto-rejected candidate would hold that position forever and
  re-apply could never succeed.
- `:700` `isNewParty` infers "party founder" from `positionApprovalStatus === 'notRequired'`,
  which breaks the moment the founder is approved. Use
  `!!candidate.partyAffiliation && candidate.position === "President"`.
- `:614` stop sending `positionApprovalStatus` — the database decides.
- `"new"` mode copy should say the party becomes visible to others once the President is
  approved.

### `src/app/pages/student/StudentDashboard.tsx`
- Replace the membership section with the President's board: roster grouped by position, each
  request under the position it wants, Approve/Reject, disabled when the slot is taken.
  Existing anchors: `isPartyPresident` `:82` (currently `myApplication?.status === "approved"
  && position === "President"` — a reasonable starting predicate), `pendingRequests` `:86`,
  `myMemberships` `:97`, `hasPendingMembership`/`hasApprovedMembership` `:102-103`,
  `handleRequestMembership` `:108`, `handleReviewMembership` `:152` (RPC call at `:158`),
  president banner `:302`, request list `:314-323`.
- Non-presidents: read-only slate. A candidate already has a waiting string at `:419`
  ("Waiting for the … president to review your application") and a rejected-state block at
  `:415-425` — extend these to cover `'presidentApproved'` and `'presidentRejected'` plus a
  re-apply action rather than writing new UI from scratch.
- `AdminCandidates.tsx` derives party rosters from `candidates` already (`:287`), so it is
  unaffected by the `party_members` drop.

### `src/app/pages/admin/AdminCandidates.tsx`
- `isChief` is at `:19` and `canReview` at `:23`. When `canReview && !isChief`, the actionable
  list shows only `positionApprovalStatus === "presidentApproved"`, with a gate-state badge.
  Chief keeps the full view.
- The screening action button is the `candidate.status === "pending" && canReview` block at
  `:562` — the trigger in §5.4 is what makes it a no-op for unapproved candidates, so the UI
  filter is belt-and-braces.
- `:326-330` delete the dead "Enable Nomination" button — `nominationOpen` is hardcoded
  `false` in `supabaseData.ts:595` because `036` dropped the column, and the button only flips
  local state.

### `src/app/lib/supabaseData.ts` / `src/app/context/AppContext.tsx`
- Add `reviewPartyCandidacyRpc`, `reapplyPartyCandidacyRpc`; remove
  `requestPartyMembershipRpc` (`:901`), `reviewPartyMembershipRpc` (`:914`).
- `Candidate` gains `partyDecidedAt?`; the `*` in the candidate select picks it up with no
  query change.
- Remove `PartyMember` (interface `AppContext.tsx:231`), the context type entries
  (`:272-274`), the `partyMembers` state (`:317`), `setPartyMembers` (`:485-487`),
  `fetchPartyMembers` (`:489-511`, row mapping at `:496`), its bootstrap call (`:538`), and
  the context value entries (`:581-583`).
- `NotificationBell.tsx` needs no change: the reused
  `party_membership_request` / `_approved` / `_rejected` types already have icons, and reusing
  them avoids touching the `notifications.type` CHECK.

---

## 8. Verification

Local, before touching Supabase:
```
npm run typecheck
npm test
npm run build
```
140 tests today, plus the new contestable-seat cases in `partyScope.test.ts` (`isSeatWinner`,
`partySeatSummaries`, `isSeatSelectable`, `isPartyFullForGrade`, `buildPartyOptions`).

`partyScope.test.ts` contains one **deliberate reversal**: `isPartyPositionOpen` used to return
`false` for a seat that only had a *pending request* in it. Under §2's contestable model that is
wrong — a request is not a win — so it now returns `true` and the test says so in a comment. Do not
"fix" it back.

Apply order: `052` → `053` → `054` → `055`, then `seed-parties.sql` → `seed-candidates.sql`
(`seed-candidates.sql` must run after `seed-parties.sql`). `052` is already applied. Note
`supabase/seed-demo.sql` is stale — it uses `start_at`, dropped by `036` — and will fail.

Before running `055`, confirm the live slate so the party picker's "full" and "awaiting President"
states match reality:
```sql
with live as (select id from election_periods where is_active),
roster as (select p.id, p.name from parties p join live l on l.id = p.election_period_id)
select r.name,
  (select count(*) from candidates c where c.party_id = r.id and c.position = 'President')                                 as pres_rows,
  (select count(*) from candidates c where c.party_id = r.id and c.position = 'President' and c.status = 'approved')         as pres_screened,
  (select count(distinct c.position) from candidates c
     where c.party_id = r.id and c.position <> 'President'
       and c.position_approval_status = 'presidentApproved')                                                                  as seats_won,
  (select count(distinct c.position) from candidates c
     where c.party_id = r.id and c.position <> 'President'
       and c.position_approval_status = 'presidentApprovalRequired')                                                          as seats_contested
from roster r order by r.name;
```
`seats_won` vs `seats_contested` is the important pair: a party whose seats only ever show up in
`seats_contested` is **not** full and is joinable once `055` lands. `pres_rows` of `0` means the
party is orphaned — no President candidacy exists, so nothing will ever open it.

Current-state diagnostic before re-running `052` (its state is unknown; a partial run likely
left the columns, the indexes and a dropped `parties_name_key`):
```sql
select table_name, column_name, is_nullable
from information_schema.columns
where table_name in ('parties','party_members') and column_name = 'election_period_id';

select conname from pg_constraint where conrelid = 'public.parties'::regclass order by conname;

select to_regclass('public.party_election_scope_map') as scratch_map,
       to_regclass('public.party_members_scoped')      as scratch_members;
```

Post-apply checks — all three must pass:
```sql
-- exclusivity: no rows
select party_id, position, count(*) from public.candidates
where position_approval_status = 'presidentApproved'
group by party_id, position having count(*) > 1;

-- screening gate: 0
select count(*) from public.candidates
where status = 'approved' and party_id is not null
  and position <> 'President'
  and position_approval_status <> 'presidentApproved';

-- party scope: 0 and 0
select (select count(*) from public.parties where election_period_id is null) as unscoped_parties,
       (select count(*) from public.candidates c where c.party_id is not null
          and not exists (select 1 from public.parties p
                          where p.id = c.party_id
                            and p.election_period_id = c.election_period_id)) as mismatched,
       (select count(*) from pg_class where relname = 'party_members') as party_members_left;
```

Functional pass, in the app: a second student registers a new party as President → screening
approves → the party appears in another student's picker → that student applies for Secretary
and uploads the EAF → the President's dashboard shows the request under Secretary → approve →
a third applicant for Secretary is auto-rejected → the screening commissioner's list shows only
the approved candidate.

---

## 9. Accepted risks

- **A party with no approved President is frozen** (D6). Nobody can approve or reject, and
  re-apply refuses with "your party President has not been approved yet". Recovery is a new
  President candidate clearing screening. Sharpest edge in the design.
- **The screening gate is RPC + UI, not RLS** (D7). A determined screening commissioner could
  still read those rows through the REST API; they cannot act on them. The trigger is the
  real control.
- **Screening decisions still send no notification.** `review_candidacy_rpc` never did that;
  the President's decisions now do. Asymmetric, pre-existing, not addressed.
- **Anyone who ever ran `052` partially** may have a dropped `parties_name_key` and nullable
  `parties.election_period_id`. The rewrite is idempotent; re-run the whole file.
