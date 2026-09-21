-- Grant access to live_results_restricted view through the API
-- The view aggregates vote counts per candidate per position
-- It runs with security_definer (owner privileges), bypassing underlying RLS
-- so we restrict access by granting only to authenticated users

grant select on public.live_results_restricted to authenticated;
