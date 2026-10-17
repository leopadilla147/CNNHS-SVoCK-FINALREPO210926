-- =====================================================================
-- 068_officer_remove_and_generated_names.sql
-- Two Officer Management (Chief) changes:
--   1. remove_officer_rpc(uuid)  — the Chief's officer-account removal
--      surface (the Actions column "Remove" button).
--   2. a deterministic generated-name backfill that replaces every
--      officer's adminprofiles.full_name with a generated person name.
--
-- Run in Supabase Dashboard > SQL Editor (idempotent, safe to re-run).
-- AGENTS.md: DB changes ship as numbered migration files; the USER applies
-- them in Supabase — the executor never touches the live project.
--
-- WHY
--   * REMOVE — 037 dropped public.commissioners / public.sslg_advisers and
--     038 revoked ALL direct SELECT/DML on public.adminprofiles for
--     anon/authenticated, so the Officer Management tab has no client
--     removal path at all.  The only safe delete path is a SECURITY
--     DEFINER RPC gated to the Chief (the list_staff_roster_rpc posture,
--     046).
--   * NAMES — the seeded officers carry role-title names ("Chief
--     Commissioner", "Commissioner of Screening & Validation", "SSLG
--     Adviser") rather than person names.  The Chief's request is to
--     generate a person name for every officer.  The mapping is derived
--     from md5(id) so it is deterministic: re-running this file yields
--     the SAME name for the same officer and never reshuffles the roster.
--     The pre-change names are copied to public.adminprofiles_name_backup
--     BEFORE the overwrite so the rename stays reversible from SQL.
--
-- GATE
--   remove_officer_rpc enforces public.current_commissioner_role() =
--   'chief' server-side (035 re-grounded that helper onto the session
--   spine), so no other commissioner, adviser, or student can remove
--   staff.  The chief row itself can never be removed, neither can the
--   calling session's own row.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1) RENAME SAFETY COPY — the pre-rename full_name of every officer.
--    Internal only: RLS enabled with NO policy plus a table-level
--    REVOKE, so no client (not even the Chief) can read real names back
--    through PostgREST.  Restore with a SQL-editor update of
--    public.adminprofiles.full_name from this table if ever needed.
--    on conflict do nothing keeps the FIRST (original) names when the
--    file is re-run after the rename already happened.
-- ---------------------------------------------------------------------
create table if not exists public.adminprofiles_name_backup (
  id uuid primary key,
  old_full_name text,
  backed_up_at timestamptz not null default now()
);

alter table public.adminprofiles_name_backup enable row level security;
revoke all on table public.adminprofiles_name_backup from public, anon, authenticated;

insert into public.adminprofiles_name_backup (id, old_full_name, backed_up_at)
select a.id, a.full_name, now()
  from public.adminprofiles a
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) GENERATED NAMES — deterministic person names for every officer
--    (chief, commissioner, co_commissioner, sslg_adviser).
--    index = two unsigned md5(id) bytes modulo the pool size, so the same
--    row always resolves to the same first/last name pair.  get_byte()
--    over decode(md5(...), 'hex') yields a guaranteed-positive 0..65535
--    value (no sign/overflow pitfalls, no hex->bit cast tricks).
--    Emails, roles, status, appointed_at and everything else are
--    untouched — only the display name changes.
-- ---------------------------------------------------------------------
update public.adminprofiles a
   set full_name =
     v.first_names[1 + (get_byte(decode(md5(a.id::text), 'hex'), 0) * 256
                       + get_byte(decode(md5(a.id::text), 'hex'), 1))
                       % array_length(v.first_names, 1)]
     || ' ' ||
     v.last_names[1 + (get_byte(decode(md5(a.id::text), 'hex'), 2) * 256
                      + get_byte(decode(md5(a.id::text), 'hex'), 3))
                      % array_length(v.last_names, 1)]
  from (
    select
      array[
        'Maria', 'Jose', 'Juan', 'Ana', 'Carlo', 'Liza', 'Miguel', 'Rosa',
        'Andres', 'Elena', 'Paolo', 'Grace', 'Mark', 'Angelica', 'Rafael',
        'Jasmine', 'Dennis', 'Kristine', 'Alvin', 'Bianca', 'Emilio',
        'Corazon', 'Gabriel', 'Teresa', 'Nathaniel', 'Maricel', 'Rowell',
        'Divine', 'Jerome', 'Charmaine', 'Eric', 'Rowena', 'Victor',
        'Melanie', 'Antonio', 'Catherine', 'Ramon', 'Aileen', 'Ferdinand',
        'Cristina'
      ]::text[] as first_names,
      array[
        'Dela Cruz', 'Santos', 'Reyes', 'Ramos', 'Garcia', 'Mendoza',
        'Torres', 'Flores', 'Bautista', 'Cruz', 'Aquino', 'Villanueva',
        'Domingo', 'Castillo', 'Rivera', 'Gonzales', 'Perez', 'Ramirez',
        'Navarro', 'Salazar', 'Fernandez', 'Lim', 'Tan', 'Ong',
        'Sarmiento', 'Villamor', 'Salvador', 'Soriano', 'Aguilar', 'Diaz',
        'Mercado', 'Velasco', 'Corpuz', 'Manalo', 'Pascual', 'Ocampo',
        'Dizon', 'Lacson', 'Yulo', 'Buenaventura'
      ]::text[] as last_names
  ) v;

-- ---------------------------------------------------------------------
-- 3) remove_officer_rpc(p_officer_id uuid) — the Chief's removal surface.
--    * Chief-gated server-side (identical posture to 046).
--    * Never removes the chief row or the caller's own row.
--    * Purges the target's session rows FIRST: public.sessions.user_id
--      carries no FK, so an orphaned session would otherwise survive the
--      row deletion (the 037 non-Chief cleanup does the same).
--    * Deletes the adminprofiles row.  Every FK that references
--      adminprofiles(id) is ON DELETE SET NULL (035 section 3), so
--      students.reviewed_by, audit_logs.actor_id, election_periods.
--      created_by, co_commissioner_of, appointed_by ... become NULL and
--      history is preserved.  Only ever non-chief rows reach the delete,
--      and only the Chief carries an auth.users identity, so no
--      auth.users row is ever touched here.
--    * Writes one audit row through the 038 audit seam.
-- ---------------------------------------------------------------------
create or replace function public.remove_officer_rpc(p_officer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_target_role text;
  v_target_name text;
begin
  if public.current_commissioner_role() != 'chief' then
    raise exception 'Only the Chief Commissioner can remove officer accounts.';
  end if;

  if p_officer_id is null then
    raise exception 'An officer id is required.';
  end if;

  v_actor := public.current_session_user_id();

  select a.role_type, a.full_name
    into v_target_role, v_target_name
    from public.adminprofiles a
   where a.id = p_officer_id;

  if v_target_role is null then
    raise exception 'Officer not found.';
  end if;

  if v_target_role = 'chief' then
    raise exception 'The Chief Commissioner account cannot be removed.';
  end if;

  if v_actor is not null and p_officer_id = v_actor then
    raise exception 'You cannot remove your own account.';
  end if;

  -- Sessions carry no FK to adminprofiles — purge them explicitly so the
  -- removed officer's token dies with the row.
  delete from public.sessions where user_id = p_officer_id;

  delete from public.adminprofiles where id = p_officer_id;

  select a.full_name into v_actor_name
    from public.adminprofiles a
   where a.id = v_actor;

  perform public.insert_audit_log_rpc(
    v_actor,
    coalesce(v_actor_name, 'Chief Commissioner'),
    'admin',
    'Removed Officer',
    'Removed ' || coalesce(v_target_name, 'an officer')
      || ' (' || p_officer_id::text || ')',
    'warning'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4) GRANTS — chief-only surfaces (046/027 posture), re-asserted
--    every run.  The RPC is callable by any client but self-gates on the
--    session-spine chief role; the backup table stays fully private.
-- ---------------------------------------------------------------------
revoke all on function public.remove_officer_rpc(uuid) from public, anon, authenticated;
grant execute on function public.remove_officer_rpc(uuid) to anon, authenticated;
