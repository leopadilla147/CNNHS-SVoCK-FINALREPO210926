-- 073_admin_profile_picture.sql
-- Staff profile pictures (chief / commissioners / SSLG advisers).
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   072 gave students an optional photo; every staff surface (My Profile
--   card, header/sidebar/navbar avatar) still renders a letter circle for
--   admin and adviser accounts.  Staff identity lives in
--   public.adminprofiles (035), so this is the same optional photo one
--   table over — the counterpart of 072 and of the delete_profile_picture
--   edge function that ships alongside this file (one function serves
--   both the student and staff cleanup flows).
--
-- WHAT
--   1) adminprofiles.profile_picture_url text (nullable — the column IS
--      the "has a picture" flag; no default).
--   2) storage bucket 'admin-pictures' — public read, 2 MB, jpeg/png/webp,
--      mirroring 072's student-pictures setup.  The write policy carries
--      NO auth.uid() condition: the custom session-spine auth leaves
--      auth.uid() null on the storage path (020/072 precedent), and the
--      RPC below is what actually authorizes the saved URL — it refuses
--      anything that is not an admin-pictures object URL.
--      There is deliberately NO delete policy: storage cleanup goes
--      through the delete_profile_picture edge function (service role), so
--      an unscoped anon DELETE policy would only widen the attack surface.
--   3) update_my_admin_profile_picture(p_picture_url text) — the ONLY
--      write path to the column.  SECURITY DEFINER; the actor derives
--      exclusively from current_session_user_id() (036 AUTH-05 contract,
--      no client-supplied actor id anywhere).  Role gate: the session
--      role must be 'admin' or 'sslg_adviser' and the actor must exist in
--      public.adminprofiles.  p_picture_url null => removal.  Non-null
--      URLs must point at the admin-pictures bucket's public object
--      namespace, so a staff session cannot store an arbitrary link.
--      Audit row carries a REAL actor_id — unlike students (072), staff
--      rows exist in adminprofiles, so audit_logs.actor_id ->
--      adminprofiles(id) holds; actor_role stays inside the 027 CHECK set
--      ('admin' | 'sslg_adviser').
--   4) get_current_profile_rpc gains a profile_picture_url OUT column on
--      BOTH branches.  DROP first: PostgreSQL refuses CREATE OR REPLACE
--      across a return-type change (42P13, 030/035 precedent).  The
--      student branch returns it too so the public Navbar can read one
--      field off currentUser regardless of role; the students-list lookup
--      in Header/Sidebar stays the live source for students (an upload
--      updates the students array, not currentUser).
--   5) Grants: revoke the default PUBLIC EXECUTE, grant to anon and
--      authenticated — staff/student RPCs run under the anon PostgREST
--      role (028/036 precedent), and EXECUTE must never be public.

-- ---------------------------------------------------------------------
-- 1) Column
-- ---------------------------------------------------------------------
alter table public.adminprofiles
  add column if not exists profile_picture_url text;

-- ---------------------------------------------------------------------
-- 2) Bucket + storage policies (072 mirror; insert-only on purpose)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('admin-pictures', 'admin-pictures', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin pictures public read" on storage.objects;
create policy "admin pictures public read" on storage.objects
  for select
  using (bucket_id = 'admin-pictures');

-- No auth.uid() condition — same custom-auth relaxation 020/072 applied;
-- the RPC gates what URL is ever persisted.  Insert-only: deletion is the
-- delete_profile_picture edge function's job (service role, ownership +
-- reference checks server-side).
drop policy if exists "admin pictures public write" on storage.objects;
create policy "admin pictures public write" on storage.objects
  for insert
  with check (bucket_id = 'admin-pictures');

-- ---------------------------------------------------------------------
-- 3) update_my_admin_profile_picture — the sole writer of the column
-- ---------------------------------------------------------------------
create or replace function public.update_my_admin_profile_picture(p_picture_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_name text;
  v_result jsonb;
begin
  -- Actor derives ONLY from the session spine; no client-supplied id.
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Role gate: staff sessions only (035 session roles).  Students are
  -- refused here as well by the adminprofiles membership test below.
  v_role := public.current_session_role();
  if v_role not in ('admin', 'sslg_adviser') then
    raise exception 'Only staff can update a staff profile picture.';
  end if;

  if not exists (select 1 from public.adminprofiles a where a.id = v_actor) then
    raise exception 'Profile not found.';
  end if;

  -- The client may only persist a URL from the admin-pictures bucket's
  -- public object namespace — nothing arbitrary.
  if p_picture_url is not null
     and position('/storage/v1/object/public/admin-pictures/' in p_picture_url) = 0 then
    raise exception 'Picture URL must be an admin-pictures upload.';
  end if;

  update public.adminprofiles
  set profile_picture_url = p_picture_url
  where id = v_actor;

  select full_name into v_name
  from public.adminprofiles where id = v_actor;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    coalesce(v_name, 'Staff'),
    v_role,
    case when p_picture_url is null
      then 'Profile Picture Removed' else 'Profile Picture Updated' end,
    case when p_picture_url is null
      then 'Removed profile picture'
      else 'Set profile picture' end,
    'info'
  );

  select row_to_json(a)::jsonb into v_result
  from public.adminprofiles a where a.id = v_actor;
  return v_result;
end;
$$;

revoke all on function public.update_my_admin_profile_picture(text) from public, anon, authenticated;
grant execute on function public.update_my_admin_profile_picture(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) get_current_profile_rpc — + profile_picture_url OUT column
--    (DROP first: return-type change, 42P13 — 030/035 precedent.)
-- ---------------------------------------------------------------------
drop function if exists public.get_current_profile_rpc();

create or replace function public.get_current_profile_rpc()
returns table (
  id uuid,
  role text,
  commissioner_role text,
  full_name text,
  email text,
  profile_picture_url text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_user_role text;
begin
  select session_user_id, session_user_role into v_user_id, v_user_role
    from public.session_identity();

  if v_user_id is null then
    return;
  end if;

  if v_user_role = 'student' then
    return query
      select s.id, 'student'::text, null::text,
             s.first_name || ' ' || s.last_name, s.email,
             s.profile_picture_url
        from public.students s
       where s.id = v_user_id;
  else
    return query
      select a.id, a.role_type, a.commissioner_role, a.full_name,
             coalesce(u.email::text, a.email),
             a.profile_picture_url
        from public.adminprofiles a
        left join auth.users u on u.id = a.auth_id
       where a.id = v_user_id;
  end if;
end;
$$;

revoke all on function public.get_current_profile_rpc() from public;
grant execute on function public.get_current_profile_rpc() to anon, authenticated;
