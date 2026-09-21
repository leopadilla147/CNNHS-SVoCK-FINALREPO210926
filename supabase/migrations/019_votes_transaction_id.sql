-- Migration 019: Add transaction_id column to the votes table.
-- Populated by the kiosk_vote edge function (sync_votes) with the kiosk-generated
-- transaction ID (e.g. TXN-260906-XXXX) so receipts can be reconciled in the DB.

alter table public.votes
  add column if not exists transaction_id text;

create index if not exists votes_transaction_id_idx
  on public.votes (transaction_id)
  where transaction_id is not null;