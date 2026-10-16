-- 062_notifications_type_widen.sql
--
-- WHAT
--   Re-creates public.notifications_type_check with the notification
--   types the application actually writes today.
--
-- WHY
--   011_notifications_and_party_members.sql created the column with an
--   inline CHECK listing 20 types. Two client-side types were added
--   later and were NEVER added to that list:
--
--     * 'rules_discussion_meeting' — AdminCandidates.tsx "Send Meeting
--       Notice" (see also 058's header, which assumes the type works).
--     * 'fingerprint_registration' — the Fingerprint Registration
--       announcement the Electoral Board sends to every voter when
--       Stage 3 opens (StudentDashboard reminder card + bell).
--
--   The failure is silent on the client: AppContext.insertNotification
--   updates local state first and fires insert_notification_rpc with
--   .then(() => {}, () => {}) — a constraint violation is swallowed, so
--   the sender sees the notification while students never receive it.
--
--   Widening (never narrowing) the list keeps every row already in the
--   table valid, so this is safe against a populated database.
--
-- APPLIED BY HAND IN SUPABASE — this file is the record of it.

begin;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'candidacy_pending',
    'candidacy_approved',
    'candidacy_rejected',
    'official_list_posted',
    'nomination_received',
    'nomination_status_changed',
    'party_membership_request',
    'party_membership_approved',
    'party_membership_rejected',
    'student_registered',
    'student_approved',
    'student_rejected',
    'complaint_filed',
    'complaint_resolved',
    'election_opened',
    'election_closed',
    'results_published',
    'submitted_to_chief',
    'admin_notification',
    'rules_discussion_meeting',
    'fingerprint_registration'
  ));

commit;
