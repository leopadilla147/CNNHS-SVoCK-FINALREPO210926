-- =====================================================================
-- 126_fix_past_election_snapshot_grades.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   125 aligned candidate grade levels with 124's executive-office
--   gates in public.candidates — but the PAST-ELECTIONS pages do not
--   read that table.  They read the frozen snapshot in
--   public.past_election_candidates (061/065/085), which still carries
--   the grade each row had when the Board froze the result: a Grade 7
--   President, a Grade 12 PIO, ... The snapshot only ever rebuilds when
--   the snapshot RPC is re-run for a period, so the stale grades stay
--   visible indefinitely.
--
-- WHAT
--   Applies 124's gates to the snapshot's grade_level: rows whose grade
--   sits outside their office's gate are re-graded to the office's
--   canonical grade.  Grade Representative rows (whose gate is their own
--   grade, unchanged by 124) and the legacy PRO rows are untouched, as
--   are votes / winner flags / names.  The table holds no birth dates,
--   so no DOB/age shift is needed here.
--
--   Idempotent: after the first run no snapshot row sits outside its
--   gate, so a re-run changes nothing.  If the Board ever re-runs the
--   snapshot RPC for a period, the rebuild reads from public.candidates
--   (already gate-compliant since 125), so the result stays compliant.
-- =====================================================================

begin;

with gate(position, valid_grades, new_grade) as (
  values
    ('President',        array['Grade 11', 'Grade 12'], 'Grade 12'),
    ('Vice President',   array['Grade 11', 'Grade 12'], 'Grade 11'),
    ('Secretary',        array['Grade 10'],             'Grade 10'),
    ('Treasurer',        array['Grade 10'],             'Grade 10'),
    ('Auditor',          array['Grade 8',  'Grade 9'],  'Grade 9'),
    ('PIO',              array['Grade 8',  'Grade 9'],  'Grade 9'),
    ('Protocol Officer', array['Grade 8',  'Grade 9'],  'Grade 8')
)
update public.past_election_candidates pec
set grade_level = g.new_grade
from gate g
where pec.position = g.position
  and not (pec.grade_level = any (g.valid_grades));

commit;
