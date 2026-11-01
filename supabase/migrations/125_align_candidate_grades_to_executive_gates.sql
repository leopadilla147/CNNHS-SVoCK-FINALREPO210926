-- =====================================================================
-- 125_align_candidate_grades_to_executive_gates.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   124 gated the executive offices per grade for NEW applications:
--     President / Vice President -> Grade 11-12
--     Secretary / Treasurer      -> Grade 10
--     Auditor / PIO / Protocol Officer -> Grade 8-9
--   Seeded and past-election rows still carry grade levels that predate
--   the gates (a Grade 7 President, a Grade 12 PIO, ...), so the roster,
--   archive, and ballot views show data the Apply page could no longer
--   produce.  This migration aligns the EXISTING rows with the gates.
--
-- WHAT
--   1. candidates (every period): rows whose grade sits outside their
--      office's gate are re-graded to the office's canonical grade, with
--      age and date_of_birth shifted to match (the seeds' convention:
--      age = grade + 5; the birth year moves DOWN by the grade delta).
--      Rows that already pass the gate — including real applications —
--      are left completely untouched.
--   2. students: an account holding a CURRENT-period candidacy that was
--      re-graded is synced to the candidacy's grade and birthdate, so a
--      student's profile never contradicts the seat they hold.  Past-
--      period candidacies stay historical — only candidates is rewritten
--      there.
--   3. student_masterlist: rows behind those synced accounts follow.
--
--   Idempotent: after the first run no row sits outside its gate, so a
--   re-run re-grades nothing.
-- =====================================================================

begin;

with gate(position, valid_grades, new_grade, new_age) as (
  values
    ('President',        array['Grade 11', 'Grade 12'], 'Grade 12', 17),
    ('Vice President',   array['Grade 11', 'Grade 12'], 'Grade 11', 16),
    ('Secretary',        array['Grade 10'],             'Grade 10', 15),
    ('Treasurer',        array['Grade 10'],             'Grade 10', 15),
    ('Auditor',          array['Grade 8',  'Grade 9'],  'Grade 9',  14),
    ('PIO',              array['Grade 8',  'Grade 9'],  'Grade 9',  14),
    ('Protocol Officer', array['Grade 8',  'Grade 9'],  'Grade 8',  13)
),
regraded as (
  update public.candidates c
  set grade_level = g.new_grade,
      age = g.new_age,
      -- The birth year moves DOWN by the grade delta (an older student was
      -- born earlier); month and day are preserved.
      date_of_birth = case
        when c.age is not null and c.date_of_birth is not null
          then (c.date_of_birth - make_interval(years => g.new_age - c.age))::date
        else c.date_of_birth
      end
  from gate g
  where c.position = g.position
    and not (c.grade_level = any (g.valid_grades))
  returning c.id, c.student_id, c.election_period_id, c.grade_level, c.date_of_birth
),
synced as (
  update public.students s
  set grade_level = r.grade_level,
      birthdate   = r.date_of_birth
  from regraded r
  where s.id = r.student_id
    and r.election_period_id = public.current_election_period_id()
  returning s.id, s.grade_level, s.birthdate, s.masterlist_id
)
update public.student_masterlist m
set grade_level = x.grade_level,
    birthdate   = x.birthdate
from synced x
where m.id = x.masterlist_id;

commit;
