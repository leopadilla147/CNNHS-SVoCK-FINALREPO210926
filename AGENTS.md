# AGENTS.md

## Workflow rules (do not violate)

- **Database changes**: never apply to Supabase directly. Put every schema/migration/function change as a file under `supabase/` (new numbered migration `supabase/migrations/NNN_*.sql`, or edge function under `supabase/functions/<name>/index.ts`). The user applies them in Supabase themselves.
- **Website testing**: do not run the dev server or test the website yourself; the user tests it unless explicitly asked.

## Commands

- Install: `npm i`
- Dev server: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck` (tsc --noEmit, strict)
- Tests: `npm test` (vitest, jsdom env)
- DB/edge-function tests: `npm run test:db` (requires Supabase CLI)

There is no lint script.

## Environment / setup gotchas

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are mandatory — `vite.config.ts` hard-throws when missing on `dev`/`build`. Copy `.env.example` → `.env.local`. `.env.local` already exists locally; never commit or echo its contents. The app has no offline/mock fallback.
- Seed auth account is `chief.commissioner@cnnhs.edu` / `chief123` (see `supabase/README.md`); change before real data.

## Auth architecture (non-obvious)

- This is **not** Supabase Auth. It uses a custom DB session spine: login RPCs mint a raw 64-hex token; the DB stores only its SHA-256. The raw token lives in localStorage under `svock_session_token`.
- Only `src/app/lib/session.ts` and the transport interceptor in `src/app/lib/supabase.ts` may touch that token. The interceptor sends it as `Authorization: Bearer <raw>` to `/rest/v1` and as `x-session-token` to `/functions/v1`; RLS identity resolves from these headers (see `docs/phase2-bearer-gate-probe.md`).
- The Supabase client is created with `persistSession: false` and a custom `global.fetch`.

## Codebase facts

- Vite + React 18 + TypeScript, react-router 7 (`src/app/routes.tsx`). Alias `@` → `./src`.
- MUI 7 and Tailwind 4 + Radix/shadcn-style primitives in `src/app/components/ui/` are both in use; keep both plugins in `vite.config.ts`.
- Tests are colocated `*.test.ts(x)` under `src/`.

## Supabase backend

- Migrations: `supabase/migrations/` (numbered 001...033+). Edge functions: `supabase/functions/<name>/index.ts` (Deno TS), with tests in `supabase/functions/tests/*.ts`.
- `kiosk_vote` also exists in this repo, but the deployed kiosk function is built/deployed from the separate `SVoCK_Kiosk` project — do not deploy it from here.