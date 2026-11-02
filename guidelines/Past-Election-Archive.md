# Past Election Archive — implementation handoff

Status: **implemented, pending database application.** One migration (`061_past_election_candidates.sql`)
plus this document. No frontend file changed. Verified with `npm run typecheck` (clean),
`npm test -- --run` (166/166 pass) and `npm run build` (succeeds).

The SQL has been statically reviewed but **never executed** — there is no local PostgreSQL,
Supabase CLI or Docker in this environment, so the migration is **unproven against a real engine.**

---

## 1. What this adds

Three snapshot tables that **freeze** an election's final tally, plus the RPCs that write and read them.

| Table | Grain | Holds |
| --- | --- | --- |
| `public.past_election_candidates` | one row per approved candidate | position, frozen name, grade level, `party_id`, `party_name`, `picture_url`, final `votes`, `is_winner`, `proclaimed_winner` |
| `public.past_election_positions` | one row per position | `votes_cast`, `abstentions`, `winner_candidate_id` |
| `public.past_election_periods` | one row per election | `positions_contested`, `approved_candidates`, `votes_cast`, `abstentions`, `total_ballots` |

All three carry `election_period_id` (FK → `election_periods(id) on delete restrict`) and a
`snapshot_at` stamp.

**Why a table at all:** `053_past_election_results.sql` already serves past results, but it *derives*
them from the live `candidates` / `parties` / `votes` tables on every read. A published result was
therefore never actually frozen — renaming a party, editing a candidate, or repointing rows between
periods (see `AZ/repoint_election_period_*.sql`) rewrites history. The snapshot decouples the archive
from the live rows.

## 2. Design decisions (and why)

- **`party_id` / `candidate_id` are plain `uuid`, with no foreign key.** The whole point is that the
  archive survives whatever happens to the live rows. An FK here would re-introduce exactly the
  composite-FK deadlock that `AZ/repoint_election_period_1d8b68f5.sql` has to work around.
  `election_period_id` *does* keep its FK, because `052` guarantees election periods are never deleted.
- **`party_name` is stored as text** next to the id, so a later party rename cannot rewrite history.
- **Snapshot-first, live fallback.** `list_past_elections_rpc()` and `get_past_election_results_rpc(uuid)`
  were re-issued: they use the snapshot when one exists for the period, and otherwise run the original
  `053` derivation untouched. Every election published before this migration keeps rendering exactly
  as it did.
- **A period lists even if it was never `results_published`** — a snapshot is enough. This is how the
  2024-2025 election (which is `lifecycle_stage = 'completed'` but `results_published = false`) becomes
  visible in the Past Election tab.
- **Re-runnable / upsert semantics.** `archive_election_results_internal` deletes this period's rows and
  re-inserts them, so archiving twice is safe and idempotent.
- **Freezing is automatic at two moments**, because one is not enough:
  - `publish_results_rpc` (036 body + one `perform`) freezes the tallies.
  - `proclaim_winners_rpc` (036 body + one `perform`) re-freezes afterwards, so the `proclaimed_winner`
    flags catch up. A snapshot taken at publish time necessarily predates the proclamation and would
    otherwise leave every `proclaimed_winner` permanently `false`.
- **The writer is not a client entry point.** `archive_election_results_internal(uuid)` is
  `security definer` and revoked from `public, anon, authenticated` with **no** re-grant. The owner
  keeps `EXECUTE` after a revoke (the ACL materialises with the owner's default privileges — this is
  why `028`'s `has_active_complaint_rpc` is still callable from `036`'s definer `publish_results_rpc`),
  so the definer RPCs and the SQL editor can still reach it while `anon` cannot. Without the revoke, an
  anonymous caller could force a re-freeze of any period and thereby surface it publicly, since the list
  RPC now treats a snapshot as publication.
- **The EB-facing wrapper** `archive_past_election_results_rpc(uuid)` carries the same gate as `058`/`060`'s
  stage RPCs (`current_app_role() = 'admin'` **and** `current_commissioner_role()` in
  `('electoral_board','chief')`) and writes one `audit_logs` row.

## 3. How to apply

1. Run **`supabase/migrations/061_past_election_candidates.sql`** in the Supabase SQL editor.
   It is a single transaction (`begin;` … `commit;`) and every object is
   `create if not exists` / `create or replace`, so it is safe to replay.

2. Nothing else is required for new elections: publishing results now freezes them automatically.

3. **To freeze an election that already exists** (no snapshot yet, so it still renders through the live
   fallback), either sign in as the Commissioner of Electoral Board and call

   ```sql
   select public.archive_past_election_results_rpc('<election_period_id>');
   ```

   or, for a period that was never `results_published` (such as the 2024-2025 row in `AZ/`), run the
   internal writer from the SQL editor, which executes as the owner and bypasses the client gate:

   ```sql
   select public.archive_election_results_internal('<election_period_id>');
   ```

   The 2024-2025 period in `AZ/election_periods_rows.sql` is
   `a2327f59-f05e-42d8-9518-22f97db37b15`. Running the line above against it is what makes its
   results — 6 parties, 55 candidates, 24 votes — appear in the Past Election tab.

## 4. What did **not** change

- No frontend file. The JSON contract of `get_past_election_results_rpc` and the column list of
  `list_past_elections_rpc` are byte-identical to `053`, so `mapPastElectionResults` /
  `mapPastElectionSummary` and both Past Election pages work unmodified.
- `get_live_results_rpc` (053/051) is untouched.
- `reset_election_plan_rpc` is untouched. Note it archives a period by moving it to
  `lifecycle_stage = 'completed'`; it does **not** snapshot. Snapshotting is the explicit archive call
  or publication.
- The `SVoCK_Kiosk` project is untouched.

## 5. Traps worth knowing

- **Ties.** `is_winner` marks every candidate tied for the position maximum (matching `053`'s
  `top_votes` behaviour). It is not `DISTINCT ON`. The companion `past_election_positions.winner_candidate_id`
  is a single id, so on a tie it stores the lowest candidate id — treat the per-candidate flag as
  authoritative.
- **Abstentions** are `votes` rows with `candidate_id = NULL, abstained = true` (`018`), so they can never
  be counted for a candidate. They are only reflected in the `abstentions` totals.
- **Positions with no approved candidates** (or where every candidate was rejected after voting) produce
  no `past_election_positions` row and no candidate rows. This matches `053`, which derives its
  position list from the candidate tallies too.
- **`drop function if exists` before `publish_results_rpc` / `proclaim_winners_rpc`** is deliberate and
  matches `036`'s additive-first contract.
- **Re-publishing replaces the snapshot**, per the approved design. If results are published, then live
  data changes, then results are published again, the archive changes with them.
- **`picture_url` was added** to `past_election_candidates` beyond the originally planned column list, so
  the detail page renders candidate avatars for archived periods instead of the placeholder.

## 6. Verification performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test -- --run` | 166 passed / 17 files |
| `npm run build` | succeeds |
| dollar-quote balance in `061` | 6 `as $$` / 6 `$$;`, 1 `begin;` / 1 `commit;`, 6 functions, 3 tables |
| latest definitions confirmed | `036` still the newest `publish_results_rpc` / `proclaim_winners_rpc`; `053` still the newest past-election RPCs — so the `061` re-issues are based on the live bodies |

**Not yet verified:** execution against PostgreSQL. The migration is unproven until it is applied.

## 7. 085 — the complaint record joined the archive

`085_archive_complaints.sql` extends the freeze to a period's **complaints**, so resetting an
election archives them along with it (the tallies alone no longer tell the whole story).

- **New snapshot table `past_election_complaints`** — one row per complaint filed against the
  period, frozen denormalized: `student_name` (the live FK is `on delete set null`, so only the
  snapshot keeps the name forever), `subject`, `description`, the complaint's final `status`
  (a filed-but-never-decided complaint freezes as filed — the record shows what was left open),
  `resolution_note`, `resolved_by_name` (from `adminprofiles.full_name`), the timestamps and
  `archived_document_url`. `complaint_id` is a plain uuid for traceability — the same
  no-FK independence rule as `candidate_id`/`party_id` after `064`.
- **ADMIN-ONLY READ.** Unlike the three public tally tables, this snapshot's RLS mirrors the
  `028` complaints rule: `for select using (public.current_app_role() = 'admin')`. Complaint
  text and student names are sensitive; the public Past Election pages never see the rows
  (they keep the `proclamation_complaint_note` badge). Writes are revoked from every client
  role; the definer writer is the only mutation path.
- **The writer grew one block.** `archive_election_results_internal` is re-issued (the `065`
  body verbatim plus a complaint freeze, which — like every snapshot here — deletes the
  period's rows first and re-inserts). Because `reset_election_plan_rpc` (078), `publish_results_rpc`,
  `proclaim_winners_rpc` and the manual EB freeze all call this single writer, every archive
  path now carries the complaint record. The live `complaints` rows are still never deleted.
- **Frontend (admin-only surface):** `listArchivedComplaints()` in `supabaseData.ts` reads the
  table best-effort (empty record, never an error) and `AdminArchive` merges the frozen records
  into its list, skipping a snapshot entry whose `complaint_id` is still readable live — a live
  row is fresher and can still be decided after a freeze.

