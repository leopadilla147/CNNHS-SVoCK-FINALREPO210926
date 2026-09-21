# RESEARCH-03: Lockout Thresholds — Decision Record (D-14)

> Phase 01 · Test Harness & Research Foundation · Plan 04
> Status: **decision record — NOT enforced** (threat T-04-03 accepted: enforcing now exceeds Phase 1 scope; Phase 2/3 auth hardening implements this record)
> Decision anchor: CONTEXT D-14 — lockout design record, NIST SP 800-63B-4 §3.2.2

---

## 1. Locked decision

**5 consecutive failed login attempts → 15-minute lockout**, per **NIST SP 800-63B-4 §3.2.2** ("throttle or lock out after a small number of consecutive failed attempts; the lockout duration should be no less than 15 minutes"; the upper band — 100 failed attempts per 30 days — is noted and intentionally not adopted because this system has a single low-volume, multi-role login surface; the 5/15 rule is the stricter, user-appropriate default).

Locked parameters (single source of truth for Phase 2/3):

| Parameter | Value |
|---|---|
| Failed-attempt threshold | **5** consecutive failures |
| Lockout duration | **15 minutes** from the 5th failure |
| Counter reset | on successful authentication |
| Unlock action | automatic elapse of the 15-minute window, or admin reset |

## 2. Finding: no existing attempt/lockout columns (plan reference corrected)

The plan brief referenced "the current `max_attempts`/`failed_attempts` columns (from 001 schema)". **Verified against the repository: those columns do not exist.**

- `Select-String` over `supabase/migrations/**` for `max_attempts|failed_attempts|attempt|lockout` → **zero matches** (001_initial_schema.sql included).
- Repo-wide scan → only findings references (`CONCERNS.md` #3: login RPCs `login_admin_direct` / `login_student_direct` / `login_officer_direct` / `login_sslg_adviser_direct` are "currently unbounded brute-force targets"), plus the Plan 03 pgTAP `todo()` guard for a Phase 2 `login_attempts` table.

Consequence for this record: the columns/objects below are **proposed additions** (schema delta for Phase 2/3), not descriptions of existing state. No existing column is repurposed.

## 3. Proposed schema + behavior (decision-record only — NOT enforced)

| Object | Proposal (Phase 2/3) | Enforced today? |
|---|---|---|
| `login_attempts` table (one row per failed attempt, keyed by login RPC + identity) | created in a Phase 2 additive migration; asserted by the Plan 03 pgTAP `todo()` guard (its arrival flips `todo()` → unexpected-success signal) | no — enforcement deferred (T-04-03) |
| `failed_attempts` counter (consecutive failures within the window) | derived from `login_attempts` rows; threshold **5** | no |
| Lockout window | **15 minutes** from the 5th consecutive failure; further attempts rejected with a lockout error until the window elapses | no |
| Counter reset | successful authentication clears the attempt rows | no |
| Unlock action | automatic window elapse; admin reset via an `admin_reset_login_attempts` RPC (profile-scoped, `security definer`) | no |
| Scope | per login identity (email) × per RPC family; explicit design question for Phase 2 whether lockout is global-per-email or per-RPC | no |

Placement for Phase 2/3 enforcement: inside `login_admin_direct` (002), `login_student_direct` (002), `login_officer_direct` (006), `login_sslg_adviser_direct` (006) — all four are `security definer` today, so the attempt counters must live in a table with **deny-all RLS for anonymous access** (only the definer functions touch it), preventing a direct-table bypass of the counter.

## 4. Interaction with RESEARCH-01 (first-login bcrypt re-hash)

Per RESEARCH-01, the Phase 2 bcrypt transition re-hashes SHA-256 student passwords at first login inside the login path (cost 10; Probe timings ~50-120 ms added latency). Interaction rule locked here:

- The re-hash **does not consume a failed attempt** and **does not reset the attempt counter** — it is part of the success path, not a credential event.
- A **failed re-hash** (e.g. stored hash unparseable) counts as a **failed attempt** — Probe A1 in RESEARCH-01 already documents that a naive in-place `crypt()` migration would store NULL passwords and lock every student out; a re-hash failure must follow the same counting rule so corrupted hashes surface as lockout-visible failures rather than silent no-ops.

No other RESEARCH-01 interaction exists — timing is not part of the decision record.

## 5. Guidance for the Phase 2/3 enforcement plan

1. Migration order: add `login_attempts` **before** any lockout checks land in 002/006 (additive; never rewrite the seed-era files, per D-01).
2. Lockout check runs **before** credential verification (prevents oracle leaks on the failure path) and returns a single generic error shape.
3. The 5/15 constants ship as `app_settings` defaults when the Phase 2 `app_settings` helper (Plan 03 contract) lands, keeping `login_attempts` logic configurable.
4. Rate limiting remains out of scope here — the NIST throttling band is delegated to the Phase 2 hardening plan; this record pins only the lockout rule.
5. Re-audit this record against the deployed auth shape after Phase 2/3 — `todo()` in the pgTAP suite turns green for enforcement, and this document's "NOT enforced" header is flipped to "enforced".