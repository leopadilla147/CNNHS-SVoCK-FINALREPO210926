-- =====================================================================
-- seed-parties.sql
-- Compatible party seed data for the v1.1 parties table.
--
-- Columns: id, name, description, president_student_id, created_at,
--          election_period_id
--
-- Since 052 a party belongs to exactly ONE election period and its name
-- is unique per period, so every row states its period.
--
-- Run in Supabase Dashboard > SQL Editor AFTER migration 052 and the
-- election periods exist.  Safe to re-run (ON CONFLICT DO NOTHING).
-- Order: 052 -> seed-parties -> seed-candidates.
-- =====================================================================

set search_path = public, extensions;

INSERT INTO public.parties (id, name, description, president_student_id, created_at, election_period_id)
SELECT
  v.id,
  v.name,
  v.description,
  v.president_student_id,
  v.created_at,
  v.election_period_id
FROM (VALUES
  ('07677ca1-4c74-4180-be95-62dd3ac427bc'::uuid, 'Progress Party'::text, null::text, null::uuid, '2026-05-01 09:39:28.52732+00'::timestamptz, '67ea45df-a0c0-4fc1-9843-0529ce6266ab'::uuid),
  ('7162ee76-5bb6-43c2-8126-917c0e2cc9e6', 'SULONG Party', null, null, '2026-05-09 17:20:02.818199+00', 'f48e5ec2-4e96-4731-94b2-3ac0825edf0d'),
  ('8a513434-048e-4235-85a4-a259389df184', 'LINGKOD Party', null, null, '2026-05-12 12:51:18.86326+00', '67ea45df-a0c0-4fc1-9843-0529ce6266ab'),
  ('a1b255e5-4bf3-4d21-8d97-d431496f00ce', 'Unity Alliance', null, null, '2026-05-01 09:39:28.52732+00', '67ea45df-a0c0-4fc1-9843-0529ce6266ab'),
  ('a7621ec7-a3fe-4a01-99cc-e19ae3113a2d', 'Kabataan Tungo sa Serbisyo', null, 'ba72095a-44aa-4d23-9615-39fee9f84139', '2026-08-16 16:14:09.216113+00', '67ea45df-a0c0-4fc1-9843-0529ce6266ab'),
  ('c1286650-6274-4afa-a599-9eda53ce1f20', 'KABATAAN Party', null, null, '2026-07-07 16:34:43.387531+00', '67ea45df-a0c0-4fc1-9843-0529ce6266ab'),
  ('cf93039f-3a77-4710-a60e-cbf33ed97cff', 'sangulo', null, 'ea79a300-12fb-4144-8105-d27f01053dd7', '2026-08-16 16:07:13.107961+00', '67ea45df-a0c0-4fc1-9843-0529ce6266ab'),
  ('e6b25626-b06b-462c-bfbf-0bc4287058d6', 'Kabataan Para sa Pagbabago', null, 'c18d5fc7-478c-4a63-a2c8-e1621ac07ef0', '2026-08-16 14:17:52.745401+00', '67ea45df-a0c0-4fc1-9843-0529ce6266ab')
) AS v(id, name, description, president_student_id, created_at, election_period_id)
ON CONFLICT DO NOTHING;

-- LINGKOD Party also has a candidacy in a second election period: a
-- party is per-period since 052, so that period needs its own row.  The
-- id is data-dependent on a migrated database, so candidates resolve it
-- by name + period (see seed-candidates.sql).
INSERT INTO public.parties (name, description, president_student_id, created_at, election_period_id)
SELECT
  'LINGKOD Party',
  null,
  null,
  '2026-05-12 12:51:18.86326+00'::timestamptz,
  'bcbd2549-28a5-4f94-bf63-1035b77c61ba'::uuid
ON CONFLICT (election_period_id, name) DO NOTHING;
