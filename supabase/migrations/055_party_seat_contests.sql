-- 055_party_seat_contests.sql
--
-- Party offices become CONTESTABLE: several students may run for the same
-- office of the same party, and the party President picks one winner.
--
-- Why this file exists rather than an edit to 052: 052 is already applied to
-- the live project, so the one-row-per-seat rule from 001 has to be relaxed
-- by a new numbered migration.
--
-- What 269 was actually protecting, and what replaces it:
--   * 001:269  unique (election_period_id, party_id, position)
--     -> one candidate per office per party.  This is what produced
--        "duplicate key value violates unique constraint
--         candidates_election_period_id_party_id_position_key".
--        Dropped here so offices can be contested.
--   * 001:268  unique (student_id, election_period_id)
--     -> KEPT.  One candidacy per student per election is a real rule and
--        is unrelated to contests.
--   * 054 candidates_one_approved_per_party_position
--     -> one WINNER per office.  This is the guard that actually matters;
--        a contest may have many requests but only one approved holder.
--   * 054 candidates_one_approved_president_per_party
--     -> one screening-approved President per party.
--
-- Part 2 below is required because of 052:713-725, which deliberately exempts
-- a President applicant from the "party must have an approved President" check
-- ("A President applicant is exempt - running for President is how a slate gets
-- one in the first place").  That exemption was safe only while 269 existed.
-- Once 269 is gone, anyone could submit position = 'President' against a party
-- that already has one, and the resulting row could never be resolved:
--   * 054:277-278  the party President cannot decide a President candidacy
--                   ("approved by the Screening Office, not by the party")
--   * 054:281      "That candidacy is no longer open for a party decision."
--   * 054:462      re-application is blocked
-- Screening could still try, but 054 candidates_one_approved_president_per_party
-- would then reject the second approval.  The trigger turns that silent,
-- unrecoverable state into an immediate, readable error.
--
-- The guard is "does this party already have a President row", not "does it
-- have an APPROVED President": the founder's own insert creates the first
-- President row, so it must be allowed through, and it cannot be gated on
-- approval status (nothing is approved at application time).
--
-- Known gap this does NOT fix: 052:694-705 recovers a same-name party race by
-- adopting the winner's parties row, but the candidate insert that follows
-- (:737) still collides.  Part 2 converts that into the readable message
-- below.  Fully fixing it means editing the already-applied 052 RPC.

-- Part 1 -------------------------------------------------------------------
alter table public.candidates
  drop constraint if exists candidates_election_period_id_party_id_position_key;

-- Part 2 -------------------------------------------------------------------
-- One President candidacy per party per election.  Raised in the same
-- transaction as the offending insert, so nothing partial is written.
create or replace function public.guard_party_president_seat()
returns trigger
language plpgsql
as $$
begin
  if new.party_id is not null
     and new.position = 'President'
     and exists (
       select 1
       from public.candidates c
       where c.party_id = new.party_id
         and c.election_period_id = new.election_period_id
         and c.position = 'President'
         and c.id is distinct from new.id
     )
  then
    raise exception
      'This party already has a President on file. Join it for an open position instead.';
  end if;

  return new;
end;
$$;

drop trigger if exists candidates_one_president_per_party on public.candidates;

create trigger candidates_one_president_per_party
  before insert or update of party_id, position
  on public.candidates
  for each row
  execute function public.guard_party_president_seat();
