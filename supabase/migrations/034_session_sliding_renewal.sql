-- =====================================================================
-- 034_session_sliding_renewal.sql
-- Phase 01, Plan 01-02 - Task 2 (sliding session renewal + ticket
-- exclusion) — D-06 / D-07 / D-08.
--
-- Run this in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- Design (D-06 / D-07 / D-08):
--   * D-06 lazy-touch renewal: every valid WEB session lookup slides
--     `expires_at` forward to `now() + 24 hours` (the designed lifetime),
--     so an active user is not logged out the moment the originally-minted
--     fixed 24h window lapses.  Zero client work — the slide rides on the
--     existing `session_identity()` lookup every authenticated web request
--     already performs.
--   * D-07 absolute cap: the slide is `least(created_at + interval
--     '7 days', now() + interval '24 hours')` — a stolen token cannot be
--     renewed indefinitely; even under continuous use it dies 7 days after
--     mint.
--   * D-08 kiosk ticket exclusion: `sessions.kind` (new column, default
--     'web') marks the 5-minute voter tickets minted by
--     `verify_student_credentials_rpc` (031) so they are NEVER slid; the
--     slide is gated to `kind = 'web'` rows only.
--
-- Drift note: re-running migration 031 AFTER 034 re-inserts ticket rows
-- WITHOUT the kind column, so they land with the DEFAULT 'web' and would
-- then slide on the next web lookup.  034 must therefore be re-applied
-- LAST after any 031 re-run.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) sessions.kind — 'web' (default) for normal login mints; 'ticket'
--    for the 5-minute voter tickets (D-08).  Safe to re-run.
-- ---------------------------------------------------------------------
alter table public.sessions add column if not exists kind text not null default 'web';

-- ---------------------------------------------------------------------
-- 2) session_identity() - same header parse + lookup + lazy purge as
--    022, plus the D-06/D-07 lazy-touch slide gated to web rows.  The
--    slide runs AFTER the expiry check/purge and BEFORE return query so
--    dead rows are purged and valid web rows renew on the same lookup.
-- ---------------------------------------------------------------------
create or replace function public.session_identity()
returns table (session_user_id uuid, session_user_role text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_authorization text;
  v_raw_token text;
  v_token_hash text;
  v_user_id uuid;
  v_user_role text;
  v_expires_at timestamptz;
  v_created_at timestamptz;
  v_kind text;
begin
  v_authorization := current_setting('request.headers', true)::jsonb ->> 'authorization';
  if v_authorization is null then
    return;
  end if;

  -- Accept only an explicit Bearer-token prefix; anything else means the
  -- caller is not presenting a session token at all.
  v_raw_token := regexp_replace(v_authorization, '^[Bb]earer\s+', '');
  if v_raw_token = v_authorization or length(v_raw_token) < 32 then
    return;
  end if;

  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  select s.user_id, s.user_role, s.expires_at, s.created_at, s.kind
    into v_user_id, v_user_role, v_expires_at, v_created_at, v_kind
    from public.sessions s
   where s.token_hash = v_token_hash;

  if v_user_id is null then
    return;
  end if;

  if v_expires_at <= now() then
    -- Lazy purge: the presented token is dead; drop the cold row.
    delete from public.sessions where token_hash = v_token_hash;
    return;
  end if;

  -- D-06/D-07/D-08 sliding renewal, web rows only: v_kind is null covers
  -- pre-034 rows; the coalesce in the WHERE is belt-and-braces.  Voter
  -- tickets (kind = 'ticket') keep their exact 5-minute deadline.
  if v_kind is null or v_kind = 'web' then
    update public.sessions
       set expires_at = least(created_at + interval '7 days', now() + interval '24 hours')
     where token_hash = v_token_hash and coalesce(kind, 'web') = 'web';
  end if;

  return query select v_user_id, v_user_role;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) verify_student_credentials_rpc - 031 body verbatim EXCEPT the ticket
--    INSERT now writes kind = 'ticket' so the 5-minute voter ticket is
--    excluded from the sliding renewal (D-08).  Signature unchanged — no
--    overload.  expires_at = now() + interval '5 minutes' untouched.
-- ---------------------------------------------------------------------
create or replace function public.verify_student_credentials_rpc(p_lrn text, p_password_sha256 text)
returns table (
  student_id uuid,
  first_name text,
  last_name text,
  voter_ticket text,
  expires_at timestamptz,
  has_voted boolean
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_student public.students;
  v_election_id uuid;
  v_voted boolean := false;
  v_raw text;
  v_hash text;
  v_expires timestamptz;
begin
  if p_lrn is null or p_password_sha256 is null then
    raise exception 'Missing student credentials';
  end if;

  select * into v_student
    from public.students s
   where s.lrn = p_lrn
     and s.status = 'approved'
   limit 1;

  if v_student.id is null then
    raise exception 'Student not found or not approved';
  end if;

  -- 023 D-10 branch shape: bcrypt-prefixed hashes verify via crypt();
  -- anything else (legacy 64-hex SHA-256; NULL) compares the recomputed
  -- SHA-256 the client sent.  The kiosk protocol presents the SHA-256 hex
  -- for BOTH branches (the stored bcrypt hash of a kiosk-native row is
  -- bcrypt(sha256hex); the equality branch covers not-yet-rehashed rows).
  if starts_with(coalesce(v_student.password_hash, ''), '$2') then
    if v_student.password_hash is distinct from crypt(p_password_sha256, v_student.password_hash) then
      raise exception 'Invalid password';
    end if;
  else
    if v_student.password_hash is distinct from p_password_sha256 then
      raise exception 'Invalid password';
    end if;
  end if;

  -- Already-voted flag is DETERMINISTIC and lives in this RPC (never in
  -- edge code): the ACTIVE election is the only one students can vote in.
  select e.id into v_election_id
    from public.election_periods e
   where e.is_active = true
   order by e.start_at desc nulls last
   limit 1;

  if v_election_id is not null then
    select exists (
      select 1
        from public.votes v
       where v.voter_id = v_student.id
         and v.election_period_id = v_election_id
    ) into v_voted;
  end if;

  if v_voted then
    student_id := v_student.id;
    first_name := v_student.first_name;
    last_name := v_student.last_name;
    voter_ticket := null;
    expires_at := null;
    has_voted := true;
    return next;
    return;
  end if;

  -- Mint the ADDITIONAL short-lived voter ticket (B-2).  Deliberately NOT
  -- issue_session_token: its delete-prior body would kill the student's
  -- active web session.  The ticket is an extra 5-minute session row.
  v_raw := gen_random_uuid()::text;
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  v_expires := now() + interval '5 minutes';

  insert into public.sessions (token_hash, user_id, user_role, expires_at, kind)
  values (v_hash, v_student.id, 'student', v_expires, 'ticket');

  student_id := v_student.id;
  first_name := v_student.first_name;
  last_name := v_student.last_name;
  voter_ticket := v_raw;
  expires_at := v_expires;
  has_voted := false;
  return next;
end;
$$;