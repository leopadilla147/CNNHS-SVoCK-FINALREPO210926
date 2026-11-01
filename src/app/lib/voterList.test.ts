import { describe, it, expect } from "vitest";
import { buildVoterRows, parseKioskNumber, type VoteListRow } from "./voterList";
import type { Student } from "../context/AppContext";

function student(id: string, lastName: string, firstName: string): Student {
  return {
    id,
    firstName,
    lastName,
    gradeLevel: "Grade 10",
    gender: "Male",
    birthdate: "2010-01-01",
    lrn: `1360000000${id}`,
    status: "approved",
    registeredAt: "2026-01-01",
  };
}

function vote(voterId: string, overrides: Partial<VoteListRow> = {}): VoteListRow {
  return {
    voter_id: voterId,
    abstained: false,
    kiosk_id: null,
    transaction_id: null,
    voted_at: "2026-09-06T08:00:00Z",
    ...overrides,
  };
}

describe("parseKioskNumber", () => {
  it("reads the kiosk number wherever it sits in the transaction id", () => {
    expect(parseKioskNumber("TXN-K1-260906-0001")).toBe(1);
    expect(parseKioskNumber("TXN-260906-K2-0001")).toBe(2);
    expect(parseKioskNumber("TXN-260906-0001-K1")).toBe(1);
  });

  it("is case-insensitive and handles multi-digit kiosk numbers", () => {
    expect(parseKioskNumber("TXN-k2-260906-0001")).toBe(2);
    expect(parseKioskNumber("TXN-K12-260906-0001")).toBe(12);
  });

  it("returns null for ids without a kiosk tag", () => {
    expect(parseKioskNumber("TXN-260906-0001")).toBeNull();
    expect(parseKioskNumber("")).toBeNull();
    expect(parseKioskNumber(null)).toBeNull();
    expect(parseKioskNumber(undefined)).toBeNull();
  });
});

describe("buildVoterRows", () => {
  it("marks students with votes as voted and the rest as not voted", () => {
    const rows = buildVoterRows(
      [student("s1", "Cruz", "Ana"), student("s2", "Dela Rosa", "Ben")],
      [vote("s1")],
    );
    expect(rows.find((r) => r.student.id === "s1")?.voted).toBe(true);
    const notVoted = rows.find((r) => r.student.id === "s2");
    expect(notVoted?.voted).toBe(false);
    expect(notVoted?.kioskLabel).toBeNull();
    expect(notVoted?.transactionId).toBeNull();
    expect(notVoted?.votedAt).toBeNull();
  });

  it("counts a student who abstained on every position as voted", () => {
    const rows = buildVoterRows([student("s1", "Cruz", "Ana")], [
      vote("s1", { abstained: true, transaction_id: "TXN-K1-260906-0001" }),
    ]);
    expect(rows[0].voted).toBe(true);
  });

  it("labels the kiosk from the transaction id K-tag", () => {
    const rows = buildVoterRows([student("s1", "Cruz", "Ana")], [
      vote("s1", { transaction_id: "TXN-K1-260906-0001" }),
    ]);
    expect(rows[0].kioskLabel).toBe("Kiosk ID: 1");
  });

  it("collapses the per-position rows of one ballot into a single vote", () => {
    const rows = buildVoterRows([student("s1", "Cruz", "Ana")], [
      vote("s1", { transaction_id: "TXN-K2-260906-0001", voted_at: "2026-09-06T08:00:00Z" }),
      vote("s1", { transaction_id: "TXN-K2-260906-0001", voted_at: "2026-09-06T08:00:01Z" }),
      vote("s1", { transaction_id: "TXN-K2-260906-0001", voted_at: "2026-09-06T08:00:02Z" }),
    ]);
    expect(rows[0].voted).toBe(true);
    expect(rows[0].kioskLabel).toBe("Kiosk ID: 2");
    expect(rows[0].transactionId).toBe("TXN-K2-260906-0001");
    expect(rows[0].votedAt).toBe("2026-09-06T08:00:00Z");
  });

  it("falls back to kiosk_id grouping for ballots without a K-tag, in first-vote order, numbered after the highest parsed kiosk", () => {
    const rows = buildVoterRows(
      [student("s1", "Cruz", "Ana"), student("s2", "Dela Rosa", "Ben"), student("s3", "Evangelista", "Cara")],
      [
        // s3 has a K5-tagged ballot, so parsed kiosks go up to 5.
        vote("s3", { kiosk_id: "kiosk-3", transaction_id: "TXN-K5-260906-0001", voted_at: "2026-09-06T06:00:00Z" }),
        // s2 voted earlier than s1 on untagged ballots on two distinct machines.
        vote("s2", { kiosk_id: "kiosk-b", transaction_id: "TXN-260906-0002", voted_at: "2026-09-06T07:00:00Z" }),
        vote("s1", { kiosk_id: "kiosk-a", transaction_id: "TXN-260906-0003", voted_at: "2026-09-06T08:00:00Z" }),
      ],
    );
    expect(rows.find((r) => r.student.id === "s3")?.kioskLabel).toBe("Kiosk ID: 5");
    expect(rows.find((r) => r.student.id === "s2")?.kioskLabel).toBe("Kiosk ID: 6");
    expect(rows.find((r) => r.student.id === "s1")?.kioskLabel).toBe("Kiosk ID: 7");
  });

  it("marks a vote with no kiosk tag and no kiosk id as Unknown", () => {
    const rows = buildVoterRows([student("s1", "Cruz", "Ana")], [
      vote("s1", { transaction_id: "TXN-260906-0001" }),
    ]);
    expect(rows[0].voted).toBe(true);
    expect(rows[0].kioskLabel).toBe("Unknown");
  });

  it("sorts students alphabetically by last name then first name", () => {
    const rows = buildVoterRows(
      [student("s1", "Zapanta", "Ana"), student("s2", "Cruz", "Ben"), student("s3", "Cruz", "Ada")],
      [],
    );
    expect(rows.map((r) => r.student.id)).toEqual(["s3", "s2", "s1"]);
  });
});
