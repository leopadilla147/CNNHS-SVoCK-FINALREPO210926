// Shared birthdate rules for the student-facing forms (registration and
// candidacy).  A birthdate must place the student between MIN_AGE_YEARS and
// MAX_AGE_YEARS years old: the last five years (including today and anything
// in the future) are not selectable, and neither is anything more than a
// hundred years back.  The date-of-birth pickers are built from these helpers
// so both forms enforce exactly the same window.

export const MIN_AGE_YEARS = 5;
export const MAX_AGE_YEARS = 100;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface BirthdateParts {
  year: string;
  /** 1-12, unpadded — matches <option> values in the month dropdown. */
  month: string;
  /** 1-31, unpadded — matches <option> values in the day dropdown. */
  day: string;
}

/** Parse a stored "YYYY-MM-DD" birthdate into dropdown-friendly parts. */
export function splitBirthdate(birthdate: string): BirthdateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((birthdate || "").trim());
  if (!match) return { year: "", month: "", day: "" };
  return {
    year: match[1],
    month: String(parseInt(match[2], 10)),
    day: String(parseInt(match[3], 10)),
  };
}

/** Join dropdown parts back into a zero-padded "YYYY-MM-DD", or "" when any part is missing. */
export function joinBirthdate(year: string, month: string, day: string): string {
  if (!year || !month || !day) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Days in a month (month is 1-12), leap-year aware.  Falls back to 31 for anything unusable. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 31;
  return new Date(year, month, 0).getDate();
}

/**
 * Selectable birth years, newest first: [currentYear - MIN_AGE_YEARS ...
 * currentYear - MAX_AGE_YEARS].  Years for the disabled window (recent and
 * future dates) and beyond the age cap are simply never offered.
 */
export function birthYearOptions(today = new Date()): number[] {
  const currentYear = today.getFullYear();
  const years: number[] = [];
  for (let y = currentYear - MIN_AGE_YEARS; y >= currentYear - MAX_AGE_YEARS; y--) {
    years.push(y);
  }
  return years;
}

/** Whole years lived as of `today`, or null for blank/unparseable/impossible dates. */
export function computeAge(birthdate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((birthdate || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dob = new Date(year, month - 1, day);
  // Reject rolled-over dates (e.g. "2021-02-31" becomes March 3rd).
  if (dob.getFullYear() !== year || dob.getMonth() !== month - 1 || dob.getDate() !== day) {
    return null;
  }
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) age--;
  return age;
}

/**
 * The age window rule shared by both forms: a birthdate is acceptable only
 * when it is in the past by more than MIN_AGE_YEARS years (nothing from the
 * last five years, today, or the future) and no more than MAX_AGE_YEARS ago.
 * Returns an error message, or null when the date is acceptable.
 */
export function validateBirthdate(birthdate: string, today = new Date()): string | null {
  const age = computeAge(birthdate, today);
  if (age === null) return "Please pick a valid date of birth.";
  if (age < 0) return "Date of birth cannot be in the future.";
  if (age < MIN_AGE_YEARS) {
    return `Age must be at least ${MIN_AGE_YEARS} years — dates within the last ${MIN_AGE_YEARS} years are not allowed.`;
  }
  if (age > MAX_AGE_YEARS) {
    return `Age cannot be more than ${MAX_AGE_YEARS} years.`;
  }
  return null;
}
