// create_sslg_adviser/index.ts
// =============================================================
// DEPRECATED (103) — no longer called by the client.  Adviser creation
// moved to the chief-gated create_sslg_adviser_rpc SECURITY DEFINER RPC
// (migration 103): this function still wrote the sslg_advisers table
// 037 dropped, plus auth.users/profiles rows that staff login
// (login_staff_direct_v2, adminprofiles.password_hash since 035) never
// reads.  Kept for reference only.
//
// =============================================================
// SSLG Adviser appointment endpoint (D-02, ROADMAP step 1/2).
//
// Rewrite (05-01 T2): the previous implementation resolved the requester
// with userClient.auth.getUser() — but this function runs under
// verify_jwt = false and the custom-auth flow never issues platform JWTs,
// so that check ALWAYS failed (RESEARCH Pitfall 5).  This function now
// mirrors the proven create_commissioner pattern end-to-end:
//   * Reads ONLY the `x-session-token` header (02-02 side channel).  The
//     Authorization header is never read or trusted here.
//   * token_hash = sha256 hex of the raw token (022 derivation exactly).
//   * Resolves the sessions row, then requires session user_role 'admin'
//     — the role minted for the chief, every commissioner AND
//     co-commissioners by login_admin_direct_v2 (Phase 3 role model; the
//     removed 'officer' role is never reintroduced).
//   * Creates the adviser with a one-time crypto.randomUUID() password and
//     must_change_password = true (D-04 / 030), so the first login forces
//     the change screen.  The temp password is returned exactly once in
//     the response (D-03 modal consumes it) — never stored in plaintext,
//     never logged.
//   * NO hardcoded-password backdoor exists on any path (R3 / ROADMAP
//     step 1) — the only credential path is the generated temp password.
//
// verify_jwt = false (config.toml + deploy-time --no-verify-jwt): this
// function authenticates via the x-session-token side channel, NOT the
// platform JWT.
// =============================================================

/// <reference lib="deno.window" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// x-session-token must be in the CORS allow-list or browser preflights
// for the side-channel header would fail before the function runs.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
};

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Identity: x-session-token side channel ONLY.
    const token = req.headers.get("x-session-token");
    if (!token || token.length === 0) return json(401, { error: "missing session token" });

    // 2. Service-role client for every read and mutation (no userClient —
    //    identity is resolved from the sessions table, not a platform JWT).
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3. Resolve the session by sha256 token_hash (022 derivation).
    const tokenHash = await sha256Hex(token);
    const { data: session, error: sessionError } = await adminClient
      .from("sessions")
      .select("user_id, user_role, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (sessionError) throw new Error(sessionError.message);

    // Expired row -> mirror the 022 lazy-delete contract: treat as absent,
    // delete it, reject.
    if (session && session.expires_at && new Date(session.expires_at) < new Date()) {
      await adminClient.from("sessions").delete().eq("token_hash", tokenHash);
      return json(401, { error: "missing session token" });
    }
    if (!session) return json(401, { error: "missing session token" });

    // 4. Requester must be an admin-profile session (chief, commissioner
    //    or co-commissioner — all mint with user_role 'admin').
    if (session.user_role !== "admin") {
      return json(403, { error: "Only an admin can create SSLG Adviser accounts." });
    }

    const { data: requesterProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, full_name")
      .eq("id", session.user_id)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);

    // 5. Body validation.
    const body = await req.json().catch(() => ({}));
    const { name, email } = body as { name?: string; email?: string };
    if (!name || !email) throw new Error("Name and email are required.");

    // 6. Create the adviser (service role; password is the one-time
    //    credential the creator hands to the appointee).  must_change_password
    //    = true on the profiles row forces the change screen on first login.
    const password = crypto.randomUUID();

    const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "sslg_adviser",
        full_name: name,
      },
    });

    if (createUserError || !createdUser.user) {
      throw new Error(createUserError?.message || "Unable to create auth user.");
    }

    await adminClient.from("profiles").upsert({
      id: createdUser.user.id,
      role: "sslg_adviser",
      full_name: name,
      must_change_password: true,
    });

    const { data: adviser, error: adviserError } = await adminClient
      .from("sslg_advisers")
      .insert({
        auth_id: createdUser.user.id,
        name,
        email,
        status: "active",
        created_by: session.user_id,
      })
      .select()
      .single();

    if (adviserError || !adviser) {
      throw new Error(adviserError?.message || "Unable to create SSLG Adviser row.");
    }

    // 7. Audit log (service-role direct insert — same pattern as
    //    create_commissioner; the R2 audit seam serves the SPA/definer
    //    bodies, edge functions keep this proven path).
    await adminClient.from("audit_logs").insert({
      actor_id: session.user_id,
      actor_name: requesterProfile?.full_name || "Administrator",
      actor_role: "admin",
      action: "Appointed SSLG Adviser",
      details: `Appointed ${name} as SSLG Adviser (${email})`,
      type: "success",
    });

    // 8. Response — the one-time temp password, shown to the creator only.
    return json(200, { adviser, password });
  } catch (error) {
    console.error("create_sslg_adviser internal error:", error);
    return json(400, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});