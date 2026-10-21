-- 072_student_profile_picture.sql
-- Students can set a profile picture from the My Profile page.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   public.students carried no picture column, so every student surface
--   (My Profile card, header/sidebar avatar, admin enrollment table +
--   detail modal) rendered an initials circle.  This adds an optional
--   photo per student.
--
-- WHAT
--   1) students.profile_picture_url text (nullable — the column IS the
--      "has a picture" flag; no default).
--   2) storage bucket 'student-pictures' — public read, 2 MB,
--      jpeg/png/webp, mirroring 001/003's candidate-pictures setup.
--      The write policy carries NO auth.uid() condition: the custom
--      session-spine auth leaves auth.uid() null on the storage path,
--      which is why 020 had to relax candidate-pictures the same way.
--      The RPC below is what actually authorizes the saved URL — it
--      refuses anything that is not a student-pictures object URL.
--   3) update_my_profile_picture(p_picture_url text) — the ONLY write
--      path to the column.  SECURITY DEFINER; the actor derives
--      exclusively from current_session_user_id() (036 AUTH-05 contract,
--      no client-supplied actor id anywhere).  Role gate: the session
--      role must be 'student' and the actor must exist in public.students.
--      p_picture_url null => removal.  Non-null URLs must point at the
--      student-pictures bucket's public object namespace, so a student
--      cannot store an arbitrary link in the column.
--      Audit row keeps the 045 student contract: actor_id NULL (students
--      are not in public.adminprofiles, and audit_logs.actor_id ->>
--      adminprofiles(id) would 23503 otherwise).
--   4) Grants: revoke the default PUBLIC EXECUTE, grant to anon and
--      authenticated — student RPCs run under the anon PostgREST role
--      (028/036 precedent), and EXECUTE must never be public.

-- ---------------------------------------------------------------------
-- 1) Column
-- ---------------------------------------------------------------------
alter table public.students
  add column if not exists profile_picture_url text;

-- ---------------------------------------------------------------------
-- 2) Bucket + storage policies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-pictures', 'student-pictures', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "student pictures public read" on storage.objects;
create policy "student pictures public read" on storage.objects
  for select
  using (bucket_id = 'student-pictures');

-- No auth.uid() condition — same custom-auth relaxation 020 applied to
-- candidate-pictures; the RPC gates what URL is ever persisted.
drop policy if exists "student pictures public write" on storage.objects;
create policy "student pictures public write" on storage.objects
  for insert
  with check (bucket_id = 'student-pictures');

-- ---------------------------------------------------------------------
-- 3) update_my_profile_picture — the sole writer of the column
-- ---------------------------------------------------------------------
create or replace function public.update_my_profile_picture(p_picture_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_name text;
  v_result jsonb;
begin
  -- Actor derives ONLY from the session spine; no client-supplied id.
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Role gate: only a student session may touch a student picture row.
  if public.current_session_role() <> 'student' then
    raise exception 'Only students can update a student profile picture.';
  end if;

  if not exists (select 1 from public.students s where s.id = v_actor) then
    raise exception 'Student record not found.';
  end if;

  -- The client may only persist a URL from the student-pictures bucket's
  -- public object namespace — nothing arbitrary.
  if p_picture_url is not null
     and position('/storage/v1/object/public/student-pictures/' in p_picture_url) = 0 then
    raise exception 'Picture URL must be a student-pictures upload.';
  end if;

  update public.students
  set profile_picture_url = p_picture_url
  where id = v_actor;

  select first_name || ' ' || last_name into v_name
  from public.students where id = v_actor;

  -- 045 student contract: actor_id stays NULL (students are not in
  -- adminprofiles and audit_logs.actor_id references it).
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    null,
    coalesce(v_name, 'Student'),
    'student',
    case when p_picture_url is null
      then 'Profile Picture Removed' else 'Profile Picture Updated' end,
    case when p_picture_url is null
      then 'Removed profile picture'
      else 'Set profile picture' end,
    'info'
  );

  select row_to_json(s)::jsonb into v_result
  from public.students s where s.id = v_actor;
  return v_result;
end;
$$;

revoke all on function public.update_my_profile_picture(text) from public, anon, authenticated;
grant execute on function public.update_my_profile_picture(text) to anon, authenticated;
