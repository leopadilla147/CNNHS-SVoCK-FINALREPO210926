-- =====================================================================
-- 048_votes_transaction_ballot_unique.sql
-- The kiosk now writes the SAME ballot-level transaction_id
-- (TXN-YYMMDD-XXXX) to every row of a ballot — no position slug appended.
-- 031's partial UNIQUE index on (transaction_id) alone rejects that
-- multi-row insert (23505 on the second row), which surfaced as a
-- 409 "already voted" while the votes table stayed empty.
--
-- Fix: scope the uniqueness to (transaction_id, "position") so
--   * one ballot id may appear once per position (a full ballot inserts), and
--   * a replay of the same ballot (same id + same positions) is still
--     idempotent at the constraint level.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
-- =====================================================================

set search_path = public, extensions;

-- 031's ballot-hostile index: unique on transaction_id alone.
drop index if exists public.votes_transaction_id_key;

-- Ballot-scoped uniqueness: (ballot id, position). A fresh ballot inserts
-- every row; a replay conflicts per row and is rejected (23505 -> 409).
create unique index if not exists votes_transaction_position_key
  on public.votes (transaction_id, "position")
  where transaction_id is not null;