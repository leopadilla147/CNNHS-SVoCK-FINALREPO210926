-- =====================================================================
-- 046_chief_roster_and_abstain_rpcs.sql
-- Two chief-gated read surfaces the Chief Commissioner UI needs:
--   1. list_staff_roster_rpc()  — the existing commissioners + SSLG
--      advisers for the Officer Management tab.
--   2. get_abstain_summary_rpc() — per-position abstain counts for the
--      Election Reports tab (abstain percentage + winners summary).
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   * ROSTER — 037 dropped public.commissioners / public.sslg_advisers and
--     038 revoked ALL direct SELECT/DML on public.adminprofiles for
--     anon/authenticated, so no client-readable staff roster survives.
--     The Chief's Officer Management tab therefore renders an empty list.
--     The only safe read path is a SECURITY DEFINER RPC gated to the
--     Chief (the same posture as get_live_results_rpc in 027).  It never
--     returns password_hash or session_version.
--   * ABSTAIN — 018 stores an abstain as a votes row with
--     abstained = true and candidate_id = NULL.  The client never loads
--     public.votes (RLS admin-only, and the boot load does not read it),
--     so the abstain percentage cannot be computed client-side.  This RPC
--     returns the per-position abstain counts for the latest election
--     period, chief-gated like the live results.
--
-- GATE
--   Both functions enforce public.current_commissioner_role() = 'chief'
--   server-side (035 re-grounded that helper onto the session spine), so
--   no other commissioner, adviser, or student can read the roster or the
--   abstain ledger.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) list_staff_roster_rpc() — the Chief's staff roster read.
--    Returns every adminprofiles row EXCEPT the chief's own password
--    material: id, full_name, email, role_type, commissioner_role,
--    status, appointed_at.  Ordered: chief first, then commissioners,
--    then advisers, then by name.
-- ---------------------------------------------------------------------
create or replace function public.list_staff_roster_rpc()
returns table (
  id uuid,
  full_name text,
  email text,
  role_type text,
  commissioner_role text,
  status text,
  appointed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can view the staff roster.';
  end if;

  return query
    select a.id, a.full_name, a.email, a.role_type, a.commissioner_role,
           a.status, a.appointed_at
      from public.adminprofiles a
     order by
       case a.role_type
         when 'chief' then 1
         when 'commissioner' then 2
         when 'co_commissioner' then 3
         when 'sslg_adviser' then 4
         else 5
       end,
       a.full_name;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) get_abstain_summary_rpc() — per-position abstain counts.
--    Abstain rows (018): abstained = true AND candidate_id IS NULL, one
--    per (voter, position, election_period).  Scoped to the latest
--    election period (election_date desc, the 036 schedule shape).
-- ---------------------------------------------------------------------
create or replace function public.get_abstain_summary_rpc()
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
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can view abstain results.';
  end if;

  return query
    select v.election_period_id, v."position", count(*)::bigint as abstain_count
      from public.votes v
     where v.abstained = true
       and v.election_period_id = (
         select e.id
           from public.election_periods e
          order by e.election_date desc
          limit 1
       )
      group by v.election_period_id, v."position"
      order by v."position";
end;
$$;

-- ---------------------------------------------------------------------
-- 3) GRANTS — chief-only surfaces, re-asserted every run (027 posture).
-- ---------------------------------------------------------------------
revoke all on function public.list_staff_roster_rpc() from public, anon, authenticated;
grant execute on function public.list_staff_roster_rpc() to anon, authenticated;

revoke all on function public.get_abstain_summary_rpc() from public, anon, authenticated;
grant execute on function public.get_abstain_summary_rpc() to anon, authenticated;