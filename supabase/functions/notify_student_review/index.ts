// notify_student_review/index.ts
// =============================================================
// Student registration review emails — approved / rejected.
//
// Called by the SSLG Adviser's Student Enrollment page immediately after
// a successful review_student_rpc call (POST { studentId }).  The function
// re-reads everything from the database with the service role — the caller
// never supplies the verdict, the recipient address, or the message body,
// so a tampered request can only ever (re)send the truthful email for a
// review that already happened:
//   * a student_rejection_notices row (134) exists for the id
//                -> rejection email quoting the recorded reason item by
//                   item.  Migration 134 DELETES the registration row on
//                   reject, so the notice is the only place the reason
//                   lives; the notice is consumed (deleted) after a
//                   successful send — a failed send leaves it queued for
//                   a retry, a successful one can never be replayed.
//   * students row, status = 'approved'
//                -> congratulations email ("you can now log in")
//   * neither / still pending
//                -> 200 { ok: true, skipped: true } / 404, no email
//
// Transport is the Brevo HTTP API — the house emailer since
// send_password_reset (hosted Deno Deploy blocks outbound SMTP ports
// 25/465/587).  Secrets live in Supabase function secrets, never in code:
//   supabase secrets set BREVO_API_KEY=... BREVO_SENDER_EMAIL=...
// (BREVO_SENDER_NAME optional, defaults to "CNNHS-SVoCK".)
//
// Identity mirrors create_sslg_adviser / review_student_rpc: the
// x-session-token side channel resolves the 022 session spine, and the
// requester must be an adminprofiles member (chief / commissioner /
// co_commissioner / sslg_adviser) — the exact gate the review RPC itself
// enforces.  verify_jwt = false (config.toml) because identity comes from
// the side channel, not a platform JWT.
// =============================================================

/// <reference lib="deno.window" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// x-session-token stays in the allow-list (house CORS block) — the browser
// preflight must accept the side-channel header.
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

function escapeHtml(value: string): string {
  // "\x26" is the hex escape for the ampersand character, so each entity
  // string below is built from it and can never be decoded away when the
  // file is transported or transformed.
  return value
    .replace(/&/g, "\x26amp;")
    .replace(/</g, "\x26lt;")
    .replace(/>/g, "\x26gt;")
    .replace(/"/g, "\x26quot;")
    .replace(/'/g, "\x26#39;");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The stored reason is one item per line (the review dialog joins the
// Adviser's selected issues and notes with newlines).  Email renders each
// non-empty line as a list item; the fallback covers legacy rejects made
// before migration 133 stored any reason.
function reasonItems(reason: string | null): string[] {
  const items = (reason ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter((line) => line.length > 0);
  if (items.length > 0) return items;
  return [
    "Your submitted registration could not be fully verified against the school records.",
    "Please get in touch with the SSLG Adviser so they can check what is wrong or missing and guide you on the next steps.",
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Identity: x-session-token side channel ONLY.
    const token = req.headers.get("x-session-token");
    if (!token || token.length === 0) return json(401, { error: "missing session token" });

    // 2. Service-role client for every read and mutation (identity is
    //    resolved from the sessions table, not a platform JWT).
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3. Resolve the session by sha256 token_hash (022 derivation).
    const tokenHash = await sha256Hex(token);
    const { data: session, error: sessionError } = await adminClient
      .from("sessions")
      .select("user_id, expires_at")
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

    // 4. Requester must be an adminprofiles member — the same gate the
    //    review_student_rpc RPC enforces (chief / commissioner /
    //    co_commissioner / sslg_adviser).
    const { data: actor } = await adminClient
      .from("adminprofiles")
      .select("full_name, role_type")
      .eq("id", session.user_id)
      .maybeSingle();

    if (!actor) {
      return json(403, { error: "Only admins or active SSLG Advisers can send review emails." });
    }

    // 5. Body validation — nothing but the row id travels from the client.
    const body = await req.json().catch(() => ({}));
    const studentId = typeof (body as { studentId?: unknown }).studentId === "string"
      ? (body as { studentId: string }).studentId.trim()
      : "";
    if (!studentId || !UUID_PATTERN.test(studentId)) {
      return json(400, { error: "A valid studentId is required." });
    }

    // 6. Resolve WHAT to send — rejection notice first (134: the students
    //    row is already deleted by then), then the live students row.
    const { data: notice, error: noticeError } = await adminClient
      .from("student_rejection_notices")
      .select("id, recipient_email, full_name, lrn, rejection_reason")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (noticeError) throw new Error(noticeError.message);

    let action: "approved" | "rejected";
    let recipientEmail: string;
    let fullName: string;
    let lrn: string;
    let reason: string | null;

    if (notice) {
      action = "rejected";
      recipientEmail = notice.recipient_email ?? "";
      fullName = notice.full_name;
      lrn = notice.lrn ?? "—";
      reason = notice.rejection_reason;
    } else {
      // 135 FIX: students.rejection_reason was dropped by 134 — the
      // fallback no longer selects it.  Post-134 this path only ever
      // sees APPROVED rows (rejections delete the row and go through
      // the notice queue above), so the generic reason fallback covers
      // the impossible legacy case.
      const { data: student, error: studentError } = await adminClient
        .from("students")
        .select("first_name, middle_name, last_name, email, lrn, grade_level, status")
        .eq("id", studentId)
        .maybeSingle();

      if (studentError) throw new Error(studentError.message);
      if (!student) return json(404, { error: "Student not found." });

      if (student.status !== "approved" && student.status !== "rejected") {
        // Registration not reviewed yet — nothing to announce.
        return json(200, { ok: true, skipped: true });
      }
      action = student.status === "approved" ? "approved" : "rejected";
      recipientEmail = student.email ?? "";
      fullName = [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" ");
      lrn = student.lrn || "—";
      reason = null;
    }

    if (!recipientEmail) {
      return json(400, { error: "The registration has no email address on file." });
    }

    const safeName = escapeHtml(fullName || "Student");
    const safeLrn = escapeHtml(lrn);

    // 7. Compose the email for the resolved verdict (Tagalog house copy,
    //    mirroring send_password_reset).
    let subject: string;
    let htmlContent: string;
    let textContent: string;

    if (action === "approved") {
      subject = "SVoCK — Student Registration Approved";
      htmlContent = `
        <p>Magandang araw, <strong>${safeName}</strong>,</p>
        <p>Maligayang pagbati! Ang iyong student registration sa SVoCK (CNNHS Student Online Voting & Complaints Kiosk) ay <strong style="color:#15803d;">APPROVED</strong> na ng SSLG Adviser.</p>
        <p>Maaari ka nang mag-log in gamit ang iyong nirehistrong email at password upang ma-access ang election system.</p>
        <p style="font-size:13px; color:#555;">LRN: <strong>${safeLrn}</strong></p>
        <p>Kung hindi ikaw ang nag-register ng account na ito, makipag-ugnayan agad sa SSLG Adviser.</p>
        <p>Maraming salamat.</p>
        <p><strong>CNNHS-SVoCK Electoral Commission</strong></p>
      `;
      textContent =
        `Magandang araw, ${fullName || "Student"},\n\n` +
        `Maligayang pagbati! Ang iyong student registration sa SVoCK ay APPROVED na ng SSLG Adviser.\n` +
        `Maaari ka nang mag-log in gamit ang iyong nirehistrong email at password.\n` +
        `LRN: ${lrn}\n\n` +
        `Kung hindi ikaw ang nag-register ng account na ito, makipag-ugnayan agad sa SSLG Adviser.\n\n` +
        `CNNHS-SVoCK Electoral Commission`;
    } else {
      const items = reasonItems(reason);
      const listHtml = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const listText = items.map((item) => `  - ${item}`).join("\n");
      subject = "SVoCK — Student Registration Rejected";
      htmlContent = `
        <p>Magandang araw, <strong>${safeName}</strong>,</p>
        <p>Paumanhin, ang iyong student registration sa SVoCK (CNNHS Student Online Voting & Complaints Kiosk) ay <strong style="color:#b91c1c;">hindi naaprubahan (rejected)</strong> ng SSLG Adviser.</p>
        <p>Narito ang mga kulang o mali sa iyong sinumiteng registration:</p>
        <ul>${listHtml}</ul>
        <p>Ang iyong registration record ay tinanggal na sa roster — maaari kang mag-register muli pagkatapos ayusin ang mga detalye, o makipag-ugnayan sa SSLG Adviser para sa gabay.</p>
        <p style="font-size:13px; color:#555;">LRN: <strong>${safeLrn}</strong></p>
        <p>Maraming salamat.</p>
        <p><strong>CNNHS-SVoCK Electoral Commission</strong></p>
      `;
      textContent =
        `Magandang araw, ${fullName || "Student"},\n\n` +
        `Paumanhin, ang iyong student registration sa SVoCK ay hindi naaprubahan (rejected) ng SSLG Adviser.\n\n` +
        `Mga kulang o mali sa iyong sinumiteng registration:\n${listText}\n\n` +
        `Ang iyong registration record ay tinanggal na sa roster — maaari kang mag-register muli pagkatapos ayusin ang mga detalye, o makipag-ugnayan sa SSLG Adviser para sa gabay.\n` +
        `LRN: ${lrn}\n\n` +
        `CNNHS-SVoCK Electoral Commission`;
    }

    // 8. Deliver through Brevo (HTTP API — see header note).
    const brevoKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "CNNHS-SVoCK";

    if (!brevoKey || !senderEmail) {
      console.error("notify_student_review: BREVO_API_KEY / BREVO_SENDER_EMAIL secrets are not set");
      return json(500, { error: "The email service is not configured. Please contact the administrator." });
    }

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "accept": "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: recipientEmail, name: fullName || undefined }],
        subject,
        htmlContent,
        textContent,
      }),
    });

    if (!brevoRes.ok) {
      const detail = await brevoRes.text().catch(() => "");
      console.error(`notify_student_review: Brevo ${brevoRes.status}: ${detail}`);
      return json(502, { error: "Unable to send the notification email right now. Please try again later." });
    }

    // 9. Consume a one-shot rejection notice ONLY after a successful send
    //    — a failed send leaves it queued for a retry; a successful one
    //    can never be replayed.
    if (notice) {
      const { error: consumeError } = await adminClient
        .from("student_rejection_notices")
        .delete()
        .eq("id", notice.id);
      if (consumeError) {
        // Best-effort: the email went out; log and move on (the notice
        // would allow one redundant resend at worst).
        console.error("notify_student_review: notice cleanup failed", consumeError);
      }
    }

    // 10. Audit (best-effort — never fail the request over it).
    try {
      await adminClient.from("audit_logs").insert({
        actor_id: session.user_id,
        actor_name: actor.full_name || "Administrator",
        actor_role: actor.role_type === "sslg_adviser" ? "sslg_adviser" : "admin",
        action: "Student Review Email Sent",
        details: `${action === "approved" ? "Approval" : "Rejection"} email sent to ${recipientEmail} for ${fullName} (LRN: ${lrn})`,
        type: "info",
      });
    } catch (err) {
      console.error("notify_student_review: audit log failed", err);
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("notify_student_review error:", err);
    return json(500, { error: "Unexpected server error. Please try again later." });
  }
});
