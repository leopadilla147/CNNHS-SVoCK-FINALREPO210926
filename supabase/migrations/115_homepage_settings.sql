-- 115_homepage_settings.sql
-- Homepage Setting (Chief Commissioner): the Election Guidelines file and
-- the footer "Contact Us" block become editable content.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   The public footer's Contact Us block (email / location / office hours)
--   and the Resources dropdown's "Election Guidelines" item were hardcoded.
--   The Chief Commissioner needs to upload the current guidelines document
--   and keep the contact details current without a redeploy.
--
-- WHAT
--   1) public.homepage_settings — a deliberate SINGLETON (id = 1, CHECK
--      enforced).  One row of site-wide content, seeded with the values the
--      footer shipped with.  Public READ (the footer renders for logged-out
--      visitors); NO direct write policy — every write goes through the
--      SECURITY DEFINER RPC below, which gates to the Chief.
--   2) storage bucket 'homepage-files' — public read, 10 MB, pdf/doc/docx.
--      The write policy carries NO auth.uid() condition: the custom
--      session-spine auth leaves auth.uid() null on the storage path
--      (020/072 precedent).  The RPC below validates that only a
--      homepage-files object URL is ever persisted.
--      NOTE: replacing the guidelines mints a NEW object and the old one is
--      left in the bucket (same orphan story as replaced profile pictures
--      before the delete edge function) — an occasional manual bucket sweep
--      is acceptable for a once-per-election file.
--   3) save_homepage_settings_rpc(...) — the ONLY writer of the row.
--      SECURITY DEFINER; gate reuses 103's chief_only_gate() (the session
--      must belong to the Chief Commissioner).  Office hours are plain
--      'HH:MM' strings (exactly what <input type="time"> submits); the RPC
--      enforces both-or-neither and end-after-start.  The guidelines URL,
--      when given, must point at the homepage-files bucket's public object
--      namespace.  Audit row follows the admin contract (actor_id set, the
--      actor exists in adminprofiles).
--   4) Grants: revoke the default PUBLIC EXECUTE, grant to anon and
--      authenticated — staff RPCs run under the anon PostgREST role
--      (093/103 precedent), and EXECUTE must never be public.

-- ---------------------------------------------------------------------
-- 1) Singleton settings table (public read, RPC-only write)
-- ---------------------------------------------------------------------
create table if not exists public.homepage_settings (
  id int primary key default 1 check (id = 1),
  guidelines_url text,
  guidelines_name text,
  contact_email text not null default 'voting@cnnhs.edu.ph',
  location text not null default 'Camarines Norte National High School, Daet, Camarines Norte, Philippines',
  office_hours_start text not null default '08:00',
  office_hours_end text not null default '17:00',
  updated_at timestamptz not null default now()
);

alter table public.homepage_settings enable row level security;

drop policy if exists "homepage settings public read" on public.homepage_settings;
create policy "homepage settings public read" on public.homepage_settings
  for select
  using (true);

-- Seed the singleton so the very first read never comes back empty.
insert into public.homepage_settings (id)
values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) Bucket + storage policies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'homepage-files',
  'homepage-files',
  true,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "homepage files public read" on storage.objects;
create policy "homepage files public read" on storage.objects
  for select
  using (bucket_id = 'homepage-files');

-- No auth.uid() condition — same custom-auth relaxation 020 applied to
-- candidate-pictures; the RPC gates what URL is ever persisted.
drop policy if exists "homepage files public write" on storage.objects;
create policy "homepage files public write" on storage.objects
  for insert
  with check (bucket_id = 'homepage-files');

-- ---------------------------------------------------------------------
-- 3) save_homepage_settings_rpc — the sole writer of the row
-- ---------------------------------------------------------------------
create or replace function public.save_homepage_settings_rpc(
  p_guidelines_url text,
  p_guidelines_name text,
  p_contact_email text,
  p_location text,
  p_office_hours_start text,
  p_office_hours_end text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_name text;
  v_result jsonb;
  v_hours_start text;
  v_hours_end text;
begin
  -- 103's shared gate: only the Chief Commissioner's session passes.
  perform public.chief_only_gate();

  v_actor := public.current_session_user_id();

  -- Contact content cannot be blanked out — an empty footer row would
  -- strand every visitor.
  if p_contact_email is null or btrim(p_contact_email) = '' then
    raise exception 'The contact email is required.';
  end if;
  if p_contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if p_location is null or btrim(p_location) = '' then
    raise exception 'The location is required.';
  end if;

  -- Office hours: both-or-neither, HH:MM, and the day must end after it
  -- starts (a school office never crosses midnight).  A cleared
  -- <input type="time"> submits an EMPTY STRING, not a null — normalize
  -- both to "not set" before the checks.
  v_hours_start := nullif(btrim(coalesce(p_office_hours_start, '')), '');
  v_hours_end := nullif(btrim(coalesce(p_office_hours_end, '')), '');
  if (v_hours_start is null) <> (v_hours_end is null) then
    raise exception 'Set both the opening and closing time, or leave both empty.';
  end if;
  if v_hours_start is not null then
    if v_hours_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_hours_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Office hours must be HH:MM times.';
    end if;
    if v_hours_end <= v_hours_start then
      raise exception 'The office closing time must be after the opening time.';
    end if;
  end if;

  -- The client may only persist a URL from the homepage-files bucket's
  -- public object namespace — nothing arbitrary.
  if p_guidelines_url is not null
     and position('/storage/v1/object/public/homepage-files/' in p_guidelines_url) = 0 then
    raise exception 'The guidelines file must be a homepage-files upload.';
  end if;

  insert into public.homepage_settings as h (id, guidelines_url, guidelines_name,
                                             contact_email, location,
                                             office_hours_start, office_hours_end)
  values (1,
          p_guidelines_url,
          p_guidelines_name,
          btrim(p_contact_email),
          btrim(p_location),
          coalesce(v_hours_start, ''),
          coalesce(v_hours_end, ''))
  on conflict (id) do update
    set guidelines_url     = excluded.guidelines_url,
        guidelines_name    = excluded.guidelines_name,
        contact_email      = excluded.contact_email,
        location           = excluded.location,
        office_hours_start = excluded.office_hours_start,
        office_hours_end   = excluded.office_hours_end,
        updated_at         = now();

  select full_name into v_name from public.adminprofiles where id = v_actor;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    coalesce(v_name, 'Chief Commissioner'),
    'admin',
    'Homepage Settings Updated',
    'The homepage settings were saved (guidelines file '
      || case when p_guidelines_url is null then 'unchanged/removed' else 'set' end
      || ', contact email ' || btrim(p_contact_email) || ').',
    'success'
  );

  select row_to_json(h)::jsonb into v_result
  from public.homepage_settings h where h.id = 1;

  return v_result;
end;
$$;

revoke all on function public.save_homepage_settings_rpc(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_homepage_settings_rpc(text, text, text, text, text, text) to anon, authenticated;
