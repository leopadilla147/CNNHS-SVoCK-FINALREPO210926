-- RPC to toggle commissioner active/inactive status
-- Only the Chief Commissioner can execute this
create or replace function public.update_commissioner_status(
  p_commissioner_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can update commissioner status.';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'Status must be either active or inactive.';
  end if;

  update public.commissioners
  set status = p_status
  where id = p_commissioner_id;

  if not found then
    raise exception 'Commissioner not found.';
  end if;
end;
$$;

-- RPC to reassign commissioner (replace existing commissioner of same role)
-- Only the Chief Commissioner can execute this
create or replace function public.replace_commissioner(
  p_name text,
  p_email text,
  p_role text,
  p_auth_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can replace commissioners.';
  end if;

  select id into v_existing_id
  from public.commissioners
  where commissioner_role = p_role;

  if v_existing_id is not null then
    update public.commissioners
    set status = 'inactive'
    where id = v_existing_id;
  end if;

  insert into public.commissioners (auth_id, name, email, commissioner_role, status)
  values (p_auth_id, p_name, p_email, p_role, 'active')
  returning id into v_new_id;

  return v_new_id;
end;
$$;
