-- =====================================================================
-- 047_biometric_fingerprint_id.sql
-- Adds fingerprint_id to biometric_templates so the seed data and kiosk
-- flows can reference the source fingerprint template identifier.
--
-- fingerprint_id is an integer that identifies which fingerprint (e.g.
-- thumb, index) was captured.  It is nullable so existing rows without
-- it are not broken.
-- =====================================================================

set search_path = public, extensions;

alter table public.biometric_templates
  add column if not exists fingerprint_id integer;