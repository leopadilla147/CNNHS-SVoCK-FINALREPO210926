-- =====================================================================
-- 129_live_results_current_period.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   The Live Result page must be readable from the Voting Stage (running
--   OR closed/paused) all the way through the Results Stage, and only an
--   election-plan reset may close it:
--
--     * Close Voting / End Voting Stage (083/084/113) move the period to
--       'results' with is_active = false -- the tallies must stay
--       readable while the board reviews and publishes.
--     * Publish & Proclaim Winners (081) also run with is_active = false,
--       so an is_active scope blanked the page's tallies to zero exactly
--       when the official record existed.
--     * Void Election (113) returns the SAME period to 'voting' (paused)
--       after deleting its votes: the page stays up and the tallies
--       simply read 0 -- a void resets the vote, it does not close the
--       live view.
--     * Reset Election Plan (058/078) is the only closer: it archives the
--       period to 'completed' (or clears it back to 'application'), which
--       current_election_period_id() (058:91) excludes.
--
-- WHAT
--   get_live_results_rpc (053) and get_live_abstain_summary_rpc (079)
--   scoped their period subselect to is_active = true.  Both now pin to
--   the app-wide current period instead -- the same scoping the
--   live_results_restricted view already received in 067.  Shapes, role
--   gates and grants are unchanged.
-- =====================================================================

begin;

set search_path = public, extensions;

create or replace function public.get_live_results_rpc()
returns table (
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  given_name text,
  surname text,
  party_name text,
  votes bigint
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('chief', 'electoral_board') then
    raise exception 'Only the Chief Commissioner or Commissioner of Electoral Board can view live results.';
  end if;

  -- 129 -- the current (non-completed) period: readable through the
  -- voting AND results stages, including after a Void; only an
  -- election-plan reset (completed) retires it.
  return query
    select
      v.election_period_id,
      v."position",
      v.candidate_id,
      v.given_name,
      v.surname,
      v.party_name,
      v.votes
    from public.live_results_restricted v
    where v.election_period_id = public.current_election_period_id();
end;
$$;

create or replace function public.get_live_abstain_summary_rpc()
returns table (
  election_period_id uuid,
  "position" text,
  abstain_count bigint
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('chief', 'electoral_board') then
    raise exception 'Only the Chief Commissioner or Commissioner of Electoral Board can view abstain results.';
  end if;

  -- 129 -- same re-scoping as get_live_results_rpc above.
  return query
    select v.election_period_id, v."position", count(*)::bigint as abstain_count
      from public.votes v
     where v.abstained = true
       and v.election_period_id = public.current_election_period_id()
      group by v.election_period_id, v."position"
      order by v."position";
end;
$$;

revoke all on function public.get_live_results_rpc() from public, anon, authenticated;
grant execute on function public.get_live_results_rpc() to anon, authenticated;

revoke all on function public.get_live_abstain_summary_rpc() from public, anon, authenticated;
grant execute on function public.get_live_abstain_summary_rpc() to anon, authenticated;

commit;
