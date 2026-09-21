// create_sslg_adviser-test.ts
// =============================================================
// Deno tests for the `create_sslg_adviser` edge function, driven over
// HTTP against a backgrounded `supabase functions serve` (the
// RESEARCH-verified edge pattern, same as create_commissioner-test.ts /
// change_password-test.ts).
//
// Run:      deno test --allow-all supabase/functions/tests/ --env-file .env.local
// Requires: `supabase functions serve` running (the function reads
//           SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//           from the serving environment; CI or a local developer
//           starts it), plus fixture session tokens for the contract
//           cases (c)-(e).
//
// Session contract (05-01 rewrite): identity travels in the
// x-session-token side-channel header ONLY — the Authorization header
// is never read or trusted here.  The function resolves the token via
// the sessions table (sha256(token) -> user_id) and then requires a
// session with user_role 'admin' (chief, commissioners and
// co-commissioners all mint with user_role 'admin').
//
// Fixture env vars for cases (c)-(e) (mint once against local accounts):
//   CREATE_SSLG_ADVISER_TEST_TOKEN       fresh x-session-token for an admin
//   CREATE_SSLG_ADVISER_TEST_STUDENT_TOKEN  fresh x-session-token for a
//                                        NON-admin (student) account — 403
//                                        fixture for the role gate
//   CREATE_SSLG_ADVISER_TEST_EMAIL_BASE  base for the unique account email,
//                                        e.g. "adviser.test" (Date.now()
//                                        appended)
//   SUPABASE_ANON_KEY                    used for the post-create REST
//                                        login check (case e)
//
// Case ordering matters: (c) creates accounts via the function and
// (e) logs one in over REST; (c)+(e) must not run twice with the same
// email (Date.now() suffixes keep re-runs unique).
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

import { assert, assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert";

const FUNCTION_URL =
  Deno.env.get("FUNCTION_URL") ??
  "http://127.0.0.1:54321/functions/v1/create_sslg_adviser";

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
      `Could not reach the served create_sslg_adviser function at ${FUNCTION_URL}. ` +
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
      `Could not reach the served create_sslg_adviser function at ${FUNCTION_URL}. ` +
      `Start it first: supabase functions serve  (error: ${(err as Error).message})`,
    );
  }
  return res;
}

// ---- CORS: preflight must allow the x-session-token side-channel
//      header (05-01 rewrite; impossible to preflight with it otherwise) ----
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
      `Mint fresh session tokens (admin + student) and set ` +
      `CREATE_SSLG_ADVISER_TEST_TOKEN / CREATE_SSLG_ADVISER_TEST_STUDENT_TOKEN / ` +
      `CREATE_SSLG_ADVISER_TEST_EMAIL_BASE (see header comment) before running the suite.`,
    );
  }
  return value;
}

// ---- Case (a): no x-session-token header -> 401 (no fixture) ----
Deno.test("POST without an x-session-token header is rejected (401)", async () => {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "N", email: "n@example.com" }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the served create_sslg_adviser function at ${FUNCTION_URL}. ` +
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
    { name: "New Adviser", email: "new.adviser@cnnhs.edu" },
    "73ff9f4fe34f4bcfaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assertEquals(res.status, 401, "an unresolvable token must be rejected with 401");
  const body = await res.json().catch(() => null);
  assert(body !== null && body.error === "missing session token", "generic 401 message expected");
});

// ---- Case (c): valid admin session -> adviser created, one-time
//      password returned, no local-password backdoor ----
Deno.test("POST with an admin session creates the adviser and returns a UUID temp password", async () => {
  const token = requireFixture("CREATE_SSLG_ADVISER_TEST_TOKEN");
  const emailBase = requireFixture("CREATE_SSLG_ADVISER_TEST_EMAIL_BASE");
  const email = `${emailBase}.${Date.now()}@cnnhs.edu`;

  const res = await post({ name: "Test Adviser", email }, token);

  assertEquals(res.status, 200, "a proven admin session must be able to create an adviser");
  const body = await res.json().catch(() => null);
  assert(body !== null, "a JSON body is expected");
  assertEquals(body?.adviser?.email, email, "the created adviser row is returned");
  assert(typeof body?.password === "string", "a one-time temp password is returned");
  assertNotEquals(body.password, "local-password", "no local-password backdoor on the response (R3)");
  assertMatch(
    body.password,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "the temp password is a generated crypto.randomUUID() value",
  );
});

// ---- Case (d): non-admin (student) session -> 403 ----
Deno.test("POST with a NON-admin session is rejected (403)", async () => {
  const studentToken = requireFixture("CREATE_SSLG_ADVISER_TEST_STUDENT_TOKEN");

  const res = await post(
    { name: "Sneaky Adviser", email: `sneaky.${Date.now()}@cnnhs.edu` },
    studentToken,
  );

  // B-2 role gate: a student-role session is never an appointment surface.
  assertEquals(res.status, 403, "a non-admin session must be rejected with 403");
  const body = await res.json().catch(() => null);
  assert(body !== null && typeof body.error === "string", "an error payload is returned");
  assertMatch(body.error, /admin/, "the rejection names the admin requirement");
});

// ---- Case (e): the created adviser's next login returns
//      must_change_password = true (030 / D-04 forced change) ----
Deno.test("the created adviser account logs in with the temp password and returns must_change_password=true", async () => {
  const token = requireFixture("CREATE_SSLG_ADVISER_TEST_TOKEN");
  const emailBase = requireFixture("CREATE_SSLG_ADVISER_TEST_EMAIL_BASE");
  const anonKey = requireFixture("SUPABASE_ANON_KEY");
  const email = `${emailBase}.login.${Date.now()}@cnnhs.edu`;

  const res = await post({ name: "Login Adviser", email }, token);
  assertEquals(res.status, 200, "a proven admin session must be able to create an adviser");
  const body = await res.json().catch(() => null);
  assert(body !== null && typeof body?.password === "string", "a temp password is returned");

  // The next login (login_sslg_adviser_direct_v2, REST with the anon key)
  // returns must_change_password = true — the first login forces the
  // change screen (D-04).
  const authUrl = new URL(FUNCTION_URL);
  const rpcUrl = `${authUrl.origin}/rest/v1/rpc/login_sslg_adviser_direct_v2`;
  const loginRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email, p_password: body.password }),
  });
  assert(loginRes.status === 200, `the created adviser must authenticate (got HTTP ${loginRes.status})`);
  const login = await loginRes.json();
  assertEquals(
    login?.[0]?.must_change_password,
    true,
    "the created adviser's first login returns the forced-change flag (030 / D-04)",
  );
});