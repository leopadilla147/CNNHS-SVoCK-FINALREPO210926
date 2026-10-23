-- =====================================================================
-- 099 — THE PUBLIC COMPLAINT RECORD OF AN ELECTION
--
-- The results pages (Official Results, Past Elections) already show the
-- Board's note on the complaint(s) of record; this migration lets them
-- show the complaint record itself — every complaint filed under an
-- election with its final classification (097) and the Grievance
-- Commissioner's findings (086).
--
-- Why a definer RPC instead of a wider RLS policy: the `complaints`
-- table carries a student's name, the full complaint text and evidence
-- URLs, so 085 kept it (and its archive copy) admin-only on purpose.
-- This view of the record is deliberately SANITIZED — subject, status,
-- decision, findings and resolve date only.  No student name, no
-- complaint text, no evidence.  The 028/085 rule stays intact.
--
-- The live `complaints` table is the source (never trimmed — 052 keeps
-- every election and 085 its complaints), so ONE rpc serves the current
-- official results AND archived past elections alike.
--
--   1. `get_election_complaint_record_rpc(p_election_period_id)` —
--      stable, security definer, executable by anon + authenticated.
--      The client soft-fails to an empty record, so an un-migrated
--      database can never break the results pages.
-- =====================================================================

create or replace function public.get_election_complaint_record_rpc(
  p_election_period_id uuid
)
returns table (
  id uuid,
  subject text,
  status text,
  decision text,
  findings text,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.subject,
    c.status,
    c.decision,
    c.findings_note as findings,
    c.resolved_at
  from public.complaints c
  where c.election_period_id = p_election_period_id
  order by c.submitted_at asc, c.id asc;
$$;

revoke all on function public.get_election_complaint_record_rpc(uuid)
  from public, anon, authenticated;
grant execute on function public.get_election_complaint_record_rpc(uuid)
  to anon, authenticated;
