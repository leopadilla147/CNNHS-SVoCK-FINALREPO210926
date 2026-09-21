-- Run this in Supabase Dashboard > SQL Editor
-- Creates a security definer RPC for inserting audit logs,
-- bypassing RLS so custom-auth users can write logs.

create or replace function public.insert_audit_log(
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_action text,
  p_details text,
  p_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (p_actor_id, p_actor_name, p_actor_role, p_action, p_details, p_type);
end;
$$;
