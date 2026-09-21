create or replace function public.update_admin_password(
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where id = auth.uid()
    and encrypted_password = public.crypt(p_current_password, encrypted_password);

  if v_user_id is null then
    return jsonb_build_object('success', false, 'message', 'Current password is incorrect.');
  end if;

  update auth.users
  set encrypted_password = public.crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = v_user_id;

  return jsonb_build_object('success', true);
end;
$$;
