-- =====================================================================
-- 110_eaf_signatories_rpc.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   The printed EAF (Enclosure No. 1) carries two signatory lines on
--   page 1 — "Verified by: FULL NAME OF THE AUTHORITY (Screening and
--   Validation Commissioner)" and "Approved by: FULL NAME OF THE SCHOOL
--   HEAD (Youth COMEA Chief Commissioner)".  The student's EAF preview
--   must print the serving officers' names there, but:
--     * 037 dropped public.commissioners, and 038 revoked direct SELECT
--       on public.adminprofiles for anon/authenticated, so no client
--       (least of all a student) can read the roster directly.
--     * list_staff_roster_rpc (046) is the only client-readable roster
--       and it is chief-gated.
--
-- WHAT
--   eaf_signatories_rpc() — a SECURITY DEFINER read that returns ONLY
--   the two signatory names:
--     * screening_commissioner — the ACTIVE PRIMARY commissioner
--       (role_type = 'commissioner', commissioner_role =
--       'screening_validation'), earliest appointed first (104
--       co-commissioners never sign).
--     * chief_commissioner — the ACTIVE chief (role_type = 'chief').
--   Null when a role is vacant or the name is blank; the UI falls back
--   to the form's printed placeholders.  No password/session material,
--   no emails, nothing else — two strings, nothing more.
--
-- GATE
--   Requires a signed-in session (session spine); the names themselves
--   are what every printed EAF already carries.
-- =====================================================================

begin;

create or replace function public.eaf_signatories_rpc()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if public.current_session_user_id() is null then
    raise exception 'Authentication required — signatories are only served to signed-in users.';
  end if;

  return jsonb_build_object(
    'screening_commissioner', (
      select a.full_name
        from public.adminprofiles a
       where a.status = 'active'
         and a.role_type = 'commissioner'
         and a.commissioner_role = 'screening_validation'
         and nullif(btrim(a.full_name), '') is not null
       order by a.appointed_at nulls last, a.full_name
       limit 1
    ),
    'chief_commissioner', (
      select a.full_name
        from public.adminprofiles a
       where a.status = 'active'
         and a.role_type = 'chief'
         and nullif(btrim(a.full_name), '') is not null
       order by a.appointed_at nulls last, a.full_name
       limit 1
    )
  );
end;
$$;

-- Grant posture copied from 044/052/058/077/109: the custom session spine
-- means the platform role is ALWAYS anon, so anon gets EXECUTE and the real
-- gate is the in-body session check.
revoke all on function public.eaf_signatories_rpc() from public, anon, authenticated;
grant execute on function public.eaf_signatories_rpc() to anon;

commit;
