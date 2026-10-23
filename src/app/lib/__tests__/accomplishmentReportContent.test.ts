import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHIEF_SIGNATORY,
  defaultAccomplishmentReportDraft,
  defaultVenueLine,
  normalizeAccomplishmentReportDraft,
  resolveCommissionerNames,
  resolveSignatoryRoleSelection,
  SIGNATORY_ROLE_OTHER,
} from "../accomplishmentReportContent";

describe("defaultAccomplishmentReportDraft", () => {
  it("fills every section of the report", () => {
    const draft = defaultAccomplishmentReportDraft();
    expect(draft.periodLabel).toBe("2026-2027");
    expect(draft.rationaleLead.length).toBeGreaterThan(0);
    expect(draft.rationaleParagraphs.length).toBeGreaterThan(0);
    expect(draft.objectives.length).toBeGreaterThan(0);
    expect(draft.highlights.length).toBeGreaterThan(0);
    expect(draft.recommendations.length).toBeGreaterThan(0);
    expect(draft.financialLiquidation).toBe("NONE");
    expect(draft.signatoryGroups.map((group) => group.heading)).toEqual([
      "Prepared by:",
      "Noted by:",
      "Approved by:",
    ]);
  });

  it("plugs the seeded school year into the narrative", () => {
    const draft = defaultAccomplishmentReportDraft({ periodLabel: "2030-2031" });
    expect(draft.periodLabel).toBe("2030-2031");
    expect(draft.rationaleParagraphs[0]).toContain("2030-2031");
    expect(draft.objectives[0]).toContain("School Year 2030-2031");
    expect(draft.highlights[0]).toContain("2030-2031");
  });

  it("prints the acting chief on the 'Approved by' line", () => {
    const draft = defaultAccomplishmentReportDraft({ chiefName: "JUAN DELA CRUZ" });
    const approved = draft.signatoryGroups[draft.signatoryGroups.length - 1];
    expect(approved.heading).toBe("Approved by:");
    expect(approved.signatories[0].name).toBe("JUAN DELA CRUZ");

    const fallback = defaultAccomplishmentReportDraft();
    expect(fallback.signatoryGroups[fallback.signatoryGroups.length - 1].signatories[0].name).toBe(
      DEFAULT_CHIEF_SIGNATORY
    );
  });

  // The HTML/printed wording is canonical: the .docx copy had drifted.
  it("uses the printed wording for the drifted lines", () => {
    const draft = defaultAccomplishmentReportDraft();
    expect(draft.highlights[0]).toContain("conducted at Camarines Norte National High School using");
    expect(draft.recommendations[1]).toContain("additional computer units or laptops");
  });

  it("keeps the canonical date and venue when the seed is blank", () => {
    const draft = defaultAccomplishmentReportDraft({ dateTime: "   ", venue: "" });
    expect(draft.dateTime).toBe("February 11, 2026 7:30 AM");
    expect(draft.venue).toBe(defaultVenueLine());
    expect(draft.venue).toContain("Student Vote Counting Kiosk (SVoCK)");
  });

  it("honours a seeded date and venue", () => {
    const draft = defaultAccomplishmentReportDraft({
      dateTime: "March 3, 2031 8:00 AM",
      venue: "Gymnasium",
    });
    expect(draft.dateTime).toBe("March 3, 2031 8:00 AM");
    expect(draft.venue).toBe("Gymnasium");
  });
});

describe("defaultVenueLine", () => {
  it("composes the school, the Stage-4 venue and the SVoCK platform", () => {
    expect(defaultVenueLine("CNNHS Covered Court")).toBe(
      "Camarines Norte National High School CNNHS Covered Court Using Student Vote Counting Kiosk (SVoCK)"
    );
  });

  it("drops the venue part when none is set", () => {
    expect(defaultVenueLine()).toBe(
      "Camarines Norte National High School Using Student Vote Counting Kiosk (SVoCK)"
    );
    expect(defaultVenueLine("   ")).toBe(defaultVenueLine());
  });
});

describe("resolveSignatoryRoleSelection", () => {
  it("maps the official LG-COMEA titles onto their dropdown options", () => {
    expect(resolveSignatoryRoleSelection("LG-COMEA Electoral Commissioner")).toEqual({
      option: "LG-COMEA Electoral Commissioner",
      customText: "",
    });
    expect(
      resolveSignatoryRoleSelection("School Head / LG-COMEA Chief Commissioner").option
    ).toBe("School Head / LG-COMEA Chief Commissioner");
  });

  it("selects 'Others' for custom or bundled template roles, keeping their text", () => {
    expect(resolveSignatoryRoleSelection("LG-COMEA Student Chairperson")).toEqual({
      option: SIGNATORY_ROLE_OTHER,
      customText: "LG-COMEA Student Chairperson",
    });
    expect(resolveSignatoryRoleSelection("Adviser")).toEqual({
      option: SIGNATORY_ROLE_OTHER,
      customText: "Adviser",
    });
  });

  it("selects 'Others' with empty text for a blank role", () => {
    expect(resolveSignatoryRoleSelection("")).toEqual({
      option: SIGNATORY_ROLE_OTHER,
      customText: "",
    });
  });
});

describe("resolveCommissionerNames", () => {
  const roster = [
    { full_name: "JUAN DELA CRUZ", role_type: "chief", commissioner_role: "chief", status: "active" },
    { full_name: "MARIA SANTOS", role_type: "commissioner", commissioner_role: "electoral_board", status: "active" },
    { full_name: "PEDRO REYES", role_type: "commissioner", commissioner_role: "screening_validation", status: "active" },
    { full_name: "ANA LIM", role_type: "commissioner", commissioner_role: "grievance", status: "active" },
    { full_name: "CO CO-GO", role_type: "co_commissioner", commissioner_role: "electoral_board", status: "active" },
    { full_name: "SSLG ADVISER", role_type: "sslg_adviser", commissioner_role: null, status: "active" },
  ];

  it("maps each commissioner title to the acting officer's name", () => {
    expect(resolveCommissionerNames(roster)).toEqual({
      "LG-COMEA Electoral Commissioner": "MARIA SANTOS",
      "LG-COMEA Screening and Validation Commissioner": "PEDRO REYES",
      "LG-COMEA Grievance Commissioner": "ANA LIM",
      "LG-COMEA Electoral Co-commissioner": "CO CO-GO",
      "School Head / LG-COMEA Chief Commissioner": "JUAN DELA CRUZ",
    });
  });

  it("prefers the primary commissioner over a co-commissioner of the same role", () => {
    const names = resolveCommissionerNames(roster);
    expect(names["LG-COMEA Electoral Commissioner"]).toBe("MARIA SANTOS");
  });

  it("ignores inactive staff and blank names", () => {
    const names = resolveCommissionerNames([
      { full_name: "INACTIVE CHIEF", role_type: "chief", commissioner_role: "chief", status: "inactive" },
      { full_name: null, role_type: "commissioner", commissioner_role: "grievance", status: "active" },
    ]);
    expect(names).toEqual({});
  });

  it("never maps a title for Appointed Commissioner (no system role)", () => {
    const names = resolveCommissionerNames(roster);
    expect(names["LG-COMEA Appointed Commissioner"]).toBeUndefined();
    expect(Object.keys(names)).not.toContain(SIGNATORY_ROLE_OTHER);
  });
});

describe("defaultAccomplishmentReportDraft officer names", () => {
  const officerNames = {
    "LG-COMEA Electoral Commissioner": "ELECTORAL OFFICER",
    "LG-COMEA Screening and Validation Commissioner": "SCREENING OFFICER",
    "LG-COMEA Grievance Commissioner": "GRIEVANCE OFFICER",
    "LG-COMEA Electoral Co-commissioner": "CO-COMMISSIONER OFFICER",
    "School Head / LG-COMEA Chief Commissioner": "CHIEF OFFICER",
  };

  it("swaps the bundled signatory names for the roster officers", () => {
    const draft = defaultAccomplishmentReportDraft({ chiefName: "CHIEF OFFICER", officerNames });
    const noted = draft.signatoryGroups.find((g) => g.heading === "Noted by:");
    expect(noted?.signatories.map((s) => s.name)).toEqual([
      "ELECTORAL OFFICER",
      "SCREENING OFFICER",
      "CO-COMMISSIONER OFFICER",
      "GRIEVANCE OFFICER",
      "WILSON ANGEL H. VILLARIN, ASP-II", // no system record — bundled name kept
    ]);
    // Roles (and the unresolvable student lines) are untouched.
    expect(noted?.signatories.map((s) => s.role)).toContain("LG-COMEA Grievance Commissioner");
    const prepared = draft.signatoryGroups.find((g) => g.heading === "Prepared by:");
    expect(prepared?.signatories[0].name).toBe("MARIEL D. PAULAR");
  });

  it("keeps every bundled name when no roster names are supplied", () => {
    const draft = defaultAccomplishmentReportDraft({ chiefName: "CHIEF OFFICER" });
    const noted = draft.signatoryGroups.find((g) => g.heading === "Noted by:");
    expect(noted?.signatories[0].name).toBe("MELISSA M. MELENDREZ");
    expect(noted?.signatories[3].name).toBe("IVY DENICE M. ABOGADO, RGC");
  });
});

describe("normalizeAccomplishmentReportDraft", () => {
  it("falls back to the template for malformed input", () => {
    const fallback = defaultAccomplishmentReportDraft();
    expect(normalizeAccomplishmentReportDraft(null).objectives).toEqual(fallback.objectives);
    expect(normalizeAccomplishmentReportDraft("nope").periodLabel).toBe("2026-2027");
    expect(normalizeAccomplishmentReportDraft(undefined).highlights).toEqual(fallback.highlights);
  });

  it("keeps the Chief's edited strings, lists and signatories", () => {
    const draft = normalizeAccomplishmentReportDraft({
      periodLabel: "2029-2030",
      financialLiquidation: "PHP 1,500.00",
      objectives: ["Only one objective"],
      signatoryGroups: [
        { heading: "Approved by:", signatories: [{ name: "Person", role: "Role" }] },
      ],
    });
    expect(draft.periodLabel).toBe("2029-2030");
    expect(draft.financialLiquidation).toBe("PHP 1,500.00");
    expect(draft.objectives).toEqual(["Only one objective"]);
    expect(draft.signatoryGroups).toHaveLength(1);
    expect(draft.signatoryGroups[0].signatories[0]).toEqual({ name: "Person", role: "Role" });
    // Sections the Chief never touched still come from the template.
    expect(draft.recommendations.length).toBeGreaterThan(0);
    expect(draft.rationaleParagraphs.length).toBeGreaterThan(0);
  });

  it("allows a cleared field to stay cleared", () => {
    const draft = normalizeAccomplishmentReportDraft({ rationaleLead: "", venue: "" });
    expect(draft.rationaleLead).toBe("");
    expect(draft.venue).toBe("");
  });

  it("drops malformed lists and empty signatory groups back to the template", () => {
    const fallback = defaultAccomplishmentReportDraft();
    expect(normalizeAccomplishmentReportDraft({ objectives: [1, 2, 3] }).objectives).toEqual(
      fallback.objectives
    );
    expect(normalizeAccomplishmentReportDraft({ signatoryGroups: [] }).signatoryGroups).toEqual(
      fallback.signatoryGroups
    );
    expect(
      normalizeAccomplishmentReportDraft({ signatoryGroups: [{ heading: 5, signatories: "x" }] })
        .signatoryGroups
    ).toEqual([{ heading: "", signatories: [] }]);
  });
});
