-- =====================================================================
-- AZ/seed_extra_parties_and_candidates.sql
--
-- ADDITIVE companion to AZ/seed_parties_and_candidates_param.sql.
-- Inserts 3 NEW parties and 46 NEW candidates (three full 13-seat
-- slates + 7 independents) into an election period you name.  Nothing
-- is deleted, updated or reset -- it is designed to run against a
-- database that already holds parties, candidates and votes.
--
-- WHAT LANDS
--   parties     3 rows, fixed ids so a re-run fails loudly on the
--               primary key instead of quietly duplicating:
--                 Bagong Alab Alliance
--                 Samahan ng Kabataan Tungo sa Kinabukasan
--                 Pagbabago at Serbisyo Party
--   candidates  46 rows, all status = 'approved':
--                 Party A (LRN 999900000021-034)  full 13-seat slate
--                 Party B (LRN 999900000039-052)  full 13-seat slate
--                 Party C (LRN 999900000057-070)  full 13-seat slate
--                 Independents (LRN 999900000075-088):
--                   President x2, Vice President x2, Secretary,
--                   Treasurer, Auditor  (party_id = null)
--
-- THE OFFICE / GRADE RULE (migrations 124 / 125)
--   grade_level rides along from the student row, so an office may only
--   be paired with a student the office is open to:
--                 President / Vice President        Grade 11-12
--                 Secretary / Treasurer             Grade 10
--                 Auditor / PIO / Protocol Officer  Grade 8-9
--                 Grade N Representative            Grade N  (001:283)
--   Grade 7 holds no executive office at all.  Each party below is one
--   14-LRN block of AZ/seed_students_300.sql whose grades cover a whole
--   slate, and every office inside it is filled from a grade the office
--   allows -- so the seeded roster is exactly what the Apply page could
--   now produce.  Section 3 re-asserts the rule after the INSERT.
--
--   (This batch used to sit on LRNs 9999000002xx.  The grade cycle in
--   AZ/seed_students_300.sql cannot supply two party slates' worth of
--   Grade 10 -- the G8/9 and G10 offices alone need 5 + 3 students per
--   slate -- so the slates moved to the 0xx blocks, where each 14-LRN
--   block holds the full mix.  The old lrns are still claimed by the
--   matching cleanup file so a database seeded by the old revision can
--   be undone with it.)
--
-- WHERE THE STUDENTS COME FROM
--   Every candidate is one of the 300 synthetic students created by
--   AZ/seed_students_300.sql.  That seed leaves students.id to the
--   table default, so a hard-coded student_id is impossible here --
--   each candidate is keyed by lrn and the INSERT ... SELECT resolves
--   id, names, gender, birthdate, grade_level and email straight from
--   public.students.  Age is computed from birthdate, mobile_number is
--   derived from the lrn, home_address is a fixed placeholder.
--
--   Grade Representatives are matched to the student's real grade
--   (candidates_grade_position_match, 001:283) -- the grade cycles with
--   the lrn, and the block a party uses contains every grade, so all six
--   Rep seats are fillable from the block itself.
--
-- PICTURES
--   The 46 picture_url values are reused from
--   AZ/seed_parties_and_candidates.sql (candidate-pictures/ bucket),
--   one per candidate in row order.
--
-- STATUSES (mirrors the original dump so the approval workflows stay
-- testable)
--   Party Presidents and the 7 independents : status 'approved',
--     position_approval_status 'notRequired'
--   Other 36 party members                 : status 'approved',
--     position_approval_status 'presidentApprovalRequired'
--     (so the party-president decision flow in 054 has rows to act on)
--   2 of the 4 doc_* flags (application form + introductory profile)
--     are set true, matching the original dump; the EAF photos are not.
--
-- WHY THE GUARDS DO NOT DELETE ANYTHING
--   Plain INSERTs plus loud guards, the same contract as the _param
--   file: the script aborts before touching anything if the pasted
--   period is unusable, if any of the 46 students is missing or
--   already a candidate in that period, or if a party id/name is
--   already taken -- and it refuses to commit if the written rows break
--   the office/grade rule (section 3).  One transaction, so a failure
--   rolls the whole thing back and it is safe to fix and re-run.
--
-- CONSTRAINTS RESPECTED (all verified against the migrations)
--   candidates unique (student_id, election_period_id)   001:268
--   one President candidacy per party                    055 trigger
--     (guard_party_president_seat skips party_id IS NULL,
--      so independent Presidents are fine)
--   grade_level must match '% Representative' seats      001:283
--   executive offices gated per grade (section 3)        124 / 125
--     -- the table itself carries no CHECK for these; 124
--     gates submit_candidacy_rpc instead, so the seed
--     asserts the same rule itself
--   composite FK (party_id, election_period_id)
--     -> parties(id, election_period_id)                 052:272
--   parties unique (name, election_period_id)            052:262
--   multiple candidates per (party, position) are legal  055:50
--     dropped the old unique -- that is what lets 2
--     independents share President etc.
--   the 054 partial unique indexes only cover
--     position_approval_status = 'presidentApproved' and
--     status = 'approved' + position = 'President' per
--     party -- one row each here, so they pass.
--
-- RUNS AS: the SQL editor's owner role.  RLS is enabled on these
-- tables but never FORCED, so the admin-only insert policies do not
-- apply and the inserts succeed.
--
-- ORDER: parties first -- candidates carries the composite FK above,
--   and both sides point at the same period, so the pair matches.
-- =====================================================================

-- #####################################################################
-- #  STEP 1 -- EDIT THIS LINE: paste your election period id below.    #
-- #####################################################################
select set_config('svock.seed_election_period_id', 'PASTE-ELECTION-PERIOD-ID-HERE', false);

-- #####################################################################
-- #  STEP 2 -- run the whole script.  Nothing else needs editing.      #
-- #####################################################################

-- Single source of truth for election_period_id in this file.  Reads the
-- value pasted above, so all 3 party rows and all 46 candidate rows get
-- the exact same period.
create or replace function pg_temp.seed_election_period_id()
returns uuid
language sql
stable
as $$
  select nullif(btrim(current_setting('svock.seed_election_period_id', true)), '')::uuid
$$;

-- The 46 students this batch seats, in spec order.  Declared once so the
-- guard and the verify query cannot drift apart from the spec below.
-- These are NOT the old 9999000002xx lrns: see "WHAT LANDS" above.
create or replace function pg_temp.seed_lrns()
returns text[]
language sql
stable
as $$
  select array['999900000024', '999900000023', '999900000022', '999900000028', '999900000027', '999900000033', '999900000026', '999900000025', '999900000032', '999900000021', '999900000034', '999900000029', '999900000030', '999900000042', '999900000041', '999900000040', '999900000046', '999900000045', '999900000051', '999900000044', '999900000043', '999900000050', '999900000039', '999900000052', '999900000047', '999900000048', '999900000060', '999900000059', '999900000058', '999900000064', '999900000063', '999900000069', '999900000062', '999900000061', '999900000068', '999900000057', '999900000070', '999900000065', '999900000066', '999900000077', '999900000078', '999900000083', '999900000084', '999900000076', '999900000082', '999900000075']::text[]
$$;

begin;

-- Abort before touching anything if the pasted period is not usable,
-- if the 300-student seed has not been run, if any chosen student is
-- already a candidate in this period, or if a party id/name is taken.
do $$
declare
  v_raw  text := nullif(btrim(current_setting('svock.seed_election_period_id', true)), '');
  v_uuid uuid;
  v_missing text;
  v_conflict text;
  v_hint constant text :=
    'Edit the set_config call at the top of this script: put your election period id between the quotes, replacing PASTE-ELECTION-PERIOD-ID-HERE.';
  v_lrns constant text[] := pg_temp.seed_lrns();
  v_parties constant text[] := array['b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'];
begin
  if v_raw is null or v_raw = 'PASTE-ELECTION-PERIOD-ID-HERE' then
    raise exception 'No election_period_id pasted (the placeholder is still in place).'
      using hint = v_hint;
  end if;

  begin
    v_uuid := v_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'election_period_id "%" is not a valid uuid.', v_raw
      using hint = v_hint;
  end;

  if not exists (select 1 from public.election_periods p where p.id = v_uuid) then
    raise exception 'No election period with id %.', v_uuid
      using hint = 'Find the id with: select id, school_year, lifecycle_stage, is_active from public.election_periods order by start_at nulls last;';
  end if;

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
    and c.election_period_id = v_uuid;
  if v_conflict is not null then
    raise exception 'These students already have a candidacy in this period: %. They cannot run twice (unique student_id + election_period_id). Use a different period or remove those candidacies first.', v_conflict;
  end if;

  select string_agg(p.id::text, ', ') into v_conflict
  from unnest(v_parties) as p(id)
  where exists (
    select 1 from public.parties x where x.id = p.id::uuid
  );
  if v_conflict is not null then
    raise exception 'Party id(s) already exist: %. A previous run of this seed (or a collision) -- nothing has been written; this script rolled back.', v_conflict;
  end if;

  select string_agg(x.name, ', ') into v_conflict
  from public.parties x
  where x.election_period_id = v_uuid
    and x.name in ('Bagong Alab Alliance',
                   'Samahan ng Kabataan Tungo sa Kinabukasan',
                   'Pagbabago at Serbisyo Party');
  if v_conflict is not null then
    raise exception 'A party with this name already exists in the target period: %. Rename the parties in this script (and in the guard above) and re-run.', v_conflict;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1) PARTIES -- 3 rows (fixed ids, so re-runs fail loudly on the PK)
-- ---------------------------------------------------------------------
INSERT INTO public.parties (id, name, description, president_student_id, created_at, election_period_id) VALUES
  ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'Bagong Alab Alliance', 'Full-slate test party A - 14 seats, party-president approval flow live.', null, now(), pg_temp.seed_election_period_id()),
  ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'Samahan ng Kabataan Tungo sa Kinabukasan', 'Full-slate test party B - 14 seats, party-president approval flow live.', null, now(), pg_temp.seed_election_period_id()),
  ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403', 'Pagbabago at Serbisyo Party', 'Full-slate test party C - 14 seats, party-president approval flow live.', null, now(), pg_temp.seed_election_period_id());

-- ---------------------------------------------------------------------
-- 2) CANDIDATES -- 46 rows, keyed by lrn so they resolve to whatever
--    ids AZ/seed_students_300.sql generated.  Inserted after parties
--    because of the composite FK (party_id, election_period_id).
--    055's BEFORE INSERT trigger candidates_one_president_per_party
--    fires per row; each new party gets exactly one President and the
--    independents have party_id = null (the trigger skips those), so
--    it passes.
--
--    grade_level is taken from the STUDENT row (st.grade_level), so an
--    office may only be paired with a student whose grade the office
--    allows -- the rule migration 124 enforces on the Apply page and
--    migration 125 aligned existing rows to:
--      President / Vice President        Grade 11-12
--      Secretary / Treasurer             Grade 10
--      Auditor / PIO / Protocol Officer  Grade 8-9
--      Grade N Representative            Grade N   (001:283)
--    Each party is one 14-LRN block of AZ/seed_students_300.sql whose
--    grades cover a whole slate, and every office inside the block is
--    filled from the grade that office allows.  Section 3 re-checks the
--    rule on what was just written and aborts the transaction otherwise.
--
--    parties.president_student_id is then pointed at each new party's
--    President candidate, matching how the original seed set it up.
-- ---------------------------------------------------------------------
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
  pg_temp.seed_election_period_id(),
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

-- ---------------------------------------------------------------------
-- 3) OFFICE / GRADE GATE -- migration 124's rule re-asserted on the rows
--    just written.  Because the grade rides along from the student row,
--    a spec lrn that sits on the wrong grade would otherwise insert
--    quietly (a Grade 9 President).  Raising here rolls the whole
--    transaction back, so the batch is all-or-nothing.
-- ---------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s is %s but runs for %s', s.lrn, c.grade_level, c.position),
                    '; ' order by s.lrn)
    into v_bad
  from public.candidates c
  join public.students s on s.id = c.student_id
  where c.election_period_id = pg_temp.seed_election_period_id()
    and s.lrn = any(pg_temp.seed_lrns())
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
    raise exception 'Office/grade gate violated: %. Pair every office with a student whose grade the office allows (see the header) and re-run.', v_bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) PARTIES -- point president_student_id at each new party's President.
-- ---------------------------------------------------------------------
update public.parties p
set president_student_id = c.student_id
from public.candidates c
where c.party_id = p.id
  and c.election_period_id = p.election_period_id
  and c.position = 'President'
  and p.id in ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403');

commit;

-- ---------------------------------------------------------------------
-- Verify: expect 3 new parties, 46 new candidates (39 with a party,
-- 7 independents), 5 presidents (3 party + 2 independent), and
-- grade_gate_mismatches = 0 (the section 3 assertion already refused to
-- commit anything else).
-- ---------------------------------------------------------------------
select
  (select count(*) from public.parties
    where id in ('b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d401', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d402', 'b1a0f8e2-3c47-4d9a-9e21-7f0a61c3d403'))            as new_parties,
  (select count(*) from public.candidates
    where student_id in (select id from public.students where lrn = any(pg_temp.seed_lrns()))) as new_candidates,
  (select count(*) from public.candidates
    where student_id in (select id from public.students where lrn = any(pg_temp.seed_lrns()))
      and party_id is not null)                                                          as with_party,
  (select count(*) from public.candidates
    where student_id in (select id from public.students where lrn = any(pg_temp.seed_lrns()))
      and party_id is null)                                                              as independents,
  (select count(*) from public.candidates
    where student_id in (select id from public.students where lrn = any(pg_temp.seed_lrns()))
      and position = 'President')                                                        as presidents,
  (select count(*) from public.candidates c
    where c.student_id in (select id from public.students where lrn = any(pg_temp.seed_lrns()))
      and (
        (c.position in ('President', 'Vice President')
          and c.grade_level not in ('Grade 11', 'Grade 12'))
        or (c.position in ('Secretary', 'Treasurer')
          and c.grade_level <> 'Grade 10')
        or (c.position in ('Auditor', 'PIO', 'Protocol Officer')
          and c.grade_level not in ('Grade 8', 'Grade 9'))
        or (c.position like '% Representative'
          and c.grade_level <> replace(c.position, ' Representative', ''))
      ))                                                                                as grade_gate_mismatches,
  public.current_election_period_id()                                                    as current_period,
  pg_temp.seed_election_period_id()                                                      as seeded_into;
