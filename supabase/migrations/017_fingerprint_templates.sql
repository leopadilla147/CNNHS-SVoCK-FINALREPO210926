-- Add AS608 fingerprint slot (template ID) to biometric_templates so the
-- kiosk can store and retrieve enrolled fingerprints within the single main
-- Supabase project (mtsavbsrdyocoquflpvl.supabase.co).

alter table public.biometric_templates
  add column if not exists fingerprint_id integer;

-- One active fingerprint slot per enrollment; slots freed after deletion
-- (deleted_at is set) may be reused.
create unique index if not exists biometric_templates_fingerprint_id_unique
  on public.biometric_templates (fingerprint_id)
  where fingerprint_id is not null and deleted_at is null;
