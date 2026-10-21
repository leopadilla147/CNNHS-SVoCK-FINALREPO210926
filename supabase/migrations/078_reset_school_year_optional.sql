-- =====================================================================
-- 078_reset_school_year_optional.sql
-- AGENTS.md: DB changes ship as numbered migration files; the USER
-- applies them in Supabase.  Idempotent and safe to re-run.
--
-- WHAT
--   reset_election_plan_rpc(text, text) — 066:33 body re-issued with two
--   behaviour changes so the School Year is chosen in Stage 1 (Candidate
--   Application Period), not in the Reset dialog:
--
--     1. Nothing in progress → no-op success (mode 'noop') instead of
--        raising "Provide a school year to start one".
--     2. Dirty period (has candidates/votes) with NO p_school_year →
--        archive-only: the period is retired and its tally frozen, but no
--        new election_periods row is created.  The Commissioner then sets
--        the School Year in Stage 1 and start_candidacy_period_rpc
--        (058:130) creates the period there.  Passing p_school_year keeps
--        the 066 archive-and-start behaviour for backward compatibility.
--
--   The in-place "clean" branch is untouched: a period with no candidates
--   and no votes is cleared back to 'application' with its school year.
-- =====================================================================

begin;

set search_path = public, extensions;

create or replace function public.reset_election_plan_rpc(
  p_password text,
  p_school_year text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_role text;
  v_hash text;
  v_current uuid;
  v_archived uuid;
  v_new_id uuid;
  v_school_year text;
  v_dirty boolean;
  v_had_candidates integer;
  v_had_votes integer;
begin
  v_actor := public.current_session_user_id();
  if v_actor is null then
    raise exception 'Not authenticated.';
  end if;

  v_role := public.current_commissioner_role();
  if v_role is null or v_role not in ('electoral_board', 'chief') then
    raise exception 'Only the Commissioner of Electoral Board can reset the election plan.';
  end if;

  if p_password is null or p_password = '' then
    raise exception 'Password is required.';
  end if;

  select a.password_hash into v_hash
    from public.adminprofiles a
   where a.id = v_actor;

  if v_hash is null then
    raise exception 'Password is incorrect.';
  end if;

  if starts_with(coalesce(v_hash, ''), '$2') then
    if v_hash is distinct from crypt(p_password, v_hash) then
      raise exception 'Password is incorrect.';
    end if;
  else
    if v_hash is distinct from encode(sha256(convert_to(p_password, 'UTF8')), 'hex') then
      raise exception 'Password is incorrect.';
    end if;
  end if;

  v_current := public.current_election_period_id();

  -- 078: nothing to reset is a no-op, not an error.  The School Year for
  -- the next election is set in Stage 1, not here.
  if v_current is null then
    return jsonb_build_object(
      'election_period_id', null,
      'archived_previous', false,
      'archived_election_period_id', null,
      'school_year', null,
      'mode', 'noop'
    );
  end if;

  select
    (select count(*) from public.candidates c where c.election_period_id = v_current),
    (select count(*) from public.votes v where v.election_period_id = v_current)
    into v_had_candidates, v_had_votes;

  v_dirty := (v_had_candidates > 0) or (v_had_votes > 0);

  if not v_dirty then
    update public.election_periods
       set candidacy_open = false,
           is_active = false,
           results_published = false,
           proclaimed = false,
           proclaimed_at = null,
           election_date = null,
           end_date = null,
           rules_discussion_at = null,
           fingerprint_registration_start_at = null,
           fingerprint_registration_end_at = null,
           lifecycle_stage = 'application'
     where id = v_current;

    v_new_id := v_current;
    v_school_year := (select e.school_year from public.election_periods e where e.id = v_current);
  else
    -- Archive.  Nothing is deleted: candidates and votes keep pointing
    -- at this row.  Marking it completed is what turns the official
    -- result into a past election.
    update public.election_periods
       set lifecycle_stage = 'completed',
           candidacy_open = false,
           is_active = false
     where id = v_current;

    -- 066: freeze the retiring period's tally into the past-election
    -- snapshot at the moment it becomes history.  Idempotent.
    perform public.archive_election_results_internal(v_current);

    v_archived := v_current;
    v_school_year := nullif(btrim(coalesce(p_school_year, '')), '');

    if v_school_year is not null then
      -- Legacy 066 path: a school year was passed explicitly, so the next
      -- period is started in the same transaction.
      if exists (select 1 from public.election_periods where school_year = v_school_year) then
        raise exception 'An election period already exists for school year %. Choose a different school year.', v_school_year;
      end if;

      insert into public.election_periods (school_year, lifecycle_stage, candidacy_open, created_by)
      values (v_school_year, 'application', false, v_actor)
      returning id into v_new_id;
    end if;
    -- 078: without a school year the archive stands alone; the next
    -- period is created later by start_candidacy_period_rpc (Stage 1).
  end if;

  insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
  values (
    v_actor,
    'Commissioner of Electoral Board',
    'admin',
    'Election Plan Reset',
    case
      when v_dirty and v_new_id is not null
        then 'Archived election period ' || v_archived::text || ' (' || v_had_candidates
             || ' candidate(s), ' || v_had_votes || ' vote(s) retained) and started a new period for '
             || v_school_year || '.'
      when v_dirty
        then 'Archived election period ' || v_archived::text || ' (' || v_had_candidates
             || ' candidate(s), ' || v_had_votes || ' vote(s) retained). The next school year will be set when the Candidate Application Period starts.'
      else 'Cleared the election plan in place for school year ' || v_school_year
           || '. No candidates or votes were present.'
    end,
    'warning'
  );

  return jsonb_build_object(
    'election_period_id', v_new_id,
    'archived_previous', v_dirty,
    'archived_election_period_id', case when v_dirty then v_archived else null end,
    'school_year', v_school_year,
    'mode', case when v_dirty then 'archived' else 'cleared' end
  );
end;
$$;

revoke all on function public.reset_election_plan_rpc(text, text) from public, anon, authenticated;
grant execute on function public.reset_election_plan_rpc(text, text) to anon, authenticated;

commit;
