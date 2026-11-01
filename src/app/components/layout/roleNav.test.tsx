import { describe, expect, it } from "vitest";
import {
  chiefTopItems,
  electoralNavItems,
  getCalendarHref,
  grievanceNavItems,
  screeningNavItems,
  sslgAdviserTopItems,
  studentNavItems,
} from "./roleNav";

// Placement rule: every role's tab list keeps "Election Calendar" directly
// above the profile tab — the sidebar and the header dropdown both render
// from these lists, so asserting here covers both surfaces.
const NAV_LISTS: Array<[string, typeof studentNavItems]> = [
  ["student", studentNavItems],
  ["chief commissioner", chiefTopItems],
  ["SSLG adviser", sslgAdviserTopItems],
  ["screening & validation commissioner", screeningNavItems],
  ["electoral board commissioner", electoralNavItems],
  ["grievance commissioner", grievanceNavItems],
];

describe("roleNav tab placement", () => {
  it.each(NAV_LISTS)(
    "%s list puts Election Calendar directly above the profile tab",
    (_name, items) => {
      const calendarIndex = items.findIndex((item) => item.label === "Election Calendar");
      const profileIndex = items.findIndex((item) => /Profile/i.test(item.label));
      expect(calendarIndex).toBeGreaterThan(-1);
      expect(profileIndex).toBeGreaterThan(-1);
      expect(calendarIndex).toBe(profileIndex - 1);
    },
  );
});

describe("getCalendarHref", () => {
  it("sends guests to the public calendar", () => {
    expect(getCalendarHref(null)).toBe("/calendar");
  });

  it("sends a signed-in student to the student portal calendar", () => {
    expect(getCalendarHref({ role: "student" })).toBe("/student/calendar");
  });

  it.each(["admin", "sslg_adviser"] as const)("sends a %s to the admin calendar", (role) => {
    expect(getCalendarHref({ role })).toBe("/admin/calendar");
  });
});
