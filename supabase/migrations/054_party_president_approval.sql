-- =====================================================================
-- 054_party_president_approval.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
-- Apply AFTER 052_party_election_scope.sql.
--
-- WHAT
--   1. A join request is not a separate record.  It lives on the candidate
--      row in position_approval_status, which gains a 'presidentRejected'
--      outcome so a declined applicant can re-apply if the slot reopens.
--   2. Only the screening-APPROVED President of that party, in that same
--      election period, may approve or reject a request.  No admin
--      fallback: presiding over a slate is the President's own duty.
--   3. Exactly one candidate per position per party is ever approved.
--      Approving promotes the winner and, in the same transaction, pushes
--      every other request for that position to 'presidentRejected'.
--   4. Screening cannot advance a party candidate to approved/rejected
--      until the President has approved them.  A BEFORE UPDATE trigger
--      enforces it, which also closes the direct PATCH /rest/v1/candidates
--      path that the "candidates owner admin update" policy allows.
--      The President is exempt: they are approved by the Screening Office.
--   5. parties.president_student_id mirrors the approved President and is
--      kept in sync by a trigger.  It is display data — is_party_president()
--      authorizes off the candidacy, never off the column.
--   6. One ADDITIVE read policy lets a President load their own party's
--      rows.  Policies are OR'd, so this can only grant access, never
--      withhold it.  Unapproved candidates are NOT hidden from admins at
--      the database layer; the Screening list filters them in the UI and
--      the trigger in (4) is what actually blocks the action.
--   7. Existing pending party candidates in the live period are moved onto
--      the new gate, but only where an approved President already exists —
--      so the migration never manufactures an un-actionable request.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — VOCABULARY: a fourth outcome, plus the decision record
-- ---------------------------------------------------------------------
-- The original check at 001_initial_schema.sql:261 is an unnamed inline
-- column check, so its real name has to be discovered rather than guessed.
do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'candidates'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%position_approval_status%'
  order by con.conname
  limit 1;

  if v_name is not null then
    execute format('alter table public.candidates drop constraint %I', v_name);
    raise notice 'Dropped candidates check constraint %.', v_name;
  end if;
end;
$$;

alter table public.candidates
  drop constraint if exists candidates_position_approval_status_check;

alter table public.candidates
  add constraint candidates_position_approval_status_check
  check (position_approval_status in (
    'notRequired', 'presidentApprovalRequired', 'presidentApproved', 'presidentRejected'
  ));

alter table public.candidates
  add column if not exists party_decided_by uuid references public.students(id) on delete restrict;

alter table public.candidates
  add column if not exists party_decided_at timestamptz;

-- One approved candidate per party per position.  Enforced by the index
-- rather than only by the RPC's exists() check, so two Presidents acting at
-- the same instant cannot both win the same slot.
do $$
declare
  v_dupes record;
begin
  select c.party_id, c.election_period_id, c.position, count(*) as n
  into v_dupes
  from public.candidates c
  where c.party_id is not null
    and c.position_approval_status = 'presidentApproved'
  group by c.party_id, c.election_period_id, c.position
  having count(*) > 1
  limit 1;

  if found then
    raise exception
      'Cannot enforce one approved candidate per party position: party % already has % approved candidates for % in period %.',
      v_dupes.party_id, v_dupes.n, v_dupes.position, v_dupes.election_period_id;
  end if;
end;
$$;

create unique index if not exists candidates_one_approved_per_party_position
  on public.candidates (election_period_id, party_id, position)
  where party_id is not null
    and position_approval_status = 'presidentApproved';

-- A party is presided over by exactly ONE approved President, and the index
-- above cannot enforce that on its own: a President is approved by the
-- Screening Office, so their row never passes through 'presidentApproved'.
-- Left alone, several approved Presidents could share a party, and both
-- is_party_president() and the display column would then have to guess which
-- of them actually presides.
do $$
declare
  v_dupes record;
begin
  select c.party_id, c.election_period_id, count(*) as n
  into v_dupes
  from public.candidates c
  where c.party_id is not null
    and c.position = 'President'
    and c.status = 'approved'
  group by c.party_id, c.election_period_id
  having count(*) > 1
  limit 1;

  if found then
    raise exception
      'Cannot enforce one approved President per party: party % already has % approved President candidacies in period %.',
      v_dupes.party_id, v_dupes.n, v_dupes.election_period_id;
  end if;
end;
$$;

create unique index if not exists candidates_one_approved_president_per_party
  on public.candidates (election_period_id, party_id)
  where party_id is not null
    and position = 'President'
    and status = 'approved';

-- ---------------------------------------------------------------------
-- SECTION 2 — THE PRESIDENT CAN READ THEIR OWN PARTY
--   001 lets a student read only approved rows plus their own, so without
--   this the President could never load the slate they are meant to
--   preside over.  is_party_president() is SECURITY DEFINER, which is what
--   keeps this policy from recursing into itself.
-- ---------------------------------------------------------------------
drop policy if exists "candidates party president session select" on public.candidates;

create policy "candidates party president session select"
  on public.candidates
  for select
  using (
    public.current_app_role() = 'student'
    and public.is_party_president(candidates.party_id)
  );

-- ---------------------------------------------------------------------
-- SECTION 3 — SCREENING GATE
--   Fires only when status is actually advancing to a decision, so
--   finalize (status -> 'pending') is untouched, and a President updating
--   only the gate column is untouched.  The President is exempt because
--   they cannot approve themselves.
-- ---------------------------------------------------------------------
create or replace function public.guard_party_approval_before_screening()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected')
     and new.party_id is not null
     and new.position <> 'President'
     and new.position_approval_status <> 'presidentApproved' then
    raise exception 'This candidate is still waiting for the approval of their party President.';
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_require_party_approval on public.candidates;

create trigger candidates_require_party_approval
  before update on public.candidates
  for each row execute function public.guard_party_approval_before_screening();

-- Keep the display column honest whenever screening rules on a President.
create or replace function public.sync_party_president_on_screening()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.party_id is not null and new.position = 'President' then
    if new.status = 'approved' and old.status is distinct from 'approved' then
      update public.parties
      set president_student_id = new.student_id
      where id = new.party_id
        and election_period_id = new.election_period_id;

      -- The slate only becomes real now that its President has cleared
      -- Screening, so everybody else already waiting in this party has to land
      -- on the gate in the same breath.  Section 6's backfill only sees
      -- parties that were ALREADY approved when it ran; without this, a party
      -- approved later would hold candidates sitting at 'notRequired' that the
      -- Section 3 guard can never rule on, leaving the Screening Office stuck
      -- on an error the student cannot act on.
      update public.candidates
      set position_approval_status = 'presidentApprovalRequired'
      where party_id = new.party_id
        and election_period_id = new.election_period_id
        and position <> 'President'
        and status = 'pending'
        and position_approval_status = 'notRequired';
    elsif old.status = 'approved' and new.status is distinct from 'approved' then
      update public.parties
      set president_student_id = null
      where id = new.party_id
        and election_period_id = new.election_period_id
        and president_student_id = new.student_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_sync_party_president on public.candidates;

create trigger candidates_sync_party_president
  after update on public.candidates
  for each row execute function public.sync_party_president_on_screening();

-- ---------------------------------------------------------------------
-- SECTION 4 — THE PRESIDENT'S DECISION
-- ---------------------------------------------------------------------
create or replace function public.review_party_candidacy_rpc(
  p_candidate_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
  v_candidate record;
  v_president_id uuid;
  v_president record;
  v_affected record;
  v_result jsonb;
begin
  v_actor_id := public.current_session_user_id();
  if v_actor_id is null then
    raise exception 'Authentication required — party decisions must come from a signed-in student.';
  end if;
  if public.current_app_role() <> 'student' then
    raise exception 'Only a party President can decide candidacy requests.';
  end if;
  if p_action not in ('approve', 'reject') then
    raise exception 'Action must be approve or reject.';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found.';
  end if;
  if v_candidate.party_id is null then
    raise exception 'Independent candidates do not need party approval.';
  end if;
  if v_candidate.position = 'President' then
    raise exception 'A party President is approved by the Screening Office, not by the party.';
  end if;
  if v_candidate.status not in ('ongoingSubmission', 'pending') then
    raise exception 'That candidacy is no longer open for a party decision.';
  end if;
  if v_candidate.position_approval_status <> 'presidentApprovalRequired' then
    raise exception 'That request has already been decided.';
  end if;

  -- The whole authorization surface: the caller must be the student on the
  -- APPROVED President candidacy of this exact party and period.
  select c.student_id into v_president_id
  from public.candidates c
  where c.party_id = v_candidate.party_id
    and c.election_period_id = v_candidate.election_period_id
    and c.position = 'President'
    and c.status = 'approved'
  limit 1;

  if v_president_id is distinct from v_actor_id then
    raise exception 'Only the approved President of that party can decide this request.';
  end if;

  select first_name, last_name into v_president
  from public.students where id = v_actor_id;

  if p_action = 'reject' then
    update public.candidates
    set position_approval_status = 'presidentRejected',
        party_decided_by = v_actor_id,
        party_decided_at = now()
    where id = p_candidate_id;

    perform public.insert_notification_rpc(
      v_candidate.student_id, 'student', 'party_membership_rejected',
      'Party candidacy declined',
      'The President of your party declined your application for ' || v_candidate.position
        || '. You can re-apply if the position opens up again.',
      null
    );

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      null,
      coalesce(v_president.first_name || ' ' || v_president.last_name, 'Party President'),
      'student',
      'Party Candidacy Declined',
      'Declined ' || v_candidate.given_name || ' for ' || v_candidate.position,
      'info'
    );
  else
    if exists (
      select 1
      from public.candidates c
      where c.party_id = v_candidate.party_id
        and c.election_period_id = v_candidate.election_period_id
        and c.position = v_candidate.position
        and c.id <> p_candidate_id
        and c.position_approval_status = 'presidentApproved'
    ) then
      raise exception 'Position % in this party already has an approved candidate.',
        v_candidate.position;
    end if;

    update public.candidates
    set position_approval_status = 'presidentApproved',
        party_decided_by = v_actor_id,
        party_decided_at = now()
    where id = p_candidate_id;

    -- Everyone else who wanted this seat is out, and told so.
    for v_affected in
      select c.id, c.student_id, c.given_name
      from public.candidates c
      where c.party_id = v_candidate.party_id
        and c.election_period_id = v_candidate.election_period_id
        and c.position = v_candidate.position
        and c.id <> p_candidate_id
        and c.position_approval_status = 'presidentApprovalRequired'
    loop
      update public.candidates
      set position_approval_status = 'presidentRejected',
          party_decided_by = v_actor_id,
          party_decided_at = now()
      where id = v_affected.id;

      perform public.insert_notification_rpc(
        v_affected.student_id, 'student', 'party_membership_rejected',
        'Party candidacy declined',
        'Another candidate was approved for ' || v_candidate.position
          || ' in your party. You can re-apply if the position opens up again.',
        null
      );
    end loop;

    perform public.insert_notification_rpc(
      v_candidate.student_id, 'student', 'party_membership_approved',
      'Party candidacy approved',
      'The President of your party approved your application for ' || v_candidate.position
        || '. It is now ready for Screening.',
      null
    );

    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      null,
      coalesce(v_president.first_name || ' ' || v_president.last_name, 'Party President'),
      'student',
      'Party Candidacy Approved',
      'Approved ' || v_candidate.given_name || ' for ' || v_candidate.position,
      'info'
    );

    -- Self-heal the display column in case an earlier approval predates this.
    update public.parties
    set president_student_id = v_actor_id
    where id = v_candidate.party_id
      and election_period_id = v_candidate.election_period_id;
  end if;

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where id = p_candidate_id;
  return v_result;
end;
$$;

revoke all on function public.review_party_candidacy_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.review_party_candidacy_rpc(uuid, text) to anon;

-- ---------------------------------------------------------------------
-- SECTION 5 — RE-APPLYING AFTER A DECLINE
--   A declined candidate goes back into the running when the seat is
--   genuinely free.  Re-checked here, because the seat may have been
--   filled again since they were turned down.
-- ---------------------------------------------------------------------
create or replace function public.reapply_party_candidacy_rpc(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
  v_candidate record;
  v_president_id uuid;
  v_result jsonb;
begin
  v_actor_id := public.current_session_user_id();
  if v_actor_id is null then
    raise exception 'Authentication required — re-applications must come from a signed-in student.';
  end if;
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can manage their own candidacy application.';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found.';
  end if;
  if v_candidate.student_id is distinct from v_actor_id then
    raise exception 'You can only re-apply your own candidacy application.';
  end if;
  if v_candidate.party_id is null then
    raise exception 'Independent candidates do not need party approval.';
  end if;
  if v_candidate.position_approval_status <> 'presidentRejected' then
    raise exception 'That application is not waiting to be re-submitted.';
  end if;
  if v_candidate.status not in ('ongoingSubmission', 'pending') then
    raise exception 'That candidacy is no longer open.';
  end if;

  select c.student_id into v_president_id
  from public.candidates c
  where c.party_id = v_candidate.party_id
    and c.election_period_id = v_candidate.election_period_id
    and c.position = 'President'
    and c.status = 'approved'
  limit 1;

  if v_president_id is null then
    raise exception 'The President of your party has not been approved yet, so applications cannot be reopened.';
  end if;

  if exists (
    select 1
    from public.candidates c
    where c.party_id = v_candidate.party_id
      and c.election_period_id = v_candidate.election_period_id
      and c.position = v_candidate.position
      and c.id <> p_candidate_id
      and c.position_approval_status = 'presidentApproved'
  ) then
    raise exception '% already has an approved candidate in this party.', v_candidate.position;
  end if;

  update public.candidates
  set position_approval_status = 'presidentApprovalRequired',
      party_decided_by = null,
      party_decided_at = null
  where id = p_candidate_id;

  perform public.insert_notification_rpc(
    v_president_id, 'student', 'party_membership_request',
    'Party candidacy re-submitted',
    (select coalesce(given_name || ' ' || surname, 'A candidate')
       from public.candidates where id = p_candidate_id)
      || ' re-applied for ' || v_candidate.position || ' in your party.',
    null
  );

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    null,
    coalesce(v_candidate.given_name || ' ' || v_candidate.surname, 'Student'),
    'student',
    'Party Candidacy Re-applied',
    'Re-applied for ' || v_candidate.position,
    'info'
  );

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where id = p_candidate_id;
  return v_result;
end;
$$;

revoke all on function public.reapply_party_candidacy_rpc(uuid) from public, anon, authenticated;
grant execute on function public.reapply_party_candidacy_rpc(uuid) to anon;

-- ---------------------------------------------------------------------
-- SECTION 6 — BRING LIVE CANDIDATES ONTO THE GATE
--   Pending party candidates in the live period that were filed before this
--   gate existed were sitting at 'notRequired' and would otherwise reach
--   Screening unvouched for.  Only parties that ALREADY have an approved
--   President are touched, so no request is created that nobody can action.
--   Parties still waiting on their President's screening approval are left
--   alone, and are picked up by sync_party_president_on_screening() at the
--   moment that President is approved.
-- ---------------------------------------------------------------------
do $$
declare
  v_period uuid;
  v_moved integer;
begin
  select id into v_period
  from public.election_periods
  where is_active = true
  order by election_date desc nulls last, school_year desc, id
  limit 1;

  if v_period is null then
    raise notice 'No active election period; skipping the party-approval backfill.';
    return;
  end if;

  update public.candidates c
  set position_approval_status = 'presidentApprovalRequired'
  where c.party_id is not null
    and c.status = 'pending'
    and c.position <> 'President'
    and c.position_approval_status = 'notRequired'
    and c.election_period_id = v_period
    and exists (
      select 1
      from public.candidates p
      where p.party_id = c.party_id
        and p.election_period_id = c.election_period_id
        and p.position = 'President'
        and p.status = 'approved'
    );

  get diagnostics v_moved = row_count;
  raise notice 'Moved % pending party candidate(s) onto the party-President gate.', v_moved;
end;
$$;
