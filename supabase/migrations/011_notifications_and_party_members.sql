-- Notifications table: one notification per recipient
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null check (role in ('student', 'admin', 'officer', 'sslg_adviser', 'commissioner')),
  type text not null check (type in (
    'candidacy_pending',
    'candidacy_approved',
    'candidacy_rejected',
    'official_list_posted',
    'nomination_received',
    'nomination_status_changed',
    'party_membership_request',
    'party_membership_approved',
    'party_membership_rejected',
    'student_registered',
    'student_approved',
    'student_rejected',
    'complaint_filed',
    'complaint_resolved',
    'election_opened',
    'election_closed',
    'results_published',
    'submitted_to_chief',
    'admin_notification'
  )),
  title text not null,
  message text not null,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications own all" on public.notifications;
create policy "notifications own all"
  on public.notifications
  for all
  using (user_id = auth.uid() or public.current_app_role() = 'admin')
  with check (user_id = auth.uid() or public.current_app_role() = 'admin');

-- Party members table: tracks membership requests/status
create table if not exists public.party_members (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.students(id),
  reviewed_at timestamptz,
  unique (party_id, student_id)
);

alter table public.party_members enable row level security;

drop policy if exists "party_members read own" on public.party_members;
create policy "party_members read own"
  on public.party_members
  for select
  using (
    student_id in (select id from public.students where student_id = auth.uid() or email = auth.email())
    or public.current_app_role() = 'admin'
  );

drop policy if exists "party_members insert own" on public.party_members;
create policy "party_members insert own"
  on public.party_members
  for insert
  with check (true);

drop policy if exists "party_members update admin president" on public.party_members;
create policy "party_members update admin president"
  on public.party_members
  for update
  using (public.current_app_role() = 'admin')
  with check (true);

-- RPC: request party membership
create or replace function public.request_party_membership_rpc(
  p_party_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_party_name text;
  v_president_id uuid;
  v_member_id uuid;
begin
  -- Get party info
  select name, president_student_id into v_party_name, v_president_id
  from public.parties
  where id = p_party_id;

  if not found then
    raise exception 'Party not found.';
  end if;

  -- Check if already a member or pending
  if exists (
    select 1 from public.party_members
    where party_id = p_party_id
      and student_id = p_student_id
      and status in ('pending', 'approved')
  ) then
    raise exception 'You already have a pending or approved membership request for this party.';
  end if;

  -- Insert membership request
  insert into public.party_members (party_id, student_id, status)
  values (p_party_id, p_student_id, 'pending')
  returning id into v_member_id;

  -- Notify party president if exists
  if v_president_id is not null then
    insert into public.notifications (user_id, role, type, title, message, link)
    values (
      v_president_id,
      'student',
      'party_membership_request',
      'New Party Membership Request',
      'A student has requested to join ' || v_party_name,
      '/student/dashboard'
    );
  end if;

  select row_to_json(pm)::jsonb into v_result
  from public.party_members pm where pm.id = v_member_id;
  return v_result;
end;
$$;

-- RPC: review party membership (approve/reject)
create or replace function public.review_party_membership_rpc(
  p_member_id uuid,
  p_action text,
  p_reviewer_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_member record;
  v_party_name text;
  v_student_name text;
  v_new_status text;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'Action must be approve or reject.';
  end if;

  v_new_status := case when p_action = 'approve' then 'approved' else 'rejected' end;

  select pm.*, s.first_name, s.last_name into v_member
  from public.party_members pm
  join public.students s on s.id = pm.student_id
  where pm.id = p_member_id;

  if not found then
    raise exception 'Membership request not found.';
  end if;

  if v_member.status != 'pending' then
    raise exception 'This request has already been reviewed.';
  end if;

  select name into v_party_name
  from public.parties
  where id = v_member.party_id;

  update public.party_members
  set status = v_new_status,
      reviewed_by = p_reviewer_student_id,
      reviewed_at = now()
  where id = p_member_id;

  v_student_name := v_member.first_name || ' ' || v_member.last_name;

  -- Notify the requesting student
  insert into public.notifications (user_id, role, type, title, message, link)
  values (
    v_member.student_id,
    'student',
    case when p_action = 'approve' then 'party_membership_approved' else 'party_membership_rejected' end,
    case when p_action = 'approve' then 'Membership Approved' else 'Membership Rejected' end,
    case when p_action = 'approve'
      then 'Your request to join ' || v_party_name || ' has been approved.'
      else 'Your request to join ' || v_party_name || ' has been rejected.'
    end,
    '/student/dashboard'
  );

  select row_to_json(pm)::jsonb into v_result
  from public.party_members pm where pm.id = p_member_id;
  return v_result;
end;
$$;

-- RPC: insert notification (called from app)
create or replace function public.insert_notification_rpc(
  p_user_id uuid,
  p_role text,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  insert into public.notifications (user_id, role, type, title, message, link)
  values (p_user_id, p_role, p_type, p_title, p_message, p_link)
  returning id into v_id;

  select row_to_json(n)::jsonb into v_result
  from public.notifications n where n.id = v_id;
  return v_result;
end;
$$;

-- RPC: mark notification as read
create or replace function public.mark_notification_read_rpc(
  p_notification_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set is_read = true
  where id = p_notification_id
    and (user_id = auth.uid() or public.current_app_role() = 'admin');
$$;

-- RPC: mark all notifications as read for current user
create or replace function public.mark_all_notifications_read_rpc(
  p_user_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set is_read = true
  where user_id = p_user_id and is_read = false;
$$;
