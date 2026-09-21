-- =====================================================================
-- 036_domain_trim.sql
-- Phase 02, Plan 02-02 - Task 1 (domain trim: students / student_masterlist
-- / election_periods / candidates to the v1.1 column contracts; ELECT-02
-- publish gate at the DB layer; dependent RPC rewrites, actor derived
-- server-side per AUTH-05)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- This is the second half of the v1.1 schema restructure (035 consolidated
-- staff identity; 036 re-shapes the election domain):
--   * students      — volunteers verification_status / mismatch_count /
--                     reviewed_at / must_change_password / session_version
--                     (036 removes them); masterlist_id stays nullable so
--                     manual approval remains possible.
--   * student_masterlist — CNNHS-MASTER-LIST-FORMAT additive shape:
--                     middle_name / section / strand / parent_guardian /
--                     adviser_name added; the 001 columns are untouched.
--   * election_periods — schedule rework: election_date + start_time
--                     (default '08:00:00') + end_time (default '18:00:00')
--                     replace the legacy timestamptz window; the 001
--                     elapsed CHECK and the start_at/end_at/nomination_open/
--                     rules_discussion_at/campaign_*/official_list_posted/
--                     plan_finalized columns are dropped; the workflow
--                     flags (candidacy_open/is_active/results_published/
--                     proclaimed/proclaimed_at) survive.
--   * candidates    — drops forwarded_by / reviewed_by (reviewed_at kept).
--   * ELECT-02      — publish_results_rpc refuses to publish while a
--                     complaint with status 'filed' exists for the election
--                     (reads 028's has_active_complaint_rpc — never an
--                     inlined substitute).
--   * AUTH-05       — review_student_rpc / review_candidacy_rpc lose the
--                     client-supplied p_actor_id parameter entirely; the
--                     actor derives exclusively from current_session_user_id()
--                     and the role gate reads public.adminprofiles.
--
-- ORDER MATTERS (additive-first): every function that references a removed
-- column is re-created (or dropped) BEFORE the column removal statement, so
-- the chain stays apply-consistent at every step.  All column removals use
-- drop-column-if-exists (PostgreSQL's own existence guard) and every
-- constraint tied to a removed column is dropped with drop-constraint-if-
-- exists first — re-apply is a clean no-op.
--
-- shapes NEVER touched: votes, biometric_templates, sessions,
-- login_attempts.  The kiosk verifier's ticket mint below is contract DML
-- into public.sessions (031/034 shape preserved verbatim).  profiles /
-- commissioners / sslg_advisers are NOT dropped here (037 owns that wave).
-- 001-034 bodies are NEVER edited.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- SECTION 1 — DEPENDENT RPC REWRITES (additive-first: re-create before
-- the columns they reference are removed)
-- ---------------------------------------------------------------------

-- 1.1) login_student_direct_v2 — same 023/030 body (lockout, D-10 bcrypt
--      branch, transparent re-hash, session mint) but the returns table
--      drops the must_change_password OUT column (036 removes that flag;
--      the v1.1 client never reads it).  DROP first: the return type
--      changes and PostgreSQL refuses CREATE OR REPLACE across it (42P13,
--      030 precedent).
drop function if exists public.login_student_direct_v2(text, text);

create or replace function public.login_student_direct_v2(p_email text, p_password text)
returns table (
  token text,
  id uuid,
  first_name text,
  last_name text,
  email text,
  status text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_identifier text;
  v_ip inet;
  v_headers jsonb;
  v_student public.students;
  v_token text;
begin
  v_identifier := lower(p_email);

  -- D-19: derive the client IP from x-forwarded-for (split_part ',', 1);
  -- absent or malformed header -> NULL (per-IP throttle skipped, T-02-10).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- SEC-03: the guard's reject path emits the identical failure text as a
  -- bad password — never an account-existence / lock-state oracle.
  if not public.login_guard(v_identifier, v_ip) then
    raise exception 'Invalid credentials';
  end if;

  select * into v_student
    from public.students s
   where lower(s.email) = v_identifier
   limit 1;

  -- D-20: unknown accounts count a failure against the same counter and
  -- return the identical text.
  if v_student.id is null then
    perform public.record_login_outcome(v_identifier, v_ip, false);
    raise exception 'Invalid credentials';
  end if;

  -- D-10 branching: bcrypt-prefixed hashes verify via crypt(); anything
  -- else (legacy 64-hex SHA-256; NULL) compares the recomputed SHA-256.
  if starts_with(coalesce(v_student.password_hash, ''), '$2') then
    if v_student.password_hash is distinct from crypt(p_password, v_student.password_hash) then
      perform public.record_login_outcome(v_identifier, v_ip, false);
      raise exception 'Invalid credentials';
    end if;
  else
    if v_student.password_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      perform public.record_login_outcome(v_identifier, v_ip, false);
      raise exception 'Invalid credentials';
    end if;

    -- D-11/D-27: transparent re-hash of the legacy hash to bcrypt cost 10.
    update public.students
       set password_hash = crypt(p_password, gen_salt('bf', 10))
     where id = v_student.id;
  end if;

  perform public.record_login_outcome(v_identifier, v_ip, true);

  v_token := public.issue_session_token(v_student.id, 'student');

  return query
    select v_token, v_student.id, v_student.first_name, v_student.last_name,
           v_student.email, v_student.status;
end;
$$;

-- 1.2) submit_vote_rpc — DROPPED (032 web-vote machinery).  Its body reads
--      election_periods.order by e.start_at (032:341); with the column
--      removed, PostgreSQL would refuse to drop start_at while the function
--      depends on it.  The v1.1 change spec removes the entire web-vote
--      surface — 037 owns the rest of that wave (vote_receipts table,
--      verify_receipt_rpc, kiosk-queue tables).  Dropping the function
--      here is REQUIRED for the start_at removal to apply; guarded revoke
--      + drop mirrors the 027/035 superseded-surface pattern.
do $$
begin
  if to_regprocedure('public.submit_vote_rpc(text,jsonb)') is not null then
    revoke all on function public.submit_vote_rpc(text, jsonb) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.submit_vote_rpc(text, jsonb);

-- 1.3) review_student_rpc — AUTH-05 rewrite.  The p_actor_id parameter is
--      REMOVED (the spoofing vector 004-era code carried); the actor
--      derives exclusively from current_session_user_id().  Role gate:
--      the actor must exist in public.adminprofiles with role_type in
--      ('chief','commissioner','co_commissioner','sslg_adviser'), else the
--      004 authorized-message.  reviewed_by keeps writing the session
--      actor; the reviewed_at write is DELETED (column removed).
--      The old (uuid, text, uuid) overload is dropped first so the
--      two-arg call resolves to this function.
drop function if exists public.review_student_rpc(uuid, text, uuid);

create or replace function public.review_student_rpc(
  p_student_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_student record;
  v_actor uuid;
  v_actor_name text;
  v_actor_role text;
  v_result jsonb;
begin
  -- Actor derives ONLY from the session spine (AUTH-05).
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Role gate: adminprofiles membership (036 re-grounds the 004 check)
  -- chief / commissioner / co_commissioner / sslg_adviser.
  select a.full_name, a.role_type
    into v_actor_name, v_actor_role
    from public.adminprofiles a
   where a.id = v_actor;

  if not found then
    raise exception 'Only admins or active SSLG advisers can review student registrations.';
  end if;

  v_actor_role := case when v_actor_role = 'sslg_adviser' then 'sslg_adviser' else 'admin' end;
  v_actor_name := coalesce(v_actor_name, 'Administrator');

  if p_action not in ('approve', 'reject') then
    raise exception 'Action must be approve or reject.';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'Student not found.';
  end if;

  if v_student.status != 'pending' then
    raise exception 'Cannot % a student with status ''%''.', p_action, v_student.status;
  end if;

  -- reviewed_at is removed by this trim; reviewed_by survives.
  update public.students
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      reviewed_by = v_actor
  where id = p_student_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    v_actor_name,
    v_actor_role,
    case when p_action = 'approve' then 'Approved Student Registration' else 'Rejected Student Registration' end,
    case when p_action = 'approve'
      then 'Approved registration of ' || v_student.first_name || ' ' || v_student.last_name || ' (LRN: ' || v_student.lrn || ')'
      else 'Rejected registration of ' || v_student.first_name || ' ' || v_student.last_name || ' (LRN: ' || v_student.lrn || ')'
    end,
    case when p_action = 'approve' then 'success' else 'warning' end
  );

  select row_to_json(s)::jsonb into v_result
  from public.students s where s.id = p_student_id;
  return v_result;
end;
$$;

-- 1.4) review_candidacy_rpc — AUTH-05 rewrite.  p_actor_id REMOVED; the
--      actor derives from current_session_user_id().  Role gate:
--      adminprofiles role_type in ('chief','commissioner','co_commissioner')
--      (the 003 admin-only message).  The reviewed_by write is DELETED
--      (column removed); reviewed_at := now() is kept.  Rejection
--      semantics (reason/details/tier) and the audit insert are kept.
drop function if exists public.review_candidacy_rpc(uuid, text, text, text, text, uuid);

create or replace function public.review_candidacy_rpc(
  p_candidate_id uuid,
  p_action text,
  p_rejection_reason text default null,
  p_rejection_details text default null,
  p_rejection_tier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_candidate record;
  v_actor uuid;
  v_actor_name text;
  v_new_status text;
  v_student_name text;
  v_result jsonb;
begin
  -- Actor derives ONLY from the session spine (AUTH-05).
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Role gate: adminprofiles — chief / commissioner / co_commissioner.
  if not exists (
    select 1 from public.adminprofiles a
     where a.id = v_actor
       and a.role_type in ('chief', 'commissioner', 'co_commissioner')
  ) then
    raise exception 'Only admins can review candidacy applications.';
  end if;

  select full_name into v_actor_name
  from public.adminprofiles
  where id = v_actor;

  v_actor_name := coalesce(v_actor_name, 'Administrator');

  if p_action not in ('approve', 'reject') then
    raise exception 'Action must be approve or reject.';
  end if;

  -- Rejection requires reason and tier
  if p_action = 'reject' and p_rejection_reason is null then
    raise exception 'A rejection reason is required.';
  end if;
  if p_action = 'reject' and p_rejection_tier is null then
    raise exception 'A rejection tier (low/high) is required.';
  end if;
  if p_action = 'reject' and p_rejection_tier not in ('low', 'high') then
    raise exception 'Rejection tier must be low or high.';
  end if;

  select c.*, s.first_name, s.last_name into v_candidate
  from public.candidates c
  left join public.students s on s.id = c.student_id
  where c.id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found.';
  end if;

  if v_candidate.status != 'pending' then
    raise exception 'Cannot % a candidate with status ''%''.', p_action, v_candidate.status;
  end if;

  v_new_status := case when p_action = 'approve' then 'approved' else 'rejected' end;

  -- reviewed_by is removed by this trim; reviewed_at survives.
  update public.candidates
  set status = v_new_status,
      reviewed_at = now(),
      rejection_reason = case when p_action = 'reject' then p_rejection_reason else null end,
      rejection_details = case when p_action = 'reject' then p_rejection_details else null end,
      rejection_tier = case when p_action = 'reject' then p_rejection_tier else 'low' end
  where id = p_candidate_id;

  v_student_name := coalesce(
    v_candidate.first_name || ' ' || v_candidate.last_name,
    v_candidate.given_name || ' ' || v_candidate.surname
  );

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    v_actor_name,
    'admin',
    case when p_action = 'approve' then 'Approved Candidacy' else 'Rejected Candidacy' end,
    case when p_action = 'approve'
      then 'Approved candidacy of ' || v_student_name || ' for ' || v_candidate.position
      else 'Rejected candidacy of ' || v_student_name || ' for ' || v_candidate.position || '. Reason: ' || coalesce(p_rejection_reason, 'N/A') || '. Details: ' || coalesce(p_rejection_details, 'N/A') || '. Tier: ' || coalesce(p_rejection_tier, 'N/A')
    end,
    case when p_action = 'approve' then 'success' else 'warning' end
  );

  select row_to_json(c)::jsonb into v_result
  from public.candidates c where c.id = p_candidate_id;
  return v_result;
end;
$$;

-- 1.5) finalize_election_plan_rpc + post_official_list_rpc — DROPPED.
--      Their columns (plan_finalized / official_list_posted) are removed
--      by this trim; the v1.1 EB surface has no plan-finalize step and
--      candidate-approval/official-list mechanics re-home in Phase 3
--      (Screening & Validation).  Guarded revoke + drop (027/035 pattern).
do $$
begin
  if to_regprocedure('public.finalize_election_plan_rpc(uuid)') is not null then
    revoke all on function public.finalize_election_plan_rpc(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.post_official_list_rpc(uuid)') is not null then
    revoke all on function public.post_official_list_rpc(uuid) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.finalize_election_plan_rpc(uuid);
drop function if exists public.post_official_list_rpc(uuid);

-- 1.6) open_election_rpc — re-created WITHOUT the plan_finalized and
--      official_list_posted pre-checks (both columns removed).  The
--      is_active guard and the admin gate (current_app_role() = 'admin')
--      survive.  No return-type change, but the plan mandates drop-first
--      so the removals below never see a stale body.
drop function if exists public.open_election_rpc(uuid);

create or replace function public.open_election_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_record record;
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can open the election.';
  end if;

  select * into v_record
  from public.election_periods
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  if v_record.is_active then
    raise exception 'Election is already active.';
  end if;

  update public.election_periods
  set is_active = true
  where id = p_election_id;
end;
$$;

-- 1.7) close_election_rpc — unchanged 012 body (is_active only).
create or replace function public.close_election_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can close the election.';
  end if;

  if not exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Election is not currently active.';
  end if;

  update public.election_periods
  set is_active = false
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

-- 1.8) publish_results_rpc — ELECT-02 gate at the DB layer.  Keeps the
--      admin gate and the cannot-publish-while-active guard; adds the
--      filed-complaint gate reading 028's has_active_complaint_rpc (never
--      an inlined substitute so 028 semantics cannot drift).  Drop-first
--      per the plan's additive-first contract.
drop function if exists public.publish_results_rpc(uuid);

create or replace function public.publish_results_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can publish results.';
  end if;

  if exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Cannot publish results while the election is still active.';
  end if;

  -- ELECT-02 (T-02-12): a complaint with status 'filed' blocks publication
  -- until resolved/rejected — the announcement stays delayed.
  if public.has_active_complaint_rpc(p_election_id) then
    raise exception 'Results cannot be published while a complaint is filed.';
  end if;

  update public.election_periods
  set results_published = true
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

-- 1.9) proclaim_winners_rpc — 012 body with proclaimed_by written from
--      public.current_session_user_id() instead of auth.uid() (T-02-15:
--      auth.uid() is always NULL under the custom session spine).
drop function if exists public.proclaim_winners_rpc(uuid);

create or replace function public.proclaim_winners_rpc(p_election_id uuid)
returns table (
  winning_position text,
  winner_name text,
  votes integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can proclaim winners.';
  end if;

  if not exists (select 1 from public.election_periods where id = p_election_id and results_published = true) then
    raise exception 'Results must be published before proclaiming winners.';
  end if;

  delete from public.proclamations where election_period_id = p_election_id;

  insert into public.proclamations (election_period_id, winning_position, candidate_id, votes, proclaimed_by)
  select
    c.election_period_id,
    c.position,
    c.id,
    count(v.id)::integer as vote_count,
    public.current_session_user_id()
  from public.candidates c
  left join public.votes v on v.candidate_id = c.id
  where c.election_period_id = p_election_id
    and c.status = 'approved'
  group by c.election_period_id, c.position, c.id
  having count(v.id) = (
    select max(cnt) from (
      select count(v2.id) as cnt
      from public.candidates c2
      left join public.votes v2 on v2.candidate_id = c2.id
      where c2.election_period_id = p_election_id
        and c2.status = 'approved'
        and c2.position = c.position
      group by c2.id
    ) sub
  );

  update public.election_periods
  set proclaimed = true,
      proclaimed_at = now()
  where id = p_election_id;

  return query
  select
    p.winning_position,
    (c.given_name || ' ' || c.surname)::text as winner_name,
    p.votes
  from public.proclamations p
  join public.candidates c on c.id = p.candidate_id
  where p.election_period_id = p_election_id
  order by p.winning_position;
end;
$$;

-- 1.10) verify_student_credentials_rpc — the kiosk's ONLY student
--       verifier.  034 contract preserved EXACTLY (signature, returns
--       columns, D-10 branch, already-voted flag, 5-minute ticket mint
--       with kind = 'ticket', anon/authenticated grants) — the active-
--       election lookup re-orders from e.start_at to the new schedule
--       columns (election_date desc nulls last, start_time desc nulls
--       last) so the kiosk path stays deterministic (T-02-13).
drop function if exists public.verify_student_credentials_rpc(text, text);

create or replace function public.verify_student_credentials_rpc(p_lrn text, p_password_sha256 text)
returns table (
  student_id uuid,
  first_name text,
  last_name text,
  voter_ticket text,
  expires_at timestamptz,
  has_voted boolean
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_student public.students;
  v_election_id uuid;
  v_voted boolean := false;
  v_raw text;
  v_hash text;
  v_expires timestamptz;
begin
  if p_lrn is null or p_password_sha256 is null then
    raise exception 'Missing student credentials';
  end if;

  select * into v_student
    from public.students s
   where s.lrn = p_lrn
     and s.status = 'approved'
   limit 1;

  if v_student.id is null then
    raise exception 'Student not found or not approved';
  end if;

  -- 023 D-10 branch shape: bcrypt-prefixed hashes verify via crypt();
  -- anything else (legacy 64-hex SHA-256; NULL) compares the recomputed
  -- SHA-256 the client sent.  The kiosk protocol presents the SHA-256 hex
  -- for BOTH branches (the stored bcrypt hash of a kiosk-native row is
  -- bcrypt(sha256hex); the equality branch covers not-yet-rehashed rows).
  if starts_with(coalesce(v_student.password_hash, ''), '$2') then
    if v_student.password_hash is distinct from crypt(p_password_sha256, v_student.password_hash) then
      raise exception 'Invalid password';
    end if;
  else
    if v_student.password_hash is distinct from p_password_sha256 then
      raise exception 'Invalid password';
    end if;
  end if;

  -- Already-voted flag is DETERMINISTIC and lives in this RPC (never in
  -- edge code): the ACTIVE election is the only one students can vote in.
  -- 036 re-orders against the new schedule columns (T-02-13).
  select e.id into v_election_id
    from public.election_periods e
   where e.is_active = true
   order by e.election_date desc nulls last, e.start_time desc nulls last
   limit 1;

  if v_election_id is not null then
    select exists (
      select 1
        from public.votes v
       where v.voter_id = v_student.id
         and v.election_period_id = v_election_id
    ) into v_voted;
  end if;

  if v_voted then
    student_id := v_student.id;
    first_name := v_student.first_name;
    last_name := v_student.last_name;
    voter_ticket := null;
    expires_at := null;
    has_voted := true;
    return next;
    return;
  end if;

  -- Mint the ADDITIONAL short-lived voter ticket (B-2).  Deliberately NOT
  -- issue_session_token: its delete-prior body would kill the student's
  -- active web session.  The ticket is an extra 5-minute session row,
  -- kind = 'ticket' so 034's sliding renewal never touches it.
  v_raw := gen_random_uuid()::text;
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  v_expires := now() + interval '5 minutes';

  insert into public.sessions (token_hash, user_id, user_role, expires_at, kind)
  values (v_hash, v_student.id, 'student', v_expires, 'ticket');

  student_id := v_student.id;
  first_name := v_student.first_name;
  last_name := v_student.last_name;
  voter_ticket := v_raw;
  expires_at := v_expires;
  has_voted := false;
  return next;
end;
$$;

-- 1.11) get_live_results_rpc() — no-op re-assert of the 027 body
--       (current_commissioner_role() = 'chief' gate; it re-grounds onto
--       adminprofiles via 035).  Re-created purely to keep this file's
--       grant block coherent.
create or replace function public.get_live_results_rpc()
returns table (
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  given_name text,
  surname text,
  party_name text,
  votes bigint
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can view live results.';
  end if;

  return query
    select * from public.live_results_restricted;
end;
$$;

-- NOTE: change_my_password is deliberately NOT re-created here — 035
-- already superseded it (staff branch on adminprofiles, student branch on
-- the trimmed students columns); the 036-trimmed columns are never
-- referenced from 035's body.

-- ---------------------------------------------------------------------
-- SECTION 2 — STUDENTS TRIM (existence-guarded)
--    Removes: verification_status, mismatch_count, reviewed_at,
--             must_change_password, session_version.
--    Keeps:   id, student_id, masterlist_id (nullable — manual approval
--             stays possible), first_name, middle_name, last_name,
--             grade_level, gender, birthdate, lrn, email, password_hash,
--             status, registered_at, reviewed_by.
--    The 001 inline CHECKs on the removed columns are dropped first so
--    the column drops cannot fail on their constraints.
-- ---------------------------------------------------------------------
alter table public.students drop constraint if exists students_verification_status_check;
alter table public.students drop constraint if exists students_mismatch_count_check;

alter table public.students
  drop column if exists verification_status,
  drop column if exists mismatch_count,
  drop column if exists reviewed_at,
  drop column if exists must_change_password,
  drop column if exists session_version;

-- ---------------------------------------------------------------------
-- SECTION 3 — STUDENT_MASTERLIST ADDITIVE RESHAPE (add column if not
--    exists; no removals)
--    CNNHS-MASTER-LIST-FORMAT delta: middle_name, section, strand,
--    parent_guardian, adviser_name.  lrn / first_name / last_name /
--    birthdate / grade_level / gender / school_year / enrollment_status /
--    imported_by / imported_at and unique (lrn, school_year) are kept.
--    (Exact docx template field mapping is verified in Phase 3 MASTER-01.)
-- ---------------------------------------------------------------------
alter table public.student_masterlist
  add column if not exists middle_name text,
  add column if not exists section text,
  add column if not exists strand text,
  add column if not exists parent_guardian text,
  add column if not exists adviser_name text;

-- ---------------------------------------------------------------------
-- SECTION 4 — ELECTION_PERIODS REWORK (existence-guarded)
--    Adds the v1.1 schedule: election_date, start_time (default 08:00),
--    end_time (default 18:00).  Drops the 001 elapsed CHECK (start_at /
--    end_at ordering) first, then the legacy columns: start_at, end_at,
--    nomination_open, rules_discussion_at, campaign_start_at,
--    campaign_end_at, official_list_posted, plan_finalized.
--    After the columns land the election_periods_time_order CHECK
--    (end_time > start_time when both set) is added.
--    Keeps: school_year, venue, voting_method + its 029 CHECK,
--    candidacy_open, is_active, results_published, proclaimed,
--    proclaimed_at, updated_at, created_by, and the one_active_election
--    partial unique index.
-- ---------------------------------------------------------------------
alter table public.election_periods
  add column if not exists election_date date,
  add column if not exists start_time time not null default '08:00:00',
  add column if not exists end_time time not null default '18:00:00';

-- The 001 elapsed CHECK was created as an unnamed table-level check
-- (001:202) so PostgreSQL auto-named it election_periods_check; dropping
-- guardedly is a no-op everywhere else.
alter table public.election_periods drop constraint if exists election_periods_check;

alter table public.election_periods
  drop column if exists start_at,
  drop column if exists end_at,
  drop column if exists nomination_open,
  drop column if exists rules_discussion_at,
  drop column if exists campaign_start_at,
  drop column if exists campaign_end_at,
  drop column if exists official_list_posted,
  drop column if exists plan_finalized;

alter table public.election_periods drop constraint if exists election_periods_time_order;
alter table public.election_periods
  add constraint election_periods_time_order
  check (start_time is null or end_time is null or end_time > start_time);

-- ---------------------------------------------------------------------
-- SECTION 5 — CANDIDATES TRIM (existence-guarded)
--    Removes forwarded_by / reviewed_by after dropping their FK
--    constraints (001 inline REFERENCES public.profiles(id), auto-named
--    candidates_forwarded_by_fkey / candidates_reviewed_by_fkey).
--    reviewed_at is kept (review_candidacy_rpc still writes it).
-- ---------------------------------------------------------------------
alter table public.candidates drop constraint if exists candidates_forwarded_by_fkey;
alter table public.candidates drop constraint if exists candidates_reviewed_by_fkey;

alter table public.candidates
  drop column if exists forwarded_by,
  drop column if exists reviewed_by;

-- ---------------------------------------------------------------------
-- SECTION 6 — GRANTS (least privilege, 023/030/031/035 pattern),
--    re-asserted every run.
--    login_student_direct_v2 runs pre-session under anon only; the
--    review/lifecycle RPCs and the kiosk verifier serve anon +
--    authenticated; get_live_results_rpc keeps the 027 anon/authenticated
--    surface; has_active_complaint_rpc is re-asserted only (028 owns it).
-- ---------------------------------------------------------------------
revoke all on function public.login_student_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_student_direct_v2(text, text) to anon;

revoke all on function public.review_student_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.review_student_rpc(uuid, text) to anon, authenticated;

revoke all on function public.review_candidacy_rpc(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.review_candidacy_rpc(uuid, text, text, text, text) to anon, authenticated;

revoke all on function public.open_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.open_election_rpc(uuid) to anon, authenticated;

revoke all on function public.close_election_rpc(uuid) from public, anon, authenticated;
grant execute on function public.close_election_rpc(uuid) to anon, authenticated;

revoke all on function public.publish_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.publish_results_rpc(uuid) to anon, authenticated;

revoke all on function public.proclaim_winners_rpc(uuid) from public, anon, authenticated;
grant execute on function public.proclaim_winners_rpc(uuid) to anon, authenticated;

revoke all on function public.verify_student_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to anon, authenticated;

revoke all on function public.get_live_results_rpc() from public, anon, authenticated;
grant execute on function public.get_live_results_rpc() to anon, authenticated;

revoke all on function public.has_active_complaint_rpc(uuid) from public, anon, authenticated;
grant execute on function public.has_active_complaint_rpc(uuid) to anon, authenticated;