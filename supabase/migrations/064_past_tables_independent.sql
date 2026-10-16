-- =====================================================================
-- 064_past_tables_independent.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   Make the past-election snapshot fully INDEPENDENT of the live
--   parties/candidates tables.
--
--     1. public.past_election_candidates loses candidate_id and party_id
--        — the columns that still pointed at live rows.  A frozen result
--        must survive a party rename, a candidate edit, or the
--        composite-FK juggling AZ/repoint_election_period_*.sql performs.
--     2. The candidate-keyed unique index is replaced by a plain
--        (election_period_id, position) lookup index.  The natural key is
--        now the candidate NAME, which cannot be assumed unique, and the
--        writer (archive_election_results_internal) is delete-then-insert
--        inside one transaction, so it is idempotent without it.
--     3. total_votes integer records the race total (the sum of every
--        vote cast for that period + position) beside votes, so the share
--        shown for a historical candidate can never drift.
--     4. public.past_election_positions loses winner_candidate_id.  It was
--        written but never read by any RPC — the winner already lives in
--        past_election_candidates.is_winner.
--     5. public.past_parties — a new, independent, name-only list of the
--        parties that fielded approved candidates in a frozen election.
--        Deliberately NO code/color: public.parties has no such columns
--        (it is id, name, description, president_student_id, created_at,
--        election_period_id only).
--
-- NOTE
--   election_period_id KEEPS its FK.  election_periods rows are retained
--   forever (052 installs a no-delete trigger) and a snapshot with no
--   election to hang off would be meaningless.  The "independent" rule
--   applies to the live parties/candidates links only.
--
-- DEFENSIVE
--   An earlier draft of this migration created a duplicate table
--   (public.past_candidates) and stray party_code/party_color columns.
--   Everything below is drop-if-exists guarded so it converges whether or
--   not any part of that draft was ever applied.
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — past_election_candidates: DROP THE LIVE LINKS
-- ---------------------------------------------------------------------

-- The duplicate table from the earlier draft is superseded by
-- past_election_candidates: drop it.
drop table if exists public.past_candidates;

-- Drop the candidate-keyed uniqueness BEFORE dropping the column (dropping
-- the column would take the index with it, but be explicit).
drop index if exists public.past_election_candidates_period_position_candidate_key;

alter table public.past_election_candidates
  drop column if exists candidate_id,
  drop column if exists party_id,
  drop column if exists party_color;

create index if not exists past_election_candidates_period_position_idx
  on public.past_election_candidates (election_period_id, position);

-- total_votes: nullable first, backfilled, then tightened — safe even if the
-- earlier draft already added the column as a nullable integer.
alter table public.past_election_candidates
  add column if not exists total_votes integer;

update public.past_election_candidates pc
   set total_votes = t.total
  from (
    select election_period_id, position, sum(votes)::integer as total
      from public.past_election_candidates
     group by election_period_id, position
  ) t
 where t.election_period_id = pc.election_period_id
   and t.position = pc.position
   and (pc.total_votes is null or pc.total_votes is distinct from t.total);

alter table public.past_election_candidates
  alter column total_votes set default 0,
  alter column total_votes set not null;

-- ---------------------------------------------------------------------
-- SECTION 2 — past_election_positions: DROP THE LIVE LINK
-- ---------------------------------------------------------------------
alter table public.past_election_positions
  drop column if exists winner_candidate_id;

-- ---------------------------------------------------------------------
-- SECTION 3 — past_parties (new, independent, name only)
-- ---------------------------------------------------------------------
create table if not exists public.past_parties (
  id uuid primary key default gen_random_uuid(),
  election_period_id uuid not null references public.election_periods(id) on delete restrict,
  party_name text not null,
  snapshot_at timestamptz not null default now()
);

-- Defensive: the earlier draft added code/color columns.
alter table public.past_parties
  drop column if exists party_code,
  drop column if exists party_color;

create index if not exists past_parties_period_idx
  on public.past_parties (election_period_id);
drop index if exists public.idx_past_parties_election_period;

alter table public.past_parties enable row level security;

drop policy if exists past_parties_public_read on public.past_parties;
create policy past_parties_public_read
  on public.past_parties for select using (true);

revoke insert, update, delete on table public.past_parties from public, anon, authenticated;
grant select on table public.past_parties to anon, authenticated;

commit;
