-- =====================================================================
-- 116_contact_information_rpc.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   The public Contact Information page (/contact) must show the email of
--   the three people a student may need to reach — the Youth COMEA Chief
--   Commissioner, the SSLG Adviser, and the Commissioner of Grievance.
--   But:
--     * 037 dropped public.commissioners, and 038 revoked direct SELECT
--       on public.adminprofiles for anon/authenticated, so no client can
--       read the roster directly.
--     * list_staff_roster_rpc (046) is the only client-readable roster
--       and it is chief-gated.
--     * eaf_signatories_rpc (110) set the precedent for a minimal
--       SECURITY DEFINER read of serving officers' names — but it is
--       session-gated and returns names only.
--
-- WHAT
--   contact_information_rpc() — an UNGATED public read (the page renders
--   for logged-out visitors, like homepage_settings) returning ONLY the
--   display name + email of the ACTIVE officer in each of the three
--   roles, nothing else (no password/session material, no auth_id, no
--   other columns):
--     * chief_commissioner  — role_type = 'chief'
--     * sslg_adviser        — role_type = 'sslg_adviser'
--     * grievance_commissioner — role_type = 'commissioner',
--       commissioner_role = 'grievance'; 104 co-commissioners rank AFTER
--       the primary (co_commissioner_of IS NULL first).
--   A role that is vacant — or whose officer has no usable email — comes
--   back null; the page renders a vacancy notice for it.
-- =====================================================================

create or replace function public.contact_information_rpc()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return jsonb_build_object(
    'chief_commissioner', (
      select jsonb_build_object('name', a.full_name, 'email', btrim(a.email))
        from public.adminprofiles a
       where a.status = 'active'
         and a.role_type = 'chief'
         and nullif(btrim(a.full_name), '') is not null
         and nullif(btrim(coalesce(a.email, '')), '') is not null
       order by a.appointed_at nulls last, a.full_name
       limit 1
    ),
    'sslg_adviser', (
      select jsonb_build_object('name', a.full_name, 'email', btrim(a.email))
        from public.adminprofiles a
       where a.status = 'active'
         and a.role_type = 'sslg_adviser'
         and nullif(btrim(a.full_name), '') is not null
         and nullif(btrim(coalesce(a.email, '')), '') is not null
       order by a.appointed_at nulls last, a.full_name
       limit 1
    ),
    'grievance_commissioner', (
      select jsonb_build_object('name', a.full_name, 'email', btrim(a.email))
        from public.adminprofiles a
       where a.status = 'active'
         and a.role_type = 'commissioner'
         and a.commissioner_role = 'grievance'
         and nullif(btrim(a.full_name), '') is not null
         and nullif(btrim(coalesce(a.email, '')), '') is not null
       order by (a.co_commissioner_of is not null), a.appointed_at nulls last, a.full_name
       limit 1
    )
  );
end;
$$;

-- The function is public information by design (no gate): grant EXECUTE to
-- both PostgREST roles.  093/103 precedent — revoke the default PUBLIC
-- grant first so EXECUTE is never implicitly public at the function level.
revoke all on function public.contact_information_rpc() from public, anon, authenticated;
grant execute on function public.contact_information_rpc() to anon, authenticated;
