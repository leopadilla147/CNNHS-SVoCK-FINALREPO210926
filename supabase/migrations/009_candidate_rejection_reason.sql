-- Add rejection reason columns to candidates table
alter table public.candidates
  add column if not exists rejection_reason text,
  add column if not exists rejection_details text,
  add column if not exists rejection_tier text not null default 'low'
    check (rejection_tier in ('low', 'high'));

-- Index to quickly check if a student is disqualified for this election period
create index if not exists idx_candidates_rejection_tier
  on public.candidates (student_id, election_period_id, rejection_tier)
  where rejection_tier = 'high';
