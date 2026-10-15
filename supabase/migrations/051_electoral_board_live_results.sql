set search_path = public, extensions;

revoke select on table public.live_results_restricted from public, anon, authenticated;

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

  return query
    select * from public.live_results_restricted;
end;
$$;

revoke all on function public.get_live_results_rpc() from public, anon, authenticated;
grant execute on function public.get_live_results_rpc() to anon, authenticated;
