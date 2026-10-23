-- 096_complaint_evidence.sql
-- =============================================================
-- Supporting evidence for complaints (student) and for the
-- Grievance Commissioner's Findings.
--
-- WHY
--   Students could only describe a complaint in text, and the
--   Commissioner could only record a text Findings note.  Both need
--   to attach files/pictures: the student to prove what happened, the
--   Commissioner to back the resolution.
--
-- WHAT
--   1. complaints.evidence_urls jsonb (student evidence, default [])
--      + complaints.findings_evidence_urls jsonb (Commissioner
--      evidence, default []).  Each element is {"url","name"}.
--   2. storage bucket 'complaint-evidence' — public read, 10 MB,
--      jpeg/png/webp/pdf/doc/docx.  The write policy carries NO
--      auth.uid() condition: the custom session-spine auth leaves
--      auth.uid() null on the storage path (020/072/073 precedent).
--   3. sanitize_complaint_evidence() BEFORE INSERT/UPDATE trigger —
--      the student INSERT has no RPC, so the trigger is what keeps
--      both columns limited to complaint-evidence bucket URLs.
--   4. decide_complaint_rpc re-issued (092 body) with a new
--      p_findings_evidence jsonb param, so the Commissioner's
--      evidence is written in the SAME atomic call as the decision.
--      URLs are validated against the complaint-evidence namespace.
--
-- Idempotent; wrapped in one transaction.  Apply manually via the
-- Supabase Dashboard (AGENTS.md) — never applied by the executor.
--
-- Apply in numeric order, after 095.
-- =============================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Columns (additive, existing rows default to an empty array)
-- ---------------------------------------------------------------------
alter table public.complaints
  add column if not exists evidence_urls jsonb not null default '[]'::jsonb;

alter table public.complaints
  add column if not exists findings_evidence_urls jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- 2) Bucket + storage policies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('complaint-evidence', 'complaint-evidence', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "complaint evidence public read" on storage.objects;
create policy "complaint evidence public read" on storage.objects
  for select
  using (bucket_id = 'complaint-evidence');

-- No auth.uid() condition — same custom-auth relaxation 020/072 applied
-- to candidate-pictures / student-pictures; the trigger + RPC below gate
-- what URL is ever persisted on a complaint row.
drop policy if exists "complaint evidence public write" on storage.objects;
create policy "complaint evidence public write" on storage.objects
  for insert
  with check (bucket_id = 'complaint-evidence');

-- ---------------------------------------------------------------------
-- 3) Sanitize trigger — the ONLY guard on the student INSERT path
-- ---------------------------------------------------------------------
-- Keeps only entries whose url lives in the complaint-evidence bucket's
-- public object namespace; anything else is dropped from the array.
-- Runs on INSERT (student filing) and UPDATE (RPC writes included).
create or replace function public.sanitize_complaint_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.evidence_urls := coalesce(
    (select jsonb_agg(elem)
       from jsonb_array_elements(coalesce(new.evidence_urls, '[]'::jsonb)) as t(elem)
      where position('/storage/v1/object/public/complaint-evidence/' in coalesce(elem->>'url', '')) > 0),
    '[]'::jsonb
  );

  new.findings_evidence_urls := coalesce(
    (select jsonb_agg(elem)
       from jsonb_array_elements(coalesce(new.findings_evidence_urls, '[]'::jsonb)) as t(elem)
      where position('/storage/v1/object/public/complaint-evidence/' in coalesce(elem->>'url', '')) > 0),
    '[]'::jsonb
  );

  return new;
end;
$$;

drop trigger if exists trg_sanitize_complaint_evidence on public.complaints;
create trigger trg_sanitize_complaint_evidence
  before insert or update on public.complaints
  for each row
  execute function public.sanitize_complaint_evidence();

-- ---------------------------------------------------------------------
-- 4) decide_complaint_rpc (092 body) + p_findings_evidence
-- ---------------------------------------------------------------------
drop function if exists public.decide_complaint_rpc(uuid, text, text, text);

create or replace function public.decide_complaint_rpc(
  p_complaint_id uuid,
  p_action text,
  p_reason text default null,
  p_findings text default null,
  p_findings_evidence jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject text;
  v_findings text;
  v_actor_name text;
  v_elem jsonb;
begin
  if public.current_commissioner_role() <> 'grievance' then
    raise exception 'Forbidden: only the Commissioner of Grievance can decide complaints.';
  end if;

  if p_action <> 'accepted' then
    raise exception 'Action must be ''accepted'' - complaints are resolved with Findings (087 model).';
  end if;

  select subject, findings_note into v_subject, v_findings
    from public.complaints
   where id = p_complaint_id and status = 'filed';

  if not found then
    raise exception 'Complaint not found or not in filed status.';
  end if;

  -- 091: the resolve call may carry the Findings itself.  A non-blank
  -- p_findings wins; otherwise the already-saved note stands.
  v_findings := coalesce(nullif(btrim(coalesce(p_findings, '')), ''), v_findings);

  -- 090: the Findings note is the official explanation - mandatory first.
  if v_findings is null or btrim(v_findings) = '' then
    raise exception 'Findings are required before a complaint can be resolved.';
  end if;

  -- 096: the findings evidence must live in the complaint-evidence bucket.
  if p_findings_evidence is not null and jsonb_typeof(p_findings_evidence) = 'array' then
    for v_elem in select * from jsonb_array_elements(p_findings_evidence) loop
      if position('/storage/v1/object/public/complaint-evidence/' in coalesce(v_elem->>'url', '')) = 0 then
        raise exception 'Findings evidence URL must be a complaint-evidence upload.';
      end if;
    end loop;
  end if;

  -- 092: the deciding Commissioner's name is resolved once, ahead of the
  -- update, so it feeds both the complaint row and the audit log.
  select full_name into v_actor_name
    from public.adminprofiles
   where id = public.current_session_user_id();

  update public.complaints
     set status = 'accepted',
         findings_note = v_findings,
         findings_evidence_urls = coalesce(p_findings_evidence, '[]'::jsonb),
         resolution_note = p_reason,
         resolved_by = public.current_session_user_id(),
         resolved_by_name = v_actor_name,
         resolved_at = now()
   where id = p_complaint_id and status = 'filed';

  -- Audit side-effect (GRIEV-04 pattern): one row per decision.
  perform public.insert_audit_log_rpc(
    public.current_session_user_id(),   -- actor id (020 ignores it; auth.uid() is null under custom auth)
    coalesce(v_actor_name, 'Grievance Commissioner'),
    'admin',                            -- commissioners authenticate via the admin path
    'Resolved Complaint',
    'Complaint "' || v_subject || '" (' || p_complaint_id::text || ') resolved',
    'success'
  );
end;
$$;

-- Grants (028 pattern: revoke PUBLIC, grant clients) - 5-arg signature
revoke all on function public.decide_complaint_rpc(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.decide_complaint_rpc(uuid, text, text, text, jsonb) to anon, authenticated;

commit;
