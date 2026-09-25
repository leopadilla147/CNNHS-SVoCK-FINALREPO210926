import { createClient } from "@supabase/supabase-js";
import { getSessionToken } from "./session";

const supabaseUrl = "https://mtsavbsrdyocoquflpvl.supabase.co"
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10c2F2YnNyZHlvY29xdWZscHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTQ3MjUsImV4cCI6MjEwNTM3MDcyNX0.rXrm_7Lx2ZbK5kKZDgHXC6Foae60z_mQjDrXDX7T_xk"

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseUrlValue = supabaseUrl;

// The app authenticates via custom DB auth (phase-02 session spine), not
// Supabase Auth: no JWT sessions are created or persisted, so the Supabase
// auth layer is fully disabled.  RLS identity reaches the database through
// the x-session-token side-channel header added by the transport
// interceptor below (fallback transport — the platform edge 401s a
// non-JWT Authorization bearer, so PostgREST's own anon JWT is preserved).
const TRANSPORT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

function attachSessionToken(url: string, init?: RequestInit): RequestInit {
  const token = getSessionToken();
  if (!token) return init ?? {};

  const headers = new Headers(init?.headers);
  const path = new URL(url).pathname;

  // Fallback transport (docs/phase2-bearer-gate-probe.md): the hosted
  // Supabase edge rejects a non-JWT `Authorization: Bearer <64-hex>` with
  // 401 (bearer-gate assumption A does NOT hold on this instance).  So we
  // NEVER clobber PostgREST's own Authorization (the anon JWT used for
  // platform role selection); the session token rides in the dedicated
  // `x-session-token` side-channel header instead, and session_identity()
  // reads it first (migration 039), falling back to the bearer path.
  if (path.startsWith("/rest/v1/")) {
    headers.set("x-session-token", token);
  }
  // /functions/v1/... — the same side-channel header so it never conflicts
  // with the platform JWT the edge functions consume.
  if (path.startsWith("/functions/v1/")) {
    headers.set("x-session-token", token);
  }

  return { ...init, headers };
}

const transportFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return fetch(url, attachSessionToken(url, init));
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      ...TRANSPORT_OPTIONS,
      global: { fetch: transportFetch },
    })
  : null;