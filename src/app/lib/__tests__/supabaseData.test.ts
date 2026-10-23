import { describe, it, expect } from "vitest";
import { isUuid, normalize, parseCsv, toDate, toTime, buildStudentSyncPayload } from "../supabaseData";
import { mapStaffLoginRow } from "../supabaseData";
import type { CurrentUser, Student } from "../../context/AppContext";

const baseStudent: Student = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  firstName: "Juan",
  lastName: "Dela Cruz",
  gradeLevel: "Grade 7",
  gender: "Male",
  birthdate: "2009-05-14",
  lrn: "123456789012",
  status: "approved",
  registeredAt: "2026-06-01",
};

describe("buildStudentSyncPayload", () => {
  it("includes verification when the state knows the verdict", () => {
    for (const verificationStatus of ["automatic", "manual"] as const) {
      const payload = buildStudentSyncPayload({ ...baseStudent, verificationStatus });
      expect(payload.verification).toBe(verificationStatus);
    }
  });

  it("omits verification when the state row never carried a verdict", () => {
    // Must not blank out what the registration/review flow persisted —
    // an auto-approved student has to keep 'automatic' in the DB.
    const payload = buildStudentSyncPayload(baseStudent);
    expect("verification" in payload).toBe(false);
  });

  it("always writes the surviving student columns", () => {
    const payload = buildStudentSyncPayload({ ...baseStudent, verificationStatus: "automatic" });
    expect(payload).toMatchObject({
      first_name: "Juan",
      last_name: "Dela Cruz",
      grade_level: "Grade 7",
      gender: "Male",
      status: "approved",
      lrn: "123456789012",
    });
  });
});

describe("toDate", () => {
  it("returns the YYYY-MM-DD slice of a datetime string", () => {
    expect(toDate("2026-09-14T08:30:00+08:00")).toBe("2026-09-14");
  });

  it("returns an empty string for falsy values", () => {
    expect(toDate(undefined)).toBe("");
    expect(toDate("")).toBe("");
  });
});

describe("toTime", () => {
  it("returns an empty string for falsy values", () => {
    expect(toTime(undefined)).toBe("");
    expect(toTime("")).toBe("");
  });

  it("returns a HH:MM time string for a valid timestamp (timezone-independent)", () => {
    expect(toTime("2026-09-14T08:30:00+08:00")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("isUuid", () => {
  it("accepts valid UUIDs with version nibble 1-5", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts uppercase UUIDs", () => {
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  it("rejects UUIDs with a version nibble outside 1-5 (e.g. v7)", () => {
    expect(isUuid("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")).toBe(false);
  });
});

describe("normalize", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalize("  DE LA  Cruz ")).toBe("de la cruz");
  });

  it("returns an empty string for falsy values", () => {
    expect(normalize(undefined)).toBe("");
    expect(normalize("")).toBe("");
  });
});

describe("parseCsv", () => {
  it("parses a simple CSV", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const csv = 'name,note\n"Smith, John","said ""hi"""';
    expect(parseCsv(csv)).toEqual([
      ["name", "note"],
      ["Smith, John", 'said "hi"'],
    ]);
  });

  it("handles CRLF line endings and skips empty rows", () => {
    expect(parseCsv("a,b\r\n\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for a blank input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("mapStaffLoginRow", () => {
  it("maps a chief row to role admin with default name/commissionerRole", () => {
    const row = { id: "u1", role_type: "chief", commissioner_role: "chief", full_name: null, email: null };
    const user = mapStaffLoginRow(row, "chief@cnnhs.edu");
    expect(user).toEqual({
      id: "u1",
      name: "Chief Commissioner",
      role: "admin",
      email: "chief@cnnhs.edu",
      commissionerRole: "chief",
      mustChangePassword: false,
    } as CurrentUser);
  });

  it("maps a commissioner row with commissioner_role preserving name/email", () => {
    const row = { id: "u2", role_type: "commissioner", commissioner_role: "screening_validation", full_name: "Jane Doe", email: "jane@cnnhs.edu" };
    const user = mapStaffLoginRow(row, "fallback@cnnhs.edu");
    expect(user).toEqual({
      id: "u2",
      name: "Jane Doe",
      role: "admin",
      email: "jane@cnnhs.edu",
      commissionerRole: "screening_validation",
      mustChangePassword: false,
    } as CurrentUser);
  });

  it("maps a co_commissioner row keeping the appointing commissioner_role passthrough", () => {
    const row = { id: "u3", role_type: "co_commissioner", commissioner_role: "electoral_board", full_name: null, email: null };
    const user = mapStaffLoginRow(row, "co@cnnhs.edu");
    expect(user).toEqual({
      id: "u3",
      name: "Chief Commissioner",
      role: "admin",
      email: "co@cnnhs.edu",
      commissionerRole: "electoral_board",
      mustChangePassword: false,
    } as CurrentUser);
  });

  it("maps an sslg_adviser row with role ss lg_adviser, no commissionerRole", () => {
    const row = { id: "u4", role_type: "sslg_adviser", commissioner_role: null, full_name: "Adviser One", email: "adv@cnnhs.edu" };
    const user = mapStaffLoginRow(row, "fallback@cnnhs.edu");
    expect(user).toEqual({
      id: "u4",
      name: "Adviser One",
      role: "sslg_adviser",
      email: "adv@cnnhs.edu",
      commissionerRole: undefined,
      mustChangePassword: false,
    } as CurrentUser);
  });

  it("throws for an unrecognized role_type", () => {
    const row = { id: "u5", role_type: "officer", commissioner_role: null, full_name: null, email: null };
    expect(() => mapStaffLoginRow(row, "officer@cnnhs.edu")).toThrow("This account does not have admin privileges.");
  });
});