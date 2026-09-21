# Apply Runbook — Phase 1 (CNNHS-SVoCK)

Single source of truth for applying every Phase 1 change. Per AGENTS.md, **the agent never touches the hosted database** — all database changes are applied by you (the owner) following this runbook.

What Phase 1 changed:
- **Migration chain 001-021** (`supabase/migrations/`) — the 001-019 originals plus the two additive consolidation migrations:
  - `020_fix_storage_and_audit.sql` — folds in the `fix_storage_and_audit.sql` patch (storage upload RLS, audit-log RPC hardening, candidacy RPC audit fix) + functional bootstrap rows (chief admin, `election_periods` 2026-2027, `report_templates`).
  - `021_neutralize_seed_generators.sql` — existence-guarded deletes that neutralize the legacy demo-data generators in 001/007/016 (never inserts).
- **`supabase/config.toml`** — `[db.seed]` now points at `./seed-demo.sql` (demo data is no longer seeded by migrations).
- **`supabase/seed-demo.sql`** — the consolidated local demo data (students, masterlist, parties, candidacy slates, demo officer accounts).

---

## 1. Hosted database (Supabase dashboard)

Open the **Supabase dashboard → SQL editor** and apply in **this exact order**:

### Step 1 — apply `020_fix_storage_and_audit.sql`

1. Copy the full contents of `supabase/migrations/020_fix_storage_and_audit.sql`.
2. Paste into a new SQL editor query and **Run**.
3. Safe to re-run: every block is `drop policy if exists` / `create or replace function` / `on conflict do nothing` — no data updates, no password resets. The `election_periods` guard is a true no-op now: 020 adds a unique index on `school_year` (after healing any pre-existing duplicate rows) and the insert targets `on conflict (school_year)`, so re-applying cannot stack a second `2026-2027` row.

### Step 2 — apply `021_neutralize_seed_generators.sql`

1. Copy the full contents of `supabase/migrations/021_neutralize_seed_generators.sql`.
2. Paste and **Run**.
3. What it deletes (and only this): dummy students with LRN prefix `136400%`, the 007 fixed-UUID demo accounts (commissioners/adviser deleted **by their demo auth UUIDs**, never by role — real commissioners appointed later with different `auth_id`s are untouched), and the `president@cnnhs.edu` … `grade12.rep@cnnhs.edu` officer emails. Re-running is a no-op (`if exists` guards).

### Step 3 — confirm the changes are live

Run these spot-checks in the SQL editor:

```sql
-- storage policies (expect 3 new rows, no "authenticated write" for candidate pictures)
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects';

-- audit + candidacy RPCs (expect non-null)
select to_regprocedure('public.insert_audit_log_rpc(text,text,text,text,text,text)') as audit_rpc,
       to_regprocedure('public.submit_candidacy_rpc(text,jsonb,uuid,text,text,text)')  as candidacy_rpc;

-- bootstrap rows (expect ≥1 each)
select count(*) from public.election_periods where start_date >= '2026-01-01';
select count(*) from public.report_templates;
```

### Step 4 — rotate the bootstrap admin password (REQUIRED — T-02-02 mitigation)

The `020` bootstrap created a **chief admin** account (option-a decision) seeded with the **repo-visible bootstrap credential**. Any deployment that skips this step ships with a publicly-known default admin password. **Rotation is REQUIRED before the site is reachable:**

- Dashboard → **Authentication → Users** → find the chief admin user → **Reset password** (or delete the user and recreate it with a strong password).

**Then verify mechanically** — run this spot-check in the SQL editor; it must return `false` (a `true` result means the default hash still matches and rotation was skipped — do not proceed until it returns `false`):

```sql
-- expect `false`; `true` means the default chief123 hash still matches
select (select encrypted_password from auth.users
         where id = '11111111-1111-4111-8111-111111111111') =
       crypt('chief123', (select encrypted_password from auth.users
         where id = '11111111-1111-4111-8111-111111111111')) as password_still_default;
```

Note: re-applying `020` never re-seeds the password (the chief bootstrap is `ON CONFLICT (id) DO NOTHING`), so a rotated password survives re-apply.

### Step 5 — residual follow-up

Once you confirm parity in the dashboard (see `docs/research/RESEARCH-02-db-reset-validation.md`), the out-of-band patch file at the repo root is redundant:

- **Delete `fix_storage_and_audit.sql`** (what it did is now in migration `020`).

---

## 2. Local development

```bash
# Fresh local database reproducing the hosted patched state:
# chain 001-021 + seed-demo.sql ([db.seed] wiring)
npx supabase db reset

# Start the local stack (runs seed only on first start / after reset)
npx supabase db start

# Run the Plan 03 pgTAP contract suite
npx supabase test db
```

- `supabase db reset` runs the full 001-021 chain **plus** `seed-demo.sql` (config.toml `[db.seed]`).
- `supabase db push` **never** runs seed files — the chain ends seed-free by 021's clamps and the config.

## 3. Demo-data notes

- `seed-demo.sql` contents: BLOCK 1 dummy students / masterlist / parties / candidacy slates (LRN `136400%`), the 007 commissioner/adviser accounts, and the demo officer accounts (`president@cnnhs.edu` … `grade12.rep@cnnhs.edu`).
- It runs on **first `supabase start`** and on **every `supabase db reset`** — never on `db push`.
- **Re-running reset does NOT reset passwords** (D-08): all seed rows are plain inserts / `on conflict do nothing`.
- Demo credentials are known local-development values (`student123`, `screening123`, …). **Rotate them after your first local login**; the Phase-2 bcrypt transition will re-hash SHA-256 student passwords at first login.

## 4. Verification checklist

| # | Check | Command / location |
|---|---|---|
| 1 | Chain applies cleanly | `npx supabase db reset` (local) |
| 2 | pgTAP suite green | `npx supabase test db` |
| 3 | Storage policies live | Step 3 spot-check SQL (hosted) / `psql` (local) |
| 4 | Audit + candidacy RPCs live | `to_regprocedure` spot-check |
| 5 | Chief admin password rotated (Step 4 spot-check `password_still_default` = `false`) | Step 4 SQL assertion — paste the result |
| 6 | CI gates green on next push | `.github/workflows/ci.yml` + `database-tests.yml` |
| 7 | Parity confirmed → patch file deleted | `docs/research/RESEARCH-02-db-reset-validation.md` |