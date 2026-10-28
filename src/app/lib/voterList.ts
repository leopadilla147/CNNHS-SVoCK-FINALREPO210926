import type { Student } from "../context/AppContext";

/**
 * Voter List helpers for the Electoral Board dashboard.
 *
 * "Voted" means the student has at least one row in public.votes for the
 * active election period — the same formula the dashboard turnout and the
 * DB's approved_voters count use (033).
 *
 * Kiosk attribution: the deployed kiosk tags each ballot's transaction_id
 * with its kiosk number ("K1"/"K2" — K for Kiosk, the digit is the kiosk
 * number), and every row of one ballot shares the same transaction id (048).
 * The tag may sit anywhere in the id ("TXN-K1-260906-0001",
 * "TXN-260906-0001-K1", ...), so the parser is position-agnostic and
 * case-insensitive. Votes whose ids carry no K-tag (legacy/web ballots) fall
 * back to grouping by votes.kiosk_id — the stable per-machine UUID each kiosk
 * keeps in localStorage — labelled in first-vote order, numbered after the
 * highest parsed kiosk number so the labels never collide.
 */

/** Raw subset of a public.votes row needed for the list. */
export interface VoteListRow {
  voter_id: string;
  abstained: boolean;
  kiosk_id: string | null;
  transaction_id: string | null;
  voted_at: string;
}

/** One dashboard row: a student plus what their ballot (if any) tells us. */
export interface VoterListRow {
  student: Student;
  voted: boolean;
  /** "Kiosk 1" / "Kiosk 2" / "Unknown"; null when the student has not voted. */
  kioskLabel: string | null;
  /** Ballot-level transaction id (the same id is on every row of that ballot). */
  transactionId: string | null;
  /** ISO timestamp of the voter's first recorded selection. */
  votedAt: string | null;
}

/** Extracts the kiosk number from a transaction id ("…K2…" → 2), or null. */
export function parseKioskNumber(transactionId: string | null | undefined): number | null {
  if (!transactionId) return null;
  const match = /K(\d+)/i.exec(transactionId);
  return match ? Number(match[1]) : null;
}

export function buildVoterRows(students: Student[], votes: VoteListRow[]): VoterListRow[] {
  // Group this period's rows by voter, oldest first.
  const byVoter = new Map<string, VoteListRow[]>();
  for (const vote of votes) {
    const rows = byVoter.get(vote.voter_id);
    if (rows) rows.push(vote);
    else byVoter.set(vote.voter_id, [vote]);
  }
  for (const rows of byVoter.values()) {
    rows.sort((a, b) => (a.voted_at || "").localeCompare(b.voted_at || ""));
  }

  // Pass 1 — resolve each voter's kiosk from their transaction ids (preferred).
  interface Resolved {
    kioskLabel: string | null;
    transactionId: string | null;
    votedAt: string | null;
    parsedNumber: number;
  }
  const resolved = new Map<string, Resolved>();
  /** Voters with no K-tag in any transaction id, keyed to their machine UUID. */
  const fallbacks: Array<{ voterId: string; kioskId: string }> = [];

  for (const [voterId, rows] of byVoter) {
    const first = rows[0];
    let transactionId: string | null = null;
    let parsedNumber = 0;
    for (const row of rows) {
      if (transactionId === null && row.transaction_id) transactionId = row.transaction_id;
      if (parsedNumber === 0 && row.transaction_id) {
        parsedNumber = parseKioskNumber(row.transaction_id) ?? 0;
      }
    }
    if (parsedNumber > 0) {
      resolved.set(voterId, {
        kioskLabel: `Kiosk ${parsedNumber}`,
        transactionId,
        votedAt: first.voted_at || null,
        parsedNumber,
      });
    } else if (first.kiosk_id) {
      // No K-tag on the ballot — remember the machine, label it in pass 2.
      fallbacks.push({ voterId, kioskId: first.kiosk_id });
      resolved.set(voterId, { kioskLabel: null, transactionId, votedAt: first.voted_at || null, parsedNumber: 0 });
    } else {
      resolved.set(voterId, { kioskLabel: "Unknown", transactionId, votedAt: first.voted_at || null, parsedNumber: 0 });
    }
  }

  // Pass 2 — label kiosk-id fallback groups in first-vote order, numbered
  // after the highest parsed kiosk number so labels never collide.
  if (fallbacks.length > 0) {
    let maxParsed = 0;
    for (const r of resolved.values()) maxParsed = Math.max(maxParsed, r.parsedNumber);

    const earliestByKiosk = new Map<string, string>();
    for (const { voterId, kioskId } of fallbacks) {
      const at = byVoter.get(voterId)![0].voted_at || "";
      const prev = earliestByKiosk.get(kioskId);
      if (prev === undefined || at < prev) earliestByKiosk.set(kioskId, at);
    }
    const orderedKiosks = [...earliestByKiosk.keys()].sort((a, b) =>
      (earliestByKiosk.get(a) || "").localeCompare(earliestByKiosk.get(b) || ""),
    );
    const labelByKiosk = new Map(orderedKiosks.map((kioskId, i) => [kioskId, `Kiosk ${maxParsed + 1 + i}`]));
    for (const { voterId, kioskId } of fallbacks) {
      resolved.get(voterId)!.kioskLabel = labelByKiosk.get(kioskId)!;
    }
  }

  // Pass 3 — one row per student (not-voted rows stay all-null), name order.
  return students
    .map<VoterListRow>((student) => {
      const r = resolved.get(student.id);
      if (!r) return { student, voted: false, kioskLabel: null, transactionId: null, votedAt: null };
      return { student, voted: true, kioskLabel: r.kioskLabel, transactionId: r.transactionId, votedAt: r.votedAt };
    })
    .sort((a, b) => {
      const an = `${a.student.lastName} ${a.student.firstName}`.toLowerCase();
      const bn = `${b.student.lastName} ${b.student.firstName}`.toLowerCase();
      return an.localeCompare(bn);
    });
}
