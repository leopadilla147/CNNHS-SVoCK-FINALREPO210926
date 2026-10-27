// create_commissioner/index.ts
// =============================================================
// DEPRECATED (103) — no longer called by the client.  Officer creation
// moved to the chief-gated create_commissioner_rpc /
// create_co_commissioner_rpc SECURITY DEFINER RPCs (migration 103):
// this function still wrote the commissioners table 037 dropped, plus
// auth.users/profiles rows that staff login (login_staff_direct_v2,
// adminprofiles.password_hash since 035) never reads.  Kept for
// reference only.
//
// =============================================================
// Chief appointment endpoint (03-01 port, ROLE-01).
//
// Port change (T-03-03): identity comes from the 02-02 session
// spine — the raw 64-hex token minted by a v2 login — NEVER from
// a JWT and NEVER from a client-supplied id/email.  The previous
// auth.getUser() flow broke once the app stopped issuing platform
// JWTs; this function now mirrors the change_password pattern:
//   * Reads ONLY the `x-session-token` header.  The Authorization
//     header is never read or trusted here.
//   * token_hash = sha256 hex of the raw token (reproduces the 022
//     derivation exactly).
//   * Resolves the sessions row, then requires a profile with
//     role = 'admin' AND commissioner_role = 'chief'.
//
// Co-commissioner support (D-11/D-12, ROLE-01): the body may carry
// an optional coCommissioner { name, email }.  When provided, the
// function creates a SECOND auth.users + profiles + commissioners
// row whose commissioners.co_commissioner_of points at the primary
// commissioner (same role).  The co-commissioner's password is
// managed by the Chief — change_password rejects them (D-12).
//
// verify_jwt = false (config.toml + deploy-time --no-verify-jwt):
// this function authenticates via the x-session-token side channel,
// NOT the platform JWT.
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

type CommissionerRole = "screening_validation" | "electoral_board" | "grievance";

const VALID_ROLES: CommissionerRole[] = ["screening_validation", "electoral_board", "grievance"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
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

    // 4. Requester must be the Chief Commissioner (admin profile, chief role).
    const { data: requesterProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, commissioner_role, full_name")
      .eq("id", session.user_id)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);
    if (!requesterProfile || requesterProfile.role !== "admin" || requesterProfile.commissioner_role !== "chief") {
      throw new Error("Only the Chief Commissioner can create commissioner accounts.");
    }

    // 5. Body validation.
    const body = await req.json().catch(() => ({}));
    const { name, email, role, coCommissioner } = body as {
      name?: string;
      email?: string;
      role?: CommissionerRole;
      coCommissioner?: { name: string; email: string };
    };
    if (!name || !email || !role) throw new Error("Name, email, and role are required.");
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    // 6. Create the primary commissioner (service role; password is the
    //    one-time credential the Chief hands to the appointee).
    const password = crypto.randomUUID();

    const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "admin",
        commissioner_role: role,
        full_name: name,
      },
    });

    if (createUserError || !createdUser.user) {
      throw new Error(createUserError?.message || "Unable to create auth user.");
    }

    await adminClient.from("profiles").upsert({
      id: createdUser.user.id,
      role: "admin",
      commissioner_role: role,
      full_name: name,
      must_change_password: true,
    });

    const { data: commissioner, error: commissionerError } = await adminClient
      .from("commissioners")
      .insert({
        auth_id: createdUser.user.id,
        name,
        email,
        commissioner_role: role,
        status: "active",
        appointed_by: session.user_id,
      })
      .select()
      .single();

    if (commissionerError || !commissioner) {
      throw new Error(commissionerError?.message || "Unable to create commissioner row.");
    }

    // 7. Optional co-commissioner (D-11/D-12): second auth.users +
    //    profiles + commissioners row with co_commissioner_of set.
    let coCommissionerResult: { commissioner: Record<string, unknown>; password: string } | undefined;

    if (coCommissioner?.name && coCommissioner?.email) {
      const coPassword = crypto.randomUUID();

      const { data: coUser, error: coUserError } = await adminClient.auth.admin.createUser({
        email: coCommissioner.email,
        password: coPassword,
        email_confirm: true,
        user_metadata: {
          role: "admin",
          commissioner_role: role,
          full_name: coCommissioner.name,
        },
      });

      if (coUserError || !coUser.user) {
        throw new Error(coUserError?.message || "Unable to create co-commissioner auth user.");
      }

      await adminClient.from("profiles").upsert({
        id: coUser.user.id,
        role: "admin",
        commissioner_role: role,
        full_name: coCommissioner.name,
        must_change_password: true,
      });

      const { data: coCommissionerRow, error: coCommissionerError } = await adminClient
        .from("commissioners")
        .insert({
          auth_id: coUser.user.id,
          name: coCommissioner.name,
          email: coCommissioner.email,
          commissioner_role: role,
          status: "active",
          appointed_by: session.user_id,
          co_commissioner_of: commissioner.id,
        })
        .select()
        .single();

      if (coCommissionerError || !coCommissionerRow) {
        throw new Error(coCommissionerError?.message || "Unable to create co-commissioner row.");
      }

      coCommissionerResult = { commissioner: coCommissionerRow, password: coPassword };
    }

    // 8. Audit log — mentions both accounts when a co-commissioner was created.
    const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    const details = coCommissionerResult
      ? `Appointed ${name} as Commissioner of ${roleLabel} (${email}) with co-commissioner ${coCommissioner?.name} (${coCommissioner?.email})`
      : `Appointed ${name} as Commissioner of ${roleLabel} (${email})`;

    await adminClient.from("audit_logs").insert({
      actor_id: session.user_id,
      actor_name: requesterProfile.full_name || "Chief Commissioner",
      actor_role: "admin",
      action: "Appointed Commissioner",
      details,
      type: "success",
    });

    // 9. Response — both passwords so the Chief can hand them over.
    return json(200, {
      commissioner,
      password,
      ...(coCommissionerResult ? { coCommissioner: coCommissionerResult } : {}),
    });
  } catch (error) {
    console.error("create_commissioner internal error:", error);
    return json(400, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});