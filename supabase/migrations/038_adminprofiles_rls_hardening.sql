-- =====================================================================
-- 038_adminprofiles_rls_hardening.sql
-- Phase 02, Plan 06 - Task 1 (CR-01 privilege-escalation closure +
-- WR-01 audit actor attribution fold-in; WR-02 deferred to Phase 5)
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase — the executor never touches the live project.
--
-- This is the verifier-prescribed follow-up migration closing the
-- blocking gaps of 02-VERIFICATION.md's Gaps Summary:
--   * CR-01 — adminprofiles own-update policy lacks a USING clause and
--     no table-level REVOKE removes default anon/authenticated DML;
--     any authenticated staff session can PATCH its own row to
--     promote itself to chief or overwrite password_hash.
--   * WR-01 — insert_audit_log_rpc derives the actor from auth.uid()
--     which is always NULL under the custom session spine, so every
--     audit row lands actor_id NULL.
--   * WR-01 fold-in — the 001-era audit_logs authenticated insert
--     policy uses a dead auth.uid() condition; rewritten onto the
--     session spine.
--
-- 035-037 are already applied and MUST NOT be edited; this migration
-- is strictly additive, existence-guarded, idempotent, and safe to
-- re-run.  It creates/revokes/re-creates only what is listed below.
-- The claim made by a comment in section 11 of 035 ("no direct client
-- DML grant") becomes true retroactively via the REVOKE in Section 1.
--
-- Idempotency: revoke is safe to re-run; drop-policy-if-exists +
-- create policy; create-or-replace function (no drop-first needed —
-- the return type is unchanged); the audit-seam function body uses
-- coalesce(current_session_user_id(), p_actor_id) so staff sessions
-- resolve their adminprofiles.id from the session spine.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 038 is strictly additive and user-applied per AGENTS.md.
-- No applied migration file (035/036/037 or earlier) is edited here.
-- No tabular-destruction statement (no table/view drop, no truncation,
-- no cascade removal), no auth.users row deletion, no other
-- function, policy, grant, or default-privilege change (schema-wide
-- ALTER DEFAULT PRIVILEGES is deliberately out of scope — Phase 5 /
-- posture concern).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1) TABLE-LEVEL GRANT REMOVAL (CR-01 half 1)
--    Supabase default privileges grant DML to anon/authenticated on
--    new public tables; without this revoke the own-update WITH CHECK
--    can be satisfied by a staff session patching its own row
--    (self-promotion to chief, password-hash forgery).
-- ---------------------------------------------------------------------
revoke all on table public.adminprofiles from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) OWN-UPDATE POLICY WITH USING MIRROR (CR-01 half 2)
--    The 035 "adminprofiles own update" policy had only a WITH CHECK
--    and no USING clause — the pre-image was unconstrained, so a
--    staff session could PATCH its own row to promote itself to chief
--    or overwrite password_hash.  Recreate with a USING clause
--    mirroring the WITH CHECK (own-row session-spine rule on the
--    pre-image too).  The "adminprofiles own select" and
--    "adminprofiles chief all" policies are untouched (verbatim
--    re-assertion is optional but allowed only as drop-if-exists +
--    identical create).
-- ---------------------------------------------------------------------
drop policy if exists "adminprofiles own update" on public.adminprofiles;
create policy "adminprofiles own update" on public.adminprofiles for update using (public.current_session_user_id() = id) with check (public.current_session_user_id() = id);

-- ---------------------------------------------------------------------
-- 3) AUDIT ATTRIBUTION — insert_audit_log_rpc re-created with
--    session-spine actor derivation (WR-01)
--    The 035 body started with v_actor_id := auth.uid() which is
--    always NULL under the custom session spine.  Replace the
--    auth-based uid assignment with a coalesce of the session spine
--    and the caller-passed actor id: staff sessions resolve their
--    adminprofiles.id from the session spine (restoring actor_id
--    attribution), students resolve their own id which the existing
--    membership normalization nulls (preserving 035's documented
--    "students' audit rows keep a null actor id" contract), and
--    p_actor_id remains a defensive fallback for system-origin calls.
--    The membership normalization, the actor_role literal mapping,
--    and the comment text are otherwise unchanged from 035.
--    No drop-first is needed — the return type (void) is unchanged,
--    so create-or-replace alone suffices.
-- ---------------------------------------------------------------------
create or replace function public.insert_audit_log_rpc(
   p_actor_id uuid default null,
   p_actor_name text default null,
   p_actor_role text default 'system',
   p_action text default null,
   p_details text default null,
   p_type text default 'info'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
   v_actor_id uuid;
   v_actor_name text;
   v_role text;
begin
   v_actor_id := coalesce(public.current_session_user_id(), p_actor_id);
   -- Actor identity comes ONLY from the PostgREST session (auth.uid()).
   -- Only use actor_id if it exists in adminprofiles (students are not
   -- in adminprofiles — their audit rows carry a null actor id).
   if v_actor_id is not null and not exists (select 1 from public.adminprofiles where id = v_actor_id) then
     v_actor_id := null;
   end if;
   v_actor_name := coalesce(p_actor_name, 'System');
   v_role := lower(coalesce(p_actor_role, 'system'));
   -- 027 actor_role CHECK ('admin','student','system','sslg_adviser'):
   -- any client-visible/missing role normalizes to 'system'.
   if v_role not in ('admin', 'student', 'system', 'sslg_adviser') then
     v_role := 'system';
   end if;
   insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
   values (v_actor_id, v_actor_name, v_role, p_action, p_details, p_type);
end;
$$;

-- ---------------------------------------------------------------------
-- 4) AUDIT LOGS INSERT POLICY ON THE SESSION SPINE (WR-01 fold-in)
--    The 001-era "audit logs authenticated insert" policy used
--    auth.uid() is not null which is dead under the custom session
--    spine.  Rewrite onto the session-spine condition with the
--    system/service-role escape hatches kept.  The client only
--    inserts audit rows through the security-definer RPC today,
--    but the policy must not block legitimate session-spine actors
--    on any future direct path.  The "audit logs admin select"
--    read policy is untouched.
-- ---------------------------------------------------------------------
drop policy if exists "audit logs authenticated insert" on public.audit_logs;
create policy "audit logs authenticated insert" on public.audit_logs for insert with check (public.current_session_user_id() is not null or actor_role = 'system' or auth.role() = 'service_role');

-- ---------------------------------------------------------------------
-- 5) SCOPE GUARD — nothing else
--    WR-02 (the lost service_role EXECUTE grant on
--    verify_student_credentials_rpc) is NOT remediated here:
--    038 contains NO grant statement for it.  WR-02 is explicitly
--    DEFERRED to Phase 5 (per its recorded disposition "re-assert in
--    038 or Phase 5"), and the Phase 5 pickup is recorded in this
--    plan's SUMMARY and STATE.md.  A deferral is recorded, never a
--    closure claim: WR-02 remains OPEN until Phase 5 re-asserts the
--    service_role grant.
-- ---------------------------------------------------------------------
