-- =====================================================================
-- 133_student_rejection_reason_email.sql
-- Student registration review emails (approve / reject) + rejection
-- reasons.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHY
--   When the SSLG Adviser manually approves or rejects a pending student
--   registration, the student only learns the verdict through the in-app
--   bell notification.  Rejections say nothing about WHAT was wrong or
--   missing, so the student cannot fix their submission.  The review now
--   (a) records the Adviser's explanation on the students row and
--   (b) emails it to the student through the system emailer (Brevo HTTP
--   API — same transport/secrets as send_password_reset, see the
--   notify_student_review edge function).
--
-- WHAT
--   1) public.students.rejection_reason (text) — the Adviser's structured
--      explanation, one item per line (the email renders it as a list).
--      Cleared on approve, stored on reject.
--   2) review_student_rpc gains an optional 4th parameter,
--      p_rejection_reason.  The parameter list stays backward compatible:
--      existing 3-argument calls (the masterlist upload auto-approve and
--      the plain adviser approve) still resolve through the default.
--
--   Nothing else changes: the session-spine actor derivation, the
--   adminprofiles role gate, the re-approve re-stamp branch (102) and the
--   audit entries are carried over verbatim from 100/102.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) Rejection reason column.
-- ---------------------------------------------------------------------
alter table public.students
  add column if not exists rejection_reason text;

comment on column public.students.rejection_reason is
  'Adviser explanation recorded on manual rejection — one item per line; emailed to the student by notify_student_review. Null on approvals.';

-- ---------------------------------------------------------------------
-- 2) review_student_rpc — optional p_rejection_reason.
--    Body identical to 102 apart from the reason handling.
-- ---------------------------------------------------------------------
drop function if exists public.review_student_rpc(uuid, text, text);

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

  -- 133: the reject path stores the Adviser's explanation (what is wrong
  -- or missing) so the notify_student_review emailer can quote it to the
  -- student verbatim.  A blank reason stores NULL; approvals always clear
  -- any stale reason from an earlier rejection.
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

  -- reviewed_at is removed by the 036 trim; reviewed_by survives.
  -- verification: an explicit stamp wins (the upload auto-approve passes
  -- 'automatic'); a plain adviser approval keeps the registration's own
  -- verdict, defaulting to 'manual'.  rejection_reason: cleared on
  -- approve, stored on reject.
  update public.students
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      verification = case
        when p_action = 'approve'
          then coalesce(p_verification, v_student.verification, 'manual')
        else v_student.verification
      end,
      masterlist_id = case
        when p_action = 'approve' and v_student.masterlist_id is null
          then (select sm.id
                  from public.student_masterlist sm
                 where sm.lrn = v_student.lrn
                 order by sm.school_year desc
                 limit 1)
        else v_student.masterlist_id
      end,
      rejection_reason = case when p_action = 'reject' then v_reason else null end,
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
      else 'Rejected registration of ' || v_student.first_name || ' ' || v_student.last_name
        || ' (LRN: ' || v_student.lrn || ') — Reason: ' || replace(v_reason, chr(10), '; ')
    end,
    case when p_action = 'approve' then 'success' else 'warning' end
  );

  select row_to_json(s)::jsonb into v_result
  from public.students s where s.id = p_student_id;
  return v_result;
end;
$$;

revoke all on function public.review_student_rpc(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_student_rpc(uuid, text, text, text) to anon, authenticated;
