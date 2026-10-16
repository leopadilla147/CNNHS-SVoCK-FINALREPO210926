-- =====================================================================
-- 049_verify_student_bcrypt_compat.sql
-- Make the kiosk student verifier read BOTH the old and the new password
-- hash formats, matching the website's login_student_direct_v2 branch.
--
-- Background
--   The website now creates/upgrades passwords to bcrypt of the PLAINTEXT
--   (crypt(password, gen_salt('bf',10))).  The kiosk previously sent only
--   the client-side SHA-256 hex and its bcrypt branch compared against
--   bcrypt(sha256hex) — a format the website never produces — so any
--   password rehashed or reset through the website failed at the kiosk.
--   bcrypt is one-way, so the kiosk must send the plaintext (over TLS,
--   exactly as the website login does) for the server to verify it.
--
-- Contract preserved from 036/034: signature shape (text, text), returns
-- table, has_voted flag, 5-minute voter ticket mint, and grants.  The
-- second argument is now the PLAINTEXT password (was p_password_sha256),
-- so the input parameter is renamed — hence the explicit DROP first
-- (CREATE OR REPLACE cannot rename an input parameter).
--
-- Verify branch:
--   * '$2'-prefixed (bcrypt) rows:
--       - crypt(plaintext, hash)            -> NEW  bcrypt(plaintext)
--       - crypt(sha256hex(plaintext), hash) -> OLD  bcrypt(sha256hex)  [kiosk-native]
--   * anything else (legacy 64-hex; NULL): hash = sha256hex(plaintext)
-- On a successful OLD-format match the row is transparently upgraded to
-- bcrypt(plaintext) (same D-11/D-27 behavior as website login).
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: the USER applies this; the executor never touches live DB.
-- =====================================================================

set search_path = public, extensions;

drop function if exists public.verify_student_credentials_rpc(text, text);

create or replace function public.verify_student_credentials_rpc(p_lrn text, p_password text)
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
  v_sha text;
  v_raw text;
  v_hash text;
  v_expires timestamptz;
  v_matched_legacy boolean := false;
begin
  if p_lrn is null or p_password is null then
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

  -- The kiosk protocol presents the PLAINTEXT; the server derives the
  -- SHA-256 hex for the legacy / old-kiosk branches.
  v_sha := encode(sha256(convert_to(p_password, 'UTF8')), 'hex');

  if starts_with(coalesce(v_student.password_hash, ''), '$2') then
    if v_student.password_hash = crypt(p_password, v_student.password_hash) then
      -- NEW: bcrypt(plaintext) — the website's current format.
      v_matched_legacy := false;
    elsif v_student.password_hash = crypt(v_sha, v_student.password_hash) then
      -- OLD kiosk-native: bcrypt(sha256hex) — upgrade to the website format.
      v_matched_legacy := true;
    else
      raise exception 'Invalid password';
    end if;
  else
    if v_student.password_hash is distinct from v_sha then
      raise exception 'Invalid password';
    end if;
    -- OLD legacy: stored 64-hex SHA-256 — upgrade to the website format.
    v_matched_legacy := true;
  end if;

  -- D-11/D-27: transparent re-hash of an old-format row to bcrypt cost 10.
  -- `students.id` is fully qualified to avoid shadowing by the OUT
  -- variable (see 042).
  if v_matched_legacy then
    update public.students
       set password_hash = crypt(p_password, gen_salt('bf', 10))
     where students.id = v_student.id;
  end if;

  -- Already-voted flag is DETERMINISTIC and lives in this RPC (never in
  -- edge code): the ACTIVE election is the only one students can vote in.
  select e.id into v_election_id
    from public.election_periods e
   where e.is_active = true
   order by e.election_date desc nulls last, e.start_time desc nulls last
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
  -- active web session.  The ticket is an extra 5-minute session row,
  -- kind = 'ticket' so 034's sliding renewal never touches it.
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

-- ---------------------------------------------------------------------
-- Grants re-asserted (036 contract): anon/authenticated kiosk surface.
-- ---------------------------------------------------------------------
revoke all on function public.verify_student_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to anon, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to service_role;
