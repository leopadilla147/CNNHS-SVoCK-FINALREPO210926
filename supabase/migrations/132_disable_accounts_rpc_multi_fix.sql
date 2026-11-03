-- 132_disable_accounts_rpc_multi_fix.sql
-- =============================================================
-- Fix: HTTP 500 from disable_student_accounts_rpc when the SSLG
-- Adviser disables MULTIPLE student accounts at once.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them — the executor never touches the live project.
--
-- WHY
--   The live project may hold an earlier draft of the 107 function body
--   (migrations are applied by hand, and `create or replace` cannot
--   overwrite a draft whose return type differs).  The 107 body in the
--   repo is correct for N ids, but the deployed copy is what PostgREST
--   executes — so any drift there surfaces as an unmapped SQL error,
--   which PostgREST answers with a bare 500 instead of the friendly
--   400 the `raise exception` messages would produce.
--
-- WHAT
--   1) DROP the current function (any return-type drift would make a
--      bare `create or replace` fail) and re-create it from the 107
--      contract, hardened:
--        * the id array is deduplicated and NULL-cleaned before use;
--        * the row count comes from a plain UPDATE + GET DIAGNOSTICS
--          (no UPDATE ... RETURNING INTO indirection);
--      Everything else — the password gate, the approved/not-disabled
--      filter, the audit entry, the {disabled: n} return — is verbatim
--      107, and the signature stays (uuid[], text, text) so the 108
--      grants keep matching.
--   2) Grants re-asserted per the 108 convention: this app rides the
--      x-session-token side-channel, so the real gate is the password
--      check INSIDE the function, not the grant.
-- =============================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) Clear the decks: drop the live definition and any plausible legacy
--    overloads so PostgREST has exactly one candidate to call.
-- ---------------------------------------------------------------------
drop function if exists public.disable_student_accounts_rpc(uuid[], text, text);
drop function if exists public.disable_student_accounts_rpc(text[], text, text);

create or replace function public.disable_student_accounts_rpc(
  p_student_ids uuid[],
  p_reason text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_actor_role text;
  v_hash text;
  v_disabled int := 0;
  v_ids uuid[] := '{}'::uuid[];
begin
  -- AUTH-05: the actor derives ONLY from the session spine.
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select a.full_name, a.role_type, a.password_hash
    into v_actor_name, v_actor_role, v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if not found then
    raise exception 'Only admins or active SSLG advisers can disable student accounts.';
  end if;

  v_actor_role := case when v_actor_role = 'sslg_adviser' then 'sslg_adviser' else 'admin' end;
  v_actor_name := coalesce(v_actor_name, 'Administrator');

  -- Password gate: the acting staff member's own password, bcrypt-verified.
  if v_hash is null or v_hash is distinct from crypt(p_password, v_hash) then
    raise exception 'The SSLG Adviser password was not accepted.';
  end if;

  if p_reason not in ('graduated', 'transferred') then
    raise exception 'Reason must be graduated or transferred.';
  end if;

  -- Normalize the selection: dedupe, drop nulls.  A stale client Set can
  -- carry repeats; `id = any(...)` would tolerate them, but a clean array
  -- keeps the audit count honest.
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
    from unnest(p_student_ids) as u(x)
   where x is not null;

  if array_length(v_ids, 1) is null then
    raise exception 'Select at least one student account to disable.';
  end if;

  -- Only APPROVED, not-yet-disabled accounts are touched.
  update public.students
     set disabled_at = now(),
         disabled_reason = p_reason
   where id = any(v_ids)
     and status = 'approved'
     and disabled_at is null;

  get diagnostics v_disabled = row_count;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    v_actor_name,
    v_actor_role,
    'Student Accounts Disabled',
    format('Disabled %s student account(s) — reason: %s.',
           v_disabled,
           case when p_reason = 'graduated' then 'Graduated' else 'Transferred to another school' end),
    'warning'
  );

  return jsonb_build_object('disabled', v_disabled);
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Grants re-asserted (108 contract): anon-only pre-session surface;
--    the password check inside the function is the real gate.
-- ---------------------------------------------------------------------
revoke all on function public.disable_student_accounts_rpc(uuid[], text, text) from public;
grant execute on function public.disable_student_accounts_rpc(uuid[], text, text) to anon, authenticated;
