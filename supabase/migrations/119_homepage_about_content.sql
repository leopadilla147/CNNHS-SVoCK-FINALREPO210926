-- =====================================================================
-- 119_homepage_about_content.sql
--
-- Homepage Setting (Chief Commissioner): the About CNNHS page content —
-- the brief school information, the DepEd Vision, the DepEd Mission, and
-- Our Core Values — becomes editable, saved content.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   AboutCNNHSPage hardcoded the brief profile paragraph, the DepEd
--   Vision/Mission statements, and the four Core Values.  The Chief
--   Commissioner needs to keep that content current without a redeploy,
--   alongside the guidelines file and Contact Us block that 115 already
--   made editable.
--
-- WHAT
--   1) public.homepage_settings gains four columns (all defaulting to the
--      content the page shipped with, so the seed below keeps the public
--      page byte-identical until the Chief edits):
--        brief_info   text   — the profile paragraph under the school name
--        vision       text   — the DepEd Vision (newlines preserved)
--        mission      text   — the DepEd Mission; lines starting with the
--                              '•' bullet render as the styled bullet list
--        core_values  jsonb  — [{"title","gloss"}] cards under "Our Core
--                              Values" (Maka-Diyos / Maka-Tao / …)
--      Blank/empty values fall back to the shipped text client-side, so a
--      cleared field never strands the About page.
--   2) save_homepage_settings_rpc re-issued with the four new parameters
--      (signature changed → DROP first, 42P13 — 104 precedent).  Same
--      chief_only_gate() posture.  New validation: the three text fields
--      cap at 5000 chars; core_values must be a JSON array of at most 12
--      {"title","gloss"} objects with a non-empty title.  The audit row
--      now names the About content in its details.
--   3) Grants re-asserted for the new 10-argument signature.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) New About-content columns, seeded with the shipped wording
-- ---------------------------------------------------------------------
alter table public.homepage_settings
  add column if not exists brief_info text not null default '',
  add column if not exists vision text not null default '',
  add column if not exists mission text not null default '',
  add column if not exists core_values jsonb not null default '[]'::jsonb;

-- Seed the singleton with the exact content AboutCNNHSPage shipped with,
-- so the edit form opens pre-filled with what is already live.
update public.homepage_settings
   set brief_info  = 'CNNHS is a public secondary school in Daet, Camarines Norte, serving its learner community under the Department of Education. The school upholds the DepEd Vision, Mission, and Core Values in everything it does — including the election of its learner leaders.',
       vision      = 'We dream of Filipinos
who passionately love their country.
And whose values also competencies.
Also enable them to realize their full potential.
And contribute meaningfully to building the nation.

As a learner-centered public institution,
the Department of Education.
Continuously improves itself
to better serve its stakeholders.',
       mission     = 'To protect and promote the right of Filipino. To quality and equitable. Culture-base as well as complete basic education where:
• Students also learn in a child-friendly. Gender-sensitive too. And also safe and motivating environment.
• Teachers facilitate learning to nurture every learner.
• Administrators and staff. As stewards of the institution also ensure enabling and supportive environment. And effective learning to happen.
• Family, community, and stakeholders. Are also actively engaged. Also share responsibility for developing learners.',
       core_values = '[
         {"title": "Maka-Diyos",     "gloss": "Love for God"},
         {"title": "Maka-Tao",       "gloss": "Love for Fellowmen"},
         {"title": "Maka-Kalikasan", "gloss": "Love for Nature"},
         {"title": "Maka-Bansa",     "gloss": "Love for Country"}
       ]'::jsonb
 where id = 1
   and brief_info = ''
   and vision = ''
   and mission = ''
   and core_values = '[]'::jsonb;

-- ---------------------------------------------------------------------
-- 2) save_homepage_settings_rpc — signature grows by four, so DROP first
-- ---------------------------------------------------------------------
drop function if exists public.save_homepage_settings_rpc(text, text, text, text, text, text);

create or replace function public.save_homepage_settings_rpc(
  p_guidelines_url text,
  p_guidelines_name text,
  p_contact_email text,
  p_location text,
  p_office_hours_start text,
  p_office_hours_end text,
  p_brief_info text,
  p_vision text,
  p_mission text,
  p_core_values jsonb
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
  v_brief text;
  v_vision text;
  v_mission text;
  v_core_values jsonb;
  v_entry jsonb;
  v_title text;
  v_gloss text;
  v_clean jsonb;
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

  -- 119 About content: free text with a sane ceiling; empty is allowed —
  -- the client falls back to the school's shipped wording when a field is
  -- cleared.
  v_brief  := coalesce(p_brief_info, '');
  v_vision := coalesce(p_vision, '');
  v_mission := coalesce(p_mission, '');
  if char_length(v_brief) > 5000 or char_length(v_vision) > 5000 or char_length(v_mission) > 5000 then
    raise exception 'The brief information, Vision, and Mission are limited to 5000 characters each.';
  end if;

  -- core_values: normalize to [{"title","gloss"}]; every entry needs a
  -- non-empty title.  Null or an empty array persists as '[]' (the client
  -- falls back to the shipped four values).
  v_core_values := coalesce(p_core_values, '[]'::jsonb);
  if jsonb_typeof(v_core_values) <> 'array' then
    raise exception 'Core values must be a list.';
  end if;
  if jsonb_array_length(v_core_values) > 12 then
    raise exception 'At most 12 core values are allowed.';
  end if;

  v_clean := '[]'::jsonb;
  for v_entry in select * from jsonb_array_elements(v_core_values) loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'Each core value must be a title and description.';
    end if;
    v_title := btrim(coalesce(v_entry ->> 'title', ''));
    v_gloss := btrim(coalesce(v_entry ->> 'gloss', ''));
    if v_title = '' then
      raise exception 'Every core value needs a title.';
    end if;
    if char_length(v_title) > 100 then
      raise exception 'Core value titles are limited to 100 characters.';
    end if;
    if char_length(v_gloss) > 200 then
      raise exception 'Core value descriptions are limited to 200 characters.';
    end if;
    v_clean := v_clean || jsonb_build_object('title', v_title, 'gloss', v_gloss);
  end loop;

  insert into public.homepage_settings as h (id, guidelines_url, guidelines_name,
                                             contact_email, location,
                                             office_hours_start, office_hours_end,
                                             brief_info, vision, mission, core_values)
  values (1,
          p_guidelines_url,
          p_guidelines_name,
          btrim(p_contact_email),
          btrim(p_location),
          coalesce(v_hours_start, ''),
          coalesce(v_hours_end, ''),
          v_brief,
          v_vision,
          v_mission,
          v_clean)
  on conflict (id) do update
    set guidelines_url     = excluded.guidelines_url,
        guidelines_name    = excluded.guidelines_name,
        contact_email      = excluded.contact_email,
        location           = excluded.location,
        office_hours_start = excluded.office_hours_start,
        office_hours_end   = excluded.office_hours_end,
        brief_info         = excluded.brief_info,
        vision             = excluded.vision,
        mission            = excluded.mission,
        core_values        = excluded.core_values,
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
      || ', contact email ' || btrim(p_contact_email)
      || ', About CNNHS content '
      || case when jsonb_array_length(v_clean) = 0 then 'reset to standard' else 'updated' end
      || ').',
    'success'
  );

  select row_to_json(h)::jsonb into v_result
  from public.homepage_settings h where h.id = 1;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Grants — re-asserted for the new signature (115 posture).
-- ---------------------------------------------------------------------
revoke all on function public.save_homepage_settings_rpc(text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_homepage_settings_rpc(text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
