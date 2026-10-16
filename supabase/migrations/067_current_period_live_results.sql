-- =====================================================================
-- 067_current_period_live_results.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   public.live_results_restricted (001:617) listed EVERY approved
--   candidate ever recorded -- it filtered only on status = 'approved'.
--   With archived periods kept permanently (052/066), the kiosk
--   "Opening/Final Election Audit" printed 332 candidates across 6
--   periods instead of the 52 belonging to the election being held.
--
-- WHAT
--   Re-issue the view with one added predicate:
--     c.election_period_id = public.current_election_period_id()
--   current_election_period_id() (058:91) is the app-wide "current
--   election" rule: lifecycle_stage <> 'completed', most recently
--   updated period wins.  A 'completed' period (archived by a reset,
--   066) is history and must not appear in the live/audit view.
--
--   Column list and order are unchanged, so CREATE OR REPLACE VIEW
--   keeps the view's owner and grants intact.
--
--   Past Elections is unaffected: list_past_elections_rpc /
--   get_past_election_results_rpc (053) read candidates/votes directly,
--   never this view.
-- =====================================================================

begin;

set search_path = public, extensions;

create or replace view public.live_results_restricted as
select
  c.election_period_id,
  c.position,
  c.id as candidate_id,
  c.given_name,
  c.surname,
  p.name as party_name,
  count(v.id) as votes
from public.candidates c
left join public.parties p on p.id = c.party_id
left join public.votes v on v.candidate_id = c.id
where c.status = 'approved'
  and c.election_period_id = public.current_election_period_id()
group by c.election_period_id, c.position, c.id, c.given_name, c.surname, p.name;

-- 058:818 revoked EXECUTE from PUBLIC; re-assert the roles that read this
-- view (the kiosk is anon) so the predicate never raises "permission denied".
grant execute on function public.current_election_period_id() to anon, authenticated;

commit;
