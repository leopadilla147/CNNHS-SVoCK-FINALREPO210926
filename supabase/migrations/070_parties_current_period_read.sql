-- =====================================================================
-- 070_parties_current_period_read.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHY
--   public.parties has been readable, for every non-admin role, only
--   while the owning election is `is_active` or `results_published`
--   (052:443 "parties scoped readable").  Under the 058 lifecycle
--   `is_active` does NOT mean "the current election" -- it is turned on
--   only when the Electoral Board opens VOTING (012:119, 063:72).  So
--   through the whole application / campaign / fingerprint-registration
--   window the parties were invisible to students and to the public
--   slate.  The app reads a candidate's party by PostgREST resource
--   embedding -- candidates select "*, parties(name)" (supabaseData.ts,
--   mapped by mapCandidate) -- so an embed the viewer may not read comes
--   back null and EVERY candidate renders as "Independent" on the
--   student / public Current Election page.
--
--   That was masked until now because the public slate used to be gated
--   on is_active = true (only shown once voting began -- the very stage
--   where parties became readable).  getCurrentPublicElection() now
--   publicises the slate from the Campaign stage, which exposed the
--   mismatch.
--
--   052's own comment already states the intent this policy fails to
--   implement: "parties: readable only for the live or already-published
--   elections."  This migration makes the code match that sentence.
--
-- WHAT
--   Re-issue "parties scoped readable" with one added leg: a party is
--   readable when it belongs to the CURRENT election, using the same
--   app-wide rule as candidates, election_periods and 067's live view --
--     election_period_id = public.current_election_period_id()
--   current_election_period_id() (058:91) is SECURITY DEFINER, STABLE and
--   already granted to anon/authenticated, so an anon reader can resolve
--   it.  The admin leg and the published-results leg are kept verbatim.
--
--   This does NOT widen what is already public: 001:558 lets anon read
--   every status = 'approved' candidate at any stage, so the slate (and
--   therefore the party names on it) is not more sensitive than the
--   candidate rows already exposed.  Only the CURRENT period is added;
--   retired (completed) periods with no published results stay hidden.
-- =====================================================================

begin;

set search_path = public, extensions;

drop policy if exists "parties scoped readable" on public.parties;

create policy "parties scoped readable"
  on public.parties
  for select
  using (
    public.current_app_role() = 'admin'
    or parties.election_period_id = public.current_election_period_id()
    or exists (
      select 1
      from public.election_periods e
      where e.id = parties.election_period_id
        and (e.is_active or e.results_published)
    )
  );

-- 058:818 revoked EXECUTE from PUBLIC; re-assert the roles that read the
-- policy (the public slate is anon) so the predicate never raises
-- "permission denied" and silently drops the row.
grant execute on function public.current_election_period_id() to anon, authenticated;

commit;
