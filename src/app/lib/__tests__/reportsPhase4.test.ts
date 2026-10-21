import { describe, it, expect } from "vitest";
import { generateComeaCertificate, generateChiefElectionReport } from "../reports";
import { defaultAccomplishmentReportDraft } from "../accomplishmentReportContent";
import type { Candidate } from "../../context/AppContext";

function candidate(id: string, surname: string, givenName: string): Candidate {
  return {
    id,
    surname,
    givenName,
    gradeLevel: "Grade 11",
    position: "President",
    gender: "Male",
    dateOfBirth: "2009-01-01",
    age: 17,
    email: `${givenName.toLowerCase()}@test.local`,
    mobileNumber: "09171234567",
    homeAddress: "Daet, Camarines Norte",
    documents: {
      applicationForm: true,
      introductoryProfile: true,
    },
    status: "approved",
    submittedAt: "2026-01-01T00:00:00Z",
    votes: 0,
    studentId: "student-1",
  };
}

describe("generateComeaCertificate", () => {
  it("returns a non-empty HTML document", () => {
    const html = generateComeaCertificate({
      studentName: "Juan Dela Cruz",
      position: "President",
      academicYear: "2026-2027",
    });
    expect(html.length).toBeGreaterThan(200);
  });

  it("embeds the certificate artwork as a data-URI image", () => {
    const html = generateComeaCertificate({
      studentName: "Maria Santos",
      position: "Secretary",
      academicYear: "2026-2027",
    });
    expect(html).toContain("data:image/png;base64");
    expect(html).toContain('<img class="art"');
  });

  it("escapes a malicious studentName so it cannot inject markup (D-14)", () => {
    const html = generateComeaCertificate({
      studentName: `</div><script>alert(1)</script><div class="x">`,
      position: `President"><img src=x onerror=alert(2)>`,
      academicYear: "2026-2027",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<div class=\"x\">");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });
});

describe("generateChiefElectionReport", () => {
  const sampleInput = {
    periodLabel: "2026-2027",
    totals: { totalVoters: 100, voted: 75, notVoted: 25, turnoutPct: 75 },
    approvedCandidates: [candidate("1", "Dela Cruz", "Juan"), candidate("2", "Santos", "Maria")],
    results: [
      {
        position: "President",
        winnerName: "Juan Dela Cruz",
        party: "Independent",
        gradeLevel: "Grade 11",
        votes: 120,
      },
    ],
  };

  it("returns a non-empty HTML document", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html.length).toBeGreaterThan(200);
  });

  it("mirrors the COMEA accomplishment-report headings", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).toContain("ACCOMPLISHMENT REPORT");
    expect(html).toContain("DETAILS OF THE ACTIVITY");
  });

  // v1.3 (Chief's request): the "Election Summary / Highlights" metrics table
  // and the winners ("Result of the Election...") table were removed from
  // the document.
  it("no longer renders the Summary / winners sections", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).not.toContain("Election Summary / Highlights");
    expect(html).not.toContain("The Result of the Election and Elected Candidates");
    expect(html).not.toContain("No results to report");
  });

  it("renders attached photo documentation when images are supplied", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      documentationImages: [
        { url: "data:image/png;base64,AAAA", caption: "Voting day" },
        { url: "data:image/png;base64,BBBB" },
      ],
    });
    expect(html).toContain("Documentation");
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("Voting day");
    expect(html).toContain("Documentation photo 2");
    // The photos are appended after the COMEA signatories.
    expect(html.indexOf("Documentation")).toBeGreaterThan(html.indexOf("Approved by:"));
  });

  it("omits the Documentation section when no images are supplied", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).not.toContain("Documentation");
  });

  it("escapes a marked-up documentation caption before it enters the HTML (D-14)", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      documentationImages: [{ url: "data:image/png;base64,AAAA", caption: `<img src=x onerror=alert(9)>` }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  // 068 renamed every officer account: the acting chief's name replaces the
  // bundled template signatory on the "Approved by" line.
  it("prints the chief's name on the Approved-by signatory when supplied", () => {
    const html = generateChiefElectionReport({ ...sampleInput, chiefName: "Generated Officer Name" });
    expect(html).toContain("Generated Officer Name");
    expect(html).not.toContain("FRANCISCO D. TORRERO, SSP-II");
  });

  it("keeps the template signatory when no chiefName is supplied", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).toContain("FRANCISCO D. TORRERO, SSP-II");
  });

  it("escapes a marked-up chiefName before it enters the HTML (D-14)", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      chiefName: `<img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  // The Reports page editor hands the generator the Chief's edited draft, so
  // the printed document must show that text instead of the bundled template.
  it("renders the Chief's edited draft text instead of the template", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      draft: {
        ...defaultAccomplishmentReportDraft({ periodLabel: "2026-2027" }),
        rationaleLead: "EDITED LEAD LINE",
        objectives: ["EDITED OBJECTIVE"],
        highlights: ["EDITED HIGHLIGHT"],
        financialLiquidation: "PHP 2,500.00",
        recommendations: ["EDITED RECOMMENDATION"],
        signatoryGroups: [
          { heading: "Approved by:", signatories: [{ name: "EDITED SIGNATORY", role: "EDITED ROLE" }] },
        ],
      },
    });
    expect(html).toContain("EDITED LEAD LINE");
    expect(html).toContain("EDITED OBJECTIVE");
    expect(html).toContain("EDITED HIGHLIGHT");
    expect(html).toContain("PHP 2,500.00");
    expect(html).toContain("EDITED RECOMMENDATION");
    expect(html).toContain("EDITED SIGNATORY");
    expect(html).toContain("EDITED ROLE");
    expect(html).not.toContain("Prepared by:");
    expect(html).not.toContain("additional computer units or laptops");
  });

  it("falls back to the bundled COMEA text when no draft is supplied", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).toContain("Accomplishment Report of (COMEA)");
    expect(html).toContain("additional computer units or laptops");
    expect(html).toContain("Prepared by:");
  });

  it("takes the period, date and venue from the draft when one is supplied", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      periodLabel: "IGNORED-PERIOD",
      dateTime: "IGNORED DATE",
      venue: "IGNORED VENUE",
      draft: {
        ...defaultAccomplishmentReportDraft(),
        periodLabel: "2031-2032",
        dateTime: "March 3, 2031 8:00 AM",
        venue: "EDITED VENUE",
      },
    });
    expect(html).toContain("2031-2032");
    expect(html).toContain("March 3, 2031 8:00 AM");
    expect(html).toContain("EDITED VENUE");
    expect(html).not.toContain("IGNORED-PERIOD");
    expect(html).not.toContain("IGNORED VENUE");
  });

  it("keeps Documentation after the edited signatories", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      draft: {
        ...defaultAccomplishmentReportDraft(),
        signatoryGroups: [
          { heading: "Approved by:", signatories: [{ name: "EDITED SIGNATORY", role: "EDITED ROLE" }] },
        ],
      },
      documentationImages: [{ url: "data:image/png;base64,AAAA" }],
    });
    expect(html.indexOf("Documentation")).toBeGreaterThan(html.indexOf("Approved by:"));
  });
});