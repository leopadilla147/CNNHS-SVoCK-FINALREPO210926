-- =====================================================================
-- seed-parties.sql
-- Compatible party seed data for the v1.1 parties table.
--
-- Columns: id, name, description, president_student_id, created_at
--
-- Run in Supabase Dashboard > SQL Editor.  Safe to re-run (INSERT ...
-- ON CONFLICT DO NOTHING on the name unique constraint).
-- =====================================================================

set search_path = public, extensions;

INSERT INTO public.parties (id, name, description, president_student_id, created_at) VALUES
  ('07677ca1-4c74-4180-be95-62dd3ac427bc', 'Progress Party', null, null, '2026-05-01 09:39:28.52732+00'),
  ('7162ee76-5bb6-43c2-8126-917c0e2cc9e6', 'SULONG Party', null, null, '2026-05-09 17:20:02.818199+00'),
  ('8a513434-048e-4235-85a4-a259389df184', 'LINGKOD Party', null, null, '2026-05-12 12:51:18.86326+00'),
  ('a1b255e5-4bf3-4d21-8d97-d431496f00ce', 'Unity Alliance', null, null, '2026-05-01 09:39:28.52732+00'),
  ('a7621ec7-a3fe-4a01-99cc-e19ae3113a2d', 'Kabataan Tungo sa Serbisyo', null, 'ba72095a-44aa-4d23-9615-39fee9f84139', '2026-08-16 16:14:09.216113+00'),
  ('c1286650-6274-4afa-a599-9eda53ce1f20', 'KABATAAN Party', null, null, '2026-07-07 16:34:43.387531+00'),
  ('cf93039f-3a77-4710-a60e-cbf33ed97cff', 'sangulo', null, 'ea79a300-12fb-4144-8105-d27f01053dd7', '2026-08-16 16:07:13.107961+00'),
  ('e6b25626-b06b-462c-bfbf-0bc4287058d6', 'Kabataan Para sa Pagbabago', null, 'c18d5fc7-478c-4a63-a2c8-e1621ac07ef0', '2026-08-16 14:17:52.745401+00')
ON CONFLICT (name) DO NOTHING;