-- 028_complaint_lifecycle_rls.sql
-- =============================================================
-- Phase 4, Plan 04-01 - Task 1 (complaint lifecycle, RLS rewrite,
-- adjudication RPC, ELECT-02 groundwork helper)
--
-- Adopts the filed -> accepted/rejected lifecycle (04-CONTEXT D-01):
--   * pending  -> filed      (holding state; students see "filed")
--   * dismissed-> rejected   (rejected replaces dismissed, reason
--     backfilled when missing)
--   * resolved -> accepted   (legacy terminal "answered" state
--     survives as accepted so the re-added CHECK cannot fail on
--     live rows - Rule 2 addition, NOT in the original plan text)
-- Rewrites the dead "complaints role access" policy (001:598-602)
-- to the 022 session spine (current_session_user_id), revokes
-- direct UPDATE from client roles, and creates the role-gated,
-- audited decide_complaint_rpc - the ONLY complaints mutation path.
-- Also ships has_active_complaint_rpc (ELECT-02 groundwork, D-07).
--
-- Policy (D-13 / D-14): ALL changes land in this single additive
-- migration file, starting at numeric 028 (024/025/026/027 were
-- never authored or already landed independently).  Every statement
-- is idempotent (drop if exists / create or replace / if not
-- exists / add column if not exists) and guarded so re-apply is a
-- no-op.  Existing migration bodies 001-027 are NEVER edited.
--
-- Wrapped in ONE transaction: the constraint swap plus the row
-- mapping are atomic (a partial apply would leave illegal old
-- statuses that the new CHECK rejects).
--
-- The five sections, in order:
--   1. Complaint status lifecycle swap + incident_date column
--   2. Complaints RLS rewrite + revoke direct UPDATE
--   3. decide_complaint_rpc (grievance-guarded, audited)
--   4. has_active_complaint_rpc (ELECT-02 groundwork, D-07)
--   5. Grants (revoke PUBLIC, grant anon/authenticated)
--
-- Apply in numeric order: 001..027, then 028.  Apply manually via
-- the Supabase Dashboard (AGENTS.md).
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- SECTION 1 — Complaint status lifecycle swap (D-01) + incident_date
-- ---------------------------------------------------------------------
-- Drop the old CHECK before the row mapping (the old literals would
-- otherwise reject the new values), map every legacy state, then
-- re-add the CHECK on exactly the new set.
alter table public.complaints drop constraint if exists complaints_status_check;

update public.complaints
   set status = 'filed'
 where status = 'pending';

update public.complaints
   set status = 'rejected',
       resolution_note = coalesce(
         resolution_note,
         'Complaint dismissed under prior model; reason not recorded.'
       )
 where status = 'dismissed';

-- Legacy 'resolved' rows (old Resolve path, 001 check set) map to
-- 'accepted' - the complaint WAS answered under the old model.  This
-- leg is required so the re-added CHECK cannot fail on live rows.
update public.complaints
   set status = 'accepted'
 where status = 'resolved';

alter table public.complaints
  add constraint complaints_status_check
  check (status in ('filed', 'accepted', 'rejected'));

-- The 001 column default is still 'pending' - an INSERT that omits
-- status would default to 'pending' and violate the new CHECK above.
-- New complaints always start 'filed' (the holding state); the client
-- payload (04-02 insertComplaint: student_id/title/description/
-- incident_date) sends no status and must rely on this default
-- (Rule 2: without it the filing path breaks).
alter table public.complaints
  alter column status set default 'filed';

-- GRIEV-05 "date/incident details" field (D-03) - additive, existing
-- rows unaffected.
alter table public.complaints
  add column if not exists incident_date timestamptz;

-- ---------------------------------------------------------------------
-- SECTION 2 — Complaints RLS rewrite (session identity) + revoke
-- ---------------------------------------------------------------------
-- Old policy used auth.uid()/auth.email() - DEAD under custom DB auth
-- (022 spine): identity now comes from the Authorization header via
-- current_session_user_id().  Admins (incl. commissioners logging in
-- through the admin path) read all rows; a student sees only their
-- own complaints; the insert leg is owner-keyed identically.
drop policy if exists "complaints role access" on public.complaints;
create policy "complaints role access" on public.complaints for all using (
  public.current_app_role() = 'admin'
  or complaints.student_id = public.current_session_user_id()
) with check (
  public.current_app_role() = 'admin'
  or complaints.student_id = public.current_session_user_id()
);

-- The SECURITY DEFINER RPC below is the ONLY mutation path: revoke
-- direct UPDATE from every client-facing role (security R2).
revoke update on table public.complaints from anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 3 — decide_complaint_rpc (D-04 / GRIEV-01) - ONLY mutation
-- ---------------------------------------------------------------------
create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject text;
  v_actor_name text;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can decide complaints.';
  end if;

  if p_action not in ('accepted', 'rejected') then
    raise exception 'Action must be ''accepted'' or ''rejected''.';
  end if;

  if p_action = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'A rejection reason is required.';
  end if;

  select subject into v_subject
    from public.complaints
   where id = p_complaint_id and status = 'filed';

  if not found then
    raise exception 'Complaint not found or not in filed status.';
  end if;

  update public.complaints
     set status = p_action,
         resolution_note = p_reason,
         resolved_by = public.current_session_user_id(),
         resolved_at = now()
   where id = p_complaint_id and status = 'filed';

  select full_name into v_actor_name
    from public.profiles
   where id = public.current_session_user_id();

  -- Audit side-effect (GRIEV-04 / D-04): one row per decision.
  perform public.insert_audit_log_rpc(
    public.current_session_user_id(),   -- actor id (020 ignores it; auth.uid() is null under custom auth)
    coalesce(v_actor_name, 'Grievance Commissioner'),
    'admin',                            -- commissioners authenticate via the admin path
    case when p_action = 'accepted' then 'Accepted Complaint' else 'Rejected Complaint' end,
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') '
      || p_action
      || case when p_action = 'rejected' then ': ' || p_reason else '' end,
    case when p_action = 'accepted' then 'success' else 'warning' end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- SECTION 4 — ELECT-02 groundwork helper (D-07, RESEARCH Pitfall 4)
-- ---------------------------------------------------------------------
-- Phase 5's publication gate (INTG-04) integrates this check into
-- publish_results_rpc.  Do NOT call it from any other function until
-- that integration - D-07 says groundwork only, no enforcement.
create or replace function public.has_active_complaint_rpc(
  p_election_period_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.complaints
     where election_period_id = p_election_period_id
       and status = 'filed'
  );
$$;

-- ---------------------------------------------------------------------
-- SECTION 5 — Grants (Phase 3 pattern: revoke PUBLIC, grant clients)
-- ---------------------------------------------------------------------
revoke all on function public.decide_complaint_rpc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text) to anon, authenticated;

revoke all on function public.has_active_complaint_rpc(uuid) from public, anon, authenticated;
grant execute on function public.has_active_complaint_rpc(uuid) to anon, authenticated;

commit;