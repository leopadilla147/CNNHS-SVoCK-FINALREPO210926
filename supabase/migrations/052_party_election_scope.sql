-- =====================================================================
-- 052_party_election_scope.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   1. A party belongs to exactly ONE election period.  A party name is
--      unique per period instead of globally, so the same slate can be
--      fielded again next election under its own row.
--   2. Backfill: a legacy global party used by candidates in more than
--      one election period is CLONED once per period, and candidates are
--      remapped to the clone of their own period.
--   3. public.party_members is REMOVED.  candidates.party_id is the only
--      statement about who runs under which party in which election, and
--      party membership requests live on the candidate row itself (see
--      054_party_president_approval.sql).  The table, its policies and
--      its two RPCs go away with it.
--   4. Composite integrity: candidates.party_id must point at a party of
--      the SAME election period.
--   5. Permanent retention: historical ON DELETE CASCADE relationships
--      to students / election periods become RESTRICT, DELETE is revoked
--      from the client roles, election_periods reject deletes outright,
--      and a student is rejected only once they hold candidacy or vote
--      records — so records are archived by lifecycle state, never
--      removed and never rolled over into a new period.
--   6. submit_candidacy_rpc is re-grounded on the session spine, scoped
--      to an election period, and no longer trusts the client to declare
--      the party-approval gate.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — ADD THE SCOPING COLUMN (nullable until backfilled)
-- ---------------------------------------------------------------------
alter table public.parties
  add column if not exists election_period_id uuid;

create index if not exists idx_parties_election_period
  on public.parties (election_period_id);

-- The backfill has to remember which clone came from which legacy row across
-- several statements.  A TEMP table is not safe here: some SQL runners commit
-- between statements (which fires ON COMMIT DROP) or open a new session per
-- batch, and the mapping would vanish mid-script.  This scratch table is
-- therefore a real table, emptied on entry, dropped at the end of the
-- backfill, and locked down with RLS (no policies = no client access).
create table if not exists public.party_election_scope_map (
  source_party_id uuid not null,
  election_period_id uuid not null,
  party_id uuid not null,
  primary key (source_party_id, election_period_id)
);
truncate table public.party_election_scope_map;
alter table public.party_election_scope_map enable row level security;

-- The legacy global name constraint must go BEFORE the clone backfill, or a
-- party used in two election periods cannot be cloned (the clone carries the
-- same name).  Uniqueness is re-established per period in Section 4.
alter table public.parties drop constraint if exists parties_name_key;

-- ---------------------------------------------------------------------
-- SECTION 2 — BACKFILL PARTY SCOPE
--   The party keeps its own row for the period it already owns (or for
--   the period with the most candidates), and is cloned for every other
--   period it appears in.  party_election_scope_map records the mapping.
-- ---------------------------------------------------------------------
do $$
declare
  v_src record;
  v_target record;
  v_new_id uuid;
  v_primary uuid;
  v_latest uuid;
  v_name text;
  v_candidate_count integer;
begin
  for v_src in
    select p.id
    from public.parties p
    where p.election_period_id is null
      and exists (select 1 from public.candidates c where c.party_id = p.id)
  loop
    select name, election_period_id into v_name, v_primary
    from public.parties where id = v_src.id;

    if v_primary is null then
      select c.election_period_id into v_primary
      from public.candidates c
      where c.party_id = v_src.id
      group by c.election_period_id
      order by count(*) desc,
               (select e.election_date from public.election_periods e where e.id = c.election_period_id) asc nulls last,
               (select e.school_year from public.election_periods e where e.id = c.election_period_id) asc,
               c.election_period_id
      limit 1;
    end if;

    if v_primary is null then
      raise exception 'Party % is referenced by a candidacy without an election period.', v_src.id;
    end if;

    update public.parties set election_period_id = v_primary where id = v_src.id;

    for v_target in
      select c.election_period_id
      from public.candidates c
      where c.party_id = v_src.id
      group by c.election_period_id
    loop
      if v_target.election_period_id = v_primary then
        v_new_id := v_src.id;
      else
        select p2.id into v_new_id
        from public.parties p2
        where p2.name = v_name
          and p2.election_period_id = v_target.election_period_id
        limit 1;

        if v_new_id is null then
          insert into public.parties (name, description, president_student_id, created_at, election_period_id)
          select name, description, president_student_id, created_at, v_target.election_period_id
          from public.parties
          where id = v_src.id
          returning id into v_new_id;
        end if;
      end if;

      insert into public.party_election_scope_map (source_party_id, election_period_id, party_id)
      values (v_src.id, v_target.election_period_id, v_new_id)
      on conflict do nothing;
    end loop;
  end loop;

  for v_src in
    select p.id from public.parties p where p.election_period_id is null
  loop
    select count(*) into v_candidate_count
    from public.candidates c where c.party_id = v_src.id;

    if v_candidate_count = 0 then
      delete from public.parties where id = v_src.id;
      continue;
    end if;

    select e.id into v_latest
    from public.election_periods e
    order by e.election_date desc nulls last, e.school_year desc, e.id
    limit 1;

    if v_latest is null then
      raise exception 'Party % is still referenced but no election period exists to scope it to.', v_src.id;
    end if;

    update public.parties set election_period_id = v_latest where id = v_src.id;

    insert into public.party_election_scope_map (source_party_id, election_period_id, party_id)
    values (v_src.id, v_latest, v_src.id)
    on conflict do nothing;

    raise notice 'Party % had no candidacy link; scoped to election period %.', v_src.id, v_latest;
  end loop;
end;
$$;

update public.candidates c
set party_id = m.party_id
from public.party_election_scope_map m
where c.party_id = m.source_party_id
  and c.election_period_id = m.election_period_id;

-- ---------------------------------------------------------------------
-- SECTION 2b — REPAIR PASS (makes a re-run self-healing)
--   Section 2's loop only considers parties whose election_period_id is
--   still null.  If an EARLIER attempt at this migration died part way
--   through, its source party may already carry a period while the
--   candidates of every OTHER period still point at that one row.  A re-run
--   would skip exactly those rows (the party is no longer null), the remap
--   above would find nothing to do, and the composite foreign key in
--   Section 4 would then abort the whole migration.  This pass works from
--   the candidate side instead, so it repairs a partially applied backfill
--   wherever the previous run happened to stop.  On a clean database, and
--   on a re-run after success, it matches no rows and does nothing.
-- ---------------------------------------------------------------------
do $$
declare
  v_row record;
  v_new_id uuid;
begin
  for v_row in
    select c.id as candidate_id, c.election_period_id, c.party_id, p.name
    from public.candidates c
    join public.parties p on p.id = c.party_id
    where c.election_period_id is not null
      and c.election_period_id is distinct from p.election_period_id
  loop
    select id into v_new_id
    from public.parties
    where name = v_row.name
      and election_period_id = v_row.election_period_id
    limit 1;

    if v_new_id is null then
      insert into public.parties (name, description, president_student_id, created_at, election_period_id)
      select name, description, president_student_id, created_at, v_row.election_period_id
      from public.parties
      where id = v_row.party_id
      returning id into v_new_id;
    end if;

    update public.candidates
    set party_id = v_new_id
    where id = v_row.candidate_id;
  end loop;
end;
$$;

-- parties.president_student_id is display-only (the approved President
-- CANDIDACY is what authorizes anything), but a clone must show the student
-- who actually ran as President in ITS OWN period rather than a copy of the
-- source row's value.
update public.parties p
set president_student_id = c.student_id
from public.candidates c
where c.party_id = p.id
  and c.election_period_id = p.election_period_id
  and c.position = 'President'
  and c.status = 'approved'
  and p.president_student_id is distinct from c.student_id;

drop table if exists public.party_election_scope_map;

-- ---------------------------------------------------------------------
-- SECTION 3 — REMOVE THE MEMBERSHIP TABLE
--   party membership is no longer a separate record: a candidate row with
--   a party_id IS the membership, and its request/approval state lives in
--   position_approval_status.  The RPCs go before the table so nothing is
--   left pointing at a relation that no longer exists.
--   Signatures must match 011_notifications_and_party_members.sql exactly
--   or the drop silently no-ops.
-- ---------------------------------------------------------------------
drop function if exists public.request_party_membership_rpc(uuid, uuid);
drop function if exists public.review_party_membership_rpc(uuid, text, uuid);
drop table if exists public.party_members;
drop table if exists public.party_members_scoped;

-- ---------------------------------------------------------------------
-- SECTION 4 — CONSTRAINTS
-- ---------------------------------------------------------------------
alter table public.parties
  alter column election_period_id set not null;

alter table public.parties drop constraint if exists parties_name_key;
alter table public.parties drop constraint if exists parties_election_period_id_fkey;

alter table public.parties
  add constraint parties_election_period_id_fkey
  foreign key (election_period_id)
  references public.election_periods(id)
  on delete restrict;

create unique index if not exists parties_election_period_name_key
  on public.parties (election_period_id, name);

-- Referenced by the composite candidate FK below.
create unique index if not exists parties_id_election_period_key
  on public.parties (id, election_period_id);

alter table public.candidates drop constraint if exists candidates_party_id_fkey;
alter table public.candidates drop constraint if exists candidates_party_election_fkey;

alter table public.candidates
  add constraint candidates_party_election_fkey
  foreign key (party_id, election_period_id)
  references public.parties(id, election_period_id)
  on delete restrict;

-- ---------------------------------------------------------------------
-- SECTION 5 — PERMANENT RETENTION
--   Historical rows are kept forever: the cascade paths that used to wipe
--   a student (or a whole election period) and everything hanging off it
--   now refuse the delete, and clients lose the DELETE privilege.
-- ---------------------------------------------------------------------
-- Every historical link becomes ON DELETE RESTRICT.  The links are driven
-- from a data list and checked against information_schema first, so a table
-- that is no longer part of the system (nominations was removed) is skipped
-- with a notice instead of aborting the whole migration.
do $$
declare
  r record;
  v_fkey text;
begin
  for r in
    select *
    from (values
      ('candidates',    'student_id',         'students'),
      ('candidates',    'election_period_id', 'election_periods'),
      ('votes',         'voter_id',           'students'),
      ('votes',         'election_period_id', 'election_periods'),
      ('nominations',   'nominee_student_id', 'students'),
      ('nominations',   'election_period_id', 'election_periods'),
      ('proclamations', 'election_period_id', 'election_periods'),
      ('proclamations', 'candidate_id',       'candidates'),
      ('complaints',    'election_period_id', 'election_periods')
    ) as link(tbl, col, target)
  loop
    if to_regclass(format('public.%I', r.tbl)) is null
       or to_regclass(format('public.%I', r.target)) is null
       or not exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = r.tbl
           and c.column_name = r.col
       )
    then
      raise notice 'retention: skipping %.% - not present in this schema', r.tbl, r.col;
      continue;
    end if;

    v_fkey := r.tbl || '_' || r.col || '_fkey';
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, v_fkey);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete restrict',
      r.tbl, v_fkey, r.col, r.target
    );
  end loop;
end;
$$;

do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
  from public.votes v
  where v.candidate_id is not null
    and not exists (select 1 from public.candidates c where c.id = v.candidate_id);

  if v_orphans = 0 then
    alter table public.votes drop constraint if exists votes_candidate_id_fkey;
    alter table public.votes
      add constraint votes_candidate_id_fkey
      foreign key (candidate_id) references public.candidates(id) on delete restrict;
  else
    raise warning 'votes_candidate_id_fkey not restored: % votes point at missing candidates.', v_orphans;
  end if;
end;
$$;

create or replace function public.forbid_history_deletion()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  raise exception 'Permanent retention: % rows are kept permanently and cannot be deleted.', tg_table_name;
end;
$$;

-- A student may still be removed from the roster while they have no election
-- footprint at all (transfer, withdrawal before registering).  Anyone who has
-- candidated or voted is part of the permanent record, and the RESTRICT
-- foreign keys already refuse those deletes; this trigger makes the refusal
-- explicit instead of surfacing as a bare constraint violation.
create or replace function public.forbid_student_deletion_with_history()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if exists (select 1 from public.candidates c where c.student_id = old.id)
     or exists (select 1 from public.votes v where v.voter_id = old.id) then
    raise exception 'Permanent retention: student % has election records and cannot be deleted.', old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists students_no_delete on public.students;
drop trigger if exists students_no_delete_with_history on public.students;
create trigger students_no_delete_with_history
  before delete on public.students
  for each row execute function public.forbid_student_deletion_with_history();

drop trigger if exists election_periods_no_delete on public.election_periods;
create trigger election_periods_no_delete
  before delete on public.election_periods
  for each row execute function public.forbid_history_deletion();

-- Same tolerance as above: the client loses DELETE on every relation that is
-- actually present, and a removed table is not an error.
do $$
declare
  v_relation text;
begin
  foreach v_relation in array array[
    'students', 'student_masterlist', 'election_periods', 'parties',
    'candidates', 'votes', 'nominations', 'proclamations',
    'complaints'
  ] loop
    if to_regclass(format('public.%I', v_relation)) is not null then
      execute format('revoke delete on table public.%I from anon, authenticated', v_relation);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 6 — RLS
--   parties: readable only for the live or already-published elections.
--   is_party_president() authorizes off the APPROVED PRESIDENT CANDIDACY,
--   not off parties.president_student_id: the column is display data that
--   the backfill above and 054 keep in sync, while the candidacy is the
--   record that actually proves who presides.
-- ---------------------------------------------------------------------
create or replace function public.is_party_president(p_party_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.candidates c
    where c.party_id = p_party_id
      and c.position = 'President'
      and c.status = 'approved'
      and c.student_id = public.current_session_user_id()
  );
$$;

revoke all on function public.is_party_president(uuid) from public;
grant execute on function public.is_party_president(uuid) to anon, authenticated;

drop policy if exists "parties readable" on public.parties;
drop policy if exists "parties authenticated insert" on public.parties;
drop policy if exists "parties scoped readable" on public.parties;
drop policy if exists "parties admin insert" on public.parties;
drop policy if exists "parties admin update" on public.parties;

create policy "parties scoped readable"
  on public.parties
  for select
  using (
    public.current_app_role() = 'admin'
    or exists (
      select 1
      from public.election_periods e
      where e.id = parties.election_period_id
        and (e.is_active or e.results_published)
    )
  );

create policy "parties admin insert"
  on public.parties
  for insert
  with check (public.current_app_role() = 'admin');

create policy "parties admin update"
  on public.parties
  for update
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ---------------------------------------------------------------------
-- SECTION 7 — CANDIDACY RPC (period-scoped party upsert)
--   The party-approval gate is DERIVED here and never read from the
--   payload.  A party candidate in a non-President position needs their
--   party President's approval; the President approves themselves, and so
--   do Independents.  054 enforces the consequence of that value.
-- ---------------------------------------------------------------------
drop function if exists public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text);

create or replace function public.submit_candidacy_rpc(
  p_action text,
  p_candidate_data jsonb default null,
  p_candidate_id uuid default null,
  p_picture_url text default null,
  p_eaf_front_url text default null,
  p_eaf_back_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_student_id uuid;
  v_actor_id uuid;
  v_election_id uuid;
  v_party_id uuid;
  v_new_id uuid;
  v_result jsonb;
  v_existing record;
  v_student record;
begin
  v_actor_id := public.current_session_user_id();
  if v_actor_id is null then
    raise exception 'Authentication required — candidacy actions must come from a signed-in user.';
  end if;
  if public.current_app_role() != 'student' then
    raise exception 'Only students can manage candidacy applications.';
  end if;
  v_student_id := v_actor_id;

  if p_action = 'finalize' then
    if p_candidate_id is null then
      raise exception 'Candidate ID is required for finalization.';
    end if;

    select * into v_existing
    from public.candidates
    where id = p_candidate_id;

    if not found then
      raise exception 'Candidate not found.';
    end if;

    if v_existing.student_id is distinct from v_student_id then
      raise exception 'You can only manage your own candidacy application.';
    end if;

    if v_existing.doc_eaf_front = false or v_existing.doc_eaf_back = false then
      raise exception 'EAF front and back photos must be uploaded before final submission.';
    end if;

    -- Another candidate already holds this position in this party.  Re-applying
    -- is only possible through reapply_party_candidacy_rpc (054), which
    -- re-checks that the slot is genuinely free.
    if v_existing.position_approval_status = 'presidentRejected' then
      raise exception 'Another candidate was approved for that position in your party. You can only re-apply if the position opens up again.';
    end if;

    update public.candidates
    set status = 'pending',
        doc_introductory_profile = true,
        doc_screening_form = true,
        doc_report_card = true,
        doc_good_moral_cert = true,
        -- Stamp the gate on first submission only.  A row that already carries
        -- 'presidentApproved' keeps it, so re-finalizing cannot undo a
        -- decision the President already made.
        position_approval_status = case
          when party_id is not null
               and position <> 'President'
               and position_approval_status = 'notRequired'
            then 'presidentApprovalRequired'
          else position_approval_status
        end
    where id = p_candidate_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (null, coalesce(v_existing.given_name, 'Student'), 'student',
            'Candidacy Application',
            'Submitted completed EAF — Pending officer review', 'info');

    select row_to_json(c)::jsonb into v_result
    from public.candidates c where id = p_candidate_id;
    return v_result;
  end if;

  if p_action = 'update' then
    if p_candidate_id is null then
      raise exception 'Candidate ID is required for update.';
    end if;

    select * into v_existing
    from public.candidates
    where id = p_candidate_id;

    if not found then
      raise exception 'Candidate not found.';
    end if;

    if v_existing.student_id is distinct from v_student_id then
      raise exception 'You can only manage your own candidacy application.';
    end if;

    update public.candidates
    set picture_url = coalesce(p_picture_url, picture_url),
        eaf_front_url = coalesce(p_eaf_front_url, eaf_front_url),
        eaf_back_url = coalesce(p_eaf_back_url, eaf_back_url),
        doc_eaf_front = case when p_eaf_front_url is not null then true else doc_eaf_front end,
        doc_eaf_back = case when p_eaf_back_url is not null then true else doc_eaf_back end
    where id = p_candidate_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (null, coalesce(v_existing.given_name, 'Student'), 'student',
            'EAF Uploaded', 'Uploaded EAF images for candidacy', 'info');

    select row_to_json(c)::jsonb into v_result
    from public.candidates c where id = p_candidate_id;
    return v_result;
  end if;

  if p_action != 'create' then
    raise exception 'Action must be create, update, or finalize.';
  end if;

  if p_candidate_data is null then
    raise exception 'Candidate data is required for creation.';
  end if;

  if exists (
    select 1 from public.candidates
    where student_id = v_student_id
      and election_period_id = (
        select id from public.election_periods
        where is_active = true
        order by election_date desc nulls last, school_year desc, id
        limit 1
      )
      and rejection_tier = 'high'
  ) then
    raise exception 'You are disqualified from running in this election period due to: high-tier rejection. Please contact the Commissioner of Grievance.';
  end if;

  if nullif(p_candidate_data->>'surname', '') is null then
    raise exception 'Surname is required.';
  end if;
  if nullif(p_candidate_data->>'givenName', '') is null then
    raise exception 'Given name is required.';
  end if;
  if nullif(p_candidate_data->>'gradeLevel', '') is null then
    raise exception 'Grade level is required.';
  end if;
  if nullif(p_candidate_data->>'position', '') is null then
    raise exception 'Position is required.';
  end if;
  if nullif(p_candidate_data->>'gender', '') is null then
    raise exception 'Gender is required.';
  end if;
  if nullif(p_candidate_data->>'email', '') is null then
    raise exception 'Email is required.';
  end if;
  if nullif(p_candidate_data->>'mobileNumber', '') is null then
    raise exception 'Mobile number is required.';
  end if;
  if nullif(p_candidate_data->>'homeAddress', '') is null then
    raise exception 'Home address is required.';
  end if;
  if (p_candidate_data->>'age')::int is null or (p_candidate_data->>'age')::int < 10 then
    raise exception 'Valid age is required.';
  end if;
  if nullif(p_candidate_data->>'status', '') is null
     or p_candidate_data->>'status' not in ('ongoingSubmission', 'pending') then
    raise exception 'Invalid status.';
  end if;

  if (p_candidate_data->>'position') like '%Representative'
     and (p_candidate_data->>'position') <> ((p_candidate_data->>'gradeLevel') || ' Representative') then
    raise exception 'Grade-level mismatch: % students can only apply for % Representative.', p_candidate_data->>'gradeLevel', p_candidate_data->>'gradeLevel';
  end if;

  v_new_id := gen_random_uuid();

  select id into v_election_id
  from public.election_periods
  where is_active = true
  order by election_date desc nulls last, school_year desc, id
  limit 1;

  if v_election_id is null then
    select id into v_election_id
    from public.election_periods
    order by election_date desc nulls last, school_year desc, id
    limit 1;
  end if;

  if v_election_id is null then
    raise exception 'No election period configured. Ask an administrator to set one up.';
  end if;

  -- The "register a new party" path: a President applicant creates the row
  -- for this period, anyone joining an existing slate reuses it.  Only a
  -- President may bring a new party into being; a non-President naming a
  -- party that does not exist yet would field a slate nobody presides over.
  if nullif(p_candidate_data->>'partyAffiliation', '') is not null then
    v_party_id := null;

    select id into v_party_id
    from public.parties
    where election_period_id = v_election_id
      and name = p_candidate_data->>'partyAffiliation'
    limit 1;

    if v_party_id is null then
      if p_candidate_data->>'position' <> 'President' then
        raise exception 'You can only create a new party by running for President. Join an existing party instead.';
      end if;

      -- Two Presidents can pick the same name at once; the loser adopts the
      -- winner's row rather than failing the whole application.
      begin
        insert into public.parties (name, election_period_id)
        values (p_candidate_data->>'partyAffiliation', v_election_id)
        returning id into v_party_id;
      exception when unique_violation then
        select id into v_party_id
        from public.parties
        where election_period_id = v_election_id
          and name = p_candidate_data->>'partyAffiliation'
        limit 1;
      end;
    else
      -- Joining an existing slate is only legitimate once that slate has an
      -- APPROVED PRESIDENT.  The Apply page already hides such parties from
      -- the picker, but the picker is a convenience, not a rule: without this
      -- check a crafted request could seat somebody under a party that nobody
      -- presides over, and 054's approval board has no President to drive it.
      -- A President applicant is exempt — running for President is how a slate
      -- gets one in the first place.
      if p_candidate_data->>'position' <> 'President'
         and not exists (
           select 1
           from public.candidates c
           where c.party_id = v_party_id
             and c.position = 'President'
             and c.status = 'approved'
         )
      then
        raise exception 'You can only join a party that already has an approved President.';
      end if;
    end if;

    -- president_student_id is deliberately NOT set here.  It mirrors the
    -- screening-approved President (see the backfill in Section 2 and
    -- 054), so claiming it at application time would publish a president
    -- the Screening Office has not accepted.
  end if;

  select first_name, last_name into v_student
  from public.students where id = v_student_id;

  insert into public.candidates (
    id, student_id, election_period_id, surname, given_name, middle_name,
    extension_name, grade_level, position, party_id, gender, date_of_birth,
    age, email, mobile_number, landline, home_address, parent_guardian_name,
    parent_guardian_contact, picture_url, doc_application_form,
    doc_introductory_profile, doc_screening_form, doc_report_card,
    doc_good_moral_cert, doc_eaf_front, doc_eaf_back,
    position_approval_status, leadership_profile, status, submitted_at
  ) values (
    v_new_id, v_student_id, v_election_id,
    p_candidate_data->>'surname', p_candidate_data->>'givenName',
    nullif(p_candidate_data->>'middleName', ''),
    nullif(p_candidate_data->>'extensionName', ''),
    p_candidate_data->>'gradeLevel', p_candidate_data->>'position',
    v_party_id, p_candidate_data->>'gender',
    (p_candidate_data->>'dateOfBirth')::date, (p_candidate_data->>'age')::int,
    p_candidate_data->>'email', p_candidate_data->>'mobileNumber',
    nullif(p_candidate_data->>'landline', ''),
    p_candidate_data->>'homeAddress',
    nullif(p_candidate_data->>'parentGuardianName', ''),
    nullif(p_candidate_data->>'parentGuardianContact', ''),
    p_picture_url, true, false, false, false, false, false, false,
    -- Derived, never taken from p_candidate_data.
    case
      when v_party_id is not null and p_candidate_data->>'position' <> 'President'
        then 'presidentApprovalRequired'
      else 'notRequired'
    end,
    (p_candidate_data->>'leadershipProfile')::jsonb,
    p_candidate_data->>'status', now()
  );

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    null,
    coalesce(v_student.first_name || ' ' || v_student.last_name, p_candidate_data->>'givenName'),
    'student',
    'EAF Generated',
    'Generated EAF for ' || (p_candidate_data->>'position') || ' — Ongoing Submission',
    'info'
  );

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where id = v_new_id;
  return v_result;
end;
$$;

-- Grant posture preserved verbatim from 044: the custom session spine means
-- the platform role is ALWAYS anon, so anon gets EXECUTE and the real gate is
-- the in-body session/role check.  authenticated stays revoked to keep the
-- surface unambiguous.
revoke all on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) to anon;
