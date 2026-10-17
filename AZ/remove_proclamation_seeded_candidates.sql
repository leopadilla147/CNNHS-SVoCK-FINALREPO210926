-- =====================================================================
-- AZ/remove_proclamation_seeded_candidates.sql
--
-- UNDO for the proclamation that can follow AZ/seed_parties_and_candidates.sql.
--
-- Deletes, for the period the seed landed in -- public.current_election_period_id(),
-- the SAME period seed_parties_and_candidates.sql attaches its rows to -- the
-- proclamation of the 55 candidates that file inserts, then clears the period's
-- proclaimed state:
--
--   1. every public.proclamations row that names one of the 55 seeded
--      candidates, scoped to the current period.
--   2. election_periods.proclaimed = false, proclaimed_at = null -- but only
--      if the period has NO proclamation rows left afterwards.  The 55 were
--      the whole ledger; if a stranger's proclamation somehow survives, the
--      flag is deliberately kept and a notice says so.
--   3. the archived snapshot (past_election_candidates.proclaimed_winner) is
--      refreshed back to false via archive_election_results_internal -- but
--      only when a snapshot already exists, so an unarchived period does not
--      suddenly gain past_* rows.
--
-- WHY CANDIDATE IDS, NOT PARTY_IDS
--   Five of the 55 seeded candidates carry a NULL party_id (party-less
--   entries), so a party-based filter would miss them.  The ids below are
--   exactly the 55 candidate ids inserted by seed_parties_and_candidates.sql.
--
-- WHAT IS NEVER TOUCHED
--   * the candidates, parties and votes themselves -- this only un-proclaims.
--   * results_published -- un-proclaiming does NOT un-publish the tally.
--   * any other election period.
--
-- RUNS AS: the SQL editor's owner role.  RLS on proclamations is enabled but
--   never FORCED, so the owner bypasses it.  One transaction: a failure rolls
--   the whole thing back, so it is safe to fix and re-run.
-- =====================================================================

begin;

do $$
declare
  v_period uuid := public.current_election_period_id();

  -- The 55 candidates inserted by AZ/seed_parties_and_candidates.sql.
  v_my_candidates constant uuid[] := array[
    '00e928ec-4041-4e00-bfae-969531a53e6e'::uuid,
    '01061fdb-f1b4-4eb9-970a-d4b119303522'::uuid,
    '014eeede-3b99-4be0-ac72-5fbf00e7d3cf'::uuid,
    '0799e325-09ce-4d91-8152-45d9d5bfc3a5'::uuid,
    '08431a10-d14b-411d-abf1-7093579c4235'::uuid,
    '0aed7327-6ed5-4e0f-a71c-29ef597e87de'::uuid,
    '1384aced-1d7b-41ac-95fc-1ce4c95a1999'::uuid,
    '17d11ef2-b5b5-4eb9-b2af-61a94a284217'::uuid,
    '17d9869a-a842-4437-9587-e31d920ff17b'::uuid,
    '1c94f264-d49b-4ef7-aa35-899da039a894'::uuid,
    '1eea64f8-ad67-4432-9f1d-2dbf438e5077'::uuid,
    '2244ad01-7414-424a-aef5-9607a6ecf238'::uuid,
    '2513e289-ea77-4b71-a4b6-d44b28c7b45b'::uuid,
    '32e3c747-bb93-4cee-8045-94157f64fbad'::uuid,
    '33282927-7973-499a-a0b8-f9521c5646fb'::uuid,
    '33e25998-68f0-4691-be40-e1022afa977a'::uuid,
    '34555951-e703-4d06-ad0b-5a721326e600'::uuid,
    '34b42506-ef0b-4e3b-b0e6-8a1eef8aeac3'::uuid,
    '39f352c4-02af-40b3-9617-11e563eff3b5'::uuid,
    '3ae54657-0c3a-4a1b-a90d-cf9c36a8a481'::uuid,
    '3f59e38b-b095-4aaa-aeff-48f3d7ab57f0'::uuid,
    '42be6873-b289-4edc-b1f5-1c4d2e70b5e2'::uuid,
    '42c7c233-194a-44a9-ab9f-5b9d9c8f27a1'::uuid,
    '46b354c1-a376-4686-9345-fa3f89c98389'::uuid,
    '4dab9d58-416b-4997-ad64-873e11231098'::uuid,
    '528dca0a-ee35-4cdb-b231-2bb5212400cc'::uuid,
    '536100c4-30a5-4bc3-8160-676bf07fcc6a'::uuid,
    '54874826-9296-4805-bbae-4cad7882ccfc'::uuid,
    '5b679be3-f016-4cc6-9f83-fb037b4d54dc'::uuid,
    '626f9061-8430-431b-ab3d-741886a0243b'::uuid,
    '697b021d-952b-4dce-bc5c-83d5490eddb2'::uuid,
    '76eece77-d160-4722-bd33-f255be5733ad'::uuid,
    '79cd50d7-e195-4ea7-90a2-3f4224934e6f'::uuid,
    '80138714-8e5a-498c-92b3-5c0cf8c3fd81'::uuid,
    '91500ae7-ae4c-481e-ad42-53206de3d64d'::uuid,
    '95dec67e-2e07-4907-8802-68b5b338c301'::uuid,
    '9886abdc-544a-4062-a5dc-4f0152704658'::uuid,
    'b6873067-d0b8-469a-a062-c476ae77c780'::uuid,
    'b6f680d6-1621-4e8b-8e7b-c3137e25603d'::uuid,
    'ba9967bc-b68e-4023-a205-93cd18240ab6'::uuid,
    'ba9f64c7-6756-48bc-9cf3-211e5417456e'::uuid,
    'c8164da9-df80-4824-9415-77b36bf88c60'::uuid,
    'c973256b-31e6-451b-8f16-55b284de192f'::uuid,
    'd38c51fd-979c-44f2-8832-deb09db00b16'::uuid,
    'd6dddb21-2913-4232-93c7-3762fe4edc8c'::uuid,
    'd9902677-4e3e-4a7d-933f-5403108be985'::uuid,
    'dfc1cfd2-1707-4b97-9c06-a9f8662eae01'::uuid,
    'e69ad678-d93a-4c9c-b267-b3deb6a77f92'::uuid,
    'e81a31bf-aeef-4881-bfc9-6aa7ae5b7e32'::uuid,
    'ee0fb3ba-8a46-46f7-9c4c-e53f97e22171'::uuid,
    'ef1a770c-f91b-45df-be85-d36fd55d8fd6'::uuid,
    'f28e6a9c-0c82-4c03-a093-0573e446723f'::uuid,
    'f4ba4cc6-850c-4f52-9028-601fd14364f1'::uuid,
    'fbc42cbe-c6a0-48ef-bbe8-2478017c99b8'::uuid,
    'fd8ebe7e-8220-40cc-8214-41b391e9dc84'::uuid
  ];

  v_removed bigint;
  v_procl   bigint;
  v_snapshot_exists boolean;
begin
  if v_period is null then
    raise exception 'No election period in progress -- nothing to un-proclaim. Run Election Setup -> Reset Election Plan first if you expected one.';
  end if;

  -- -------------------------------------------------------------------
  -- 1) PROCLAMATIONS naming the seeded candidates, scoped to the period.
  --    (proclamations.candidate_id references candidates ON DELETE NO
  --    ACTION -- 012:15 -- so this is also what unblocks deleting the
  --    candidates later.)
  -- -------------------------------------------------------------------
  delete from public.proclamations pr
  where pr.election_period_id = v_period
    and pr.candidate_id = any (v_my_candidates);

  get diagnostics v_removed = row_count;

  -- -------------------------------------------------------------------
  -- 2) The period's proclaimed state.  Only clear it when NO proclamation
  --    is left in the period; otherwise a stranger's proclamation (the
  --    seed requires empty tables, so there should be none) would be
  --    silently left without its flag.
  -- -------------------------------------------------------------------
  select count(*) into v_procl
  from public.proclamations pr
  where pr.election_period_id = v_period;

  if v_procl = 0 then
    update public.election_periods
       set proclaimed = false,
           proclaimed_at = null
     where id = v_period;
  else
    raise notice 'Removed % seeded proclamation(s), but the period still holds % proclamation(s) that do NOT name a seeded candidate; leaving proclaimed = true.', v_removed, v_procl;
  end if;

  -- -------------------------------------------------------------------
  -- 3) Refresh the archived snapshot so past_election_candidates
  --    .proclaimed_winner goes back to false.  archive_election_results_internal
  --    derives the flag straight from the proclamations ledger (061:163-192),
  --    so a re-run after this delete clears it.  Guarded on the snapshot
  --    already existing so an unarchived period is not given past_* rows.
  --    The probe is dynamic (EXECUTE) so this script still runs on a database
  --    where 061 was never applied, matching the to_regclass pattern used by
  --    AZ/reset_election_data.sql.
  -- -------------------------------------------------------------------
  if to_regclass('public.past_election_candidates') is not null then
    execute
      'select exists (select 1 from public.past_election_candidates where election_period_id = $1)'
      into v_snapshot_exists
      using v_period;

    if v_snapshot_exists then
      perform public.archive_election_results_internal(v_period);
    end if;
  end if;

  raise notice 'Un-proclaimed % seeded candidate proclamation(s) for period %.', v_removed, v_period;
end;
$$;

commit;

-- ---------------------------------------------------------------------
-- Verify: expect seeded_proclamations_left = 0, proclaimed = false, and
-- snapshot_proclaimed_winners = 0 (the last is only meaningful when a
-- snapshot exists; it reads 0 otherwise).
-- ---------------------------------------------------------------------
select
  public.current_election_period_id() as period_id,
  (
    select count(*)
    from public.proclamations pr
    where pr.election_period_id = public.current_election_period_id()
      and pr.candidate_id = any (array[
        '00e928ec-4041-4e00-bfae-969531a53e6e'::uuid,
        '01061fdb-f1b4-4eb9-970a-d4b119303522'::uuid,
        '014eeede-3b99-4be0-ac72-5fbf00e7d3cf'::uuid,
        '0799e325-09ce-4d91-8152-45d9d5bfc3a5'::uuid,
        '08431a10-d14b-411d-abf1-7093579c4235'::uuid,
        '0aed7327-6ed5-4e0f-a71c-29ef597e87de'::uuid,
        '1384aced-1d7b-41ac-95fc-1ce4c95a1999'::uuid,
        '17d11ef2-b5b5-4eb9-b2af-61a94a284217'::uuid,
        '17d9869a-a842-4437-9587-e31d920ff17b'::uuid,
        '1c94f264-d49b-4ef7-aa35-899da039a894'::uuid,
        '1eea64f8-ad67-4432-9f1d-2dbf438e5077'::uuid,
        '2244ad01-7414-424a-aef5-9607a6ecf238'::uuid,
        '2513e289-ea77-4b71-a4b6-d44b28c7b45b'::uuid,
        '32e3c747-bb93-4cee-8045-94157f64fbad'::uuid,
        '33282927-7973-499a-a0b8-f9521c5646fb'::uuid,
        '33e25998-68f0-4691-be40-e1022afa977a'::uuid,
        '34555951-e703-4d06-ad0b-5a721326e600'::uuid,
        '34b42506-ef0b-4e3b-b0e6-8a1eef8aeac3'::uuid,
        '39f352c4-02af-40b3-9617-11e563eff3b5'::uuid,
        '3ae54657-0c3a-4a1b-a90d-cf9c36a8a481'::uuid,
        '3f59e38b-b095-4aaa-aeff-48f3d7ab57f0'::uuid,
        '42be6873-b289-4edc-b1f5-1c4d2e70b5e2'::uuid,
        '42c7c233-194a-44a9-ab9f-5b9d9c8f27a1'::uuid,
        '46b354c1-a376-4686-9345-fa3f89c98389'::uuid,
        '4dab9d58-416b-4997-ad64-873e11231098'::uuid,
        '528dca0a-ee35-4cdb-b231-2bb5212400cc'::uuid,
        '536100c4-30a5-4bc3-8160-676bf07fcc6a'::uuid,
        '54874826-9296-4805-bbae-4cad7882ccfc'::uuid,
        '5b679be3-f016-4cc6-9f83-fb037b4d54dc'::uuid,
        '626f9061-8430-431b-ab3d-741886a0243b'::uuid,
        '697b021d-952b-4dce-bc5c-83d5490eddb2'::uuid,
        '76eece77-d160-4722-bd33-f255be5733ad'::uuid,
        '79cd50d7-e195-4ea7-90a2-3f4224934e6f'::uuid,
        '80138714-8e5a-498c-92b3-5c0cf8c3fd81'::uuid,
        '91500ae7-ae4c-481e-ad42-53206de3d64d'::uuid,
        '95dec67e-2e07-4907-8802-68b5b338c301'::uuid,
        '9886abdc-544a-4062-a5dc-4f0152704658'::uuid,
        'b6873067-d0b8-469a-a062-c476ae77c780'::uuid,
        'b6f680d6-1621-4e8b-8e7b-c3137e25603d'::uuid,
        'ba9967bc-b68e-4023-a205-93cd18240ab6'::uuid,
        'ba9f64c7-6756-48bc-9cf3-211e5417456e'::uuid,
        'c8164da9-df80-4824-9415-77b36bf88c60'::uuid,
        'c973256b-31e6-451b-8f16-55b284de192f'::uuid,
        'd38c51fd-979c-44f2-8832-deb09db00b16'::uuid,
        'd6dddb21-2913-4232-93c7-3762fe4edc8c'::uuid,
        'd9902677-4e3e-4a7d-933f-5403108be985'::uuid,
        'dfc1cfd2-1707-4b97-9c06-a9f8662eae01'::uuid,
        'e69ad678-d93a-4c9c-b267-b3deb6a77f92'::uuid,
        'e81a31bf-aeef-4881-bfc9-6aa7ae5b7e32'::uuid,
        'ee0fb3ba-8a46-46f7-9c4c-e53f97e22171'::uuid,
        'ef1a770c-f91b-45df-be85-d36fd55d8fd6'::uuid,
        'f28e6a9c-0c82-4c03-a093-0573e446723f'::uuid,
        'f4ba4cc6-850c-4f52-9028-601fd14364f1'::uuid,
        'fbc42cbe-c6a0-48ef-bbe8-2478017c99b8'::uuid,
        'fd8ebe7e-8220-40cc-8214-41b391e9dc84'::uuid
      ]::uuid[])
  ) as seeded_proclamations_left,
  (
    select e.proclaimed
    from public.election_periods e
    where e.id = public.current_election_period_id()
  ) as proclaimed,
  (
    select count(*)
    from public.past_election_candidates pc
    where pc.election_period_id = public.current_election_period_id()
      and pc.proclaimed_winner
  ) as snapshot_proclaimed_winners;
