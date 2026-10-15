import { describe, expect, it } from "vitest";
import { mapPastElectionResults, mapPastElectionSummary } from "../supabaseData";

describe("mapPastElectionSummary", () => {
  it("maps a published election row to the camelCase summary shape", () => {
    const summary = mapPastElectionSummary({
      election_period_id: "election-1",
      school_year: "2025-2026",
      election_date: "2026-05-04",
      end_date: "2026-05-05",
      venue: "CNNHS Gym",
      voting_method: "plurality",
      proclaimed: true,
      proclaimed_at: "2026-05-06T09:00:00+08:00",
      positions_contested: 13,
      approved_candidates: 40,
      votes_cast: 900,
      abstentions: 12,
      total_ballots: 912,
    });

    expect(summary).toEqual({
      id: "election-1",
      schoolYear: "2025-2026",
      electionDate: "2026-05-04",
      endDate: "2026-05-05",
      venue: "CNNHS Gym",
      votingMethod: "plurality",
      proclaimed: true,
      proclaimedAt: "2026-05-06T09:00:00+08:00",
      positionsContested: 13,
      approvedCandidates: 40,
      votesCast: 900,
      abstentions: 12,
      totalBallots: 912,
    });
  });

  it("tolerates missing optional columns and counts", () => {
    const summary = mapPastElectionSummary({
      election_period_id: "election-2",
      school_year: "2026-2027",
      election_date: null,
      end_date: null,
      venue: null,
      voting_method: null,
      proclaimed: false,
      proclaimed_at: null,
    });

    expect(summary.electionDate).toBeUndefined();
    expect(summary.endDate).toBeUndefined();
    expect(summary.venue).toBeUndefined();
    expect(summary.proclaimed).toBe(false);
    expect(summary.positionsContested).toBe(0);
    expect(summary.approvedCandidates).toBe(0);
    expect(summary.votesCast).toBe(0);
    expect(summary.abstentions).toBe(0);
    expect(summary.totalBallots).toBe(0);
  });
});

describe("mapPastElectionResults", () => {
  it("keeps per-position tallies, abstentions and the proclaimed winner", () => {
    const results = mapPastElectionResults({
      election: {
        id: "election-1",
        schoolYear: "2025-2026",
        electionDate: "2026-05-04",
        endDate: "2026-05-05",
        venue: "CNNHS Gym",
        votingMethod: "plurality",
        proclaimed: true,
        proclaimedAt: "2026-05-06T09:00:00+08:00",
      },
      totals: {
        positionsContested: 2,
        approvedCandidates: 3,
        votesCast: 210,
        abstentions: 9,
        totalBallots: 219,
      },
      positions: [
        {
          position: "President",
          votesCast: 150,
          abstentions: 5,
          candidates: [
            {
              candidateId: "c-1",
              name: "Dela Cruz, Gabriel",
              gradeLevel: "Grade 12",
              partyId: "p-1",
              partyName: "Alpha",
              votes: 90,
              picture: "https://example.test/pic.jpg",
              isWinner: true,
              proclaimedWinner: true,
            },
            {
              candidateId: "c-2",
              name: "Santos, Adrian",
              gradeLevel: "Grade 12",
              partyId: null,
              partyName: null,
              votes: 60,
              picture: null,
              isWinner: false,
              proclaimedWinner: false,
            },
          ],
        },
      ],
    });

    expect(results.totals).toEqual({
      positionsContested: 2,
      approvedCandidates: 3,
      votesCast: 210,
      abstentions: 9,
      totalBallots: 219,
    });
    expect(results.positions).toHaveLength(1);
    expect(results.positions[0].position).toBe("President");
    expect(results.positions[0].abstentions).toBe(5);
    expect(results.positions[0].candidates.map((c) => c.votes)).toEqual([90, 60]);
    expect(results.positions[0].candidates[0].proclaimedWinner).toBe(true);
    expect(results.positions[0].candidates[1].partyName).toBeUndefined();
  });

  it("never leaks voter identities (no voter field survives mapping)", () => {
    const results = mapPastElectionResults({
      election: { id: "election-1", schoolYear: "2025-2026" },
      totals: {},
      positions: [
        {
          position: "Secretary",
          votesCast: 10,
          abstentions: 1,
          candidates: [
            {
              candidateId: "c-9",
              name: "Reyes, Joshua",
              gradeLevel: "Grade 11",
              votes: 10,
              voterId: "student-1",
              isWinner: true,
              proclaimedWinner: false,
            },
          ],
        },
      ],
    });

    expect(JSON.stringify(results)).not.toContain("student-1");
    expect(results.positions[0].candidates[0]).not.toHaveProperty("voterId");
    expect(results.totals.positionsContested).toBe(0);
  });
});
