import type { Candidate, ElectionPeriod, PartySummary } from "../context/AppContext";

/**
 * A party only becomes visible to other students once its President has been
 * approved by Screening.  The approved President candidacy is the single
 * source of truth for "this party is real and running" — the party name is
 * carried on the candidate row, so there is no parties-table read here.
 */
export const PARTY_GATE_OPEN = "presidentApproved";
export const PARTY_GATE_PENDING = "presidentApprovalRequired";
export const PARTY_GATE_CLOSED = "presidentRejected";

/** The candidates position CHECK splits into these 7 executive offices ... */
export const EXECUTIVE_POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "PIO", "Protocol Officer"];
export const GRADE_LEVELS = ["Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];

/**
 * ...and each of those offices is gated to specific grades:
 *   * President / Vice President — Grade 11-12 only, which is also what keeps
 *     party creation SHS-only, since a party is founded by running for its
 *     President;
 *   * Secretary / Treasurer — Grade 10 only;
 *   * Auditor / PIO / Protocol Officer — Grade 8-9 only.
 * Grade 7 holds no executive office — its roster is the Grade 7
 * Representative seat alone.  FULL_POSITION_ORDER — the canonical
 * ballot/results order — is unchanged.
 */
export const EXECUTIVE_GRADE_GATE: Record<string, string[]> = {
  President: ["Grade 11", "Grade 12"],
  "Vice President": ["Grade 11", "Grade 12"],
  Secretary: ["Grade 10"],
  Treasurer: ["Grade 10"],
  Auditor: ["Grade 8", "Grade 9"],
  PIO: ["Grade 8", "Grade 9"],
  "Protocol Officer": ["Grade 8", "Grade 9"],
};

/** The grades that may contest an executive office; empty for ungated positions. */
export function gradesForPosition(position: string): string[] {
  return EXECUTIVE_GRADE_GATE[position] ?? [];
}

/** Grade 11 and Grade 12 — the only levels eligible for President, and
 *  therefore the only ones who can create a party. */
export function isSeniorHighGrade(gradeLevel: string): boolean {
  return gradeLevel === "Grade 11" || gradeLevel === "Grade 12";
}

/**
 * ... plus one representative seat per grade level: the full canonical
 * position order shared by every results / ballot / proclamation view.
 * (The old "PRO" office was removed from the election entirely — see
 * migration 076.)
 */
export const FULL_POSITION_ORDER = [
  ...EXECUTIVE_POSITIONS,
  ...GRADE_LEVELS.map((grade) => `${grade} Representative`),
];

/**
 * The canonical rank of a position in FULL_POSITION_ORDER — 0 for President
 * through 12 for Grade 12 Representative.  Positions outside the canonical
 * list (legacy rows) rank after every known one, keeping the proclaimed
 * winners, tally and results views in the Board's reading order instead of
 * the database's alphabetical one.
 */
export function positionRank(position: string): number {
  const index = FULL_POSITION_ORDER.indexOf(position);
  return index === -1 ? FULL_POSITION_ORDER.length : index;
}

/** 117 — Grade Level Representative positions elect TWO winners; every
 *  other position elects one.  (Kept in step with
 *  ProclamationDialog.seatsForPosition.) */
export function isGradeRepresentativePosition(position: string): boolean {
  return position.endsWith(" Representative");
}

/**
 * The seats a student of `gradeLevel` may contest.
 *
 * Each executive office is offered only to the grades in its gate above, and
 * each grade keeps its own Representative seat — Grade 7's roster is that
 * seat alone.  An unknown grade (including an empty one before the student
 * record loads) offers no seats at all — a roster can only be built for a
 * grade the school actually has.
 */
export function getPositionsForGrade(gradeLevel: string): string[] {
  if (!gradeLevel || !GRADE_LEVELS.includes(gradeLevel)) return [];
  const base = EXECUTIVE_POSITIONS.filter((position) =>
    gradesForPosition(position).includes(gradeLevel)
  );
  base.push(`${gradeLevel} Representative`);
  return base;
}

/**
 * The election period whose candidates the UI should be showing.
 *
 * 058: keyed off the period id, not off `isActive`.  `isActive` means
 * "voting is open" and is false throughout the application and campaign
 * stages, so keying off it made every candidate row in the database
 * visible at once — harmless while a single election existed, wrong the
 * moment a reset leaves a retired period behind.
 *
 * An unknown id (no period row at all, or the boot load has not resolved
 * yet) is reported as undefined.  `isInLivePeriod` reads that as "no
 * current election": nothing is live and every row is history, so a
 * period-less database can never present a past election's candidates as
 * current ones.
 */
export function livePeriodId(electionPeriod: ElectionPeriod): string | undefined {
  return electionPeriod.id || undefined;
}

/**
 * Whether a candidate row belongs to the election the UI is currently
 * showing.
 *
 * With no live period id at all — every period completed/cancelled, or none
 * created yet — NOTHING is live: the whole store is history, which is what
 * keeps a past election's roster off the current-election screens.  (The
 * old pass-everything fallback was only ever reachable in that state,
 * because AppContext sets the candidates and the period in one batched
 * update — there is no "candidates loaded, period missing" window it could
 * have been safe for.)  A legacy row with no period id still passes when a
 * real period exists, so pre-058 data keeps working.
 */
export function isInLivePeriod(
  candidate: Candidate,
  electionPeriod: ElectionPeriod
): boolean {
  const periodId = livePeriodId(electionPeriod);
  if (!periodId) return false;
  return !candidate.electionPeriodId || candidate.electionPeriodId === periodId;
}

export function candidatesInLivePeriod(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod
): Candidate[] {
  return candidates.filter((candidate) => isInLivePeriod(candidate, electionPeriod));
}

/**
 * One store, two views.  AppContext keeps every candidate row and derives the
 * two lists from it: `candidates` is the live period's rows (what every
 * current-election screen reads, so a past election's candidates can never
 * leak into it), and `archivedCandidates` is every other period's rows, kept
 * reachable for history surfaces such as the Admin Archive page.
 */
export function splitCandidatesByPeriod(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod
): { live: Candidate[]; archived: Candidate[] } {
  const live: Candidate[] = [];
  const archived: Candidate[] = [];
  for (const candidate of candidates) {
    (isInLivePeriod(candidate, electionPeriod) ? live : archived).push(candidate);
  }
  return { live, archived };
}

/**
 * The reducer behind AppContext's setCandidates.  Callers pass the live list
 * (usually mapped from the exposed `candidates`), so the write replaces the
 * live rows while archived history is carried over untouched.
 */
export function replaceLiveCandidates(
  previous: Candidate[],
  next: Candidate[],
  electionPeriod: ElectionPeriod
): Candidate[] {
  // No live period: the live view is empty by definition, so there is
  // nothing to replace — return the store untouched rather than appending
  // rows the next split would classify as history.
  if (!livePeriodId(electionPeriod)) return previous;
  return [
    ...previous.filter((candidate) => !isInLivePeriod(candidate, electionPeriod)),
    ...next,
  ];
}

/** The screening-approved President of a party in the live period, if any. */
export function approvedPartyPresident(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod,
  partyName: string
): Candidate | undefined {
  return candidatesInLivePeriod(candidates, electionPeriod).find(
    (candidate) =>
      candidate.partyAffiliation === partyName &&
      candidate.position === "President" &&
      candidate.status === "approved"
  );
}

/**
 * Party names a student may join.  A party that has not yet cleared
 * Screening through its President is deliberately absent, which is what
 * keeps an unapproved slate from being fielded twice.
 */
export function livePeriodPartyNames(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod
): string[] {
  return Array.from(
    new Set(
      candidatesInLivePeriod(candidates, electionPeriod)
        .filter(
          (candidate) =>
            candidate.position === "President" &&
            candidate.status === "approved" &&
            !!candidate.partyAffiliation &&
            candidate.partyAffiliation !== "Independent"
        )
        .map((candidate) => candidate.partyAffiliation as string)
    )
  ).sort();
}

export function livePeriodPartyId(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod,
  partyName: string
): string | undefined {
  return approvedPartyPresident(candidates, electionPeriod, partyName)?.partyId;
}

/**
 * The distinct real party names among a set of candidates.
 *
 * Unaffiliated candidates are NOT a party.  A row with no `partyAffiliation`
 * is displayed as "Independent" everywhere, and a candidate can also literally
 * carry that name, so both the empty string and "Independent" (trimmed,
 * case-insensitive) are dropped here.  This is what keeps a count of parties
 * from reporting the Independent field as one of them.
 */
export function distinctPartyNames(candidates: Candidate[]): string[] {
  return Array.from(
    new Set(
      candidates
        .map((candidate) => (candidate.partyAffiliation || "").trim())
        .filter((name) => name && name.toLowerCase() !== "independent")
    )
  ).sort();
}

/** A founder is whoever registered the slate by running for its President. */
export function isPartyFounder(candidate: Candidate): boolean {
  return !!candidate.partyAffiliation && candidate.position === "President";
}

/** True while a candidate is still in the running for their seat. */
export function isInPartyRace(candidate: Candidate): boolean {
  return (
    candidate.positionApprovalStatus === PARTY_GATE_PENDING ||
    candidate.positionApprovalStatus === PARTY_GATE_OPEN
  );
}

/**
 * Whether a candidate has actually WON their seat.
 *
 * This is deliberately narrower than isInPartyRace.  Since 055 dropped
 * 001:269, an office can hold several requests at once and the party President
 * picks one, so a pending request must NOT be read as "the seat is taken" —
 * otherwise a contest would silently become exclusive again and the second
 * applicant would be refused for a seat nobody has won.
 *
 * Two different things settle a seat, so two different tests:
 *   * a party office is won when the party President approves the request
 *     (PARTY_GATE_OPEN = "presidentApproved");
 *   * Independent and President candidacies carry no party gate at all
 *     (052:760-764 sets 'notRequired'), so for those the Screening decision
 *     is what settles the seat.  This is also why a party's own President
 *     stopped being reported as an available seat to joiners.
 */
export function isSeatWinner(candidate: Candidate): boolean {
  if (candidate.positionApprovalStatus === PARTY_GATE_CLOSED) return false;
  // A party office is settled when the party President approves the request.
  if (candidate.positionApprovalStatus === PARTY_GATE_OPEN) return true;
  // Still queued behind the party President.  Checked before the status test on
  // purpose: the seat is contested, not won, so a second applicant may enter.
  if (candidate.positionApprovalStatus === PARTY_GATE_PENDING) return false;
  // No party gate at all (052:760-764 sets 'notRequired'): a party President's
  // own candidacy, or any Independent run.  Screening is what settles those.
  return candidate.status === "approved";
}

export type SubmitBlockReason = "awaiting-party-president" | "seat-closed";

/**
 * Whether the party President's approval is still outstanding for this
 * candidate, i.e. the completed EAF may not be submitted yet.
 *
 * The party test keys on `partyId`, never on `partyAffiliation`.  The name is
 * a nullable display string and "Independent" is only a frontend fallback, so
 * a party genuinely named "Independent" would read as exempt here while the
 * database — which keys on the party_id foreign key — still gates it.
 *
 * The two exemptions mirror 052:760-764, which is what stamps
 * 'notRequired': a null party_id (any Independent run) and the party's own
 * President, who is approved by the Screening Office rather than by the party.
 * 057's guard_party_approval_before_finalize trigger enforces the same two
 * cases on the database side, so the button and the RPC agree.
 */
export function partyApprovalBlockForSubmit(candidate: Candidate): SubmitBlockReason | null {
  if (!candidate.partyId) return null;
  if (candidate.position === "President") return null;

  if (candidate.positionApprovalStatus === PARTY_GATE_PENDING) {
    return "awaiting-party-president";
  }
  if (candidate.positionApprovalStatus === PARTY_GATE_CLOSED) {
    return "seat-closed";
  }
  return null;
}

/** True while a candidate still holds a claim on the seat (pending or won). */
function isSeatClaimant(candidate: Candidate): boolean {
  return (
    candidate.status !== "rejected" &&
    candidate.positionApprovalStatus !== PARTY_GATE_CLOSED
  );
}

export type SeatState = "open" | "contested" | "filled";

export interface SeatSummary {
  position: string;
  state: SeatState;
  /** The candidate who has won the seat, when there is one. */
  approved?: Candidate;
  /** Requests still awaiting the party President's decision. */
  requestCount: number;
  /** The other claimants, so the UI can say who is already in the running. */
  requesters: Candidate[];
}

/**
 * Every office this student could hold, with its state.
 *
 * `partyId` undefined means the Independent race.  Independents do NOT
 * contest a shared seat: each runs their own candidacy for the office, so
 * another Independent's request — or Screening-approved win — never fills
 * or closes a seat (055 already allowed multiple rows per office; this is
 * the matching UI rule).  Nor is the applicant told how many others are
 * running: independent seats carry no claimant data at all.
 *
 * For a party (partyId given) the roster is the party's slate: an office
 * the party President has already awarded is filled, and 055's contest
 * model lets several students queue behind the President's decision.
 *
 * The roster is the student's own grade, so "full" is grade-relative — a
 * party with every executive seat won is still open to a Grade 11 student
 * whose Grade 11 Representative seat has no winner.
 */
export function partySeatSummaries(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod,
  partyId: string | undefined,
  gradeLevel: string,
  excludeCandidateId?: string
): SeatSummary[] {
  const rows = candidatesInLivePeriod(candidates, electionPeriod).filter(
    (candidate) =>
      candidate.id !== excludeCandidateId &&
      (partyId ? candidate.partyId === partyId : !candidate.partyId) &&
      isSeatClaimant(candidate)
  );

  const byPosition = new Map<string, Candidate[]>();
  for (const candidate of rows) {
    const list = byPosition.get(candidate.position);
    if (list) list.push(candidate);
    else byPosition.set(candidate.position, [candidate]);
  }

  return getPositionsForGrade(gradeLevel).map((position) => {
    const claimants = byPosition.get(position) ?? [];

    // Independent race: every office stays enterable, and the applicant is
    // not shown how many others are running — an Independent does not share
    // a seat, so there is no shared race to report on.
    if (!partyId) {
      return {
        position,
        state: "open" as SeatState,
        requestCount: 0,
        requesters: [],
      };
    }

    const approved = claimants.find(isSeatWinner);
    const requesters = claimants.filter((candidate) => candidate.id !== approved?.id);
    const state: SeatState = approved
      ? "filled"
      : requesters.length > 0
        ? "contested"
        : "open";
    return { position, state, approved, requestCount: requesters.length, requesters };
  });
}

/**
 * Whether a seat can still be entered.
 *
 * `excludePresident` is what the Apply page passes when the student is JOINING
 * an existing party: the President seat is only claimable by creating the
 * party, so it is never offered to a joiner even when no winner exists yet.
 */
export function isSeatSelectable(seat: SeatSummary, excludePresident = false): boolean {
  if (seat.state === "filled") return false;
  if (excludePresident && seat.position === "President") return false;
  return true;
}

/** Every office on this student's roster already has a winner. */
export function isPartyFullForGrade(seats: SeatSummary[]): boolean {
  return seats.length > 0 && seats.every((seat) => seat.state === "filled");
}

/**
 * Whether the party already has a screening-approved President.
 *
 * Matched on partyId rather than name: 052 scopes party names per election, so
 * two periods can legitimately hold a party with the same name, and the seed
 * already re-points candidates at their own period's row.
 */
export function partyHasApprovedPresident(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod,
  partyId: string
): boolean {
  return candidatesInLivePeriod(candidates, electionPeriod).some(
    (candidate) =>
      candidate.partyId === partyId &&
      candidate.position === "President" &&
      candidate.status === "approved"
  );
}

export type PartyBlockedReason = "awaiting-president" | "full";

export interface PartyOption extends PartySummary {
  hasApprovedPresident: boolean;
  seats: SeatSummary[];
  isFull: boolean;
  /** Set when the student cannot join, and why. */
  blockedReason?: PartyBlockedReason;
}

/**
 * Every party of the live period, joinable or not.
 *
 * All of them are returned, including the ones the student cannot join, so the
 * picker can show the full slate with a reason instead of quietly hiding
 * parties.  A party is joinable only when it has an approved President (052
 * requires one — the President is the only person who can approve a party
 * candidacy request) and still has an office open for this student's grade.
 */
export function buildPartyOptions(
  parties: PartySummary[],
  candidates: Candidate[],
  electionPeriod: ElectionPeriod,
  gradeLevel: string
): PartyOption[] {
  const periodId = livePeriodId(electionPeriod);

  // No current election period: nothing is joinable, and listing a past
  // election's parties here would let a student apply into retired history.
  if (!periodId) return [];

  const byId = new Map<string, PartySummary>();

  for (const party of parties) {
    if (periodId && party.electionPeriodId !== periodId) continue;
    byId.set(party.id, party);
  }

  // Fallback: a party the parties read did not return (it failed, or the row
  // landed after the boot load) must still be offered.  The candidate row
  // carries both the id and the name, so nothing is lost.
  for (const candidate of candidatesInLivePeriod(candidates, electionPeriod)) {
    if (!candidate.partyId || !candidate.partyAffiliation) continue;
    if (candidate.partyAffiliation === "Independent") continue;
    if (byId.has(candidate.partyId)) continue;
    byId.set(candidate.partyId, {
      id: candidate.partyId,
      name: candidate.partyAffiliation,
      electionPeriodId: candidate.electionPeriodId ?? periodId ?? "",
    });
  }

  return Array.from(byId.values())
    .map((party) => {
      const hasApprovedPresident = partyHasApprovedPresident(
        candidates,
        electionPeriod,
        party.id
      );
      const seats = partySeatSummaries(candidates, electionPeriod, party.id, gradeLevel);
      const isFull = isPartyFullForGrade(seats);
      const blockedReason: PartyBlockedReason | undefined = !hasApprovedPresident
        ? "awaiting-president"
        : isFull
          ? "full"
          : undefined;
      return { ...party, hasApprovedPresident, seats, isFull, blockedReason };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether `position` is still contestable in this party.  A declined
 * candidate does NOT hold the seat — otherwise their own rejection would
 * lock the position permanently and re-applying could never succeed — and
 * neither does a mere request, since 055 makes offices contestable.
 */
export function isPartyPositionOpen(
  candidates: Candidate[],
  electionPeriod: ElectionPeriod,
  partyId: string,
  position: string,
  excludeCandidateId?: string
): boolean {
  return !candidatesInLivePeriod(candidates, electionPeriod).some(
    (candidate) =>
      candidate.id !== excludeCandidateId &&
      candidate.partyId === partyId &&
      candidate.position === position &&
      isSeatWinner(candidate)
  );
}

export interface PartyPositionSlot {
  position: string;
  approved?: Candidate;
  pending: Candidate[];
}

/**
 * The President's approval board: every contested seat in the party, with
 * the approved candidate and whoever is waiting on a decision.  Declined
 * candidates are omitted, and the President themselves never appears.
 */
export function buildPartyPositionBoard(
  candidates: Candidate[],
  partyId: string,
  electionPeriod: ElectionPeriod
): PartyPositionSlot[] {
  const slots = new Map<string, PartyPositionSlot>();

  for (const candidate of candidatesInLivePeriod(candidates, electionPeriod)) {
    if (candidate.partyId !== partyId) continue;
    if (candidate.position === "President") continue;
    if (!isInPartyRace(candidate)) continue;

    const slot = slots.get(candidate.position) ?? {
      position: candidate.position,
      pending: [],
    };

    if (candidate.positionApprovalStatus === PARTY_GATE_OPEN) {
      slot.approved = candidate;
    } else {
      slot.pending.push(candidate);
    }
    slots.set(candidate.position, slot);
  }

  return Array.from(slots.values()).sort((a, b) =>
    a.position.localeCompare(b.position)
  );
}
