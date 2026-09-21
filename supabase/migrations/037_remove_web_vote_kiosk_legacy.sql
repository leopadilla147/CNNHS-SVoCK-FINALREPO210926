-- =====================================================================
-- 037_remove_web_vote_kiosk_legacy.sql
-- Phase 02, Plan 03 - Task 2 (the v1.1 teardown wave)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase — the executor never touches the live project.
--
-- This is the one-way removal wave gated at checkpoint:decision Task 1
-- (user approved option 'full').  035 consolidated every staff identity
-- into public.adminprofiles (backfill + auth_id Chief-only); 036 trimmed
-- the election domain; 037 destroys the superseded machinery:
--   * WEB-VOTE/RECEIPT SURFACE  — vote_receipts, generate_vote_receipt_code,
--     generate_vote_receipt, the on_vote_insert_charge_receipt trigger,
--     submit_vote_rpc, verify_receipt_rpc, sync_kiosk_votes_rpc
--   * RECONCILIATION/ADJUDICATION — get_reconciliation_rpc, adjudicate_vote_rpc
--   * KIOSK-DEVICE/QUEUE MACHINERY — verify_kiosk_credentials_rpc,
--     kiosk_vote_queue, kiosk_ballot_cache, kiosk_devices
--   * AUTH.USERS STAFF CLEANUP — every non-Chief staff auth.users row
--     (keyed on adminprofiles.auth_id IS NULL — the 035 backfill) plus
--     their auth.identities rows; the Chief identity row is never matched
--   * LEGACY IDENTITY TABLES — sslg_advisers, commissioners, profiles
--     (update_commissioner_status / replace_commissioner / login_student_direct
--     drop with them)
--
-- KIOSK CONTRACT SURVIVES: votes / biometric_templates / sessions /
-- login_attempts keep their exact shapes; verify_student_credentials_rpc
-- (the kiosk voter verifier + 5-minute ticket mint) is NOT dropped and is
-- explicitly re-granted in Section 6.  No drop uses an automatic
-- dependency sweep — any residual dependency fails the apply loudly with
-- the victim named.  001-036 bodies are NEVER edited.
-- =====================================================================

create extension if not exists pgcrypto;

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) WEB-VOTE/RECEIPT SURFACE
--    Guarded revokes first (re-apply on already-dropped objects is a
--    no-op), then the trigger BEFORE its function (PostgreSQL refuses to
--    drop generate_vote_receipt while on_vote_insert_charge_receipt still
--    references it), then the five functions, then the receipt table.
--    No votes column/index/constraint is touched besides the trigger
--    removal itself.  submit_vote_rpc was already dropped by 036 — its
--    guarded drop here is a re-apply no-op.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.generate_vote_receipt_code()') is not null then
    revoke all on function public.generate_vote_receipt_code() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.generate_vote_receipt()') is not null then
    revoke all on function public.generate_vote_receipt() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.submit_vote_rpc(text,jsonb)') is not null then
    revoke all on function public.submit_vote_rpc(text, jsonb) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.verify_receipt_rpc(text)') is not null then
    revoke all on function public.verify_receipt_rpc(text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.sync_kiosk_votes_rpc(uuid,uuid,uuid,jsonb)') is not null then
    revoke all on function public.sync_kiosk_votes_rpc(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
  end if;
end $$;

-- Dropped BEFORE generate_vote_receipt(): the trigger depends on it.
drop trigger if exists on_vote_insert_charge_receipt on public.votes;

drop function if exists public.generate_vote_receipt_code();
drop function if exists public.generate_vote_receipt();
drop function if exists public.submit_vote_rpc(text, jsonb);
drop function if exists public.verify_receipt_rpc(text);
drop function if exists public.sync_kiosk_votes_rpc(uuid, uuid, uuid, jsonb);

drop table if exists public.vote_receipts;

-- ---------------------------------------------------------------------
-- 2) RECONCILIATION/ADJUDICATION (033) — dropped before the queue table
--    and profiles they read.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_reconciliation_rpc(uuid)') is not null then
    revoke all on function public.get_reconciliation_rpc(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.adjudicate_vote_rpc(uuid,uuid,text,text,uuid)') is not null then
    revoke all on function public.adjudicate_vote_rpc(uuid, uuid, text, text, uuid) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.get_reconciliation_rpc(uuid);
drop function if exists public.adjudicate_vote_rpc(uuid, uuid, text, text, uuid);

-- ---------------------------------------------------------------------
-- 3) KIOSK-DEVICE/QUEUE MACHINERY
--    verify_kiosk_credentials_rpc updates kiosk_devices — dropped first.
--    kiosk_vote_queue dies with its adjudicated_by FK to profiles
--    (031:256); the queue table is removed before profiles in Section 5.
--    VERIFY KEPT: verify_student_credentials_rpc(p_lrn text,
--    p_password_sha256 text) MUST remain — the kiosk voter verification
--    + ticket mint (031/034/036 contract).  No drop statement below
--    targets it, and Section 6 re-asserts its grants.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.verify_kiosk_credentials_rpc(text,text)') is not null then
    revoke all on function public.verify_kiosk_credentials_rpc(text, text) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.verify_kiosk_credentials_rpc(text, text);

drop table if exists public.kiosk_vote_queue;
drop table if exists public.kiosk_ballot_cache;
drop table if exists public.kiosk_devices;

-- ---------------------------------------------------------------------
-- 4) AUTH.USERS STAFF CLEANUP (guarded do-block)
--    The 021 pattern: delete auth.identities rows BEFORE the auth.users
--    rows they reference.  The predicate keys on the 035 backfill:
--    adminprofiles.auth_id IS NULL selects exactly the non-Chief staff
--    rows (the Chief's adminprofiles row carries auth_id = its own id,
--    so the Chief identity row in auth.users is never matched).  The
--    block only runs when public.adminprofiles exists and has rows with
--    auth_id null — on a chain where 035 never backfilled, this is a
--    clean no-op and any orphaned authority row surfaces as a loud FK
--    error at apply time instead of a silent sweep.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.adminprofiles') is not null
     and exists (select 1 from public.adminprofiles where auth_id is null) then

    delete from auth.identities
     where user_id in (select id from public.adminprofiles where auth_id is null);

    delete from auth.users
     where id in (select id from public.adminprofiles where auth_id is null);

  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) LEGACY IDENTITY TABLES
--    update_commissioner_status / replace_commissioner read
--    public.commissioners — dropped before the table.  login_student_direct
--    is the 001 pre-022 student login (revoked since 022:262) — final
--    removal here.  Every drop is existence-guarded; no drop uses an
--    automatic dependency sweep: if a pg_constraint/function dependency
--    somehow survives the 035/036 re-points, the apply fails loudly naming
--    the victim constraint — never a silent sweep.  The 035 FK re-points
--    mean no surviving table references profiles/commissioners/sslg_advisers.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.update_commissioner_status(uuid,text)') is not null then
    revoke all on function public.update_commissioner_status(uuid, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.replace_commissioner(text,text,text,uuid)') is not null then
    revoke all on function public.replace_commissioner(text, text, text, uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.login_student_direct(text,text)') is not null then
    revoke all on function public.login_student_direct(text, text) from public, anon, authenticated;
  end if;
end $$;

drop function if exists public.update_commissioner_status(uuid, text);
drop function if exists public.replace_commissioner(text, text, text, uuid);
drop function if exists public.login_student_direct(text, text);

drop table if exists public.sslg_advisers;
drop table if exists public.commissioners;
drop table if exists public.profiles;

-- ---------------------------------------------------------------------
-- 6) GRANTS RE-ASSERT (least-privilege, 023/032/035/036 pattern)
--    Re-asserted every run on the surviving surfaces this phase touches.
--    No grant on any dropped object — the dropped functions' revokes in
--    Sections 1-3/5 already ran.  verify_student_credentials_rpc is the
--    kiosk's ONLY student verifier (031/034/036 contract) — anon +
--    authenticated; login_staff_direct_v2 / change_my_password run
--    pre-session under anon; the role helper and the election/complaint
--    RPCs serve anon + authenticated.
-- ---------------------------------------------------------------------
revoke all on function public.verify_student_credentials_rpc(text, text) from public, authenticated;
grant execute on function public.verify_student_credentials_rpc(text, text) to anon, authenticated;

revoke all on function public.login_staff_direct_v2(text, text) from public, authenticated;
grant execute on function public.login_staff_direct_v2(text, text) to anon;

revoke all on function public.change_my_password(text, text) from public, authenticated;
grant execute on function public.change_my_password(text, text) to anon;

revoke all on function public.current_commissioner_role() from public;
grant execute on function public.current_commissioner_role() to anon, authenticated;

revoke all on function public.publish_results_rpc(uuid) from public, anon, authenticated;
grant execute on function public.publish_results_rpc(uuid) to anon, authenticated;

revoke all on function public.has_active_complaint_rpc(uuid) from public, anon, authenticated;
grant execute on function public.has_active_complaint_rpc(uuid) to anon, authenticated;