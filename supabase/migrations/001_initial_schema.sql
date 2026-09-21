  create extension if not exists pgcrypto;

  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('student', 'officer', 'admin')),
    commissioner_role text check (commissioner_role in ('chief', 'screening_validation', 'appointment', 'electoral_board', 'grievance')),
    full_name text,
    created_at timestamptz not null default now()
  );

  alter table public.profiles
    add column if not exists commissioner_role text;

  do $$
  begin
    if not exists (
      select 1 from pg_constraint
      where conname = 'profiles_commissioner_role_check'
        and conrelid = 'public.profiles'::regclass
    ) then
      alter table public.profiles
        add constraint profiles_commissioner_role_check
        check (commissioner_role in ('chief', 'screening_validation', 'appointment', 'electoral_board', 'grievance'));
    end if;
  end $$;

  create or replace function public.current_app_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select coalesce(
      auth.jwt() ->> 'app_role',
      auth.jwt() -> 'user_metadata' ->> 'role',
      (select role from public.profiles where id = auth.uid())
    );
  $$;

  create or replace function public.current_commissioner_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select coalesce(
      auth.jwt() -> 'user_metadata' ->> 'commissioner_role',
      (select commissioner_role from public.profiles where id = auth.uid())
    );
  $$;

  create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    insert into public.profiles (id, role, commissioner_role, full_name)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'role', 'student'),
      new.raw_user_meta_data ->> 'commissioner_role',
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
    )
    on conflict (id) do update
      set role = excluded.role,
          commissioner_role = excluded.commissioner_role,
          full_name = excluded.full_name;
    return new;
  end;
  $$;

  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

  create table if not exists public.student_masterlist (
    id uuid primary key default gen_random_uuid(),
    lrn text not null check (lrn ~ '^[0-9]{12}$'),
    first_name text not null,
    last_name text not null,
    birthdate date not null,
    grade_level text not null check (grade_level in ('Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12')),
    gender text check (gender in ('Male', 'Female')),
    school_year text not null,
    enrollment_status text not null default 'enrolled' check (enrollment_status in ('enrolled', 'transferred', 'graduated', 'inactive')),
    imported_by uuid references public.profiles(id),
    imported_at timestamptz not null default now(),
    unique (lrn, school_year)
  );

  create table if not exists public.students (
    id uuid primary key default gen_random_uuid(),
    student_id uuid unique references auth.users(id) on delete set null,
    masterlist_id uuid references public.student_masterlist(id),
    first_name text not null,
    middle_name text,
    last_name text not null,
    grade_level text not null check (grade_level in ('Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12')),
    gender text not null check (gender in ('Male', 'Female')),
    birthdate date not null,
    lrn text not null unique check (lrn ~ '^[0-9]{12}$'),
    email text not null unique,
    password_hash text,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    verification_status text not null default 'forReview' check (verification_status in ('autoApproved', 'forReview', 'blocked')),
    mismatch_count integer not null default 0 check (mismatch_count >= 0),
    registered_at timestamptz not null default now(),
    reviewed_by uuid references public.profiles(id),
    reviewed_at timestamptz
  );

  alter table public.students
    add column if not exists student_id uuid references auth.users(id) on delete set null,
    add column if not exists masterlist_id uuid references public.student_masterlist(id),
    add column if not exists password_hash text,
    add column if not exists verification_status text not null default 'forReview',
    add column if not exists mismatch_count integer not null default 0;

  alter table public.students
    alter column student_id drop not null;

  create unique index if not exists students_student_id_key
    on public.students (student_id)
    where student_id is not null;

  create or replace function public.login_student_direct(p_email text, p_password_hash text)
  returns table (
    id uuid,
    first_name text,
    last_name text,
    email text,
    status text
  )
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select s.id, s.first_name, s.last_name, s.email, s.status
    from public.students s
    where lower(s.email) = lower(p_email)
      and s.password_hash = p_password_hash
    limit 1;
  $$;

  create table if not exists public.commissioners (
    id uuid primary key default gen_random_uuid(),
    auth_id uuid unique references auth.users(id) on delete set null,
    name text not null,
    email text not null unique,
    commissioner_role text not null unique check (commissioner_role in ('chief', 'screening_validation', 'appointment', 'electoral_board', 'grievance')),
    status text not null default 'active' check (status in ('active', 'inactive')),
    appointed_by uuid references public.profiles(id),
    appointed_at timestamptz not null default now()
  );

  create table if not exists public.officers (
    id uuid primary key default gen_random_uuid(),
    auth_id uuid unique references auth.users(id) on delete set null,
    name text not null,
    email text not null unique,
    position text not null,
    grade_level text,
    term_start date,
    term_end date,
    status text not null default 'active' check (status in ('active', 'inactive')),
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now()
  );

  alter table public.officers
    add column if not exists auth_id uuid references auth.users(id) on delete set null,
    add column if not exists position text,
    add column if not exists grade_level text,
    add column if not exists term_start date,
    add column if not exists term_end date;

  alter table public.officers
    alter column auth_id drop not null;

  create unique index if not exists officers_auth_id_key
    on public.officers (auth_id)
    where auth_id is not null;

  create table if not exists public.election_periods (
    id uuid primary key default gen_random_uuid(),
    school_year text not null,
    start_at timestamptz,
    end_at timestamptz,
    candidacy_open boolean not null default false,
    nomination_open boolean not null default false,
    is_active boolean not null default false,
    results_published boolean not null default false,
    venue text,
    created_by uuid references public.profiles(id),
    updated_at timestamptz not null default now(),
    check (start_at is null or end_at is null or end_at > start_at)
  );

  alter table public.election_periods
    add column if not exists school_year text not null default '2026-2027',
    add column if not exists start_at timestamptz,
    add column if not exists end_at timestamptz,
    add column if not exists candidacy_open boolean not null default false,
    add column if not exists nomination_open boolean not null default false,
    add column if not exists results_published boolean not null default false;

  alter table public.election_periods
    alter column start_at drop not null,
    alter column end_at drop not null;

  create unique index if not exists one_active_election
    on public.election_periods (is_active)
    where is_active = true;

  create table if not exists public.parties (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    description text,
    president_student_id uuid references public.students(id),
    created_at timestamptz not null default now()
  );

  create table if not exists public.candidates (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    election_period_id uuid not null references public.election_periods(id) on delete cascade,
    surname text not null,
    given_name text not null,
    middle_name text,
    extension_name text,
    grade_level text not null,
    position text not null check (position in ('President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor', 'PRO', 'PIO', 'Protocol Officer', 'Grade 7 Representative', 'Grade 8 Representative', 'Grade 9 Representative', 'Grade 10 Representative', 'Grade 11 Representative', 'Grade 12 Representative')),
    party_id uuid references public.parties(id),
    gender text not null check (gender in ('Male', 'Female')),
    date_of_birth date not null,
    age integer not null,
    email text not null,
    mobile_number text not null,
    landline text,
    home_address text not null,
    parent_guardian_name text,
    parent_guardian_contact text,
    picture_url text,
    leadership_profile jsonb,
    doc_application_form boolean not null default false,
    doc_introductory_profile boolean not null default false,
    doc_screening_form boolean not null default false,
    doc_report_card boolean not null default false,
    doc_good_moral_cert boolean not null default false,
    doc_eaf_front boolean not null default false,
    doc_eaf_back boolean not null default false,
    eaf_front_url text,
    eaf_back_url text,
    position_approval_status text default 'notRequired'
      check (position_approval_status in ('notRequired', 'presidentApprovalRequired', 'presidentApproved')),
    status text not null default 'pending' check (status in ('ongoingSubmission', 'pending', 'approved', 'rejected')),
    forwarded_by uuid references public.profiles(id),
    forwarded_at timestamptz,
    reviewed_by uuid references public.profiles(id),
    reviewed_at timestamptz,
    submitted_at timestamptz not null default now(),
    unique (student_id, election_period_id),
    unique (election_period_id, party_id, position)
  );

  alter table public.candidates
    add column if not exists parent_guardian_name text,
    add column if not exists parent_guardian_contact text,
    add column if not exists leadership_profile jsonb;

  alter table public.candidates drop constraint if exists candidates_position_check;
  alter table public.candidates
    add constraint candidates_position_check
    check (position in ('President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor', 'PRO', 'PIO', 'Protocol Officer', 'Grade 7 Representative', 'Grade 8 Representative', 'Grade 9 Representative', 'Grade 10 Representative', 'Grade 11 Representative', 'Grade 12 Representative'));

  alter table public.candidates drop constraint if exists candidates_grade_position_match;
  alter table public.candidates
    add constraint candidates_grade_position_match
    check (
      position not like '%Representative'
      or grade_level = replace(position, ' Representative', '')
    );

  create table if not exists public.nominations (
    id uuid primary key default gen_random_uuid(),
    election_period_id uuid references public.election_periods(id) on delete cascade,
    nominee_student_id uuid not null references public.students(id) on delete cascade,
    nominee_name text not null,
    position text not null,
    nominated_by_student_id uuid references public.students(id),
    nominated_by_name text,
    reason text,
    reply_slip_url text,
    status text not null default 'submitted' check (status in ('submitted', 'replySlipPending', 'accepted', 'declined', 'appointmentReview', 'appointed', 'rejected')),
    reviewed_by uuid references public.profiles(id),
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table if not exists public.votes (
    id uuid primary key default gen_random_uuid(),
    election_period_id uuid not null references public.election_periods(id) on delete cascade,
    voter_id uuid not null references public.students(id) on delete cascade,
    candidate_id uuid not null references public.candidates(id) on delete cascade,
    position text not null,
    kiosk_id uuid,
    offline_vote_id text unique,
    voted_at timestamptz not null default now(),
    unique (voter_id, position, election_period_id)
  );

  alter table public.votes
    add column if not exists kiosk_id uuid,
    add column if not exists offline_vote_id text;

  create unique index if not exists votes_offline_vote_id_key
    on public.votes (offline_vote_id)
    where offline_vote_id is not null;

  create table if not exists public.biometric_templates (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null unique references public.students(id) on delete cascade,
    encrypted_template bytea not null,
    key_fingerprint text not null,
    captured_by_kiosk_id uuid,
    captured_at timestamptz not null default now(),
    scheduled_delete_at timestamptz,
    deleted_at timestamptz
  );

  create table if not exists public.kiosk_devices (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    location text not null,
    device_public_key text,
    sync_status text not null default 'offline' check (sync_status in ('online', 'offline', 'syncing')),
    queued_votes integer not null default 0,
    last_seen_at timestamptz,
    registered_at timestamptz not null default now()
  );

  create table if not exists public.kiosk_ballot_cache (
    id uuid primary key default gen_random_uuid(),
    kiosk_id uuid not null references public.kiosk_devices(id) on delete cascade,
    election_period_id uuid not null references public.election_periods(id) on delete cascade,
    ballot_hash text not null,
    cached_at timestamptz not null default now(),
    expires_at timestamptz not null,
    unique (kiosk_id, election_period_id)
  );

  create table if not exists public.kiosk_vote_queue (
    id uuid primary key default gen_random_uuid(),
    kiosk_id uuid not null references public.kiosk_devices(id) on delete cascade,
    election_period_id uuid not null references public.election_periods(id) on delete cascade,
    offline_vote_id text not null unique,
    encrypted_payload bytea not null,
    conflict_status text not null default 'pending' check (conflict_status in ('pending', 'synced', 'duplicate', 'invalid', 'conflict')),
    queued_at timestamptz not null,
    synced_at timestamptz,
    resolution_note text
  );

  create table if not exists public.complaints (
    id uuid primary key default gen_random_uuid(),
    election_period_id uuid references public.election_periods(id) on delete cascade,
    student_id uuid references public.students(id) on delete set null,
    subject text not null,
    description text not null,
    status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
    submitted_at timestamptz not null default now(),
    resolved_by uuid references public.profiles(id),
    resolved_at timestamptz,
    resolution_note text,
    archived_document_url text
  );

  alter table public.complaints
    add column if not exists election_period_id uuid references public.election_periods(id) on delete cascade,
    add column if not exists student_id uuid references public.students(id) on delete set null,
    add column if not exists archived_document_url text;

  alter table public.complaints
    alter column election_period_id drop not null,
    alter column student_id drop not null;

  create table if not exists public.archived_documents (
    id uuid primary key default gen_random_uuid(),
    source_table text not null,
    source_id uuid,
    title text not null,
    document_url text,
    archived_by uuid references public.profiles(id),
    archived_at timestamptz not null default now()
  );

  create table if not exists public.report_templates (
    id uuid primary key default gen_random_uuid(),
    enclosure text not null unique,
    title text not null,
    owner_role text not null,
    category text not null check (category in ('candidacy', 'appointment', 'grievance', 'results', 'audit', 'forms'))
  );

  create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    timestamp timestamptz not null default now(),
    actor_id uuid references public.profiles(id),
    actor_name text not null,
    actor_role text not null check (actor_role in ('admin', 'officer', 'student', 'system')),
    action text not null,
    details text not null,
    type text not null check (type in ('info', 'success', 'warning', 'error')),
    ip_address inet
  );

  create or replace function public.touch_updated_at()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;

  drop trigger if exists touch_election_periods_updated_at on public.election_periods;
  create trigger touch_election_periods_updated_at
    before update on public.election_periods
    for each row execute function public.touch_updated_at();

  create or replace function public.log_vote_insert()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    insert into public.audit_logs (actor_name, actor_role, action, details, type)
    values ('Kiosk', 'system', 'Vote Cast', 'Vote recorded for election ' || new.election_period_id || ' position ' || new.position, 'success');
    return new;
  end;
  $$;

  drop trigger if exists audit_vote_insert on public.votes;
  create trigger audit_vote_insert
    after insert on public.votes
    for each row execute function public.log_vote_insert();

  create or replace function public.log_status_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      insert into public.audit_logs (actor_id, actor_name, actor_role, action, details, type)
      values (auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), 'System'), coalesce(public.current_app_role(), 'system'), tg_table_name || ' Status Changed', 'Status changed from ' || old.status || ' to ' || new.status, 'info');
    end if;
    return new;
  end;
  $$;

  drop trigger if exists audit_student_status on public.students;
  create trigger audit_student_status after update on public.students for each row execute function public.log_status_change();
  drop trigger if exists audit_candidate_status on public.candidates;
  create trigger audit_candidate_status after update on public.candidates for each row execute function public.log_status_change();
  drop trigger if exists audit_complaint_status on public.complaints;
  create trigger audit_complaint_status after update on public.complaints for each row execute function public.log_status_change();
  drop trigger if exists audit_nomination_status on public.nominations;
  create trigger audit_nomination_status after update on public.nominations for each row execute function public.log_status_change();

  create or replace function public.purge_graduated_student_private_data()
  returns integer
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    removed_count integer;
  begin
    update public.biometric_templates bt
    set deleted_at = now()
    from public.students s
    join public.student_masterlist sm on sm.id = s.masterlist_id
    where bt.student_id = s.id
      and sm.enrollment_status = 'graduated'
      and bt.deleted_at is null;
    get diagnostics removed_count = row_count;
    return removed_count;
  end;
  $$;

  alter table public.profiles enable row level security;
  alter table public.student_masterlist enable row level security;
  alter table public.students enable row level security;
  alter table public.commissioners enable row level security;
  alter table public.officers enable row level security;
  alter table public.election_periods enable row level security;
  alter table public.parties enable row level security;
  alter table public.candidates enable row level security;
  alter table public.nominations enable row level security;
  alter table public.votes enable row level security;
  alter table public.biometric_templates enable row level security;
  alter table public.kiosk_devices enable row level security;
  alter table public.kiosk_ballot_cache enable row level security;
  alter table public.kiosk_vote_queue enable row level security;
  alter table public.complaints enable row level security;
  alter table public.archived_documents enable row level security;
  alter table public.report_templates enable row level security;
  alter table public.audit_logs enable row level security;

  drop policy if exists "profiles admin all" on public.profiles;
  create policy "profiles admin all" on public.profiles for all using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
  drop policy if exists "profiles own select" on public.profiles;
  create policy "profiles own select" on public.profiles for select using (id = auth.uid());

  drop policy if exists "masterlist admin all" on public.student_masterlist;
  create policy "masterlist admin all" on public.student_masterlist for all using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
  drop policy if exists "masterlist registration lookup" on public.student_masterlist;
  create policy "masterlist registration lookup" on public.student_masterlist for select using (enrollment_status = 'enrolled');

  drop policy if exists "students admin all" on public.students;
  create policy "students admin all" on public.students for all using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
  drop policy if exists "students self access" on public.students;
  create policy "students self access" on public.students for select using (student_id = auth.uid() or email = auth.email());
  drop policy if exists "students public registration insert" on public.students;
  create policy "students public registration insert" on public.students for insert with check (true);

  drop policy if exists "commissioners readable" on public.commissioners;
  create policy "commissioners readable" on public.commissioners for select using (true);
  drop policy if exists "commissioners chief all" on public.commissioners;
  create policy "commissioners chief all" on public.commissioners for all using (public.current_commissioner_role() = 'chief') with check (public.current_commissioner_role() = 'chief');

  drop policy if exists "officers readable" on public.officers;
  create policy "officers readable" on public.officers for select using (true);
  drop policy if exists "officers admin all" on public.officers;
  create policy "officers admin all" on public.officers for all using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

  drop policy if exists "election periods readable" on public.election_periods;
  create policy "election periods readable" on public.election_periods for select using (true);
  drop policy if exists "election periods electoral board all" on public.election_periods;
  create policy "election periods electoral board all" on public.election_periods for all using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

  drop policy if exists "parties readable" on public.parties;
  create policy "parties readable" on public.parties for select using (true);
  drop policy if exists "parties authenticated insert" on public.parties;
  create policy "parties authenticated insert" on public.parties for insert with check (auth.uid() is not null or public.current_app_role() = 'admin');

  drop policy if exists "candidates readable" on public.candidates;
  create policy "candidates readable" on public.candidates for select using (
    status = 'approved'
    or public.current_app_role() = 'admin'
    or exists (select 1 from public.students s where s.id = candidates.student_id and (s.student_id = auth.uid() or s.email = auth.email()))
  );
  drop policy if exists "candidates own insert" on public.candidates;
  create policy "candidates own insert" on public.candidates for insert with check (
    exists (select 1 from public.students s where s.id = student_id and s.status = 'approved')
  );
  drop policy if exists "candidates owner admin update" on public.candidates;
  create policy "candidates owner admin update" on public.candidates for update using (
    public.current_app_role() = 'admin'
    or exists (select 1 from public.students s where s.id = candidates.student_id and (s.student_id = auth.uid() or s.email = auth.email()) and candidates.status = 'ongoingSubmission')
  ) with check (true);

  drop policy if exists "nominations role access" on public.nominations;
  create policy "nominations role access" on public.nominations for all using (
    public.current_app_role() = 'admin'
    or exists (select 1 from public.students s where s.id in (nominee_student_id, nominated_by_student_id) and (s.student_id = auth.uid() or s.email = auth.email()))
  ) with check (true);

  drop policy if exists "votes commissioner select" on public.votes;
  create policy "votes commissioner select" on public.votes for select using (public.current_app_role() = 'admin');
  drop policy if exists "votes kiosk insert" on public.votes;
  create policy "votes kiosk insert" on public.votes for insert with check (public.current_app_role() = 'student' or auth.role() = 'service_role');

  drop policy if exists "biometric templates no client read" on public.biometric_templates;
  create policy "biometric templates no client read" on public.biometric_templates for select using (false);
  drop policy if exists "biometric templates service only" on public.biometric_templates;
  create policy "biometric templates service only" on public.biometric_templates for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

  drop policy if exists "kiosks admin read" on public.kiosk_devices;
  create policy "kiosks admin read" on public.kiosk_devices for select using (public.current_app_role() = 'admin');
  drop policy if exists "kiosk service all devices" on public.kiosk_devices;
  create policy "kiosk service all devices" on public.kiosk_devices for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  drop policy if exists "kiosk cache service only" on public.kiosk_ballot_cache;
  create policy "kiosk cache service only" on public.kiosk_ballot_cache for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  drop policy if exists "kiosk queue admin service" on public.kiosk_vote_queue;
  create policy "kiosk queue admin service" on public.kiosk_vote_queue for all using (public.current_app_role() = 'admin' or auth.role() = 'service_role') with check (auth.role() = 'service_role');

  drop policy if exists "complaints role access" on public.complaints;
  create policy "complaints role access" on public.complaints for all using (
    public.current_app_role() = 'admin'
    or exists (select 1 from public.students s where s.id = complaints.student_id and (s.student_id = auth.uid() or s.email = auth.email()))
  ) with check (true);

  drop policy if exists "archives admin read" on public.archived_documents;
  create policy "archives admin read" on public.archived_documents for select using (public.current_app_role() = 'admin');
  drop policy if exists "archives admin insert" on public.archived_documents;
  create policy "archives admin insert" on public.archived_documents for insert with check (public.current_app_role() = 'admin');

  drop policy if exists "reports admin read" on public.report_templates;
  create policy "reports admin read" on public.report_templates for select using (public.current_app_role() = 'admin');

  drop policy if exists "audit logs admin select" on public.audit_logs;
  create policy "audit logs admin select" on public.audit_logs for select using (public.current_app_role() = 'admin');
  drop policy if exists "audit logs authenticated insert" on public.audit_logs;
  create policy "audit logs authenticated insert" on public.audit_logs for insert with check (auth.uid() is not null or actor_role = 'system' or auth.role() = 'service_role');

  create or replace view public.live_results_restricted as
  select
    c.election_period_id,
    c.position,
    c.id as candidate_id,
    c.given_name,
    c.surname,
    p.name as party_name,
    count(v.id) as votes
  from public.candidates c
  left join public.parties p on p.id = c.party_id
  left join public.votes v on v.candidate_id = c.id
  where c.status = 'approved'
  group by c.election_period_id, c.position, c.id, c.given_name, c.surname, p.name;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('candidate-pictures', 'candidate-pictures', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
    ('candidate-documents', 'candidate-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
    ('nomination-documents', 'nomination-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "candidate pictures public read" on storage.objects;
  create policy "candidate pictures public read" on storage.objects for select using (bucket_id = 'candidate-pictures');
  drop policy if exists "candidate pictures authenticated write" on storage.objects;
  create policy "candidate pictures authenticated write" on storage.objects for all using (bucket_id = 'candidate-pictures' and auth.uid() is not null) with check (bucket_id = 'candidate-pictures' and auth.uid() is not null);
  drop policy if exists "private election docs role read" on storage.objects;
  create policy "private election docs role read" on storage.objects for select using (bucket_id in ('candidate-documents', 'nomination-documents') and public.current_app_role() = 'admin');
  drop policy if exists "private election docs upload" on storage.objects;
  create policy "private election docs upload" on storage.objects for insert with check (bucket_id in ('candidate-documents', 'nomination-documents') and auth.uid() is not null);

  -- G-01-5: auth.identities uuid pattern (dual-branch). Seeds a provider identity row
  -- for a scripted auth.users account on BOTH schema generations: legacy text-id
  -- (keyed provider,id) and current uuid-id with provider_id (keyed provider,provider_id).
  create or replace function public.auth_identities_sync(
    p_provider text,
    p_provider_sub text,
    p_user_id uuid,
    p_identity_data jsonb
  )
  returns void
  language plpgsql
  as $$
  declare
    v_has_provider_id boolean;
  begin
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'identities'
        and column_name = 'provider_id'
    ) into v_has_provider_id;

    if v_has_provider_id then
      insert into auth.identities (provider, provider_id, user_id, identity_data, last_sign_in_at, created_at, updated_at)
      values (p_provider, p_provider_sub, p_user_id, p_identity_data, now(), now(), now())
      on conflict (provider, provider_id) do nothing;
    else
      insert into auth.identities (provider, id, user_id, identity_data, last_sign_in_at, created_at, updated_at)
      values (p_provider, p_provider_sub, p_user_id, p_identity_data, now(), now(), now())
      on conflict (provider, id) do nothing;
    end if;
  end;
  $$;

  do $$
  declare
    chief_id uuid := '11111111-1111-4111-8111-111111111111';
  begin
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      chief_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'chief.commissioner@cnnhs.edu',
      crypt('chief123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"admin","commissioner_role":"chief","full_name":"Chief Commissioner"}'::jsonb,
      now(),
      now()
    )
    on conflict (id) do nothing;

    perform public.auth_identities_sync('email', 'chief.commissioner@cnnhs.edu', chief_id, jsonb_build_object('sub', chief_id::text, 'email', 'chief.commissioner@cnnhs.edu'));

    insert into public.profiles (id, role, commissioner_role, full_name)
    values (chief_id, 'admin', 'chief', 'Chief Commissioner')
    on conflict (id) do update
      set role = 'admin', commissioner_role = 'chief', full_name = 'Chief Commissioner';

    insert into public.commissioners (auth_id, name, email, commissioner_role, status)
    values (chief_id, 'Chief Commissioner', 'chief.commissioner@cnnhs.edu', 'chief', 'active')
    on conflict (commissioner_role) do update
      set auth_id = excluded.auth_id,
          name = excluded.name,
          email = excluded.email,
          status = excluded.status;
  end $$;

  create or replace function public.login_admin_direct(p_email text, p_password text)
  returns table (
    id uuid,
    role text,
    commissioner_role text,
    full_name text,
    email text
  )
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
  begin
    return query
    select p.id, p.role, p.commissioner_role, p.full_name, u.email::text
    from auth.users u
    join public.profiles p on p.id = u.id
    where lower(u.email) = lower(p_email)
      and u.encrypted_password = public.crypt(p_password, u.encrypted_password)
    limit 1;
  end;
  $$;

  create or replace function public.login_officer_direct(p_email text, p_password text)
  returns table (
    id uuid,
    name text,
    email text
  )
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
  begin
    return query
    select o.id, o.name, o.email
    from auth.users u
    join public.officers o on o.auth_id = u.id
    where lower(u.email) = lower(p_email)
      and u.encrypted_password = public.crypt(p_password, u.encrypted_password)
    limit 1;
  end;
  $$;

  insert into public.election_periods (school_year, candidacy_open, nomination_open, is_active, results_published, venue)
  values ('2026-2027', false, false, false, false, 'CNNHS IoT Biometric Kiosk Precinct')
  on conflict do nothing;

  insert into public.officers (name, email, position, grade_level, term_start, term_end, status)
  values
    ('Student President', 'president@cnnhs.edu', 'President', null, '2026-04-01', '2027-03-31', 'active'),
    ('Student Vice President', 'vice.president@cnnhs.edu', 'Vice President', null, '2026-04-01', '2027-03-31', 'active'),
    ('Student Secretary', 'secretary@cnnhs.edu', 'Secretary', null, '2026-04-01', '2027-03-31', 'active'),
    ('Student Treasurer', 'treasurer@cnnhs.edu', 'Treasurer', null, '2026-04-01', '2027-03-31', 'active'),
    ('Student Auditor', 'auditor@cnnhs.edu', 'Auditor', null, '2026-04-01', '2027-03-31', 'active'),
    ('Student PIO', 'pio@cnnhs.edu', 'Public Information Officer', null, '2026-04-01', '2027-03-31', 'active'),
    ('Student Protocol Officer', 'protocol@cnnhs.edu', 'Protocol Officer', null, '2026-04-01', '2027-03-31', 'active'),
    ('Grade 7 Representative', 'grade7.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 7', '2026-04-01', '2027-03-31', 'active'),
    ('Grade 8 Representative', 'grade8.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 8', '2026-04-01', '2027-03-31', 'active'),
    ('Grade 9 Representative', 'grade9.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 9', '2026-04-01', '2027-03-31', 'active'),
    ('Grade 10 Representative', 'grade10.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 10', '2026-04-01', '2027-03-31', 'active'),
    ('Grade 11 Representative', 'grade11.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 11', '2026-04-01', '2027-03-31', 'active'),
    ('Grade 12 Representative', 'grade12.rep@cnnhs.edu', 'Grade Level Representative', 'Grade 12', '2026-04-01', '2027-03-31', 'active')
  on conflict (email) do update
    set name = excluded.name,
        position = excluded.position,
        grade_level = excluded.grade_level,
        term_start = excluded.term_start,
        term_end = excluded.term_end,
        status = excluded.status;

  insert into public.report_templates (enclosure, title, owner_role, category)
  values
    ('6', 'Certificate of Candidacy / Election Application Form Tracking', 'screening_validation', 'candidacy'),
    ('7.2', 'Screening and Validation Summary', 'screening_validation', 'candidacy'),
    ('8.1', 'Official List of Candidates', 'appointment', 'forms'),
    ('8.2', 'Notice to Candidates / Party Approval Record', 'appointment', 'forms'),
    ('9', 'Campaign and Election Calendar', 'electoral_board', 'forms'),
    ('11', 'Nomination Form', 'appointment', 'appointment'),
    ('12', 'Nominee Reply Slip', 'appointment', 'appointment'),
    ('13', 'Appointment Recommendation', 'appointment', 'appointment'),
    ('14', 'Complaint Form', 'grievance', 'grievance'),
    ('15', 'Fact-Finding Report', 'grievance', 'grievance'),
    ('16', 'Initial Decision for Chief Approval', 'grievance', 'grievance'),
    ('17', 'Resolution and Sanction Notice', 'grievance', 'grievance'),
    ('18', 'Election Returns', 'electoral_board', 'results'),
    ('19', 'Statement of Votes', 'electoral_board', 'results'),
    ('20', 'Proclamation Report', 'chief', 'results'),
    ('21', 'System Audit Trail Report', 'chief', 'audit')
  on conflict (enclosure) do update
    set title = excluded.title,
        owner_role = excluded.owner_role,
        category = excluded.category;
