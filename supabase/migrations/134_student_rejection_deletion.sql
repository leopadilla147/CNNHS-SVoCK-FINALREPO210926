-- =====================================================================
-- 134_student_rejection_deletion.sql
-- Rejected registrations are REMOVED from the students roster.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHY
--   A rejection used to leave the row in public.students forever, which
--   (a) kept the student's submitted data in the roster and (b) pinned
--   the unique LRN/email so the student could never fix and re-register.
--   A rejection is now terminal-and-removed: the row is deleted and the
--   LRN/email are freed for a corrected resubmission.
--
--   The review email still has to quote the Adviser's explanation AFTER
--   the row is gone, so the reject path first files a one-shot notice in
--   public.student_rejection_notices (service-role only).  The
--   notify_student_review edge function reads the notice, sends the
--   email, then deletes the notice — a failed send leaves it in place
--   for a retry, a successful one can never be replayed.
--
-- WHAT
--   1) public.student_rejection_notices — one-shot rejection email
--      queue.  No FK to students (the row is deleted moments later);
--      RLS on with no policies (service-role writes/reads only, same
--      convention as password_reset_codes from 120).
--   2) review_student_rpc — the reject branch now inserts the notice
--      and DELETES the students row (no status flip, nothing kept).
--      The reject still REQUIRES the Adviser's explanation (p_rejection_
--      reason) — it travels into the notice and the audit entry.  The
--      approve branch is unchanged (102 semantics, plus it clears any
--      stale rejection_reason from the 133 interim).
--   3) Backfill: every ALREADY-rejected row is purged the same way —
--      its LRN/email are freed and the reason survives in audit_logs
--      (133 rejects logged "— Reason: ...").  One summary audit row
--      records the purge.  If a legacy rejected row is somehow still
--      referenced by a non-cascade FK (party president / candidacy
--      nominee — impossible for a student that was never approved),
--      the delete raises loudly instead of silently skipping.
--   4) students.rejection_reason (added by 133) is dropped — rejects no
--      longer leave a row behind to store it on; the reason lives in
--      the notice and the audit trail.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) One-shot rejection notices (read + consumed by the emailer).
-- ---------------------------------------------------------------------
create table if not exists public.student_rejection_notices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  recipient_email text,
  full_name text not null,
  lrn text,
  rejection_reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_student_rejection_notices_student
  on public.student_rejection_notices (student_id);

-- Service-role only (no policies): the edge function reads/consumes with
-- the service key; no client role ever queries this table directly.
alter table public.student_rejection_notices enable row level security;

comment on table public.student_rejection_notices is
  'One-shot queue for student registration rejection emails (134). The review RPC files a notice and deletes the students row; notify_student_review sends the email and removes the notice.';

-- ---------------------------------------------------------------------
-- 2) review_student_rpc — reject deletes the registration row.
--    Actor/role gates and the 102 re-approve re-stamp branch carried
--    over verbatim.
-- ---------------------------------------------------------------------
drop function if exists public.review_student_rpc(uuid, text, text, text);

create or replace function public.review_student_rpc(
  p_student_id uuid,
  p_action text,
  p_verification text default null,
  p_rejection_reason text default null
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
  v_reason text;
  v_result jsonb;
begin
  -- Actor derives ONLY from the session spine (AUTH-05).
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Role gate: adminprofiles membership (chief / commissioner /
  -- co_commissioner / sslg_adviser).
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

  -- 134: the reject path REMOVES the registration, so the Adviser's
  -- explanation (what is wrong or missing) is mandatory — it is quoted
  -- verbatim in the emailed notice and preserved in the audit entry.
  v_reason := nullif(btrim(coalesce(p_rejection_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'The rejection explanation must be 2000 characters or fewer.';
  end if;
  if p_action = 'reject' and v_reason is null then
    raise exception 'A rejection must explain what is wrong or missing in the registration.';
  end if;

  select * into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'Student not found.';
  end if;

  if v_student.status != 'pending' then
    -- MASTER-02 re-check: the masterlist upload re-evaluates students the
    -- system may already have approved.  An approve call carrying an
    -- explicit stamp only (re)stamps the verdict and links the sheet row —
    -- it never moves the status, and it never raises.
    if p_action = 'approve'
       and v_student.status = 'approved'
       and p_verification is not null then
      update public.students
         set verification = p_verification,
             masterlist_id = coalesce(
               v_student.masterlist_id,
               (select sm.id
                  from public.student_masterlist sm
                 where sm.lrn = v_student.lrn
                 order by sm.school_year desc
                 limit 1)
             )
       where id = p_student_id;

      select row_to_json(s)::jsonb into v_result
      from public.students s where s.id = p_student_id;
      return v_result;
    end if;

    raise exception 'Cannot % a student with status ''%''.', p_action, v_student.status;
  end if;

  if p_action = 'reject' then
    -- 134 — the rejection is terminal AND removed: file the one-shot
    -- email notice, then delete the registration row outright.  The
    -- student's LRN and email are freed for a corrected resubmission.
    insert into public.student_rejection_notices
      (student_id, recipient_email, full_name, lrn, rejection_reason)
    values (
      p_student_id,
      v_student.email,
      concat_ws(' ',
        v_student.first_name,
        nullif(btrim(coalesce(v_student.middle_name, '')), ''),
        v_student.last_name),
      v_student.lrn,
      v_reason
    );

    delete from public.students where id = p_student_id;
  else
    -- Approve: the row STAYS (the student gains a working account).
    -- reviewed_at is removed by the 036 trim; reviewed_by survives.
    -- verification: an explicit stamp wins (the upload auto-approve
    -- passes 'automatic'); a plain adviser approval keeps the
    -- registration's own verdict, defaulting to 'manual'.
    update public.students
    set status = 'approved',
        verification = coalesce(p_verification, v_student.verification, 'manual'),
        masterlist_id = case
          when v_student.masterlist_id is null
            then (select sm.id
                    from public.student_masterlist sm
                   where sm.lrn = v_student.lrn
                   order by sm.school_year desc
                   limit 1)
          else v_student.masterlist_id
        end,
        rejection_reason = null,
        reviewed_by = v_actor
    where id = p_student_id;
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    v_actor_name,
    v_actor_role,
    case when p_action = 'approve' then 'Approved Student Registration' else 'Rejected Student Registration' end,
    case when p_action = 'approve'
      then 'Approved registration of ' || v_student.first_name || ' ' || v_student.last_name || ' (LRN: ' || v_student.lrn || ')'
      else 'Rejected registration of ' || v_student.first_name || ' ' || v_student.last_name
        || ' (LRN: ' || v_student.lrn || ') — registration record removed from the roster'
        || '; Reason: ' || replace(v_reason, chr(10), '; ')
    end,
    case when p_action = 'approve' then 'success' else 'warning' end
  );

  if p_action = 'reject' then
    -- The row no longer exists; hand back the captured pre-delete row so
    -- the return shape stays a student record.
    return to_jsonb(v_student);
  end if;

  select row_to_json(s)::jsonb into v_result
  from public.students s where s.id = p_student_id;
  return v_result;
end;
$$;

revoke all on function public.review_student_rpc(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_student_rpc(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Backfill: purge every ALREADY-rejected registration the same way
--    (frees their LRN/email; the reasons survive in audit_logs).
-- ---------------------------------------------------------------------
with purged as (
  delete from public.students where status = 'rejected' returning 1
)
insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
select null, 'System', 'system', 'Purged Rejected Registrations',
       'Removed ' || count(*) || ' rejected registration(s) from the students roster (migration 134).',
       'info'
from purged
having count(*) > 0;

-- ---------------------------------------------------------------------
-- 4) The 133 column is redundant now — rejects leave no row to store
--    it on and the reason lives in the notice + audit trail.
-- ---------------------------------------------------------------------
alter table public.students drop column if exists rejection_reason;
