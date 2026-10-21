-- =====================================================================
-- 085 — ARCHIVE COMPLAINTS WITH THE ELECTION PERIOD
--
-- When an election is reset (or its results are frozen through any of
-- the archive paths), its complaint record must travel with it.  Until
-- now the past-election snapshot tables (061/064/065) carried only the
-- tallies; the complaints a period accumulated stayed readable solely
-- through the live `complaints` table, which is scoped to the current
-- session and loses its names the moment a student or commissioner row
-- is removed (on delete set null).
--
-- What this migration does:
--   1. Creates `past_election_complaints` — a snapshot table in the
--      061/064 style: denormalized text (student name, resolver name),
--      no foreign keys to live rows, only `election_period_id` keeps
--      the archive attached to its period.
--   2. RLS — ADMIN-ONLY READ.  Unlike the public tally snapshots, a
--      complaint carries a student's name and the complaint text, so
--      the frozen rows are readable only by the admin path
--      (`current_app_role() = 'admin'`, the 028 complaints pattern).
--      Writes are revoked from every client role; the definer writer
--      below is the only mutation path.
--   3. Re-issues `archive_election_results_internal` (the 065 body,
--      verbatim, plus one complaint-freeze block).  Every archive path
--      funnels through this single writer — publish (081), proclaim
--      (081), the manual Electoral-Board freeze (061) and, most
--      importantly, the reset (`reset_election_plan_rpc`, 078) — so
--      resetting an election archives its complaints along with it.
--      The freeze is replace-never-accumulate, like every snapshot
--      here, so re-running an archive stays idempotent.
--
-- Nothing is deleted from the live `complaints` table: elections are
-- never deleted (052) and neither are their complaints — the snapshot
-- is a frozen, independent copy of the record.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — SNAPSHOT TABLE
-- ---------------------------------------------------------------------
create table if not exists public.past_election_complaints (
  id uuid primary key default gen_random_uuid(),
  election_period_id uuid not null references public.election_periods(id) on delete restrict,
  -- Traceability only — deliberately NOT a foreign key, so the archive
  -- never depends on a live row surviving (064 independence rule).
  complaint_id uuid,
  student_name text,
  subject text not null,
  description text not null,
  status text not null,
  submitted_at timestamptz,
  incident_date timestamptz,
  resolution_note text,
  resolved_by_name text,
  resolved_at timestamptz,
  archived_document_url text,
  snapshot_at timestamptz not null default now()
);

create index if not exists past_election_complaints_period_idx
  on public.past_election_complaints (election_period_id);

-- ---------------------------------------------------------------------
-- SECTION 2 — RLS AND TABLE GRANTS (ADMIN-ONLY READ)
--   The 028 complaints rule: the admin path reads every row, everyone
--   else reads none.  The definer writer below bypasses RLS.
-- ---------------------------------------------------------------------
alter table public.past_election_complaints enable row level security;

drop policy if exists past_election_complaints_admin_read
  on public.past_election_complaints;
create policy past_election_complaints_admin_read
  on public.past_election_complaints for select using (
    public.current_app_role() = 'admin'
  );

revoke insert, update, delete, truncate, references, trigger
  on table public.past_election_complaints
  from public, anon, authenticated;

grant select on table public.past_election_complaints to anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 3 — THE WRITER (NO ROLE GATE — internal, like 061/065)
--   The 065 body verbatim, plus the complaint freeze.  Kept as a full
--   re-issue (create or replace) because plpgsql bodies are replaced
--   wholesale — there is no additive alter.
-- ---------------------------------------------------------------------
create or replace function public.archive_election_results_internal(
  p_election_period_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_proclaimed_ids uuid[] := '{}'::uuid[];
begin
  if p_election_period_id is null then
    raise exception 'Election period is required.';
  end if;

  if not exists (
    select 1 from public.election_periods e where e.id = p_election_period_id
  ) then
    raise exception 'Election period not found.';
  end if;

  -- Proclaimed winners come from the proclamations ledger, which is optional
  -- in this deployment and therefore cannot be named in a static query.  The
  -- relation AND its columns are checked, matching 052/053 tolerance.
  if to_regclass('public.proclamations') is not null
     and (
       select count(*) = 2
       from information_schema.columns col
       where col.table_schema = 'public'
         and col.table_name = 'proclamations'
         and col.column_name in ('candidate_id', 'election_period_id')
     ) then
    execute
      'select coalesce(array_agg(pr.candidate_id::uuid), ''{}''::uuid[])
          from public.proclamations pr
         where pr.election_period_id = $1
           and pr.candidate_id is not null'
    into v_proclaimed_ids
    using p_election_period_id;
  end if;

  -- Replace, never accumulate: a re-run has to be idempotent.
  delete from public.past_election_candidates where election_period_id = p_election_period_id;
  delete from public.past_election_positions  where election_period_id = p_election_period_id;
  delete from public.past_election_periods    where election_period_id = p_election_period_id;
  delete from public.past_parties             where election_period_id = p_election_period_id;
  delete from public.past_election_complaints where election_period_id = p_election_period_id;

  insert into public.past_election_candidates (
    election_period_id,
    position,
    candidate_name,
    grade_level,
    party_name,
    picture_url,
    votes,
    total_votes,
    is_winner,
    proclaimed_winner
  )
  select
    p_election_period_id,
    r.position,
    r.candidate_name,
    r.grade_level,
    r.party_name,
    r.picture_url,
    r.votes,
    r.race_total,
    (r.votes > 0 and r.votes = r.top_votes),
    (r.candidate_id = any(v_proclaimed_ids))
  from (
    select
      ct.*,
      max(ct.votes) over (partition by ct.position) as top_votes,
      sum(ct.votes) over (partition by ct.position) as race_total
    from (
      select
        c.id as candidate_id,
        c.position,
        btrim(concat_ws(' ', c.given_name, c.middle_name, c.surname, c.extension_name)) as candidate_name,
        c.grade_level,
        c.picture_url,
        p.name as party_name,
        coalesce(t.votes, 0)::integer as votes
      from public.candidates c
      left join public.parties p on p.id = c.party_id
      left join lateral (
        select count(*)::integer as votes
        from public.votes v
        where v.candidate_id = c.id
      ) t on true
      where c.election_period_id = p_election_period_id
        and c.status = 'approved'
    ) ct
  ) r;

  insert into public.past_election_positions (
    election_period_id,
    position,
    votes_cast,
    abstentions
  )
  select distinct on (b.position)
    p_election_period_id,
    b.position,
    (sum(b.votes) over (partition by b.position))::integer,
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
        and v."position" = b.position
        and v.abstained is true
    )
  from (
    select
      c.position,
      coalesce(t.votes, 0)::integer as votes
    from public.candidates c
    left join lateral (
      select count(*)::integer as votes
      from public.votes v
      where v.candidate_id = c.id
    ) t on true
    where c.election_period_id = p_election_period_id
      and c.status = 'approved'
  ) b
  order by b.position, b.votes desc;

  insert into public.past_election_periods (
    election_period_id,
    positions_contested,
    approved_candidates,
    votes_cast,
    abstentions,
    total_ballots
  )
  select
    p_election_period_id,
    (
      select count(distinct c.position)::integer
      from public.candidates c
      where c.election_period_id = p_election_period_id
        and c.status = 'approved'
    ),
    (
      select count(*)::integer
      from public.candidates c
      where c.election_period_id = p_election_period_id
        and c.status = 'approved'
    ),
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
        and v.abstained is not true
    ),
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
        and v.abstained is true
    ),
    (
      select count(*)::integer
      from public.votes v
      where v.election_period_id = p_election_period_id
    );

  -- past_parties is derived from the candidates just frozen, so the party
  -- list and the per-candidate party_name can never disagree.
  insert into public.past_parties (election_period_id, party_name)
  select distinct
    pc.election_period_id,
    pc.party_name
  from public.past_election_candidates pc
  where pc.election_period_id = p_election_period_id
    and pc.party_name is not null
    and btrim(pc.party_name) <> '';

  -- 085 — the period's complaint record is part of the archive.  Every
  -- complaint filed against this election is frozen with its final
  -- status, the student's name (the live FK is `on delete set null`,
  -- so only the snapshot keeps it forever) and the deciding
  -- commissioner's name.  Filed-but-never-decided complaints freeze
  -- with their filed status — the record must show what happened AND
  -- what was left open.
  insert into public.past_election_complaints (
    election_period_id,
    complaint_id,
    student_name,
    subject,
    description,
    status,
    submitted_at,
    incident_date,
    resolution_note,
    resolved_by_name,
    resolved_at,
    archived_document_url
  )
  select
    p_election_period_id,
    c.id,
    nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
    c.subject,
    c.description,
    c.status,
    c.submitted_at,
    c.incident_date,
    c.resolution_note,
    ap.full_name,
    c.resolved_at,
    c.archived_document_url
  from public.complaints c
  left join public.students s on s.id = c.student_id
  left join public.adminprofiles ap on ap.id = c.resolved_by
  where c.election_period_id = p_election_period_id;
end;
$$;
