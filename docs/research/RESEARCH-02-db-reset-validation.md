# RESEARCH-02: Fresh-Reset Parity Validation (D-13)

> Phase 01 · Test Harness & Research Foundation · Plan 04
> Status: **evidence pending** — every row below is "pending user/CI run" until the user runs the Plan 03 evidence commands and CI executes the Plan 04 matrix
> Decision anchor: CONTEXT D-02 (fresh-reset parity validated and recorded), D-13 (patch state vs hosted state)

---

## 1. Purpose

Record the parity comparison between the **hosted patched state** (the Supabase dashboard-run scripts plus the out-of-band `fix_storage_and_audit.sql` patch) and the **fresh-reset chain state** (`supabase/migrations/001-021` + `supabase/seed-demo.sql` wired through `[db.seed]` in `supabase/config.toml`). This is the evidence D-02 requires before the patch file can be retired, and it feeds the Plan 04 `docs/apply-runbook.md` follow-up decisions.

## 2. Evidence status (read this first)

**Rule: do not fabricate numbers.** The two evidence sources have not produced captured output yet:

| Evidence source | Status | Consequence |
|---|---|---|
| Plan 03 user-run checkpoint (`npx supabase db reset` + `npx supabase test db`) | **SKIPPED by explicit user decision** — `01-03-SUMMARY.md` contains no captured command output | every human-run row below = `pending user/CI run` |
| Plan 04 CI matrix (`database-tests.yml`: `supabase db start` + `supabase test db` + edge-function deno tests) | workflows authored in this plan; first execution happens on the user's next push | every CI row below = `pending user/CI run` |

Expected inputs once the evidence lands, per `01-03-PLAN.md`:
- `npx supabase db reset` output confirming the 001-021 chain applies cleanly on a fresh DB (migration apply order, seed run).
- `npx supabase test db` output showing the Plan 03 pgTAP suite green across schema / login / seed-neutrality / audit contracts.
- CI job log of `database-tests.yml` (ubuntu runner, local container only).

## 3. Parity table: hosted patched state vs fresh-reset chain

Hosted patched state = `fix_storage_and_audit.sql` **+ the 7 dashboard-run scripts (002-006/008-013/015)**, applied manually in the Supabase dashboard.
Fresh-reset chain state = **001-021** (`supabase/migrations/`) **+ `seed-demo.sql`** (`[db.seed]` wiring; never `db push`).

| # | Object | Hosted patched state | Fresh-reset chain (001-021 + seed-demo.sql) | Expected parity | Evidence |
|---|---|---|---|---|---|
| 1 | Storage policy `candidate pictures public write` (INSERT, bucket `candidate-pictures`) | present (patch FIX 1) | present (020 FIX 1, `create policy`) | match | pending user/CI run |
| 2 | Storage policy `candidate pictures authenticated write` | absent (patch FIX 1 drops it) | absent (020 drops it) | match (absent on both) | pending user/CI run |
| 3 | Storage policy `candidate documents own read` (SELECT, buckets `candidate-documents` + `candidate-pictures`) | present | present (020 FIX 1) | match | pending user/CI run |
| 4 | Storage policy `private election docs upload` (INSERT, `candidate-documents` + `nomination-documents`) | present | present (020 FIX 1) | match | pending user/CI run |
| 5 | `insert_audit_log_rpc` — invalid-role handling + students-not-in-profiles | patched (patch FIX 2) | present (020 FIX 2, `create or replace`) | match | pending user/CI run |
| 6 | `submit_candidacy_rpc` — null actor_id for student audit rows | patched (patch FIX 3) | present (020 FIX 3) | match | pending user/CI run |
| 7 | Functional bootstrap — chief admin (profiles/commissioners), `election_periods` 2026-2027, `report_templates` (16 enclosures) | present (option-a decision) | present (020 bootstrap, `ON CONFLICT DO NOTHING` only) | match | pending user/CI run |
| 8 | Demo students (LRN prefix `136400%`) + masterlist + parties + candidacy slates | present (seeded long ago) | present (seed-demo.sql BLOCK 1; 021 deletes the 016 generator rows) | match | pending user/CI run |
| 9 | Demo officer accounts (`president@cnnhs.edu` … `grade12.rep@cnnhs.edu`, fixed UUIDs from 007) | present | present (seed-demo.sql; 021 neutralizes the 001/007/016 resurrection paths) | match | pending user/CI run |
| 10 | `storage.objects` bucket set (`candidate-pictures`, `candidate-documents`, `nomination-documents`) | present | present (buckets pre-date 020; 020 only adjusts policies) | match | pending user/CI run |

## 4. Known residuals and flags

| ID | Residual / flag | Follow-up action | Owner |
|---|---|---|---|
| RESIDUAL-1 | `fix_storage_and_audit.sql` (repo root) duplicates what 020 now folds in additively | **delete the patch file once the user confirms parity in the dashboard** (rows 1-6 above all "match") — documented in `docs/apply-runbook.md` | user (AGENTS.md / D-11) |
| RESIDUAL-2 | **Pitfall 4 flag:** CONTEXT D-01 names "the 7 dashboard-run scripts (002-006/008-013/015)" but the migration header audit yields `{002,003,004,006,007,010,013,014,017}` — the sets do not exactly match | resolved in Plan 01-02 via **content-drift** consolidation (additive patch-first migrations), not header matching; flagged here so the user knows the hosted set is authoritative | agent (recorded) / user (acknowledge) |
| RESIDUAL-3 | Historical origin scripts (`002-006/008-013/015` dashboard-run SQL plus the `016` seed generator) remain as the chain record | no action in Phase 1; the additive chain (D-01) keeps re-runs idempotent — removing/marking them is a Phase 2 hygiene item | deferred |
| RESIDUAL-4 | **Known-default credential flag (WR-03):** 020's chief-admin bootstrap seeds the repo-visible password (`crypt('chief123', …)`) — anyone with repo access knows the initial admin credential | rotation is a **REQUIRED** runbook step (apply-runbook §Step 4) with a mechanical gate: the `password_still_default` spot-check must return `false` before the site is reachable; re-applying 020 never re-seeds the password (`ON CONFLICT (id) DO NOTHING`), so rotation survives re-apply | user |

## 5. How the evidence gets captured (when the user / CI runs it)

```bash
# Evidence block A (user, local — mirrors Plan 03):
npx supabase db reset          # capture output -> paste under "Evidence block A"
npx supabase test db           # capture output -> paste under "Evidence block A"

# Evidence block B (CI, database-tests.yml job log):
#   supabase db start
#   supabase test db
```

SQL spot-checks to run against both states (hosted dashboard editor and local `psql`):

```sql
-- storage policies present / absent per rows 1-4
select policyname, cmd, qual, with_check
  from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- audit + candidacy rpc live per rows 5-6
select to_regprocedure('public.insert_audit_log_rpc(text,text,text,text,text,text)') as audit_rpc,
       to_regprocedure('public.submit_candidacy_rpc(text,jsonb,uuid,text,text,text)')  as candidacy_rpc;

-- seed state per rows 8-9
select count(*) as demo_students from public.students where lrn like '136400%';
select count(*) as demo_officers from public.profiles where email in
  ('president@cnnhs.edu','vice.president@cnnhs.edu','secretary@cnnhs.edu','treasurer@cnnhs.edu',
   'auditor@cnnhs.edu','pio@cnnhs.edu','protocol@cnnhs.edu','grade7.rep@cnnhs.edu',
   'grade8.rep@cnnhs.edu','grade9.rep@cnnhs.edu','grade10.rep@cnnhs.edu',
   'grade11.rep@cnnhs.edu','grade12.rep@cnnhs.edu');
```

## 6. Idempotency / no-op re-apply (why re-runs are safe)

- **020** is a **no-op** on re-apply against a hosted DB that already carries the patch: every FIX is `drop policy if exists` / `create or replace function`, and the bootstrap rows are `ON CONFLICT DO NOTHING` (no password resets, no row updates, F-02 verbatim-compatible). The `election_periods` bootstrap is a true no-op only because 020 now heals duplicates and adds the `election_periods_school_year_key` unique index on `school_year` before the targeted `on conflict (school_year)` insert — the earlier draft's bare `on conflict do nothing` had no unique constraint to conflict on and stacked a second `2026-2027` row on re-apply. The chief-admin bootstrap is `ON CONFLICT (id) DO NOTHING`, so a rotated password survives re-apply (RESIDUAL-4).
- **021** is a **no-op** on re-apply: every block is guarded by `IF EXISTS` keyed on the demo pattern (`lrn like '136400%'`, fixed 007 UUIDs, officer email list), and it never inserts data.
- **seed-demo.sql** is **no-op** on re-run for row values: only plain inserts / `on conflict do nothing`, so re-running `supabase db reset` never resets a password (D-08).

## 7. Conclusion (provisional)

On the strength of the structural analysis (chain 001-021 reproduces every object the hosted patch introduces, 020 verbatim-compatible with the patch, 021/seed clamps the legacy generators), the fresh-reset chain is **expected to match** the hosted patched state on all 10 rows — **pending** the user/CI-run evidence that turns "expected match" into "match". Until then no patch file is deleted, and no parity claim is final.