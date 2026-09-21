// create_commissioner-test.ts
// =============================================================
// Deno tests for the `create_commissioner` edge function, driven over
// HTTP against a backgrounded `supabase functions serve` (the
// RESEARCH-verified edge pattern, same as change_password-test.ts).
//
// Run:      deno test --allow-all supabase/functions/tests/ --env-file .env.local
// Requires: `supabase functions serve` running (the function reads
//           SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//           from the serving environment; CI or a local developer
//           starts it), plus a real local chief account + its session
//           token for the contract cases (c)-(d).
//
// Session contract (03-01 port): identity travels in the
// x-session-token side-channel header ONLY — the Authorization header
// is never read or trusted here.  The function resolves the token via
// the sessions table (sha256(token) -> user_id) and then requires a
// profile with role = 'admin' AND commissioner_role = 'chief'.
//
// Fixture env vars for cases (c)-(d) (mint once against a local chief
// account, e.g. via the login_admin_direct_v2 RPC over REST with the
// anon key):
//   CREATE_COMMISSIONER_TEST_TOKEN      fresh x-session-token for a chief
//   CREATE_COMMISSIONER_TEST_EMAIL_BASE base for the unique account email,
//                                       e.g. "cc.test" (Date.now() appended)
//   SUPABASE_ANON_KEY                   used for the post-create REST
//                                       check of co_commissioner_of (case c)
//
// Case ordering matters: (c) creates accounts via the function and
// (d) only validates the role list (no mutation), so both may run in
// any order; (c) must not run twice with the same email.
//
// Design notes
// ------------
// * The module does NOT export its handler — it registers via serve()
//   at module top level (house pattern); importing it under deno test
//   would bind a port and hang the process.  Driving the served
//   endpoint over HTTP is the zero-production-change convention.
// * A missing server or missing fixture env is a LOUD failure (same
//   philosophy as change_password-test.ts) — a case that cannot run
//   because its fixture is absent FAILS with a usable message instead
//   of silently passing.
// =============================================================

import { assert, assertEquals, assertMatch, assertNotEquals, assertNotMatch } from "jsr:@std/assert";

const FUNCTION_URL =
  Deno.env.get("FUNCTION_URL") ??
  "http://127.0.0.1:54321/functions/v1/create_commissioner";

const ORIGIN = "http://localhost:5173";

function jsonHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    ...extra,
  };
}

async function post(body: unknown, token?: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: jsonHeaders(token ? { "x-session-token": token } : {}),
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Pitfall 1: a missing server must fail loudly with a usable message.
    throw new Error(
      `Could not reach the served create_commissioner function at ${FUNCTION_URL}. ` +
      `Start it first: supabase functions serve  (error: ${(err as Error).message})`,
    );
  }
  return res;
}

async function request(
  method: string,
  body: unknown,
  headers: HeadersInit = jsonHeaders(),
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method,
      headers,
      body: method === "OPTIONS" ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Pitfall 1: a missing server must fail loudly with a usable message.
    throw new Error(
      `Could not reach the served create_commissioner function at ${FUNCTION_URL}. ` +
      `Start it first: supabase functions serve  (error: ${(err as Error).message})`,
    );
  }
  return res;
}

// ---- CORS: preflight must allow the x-session-token side-channel
//      header (03-01 port; impossible to preflight with it otherwise) ----
Deno.test("OPTIONS preflight is answered and allows the x-session-token header", async () => {
  const res = await request("OPTIONS", {}, jsonHeaders());
  assertEquals(res.status, 200);
  assert(
    res.headers.get("access-control-allow-origin") !== null,
    "the function should answer with CORS headers",
  );
  const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
  assert(
    /x-session-token/i.test(allowHeaders),
    "x-session-token must be in Access-Control-Allow-Headers for browser preflights",
  );
});

// Fixture env access — loud failure when absent (a missing fixture must
// never look like a passing test).
function requireFixture(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `Fixture env ${name} is required for this test case. ` +
      `Mint a fresh session token for a real local chief account and set ` +
      `CREATE_COMMISSIONER_TEST_TOKEN / CREATE_COMMISSIONER_TEST_EMAIL_BASE ` +
      `(see header comment) before running the suite.`,
    );
  }
  return value;
}

// ---- Case (a): no x-session-token header -> 401 (no fixture) ----
Deno.test("POST without an x-session-token header is rejected (401)", async () => {
  // Drive the request directly (the BARE jsonHeaders() has no token).
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "N", email: "n@example.com", role: "grievance" }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the served create_commissioner function at ${FUNCTION_URL}. ` +
      `Start it first: supabase functions serve  (error: ${(err as Error).message})`,
    );
  }
  assertEquals(res.status, 401, "missing token must be rejected with 401");
  const body = await res.json().catch(() => null);
  assert(body !== null && body.error === "missing session token", "generic 401 message expected");
});

// ---- Case (b): unknown / expired token -> 401 (no fixture) ----
Deno.test("POST with an unknown session token is rejected (401)", async () => {
  const res = await post(
    { name: "New Commissioner", email: "new.commissioner@cnnhs.edu", role: "grievance" },
    "73ff9f4fe34f4bcfaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assertEquals(res.status, 401, "an unresolvable token must be rejected with 401");
  const body = await res.json().catch(() => null);
  assert(body !== null && body.error === "missing session token", "generic 401 message expected");
});

// ---- Case (c): valid chief session + coCommissioner -> both accounts
//      created, second commissioner row carries co_commissioner_of ----
Deno.test("POST with a chief session and coCommissioner creates both accounts and sets co_commissioner_of", async () => {
  const token = requireFixture("CREATE_COMMISSIONER_TEST_TOKEN");
  const emailBase = requireFixture("CREATE_COMMISSIONER_TEST_EMAIL_BASE");
  const stamp = Date.now();
  const primaryEmail = `${emailBase}.primary.${stamp}@cnnhs.edu`;
  const coEmail = `${emailBase}.co.${stamp}@cnnhs.edu`;

  const res = await post(
    {
      name: "Primary Commissioner",
      email: primaryEmail,
      role: "grievance",
      coCommissioner: { name: "Co Commissioner", email: coEmail },
    },
    token,
  );

  assertEquals(res.status, 200, "a proven chief session must be able to create a commissioner");
  const body = await res.json().catch(() => null);
  assert(body !== null, "a JSON body is expected");
  assertEquals(body?.commissioner?.email, primaryEmail, "primary commissioner is returned");
  assertEquals(body?.coCommissioner?.commissioner?.email, coEmail, "co-commissioner is returned");
  assert(typeof body?.commissioner !== "undefined", "primary commissioner is returned");
  assert(typeof body?.password === "string", "primary temp password is returned");
  assert(typeof body?.coCommissioner?.password === "string", "co-commissioner password is returned");
  assertNotEquals(body.password, "local-password", "no local-password backdoor on the primary response");
  assertNotEquals(body.coCommissioner.password, "local-password", "no local-password backdoor on the co response");

  // Verify co_commissioner_of on the second commissioners row over REST,
  // using the chief's raw token as the Bearer (session_identity resolves
  // it; "commissioners chief all" RLS lets the chief read the table).
  const anonKey = requireFixture("SUPABASE_ANON_KEY");
  const authUrl = new URL(FUNCTION_URL);
  const restBase = `${authUrl.origin}/rest/v1/commissioners`;
  const q = new URLSearchParams({
    select: "email,co_commissioner_of",
    email: `eq.${coEmail}`,
  });
  const restRes = await fetch(`${restBase}?${q.toString()}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  assert(restRes.status === 200, `REST read of commissioners must succeed (got HTTP ${restRes.status})`);
  const rows = await restRes.json();
  assertEquals(rows?.length, 1, "exactly one commissioner row for the co-commissioner email");
  assert(rows[0].co_commissioner_of !== null, "co_commissioner_of must point at the primary commissioner");
});

// ---- Case (d): appointment is not a valid role — rejected with the
//      valid-role list that excludes it (proven chief session) ----
Deno.test("POST with role appointment is rejected (400) — validRoles no longer includes it", async () => {
  const token = requireFixture("CREATE_COMMISSIONER_TEST_TOKEN");
  const emailBase = requireFixture("CREATE_COMMISSIONER_TEST_EMAIL_BASE");
  const email = `${emailBase}.appointment.${Date.now()}@cnnhs.edu`;

  const res = await post(
    { name: "Appointment Commissioner", email, role: "appointment" },
    token,
  );

  assertEquals(res.status, 400, "appointment must be rejected with 400 once the session is proven");
  const body = await res.json().catch(() => null);
  assert(body !== null && typeof body.error === "string", "an error payload is returned");
  assertMatch(body.error, /screening_validation/, "valid-role list is echoed in the message");
  assertNotMatch(body.error, /appointment/, "appointment must not appear in the valid-role list");
});

// ---- Case (e): provisioning flag (05-01) — the created account's first
//      login returns must_change_password = true (030), and the temp
//      password is a generated UUID — never a "local-password" backdoor ----
Deno.test("POST provisions a flagged account: UUID temp password returned once, next login returns must_change_password=true", async () => {
  const token = requireFixture("CREATE_COMMISSIONER_TEST_TOKEN");
  const emailBase = requireFixture("CREATE_COMMISSIONER_TEST_EMAIL_BASE");
  const anonKey = requireFixture("SUPABASE_ANON_KEY");
  const email = `${emailBase}.flagged.${Date.now()}@cnnhs.edu`;

  const res = await post({ name: "Flagged Commissioner", email, role: "grievance" }, token);
  assertEquals(res.status, 200, "a proven chief session must be able to create a commissioner");
  const body = await res.json().catch(() => null);
  assert(body !== null && typeof body?.password === "string", "a temp password is returned in the create response");
  assertNotEquals(body.password, "local-password", "no local-password backdoor on the response (R3)");
  assertMatch(
    body.password,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "the temp password is a generated crypto.randomUUID() value",
  );

  // The next login (login_admin_direct_v2, REST with the anon key) returns
  // must_change_password = true — the first login forces the change screen.
  const authUrl = new URL(FUNCTION_URL);
  const rpcUrl = `${authUrl.origin}/rest/v1/rpc/login_admin_direct_v2`;
  const loginRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email, p_password: body.password }),
  });
  assert(loginRes.status === 200, `the created account must authenticate (got HTTP ${loginRes.status})`);
  const login = await loginRes.json();
  assertEquals(
    login?.[0]?.must_change_password,
    true,
    "the created account's first login returns the forced-change flag (030 / D-04)",
  );
});