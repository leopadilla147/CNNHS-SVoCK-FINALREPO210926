-- =====================================================================
-- 135_review_rpc_drop_reason_column_fix.sql
-- FIX for 134: review_student_rpc raised
--   'column "rejection_reason" of relation "students" does not exist'
-- on every APPROVE call.
--
-- WHY
--   134 dropped students.rejection_reason (step 4) but its rewritten
--   function body still had `rejection_reason = null` in the approve
--   branch.  plpgsql does not validate column references at CREATE
--   FUNCTION time, so the migration applied cleanly and the function
--   broke at runtime instead.
--
-- WHAT
--   Recreates review_student_rpc with the approve branch no longer
--   touching the dropped column — everything else (session-spine actor,
--   adminprofiles role gate, required reject explanation, reject =>
--   notice + DELETE, 102 re-approve re-stamp branch) is carried over
--   verbatim from 134.  Also drops the stale 3-argument overload left
--   behind when 133 was skipped, so exactly one signature remains.
--
--   Safe to run whether or not 133 was ever applied: nothing here
--   references students.rejection_reason.
-- =====================================================================

set search_path = public, extensions;

drop function if exists public.review_student_rpc(uuid, text, text);
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
    -- 135 FIX: no rejection_reason reference — the column was dropped
    -- by 134 and nothing is cleared here anymore.  reviewed_at is
    -- removed by the 036 trim; reviewed_by survives.  verification: an
    -- explicit stamp wins (the upload auto-approve passes 'automatic');
    -- a plain adviser approval keeps the registration's own verdict,
    -- defaulting to 'manual'.
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
