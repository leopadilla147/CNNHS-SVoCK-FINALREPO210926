-- =====================================================================
-- 140_fill_seed_rpc_missing_pictures.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent (guarded UPDATE + create or
-- replace).
--
-- WHY
--   Two of the 46 spec rows in the inject-seed batch were seeded with
--   picture_url = null, so the UI shows them with the default avatar:
--     * 999900000042  Andrea Gonzales Bautista   Grade 12, Female
--       -- President of Samahan ng Kabataan Tungo sa Kinabukasan (B)
--     * 999900000075  Adrian Aguilar Del Rosario  Grade 9,  Male
--       -- independent Auditor
--   The user asked to fill them by reusing other seeded portraits.
--
-- WHAT (idempotent passes, in order)
--   1. HOST REPOINT -- rewrite the retired project host to the current
--      one wherever it still appears in candidates.picture_url (the
--      same guarded replace as 136/139; a no-op once 139 has run, but
--      kept here so this file is self-sufficient).
--   2. DATA BACKFILL -- set picture_url on existing candidate rows for
--      those two students wherever it is still null.
--   3. RPC RE-DEPLOY -- create or replace seed_extra_parties_rpc with
--      the same corrected body as 139/130 except the two spec rows now
--      carry the reused portraits, so future injections land with
--      pictures too.
--
--   PORTRAIT CHOICE (both files already exist on the new project's
--   candidate-pictures bucket and survived 136's visual review):
--     * 042 reuses 999900000058's portrait (Party C Secretary, Female)
--       -- same gender, different party AND different position, so no
--       same-party or same-office face clash on the ballot.
--     * 075 reuses 999900000065's portrait (Party C Grade 11 Rep, Male)
--       -- same gender, different party AND different position.
--     Deliberately NOT reused: candidate_a31a668b-... (999900000061 /
--     999900000135) -- 136's manual follow-up notes it was never
--     re-uploaded to the new bucket and still 404s.
--
-- SAFE TO RE-RUN: the UPDATEs are guarded by a LIKE on the old host
-- (rewrites to the same value on a second run) and by picture_url is
-- null; the function is create or replace and the grants are
-- re-asserted.
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
-- 2. DATA BACKFILL
-- ---------------------------------------------------------------------
update public.candidates c
set picture_url = 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_87606c2f-53ad-4195-b3e3-dfeb10b8b626_1786899001445.jpg'
from public.students s
where s.id = c.student_id
  and s.lrn = '999900000042'
  and c.picture_url is null;

update public.candidates c
set picture_url = 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_ba8b894e-edf4-45f3-bbcd-6aeb5e7f8db3_1786898352818.jpg'
from public.students s
where s.id = c.student_id
  and s.lrn = '999900000075'
  and c.picture_url is null;

-- ---------------------------------------------------------------------
-- 3. RPC RE-DEPLOY -- the 139/130 definition with the two null spec
--    pictures filled.  Replaces the deployed function so future
--    "Inject seed data" runs land all 46 candidates with pictures.
-- ---------------------------------------------------------------------

create or replace function public.seed_extra_parties_rpc(
  p_election_period_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_period_id uuid;
  v_actor     uuid;
  v_role      text;
  v_missing   text;
  v_conflict  text;
  v_bad       text;
  -- The 46 students this batch seats, in spec order (the script's
  -- pg_temp.seed_lrns()).
  v_lrns constant text[] := array[
    '999900000024', '999900000023', '999900000022', '999900000028', '999900000027',
    '999900000033', '999900000026', '999900000025', '999900000032', '999900000021',
    '999900000034', '999900000029', '999900000030', '999900000042', '999900000041',
    '999900000040', '999900000046', '999900000045', '999900000051', '999900000044',
    '999900000043', '999900000050', '999900000039', '999900000052', '999900000047',
    '999900000048', '999900000060', '999900000059', '999900000058', '999900000064',
    '999900000063', '999900000069', '999900000062', '999900000061', '999900000068',
    '999900000057', '999900000070', '999900000065', '999900000066', '999900000077',
    '999900000078', '999900000083', '999900000084', '999900000076', '999900000082',
    '999900000075']::text[];
  -- The 3 fixed party ids (the script's v_parties guard).
  v_parties constant uuid[] := array[
    'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid,
    'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid,
    'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid];
begin
  -- ---------------------------------------------------------------
  -- 0) GATE — only the Commissioner of Electoral Board (080 stance;
  --    the co-commissioner carries the same commissioner_role, 035).
  -- ---------------------------------------------------------------
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can inject the seed data.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can inject the seed data.';
  end if;

  -- ---------------------------------------------------------------
  -- 1) PERIOD — the parameter, else the current active period (058).
  --    Guards mirror the script's STEP 1 / do-block: unusable period
  --    -> abort before touching anything.
  -- ---------------------------------------------------------------
  v_period_id := coalesce(p_election_period_id, public.current_election_period_id());

  if v_period_id is null then
    raise exception 'No election period pasted and no active election period exists.';
  end if;

  if not exists (select 1 from public.election_periods p where p.id = v_period_id) then
    raise exception 'No election period with id %.', v_period_id
      using hint = 'Find the id with: select id, school_year, lifecycle_stage, is_active from public.election_periods order by start_at nulls last;';
  end if;

  -- ---------------------------------------------------------------
  -- 2) GUARDS — the script's do-block, verbatim messages.
  -- ---------------------------------------------------------------
  select string_agg(l.lrn, ', ' order by l.lrn) into v_missing
  from unnest(v_lrns) as l(lrn)
  where not exists (
    select 1 from public.students s where s.lrn = l.lrn
  );
  if v_missing is not null then
    raise exception 'These students do not exist: %. Run AZ/seed_students_300.sql first, then re-run this seed.', v_missing;
  end if;

  select string_agg(s.lrn, ', ' order by s.lrn) into v_conflict
  from public.students s
  join public.candidates c on c.student_id = s.id
  where s.lrn = any(v_lrns)
    and c.election_period_id = v_period_id;
  if v_conflict is not null then
    raise exception 'These students already have a candidacy in this period: %. They cannot run twice (unique student_id + election_period_id). Use a different period or remove those candidacies first.', v_conflict;
  end if;

  select string_agg(p::text, ', ') into v_conflict
  from unnest(v_parties) as p(id)
  where exists (
    select 1 from public.parties x where x.id = p
  );
  if v_conflict is not null then
    raise exception 'Party id(s) already exist: %. A previous run of this seed (or a collision) -- nothing has been written; this script rolled back.', v_conflict;
  end if;

  select string_agg(x.name, ', ') into v_conflict
  from public.parties x
  where x.election_period_id = v_period_id
    and x.name in ('Bagong Alab Alliance',
                   'Samahan ng Kabataan Tungo sa Kinabukasan',
                   'Pagbabago at Serbisyo Party');
  if v_conflict is not null then
    raise exception 'A party with this name already exists in the target period: %. Rename the parties in this script (and in the guard above) and re-run.', v_conflict;
  end if;

  -- ---------------------------------------------------------------
  -- 3) PARTIES — 3 rows (fixed ids, so re-runs fail loudly on the PK).
  --    Parties first: candidates carries the composite FK
  --    (party_id, election_period_id) -> parties(id, election_period_id)
  --    (052:272), and both sides point at the same period.
  -- ---------------------------------------------------------------
  INSERT INTO public.parties (id, name, description, president_student_id, created_at, election_period_id) VALUES
    ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'Bagong Alab Alliance', 'Full-slate test party A - 14 seats, party-president approval flow live.', null, now(), v_period_id),
    ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'Samahan ng Kabataan Tungo sa Kinabukasan', 'Full-slate test party B - 14 seats, party-president approval flow live.', null, now(), v_period_id),
    ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403', 'Pagbabago at Serbisyo Party', 'Full-slate test party C - 14 seats, party-president approval flow live.', null, now(), v_period_id);

  -- ---------------------------------------------------------------
  -- 4) CANDIDATES — 46 rows, keyed by lrn so they resolve to whatever
  --    ids the 300-student seed generated.  The spec VALUES are the
  --    script's, byte for byte.  grade_level rides along from the
  --    student row, so an office may only be paired with a student
  --    whose grade the office allows (124/125); section 5 re-checks
  --    the rule on what was just written and aborts otherwise.
  --    055's BEFORE INSERT trigger candidates_one_president_per_party
  --    fires per row; each new party gets exactly one President and
  --    the independents have party_id = null (the trigger skips
  --    those), so it passes.
  -- ---------------------------------------------------------------
  with spec (lrn, position, party_id, picture_url) as (
    values
    ('999900000024', 'President', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_04ac60cf-b8a8-4e19-ac5c-862e25ed7fcb_1786890472161.jpg'),
    ('999900000023', 'Vice President', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_090cf877-a3df-4e9e-a37a-73a78ea63a50_1786896944945.jpg'),
    ('999900000022', 'Secretary', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_0bc38684-978a-4afa-b190-5db7ccad88bb_1786898884551.jpg'),
    ('999900000028', 'Treasurer', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_141b5469-d666-46b2-ab8f-96b1109303b0_1786897965231.jpg'),
    ('999900000027', 'Auditor', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_1cbae83b-3e63-416f-9278-43759f3846d2_1786890126995.jpg'),
    ('999900000033', 'PIO', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_2409dcd1-d0a5-4eca-8fe0-e7eb7a982658_1786898316265.jpg'),
    ('999900000026', 'Protocol Officer', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_265606ae-365c-4a5f-9a3c-63b980ed4ac3_1786898165921.jpg'),
    ('999900000025', 'Grade 7 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_2aa10635-bf2b-416b-bbc5-b9158ca6a14e_1786897633306.jpg'),
    ('999900000032', 'Grade 8 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_2d3fdacb-6de6-45a0-a9fe-7f6b1dc66f43_1786897196653.jpg'),
    ('999900000021', 'Grade 9 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_3796c0d0-5a2c-4247-a06c-e114f0746343_1786897836027.jpg'),
    ('999900000034', 'Grade 10 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_388b250f-66be-410a-88a6-b6ef65de8b75_1786891842787.jpg'),
    ('999900000029', 'Grade 11 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_39447952-11af-44d6-8d4c-6b930cf5b0fa_1786898221473.jpg'),
    ('999900000030', 'Grade 12 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_3b2cd77c-c05b-4475-8d76-2b71c9ef0b7d_1786898037985.jpg'),
    ('999900000042', 'President', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_87606c2f-53ad-4195-b3e3-dfeb10b8b626_1786899001445.jpg'),
    ('999900000041', 'Vice President', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_45e6383e-d112-48ba-a03c-00e1c284e7ec_1786891280901.jpg'),
    ('999900000040', 'Secretary', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_49c5d6c8-4101-4321-b75b-d129e1f69317_1786891036718.jpg'),
    ('999900000046', 'Treasurer', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_4bdeb75f-b2cc-4b96-9f52-8542f1a70844_1786897451612.jpg'),
    ('999900000045', 'Auditor', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_5523bc93-5c8d-4ca4-9b6b-e67efa8e0a9e_1786890240394.jpg'),
    ('999900000051', 'PIO', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_5cec4032-3a28-4740-94f4-c428905c72c7_1786889870563.jpg'),
    ('999900000044', 'Protocol Officer', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_613409c5-0706-4251-9d4e-b4ee5d4e05fb_1786898256906.jpg'),
    ('999900000043', 'Grade 7 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_65d51991-35dc-46b1-9ac0-9a6ccc678d06_1786897939851.jpg'),
    ('999900000050', 'Grade 8 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_65e9a67b-fa12-4366-b688-d462d08c3090_1786897578858.jpg'),
    ('999900000039', 'Grade 9 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_65eb22c0-11c1-4576-9857-e323ab9e6651_1786897312172.jpg'),
    ('999900000052', 'Grade 10 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_69e9f468-5e7b-4e52-b54b-983f664d8a20_1786897692482.jpg'),
    ('999900000047', 'Grade 11 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_725ac484-1dee-4a7a-aac9-3c0dc15f267c_1786897094072.jpg'),
    ('999900000048', 'Grade 12 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_7862ad25-b55b-45a9-a967-815f98e41e88_1786898129641.jpg'),
    ('999900000060', 'President', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_7e94da33-6c84-4a68-8bbf-5c9eda3347a4_1786897305373.jpg'),
    ('999900000059', 'Vice President', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_86901abe-6c6f-49ff-823f-efa45dcd5c7d_1786891946514.jpg'),
    ('999900000058', 'Secretary', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_87606c2f-53ad-4195-b3e3-dfeb10b8b626_1786899001445.jpg'),
    ('999900000064', 'Treasurer', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_9299e954-6949-45ac-8b4c-e557eaff9210_1786896681441.jpg'),
    ('999900000063', 'Auditor', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_9adfa1f7-137b-4a10-80c2-14e74c7e0504_1786896807487.jpg'),
    ('999900000069', 'PIO', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_a2010b04-4c95-43d7-9a1a-4c65539cd8ad_1786890611704.jpg'),
    ('999900000062', 'Protocol Officer', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_a2815899-3e8c-41b8-bced-42b92a115deb_1786280187150.jpg'),
    ('999900000061', 'Grade 7 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_a31a668b-43cb-4673-9f68-17d65f8713f6_1783437996425.jpg'),
    ('999900000068', 'Grade 8 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_a854cef3-ebe5-4efe-8661-09be9cf16174_1786890357801.jpg'),
    ('999900000057', 'Grade 9 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_afcdf303-7c92-4d4f-bf01-a6b7a73ebb49_1786897406125.jpg'),
    ('999900000070', 'Grade 10 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_b5f5a836-572f-4e4f-af5a-b1722725b887_1786891661555.jpg'),
    ('999900000065', 'Grade 11 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_ba8b894e-edf4-45f3-bbcd-6aeb5e7f8db3_1786898352818.jpg'),
    ('999900000066', 'Grade 12 Representative', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'::uuid, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_bbc6b0d5-c70b-4fab-89bb-4d2c682741e4_1786896848079.jpg'),
    ('999900000077', 'President', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_c605f8b6-b4ea-408a-8277-6eaf7c67fd76_1786898064715.jpg'),
    ('999900000078', 'President', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_ce873408-5ab1-4343-91ee-9f79663b8d4b_1786897076780.jpg'),
    ('999900000083', 'Vice President', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_d85b434d-a56f-47c7-9b15-bcff3195e5d1_1786896429922.jpg'),
    ('999900000084', 'Vice President', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_d9c5ee18-9899-4fb4-93fc-0438f31973dd_1786897520236.jpg'),
    ('999900000076', 'Secretary', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_da4a0bc4-ffa1-4501-9e98-48c11f3b9f19_1786891166854.jpg'),
    ('999900000082', 'Treasurer', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_da661475-eb73-4368-bca4-c8853bdcae5b_1786890893415.jpg'),
    ('999900000075', 'Auditor', null, 'https://mtsavbsrdyocoquflpvl.supabase.co/storage/v1/object/public/candidate-pictures/candidate_ba8b894e-edf4-45f3-bbcd-6aeb5e7f8db3_1786898352818.jpg')
  )
  insert into public.candidates (
    student_id, election_period_id,
    surname, given_name, middle_name,
    grade_level, "position", party_id,
    gender, date_of_birth, age,
    email, mobile_number, home_address,
    home_address_province_code, home_address_city_code, home_address_barangay_code,
    picture_url, leadership_profile,
    doc_application_form, doc_introductory_profile,
    doc_eaf_front, doc_eaf_back,
    position_approval_status, status
  )
  select
    st.id,
    v_period_id,
    st.last_name, st.first_name, st.middle_name,
    st.grade_level, spec.position, spec.party_id,
    st.gender, st.birthdate,
    date_part('year', age(current_date, st.birthdate))::int,
    st.email,
    '09' || right(st.lrn, 9),
    'Purok 1 Brgy. Bagong Silang I Labo, Camarines Norte',
    '051600000', '051606000', '051606005',
    spec.picture_url,
    '{"capsuleQualities":"I believe a great leader stays honest under pressure, plans carefully and empowers others to act. I will bring organized and transparent leadership to the student government and champion programs that help students grow.","skills":["Leadership","Teamwork","Problem-Solving"],"qualities":"I believe discipline, reliability and fairness make a dependable representative. I am ready to listen to my fellow students and work with them on what matters most."}'::jsonb,
    true, true, false, false,
    case when spec.party_id is null or spec.position = 'President'
         then 'notRequired'
         else 'presidentApproved'
    end,
    'approved'
  from spec
  join public.students st on st.lrn = spec.lrn;

  -- ---------------------------------------------------------------
  -- 5) OFFICE / GRADE GATE — 124's rule re-asserted on the rows just
  --    written (the script's section 3).  Because the grade rides
  --    along from the student row, a spec lrn on the wrong grade
  --    would otherwise insert quietly.  Raising here rolls the whole
  --    transaction back, so the batch is all-or-nothing.
  -- ---------------------------------------------------------------
  select string_agg(format('%s is %s but runs for %s', s.lrn, c.grade_level, c.position),
                    '; ' order by s.lrn)
    into v_bad
  from public.candidates c
  join public.students s on s.id = c.student_id
  where c.election_period_id = v_period_id
    and s.lrn = any(v_lrns)
    and (
      (c.position in ('President', 'Vice President')
        and c.grade_level not in ('Grade 11', 'Grade 12'))
      or (c.position in ('Secretary', 'Treasurer')
        and c.grade_level <> 'Grade 10')
      or (c.position in ('Auditor', 'PIO', 'Protocol Officer')
        and c.grade_level not in ('Grade 8', 'Grade 9'))
      or (c.position like '% Representative'
        and c.grade_level <> replace(c.position, ' Representative', ''))
    );
  if v_bad is not null then
    raise exception 'Office/grade gate violated: %. Pair every office with a student whose grade the office allows (see the seed header) and re-run.', v_bad;
  end if;

  -- ---------------------------------------------------------------
  -- 6) PARTIES — point president_student_id at each new party's
  --    President (the script's section 4).
  -- ---------------------------------------------------------------
  update public.parties p
  set president_student_id = c.student_id
  from public.candidates c
  where c.party_id = p.id
    and c.election_period_id = p.election_period_id
    and c.position = 'President'
    and p.id in ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403');

  -- ---------------------------------------------------------------
  -- 7) AUDIT — one System Logs row (080 posture).
  -- ---------------------------------------------------------------
  v_actor := public.current_session_user_id();

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Seed Data Injected',
    'The extra-parties seed (3 parties, 46 candidates) was injected into the active election period. Nothing existing was changed or deleted.',
    'warning'
  );

  -- ---------------------------------------------------------------
  -- 8) VERIFY — the script's verify query, as the RPC result so the
  --    sidebar toast can show what landed.  Expect 3 new parties, 46
  --    new candidates (39 with a party, 7 independents), 5 presidents
  --    (3 party + 2 independent), and grade_gate_mismatches = 0 (the
  --    section 5 assertion already refused to commit anything else).
  -- ---------------------------------------------------------------
  return jsonb_build_object(
    'new_parties',
      (select count(*) from public.parties
        where id in ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403')),
    'new_candidates',
      (select count(*) from public.candidates
        where student_id in (select id from public.students where lrn = any(v_lrns))
          and election_period_id = v_period_id),
    'with_party',
      (select count(*) from public.candidates
        where student_id in (select id from public.students where lrn = any(v_lrns))
          and election_period_id = v_period_id
          and party_id is not null),
    'independents',
      (select count(*) from public.candidates
        where student_id in (select id from public.students where lrn = any(v_lrns))
          and election_period_id = v_period_id
          and party_id is null),
    'presidents',
      (select count(*) from public.candidates
        where student_id in (select id from public.students where lrn = any(v_lrns))
          and election_period_id = v_period_id
          and position = 'President'),
    'grade_gate_mismatches',
      (select count(*) from public.candidates c
        where c.student_id in (select id from public.students where lrn = any(v_lrns))
          and c.election_period_id = v_period_id
          and (
            (c.position in ('President', 'Vice President')
              and c.grade_level not in ('Grade 11', 'Grade 12'))
            or (c.position in ('Secretary', 'Treasurer')
              and c.grade_level <> 'Grade 10')
            or (c.position in ('Auditor', 'PIO', 'Protocol Officer')
              and c.grade_level not in ('Grade 8', 'Grade 9'))
            or (c.position like '% Representative'
              and c.grade_level <> replace(c.position, ' Representative', ''))
          )),
    'seeded_into', v_period_id
  );
end;
$$;

-- Client-executable (108/080 posture): revoke the default PUBLIC grant,
-- then grant to the two PostgREST roles.  The role gate inside the
-- function is what actually restricts who may run it.
revoke all on function public.seed_extra_parties_rpc(uuid) from public, anon, authenticated;
grant execute on function public.seed_extra_parties_rpc(uuid) to anon, authenticated;
