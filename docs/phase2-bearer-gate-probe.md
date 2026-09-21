# Phase 2 Bearer-Gate Probe

**Plan:** 02-01 (Session Spine & Auth Hardening) — Task 2
**Status:** run once after deploying `022_session_spine.sql`
**Owner:** manual (Supabase SQL Editor) + one curl call — runs entirely client-side, no application code involved.

## Why this probe exists

Migration 022 makes the database trust the raw session token carried in the
`Authorization: Bearer <64-hex>` header (read through PostgREST's
`request.headers` GUC). Everything downstream — RLS role resolution, the
fetch interceptor in supabase.ts, every kiosk/student/admin request — rests
on two hosted-PostgREST behaviors that the research phase documented but
that **must be confirmed on this project's Supabase instance**:

| # | Assumption | Src |
|---|-----------|-----|
| A | A non-JWT `Authorization: Bearer …` header does **not** 401; PostgREST silently downgrades the request to the anon role and proceeds | 02-RESEARCH |
| B | `request.headers` (a transaction-local GUC) contains the raw `authorization` header **including** our custom Bearer value, visible to SECURITY DEFINER functions during that request | 02-RESEARCH |

If A or B fails, the DB cannot see the token and the whole session spine is
inert — every client would resolve as `anon`. The fallback in
[Fallback transport](#fallback-transport) would then apply.

## Probe A — PostgREST accepts a non-JWT bearer (no 401)

From PowerShell (replace `<URL>` and `<ANON_KEY>`):

```powershell
$headers = @{
  apikey        = "<ANON_KEY>"
  Authorization = "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"  # random 64-hex, NOT a JWT
}
Invoke-RestMethod -Method Get -Headers $headers -Uri "<URL>/rest/v1/election_periods?select=school_year"
```

**PASS** — HTTP 200 with a JSON array (likely `[]`/rows; anon can read
election_periods by RLS). The random bearer was silently downgraded to anon.
**FAIL** — HTTP 401 `invalid_jwt` or `JWT` error → assumption A is false on
this instance. Do **not** proceed; see [Fallback transport](#fallback-transport).

## Probe B — the Bearer reaches `request.headers` inside RLS/functions

1. In SQL Editor, create the scratch probe (owner, definer — exactly the
   posture the 022 helpers use):

```sql
create or replace function public.probe_request_headers()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  return current_setting('request.headers', true);
end;
$$;

revoke all on function public.probe_request_headers() from public;
grant execute on function public.probe_request_headers() to anon;
```

2. From PowerShell, post to the RPC with the **same** random Bearer:

```powershell
$body = "{}"
$headers = @{
  apikey        = "<ANON_KEY>"
  Authorization = "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
Invoke-RestMethod -Method Post -Headers $headers -ContentType "application/json" -Body $body -Uri "<URL>/rest/v1/rpc/probe_request_headers"
```

**PASS** — the response body is a JSON string that contains
`"authorization":"Bearer 0123456789…"` (note: PostgREST lowercases header
names). Assumptions A **and** B hold; run the 022 pgTAP test and proceed
with Task 3 (client transport) unchanged.
**FAIL** — the echo is `null`, `"{}"`, or 4xx → B is false on this
instance. Move to [Fallback transport](#fallback-transport) and update
02-CONTEXT D-11 + the supabase.ts interceptor accordingly.

3. Cleanup (SQL Editor):

```sql
drop function if exists public.probe_request_headers();
```

## Fallback transport

If the bearer gate fails, keep PostgREST's own `Authorization` for role
selection (the platform anon JWT) and carry the session token in a
dedicated header instead:

- supabase.ts interceptor adds `x-session-token: <raw>` on `/rest/v1/`
  requests and keeps `Authorization` untouched.
- 022/`session_identity()` reads `request.headers.x-session-token` first,
  falling back to the bearer path if absent.
- The 023 login RPCs and the pgTAP test use the `x-session-token` header
  name in `set_config('request.headers', …)`.

Expected: ~5-minute change — this page documents the exact switch points.

## Re-run note

The probe is destructive-free and idempotent (scratch function is dropped in
step 3). Re-run any time the Supabase project is recreated or migrated to a
different hosting tier.