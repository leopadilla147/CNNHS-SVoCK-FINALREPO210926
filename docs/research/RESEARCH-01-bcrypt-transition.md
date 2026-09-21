# RESEARCH-01: bcrypt Transition — Password-Hash Migration Decision

**Date:** 2026-09-14
**Phase:** 01 (Test Harness & Research Foundation), Plan 03
**Status:** Complete (findings verified by probe design; live timing transcript **pending** — the Plan 03 user-run checkpoint was skipped by explicit user decision, see RESEARCH-02 §2)
**Feeds:** Phase 2 hardening plan (login re-hash implementation)

## Question

The consolidated migration chain (001-021) produces **three different password-hash formats**:

| Source | Table / path | Stored format | Produced by |
|---|---|---|---|
| Students (demo) | `students.password_hash` | SHA-256 hex, 64 chars (`digest(plain,'sha256')`) | `016_seed_dummy_parties.sql` |
| Admin / Chief | `profiles`-adjacent admin bootstrap | bcrypt `$2a$06$…` (`crypt(plain, gen_salt('bf'))`) | `001` admin row, `020` chief bootstrap |
| Commissioners | `commissioners` (screening/… seeds) | bcrypt `$2a$06$…` | `007_seed_accounts.sql` |
| SSLG Adviser | `sslg_advisers` | (password set via `008_admin_password_update` path) | — |

How should Phase 2 unify these onto one modern format (bcrypt cost 10) **without locking any existing account out** — and what does that transition cost per login?

## Method

Two artifacts probe this empirically:

1. **`supabase/tests/database/010_research01_bcrypt_test.sql`** (pgTAP, plan 11) — runs against the real chain:
   - verifies pgcrypto is installed;
   - proves the legacy compare branch (SHA-256 hex recomputed from plaintext) is fully server-side computable;
   - **Probe A1 (Pitfall 5):** asserts `crypt(plain, 64-hex-salt) IS NULL` — the naive in-place migration trap;
   - proves bcrypt verify round-trips on the chain's existing `$2a$06$` admin format;
   - proves the re-hash target (`gen_salt('bf', 10)`) tags `$2a$10$`, is 60 chars, and round-trips;
   - captures **10 per-login timing samples** of a full bf-10 round-trip, emitted as rows + a `NOTICE` into the `supabase test db` output.
2. **The user-run checkpoint** (Plan 03, Task 3, gate `blocking-human`): `npx supabase db reset && npx supabase test db` output pasted back — that transcript becomes the authoritative measured timing evidence (and is folded into `01-03-SUMMARY.md` as the evidence block for Plan 04). The Plan 03 checkpoint was **skipped by explicit user decision** (see RESEARCH-02 §2), so the transcript is still pending — nothing in this doc claims a captured run, and the timing figures below are reference estimates until it lands.

## Findings

### F1 — The chain already mixes formats on purpose (verified)

- Students: SHA-256 hex (deterministic, unsalted-format). Verify = `digest(plain,'sha256')` hex compare. **Fast (<1 ms).**
- Admins/commissioners/chief: bcrypt via pgcrypto `gen_salt('bf')` — default **cost 6**, `$2a$06$` prefix, 60 chars. Verify = `crypt(plain, stored) = stored`.
- Both formats verify *today*; the problem is they use **stale hashing** (SHA-256 is unsalted; bcrypt cost 6 is far below the OWASP-recommended 10-12 for 2026).

### F2 — Probe A1: naive in-place crypt() would lock every student out (probe pending user-run, assumption solid)

Probe A1 asserts `crypt('student123', <64-hex salt>) IS NULL`. pgcrypto returns `NULL` when the salt does not carry a recognized crypt(3) magic prefix — a 64-hex SHA-256 string has none. **Consequence:** `UPDATE students SET password_hash = crypt(plain, password_hash)` would store `NULL` for every student — total account lockout. **The migration MUST branch on format before rewriting.**

### F3 — Verify round-trips on chain formats (verified by probe design)

- Legacy branch: hash = `encode(digest(plain, 'sha256'), 'hex')` — works, <1 ms.
- bcrypt branch: `crypt(plain, stored) = stored` — works on `$2a$06$` hashes (the stored hash embeds its own cost; cost upgrades are transparent on the *next* verify → re-hash).

### F4 — Re-hash target: bcrypt cost 10 (verified by probe design)

- `gen_salt('bf', 10)` → `$2a$10$`, 60 chars, round-trips through `crypt(plain, hash) = hash`.
- Cost 10 is the 2026 baseline for interactive logins (OWASP guidance); cost 12 protects long-lived secrets better but adds ~2-4x latency per login.

### F5 — Measured per-login timing (pending user-run checkpoint)

Captured by `010_research01_bcrypt_test.sql` when the user/CI runs `supabase test db` (D-11); per-sample rows + `RESEARCH-01 timing: avg/min/max` NOTICE land in the transcript. **The Plan 03 user-run checkpoint was skipped (RESEARCH-02 §2), so the captured transcript is still pending** — run `npx supabase test db` (or the Plan 04 CI matrix) to produce the measured evidence.

**Reference profile** (public bcrypt benchmarks, 2026 hardware): a single bf-10 round-trip ≈ **50-120 ms** on modern desktop/server CPUs. Contrast: legacy SHA-256 hex compare ≈ **<1 ms**. The transparent-upgrade path costs the LOGIN LATENCY of the new hash only — the migration itself has zero per-row cost (no batch re-hash, see F6).

### F6 — Batch re-hash is impossible; only transparent re-hash on first login works

Servers cannot recompute a hash without the plaintext. Batch migration would require **forcing every student to reset** (hostile; rejected at D-12). The only non-destructive path: **re-hash on successful first login after the upgrade** — verify with the legacy branch, then atomically overwrite `password_hash` with `crypt(plain, gen_salt('bf', 10))`, and on every subsequent login the bcrypt branch wins.

### F7 — Accounts that will still need an admin reset path

- Students whose `password_hash` is `NULL` (account created without a password) — neither branch can verify → only an admin `set_password_*` RPC (already ships in `008_admin_password_update.sql`) can provision one.
- Any stored value that is neither 64-hex SHA-256 nor 60-char `$2a$` bcrypt — corrupt/partial writes; admin reset required.

## Recommendation

**Adopt transparent re-hash-on-first-login with bcrypt cost 10 (D-12 confirmed):**

1. **Verify flow (branch-first, never assume format):**
   ```
   stored := students.password_hash (per email lookup)
   if stored has '$2a$' prefix (bcrypt):   valid := crypt(plain, stored) = stored
   elif length(stored) = 64 (legacy hex):  valid := encode(digest(plain,'sha256'),'hex') = stored
   else:                                    valid := FALSE → admin reset path (F7)
   ```
2. **Re-hash inline on success:** when the legacy branch validates, immediately `UPDATE students SET password_hash = crypt(plain, gen_salt('bf', 10))` in the same login RPC (before returning the session), so the upgrade is atomic with the login and never observable to the client.
3. **Keep the audit path unchanged:** `insert_audit_log_rpc` stays SECURITY DEFINER with `search_path=public` (pinned in 020) — the re-hash write must go through the login RPC, never a client-visible UPDATE (`students.admin all` policy already restricts writes).
4. **Cost factor 10, not 12:** balances the 50-120 ms/login budget (T-03-03) against 2026 strength guidance; Phase 2 can ratchet to 12 via an `app_settings`-driven knob (D-14) once the lockout throttle exists.
5. **Timing evidence lands at the Plan 03 checkpoint:** the measured avg/min/max (F5 transcript) is the input for the Plan 04 login-latency budget — do not tune blindly.

**Accounts needing admin attention (F7)** must be listed in the Phase 2 rollout checklist, provisioned via `008`'s admin `set_password` RPC — no user-visible force-reset.

## Why not the alternatives

| Option | Rejected because |
|---|---|
| Batch re-hash of all rows | Plaintext unknowable server-side; would require force-reset (hostile, D-12) |
| Forced reset for everyone | Product-hostile, huge support cost, delays the upgrade |
| Keep SHA-256 for students | Unsalted + instant brute-force; does not meet 2026 threat baseline (T-03-02) |
| Keep bcrypt cost 6 | Below OWASP 2026 minimum; cost embedded in hash so upgrading is free on next verify |
| cost 12 immediately | 2-4x login latency with no lockout throttle yet; knob-ready for later (D-14) |

---

*Phase: 01-test-harness-research-foundation*
*Research doc: RESEARCH-01 (bcrypt transition)*
*Evidence pending at Plan 03 checkpoint: measured bf-10 timing transcript (F5)*