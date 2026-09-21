# Phase 2: Officer-Role Surface Inventory

> **Purpose:** Handoff artifact for the officer-role cleanup tracked by plan
> 02-02 (REMOVE-07 / post-hardening sweep). Phase 2 hardened the login spine
> with bcrypt + lockout (migration 023) and switched every client login onto
> session-minting v2 RPCs. Because 023 revokes the legacy officer RPC from
> `PUBLIC`, the officer surface below is now **the complete, authoritative list**
> of every place an `officer` role can appear in this app — verified by grep
> sweep on 2026-09-14. Use this list to decide whether the officer portal is
> restored (new routes) or removed (dead code deletion).

## TL;DR

- The **officer user role is a dead-end today**: the login UI offers no officer
  option, `routes.tsx` defines no `/officer/*` routes, and yet layout code
  (`Header`, `Navbar`, `DashboardSidebar`) and the logout flow still special-case
  it. The database does all the work to mint an officer session
  (`login_officer_direct_v2`), which the client will then fail to route
  anywhere. Choose **restore** or **remove** and execute in a follow-up plan.

## Database surfaces

| File | Line(s) | Surface |
| --- | --- | --- |
| `supabase/migrations/001_initial_schema.sql` | 162-187 | `public.officers` table + `officers_auth_id_key` unique index |
| `supabase/migrations/001_initial_schema.sql` | 505, 542-545 | RLS enabled; `officers readable` (select, `using (true)`); `officers admin all` (all, `current_app_role() = 'admin'`) |
| `supabase/migrations/001_initial_schema.sql` | 739 | `login_officer_direct` joins `officers o on o.auth_id = u.id` |
| `supabase/migrations/002_login_functions.sql` | (officer body) | Legacy `login_officer_direct` (password hash compare vs `officers`), **revoked from `PUBLIC` in 023** |
| `supabase/migrations/023_bcrypt_and_lockout.sql` | (officer block) | `login_officer_direct_v2` (bcrypt + lockout + session mint), granted to `anon`; legacy RPC revoked |
| `supabase/seed-demo.sql` | 211-227 | 13 SSLG officer seed rows (President … Grade 12 Rep) — **no `auth_id`**, so legacy email/password path only |

## Client surfaces

| File | Line(s) | Surface |
| --- | --- | --- |
| `src/app/context/AppContext.tsx` | 13 | `UserRole` union includes `"officer"` |
| `src/app/lib/supabaseData.ts` | 57, 78 | `signInWithSupabase` officer branch — calls `login_officer_direct_v2`, returns officer object |
| `src/app/lib/supabaseData.ts` | 68 | officer `status` lookup against `officers` table |
| `src/app/lib/supabaseData.ts` | 336-353 | `syncOfficers(next, previous)` — role-agnostic `officers` table updater (used by admin screens) |
| `src/app/components/layout/DashboardSidebar.tsx` | 29-34, 129 | `officerNavItems` + `officer: { items, label: "Officer Portal" }` sidebar group |
| `src/app/components/layout/Header.tsx` | 55 | officer → redirect `/officer/dashboard` |
| `src/app/components/layout/Navbar.tsx` | 26 | officer → redirect `/officer/dashboard` |
| `src/app/pages/admin/AdminLogs.tsx` | 47, 138 | `"Officer"` role filter option + role badge styling |
| `src/app/pages/admin/dashboards/ChiefDashboard.tsx` | 13, 55 | "Current Leaders" stat = `officers.length` (data read, not role gate) |
| `src/app/pages/admin/dashboards/SslgAdviserDashboard.tsx` | 7, 31 | "Student Officers" stat = active `officers` count (data read, not role gate) |
| `src/app/lib/reports.ts` | 391, 426 | SSLG officer **position names** in proclamation text (semantic, not role gate) |

## Confirmed gaps (grep-verified)

1. **No login entry point.** `LoginPage.tsx:170` role selector offers only
   `["student", "commissioner", "admin", "sslg_adviser"]` — no `"officer"`.
2. **No routes.** `routes.tsx` defines only `/student/*` and `/admin/*` trees;
   `officerNavItems` point at `/officer/dashboard`, `/officer/election`,
   `/officer/leaders`, `/officer/results` — all unrouted (fall through to the
   public/home catch-all).
3. **Wasted DB work.** `login_officer_direct_v2` (023, anon-granted, session
   minting) is fully functional but cannot be reached from the UI, and a minted
   officer session has nowhere to land.
4. **Data-only vs role-gate distinction.** `officers` *table* reads/dashboards
   (Chief, Adviser, syncOfficers) are legitimately used by admin screens and
   must survive regardless of the officer *role* decision. Only the layout
   redirects, sidebar group, `UserRole` member, and login branch are role-gated.

## Recommended next step (follow-up plan)

- **Restore path:** add `/officer/*` routes + page components (or map officer →
  an existing admin view), add `"officer"` to the `LoginPage` role selector, and
  smoke-test `login_officer_direct_v2` end-to-end.
- **Remove path:** strip the officer branch from `signInWithSupabase`
  (`supabaseData.ts:57, 78`), the redirects (`Header.tsx:55`,
  `Navbar.tsx:26`), the sidebar group (`DashboardSidebar.tsx:29-34, 129`),
  `LoginPage` remains untouched, and decide whether `login_officer_direct_v2`
  + officer fixtures stay in the schema (SQL-side removal is a separate
  migration). Either way keep the `officers` table + admin dashboard stats.