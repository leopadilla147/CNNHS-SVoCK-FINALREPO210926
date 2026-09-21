-- Run this in Supabase Dashboard > SQL Editor
-- Adds SSLG Adviser role and login support

-- Extend profiles role check to include sslg_adviser
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'officer', 'admin', 'sslg_adviser'));

-- Create sslg_advisers table
create table if not exists public.sslg_advisers (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.sslg_advisers enable row level security;

-- SSLG Adviser login RPC
create or replace function public.login_sslg_adviser_direct(p_email text, p_password text)
returns table (
  id uuid,
  name text,
  email text,
  status text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return query
  select a.auth_id as id, a.name, a.email, a.status
  from auth.users u
  join public.sslg_advisers a on a.auth_id = u.id
  where lower(u.email) = lower(p_email)
    and u.encrypted_password = crypt(p_password, u.encrypted_password::text)
  limit 1;
end;
$$;

-- RLS policies for sslg_advisers
drop policy if exists "sslg_advisers admin all" on public.sslg_advisers;
create policy "sslg_advisers admin all" on public.sslg_advisers for all
  using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

drop policy if exists "sslg_advisers self select" on public.sslg_advisers;
create policy "sslg_advisers self select" on public.sslg_advisers for select
  using (auth_id = auth.uid());