-- =====================================================================
-- AZ/repoint_parties_and_candidates.sql
--
-- WHAT IT DOES
--   Moves the 6 parties and 55 candidates seeded by
--   AZ/seed_parties_and_candidates.sql out of whatever election period
--   they sit in NOW and into the election period you paste below.  It is
--   an UPDATE of election_period_id only: nothing is inserted, nothing is
--   deleted, and ids / student_ids / party_ids / positions / statuses /
--   timestamps are untouched, so the slate you already built keeps
--   working exactly as it did -- no re-seeding needed.
--
-- HOW TO USE (three steps, all at the top of this file)
--   1. STEP 1 -- paste the NEW election period id.
--   2. STEP 2 -- (optional) say where the rows are being read FROM:
--        ''    (empty, the default) match the slate seeded by
--              AZ/seed_parties_and_candidates.sql by id -- the 6 party
--              ids and 55 candidate ids listed in this file.  Works no
--              matter which period those rows currently live in.
--        '<old period uuid>' move EVERY party/candidate that currently
--              sits in that period.
--   3. Run the whole file in the Supabase SQL editor.
--   List periods with:
--     select id, school_year, lifecycle_stage, is_active, start_at, end_at
--     from public.election_periods order by start_at nulls last;
--
-- WHY THE MOVE IS A SINGLE STATEMENT
--   candidates carries a composite, NOT DEFERRABLE foreign key from
--   migration 052:
--     candidates (party_id, election_period_id)
--       -> parties (id, election_period_id)
--   Two separate UPDATEs would therefore fail: once the first one has
--   moved the parties, every candidate still points at the old
--   (party_id, period) pair and Postgres refuses the statement.  Such a
--   foreign key is checked at the END OF THE STATEMENT, so the move below
--   re-points both tables inside one statement (a data-modifying CTE for
--   the parties) and the check only ever sees a consistent state.
--
--   Nothing else in the schema reacts to an election_period_id write:
--     * 055:82 candidates_one_president_per_party fires only "before
--       insert or update of party_id, position" -- not this column.
--     * 001:474 audit_candidate_status, 054:185 candidates_require_party_
--       approval, 054:232 candidates_sync_party_president and 057:84
--       ..._before_submit all key off a status change, and status does
--       not change here -- so no audit rows and no approval gates trip.
--
--   FALLBACK (the CTE is expected to pass; if Postgres ever disagrees it
--   aborts and rolls back, losing nothing): make the key deferrable for
--   the transaction instead, all inside one txn:
--     alter table public.candidates drop constraint candidates_party_election_fkey;
--     ... run the two updates, one per table ...
--     alter table public.candidates
--       add constraint candidates_party_election_fkey
--       foreign key (party_id, election_period_id)
--       references public.parties(id, election_period_id) on delete restrict;
--
-- SAFETY -- the guard raises before a single row is written
--   * STEP 1 filled in, a valid uuid, and the period exists
--   * STEP 2 (if given) a valid uuid, an existing period, and not the
--     same period as STEP 1
--   * no party name already used in the target period
--     (unique index parties_election_period_name_key)
--   * no student already holding a candidacy in the target period
--     (unique (student_id, election_period_id))
--   * every candidate being moved has its party moving alongside it
--     (otherwise the composite FK would abort anyway, with a raw error)
--   * the period(s) being emptied hold no votes, vote_receipts or
--     proclamations -- those rows keep their own election_period_id, so
--     moving the candidates out would leave history pointing at a period
--     that no longer contains them.  STEP 3 = 'yes' accepts that.
--
-- TRANSACTION / RE-RUN
--   One transaction: any failure rolls everything back.  The list of rows
--   to move is captured in the session temp table svock_repoint_targets
--   (ON COMMIT DROP), so re-running is safe -- a second run either moves
--   0 rows or stops in the guard.
--   RUNS AS: the SQL editor's owner role.  RLS is enabled on these tables
--   but never FORCED, so owner writes are accepted.
--
-- FOOTNOTE -- the old period may already be history
--   If the old period was retired through Election Setup -> Reset
--   Election Plan with a new school year (migration 066), it is
--   lifecycle_stage = 'completed' and its result was frozen into
--   past_election_periods / past_election_candidates /
--   past_election_positions.  This script does not touch those snapshot
--   tables: after the move the old period simply holds 0 live candidates
--   and the snapshot keeps recording what it held.  Delete the past_* rows
--   for that period yourself if you want that history gone too.
--
--   The move is also written to audit_logs as actor_role = 'system'.
-- =====================================================================

-- #####################################################################
-- #  STEP 1 -- EDIT THIS LINE: paste the NEW election period id.       #
-- #####################################################################
select set_config('svock.repoint_new_period_id', 'PASTE-NEW-ELECTION-PERIOD-ID-HERE', false);

-- #####################################################################
-- #  STEP 2 -- OPTIONAL: where the rows come from.                     #
-- #          Leave '' (empty) for the slate in seed_parties_and_       #
-- #          candidates.sql, or paste the OLD period uuid to move      #
-- #          every party/candidate currently in that period.           #
-- #####################################################################
select set_config('svock.repoint_source_period_id', '', false);

-- #####################################################################
-- #  STEP 3 -- proceed when the period being emptied already has votes,#
-- #            receipts or proclamations?  'no' aborts (recommended),  #
-- #            'yes' moves the slate anyway and leaves that history.   #
-- #####################################################################
select set_config('svock.repoint_allow_voted_period', 'no', false);

-- ---------------------------------------------------------------------
-- Helpers.  Every period reference below goes through these, so the
-- values pasted in STEP 1-3 are the only inputs to the script.
-- ---------------------------------------------------------------------
create or replace function pg_temp.repoint_raw(p_setting text)
returns text
language sql
stable
as $$
  select nullif(btrim(current_setting(p_setting, true)), '')
$$;

create or replace function pg_temp.repoint_new_period_id()
returns uuid
language sql
stable
as $$
  select pg_temp.repoint_raw('svock.repoint_new_period_id')::uuid
$$;

create or replace function pg_temp.repoint_source_period_id()
returns uuid
language sql
stable
as $$
  select pg_temp.repoint_raw('svock.repoint_source_period_id')::uuid
$$;

create or replace function pg_temp.repoint_allow_voted()
returns boolean
language sql
stable
as $$
  select coalesce(pg_temp.repoint_raw('svock.repoint_allow_voted_period'), 'no')
         in ('yes', 'y', 'true', 'on', '1')
$$;

create or replace function pg_temp.repoint_party_ids()
returns uuid[]
language sql
stable
as $$
  select case
    when pg_temp.repoint_source_period_id() is not null then
      coalesce((
        select array_agg(p.id order by p.id)
        from public.parties p
        where p.election_period_id = pg_temp.repoint_source_period_id()
      ), '{}'::uuid[])
    else
      array[
        '8a513434-048e-4235-85a4-a259389df184'::uuid,
        'a7621ec7-a3fe-4a01-99cc-e19ae3113a2d'::uuid,
        'af6859f7-6035-4f4d-be77-ec13a18aa07b'::uuid,
        'c1286650-6274-4afa-a599-9eda53ce1f20'::uuid,
        'cf93039f-3a77-4710-a60e-cbf33ed97cff'::uuid,
        'e6b25626-b06b-462c-bfbf-0bc4287058d6'::uuid
      ]
  end
$$;

create or replace function pg_temp.repoint_candidate_ids()
returns uuid[]
language sql
stable
as $$
  select case
    when pg_temp.repoint_source_period_id() is not null then
      coalesce((
        select array_agg(c.id order by c.id)
        from public.candidates c
        where c.election_period_id = pg_temp.repoint_source_period_id()
      ), '{}'::uuid[])
    else
      array[
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
      ]
  end
$$;

begin;

-- ---------------------------------------------------------------------
-- GUARD A -- the pasted values themselves (format + existence).  Runs
-- before anything is captured so a typo produces this message rather
-- than a bare "invalid input syntax for type uuid".
-- ---------------------------------------------------------------------
do $$
declare
  v_new_raw text := pg_temp.repoint_raw('svock.repoint_new_period_id');
  v_src_raw text := pg_temp.repoint_raw('svock.repoint_source_period_id');
  v_new     uuid;
  v_src     uuid;
begin
  -- STEP 1
  if v_new_raw is null or v_new_raw = 'PASTE-NEW-ELECTION-PERIOD-ID-HERE' then
    raise exception 'STEP 1: no election period id pasted (the placeholder is still in place).'
      using hint = 'Put your NEW election period id between the quotes in STEP 1 at the top of this script.';
  end if;
  begin
    v_new := v_new_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'STEP 1 "%" is not a valid uuid.', v_new_raw
      using hint = 'List the periods: select id, school_year, lifecycle_stage from public.election_periods order by start_at nulls last;';
  end;
  if not exists (select 1 from public.election_periods e where e.id = v_new) then
    raise exception 'STEP 1: no row in public.election_periods has id %.', v_new
      using hint = 'Create the period first (Election Setup -> Reset Election Plan), then paste its id in STEP 1.';
  end if;

  -- STEP 2 (optional)
  if v_src_raw is not null then
    begin
      v_src := v_src_raw::uuid;
    exception when invalid_text_representation then
      raise exception 'STEP 2 "%" is not a valid uuid.', v_src_raw
        using hint = 'Leave STEP 2 empty (two quotes) to move the slate from seed_parties_and_candidates.sql, or paste the OLD period id.';
    end;
    if not exists (select 1 from public.election_periods e where e.id = v_src) then
      raise exception 'STEP 2: no row in public.election_periods has id %.', v_src
        using hint = 'List them with: select id, school_year, lifecycle_stage from public.election_periods order by start_at nulls last;';
    end if;
    if v_src = v_new then
      raise exception 'STEP 2 is the same period as STEP 1 (%). Nothing to move.', v_new
        using hint = 'STEP 1 is where the rows should END UP; STEP 2 is where they are RIGHT NOW.';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Capture the rows to move.  Only rows that actually exist are captured,
-- each with the period it is leaving, so the guard, the audit row and the
-- verify query all see the same list.  ON COMMIT DROP cleans it up.
-- ---------------------------------------------------------------------
create temporary table svock_repoint_targets (kind text, id uuid, from_period uuid)
  on commit drop;

insert into svock_repoint_targets (kind, id, from_period)
  select 'party', p.id, p.election_period_id
    from public.parties p
   where p.id = any (pg_temp.repoint_party_ids())
union all
  select 'candidate', c.id, c.election_period_id
    from public.candidates c
   where c.id = any (pg_temp.repoint_candidate_ids());

-- ---------------------------------------------------------------------
-- GUARD B -- the checks that need the captured rows.
-- ---------------------------------------------------------------------
do $$
declare
  v_new       uuid   := pg_temp.repoint_new_period_id();
  v_src       uuid   := pg_temp.repoint_source_period_id();
  v_np        bigint := 0;
  v_nc        bigint := 0;
  v_from      uuid[];
  v_names     text;
  v_students  text;
  v_orphans   text;
  v_votes     bigint := 0;
  v_receipts  bigint := 0;
  v_procl     bigint := 0;
  v_school    text   := null;
begin
  select count(*) filter (where kind = 'party'),
         count(*) filter (where kind = 'candidate')
    into v_np, v_nc
    from svock_repoint_targets;

  if v_np = 0 and v_nc = 0 then
    raise notice 'NOTHING TO MOVE: no matching parties or candidates were found (STEP 2 = %). 0 rows will be written.',
      coalesce(v_src::text, 'the ids of the slate in seed_parties_and_candidates.sql');
    return;
  end if;

  select e.school_year into v_school
    from public.election_periods e
   where e.id = v_new;

  -- 1) party names already used in the target period
  select string_agg(format('%s (%s)', p.name, p.id), ', ' order by p.name)
    into v_names
    from public.parties p
   where p.id in (select id from svock_repoint_targets where kind = 'party')
     and exists (
           select 1 from public.parties q
            where q.election_period_id = v_new
              and q.id <> p.id
              and q.name = p.name
         );
  if v_names is not null then
    raise exception 'These party names are already used in the target period (%): %.', v_new, v_names
      using hint = 'Delete or rename those rows in the target period first, then re-run this script.';
  end if;

  -- 2) students already holding a candidacy in the target period
  select string_agg(format('%s %s (student %s)', c.surname, c.given_name, c.student_id), ', ' order by c.surname)
    into v_students
    from public.candidates c
   where c.id in (select id from svock_repoint_targets where kind = 'candidate')
     and exists (
           select 1 from public.candidates d
            where d.election_period_id = v_new
              and d.student_id = c.student_id
              and d.id <> c.id
         );
  if v_students is not null then
    raise exception 'These students already have a candidacy in the target period (%): %.', v_new, v_students
      using hint = 'Unique (student_id, election_period_id) forbids a second candidacy for the same student in one period.';
  end if;

  -- 3) every candidate travels with its party (the composite FK needs both)
  select string_agg(format('%s %s -> party %s', c.surname, c.given_name, c.party_id), ', ' order by c.surname)
    into v_orphans
    from public.candidates c
   where c.id in (select id from svock_repoint_targets where kind = 'candidate')
     and c.party_id is not null
     and not exists (
           select 1 from svock_repoint_targets t
            where t.kind = 'party'
              and t.id = c.party_id
         );
  if v_orphans is not null then
    raise exception 'These candidates would move without their party: %.', v_orphans
      using hint = 'Set STEP 2 to the period the whole slate sits in, so parties and candidates are captured together.';
  end if;

  -- 4) the period(s) being emptied must not already hold election history
  select array_agg(distinct t.from_period) into v_from
    from svock_repoint_targets t;

  if v_from is not null then
    select count(*) into v_votes   from public.votes v         where v.election_period_id         = any (v_from);
    select count(*) into v_procl   from public.proclamations pr where pr.election_period_id       = any (v_from);
    if to_regclass('public.vote_receipts') is not null then
      execute 'select count(*) from public.vote_receipts where election_period_id = any ($1)'
        into v_receipts using v_from;
    end if;
  end if;

  if (v_votes + v_receipts + v_procl) > 0 and not pg_temp.repoint_allow_voted() then
    raise exception
      'The period(s) these rows are leaving already hold % vote(s), % receipt(s) and % proclamation(s), which would stay behind.',
      v_votes, v_receipts, v_procl
      using hint = 'Set STEP 3 to ''yes'' at the top of this script to accept that and move the slate anyway, or reset the election first.';
  end if;

  -- informational only
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public'
                and c.table_name = 'election_periods'
                and c.column_name = 'lifecycle_stage')
     and exists (select 1 from public.election_periods e
                  where e.id = v_new
                    and e.lifecycle_stage = 'completed') then
    raise notice 'TARGET PERIOD % is lifecycle_stage = completed, so its result may already be frozen in Past Elections. Moving the slate into it anyway.', v_new;
  end if;

  raise notice 'MOVING % part(y/ies) and % candidate(s) -> election period % (%) from period(s) %.',
    v_np, v_nc, v_new, coalesce(v_school, 'unknown school year'),
    coalesce(v_from::text, 'n/a');
end;
$$;

-- ---------------------------------------------------------------------
-- THE MOVE -- one statement, so the NOT DEFERRABLE composite foreign key
--   candidates (party_id, election_period_id) -> parties (id, election_period_id)
-- is checked only at the end of the statement, by which time both tables
-- already point at the new period.  The parties CTE is unreferenced on
-- purpose: data-modifying CTEs always execute.
-- ---------------------------------------------------------------------
with moved_parties as (
  update public.parties p
     set election_period_id = pg_temp.repoint_new_period_id()
   where p.id in (select t.id from svock_repoint_targets t where t.kind = 'party')
  returning p.id
)
update public.candidates c
   set election_period_id = pg_temp.repoint_new_period_id()
 where c.id in (select t.id from svock_repoint_targets t where t.kind = 'candidate');

-- ---------------------------------------------------------------------
-- Audit trail -- actor_role = 'system' satisfies the 027 check and the
-- 038 insert policy; only rows that actually changed are reported.
-- ---------------------------------------------------------------------
insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
select
  null,
  'AZ/repoint_parties_and_candidates.sql',
  'system',
  'Election Period Repointed',
  format('Moved %s of %s selected row(s) to election period %s%s.',
    (select count(*) from svock_repoint_targets t
      where t.from_period is distinct from pg_temp.repoint_new_period_id()),
    (select count(*) from svock_repoint_targets t),
    pg_temp.repoint_new_period_id(),
    case when pg_temp.repoint_source_period_id() is not null
         then ' (source period ' || pg_temp.repoint_source_period_id()::text || ')'
         else ' (slate seeded by AZ/seed_parties_and_candidates.sql)'
    end),
  'warning'
where exists (select 1 from svock_repoint_targets t);

-- ---------------------------------------------------------------------
-- VERIFY -- still inside the transaction.  A clean first run reports:
--   parties_selected = 6, candidates_selected = 55,
--   parties_now_in_target = 6, candidates_now_in_target = 55,
--   rows_moved = 61, and seeded_into equal to the id pasted in STEP 1.
--   A second run reports rows_moved = 0.
-- ---------------------------------------------------------------------
select
  (select count(*) from svock_repoint_targets where kind = 'party')                       as parties_selected,
  (select count(*) from svock_repoint_targets where kind = 'candidate')                   as candidates_selected,
  (select count(*)
     from svock_repoint_targets t
     join public.parties p on p.id = t.id
    where t.kind = 'party'
      and p.election_period_id = pg_temp.repoint_new_period_id())                         as parties_now_in_target,
  (select count(*)
     from svock_repoint_targets t
     join public.candidates c on c.id = t.id
    where t.kind = 'candidate'
      and c.election_period_id = pg_temp.repoint_new_period_id())                         as candidates_now_in_target,
  (select count(*) from svock_repoint_targets t
    where t.from_period is distinct from pg_temp.repoint_new_period_id())                  as rows_moved,
  (select count(*) from public.parties p
    where p.election_period_id = pg_temp.repoint_new_period_id())                         as parties_in_target_period,
  (select count(*) from public.candidates c
    where c.election_period_id = pg_temp.repoint_new_period_id())                         as candidates_in_target_period,
  pg_temp.repoint_new_period_id()                                                         as seeded_into,
  (select e.school_year from public.election_periods e
    where e.id = pg_temp.repoint_new_period_id())                                         as school_year;

commit;
