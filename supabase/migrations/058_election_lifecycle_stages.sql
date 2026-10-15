-- =====================================================================
-- 058_election_lifecycle_stages.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT — turns the Electoral Board's Election Setup tab into the
-- four-stage lifecycle described in Election-Setup-Tab-Update.md:
--
--   Stage 1  application  open/close the Candidate Application Period
--   Stage 2  campaign     schedule the Rules Discussion Meeting; this
--                         also ENDS the application period
--   Stage 3  voting       unchanged (036 already has the RPCs)
--   Stage 4  results      unchanged; the complaint gate already lives
--                         in publish_results_rpc (036:472)
--
--   + reset the whole election plan behind the Electoral Board's
--     own password.
--
-- WHY A NEW lifecycle_stage COLUMN
--   The stage was previously inferred in the UI from a pile of
--   booleans (isActive / startDate / resultsPublished / proclaimed).
--   That inference cannot express "the application period is open
--   but voting has not started", which is exactly Stage 1.  One
--   authoritative column also lets the candidacy RPCs and the reset
--   RPC reason about "which period is live" without re-deriving it.
--
-- WHY rules_discussion_at IS RE-ADDED
--   036 dropped it, which is why AdminCandidates.tsx could only ever
--   tell candidates "a date to be announced".  The original column
--   name is kept so AppContext.ElectionPeriod.rulesDiscussionAt and
--   the 'rules_discussion_meeting' notification type keep working.
--
-- NOTHING HERE DELETES ANYTHING
--   052 made deletion structurally impossible: forbid_history_deletion
--   raises on every DELETE and DELETE is revoked from the client
--   roles.  The reset therefore ARCHIVES a dirty period and inserts a
--   fresh row; a clean period is simply cleared in place.  Old
--   candidates and votes stay attached to the archived row and remain
--   invisible to the public because results_published is false there
--   (053 gates the public index on exactly that).
-- =====================================================================

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — COLUMNS
--   lifecycle_stage is added nullable, backfilled from the flags that
--   already exist, then tightened.  Doing it in that order keeps the
--   migration re-runnable against a populated table.
-- ---------------------------------------------------------------------
alter table public.election_periods
  add column if not exists rules_discussion_at timestamptz;

alter table public.election_periods
  add column if not exists lifecycle_stage text;

update public.election_periods
   set lifecycle_stage = case
         when proclaimed or results_published then 'results'
         when is_active then 'voting'
         else 'application'
       end
 where lifecycle_stage is null;

alter table public.election_periods
  alter column lifecycle_stage set default 'application',
  alter column lifecycle_stage set not null;

alter table public.election_periods
  drop constraint if exists election_periods_lifecycle_stage_check;
alter table public.election_periods
  add constraint election_periods_lifecycle_stage_check
  check (lifecycle_stage in (
    'application', 'campaign', 'voting', 'results', 'completed'
  ));

-- ---------------------------------------------------------------------
-- SECTION 2 — PERIOD RESOLVERS
--   Both read the session-independent lifecycle state only; they are
--   security definer so the RPCs below can call them without tripping
--   the election_periods RLS policies.
--
--   Ordering is by updated_at (the 001 touch_election_periods_updated_at
--   trigger bumps it on every write), so the period the Electoral Board
--   is actually working on always wins.  school_year then id make the
--   order total, which matters once a reset has left an archived row
--   behind.
-- ---------------------------------------------------------------------
create or replace function public.current_election_period_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id
    from public.election_periods e
   where e.lifecycle_stage <> 'completed'
   order by e.updated_at desc nulls last, e.school_year desc, e.id
   limit 1;
$$;

-- The period that is CURRENTLY accepting applications.  Deliberately
-- requires candidacy_open: a student who is mid-submission keeps their
-- own application usable (finalize/update are not gated), but a new
-- one can only be filed while the window is open.
create or replace function public.candidacy_election_period_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id
    from public.election_periods e
   where e.candidacy_open = true
     and e.lifecycle_stage in ('application', 'campaign')
   order by e.updated_at desc nulls last, e.school_year desc, e.id
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- SECTION 3 — STAGE 1: CANDIDATE APPLICATION PERIOD
--   start_candidacy_period_rpc is where the election_id is created,
--   per the requirement.  It reuses an existing non-completed period
--   when there is one, so pressing it twice never produces two rows.
-- ---------------------------------------------------------------------
create or replace function public.start_candidacy_period_rpc(
  p_school_year text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_name text;
  v_period_id uuid;
  v_stage text;
  v_created boolean := false;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can start the Candidate Application Period.';
  end if;

  v_actor := public.current_session_user_id();

  v_period_id := public.current_election_period_id();

  if v_period_id is null then
    v_name := nullif(btrim(coalesce(p_school_year, '')), '');
    if v_name is null then
      raise exception 'A school year is required to start a new election period (e.g. 2027-2028).';
    end if;
    if exists (select 1 from public.election_periods where school_year = v_name) then
      raise exception 'An election period already exists for school year %. Choose a different school year.', v_name;
    end if;

    insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
    values (v_name, 'application', true, v_actor)
    returning id into v_period_id;

    v_created := true;
  else
    -- Reopening candidacy on a period that has already moved on would
    -- invite applications into an election that is mid-campaign or
    -- mid-vote.  That is what Reset Election Plan is for.
    select e.lifecycle_stage into v_stage
      from public.election_periods e
     where e.id = v_period_id;

    if v_stage <> 'application' then
      raise exception 'This election is already in the % stage. Reset the election plan first to start a new Candidate Application Period.', v_stage;
    end if;

    update public.election_periods
       set candidacy_open = true
     where id = v_period_id;
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Candidate Application Period Started',
    case when v_created
      then 'Created election period ' || v_name || ' and opened candidacy.'
      else 'Reopened candidacy on the current election period.'
    end,
    'success'
  );

  return v_period_id;
end;
$$;

-- Pause without leaving Stage 1, so applications can be resumed.
create or replace function public.close_candidacy_period_rpc()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_period_id uuid;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can close the Candidate Application Period.';
  end if;

  v_period_id := public.current_election_period_id();
  if v_period_id is null then
    raise exception 'No election period is in progress.';
  end if;

  update public.election_periods
     set candidacy_open = false
   where id = v_period_id;

  return v_period_id;
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 4 — STAGE 2: CAMPAIGN PERIOD
--   One RPC for both halves of the requirement: record the meeting AND
--   end the Candidate Application Period.
-- ---------------------------------------------------------------------
create or replace function public.end_candidacy_and_schedule_meeting_rpc(
  p_election_id uuid,
  p_meeting_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_stage text;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only administrators can schedule the campaign meeting.';
  end if;

  if p_meeting_at is null then
    raise exception 'A meeting date and time is required.';
  end if;

  v_actor := public.current_session_user_id();

  select e.lifecycle_stage into v_stage
    from public.election_periods e
   where e.id = p_election_id;

  if v_stage is null then
    raise exception 'Election period not found.';
  end if;

  if v_stage not in ('application', 'campaign') then
    raise exception 'The campaign period can only be scheduled after the Candidate Application Period has started. This election is already in the % stage.', v_stage;
  end if;

  update public.election_periods
     set rules_discussion_at = p_meeting_at,
         candidacy_open = false,
         lifecycle_stage = 'campaign'
   where id = p_election_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Campaign Meeting Scheduled',
    'Rules Discussion Meeting set for ' || to_char(p_meeting_at, 'YYYY-MM-DD HH24:MI')
      || ' — the Candidate Application Period has ended.',
    'success'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 5 — STAGE 4: SURFACE THE COMPLAINT GATE
--   has_active_complaint_rpc already exists (028:177) and publish_results_rpc
--   already calls it (036:472).  What was missing was the count, for the
--   UI banner.  The RPC is read-only and mirrors 028's body exactly.
-- ---------------------------------------------------------------------
create or replace function public.count_active_complaints_rpc(
  p_election_period_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public, extensions
as $$
  select count(*)::integer
    from public.complaints
   where election_period_id = p_election_period_id
     and status = 'filed';
$$;

-- ---------------------------------------------------------------------
-- SECTION 6 — RESET THE WHOLE ELECTION PLAN
--   Password gate: the caller's OWN password, verified against
--   adminprofiles.password_hash.  The Electoral Board has no
--   auth.users row any more (035:14-16,100-102 moved staff passwords
--   into adminprofiles and 037 deleted the non-Chief identities), so
--   auth.users is the wrong table here.  The D-10 branch is copied
--   verbatim from login_staff_direct_v2 (035:408-418).
--
--   'chief' is allowed alongside 'electoral_board' so the appointing
--   officer is not locked out of a recovery action.
--
--   ADAPTIVE: a period with no candidates and no votes is cleared in
--   place (same row, same school_year).  A period that already has an
--   election footprint is archived to lifecycle_stage = 'completed'
--   and a fresh row is inserted — school_year is UNIQUE (020:404) so a
--   distinct value is required.  Neither branch deletes anything.
-- ---------------------------------------------------------------------
create or replace function public.reset_election_plan_rpc(
  p_password text,
  p_school_year text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_hash text;
  v_name text;
  v_current uuid;
  v_archived uuid;
  v_new_id uuid;
  v_school_year text;
  v_dirty boolean;
  v_had_candidates integer;
  v_had_votes integer;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can reset the election plan.';
  end if;

  if p_password is null or p_password = '' then
    raise exception 'Password is required.';
  end if;

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if v_hash is null then
    raise exception 'Password is incorrect.';
  end if;

  if starts_with(coalesce(v_hash, ''), '$2') then
    if v_hash is distinct from crypt(p_password, v_hash) then
      raise exception 'Password is incorrect.';
    end if;
  else
    if v_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      raise exception 'Password is incorrect.';
    end if;
  end if;

  v_current := public.current_election_period_id();

  if v_current is null then
    -- Nothing to reset.  Starting the application period IS the reset, but
    -- the insert is inlined rather than delegated to
    -- start_candidacy_period_rpc so this action keeps a single audit entry.
    v_school_year := nullif(btrim(coalesce(p_school_year, '')), '');
    if v_school_year is null then
      raise exception 'There is no election period in progress. Provide a school year to start one (e.g. 2027-2028).';
    end if;
    if exists (select 1 from public.election_periods where school_year = v_school_year) then
      raise exception 'An election period already exists for school year %. Choose a different school year.', v_school_year;
    end if;

    insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
    values (v_school_year, 'application', false, v_actor)
    returning id into v_new_id;

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      v_actor, 'Commissioner of Electoral Board', 'admin',
      'Election Plan Reset',
      'No election period was in progress. Started a new period for ' || v_school_year || '.',
      'warning'
    );

    return jsonb_build_object(
      'election_period_id', v_new_id,
      'archived_previous', false,
      'mode', 'started',
      'school_year', v_school_year
    );
  end if;

  select
    (select count(*) from public.candidates c where c.election_period_id = v_current),
    (select count(*) from public.votes v where v.election_period_id = v_current)
    into v_had_candidates, v_had_votes;

  v_dirty := (v_had_candidates > 0) or (v_had_votes > 0);

  if not v_dirty then
    update public.election_periods
       set candidacy_open = false,
           is_active = false,
           results_published = false,
           proclaimed = false,
           proclaimed_at = null,
           election_date = null,
           end_date = null,
           rules_discussion_at = null,
           lifecycle_stage = 'application'
     where id = v_current;

    v_new_id := v_current;
    v_school_year := (select e.school_year from public.election_periods e where e.id = v_current);
  else
    -- Archive.  Nothing is deleted: candidates and votes keep pointing
    -- at this row and stay private because results_published is false.
    update public.election_periods
       set lifecycle_stage = 'completed',
           candidacy_open = false,
           is_active = false
     where id = v_current;

    v_archived := v_current;
    v_school_year := nullif(btrim(coalesce(p_school_year, '')), '');

    if v_school_year is null then
      raise exception 'This election already has % candidate(s) and % vote(s), which are kept permanently. A new school year is required to start a fresh election period (e.g. 2027-2028).',
        v_had_candidates, v_had_votes;
    end if;

    if exists (select 1 from public.election_periods where school_year = v_school_year) then
      raise exception 'An election period already exists for school year %. Choose a different school year.', v_school_year;
    end if;

    insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
    values (v_school_year, 'application', false, v_actor)
    returning id into v_new_id;
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Plan Reset',
    case when v_dirty
      then 'Archived election period ' || v_archived::text || ' (' || v_had_candidates
           || ' candidate(s), ' || v_had_votes || ' vote(s) retained) and started a new period for '
           || v_school_year || '.'
      else 'Cleared the election plan in place for school year ' || v_school_year
           || '. No candidates or votes were present.'
    end,
    'warning'
  );

  return jsonb_build_object(
    'election_period_id', v_new_id,
    'archived_previous', v_dirty,
    'archived_election_period_id', case when v_dirty then v_archived else null end,
    'school_year', v_school_year,
    'mode', case when v_dirty then 'archived' else 'cleared' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 7 — submit_candidacy_rpc: GATE NEW APPLICATIONS
--   Reproduced from 052:476-783 VERBATIM except for the 'create' branch's
--   period resolution, which now goes through
--   candidacy_election_period_id().  Two reasons:
--
--     1. candidacy_open finally gates anything.  It was a display-only
--        flag; nothing in the database consulted it.
--     2. 052 preferred is_active = true and fell back to
--        'order by election_date desc nulls last'.  During the
--        application and campaign stages is_active is false, so that
--        fallback could resolve an ARCHIVED period once a reset has
--        left one behind.
--
--   finalize and update are deliberately NOT gated: a student who
--   already started an application must be able to finish it after the
--   window closes.
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

  -- 058: the Candidate Application Period is now a real database gate.
  -- Resolving through candidacy_election_period_id() both picks the
  -- right period and refuses outright when no window is open.
  v_election_id := public.candidacy_election_period_id();

  if v_election_id is null then
    raise exception 'The Candidate Application Period is closed. Applications are not being accepted right now.';
  end if;

  if exists (
    select 1 from public.candidates
    where student_id = v_student_id
      and election_period_id = v_election_id
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
    p_candidate_data->>'parentGuardianName',
    p_candidate_data->>'parentGuardianContact',
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

-- ---------------------------------------------------------------------
-- SECTION 8 — GRANTS
--   Grant posture copied from 044/052: the custom session spine means the
--   platform role is ALWAYS anon, so anon gets EXECUTE and the real gate is
--   the in-body session/role check.  authenticated stays revoked to keep the
--   surface unambiguous.
-- ---------------------------------------------------------------------
revoke all on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_candidacy_rpc(text, jsonb, uuid, text, text, text) to anon;

revoke all on function public.current_election_period_id() from public, anon, authenticated;
grant execute on function public.current_election_period_id() to anon, authenticated;

revoke all on function public.candidacy_election_period_id() from public, anon, authenticated;
grant execute on function public.candidacy_election_period_id() to anon, authenticated;

revoke all on function public.start_candidacy_period_rpc(text) from public, anon, authenticated;
grant execute on function public.start_candidacy_period_rpc(text) to anon, authenticated;

revoke all on function public.close_candidacy_period_rpc() from public, anon, authenticated;
grant execute on function public.close_candidacy_period_rpc() to anon, authenticated;

revoke all on function public.end_candidacy_and_schedule_meeting_rpc(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.end_candidacy_and_schedule_meeting_rpc(uuid, timestamptz) to anon, authenticated;

revoke all on function public.reset_election_plan_rpc(text, text) from public, anon, authenticated;
grant execute on function public.reset_election_plan_rpc(text, text) to anon, authenticated;

revoke all on function public.count_active_complaints_rpc(uuid) from public, anon, authenticated;
grant execute on function public.count_active_complaints_rpc(uuid) to anon, authenticated;

commit;
