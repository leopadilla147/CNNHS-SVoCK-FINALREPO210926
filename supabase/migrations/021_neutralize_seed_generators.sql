-- 021_neutralize_seed_generators.sql
-- Existence-guarded DELETEs that neutralize the demo-row resurrection
-- paths in the legacy migrations (001/007/016).
--
-- Runs after 020 in the chain.  After this migration executes, the
-- only source of demo data is supabase/seed-demo.sql (wired via
-- [db.seed] in config.toml).  Re-apply is a no-op: every block is
-- guarded by an IF EXISTS check keyed on the demo pattern, so once
-- the rows are deleted the block is skipped entirely.
--
-- This migration NEVER inserts data.  Its sole purpose is clamps
-- and deletes.

do $$
declare
  -- Fixed UUIDs from 007_seed_accounts.sql (commissioner/adviser accounts)
  v_screening_id   uuid := '22222222-2222-4222-8222-222222222222';
  v_electoral_id   uuid := '33333333-3333-4333-8333-333333333333';
  v_appointment_id uuid := '44444444-4444-4444-8444-444444444444';
  v_grievance_id   uuid := '55555555-5555-4555-8555-555555555555';
  v_sslg_id        uuid := '66666666-6666-4666-8666-666666666666';
  v_demo_auth_ids  uuid[] := array[
    v_screening_id, v_electoral_id, v_appointment_id, v_grievance_id, v_sslg_id
  ];
  v_demo_officer_emails text[] := array[
    'president@cnnhs.edu', 'vice.president@cnnhs.edu', 'secretary@cnnhs.edu',
    'treasurer@cnnhs.edu', 'auditor@cnnhs.edu', 'pio@cnnhs.edu',
    'protocol@cnnhs.edu', 'grade7.rep@cnnhs.edu', 'grade8.rep@cnnhs.edu',
    'grade9.rep@cnnhs.edu', 'grade10.rep@cnnhs.edu', 'grade11.rep@cnnhs.edu',
    'grade12.rep@cnnhs.edu'
  ];
begin

  -- ============================================================
  -- A) Dummy students, candidates, masterlist, parties
  --    (relocated from 016_seed_dummy_parties.sql)
  --    Pattern key: lrn like '136400%'.
  -- ============================================================
  if exists (select 1 from public.students where lrn like '136400%') then
    -- Null FK references from parties and nominations to demo
    -- students so the students delete cannot be blocked.
    update public.parties
       set president_student_id = null
     where president_student_id in (
       select id from public.students where lrn like '136400%'
     );

    update public.nominations
       set nominated_by_student_id = null
     where nominated_by_student_id in (
       select id from public.students where lrn like '136400%'
     );

    update public.party_members
       set reviewed_by = null
     where reviewed_by in (
       select id from public.students where lrn like '136400%'
     );

    -- Candidates reference students (ON DELETE CASCADE) and parties
    -- (NO ACTION).  Delete candidates explicitly first, then
    -- students, then masterlist rows (referenced by students via
    -- NO ACTION).
    delete from public.candidates
     where student_id in (
       select id from public.students where lrn like '136400%'
     );

    -- Deleting students cascades votes, biometric_templates,
    -- party_members, nominations (nominee).  Complaints SET NULL.
    delete from public.students where lrn like '136400%';

    -- Masterlist rows referenced by students.masterlist_id (NO
    -- ACTION) — students are gone, so this is safe now.
    delete from public.student_masterlist where lrn like '136400%';

    -- Demo parties: candidates referencing them are gone above;
    -- party_members references cascade.
    delete from public.parties
     where name in ('Alyansa ng Kabataan', 'Bagong Sibol', 'Sulong Bayanihan');
  end if;

  -- ============================================================
  -- B) SSLG officer demo rows (relocated from 001 L750-771)
  --    Pattern key: known demo officer emails.
  -- ============================================================
  if exists (select 1 from public.officers where email = any (v_demo_officer_emails)) then
    delete from public.officers where email = any (v_demo_officer_emails);
  end if;

  -- ============================================================
  -- C) Commissioner + SSLG Adviser demo accounts
  --    (relocated from 007_seed_accounts.sql)
  --    Pattern key: fixed demo auth user UUIDs.
  -- ============================================================
  if exists (select 1 from auth.users where id = any (v_demo_auth_ids)) then

    -- Null FK references to the demo profiles BEFORE deleting the
    -- auth users (profiles.id -> auth.users ON DELETE CASCADE will
    -- remove the profiles themselves).
    update public.candidates set reviewed_by = null
      where reviewed_by = any (v_demo_auth_ids);
    update public.candidates set forwarded_by = null
      where forwarded_by = any (v_demo_auth_ids);
    update public.students set reviewed_by = null
      where reviewed_by = any (v_demo_auth_ids);
    update public.student_masterlist set imported_by = null
      where imported_by = any (v_demo_auth_ids);
    update public.officers set created_by = null
      where created_by = any (v_demo_auth_ids);
    update public.election_periods set created_by = null
      where created_by = any (v_demo_auth_ids);
    update public.nominations set reviewed_by = null
      where reviewed_by = any (v_demo_auth_ids);
    update public.complaints set resolved_by = null
      where resolved_by = any (v_demo_auth_ids);
    update public.archived_documents set archived_by = null
      where archived_by = any (v_demo_auth_ids);
    update public.proclamations set proclaimed_by = null
      where proclaimed_by = any (v_demo_auth_ids);
    update public.audit_logs set actor_id = null
      where actor_id = any (v_demo_auth_ids);

    -- Delete the demo commissioner/adviser rows themselves.  Scoped by
    -- the demo auth UUIDs (never by role): the four demo commissioners
    -- and the demo adviser are exactly the fixed 007 identities, while a
    -- REAL commissioner appointed later via create_commissioner / the
    -- dashboard carries a different auth_id and a role-based delete
    -- (the original draft) would have removed them too.
    delete from public.commissioners
     where auth_id = any (v_demo_auth_ids);

    delete from public.sslg_advisers
     where auth_id = v_sslg_id;

    -- Identities reference auth.users; delete them first.
    delete from auth.identities
     where user_id = any (v_demo_auth_ids);

    -- Deleting auth.users cascades public.profiles
    -- (profiles.id -> auth.users ON DELETE CASCADE).
    delete from auth.users
     where id = any (v_demo_auth_ids);
  end if;

end $$;