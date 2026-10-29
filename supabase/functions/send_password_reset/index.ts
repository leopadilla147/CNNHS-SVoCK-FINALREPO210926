// send_password_reset/index.ts
// =============================================================
// Forgot-password email OTP — request half ("send me a code").
//
// Runs BEFORE login, so there is no x-session-token yet: the function is
// verify_jwt = false (config.toml + deploy-time --no-verify-jwt) and the
// throttle/anti-enumeration rules below ARE the gate.
//
// Mirrors the proven create_sslg_adviser house pattern:
//   * Service-role client for every read and mutation.
//   * sha256-hex derivation identical to the 022 session spine — the
//     plaintext code is never stored, only its SHA-256 (table 120).
//
// Why Brevo and not SMTP: hosted Deno Deploy blocks outbound connections
// to SMTP ports 25/465/587 (supabase send-email-smtp README), so the
// Gmail SMTP mechanism of the legacy `php mailer/` scripts is
// unreachable from here.  The Brevo HTTP API works from the free tier
// (300 emails/day, one verified sender, no domain needed).  Secrets live
// in Supabase function secrets, never in code:
//   supabase secrets set BREVO_API_KEY=... BREVO_SENDER_EMAIL=...
//
// Anti-enumeration contract: for a well-formed request the endpoint
// answers 200 { ok: true } whether or not the account exists — unknown
// emails, throttled repeats, and known emails are indistinguishable to
// the caller.  The ONLY error responses are malformed input (400) and
// Brevo outage / missing secrets (5xx), both of which are operator
// problems, not account oracles.  Delivery failures are logged to the
// function console for debugging.
// =============================================================

/// <reference lib="deno.window" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// x-session-token stays in the allow-list (house CORS block) even though
// this pre-login function never reads it.
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

// Port of the legacy `php mailer/send_reset_link.php` generateResetCode():
// unambiguous alphabet (no I/O/0/1) so the code survives being read off a
// phone screen — but uppercase-only, so users can never mistype case
// (verify_password_reset hashes upper(trim(code)) to match).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateResetCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throttles: at most one code per email per 2 minutes, and at most 10 per
// email per rolling 24 hours — protects the Brevo free quota (300/day)
// from a scripted loop.  Both take the silent ok:true path.
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const DAILY_CAP = 10;
const CODE_TTL_MS = 60 * 60 * 1000; // 1 hour, same as the legacy PHP flow

interface Account {
  type: "student" | "staff";
  id: string;
  name: string;
  email: string;
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
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const rawEmail = typeof (body as { email?: unknown }).email === "string"
      ? ((body as { email: string }).email ?? "").trim()
      : "";

    if (!rawEmail || !EMAIL_PATTERN.test(rawEmail)) {
      return json(400, { error: "Please enter a valid email address." });
    }
    const email = rawEmail.toLowerCase();

    // 1) Resolve the account: staff first (adminprofiles), then students —
    //    the two stores of the custom-auth flow (035 / 001).  Exact match,
    //    then lowercase fallback for mixed-case stored rows.
    let account: Account | null = null;
    for (const attempt of [rawEmail, email]) {
      if (account) break;
      const { data: staff } = await adminClient
        .from("adminprofiles")
        .select("id, full_name, email")
        .eq("email", attempt)
        .maybeSingle();
      if (staff) {
        account = { type: "staff", id: staff.id, name: staff.full_name, email: staff.email };
        break;
      }
      const { data: student } = await adminClient
        .from("students")
        .select("id, first_name, last_name, email")
        .eq("email", attempt)
        .maybeSingle();
      if (student) {
        account = {
          type: "student",
          id: student.id,
          name: `${student.first_name} ${student.last_name}`.trim(),
          email: student.email,
        };
      }
    }

    // Unknown email: identical response to a known one (anti-enumeration).
    if (!account) {
      return json(200, { ok: true });
    }

    const accountEmail = account.email.toLowerCase();

    // 2) Throttles — silent ok:true (never reveal that a code was withheld).
    const since = (ms: number) => new Date(Date.now() - ms).toISOString();

    const { count: recentCount } = await adminClient
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", accountEmail)
      .gte("created_at", since(RESEND_COOLDOWN_MS));
    if ((recentCount ?? 0) > 0) {
      return json(200, { ok: true });
    }

    const { count: dailyCount } = await adminClient
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", accountEmail)
      .gte("created_at", since(24 * 60 * 60 * 1000));
    if ((dailyCount ?? 0) >= DAILY_CAP) {
      return json(200, { ok: true });
    }

    // 3) Invalidate any previous unused codes for this account (legacy PHP
    //    behaviour: only the newest code is ever valid).
    await adminClient
      .from("password_reset_codes")
      .update({ used: true })
      .eq("email", accountEmail)
      .eq("used", false);

    // 4) Mint + store (hash only) + audit.
    const code = generateResetCode(8);
    const codeHash = await sha256Hex(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: insertError } = await adminClient
      .from("password_reset_codes")
      .insert({
        account_type: account.type,
        account_id: account.id,
        email: accountEmail,
        code_hash: codeHash,
        expires_at: expiresAt,
      });
    if (insertError) throw new Error(insertError.message);

    try {
      await adminClient.rpc("insert_audit_log_rpc", {
        p_actor_id: null,
        p_actor_name: accountEmail,
        p_actor_role: "system",
        p_action: "Password Reset Requested",
        p_details: `Reset code issued for a ${account.type} account.`,
        p_type: "info",
      });
    } catch (err) {
      // Audit is best-effort; never block the reset flow on it.  A plain
      // try/await/catch — the bundled supabase-js query builder does not
      // implement .catch() chaining.
      console.error("send_password_reset: audit log failed", err);
    }

    // 5) Deliver through Brevo (HTTP API — see header note).
    const brevoKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "CNNHS-SVoCK";

    if (!brevoKey || !senderEmail) {
      console.error("send_password_reset: BREVO_API_KEY / BREVO_SENDER_EMAIL secrets are not set");
      return json(500, { error: "The email service is not configured. Please contact the administrator." });
    }

    const safeName = escapeHtml(account.name || "User");
    const safeCode = escapeHtml(code);
    const htmlContent = `
      <p>Magandang araw, <strong>${safeName}</strong>,</p>
      <p>Nakatanggap kami ng request para i-reset ang iyong password sa SVoCK (CNNHS Student Online Voting & Complaints Kiosk).</p>
      <p>Ilagay ang code na ito sa Forgot Password page upang magpatuloy:</p>
      <p style="font-size:22px; font-weight:bold; letter-spacing:3px;">${safeCode}</p>
      <p>Ang code ay balido lamang sa loob ng 1 oras.</p>
      <p>Kung hindi ikaw ang nag-request nito, maaari mong balewalain ang email na ito — hindi magbabago ang iyong password.</p>
      <p>Maraming salamat.</p>
      <p><strong>CNNHS-SVoCK Electoral Commission</strong></p>
    `;
    const textContent =
      `Magandang araw, ${account.name || "User"},\n\n` +
      `I-reset code para sa iyong SVoCK account: ${code}\n` +
      `Balido lamang sa loob ng 1 oras.\n\n` +
      `Kung hindi ikaw ang nag-request nito, maaari mong balewalain ang email na ito.`;

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "accept": "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: account.email, name: account.name || undefined }],
        subject: "SVoCK Password Reset Code",
        htmlContent,
        textContent,
      }),
    });

    if (!brevoRes.ok) {
      const detail = await brevoRes.text().catch(() => "");
      console.error(`send_password_reset: Brevo ${brevoRes.status}: ${detail}`);
      return json(502, { error: "Unable to send the reset code right now. Please try again later." });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("send_password_reset error:", err);
    return json(500, { error: "Unexpected server error. Please try again later." });
  }
});
