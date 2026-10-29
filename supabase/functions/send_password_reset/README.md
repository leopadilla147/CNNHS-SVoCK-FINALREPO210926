# send_password_reset — Brevo setup & deploy guide

Forgot-password email OTP for CNNHS-SVoCK. A student or staff member enters
their email on `/forgot-password`; this edge function emails a one-time
8-character code; they submit the code + a new password, which the
`verify_password_reset` RPC (migration 120) validates.

**Why Brevo (and not Gmail SMTP):** hosted Supabase edge functions run on
Deno Deploy, which blocks outbound connections to SMTP ports 25/465/587.
Gmail only offers SMTP on those ports, so the legacy `php mailer/` approach
physically cannot run here. Brevo's HTTP API works from a plain `fetch()`
and its free plan (300 emails/day, no credit card, no custom domain) is far
more than a password-reset flow will ever use.

## 1. Create the Brevo account (free)

1. Go to <https://app.brevo.com> and sign up (Free plan — no card required).
2. Brevo asks for profile/company details — the school name is fine.
3. Free plan includes 300 emails/day; resets need maybe a handful per week.

## 2. Verify the sender address (no domain needed)

The "From" address every reset email is sent from.

1. In Brevo: **Senders, Domains & Dedicated IPs → Senders → Add a sender**.
2. Enter an inbox you control (e.g. the school's Gmail, or a personal one
   used for the capstone), name it `CNNHS-SVoCK`.
3. Brevo sends a confirmation email to that address — click **Verify**.

> Tip: do NOT reuse the Gmail app password that was hardcoded in
> `php mailer/send_code.php` — that credential is exposed in the repo and
> should be revoked in the Google account regardless of this feature.

## 3. Create the API key

1. In Brevo: click your initials (top-right) → **SMTP & API → API Keys**.
2. **Generate a new API key (v3)**, give it a name like `svock-reset`, and
   copy it immediately (it is shown only once, starts with `xkeysib-`).

## 4. Store the secrets in Supabase

Run from the repo root (the Supabase CLI must be linked to the project —
`supabase link --project-ref <ref>` if not yet linked):

```
supabase secrets set BREVO_API_KEY=xkeysib-... BREVO_SENDER_EMAIL=the-verified-sender@example.com
```

Optional: `BREVO_SENDER_NAME` (defaults to `CNNHS-SVoCK`).

These are server-side function secrets — never committed, never exposed to
the SPA.

## 5. Apply the database migration (migration 120)

Per the repo workflow rules, migrations are applied by the user in the
Supabase dashboard:

1. Dashboard → **SQL Editor** → paste the contents of
   `supabase/migrations/120_password_reset.sql` → **Run**.

This creates the `password_reset_codes` table and the
`verify_password_reset` RPC (granted to `anon` + `authenticated` per the
repo convention).

## 6. Deploy the function

```
supabase functions deploy send_password_reset --no-verify-jwt
```

`verify_jwt = false` is already declared in `supabase/config.toml`; the
deploy-time flag keeps the two in sync. The function is pre-login (no
session token exists yet); abuse is bounded by its per-email 2-minute
cooldown + 10/day cap, and the verify RPC reuses the 023 login lockout
(5 bad codes → 15-minute lock, shared with login failures).

## 7. Test end-to-end

1. `npm run dev`, open `/login` → **Forgot password?**
2. Enter a registered email → the inbox receives the code within seconds.
3. Enter the code + a new password (≥ 8 chars) → log in with it.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| `The email service is not configured` | `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` secrets missing — step 4 |
| `Unable to send the reset code right now` | Brevo rejected the send — function logs (Dashboard → Edge Functions → send_password_reset → Logs) show Brevo's status + body |
| Email never arrives, but 200 ok | Sender not verified (step 2), or the recipient's spam folder |
| `Invalid or expired reset code` | Code is case-insensitive, but it expires after 1 hour; a newer request invalidates older codes |
| Free project paused | Supabase pauses free projects after ~1 week of inactivity — open the dashboard to restore before testing |

## Security notes

- Only the SHA-256 of the code is stored (`password_reset_codes.code_hash`) —
  same derivation as the 022 session spine. The plaintext code exists only
  in the email.
- The endpoint answers `{ ok: true }` for unknown emails (anti-enumeration).
- A successful reset bcrypt-hashes the new password (`crypt` + `bf, 10`),
  bumps `session_version`, and deletes every active session — a stolen
  session dies with the reset.
- Codes are uppercase-only and unambiguous (no I/O/0/1); verification is
  case-insensitive.
