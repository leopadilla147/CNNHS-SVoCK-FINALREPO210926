-- Run this in Supabase Dashboard > SQL Editor
-- Fixes admin/sslg_adviser approve/reject for student registrations
-- (custom auth is used, not Supabase Auth, so auth.uid() may be null)
-- p_actor_id is passed from frontend to identify the actor performing the action

create or replace function public.review_student_rpc(
  p_student_id uuid,
  p_action text,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_role text;
  v_result jsonb;
begin
  -- Determine the actor: use p_actor_id if provided, fallback to auth.uid()
  v_actor_id := coalesce(p_actor_id, auth.uid());

  -- Verify requester is admin or sslg_adviser (profiles table)
  if exists (select 1 from public.profiles where id = v_actor_id and role = 'admin') then
    select full_name into v_actor_name from public.profiles where id = v_actor_id;
    v_actor_role := 'admin';
  elsif exists (select 1 from public.profiles where id = v_actor_id and role = 'sslg_adviser') then
    select full_name into v_actor_name from public.profiles where id = v_actor_id;
    v_actor_role := 'sslg_adviser';
  else
    raise exception 'Only admins or active SSLG advisers can review student registrations.';
  end if;

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

  update public.students
  set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      reviewed_by = v_actor_id,
      reviewed_at = now()
  where id = p_student_id;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor_id,
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
