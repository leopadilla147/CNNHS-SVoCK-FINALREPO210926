-- =====================================================================
-- 032_vote_receipts_and_ledger_models.sql
-- Phase 05, Plan 05-03 - Task 3 (vote_receipts + ledger + submit_vote_rpc
-- + verify_receipt_rpc + service-role invariant; sync_kiosk_votes_rpc)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
--
-- Ships (D-06 / D-07 / D-08 / R6 / W-1; INTG-01/INTG-02):
--   * vote_receipts — immutable-by-construction receipt rows written by
--     an AFTER INSERT trigger on votes INSIDE the vote transaction
--     (exception-safe: a nested block RAISES DEBUG on relentless unique
--     collisions, never rolls back the vote).  receipt_code is a
--     server-generated 10-char Crockford base32 value (opaque,
--     non-sequential; VVSG 2.0 Guideline 10.2); code_hash is its SHA-256
--     (the committed value — D-07).  The plaintext code is display-only.
--     RLS deny-all + REVOKE update/delete: the ONLY read path is
--     verify_receipt_rpc (D-06 immutability contract).
--   * sync_kiosk_votes_rpc — the kiosk sync's ATOMIC core (B-3): inserts
--     votes rows with ticket-derived voter + device kiosk + a deterministic
--     per-selection transaction_id (SHA-256 of the offlineVoteId — D-06
--     replay idempotence at constraint level via the 031 unique index) and
--     flips the matching kiosk_vote_queue rows pending -> synced in the
--     SAME transaction.  PostgREST edge functions cannot span statements,
--     so the security-definer RPC is the contract carrier; kiosk_vote
--     resolves tokens and maps counts.  Returns inserted/replayed/
--     queued_marks_skipped/vote_ids.
--   * submit_vote_rpc — the WEB cast surface (W-1), security definer.
--     Resolves the voter FROM THE SESSION (sha256 token_hash; user_role
--     IN ('student','kiosk') — kiosk uses the short ticket from 031,
--     student uses the web session): voter_id + kiosk_id come from the
--     session (+ device join for kiosk sessions), NEVER from the payload.
--     Server generates the transaction_id per selection (deterministic:
--     SHA-256 of token+':'+position) so a replay with the SAME session
--     token creates no duplicate votes (031 unique index); the receipts
--     array is returned ONCE.  Already-voted voters (votes from another
--     token/route) get a deterministic error.
--   * verify_receipt_rpc — anon-granted receipt lookup.  Pre-release it
--     returns the stored receipt row + code_hash (plaintext code is
--     display-only); post-release (05-05 publish) content is identical
--     (D-06/D-07).
--   * R6 — the permissive 001:582 'votes kiosk insert' client policy is
--     dropped: client roles keep ONLY submit_vote_rpc's definer path, the
--     service-role kiosk sync path keeps its server-side rights (bypasses
--     RLS), and 002_login_contract_test.sql's 4d todo flips to a hard
--     assertion (count=0) in the same commit.
--
-- 001-031 bodies are NEVER edited (D-26); 032 is additive.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) vote_receipts — immutable receipt ledger (D-06/D-07)
-- ---------------------------------------------------------------------
create table if not exists public.vote_receipts (
  vote_id uuid primary key references public.votes(id) on delete cascade,
  receipt_code text not null unique,
  code_hash text not null unique,
  election_period_id uuid not null references public.election_periods(id),
  "position" text not null,
  candidate_id uuid references public.candidates(id),
  timestamp timestamptz not null default now()
);

alter table public.vote_receipts enable row level security;

-- Receipts are never read directly by clients: verify_receipt_rpc is the
-- only read path (D-07).  Writes are trigger-only.
drop policy if exists "vote receipts no client read" on public.vote_receipts;
create policy "vote receipts no client read" on public.vote_receipts for select using (false);

revoke update, delete on public.vote_receipts from anon, authenticated;
revoke select on public.vote_receipts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) generate_vote_receipt_code() — 10-char Crockford base32, opaque
-- ---------------------------------------------------------------------
create or replace function public.generate_vote_receipt_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  -- Crockford base32 alphabet (excludes I, L, O, U).
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text := '';
  v_bytes bytea;
  v_len constant int := 10;
  i int;
begin
  -- 64 random bits cover 10 x 5-bit chars (50 bits).
  v_bytes := gen_random_bytes(8);
  for i in 0 .. v_len - 1 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) generate_vote_receipt() — AFTER INSERT trigger on votes (D-06).
--    Exception-safe: receipt generation is wrapped in a nested block so a
--    failure (e.g. a relentless unique collision) RAISES DEBUG and returns
--    new — the vote is NEVER rolled back.  Up to 5 collision retries.
-- ---------------------------------------------------------------------
create or replace function public.generate_vote_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_code_hash text;
  v_attempt int := 0;
  v_max_attempts constant int := 5;
begin
  loop
    v_attempt := v_attempt + 1;
    begin
      v_code := public.generate_vote_receipt_code();
      v_code_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');
      insert into public.vote_receipts
        (vote_id, receipt_code, code_hash, election_period_id, "position", candidate_id)
      values
        (new.id, v_code, v_code_hash, new.election_period_id, new."position", new.candidate_id);
      exit;
    exception when unique_violation then
      if v_attempt >= v_max_attempts then
        raise debug 'vote_receipts: could not allocate a unique receipt code after % attempts (vote % kept)', v_attempt, new.id;
        return new;
      end if;
    end;
  end loop;
  return new;
end;
$$;

drop trigger if exists on_vote_insert_charge_receipt on public.votes;
create trigger on_vote_insert_charge_receipt
  after insert on public.votes
  for each row execute function public.generate_vote_receipt();

-- ---------------------------------------------------------------------
-- 4) sync_kiosk_votes_rpc — the kiosk sync's atomic core (B-3/D-06).
--    Caller: kiosk_vote edge fn with a resolved voter ticket + device.
--    One transaction: votes inserts (ON CONFLICT (transaction_id) DO
--    NOTHING) + the queue pending -> synced flip with synced_at.
-- ---------------------------------------------------------------------
create or replace function public.sync_kiosk_votes_rpc(
  p_voter_id uuid,
  p_kiosk_id uuid,
  p_election_period_id uuid,
  p_selections jsonb
)
returns table (
  inserted int,
  replayed int,
  queued_marks_skipped int,
  vote_ids uuid[]
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_selection jsonb;
  v_position text;
  v_candidate_id uuid;
  v_abstained boolean;
  v_offline_id text;
  v_tx_id text;
  v_inserted_id uuid;
  v_tx_ids text[] := '{}';
  v_offline_ids text[] := '{}';
  v_vote_ids uuid[] := '{}';
  v_inserted int := 0;
  v_replayed int := 0;
  v_skipped int := 0;
begin
  if p_voter_id is null or p_kiosk_id is null or p_election_period_id is null or p_selections is null then
    raise exception 'Missing sync parameters';
  end if;

  if jsonb_typeof(p_selections) <> 'array' then
    raise exception 'selections must be an array';
  end if;

  -- Pass 1: derive the deterministic per-selection transaction ids so the
  -- already-voted pre-check can distinguish THIS ballot from foreign ones.
  for v_selection in select * from jsonb_array_elements(p_selections) loop
    v_offline_id := v_selection ->> 'offlineVoteId';
    if v_offline_id is null or v_offline_id = '' then
      raise exception 'Every sync selection must carry an offlineVoteId (replay anchor)';
    end if;
    v_tx_ids := array_append(v_tx_ids, encode(sha256(convert_to(v_offline_id, 'UTF8')), 'hex'));
    v_offline_ids := array_append(v_offline_ids, v_offline_id);
  end loop;

  -- Already-voted gate: the voter has votes in this election that are not
  -- part of THIS ballot's replay set (deterministic, B-2).
  if exists (
    select 1
      from public.votes v
     where v.voter_id = p_voter_id
       and v.election_period_id = p_election_period_id
       and (v.transaction_id is null or not (v.transaction_id = any (v_tx_ids)))
  ) then
    raise exception 'You have already voted in this election';
  end if;

  -- Pass 2: insert each selection; replay idempotence at constraint level.
  for v_selection in select * from jsonb_array_elements(p_selections) loop
    v_offline_id := v_selection ->> 'offlineVoteId';
    v_position := v_selection ->> 'position';
    if v_position is null then
      raise exception 'Every sync selection must carry a position';
    end if;
    v_candidate_id := (v_selection ->> 'candidateId')::uuid;
    v_abstained := coalesce((v_selection ->> 'abstained')::boolean, false);
    if v_abstained then
      v_candidate_id := null;
    end if;
    v_tx_id := encode(sha256(convert_to(v_offline_id, 'UTF8')), 'hex');

    insert into public.votes
      (election_period_id, voter_id, candidate_id, "position", kiosk_id, offline_vote_id, transaction_id, abstained)
    values
      (p_election_period_id, p_voter_id, v_candidate_id, v_position, p_kiosk_id, v_offline_id, v_tx_id, v_abstained)
    on conflict (transaction_id) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is not null then
      v_inserted := v_inserted + 1;
      v_vote_ids := array_append(v_vote_ids, v_inserted_id);
    else
      v_replayed := v_replayed + 1;
    end if;
    v_inserted_id := null;
  end loop;

  -- Queue lifecycle flip (B-3), SAME transaction: rows already 'synced'
  -- are skipped (counted, not re-flipped).
  select count(*)::int into v_skipped
    from public.kiosk_vote_queue q
   where q.election_period_id = p_election_period_id
     and q.offline_vote_id = any (v_offline_ids)
     and q.conflict_status = 'synced';

  update public.kiosk_vote_queue q
     set conflict_status = 'synced',
         synced_at = now()
   where q.election_period_id = p_election_period_id
     and q.offline_vote_id = any (v_offline_ids)
     and q.conflict_status <> 'synced';

  inserted := v_inserted;
  replayed := v_replayed;
  queued_marks_skipped := v_skipped;
  vote_ids := v_vote_ids;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) submit_vote_rpc — the WEB cast surface (W-1, D-06).  Session-derived
--    identity only; deterministic per-selection transaction ids make
--    same-token replays idempotent; the receipts array is returned once.
-- ---------------------------------------------------------------------
create or replace function public.submit_vote_rpc(p_session_token text, p_selections jsonb)
returns table (
  vote_id uuid,
  receipt_code text,
  code_hash text,
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  timestamp timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
  v_session public.sessions;
  v_voter_id uuid;
  v_kiosk_id uuid;
  v_election_id uuid;
  v_selection jsonb;
  v_position text;
  v_candidate_id uuid;
  v_abstained boolean;
  v_tx_id text;
  v_inserted_id uuid;
  v_tx_ids text[] := '{}';
begin
  if p_session_token is null or p_selections is null then
    raise exception 'Missing session token or selections';
  end if;

  if jsonb_typeof(p_selections) <> 'array' then
    raise exception 'selections must be an array';
  end if;

  v_token_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  -- Resolve the session: web session (student) or the 031 voter ticket
  -- (kiosk path — the ticket is also a student-role session row).
  select * into v_session
    from public.sessions s
   where s.token_hash = v_token_hash
     and s.user_role in ('student', 'kiosk')
     and s.expires_at > now()
   limit 1;

  if v_session.user_id is null then
    raise exception 'Invalid or expired session token';
  end if;

  -- voter_id comes FROM THE SESSION — never from the payload.  kiosk
  -- device sessions resolve their kiosk_id via the auth_id join; ticket
  -- sessions (user_role 'student') carry no device.
  v_voter_id := v_session.user_id;

  if v_session.user_role = 'kiosk' then
    select d.id into v_kiosk_id
      from public.kiosk_devices d
     where d.auth_id = v_session.user_id::text
     limit 1;
  end if;

  select e.id into v_election_id
    from public.election_periods e
   where e.is_active = true
   order by e.start_at desc nulls last
   limit 1;

  if v_election_id is null then
    raise exception 'No active election period';
  end if;

  -- Pass 1: deterministic transaction ids (replay anchor) + already-voted
  -- pre-check (votes from another token/route are NEVER re-inserted).
  for v_selection in select * from jsonb_array_elements(p_selections) loop
    v_position := v_selection ->> 'position';
    if v_position is null then
      continue;
    end if;
    v_tx_ids := array_append(v_tx_ids, encode(sha256(convert_to(p_session_token || ':' || v_position, 'UTF8')), 'hex'));
  end loop;

  if exists (
    select 1
      from public.votes v
     where v.voter_id = v_voter_id
       and v.election_period_id = v_election_id
       and (v.transaction_id is null or not (v.transaction_id = any (v_tx_ids)))
  ) then
    raise exception 'You have already voted in this election';
  end if;

  -- Pass 2: insert; same-token replays hit ON CONFLICT (transaction_id)
  -- DO NOTHING and are then re-read from vote_receipts below.
  for v_selection in select * from jsonb_array_elements(p_selections) loop
    v_position := v_selection ->> 'position';
    if v_position is null then
      continue;
    end if;
    v_candidate_id := (v_selection ->> 'candidateId')::uuid;
    v_abstained := coalesce((v_selection ->> 'abstained')::boolean, false);
    if v_abstained then
      v_candidate_id := null;
    end if;
    v_tx_id := encode(sha256(convert_to(p_session_token || ':' || v_position, 'UTF8')), 'hex');

    insert into public.votes
      (election_period_id, voter_id, candidate_id, "position", kiosk_id, transaction_id, abstained)
    values
      (v_election_id, v_voter_id, v_candidate_id, v_position, v_kiosk_id, v_tx_id, v_abstained)
    on conflict (transaction_id) do nothing
    returning id into v_inserted_id;

    v_inserted_id := null;
  end loop;

  -- The receipts array — shown once, and re-fetched on a same-token replay
  -- (the client never re-submits blindly; a replay simply returns the same
  -- receipts, D-06 no-multiple-trips).
  if v_tx_ids is not null then
    return query
      select vr.vote_id, vr.receipt_code, vr.code_hash, vr.election_period_id,
             vr."position", vr.candidate_id, vr.timestamp
        from public.vote_receipts vr
        join public.votes v on v.id = vr.vote_id
       where v.transaction_id = any (v_tx_ids)
         and v.voter_id = v_voter_id
       order by vr."position";
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) verify_receipt_rpc — anon receipt lookup (D-07).  Pre-release the
--    row + code_hash are returned; the plaintext code is display-only.
-- ---------------------------------------------------------------------
create or replace function public.verify_receipt_rpc(p_receipt_code text)
returns table (
  vote_id uuid,
  receipt_code text,
  code_hash text,
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  timestamp timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select vr.vote_id, vr.receipt_code, vr.code_hash, vr.election_period_id,
         vr."position", vr.candidate_id, vr.timestamp
    from public.vote_receipts vr
   where vr.receipt_code = p_receipt_code
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- 7) R6 — the client direct-insert path is removed.  The permissive
--    001:582 policy ('votes kiosk insert' with current_app_role =
--    'student') is DROPPED; client roles keep ONLY submit_vote_rpc's
--    security-definer path.  The service-role kiosk sync path keeps its
--    server-side rights (service_role bypasses RLS; no policy needed).
--    002_login_contract_test.sql 4d flips to a hard assertion alongside
--    (count of this policy = 0).
-- ---------------------------------------------------------------------
drop policy if exists "votes kiosk insert" on public.votes;

-- ---------------------------------------------------------------------
-- 8) Grants — least privilege (020/023 pattern), re-asserted idempotently.
--    The web/ticket submit + receipt lookup run pre-session under anon;
--    the kiosk edge fn reaches its RPCs via the service role (explicitly
--    granted here so the edge path is deterministic, not default-privilege
--    dependent).
-- ---------------------------------------------------------------------
revoke all on function public.submit_vote_rpc(text, jsonb) from public;
grant execute on function public.submit_vote_rpc(text, jsonb) to anon, authenticated;

revoke all on function public.verify_receipt_rpc(text) from public, authenticated;
grant execute on function public.verify_receipt_rpc(text) to anon;

revoke all on function public.sync_kiosk_votes_rpc(uuid, uuid, uuid, jsonb) from public, authenticated;
grant execute on function public.sync_kiosk_votes_rpc(uuid, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.sync_kiosk_votes_rpc(uuid, uuid, uuid, jsonb) to service_role;

-- Edge gateway reach (05-03 T2 rewrite): the kiosk_vote fn calls the 031
-- verifiers with the service-role admin client — make that deterministic.
revoke all on function public.verify_kiosk_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_kiosk_credentials_rpc(text, text) to anon, authenticated;
grant execute on function public.verify_kiosk_credentials_rpc(text, text) to service_role;

revoke all on function public.verify_student_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to anon, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to service_role;