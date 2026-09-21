import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client-side session token storage for the phase-02 session spine.
 *
 * The raw 64-hex token minted by `login_student_direct_v2` (and the 035
 * `login_staff_direct_v2` staff login) lives here and is attached by the
 * supabase.ts transport interceptor as the `x-session-token` side-channel
 * header on /rest/v1 and /functions/v1 requests (fallback transport — the
 * platform edge 401s a non-JWT bearer).  The database stores only its
 * SHA-256; session_identity() reads the header (migration 039).
 *
 * This module (plus the interceptor in supabase.ts) is the ONLY place
 * allowed to touch `svock_session_token` — keep it that way
 * (02-RESEARCH grep-zero proof).
 */

const TOKEN_KEY = "svock_session_token";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (privacy mode / SSR) — behave as logged out.
    return null;
  }
}

export function saveSessionToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Best effort; a failed write degrades to logged-out on next probe.
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Best effort.
  }
}

export interface SessionBootstrapResult {
  /** A valid server-side session backs the saved current user. */
  valid: boolean;
  /** A token existed but is dead (absent / expired / probe failed). */
  expired: boolean;
}

/**
 * Validate a saved session token against the server.
 *
 * Discrimination contract (D-02): an RPC `error` means the server hiccuped
 * (transient — keep the token), a resolved `null` means the server
 * affirmatively knows the session is absent/expired (dead — clear it).
 * - No token -> { valid: false, expired: true }: every login path mints a
 *   token, so a saved user without one is a stale/phantom login; the
 *   AppContext branch clears it (pre-023 keep-alive path removed).
 * - Probe RPC error or thrown network failure -> { valid: false,
 *   expired: false }: transient failures keep the token and leave the user
 *   logged in (the AppContext branch ignores `expired: false`).
 * - Probe RESOLVES null -> { valid: false, expired: true }: the dead token
 *   is cleared here so a dead session cannot ride along invisibly.
 */
export async function bootstrapSession(
  client: SupabaseClient
): Promise<SessionBootstrapResult> {
  const token = getSessionToken();
  if (!token) return { valid: false, expired: true };

  try {
    const { data, error } = await client.rpc("current_session_role");
    if (error) {
      // D-01/D-02: error = transient (network/DB hiccup) — keep the token.
      return { valid: false, expired: false };
    }
    if (!data) {
      // D-02/D-03: resolves null = affirmatively dead — clear + expired UX.
      clearSessionToken();
      return { valid: false, expired: true };
    }
    return { valid: true, expired: false };
  } catch {
    // D-01: thrown network failure — keep the token.
    return { valid: false, expired: false };
  }
}