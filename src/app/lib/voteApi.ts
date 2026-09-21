// voteApi.ts — web vote cast surface (05-03 T3, W-1/INTG-01).
//
// New file on purpose: wave-2 vote-cast file ownership stays disjoint from
// 05-02's supabaseData.ts edits.  Both functions are thin typed wrappers
// over the 032 security-definer RPCs — the ONLY client paths into votes
// (R6: the direct-insert policy is revoked in 032).
//
// Identity is session-derived: submit_vote_rpc resolves the voter from the
// stored session token (sha256 -> sessions row) and IGNORES any client
// identity — the payload carries selections only.  Replays with the same
// session token are idempotent (deterministic per-selection transaction
// ids + the 031 unique index) and return the same receipts, so the UI can
// safely re-present the one-time receipt dialog.

import { supabase } from "./supabase";
import { getSessionToken } from "./session";

export interface WebVoteSelection {
  position: string;
  /** Candidate id, or null when abstaining. */
  candidateId: string | null;
  /** Explicit abstain flag (018).  True implies candidateId null. */
  abstained?: boolean;
}

export interface VoteReceipt {
  voteId: string;
  receiptCode: string;
  codeHash: string;
  electionPeriodId: string;
  position: string;
  candidateId: string | null;
  timestamp: string;
}

/**
 * Cast a web ballot for the ACTIVE election period (032 submit_vote_rpc).
 * `electionId` mirrors the active election for the caller's UI context;
 * the RPC resolves and inserts the active election server-side (only one
 * can be active at a time).
 *
 * Returns the server-generated receipts (shown once — D-06).  Throws the
 * RPC message on failure (e.g. "You have already voted in this election").
 */
export async function submitWebVote(
  electionId: string,
  selections: WebVoteSelection[],
): Promise<VoteReceipt[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const token = getSessionToken();
  if (!token) throw new Error("Not signed in.");
  if (selections.length === 0) throw new Error("No selections to submit.");

  const { data, error } = await supabase.rpc("submit_vote_rpc", {
    p_session_token: token,
    p_selections: selections,
  });
  if (error) throw new Error(error.message);
  return (data || []) as VoteReceipt[];
}

/**
 * Look up a receipt by its plaintext code (032 verify_receipt_rpc).
 * Returns the stored receipt + code_hash, or null when unknown.  The
 * plaintext code is display-only; code_hash is the committed value (D-07).
 */
export async function verifyReceipt(code: string): Promise<VoteReceipt | null> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("verify_receipt_rpc", {
    p_receipt_code: code.trim().toUpperCase(),
  });
  if (error) throw new Error(error.message);
  return (data || [])[0] ?? null;
}