// delete_profile_picture/index.ts
// =============================================================
// Storage cleanup for profile pictures — ONE function for both
// audiences (the former delete_student_picture and
// delete_admin_picture, merged).  Client counterpart of the
// picture-clearing RPCs: 072's update_my_profile_picture
// (students) and 073's update_my_admin_profile_picture (staff).
//
// WHY
//   Those RPCs only write or clear the profile_picture_url column;
//   the object itself in its storage bucket was never deleted.  So
//   "Remove picture" orphaned the file, and every replace orphaned
//   the previous one too (unique-filename-per-upload means each
//   change creates a NEW object).  This function is the missing
//   delete path — service-role storage removal, gated by the
//   session spine, with NO anon DELETE policy on either bucket.
//
// SESSION CONTRACT (create_commissioner / change_password pattern)
//   * Identity comes from the 022 session spine ONLY — the raw
//     64-hex token minted by a v2 login, carried in the
//     `x-session-token` side-channel header (039 fallback
//     transport).  The Authorization header is never read or
//     trusted here.
//   * token_hash = sha256 hex of the raw token (022 derivation).
//   * Role gate: dispatch on session.user_role — 'student' gets
//     the student bucket/prefix/table; 'admin' | 'sslg_adviser'
//     (the 035 staff session roles) get the admin ones; any other
//     role is refused.
//
// OWNERSHIP + REFERENCE SAFETY (why an edge function, not a client
// storage.remove — an anon DELETE policy would be unscoped):
//   * The object name must be `<role>_<uuid>...` where <uuid> is
//     the session's user_id — a user can only ever delete THEIR
//     OWN uploads (uploadStudentPicture / uploadAdminPicture in
//     src/app/lib/supabaseData.ts name every file that way).
//   * The object must no longer be referenced by the actor's
//     profile_picture_url.  The client always calls the RPC first
//     (null on remove, the new URL on replace), so both flows pass
//     this; a direct API call that tries to nuke the CURRENT
//     picture is refused, so the column can never point at a
//     deleted object.
//   * Removing a never-existing object is a success (storage's
//     remove skips missing paths) — the operation is idempotent.
//
// verify_jwt = false (config.toml + deploy-time --no-verify-jwt):
// this function authenticates via the x-session-token side channel,
// NOT the platform JWT — same reasoning as create_commissioner.
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

// ---------------------------------------------------------------------------
// Per-audience dispatch — everything that differs between the student and
// staff flows lives here, so the handler below is written once.
// ---------------------------------------------------------------------------

/** All audience-specific constants for one picture namespace. */
interface PictureContext {
  /** Storage bucket (also appears in the public URL prefix). */
  bucket: string;
  /** Table holding the profile_picture_url reference column. */
  ownerTable: "students" | "adminprofiles";
  /** RPC that writes/clears the column — clients must call it first. */
  clearRpc: "update_my_profile_picture" | "update_my_admin_profile_picture";
  /** Error when the actor's row is missing (audience-specific noun). */
  notFoundError: string;
  /** Error when the URL is not an upload in this audience's bucket. */
  invalidUrlError: string;
  /** Error when the session role owns no pictures at all. */
  roleError: string;
}

const STUDENT_CONTEXT: PictureContext = {
  bucket: "student-pictures",
  ownerTable: "students",
  clearRpc: "update_my_profile_picture",
  notFoundError: "Student record not found.",
  invalidUrlError: "Picture URL must be a student-pictures upload.",
  roleError: "Only students can delete a student profile picture.",
};

const STAFF_CONTEXT: PictureContext = {
  bucket: "admin-pictures",
  ownerTable: "adminprofiles",
  clearRpc: "update_my_admin_profile_picture",
  notFoundError: "Profile not found.",
  invalidUrlError: "Picture URL must be an admin-pictures upload.",
  roleError: "Only staff can delete a staff profile picture.",
};

/** The picture namespace a session role may delete from, or null when
 *  the role owns no pictures (022 session roles: student / admin /
 *  sslg_adviser). */
function contextForRole(role: string): PictureContext | null {
  if (role === "student") return STUDENT_CONTEXT;
  if (role === "admin" || role === "sslg_adviser") return STAFF_CONTEXT;
  return null;
}

/** Object name from a `<bucket>` public URL, or null when the URL is not
 *  one (mirrors the RPC's server-side bucket validation). */
function objectNameFromUrl(pictureUrl: string, publicPrefix: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(pictureUrl).pathname);
  } catch {
    return null;
  }
  const idx = path.indexOf(publicPrefix);
  if (idx === -1) return null;
  const name = path.slice(idx + publicPrefix.length);
  // Flat bucket namespace only — no nested "folders".
  if (!name || name.includes("/")) return null;
  return name;
}

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

    // 2. Service-role client for every read and the storage removal (no
    //    userClient — identity is resolved from the sessions table, not
    //    a platform JWT).
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

    // 4. Role gate / dispatch — same contracts as the clearing RPCs
    //    (update_my_profile_picture 072, update_my_admin_profile_picture
    //    073).  Each role only ever reaches its own bucket + table.
    const ctx = contextForRole(session.user_role);
    if (!ctx) {
      return json(403, { error: "Only students and staff can delete a profile picture." });
    }

    // 5. Body + object-name validation.
    const body = await req.json().catch(() => ({}));
    const { pictureUrl } = body as { pictureUrl?: string };
    if (!pictureUrl || typeof pictureUrl !== "string") {
      return json(400, { error: "pictureUrl is required." });
    }

    const publicPrefix = `/storage/v1/object/public/${ctx.bucket}/`;
    const objectName = objectNameFromUrl(pictureUrl, publicPrefix);
    if (!objectName) {
      return json(400, { error: ctx.invalidUrlError });
    }

    // uploadStudentPicture/uploadAdminPicture name files
    // `<student|admin>_<studentId>_<Date.now()>.<ext>`.  The capture group
    // is the OWNING user id, checked against the session.
    const prefix = ctx.ownerTable === "students" ? "student" : "admin";
    const nameRe = new RegExp(
      `^${prefix}_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_\\d+\\.[a-z0-9]+$`,
      "i",
    );
    const nameMatch = nameRe.exec(objectName);
    if (!nameMatch) {
      return json(400, { error: "Unrecognized picture object name." });
    }
    // Ownership: a user may only delete files their own uploader minted
    // for THEIR id — never anyone else's.
    if (nameMatch[1].toLowerCase() !== session.user_id) {
      return json(403, { error: "You can only delete your own profile picture." });
    }

    // 6. Actor row + reference guard.
    const { data: ownerRow, error: ownerError } = await adminClient
      .from(ctx.ownerTable)
      .select("profile_picture_url")
      .eq("id", session.user_id)
      .maybeSingle();

    if (ownerError) throw new Error(ownerError.message);
    if (!ownerRow) return json(404, { error: ctx.notFoundError });

    if (ownerRow.profile_picture_url === pictureUrl) {
      return json(400, {
        error: `Picture is still in use — clear it via ${ctx.clearRpc} first.`,
      });
    }

    // 7. Service-role storage removal (bypasses storage policies; neither
    //    bucket has a DELETE policy).  Idempotent for missing objects.
    const { error: removeError } = await adminClient.storage.from(ctx.bucket).remove([objectName]);
    if (removeError) throw new Error(removeError.message);

    return json(200, { deleted: objectName });
  } catch (error) {
    console.error("delete_profile_picture internal error:", error);
    return json(400, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});
