// Unit tests for the shared birthdate rules (lib/birthdate.ts) used by the
// student registration and candidacy forms: 5-100 year age window, dropdown
// part helpers, and leap-year-aware day counts.  A fixed "today" keeps every
// expectation deterministic regardless of when the suite runs.

import { describe, it, expect } from "vitest";
import {
  MONTH_NAMES,
  birthYearOptions,
  computeAge,
  daysInMonth,
  joinBirthdate,
  splitBirthdate,
  validateBirthdate,
} from "../birthdate";

// A fixed reference "today": November 8, 2026.
const TODAY = new Date(2026, 10, 8);

describe("daysInMonth", () => {
  it("returns the correct day counts, including leap years", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28); // not a leap year
    expect(daysInMonth(2024, 2)).toBe(29); // leap year
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("falls back to 31 for unusable input (e.g. no month picked yet)", () => {
    expect(daysInMonth(NaN, 2)).toBe(31);
    expect(daysInMonth(2026, 13)).toBe(31);
    expect(daysInMonth(2026, 0)).toBe(31);
  });
});

describe("splitBirthdate / joinBirthdate", () => {
  it("round-trips a stored YYYY-MM-DD date into unpadded dropdown parts", () => {
    const parts = splitBirthdate("2012-05-01");
    expect(parts).toEqual({ year: "2012", month: "5", day: "1" });
    expect(joinBirthdate(parts.year, parts.month, parts.day)).toBe("2012-05-01");
  });

  it("zero-pads on the way back in", () => {
    expect(joinBirthdate("2011", "3", "15")).toBe("2011-03-15");
  });

  it("returns empty parts for blank or malformed dates", () => {
    expect(splitBirthdate("")).toEqual({ year: "", month: "", day: "" });
    expect(splitBirthdate("not-a-date")).toEqual({ year: "", month: "", day: "" });
    expect(joinBirthdate("2012", "", "1")).toBe("");
  });
});

describe("computeAge", () => {
  it("counts a birthday that has already happened this year", () => {
    expect(computeAge("2012-05-01", TODAY)).toBe(14);
  });

  it("does not count a birthday later in the year", () => {
    expect(computeAge("2012-12-01", TODAY)).toBe(13);
  });

  it("treats an exact birthday as reached", () => {
    expect(computeAge("2021-11-08", TODAY)).toBe(5);
  });

  it("handles the 100-year boundary", () => {
    expect(computeAge("1926-11-08", TODAY)).toBe(100);
    expect(computeAge("1926-11-09", TODAY)).toBe(99);
    expect(computeAge("1925-11-08", TODAY)).toBe(101);
  });

  it("goes negative for future dates", () => {
    expect(computeAge("2027-01-01", TODAY)).toBe(-1);
  });

  it("returns null for blank, malformed, or impossible dates", () => {
    expect(computeAge("", TODAY)).toBeNull();
    expect(computeAge("nope", TODAY)).toBeNull();
    expect(computeAge("2021-02-31", TODAY)).toBeNull(); // rolls over — rejected
  });
});

describe("birthYearOptions", () => {
  it("offers the five-years-ago year down to the hundred-years-ago year, newest first", () => {
    const years = birthYearOptions(TODAY);
    expect(years[0]).toBe(2021); // currentYear - MIN_AGE_YEARS
    expect(years[years.length - 1]).toBe(1926); // currentYear - MAX_AGE_YEARS
    expect(years).toHaveLength(96);
    // Newest first so the common (school-age) years are near the top.
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });
});

describe("validateBirthdate", () => {
  it("accepts ordinary school-age birthdates", () => {
    expect(validateBirthdate("2012-05-01", TODAY)).toBeNull();
    expect(validateBirthdate("2011-03-15", TODAY)).toBeNull();
  });

  it("accepts both age boundaries (exactly 5 and exactly 100)", () => {
    expect(validateBirthdate("2021-11-08", TODAY)).toBeNull();
    expect(validateBirthdate("1926-11-08", TODAY)).toBeNull();
  });

  it("rejects dates within the last 5 years", () => {
    const err = validateBirthdate("2021-11-09", TODAY);
    expect(err).toMatch(/at least 5 years/);
    expect(validateBirthdate("2024-06-01", TODAY)).toMatch(/at least 5 years/);
  });

  it("rejects future dates", () => {
    expect(validateBirthdate("2027-01-01", TODAY)).toMatch(/future/);
  });

  it("rejects birthdates older than 100 years", () => {
    expect(validateBirthdate("1925-11-07", TODAY)).toMatch(/more than 100 years/);
  });

  it("rejects malformed dates", () => {
    expect(validateBirthdate("2021-02-31", TODAY)).toMatch(/valid date of birth/);
    expect(validateBirthdate("", TODAY)).toMatch(/valid date of birth/);
  });
});

describe("MONTH_NAMES", () => {
  it("has the twelve calendar months in order", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe("January");
    expect(MONTH_NAMES[11]).toBe("December");
  });
});
