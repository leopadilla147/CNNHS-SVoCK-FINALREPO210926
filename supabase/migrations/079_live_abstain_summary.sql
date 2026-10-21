-- =====================================================================
-- 079_live_abstain_summary.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   get_live_abstain_summary_rpc() — abstain counts per position for the
--   Live Results tab (AdminLiveResults).  Abstain rows (018) carry
--   abstained = true AND candidate_id IS NULL, so they never join to
--   candidates and are invisible to get_live_results_rpc; this RPC
--   aggregates them separately.
--
--   * Gate mirrors get_live_results_rpc (053: chief OR electoral_board) —
--     the Live Results tab is used by both commissioners, unlike the
--     chief-only get_abstain_summary_rpc (046) that AdminReports keeps
--     using unchanged.
--   * Period scoping mirrors get_live_results_rpc (053: is_active = true,
--     election_date desc nulls last …), so abstains appear exactly when
--     live results do.
-- =====================================================================

begin;

set search_path = public, extensions;

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

  return query
    select v.election_period_id, v."position", count(*)::bigint as abstain_count
      from public.votes v
     where v.abstained = true
       and v.election_period_id = (
         select e.id
           from public.election_periods e
          where e.is_active = true
          order by e.election_date desc nulls last, e.school_year desc, e.id
          limit 1
       )
      group by v.election_period_id, v."position"
      order by v."position";
end;
$$;

revoke all on function public.get_live_abstain_summary_rpc() from public, anon, authenticated;
grant execute on function public.get_live_abstain_summary_rpc() to anon, authenticated;

commit;
