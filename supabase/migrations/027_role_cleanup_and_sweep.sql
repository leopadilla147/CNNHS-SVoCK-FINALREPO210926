-- 027_role_cleanup_and_sweep.sql
-- =============================================================
-- Phase 3 sweep: remove the deprecated SSLG Officer role
-- (REMOVE-01/02) and Commissioner of Appointment role
-- (REMOVE-07/08) from the schema, and re-home live results on
-- the Chief Commissioner (ELECT-05 / ROLE-01).
--
-- Policy (D-13 / D-14): ALL changes land in this single additive
-- migration file, starting at numeric 027+ because 024/025/026
-- were planned but never authored.  Every statement is idempotent
-- (drop if exists / create or replace / if not exists) and
-- guarded so re-apply is a no-op.  Existing migration bodies
-- 001-025 are NEVER edited (D-14 / T-03-06).
--
-- The six sections, in order:
--   1. Drop deprecated tables and functions (officers,
--      nominations, login_officer_direct(_v2)) plus their grants
--   2. Re-create role check constraints WITHOUT the removed
--      literals ('officer' / 'appointment')
--   3. Re-gate post_official_list_rpc to screening_validation
--   4. ELECT-05: revoke the 015 blanket live-results grant and
--      create the chief-gated get_live_results_rpc()
--   5. Co-commissioner schema: co_commissioner_of column
--   6. Purge appointment-role report template rows
--
-- Apply in numeric order: 001..023, then 024/025/026 (if present
-- from earlier phases), then 027.  Apply manually via the
-- Supabase Dashboard (AGENTS.md).
-- =============================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — Drop deprecated tables and functions
-- ---------------------------------------------------------------------
-- Revokes are belt-and-suspenders BEFORE the drops (an explicit
-- revoke on an already-dropped object would error, so each is
-- existence-guarded: re-apply is a no-op).  The trigger must be
-- dropped while public.nominations still exists — DROP TRIGGER
-- cannot reference a dropped table.
do $$
begin
  if to_regclass('public.officers') is not null then
    revoke all on table public.officers from public, anon, authenticated;
  end if;
  if to_regclass('public.nominations') is not null then
    drop trigger if exists audit_nomination_status on public.nominations;
  end if;
  if to_regprocedure('public.login_officer_direct(text,text)') is not null then
    revoke all on function public.login_officer_direct(text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.login_officer_direct_v2(text,text)') is not null then
    revoke all on function public.login_officer_direct_v2(text, text) from public, anon, authenticated;
  end if;
end $$;

-- officers: zero FK references from other tables (D-01); cascade
-- removes its RLS policies, unique index, and demo rows with it.
drop table if exists public.officers cascade;

-- nominations: cascade removes the "nominations role access"
-- policy and the audit_nomination_status trigger (D-03/D-15).
drop table if exists public.nominations cascade;

-- Legacy officer login surfaces (001:724-744, 023:369-422).
drop function if exists public.login_officer_direct(text, text);
drop function if exists public.login_officer_direct_v2(text, text);

-- ---------------------------------------------------------------------
-- SECTION 2 — Re-create role check constraints WITHOUT the removed
-- literals (D-01 / D-08).  Existing rows carrying a dropped literal
-- are swept first (D-08: "role rows are dropped") so the ADD
-- CONSTRAINT cannot fail on surviving data.
-- ---------------------------------------------------------------------
-- Sweep deprecated-role data (idempotent: no-op once the rows are gone).
delete from public.commissioners where commissioner_role = 'appointment';
update public.profiles set commissioner_role = null where commissioner_role = 'appointment';
delete from public.profiles where role = 'officer';

-- profiles.role: no 'officer' (was ('student','officer','admin','sslg_adviser') after 006)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'admin', 'sslg_adviser'));

-- profiles.commissioner_role: no 'appointment'
alter table public.profiles drop constraint if exists profiles_commissioner_role_check;
alter table public.profiles add constraint profiles_commissioner_role_check
  check (commissioner_role in ('chief', 'screening_validation', 'electoral_board', 'grievance'));

-- commissioners.commissioner_role: no 'appointment'
alter table public.commissioners drop constraint if exists commissioners_commissioner_role_check;
alter table public.commissioners add constraint commissioners_commissioner_role_check
  check (commissioner_role in ('chief', 'screening_validation', 'electoral_board', 'grievance'));

-- audit_logs.actor_role: no 'officer' (was ('admin','officer','student','system','sslg_adviser') after 014)
alter table public.audit_logs drop constraint if exists audit_logs_actor_role_check;
alter table public.audit_logs add constraint audit_logs_actor_role_check
  check (actor_role in ('admin', 'student', 'system', 'sslg_adviser'));

-- notifications.role: no 'officer' (011 inline check, auto-named notifications_role_check)
alter table public.notifications drop constraint if exists notifications_role_check;
alter table public.notifications add constraint notifications_role_check
  check (role in ('student', 'admin', 'sslg_adviser', 'commissioner'));

-- ---------------------------------------------------------------------
-- SECTION 3 — Re-gate post_official_list_rpc to screening_validation
-- only (D-04).  Same body as 012; the authorization gate is replaced.
-- ---------------------------------------------------------------------
create or replace function public.post_official_list_rpc(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_commissioner_role() != 'screening_validation' then
    raise exception 'Only the Commissioner of Screening and Validation can post the official list.';
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

-- ---------------------------------------------------------------------
-- SECTION 4 — ELECT-05: revoke the blanket live-results grant and
-- expose results only through the chief-gated RPC (T-03-01/T-03-05).
-- Identity comes from the 022 session spine (current_commissioner_role),
-- NEVER auth.uid()/auth.email().
-- ---------------------------------------------------------------------
revoke select on public.live_results_restricted from authenticated;

create or replace function public.get_live_results_rpc()
returns table (
  election_period_id uuid,
  "position" text,
  candidate_id uuid,
  given_name text,
  surname text,
  party_name text,
  votes bigint
)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can view live results.';
  end if;

  return query
    select * from public.live_results_restricted;
end;
$$;

revoke all on function public.get_live_results_rpc() from public, anon, authenticated;
grant execute on function public.get_live_results_rpc() to authenticated, anon;

-- ---------------------------------------------------------------------
-- SECTION 5 — Co-commissioner schema (D-11/D-12 / ROLE-01)
-- ---------------------------------------------------------------------
alter table public.commissioners
  add column if not exists co_commissioner_of uuid references public.commissioners(id);

-- ---------------------------------------------------------------------
-- SECTION 6 — Remove appointment-role report template rows (020:423-439)
-- ---------------------------------------------------------------------
delete from public.report_templates
 where owner_role = 'appointment' or category = 'appointment';