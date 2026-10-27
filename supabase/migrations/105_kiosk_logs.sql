-- =====================================================================
-- 105_kiosk_logs.sql
-- Add public.kiosk_logs — the kiosk event log.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHAT
--   One row per kiosk-side event: authentication, voting, printer,
--   fingerprint, synchronization, or system. Columns follow the project
--   data dictionary:
--     id           uuid pk
--     user_id      nullable uuid, NO foreign key. Kiosk actors may be
--                  students (students.id) or admins (adminprofiles.id) and
--                  profiles was dropped in 037, so the id is stored raw —
--                  the log survives the deletion of any user.
--     kiosk_num    kiosk label, e.g. 'K1' / 'K2'
--     event_type   category: authentication | voting | printer |
--                  fingerprint | synchronization | system
--     action       activity name, e.g. 'fingerprint_verification',
--                  'vote_submission', 'receipt_printing'
--     description  human-readable detail of the event
--     status       outcome: success | failed | warning (check-enforced)
--     created_at   event time, defaults to now()
--
-- RLS
--   Mirrors the audit_logs policy pattern (001_initial_schema.sql):
--     * admin can read;
--     * authenticated users and the service role (kiosk edge function)
--       can insert.
--
-- INDEX
--   created_at DESC — the log UI always reads "most recent first".
-- =====================================================================

set search_path = public, extensions;

create table if not exists public.kiosk_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  kiosk_num   text,
  event_type  text not null,
  action      text not null,
  description text,
  status      text not null default 'success'
              check (status in ('success', 'failed', 'warning')),
  created_at  timestamptz not null default now()
);

alter table public.kiosk_logs enable row level security;

drop policy if exists "kiosk logs admin select" on public.kiosk_logs;
create policy "kiosk logs admin select" on public.kiosk_logs
  for select
  using (public.current_app_role() = 'admin');

drop policy if exists "kiosk logs authenticated insert" on public.kiosk_logs;
create policy "kiosk logs authenticated insert" on public.kiosk_logs
  for insert
  with check (auth.uid() is not null or auth.role() = 'service_role');

create index if not exists kiosk_logs_created_at_idx
  on public.kiosk_logs (created_at desc);
