-- Run this in Supabase Dashboard > SQL Editor
-- Creates the missing login RPC functions needed by the app

create extension if not exists pgcrypto;

create or replace function public.login_admin_direct(p_email text, p_password text)
returns table (
  id uuid,
  role text,
  commissioner_role text,
  full_name text,
  email text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return query
  select p.id, p.role, p.commissioner_role, p.full_name, u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(p_email)
    and u.encrypted_password = crypt(p_password, u.encrypted_password::text)
  limit 1;
end;
$$;

create or replace function public.login_officer_direct(p_email text, p_password text)
returns table (
  id uuid,
  name text,
  email text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return query
  select o.id, o.name, o.email
  from auth.users u
  join public.officers o on o.auth_id = u.id
  where lower(u.email) = lower(p_email)
    and u.encrypted_password = crypt(p_password, u.encrypted_password::text)
  limit 1;
end;
$$;

create or replace function public.login_student_direct(p_email text, p_password_hash text)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.first_name, s.last_name, s.email, s.status
  from public.students s
  where lower(s.email) = lower(p_email)
    and s.password_hash = p_password_hash
  limit 1;
$$;
