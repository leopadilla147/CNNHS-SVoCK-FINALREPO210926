-- =====================================================================
-- 100_student_masterlist_flow.sql
-- Student Masterlist enrollment flow (MASTER-01 insert / MASTER-02 match).
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHY
--   * The SSLG Adviser is the only role with the Student Enrollment tab,
--     and the CNNHS masterlist .docx upload now UPSERTS rows into
--     student_masterlist from the browser session.  The only write policy
--     on that table is "masterlist admin all" (current_app_role() =
--     'admin'), which an adviser session fails — the upload would 403.
--   * The enrollment flow needs the automatic/manual verification
--     distinction PERSISTED.  036 dropped verification_status /
--     mismatch_count, so the badge was derived client-side and reset to
--     "manual" on every reload.  This re-introduces the distinction in
--     the simpler vocabulary the UI now shows: 'automatic' | 'manual'.
--       'automatic' — registration matched the Student Masterlist (LRN +
--                     full name + birthdate + grade level + gender) and
--                     was approved with no human action.
--       'manual'    — any mismatch (or no masterlist row): waits for the
--                     SSLG Adviser's decision in Student Enrollment.
--   * 071 notifies advisers on every registration; it never told the
--     STUDENT that they were auto-approved via the masterlist.  The
--     auto-approved student now gets the masterlist message in their bell
--     at first login.
--
-- WHAT
--   1) students.verification text check in ('automatic','manual') +
--      best-effort backfill from surviving data.
--   2) RLS: "masterlist sslg adviser write" on student_masterlist.
--   3) review_student_rpc gains an optional p_verification stamp (approve
--      path only).  Old 2-arg overload dropped first, 036-style.
--   4) 071 trigger body replaced: student-side auto-approval message.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) students.verification (nullable — legacy rows may stay unmapped)
-- ---------------------------------------------------------------------
alter table public.students
  add column if not exists verification text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'students_verification_check'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
      add constraint students_verification_check
      check (verification in ('automatic', 'manual'));
  end if;
end;
$$;

-- Backfill from what survives 036: an approved registration linked to the
-- masterlist was a full match (automatic); every other decided/pending
-- row is treated as manual.
update public.students
set verification = 'automatic'
where verification is null
  and status = 'approved'
  and masterlist_id is not null;

update public.students
set verification = 'manual'
where verification is null
  and status in ('pending', 'approved');

-- ---------------------------------------------------------------------
-- 2) SSLG Adviser write grant on student_masterlist.  Reads are already
--    covered by "masterlist registration lookup" (enrolled rows, public).
-- ---------------------------------------------------------------------
drop policy if exists "masterlist sslg adviser write" on public.student_masterlist;
create policy "masterlist sslg adviser write"
  on public.student_masterlist
  for all
  using (public.current_app_role() = 'sslg_adviser')
  with check (public.current_app_role() = 'sslg_adviser');

-- ---------------------------------------------------------------------
-- 3) review_student_rpc — adds the optional verification stamp.
--    Body identical to 036 apart from the new parameter and the
--    verification column write, so the audit/result behavior is kept.
-- ---------------------------------------------------------------------
drop function if exists public.review_student_rpc(uuid, text);

create or replace function public.review_student_rpc(
  p_student_id uuid,
  p_action text,
  p_verification text default null
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

  if p_verification is not null
     and p_verification not in ('automatic', 'manual') then
    raise exception 'verification must be ''automatic'' or ''manual''.';
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

  -- reviewed_at is removed by the 036 trim; reviewed_by survives.
  -- verification: an explicit stamp wins (the upload auto-approve passes
  -- 'automatic'); a plain adviser approval keeps the registration's own
  -- verdict, defaulting to 'manual'.
  update public.students
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      verification = case
        when p_action = 'approve'
          then coalesce(p_verification, v_student.verification, 'manual')
        else v_student.verification
      end,
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

revoke all on function public.review_student_rpc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_student_rpc(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) Registration notification trigger — 071 adviser fan-out kept, plus
--    the STUDENT's own masterlist auto-approval message.
-- ---------------------------------------------------------------------
create or replace function public.notify_advisers_on_student_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, role, type, title, message, link)
  select
    a.id,
    'sslg_adviser',
    'student_registered',
    'New Student Registration',
    case
      when new.status = 'pending' then
        coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')
        || ' (LRN: ' || coalesce(new.lrn, 'n/a') || ', ' || coalesce(new.grade_level, 'n/a') || ')'
        || ' registered and is awaiting review.'
      else
        coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')
        || ' (LRN: ' || coalesce(new.lrn, 'n/a') || ', ' || coalesce(new.grade_level, 'n/a') || ')'
        || ' registered and was auto-approved.'
    end,
    '/admin/students?filter=pending'
  from public.adminprofiles a
  where a.role_type = 'sslg_adviser'
    and a.status = 'active';

  -- MASTER-02: a registration that matched the Student Masterlist was
  -- approved automatically — tell the student (runs anonymously at
  -- registration, so this must be SECURITY DEFINER).
  if new.status = 'approved' and new.verification = 'automatic' then
    insert into public.notifications (user_id, role, type, title, message, link)
    values (
      new.id,
      'student',
      'student_approved',
      'Registration Approved',
      'You have been automatically approved through the Student Masterlist match. '
        || 'You can now log in and access the election system.',
      '/student/dashboard'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_advisers_on_student_registration on public.students;
create trigger trg_notify_advisers_on_student_registration
  after insert on public.students
  for each row
  execute function public.notify_advisers_on_student_registration();
