-- Run this in Supabase Dashboard > SQL Editor
-- SECURITY DEFINER RPC for inserting audit logs
-- Bypasses RLS for custom-auth users (auth.uid() is null)

create or replace function public.insert_audit_log_rpc(
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default 'system',
  p_action text default null,
  p_details text default null,
  p_type text default 'info'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
begin
  v_actor_id := coalesce(p_actor_id, auth.uid());
  v_actor_name := coalesce(p_actor_name, 'System');

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (v_actor_id, v_actor_name, p_actor_role, p_action, p_details, p_type);
end;
$$;
