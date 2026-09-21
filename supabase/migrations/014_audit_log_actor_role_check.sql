-- Run this in Supabase Dashboard > SQL Editor
-- Adds sslg_adviser to the audit_logs actor_role check constraint
-- Required because review_student_rpc now inserts audit entries with actor_role = 'sslg_adviser'

alter table public.audit_logs drop constraint if exists audit_logs_actor_role_check;
alter table public.audit_logs add constraint audit_logs_actor_role_check
  check (actor_role in ('admin', 'officer', 'student', 'system', 'sslg_adviser'));
