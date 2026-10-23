-- =====================================================================
-- 102_student_verification_invariant.sql
-- Make students.verification hold by itself ("automatic" for every
-- system auto-approval through the Student Masterlist).
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHY
--   The verdict was written ONLY by the client (the registration INSERT
--   field / the review RPC's p_verification argument), so an un-rebuilt or
--   stale bundle left the column blank even though the student had been
--   approved automatically.  The rule is a property of the DATA — an
--   approved registration linked to the masterlist row it matched — so the
--   database now derives it:
--     status = 'approved' AND masterlist_id IS NOT NULL  ->  'automatic'
--     anything else                                       ->  'manual'
--
-- WHAT
--   1) BEFORE INSERT/UPDATE trigger on public.students:
--        * INSERT — fills a NULL verdict from the rule above (a BEFORE
--          trigger means the 100 auto-approval notification trigger already
--          sees the value and fires for stale clients too);
--        * UPDATE — a write that tries to blank the column is restored to
--          the previous value, so no client can ever clear a verdict.
--   2) Backfill: every remaining NULL row gets its derived verdict.
--   3) review_student_rpc: an approve call carrying an explicit
--      p_verification on an ALREADY-APPROVED row now (re)stamps the
--      verdict and links the sheet row instead of raising — the masterlist
--      upload re-checks students the system already approved, and one such
--      row must not abort the batch.
--
--   Nothing here auto-CORRECTS a non-null verdict: an SSLG Adviser's manual
--   approval stays 'manual'.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) Derive the verdict on write.
-- ---------------------------------------------------------------------
create or replace function public.derive_student_verification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    if new.verification is null then
      new.verification := case
        when new.status = 'approved' and new.masterlist_id is not null then 'automatic'
        else 'manual'
      end;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Never let a write blank a verdict that was already recorded.
    if new.verification is null then
      new.verification := old.verification;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_derive_student_verification on public.students;
create trigger trg_derive_student_verification
  before insert or update on public.students
  for each row execute function public.derive_student_verification();

-- ---------------------------------------------------------------------
-- 2) Backfill the rows created before this invariant existed.
-- ---------------------------------------------------------------------
update public.students
   set verification = case
     when status = 'approved' and masterlist_id is not null then 'automatic'
     else 'manual'
   end
 where verification is null;

-- ---------------------------------------------------------------------
-- 3) review_student_rpc — re-approve becomes a stamp, not an error.
--    Body identical to 100 apart from the already-approved branch.
-- ---------------------------------------------------------------------
drop function if exists public.review_student_rpc(uuid, text, text);

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
  -- verdict, defaulting to 'manual'.
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
