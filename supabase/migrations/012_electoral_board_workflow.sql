-- Add campaign period and workflow state columns to election_periods
alter table public.election_periods
  add column if not exists campaign_start_at timestamptz,
  add column if not exists campaign_end_at timestamptz,
  add column if not exists official_list_posted boolean not null default false,
  add column if not exists plan_finalized boolean not null default false,
  add column if not exists proclaimed boolean not null default false,
  add column if not exists proclaimed_at timestamptz;

-- Proclamations table: stores official winners per position per election
create table if not exists public.proclamations (
  id uuid primary key default gen_random_uuid(),
  election_period_id uuid not null references public.election_periods(id) on delete cascade,
  winning_position text not null,
  candidate_id uuid not null references public.candidates(id),
  votes integer not null,
  proclaimed_by uuid references public.profiles(id),
  proclaimed_at timestamptz not null default now(),
  unique (election_period_id, winning_position)
);

alter table public.proclamations enable row level security;

drop policy if exists "proclamations admin all" on public.proclamations;
create policy "proclamations admin all" on public.proclamations
  for all using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

drop policy if exists "proclamations public select" on public.proclamations;
create policy "proclamations public select" on public.proclamations
  for select using (true);

-- RPC: Finalize election plan (locks schedule fields)
create or replace function public.finalize_election_plan_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can finalize the election plan.';
  end if;

  update public.election_periods
  set plan_finalized = true
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

-- RPC: Post official list of candidates
create or replace function public.post_official_list_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can post the official list.';
  end if;

  if not exists (
    select 1 from public.candidates
    where election_period_id = p_election_id and status = 'approved'
  ) then
    raise exception 'No approved candidates to post.';
  end if;

  update public.election_periods
  set official_list_posted = true
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

-- RPC: Open election (start voting)
create or replace function public.open_election_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record record;
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can open the election.';
  end if;

  select * into v_record
  from public.election_periods
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;

  if not v_record.plan_finalized then
    raise exception 'Election plan must be finalized before opening.';
  end if;

  if not v_record.official_list_posted then
    raise exception 'Official list of candidates must be posted before opening the election.';
  end if;

  if v_record.is_active then
    raise exception 'Election is already active.';
  end if;

  update public.election_periods
  set is_active = true
  where id = p_election_id;
end;
$$;

-- RPC: Close election (end voting)
create or replace function public.close_election_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can close the election.';
  end if;

  if not exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Election is not currently active.';
  end if;

  update public.election_periods
  set is_active = false
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

-- RPC: Publish results
create or replace function public.publish_results_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can publish results.';
  end if;

  if exists (select 1 from public.election_periods where id = p_election_id and is_active = true) then
    raise exception 'Cannot publish results while the election is still active.';
  end if;

  update public.election_periods
  set results_published = true
  where id = p_election_id;

  if not found then
    raise exception 'Election period not found.';
  end if;
end;
$$;

-- RPC: Proclaim winners (computes and stores winners per position)
create or replace function public.proclaim_winners_rpc(p_election_id uuid)
returns table (
  winning_position text,
  winner_name text,
  votes integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() != 'admin' then
    raise exception 'Only administrators can proclaim winners.';
  end if;

  if not exists (select 1 from public.election_periods where id = p_election_id and results_published = true) then
    raise exception 'Results must be published before proclaiming winners.';
  end if;

  delete from public.proclamations where election_period_id = p_election_id;

  insert into public.proclamations (election_period_id, winning_position, candidate_id, votes, proclaimed_by)
  select
    c.election_period_id,
    c.position,
    c.id,
    count(v.id)::integer as vote_count,
    auth.uid()
  from public.candidates c
  left join public.votes v on v.candidate_id = c.id
  where c.election_period_id = p_election_id
    and c.status = 'approved'
  group by c.election_period_id, c.position, c.id
  having count(v.id) = (
    select max(cnt) from (
      select count(v2.id) as cnt
      from public.candidates c2
      left join public.votes v2 on v2.candidate_id = c2.id
      where c2.election_period_id = p_election_id
        and c2.status = 'approved'
        and c2.position = c.position
      group by c2.id
    ) sub
  );

  update public.election_periods
  set proclaimed = true,
      proclaimed_at = now()
  where id = p_election_id;

  return query
  select
    p.winning_position,
    (c.given_name || ' ' || c.surname)::text as winner_name,
    p.votes
  from public.proclamations p
  join public.candidates c on c.id = p.candidate_id
  where p.election_period_id = p_election_id
  order by p.winning_position;
end;
$$;
