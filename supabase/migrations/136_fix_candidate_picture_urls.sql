-- =====================================================================
-- 136_fix_candidate_picture_urls.sql
-- Fixes candidates.picture_url after the move from the retired Supabase
-- project hfeozvpwfxbdjhuhhkjg.supabase.co to the current project
-- mtsavbsrdyocoquflpvl.supabase.co.
--
-- WHY
--   Seeded candidates (AZ/seed_*.sql, migration 130) still carry
--   picture_url values pointing at the OLD project host, so their
--   portraits 404 in the app.  While visually reviewing all 55 distinct
--   seeded portraits, three more problems surfaced and are fixed here:
--     * 5 rows whose picture file names were mangled (bad uuid
--       segments) -- the correctly-named files exist on the new
--       project, so the reference is repaired rather than dropped;
--     * 4 pictures that are not people at all (two "Thesis Hub"
--       website screenshots and two CNNHS school seals) -- they are
--       NULLed so the UI falls back to the default avatar (every
--       candidate view renders `picture ? <img> : <default avatar>`).
--
-- WHAT (three idempotent passes, in order)
--   1. HOST REPOINT -- rewrite the old host to the new one wherever it
--      still appears in candidates.picture_url.
--   2. TYPO REPAIR  -- map each mangled file name to the real file
--      (same upload timestamp, corrected uuid segment).
--   3. NOT-A-PERSON -- NULL picture_url for the 4 reviewed non-person
--      images.
--
-- MANUAL FOLLOW-UPS (outside SQL)
--   * Storage: candidate_a31a668b-43cb-4673-9f68-17d65f8713f6_1783437996425.jpg
--     is the only real portrait not yet uploaded to the new project's
--     candidate-pictures bucket -- re-upload it with the same name, or
--     students 999900000061 / 999900000135 keep a broken image.
--   * The 4 non-person files below exist ONLY on the old project; there
--     is nothing to delete from the new bucket.  Remove them from the
--     old project before retiring it.
--   * 41 EAF document images (eaf_front_* / eaf_back_*) also live only
--     on the old project -- re-upload them before retiring it.
--
-- SAFE TO RE-RUN: every statement is guarded by a LIKE on the exact
-- source path and rewrites to the same value on a second run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HOST REPOINT
-- ---------------------------------------------------------------------
update public.candidates
set picture_url = replace(
      picture_url,
      'https://hfeozvpwfxbdjhuhhkjg.supabase.co',
      'https://mtsavbsrdyocoquflpvl.supabase.co')
where picture_url like '%hfeozvpwfxbdjhuhhkjg.supabase.co%';

-- ---------------------------------------------------------------------
-- 2. TYPO REPAIR -- mangled file names -> the real files that exist
--    (each pair shares its upload timestamp; the mangled copy 404s)
-- ---------------------------------------------------------------------
update public.candidates
set picture_url = replace(
      picture_url,
      'candidate_45e6383e-d112-48ba-a3df-4e9e-a37a-73a78ea63a50_1786891280901.jpg',
      'candidate_45e6383e-d112-48ba-a03c-00e1c284e7ec_1786891280901.jpg')
where picture_url like '%candidate_45e6383e-d112-48ba-a3df-4e9e-a37a-73a78ea63a50_1786891280901.jpg%';

update public.candidates
set picture_url = replace(
      picture_url,
      'candidate_65e9a67b-fa12-4366-b688-d46d08c3090_1786897578858.jpg',
      'candidate_65e9a67b-fa12-4366-b688-d462d08c3090_1786897578858.jpg')
where picture_url like '%candidate_65e9a67b-fa12-4366-b688-d46d08c3090_1786897578858.jpg%';

update public.candidates
set picture_url = replace(
      picture_url,
      'candidate_69e9f468-5e7b-4e52-b54b-98f468b54b20_1786897692482.jpg',
      'candidate_69e9f468-5e7b-4e52-b54b-983f664d8a20_1786897692482.jpg')
where picture_url like '%candidate_69e9f468-5e7b-4e52-b54b-98f468b54b20_1786897692482.jpg%';

update public.candidates
set picture_url = replace(
      picture_url,
      'candidate_725ac484-1dee-4a7a-aac9-725ac4841dee_1786897094072.jpg',
      'candidate_725ac484-1dee-4a7a-aac9-3c0dc15f267c_1786897094072.jpg')
where picture_url like '%candidate_725ac484-1dee-4a7a-aac9-725ac4841dee_1786897094072.jpg%';

update public.candidates
set picture_url = replace(
      picture_url,
      'candidate_7862ad25-b55b-45a9-a967-7862ad25b55b_1786898129641.jpg',
      'candidate_7862ad25-b55b-45a9-a967-815f98e41e88_1786898129641.jpg')
where picture_url like '%candidate_7862ad25-b55b-45a9-a967-7862ad25b55b_1786898129641.jpg%';

-- ---------------------------------------------------------------------
-- 3. NOT-A-PERSON -- visually reviewed: screenshots / school seals,
--    not student portraits.  NULL lets every view fall back to the
--    default avatar.
-- ---------------------------------------------------------------------
update public.candidates
set picture_url = null
where picture_url like '%candidate_432bd6a6-b6ed-4b9f-bea1-79a246ff2a3b_1778590278040.jpg%';  -- "Thesis Hub" screenshot

update public.candidates
set picture_url = null
where picture_url like '%candidate_5a93bb43-a99e-44cc-a823-37a2d3a5561e_1783434580070.jpg%';  -- CNNHS school seal

update public.candidates
set picture_url = null
where picture_url like '%candidate_9bff18c0-3f4d-49a9-a039-7acb7057e914_1783426988844.jpg%';  -- CNNHS school seal

update public.candidates
set picture_url = null
where picture_url like '%candidate_e2898ec3-e837-41e2-bc29-86aed32200e1_1778507946977.jpg%';  -- "Thesis Hub" screenshot
