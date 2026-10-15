-- =====================================================================
-- 050_atomic_ballot_transaction_id.sql
-- Database-backed, concurrency-safe sequential transaction ID generator
-- for the CNNHS SVoCK voting kiosks.
--
-- Format: TXN-YYMMDD-0001 (4-digit zero-padded sequential number per day).
--
-- Features:
--   1. Sequence table public.transaction_sequences holds day-scoped counters.
--   2. Atomic advisory lock + greatest(last_seq, max_existing_votes) prevents
--      collisions when two kiosks submit votes concurrently.
--   3. Checks public.votes to ensure the sequence strictly continues from
--      the highest existing number in the database for that date.
--   4. Trigger on public.votes prevents cross-voter transaction ID collisions
--      while preserving multi-row ballots for the same voter.
--   5. Idempotent: safe to run in Supabase SQL Editor.
-- =====================================================================

set search_path = public, extensions;

-- 1. Counter table for daily sequential numbering
create table if not exists public.transaction_sequences (
    date_key text primary key,
    last_seq integer not null default 0,
    updated_at timestamptz not null default now()
);

alter table public.transaction_sequences enable row level security;

-- Read access policy
drop policy if exists "transaction_sequences read all" on public.transaction_sequences;
create policy "transaction_sequences read all"
    on public.transaction_sequences
    for select
    using (true);

-- 2. Concurrency-safe atomic transaction ID generator
create or replace function public.generate_next_transaction_id(
    p_date_key text default null,
    p_voter_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_date text;
    v_seq integer;
    v_max_existing integer;
    v_existing_txn text;
begin
    -- Check if this voter already has an assigned transaction_id in public.votes
    if p_voter_id is not null then
        select transaction_id into v_existing_txn
        from public.votes
        where voter_id = p_voter_id
          and transaction_id is not null
        limit 1;

        if v_existing_txn is not null then
            return v_existing_txn;
        end if;
    end if;

    -- Determine date key (YYMMDD in Asia/Manila)
    if p_date_key is not null and trim(p_date_key) ~ '^[0-9]{6}$' then
        v_date := trim(p_date_key);
    else
        v_date := to_char(current_timestamp at time zone 'Asia/Manila', 'YYMMDD');
    end if;

    -- Acquire an atomic advisory transaction lock on the date key to serialize concurrent kiosk requests
    perform pg_advisory_xact_lock(hashtext('txn_seq_' || v_date));

    -- Inspect public.votes for the highest existing sequential number for this date
    select coalesce(
        max(
            case 
                when transaction_id ~ ('^TXN-' || v_date || '-[0-9]+$')
                then substring(transaction_id from '-([0-9]+)$')::integer
                else 0
            end
        ), 0
    )
    into v_max_existing
    from public.votes
    where transaction_id like ('TXN-' || v_date || '-%');

    -- Ensure the sequence row exists
    insert into public.transaction_sequences (date_key, last_seq, updated_at)
    values (v_date, v_max_existing, now())
    on conflict (date_key) do nothing;

    -- Atomically assign next sequence strictly based on actual votes in database.
    -- If votes were cleared or deleted, reset directly to v_max_existing + 1.
    -- Otherwise, safely increment from whichever is currently higher.
    update public.transaction_sequences
    set last_seq = case
            when last_seq < v_max_existing then v_max_existing + 1
            when v_max_existing = 0 then 1
            when last_seq > v_max_existing + 20 then v_max_existing + 1
            else greatest(last_seq, v_max_existing) + 1
        end,
        updated_at = now()
    where date_key = v_date
    returning last_seq into v_seq;

    return 'TXN-' || v_date || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- 3. Read-only inspector function to check the current highest transaction ID for a date
create or replace function public.get_highest_transaction_id(p_date_key text default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_date text;
    v_max integer;
begin
    if p_date_key is not null and trim(p_date_key) ~ '^[0-9]{6}$' then
        v_date := trim(p_date_key);
    else
        v_date := to_char(current_timestamp at time zone 'Asia/Manila', 'YYMMDD');
    end if;

    select coalesce(
        max(
            case 
                when transaction_id ~ ('^TXN-' || v_date || '-[0-9]+$')
                then substring(transaction_id from '-([0-9]+)$')::integer
                else 0
            end
        ), 0
    )
    into v_max
    from public.votes
    where transaction_id like ('TXN-' || v_date || '-%');

    if v_max = 0 then
        return null;
    end if;

    return 'TXN-' || v_date || '-' || lpad(v_max::text, 4, '0');
end;
$$;

-- 4. Cross-voter transaction uniqueness constraint trigger on public.votes
create or replace function public.check_vote_transaction_unique()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_other_voter uuid;
begin
    if NEW.transaction_id is not null then
        select voter_id into v_other_voter
        from public.votes
        where transaction_id = NEW.transaction_id
          and voter_id <> NEW.voter_id
        limit 1;

        if v_other_voter is not null then
            raise exception 'Transaction ID % is already assigned to another voter', NEW.transaction_id
                using errcode = '23505';
        end if;
    end if;
    return NEW;
end;
$$;

drop trigger if exists trg_check_vote_transaction_unique on public.votes;
create trigger trg_check_vote_transaction_unique
before insert or update of transaction_id, voter_id on public.votes
for each row
execute function public.check_vote_transaction_unique();

-- 5. Grant execute permissions to anon and authenticated kiosk clients
grant execute on function public.generate_next_transaction_id(text, uuid) to anon, authenticated, service_role;
grant execute on function public.get_highest_transaction_id(text) to anon, authenticated, service_role;