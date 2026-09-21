-- Migration 018: Add abstain vote support
-- Makes candidate_id nullable and adds an abstained flag to the votes table.
-- Abstain records have candidate_id = NULL and abstained = true.

-- 1. Drop the foreign key constraint on candidate_id (name varies by deployment)
DO $$
BEGIN
  -- Drop the FK constraint if it exists (typical Supabase naming)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.votes'::regclass
      AND contype = 'f'
      AND conname LIKE '%candidate%'
  ) THEN
    ALTER TABLE public.votes
      DROP CONSTRAINT IF EXISTS votes_candidate_id_fkey;
  END IF; 
END $$;

-- 2. Make candidate_id nullable
ALTER TABLE public.votes
  ALTER COLUMN candidate_id DROP NOT NULL;

-- 3. Add the abstained column
ALTER TABLE public.votes
  ADD COLUMN IF NOT EXISTS abstained boolean NOT NULL DEFAULT false;

-- 4. Add a partial unique index that enforces uniqueness for non-abstain votes only
-- (abstain records can have NULL candidate_id, so the original unique index still works)
-- The existing unique index on (voter_id, position, election_period_id) already handles this:
--   - Only one vote per position per voter is allowed (whether real or abstain).

-- 5. Optional: add a check constraint so abstain records always have NULL candidate_id
ALTER TABLE public.votes
  ADD CONSTRAINT votes_abstain_check
  CHECK (
    (abstained = true AND candidate_id IS NULL)
    OR
    (abstained = false AND candidate_id IS NOT NULL)
  );
