-- =====================================================================
-- 045_log_status_change_fk_safe.sql
-- Fix HTTP 409 on the student "submit EAF / finalize candidacy" step:
--     insert or update on table "audit_logs" violates foreign key
--     constraint "audit_logs_actor_id_fkey"
--     | Key (actor_id)=(b89af6af-…) is not present in table "adminprofiles".
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   The student's finalize step runs
--     update candidates set status = 'pending' …
--   which fires the 001-era AFTER-UPDATE trigger audit_candidate_status
--   -> public.log_status_change().  The 035 body of that trigger writes
--
--       v_actor := public.current_session_user_id();
--       insert into audit_logs (actor_id, actor_name, actor_role, …)
--       values (v_actor, …)
--
--   with NO membership normalization.  For a STUDENT session
--   current_session_user_id() is the students.id, and migration 035
--   re-pointed the FK to
--       audit_logs.actor_id -> adminprofiles(id) on delete set null.
--   Students are not in adminprofiles, so the insert raises 23503, the
--   whole transaction aborts and PostgREST surfaces HTTP 409.
--
--   Staff sessions are unaffected (their session id IS an
--   adminprofiles.id), which is why this only bites student flows.
--
-- WHAT
--   Re-create ONLY public.log_status_change() with the same membership
--   normalization that migration 038 already established for the audit
--   seam (insert_audit_log_rpc: null the actor_id when the id is not an
--   adminprofiles row).  Everything else — the trigger condition, the
--   actor_name lookup, the actor_role normalization and the details
--   text — is verbatim 035.  No trigger is recreated: the 001 triggers
--   keep firing this function unchanged, and no policy/grant is touched.
--
--   Effect: student-driven status changes still produce an audit row
--   (actor_id NULL, exactly the 035/038 documented "students' audit rows
--   carry a null actor id" contract) instead of aborting the flow.
-- =====================================================================

set search_path = public, extensions;

create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_id uuid;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_actor := public.current_session_user_id();
    v_actor_id := v_actor;
    -- 038 membership normalization (WR-01): attribute actor_id ONLY when
    -- the session id exists in adminprofiles.  Students are not in
    -- adminprofiles, so their audit rows keep a null actor id — matching
    -- the 035-documented contract — and the FK no longer aborts
    -- student-driven status changes.
    if v_actor_id is not null
       and not exists (select 1 from public.adminprofiles where id = v_actor_id) then
      v_actor_id := null;
    end if;
    insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
    values (
      v_actor_id,
      coalesce((select full_name from public.adminprofiles where id = v_actor), 'System'),
      coalesce(public.current_app_role(), 'system'),
      tg_table_name || ' Status Changed',
      'Status changed from ' || old.status || ' to ' || new.status,
      'info'
    );
  end if;
  return new;
end;
$$;