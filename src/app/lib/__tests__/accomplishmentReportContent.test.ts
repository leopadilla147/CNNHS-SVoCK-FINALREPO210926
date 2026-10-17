import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHIEF_SIGNATORY,
  defaultAccomplishmentReportDraft,
  normalizeAccomplishmentReportDraft,
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
    expect(draft.venue).toContain("CNNHS SVoCK Online Voting System");
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
