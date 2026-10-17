import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import {
  buildAccomplishmentReportDocx,
  saveAccomplishmentReportDocx,
  type AccomplishmentReportDocxInput,
} from "../docxAccomplishmentReport";
import { defaultAccomplishmentReportDraft } from "../accomplishmentReportContent";

/** 1x1 transparent PNG, used to exercise the embedded image path. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const sampleInput = {
  periodLabel: "2026-2027",
  dateTime: "February 11, 2026 7:30 AM",
  venue: "Camarines Norte National High School Computer Laboratory",
  totals: {
    totalVoters: 1500,
    voted: 1350,
    notVoted: 150,
    turnoutPct: 90,
  },
  approvedCandidates: [
    {
      id: "c1",
      surname: "Dela Cruz",
      givenName: "Juan",
      position: "President",
      gradeLevel: "Grade 11",
      gender: "Male",
      dateOfBirth: "2009-01-01",
      age: 17,
      email: "juan@test.local",
      mobileNumber: "09171234567",
      homeAddress: "Daet",
      documents: { applicationForm: true, introductoryProfile: true, screeningForm: true, reportCard: true, goodMoralCert: true },
      status: "approved" as const,
      submittedAt: "2026-01-01T00:00:00Z",
      votes: 750,
      studentId: "s1",
    },
  ],
  results: [
    {
      position: "President",
      winnerName: "Juan Dela Cruz",
      party: "Mabuhay Party",
      gradeLevel: "Grade 11",
      votes: 750,
    },
  ],
};

async function extractBodyXml(input: AccomplishmentReportDocxInput): Promise<string> {
  const blob = await Packer.toBlob(buildAccomplishmentReportDocx(input));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("missing word/document.xml in packed docx");
  return xml;
}

describe("buildAccomplishmentReportDocx", () => {
  it("builds a valid docx containing COMEA headers and section details", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Region V-Bicol");
    expect(xml).toContain("SDO-Camarines Norte");
    expect(xml).toContain("Camarines Norte National High School");
    expect(xml).toContain("DETAILS OF THE ACTIVITY");
    expect(xml).toContain("Accomplishment Report of (COMEA)");
    expect(xml).toContain("Supreme Secondary Learner Government");
    expect(xml).toContain("MARIEL D. PAULAR");
    expect(xml).toContain("FRANCISCO D. TORRERO, SSP-II");
  });

  // v1.3 (Chief's request): the "Election Summary / Highlights" metrics table
  // and the winners ("Result of the Election...") table were removed.
  it("no longer renders the Summary / winners sections", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).not.toContain("Election Summary / Highlights");
    expect(xml).not.toContain("The Result of the Election and Elected Candidates");
    expect(xml).not.toContain("No results to report");
  });

  it("embeds attached photo documentation when images are supplied", async () => {
    const png = Uint8Array.from(atob(TINY_PNG), (char) => char.charCodeAt(0));
    const xml = await extractBodyXml({
      ...sampleInput,
      documentationImages: [
        { data: png, type: "png", width: 40, height: 30, caption: "Voting day" },
      ],
    });
    expect(xml).toContain("Documentation");
    expect(xml).toContain("Voting day");
    expect(xml).toContain("w:drawing");
    // The photos are appended after the COMEA signatories.
    expect(xml.indexOf("Documentation")).toBeGreaterThan(xml.indexOf("Approved by:"));
  });

  it("omits the Documentation section when no images are supplied", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).not.toContain("Documentation");
  });

  // 068 renamed every officer account: the acting chief's name replaces the
  // bundled template signatory on the "Approved by" line.
  it("prints the chief's name on the Approved-by signatory when supplied", async () => {
    const xml = await extractBodyXml({ ...sampleInput, chiefName: "Generated Officer Name" });
    expect(xml).toContain("Generated Officer Name");
    expect(xml).not.toContain("FRANCISCO D. TORRERO, SSP-II");
  });

  it("keeps the template signatory when no chiefName is supplied", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("FRANCISCO D. TORRERO, SSP-II");
  });

  // The Reports page editor hands the builder the Chief's edited draft, so the
  // .docx must show that text instead of the bundled template.
  it("renders the Chief's edited draft text instead of the template", async () => {
    const xml = await extractBodyXml({
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
    expect(xml).toContain("EDITED LEAD LINE");
    expect(xml).toContain("EDITED OBJECTIVE");
    expect(xml).toContain("EDITED HIGHLIGHT");
    expect(xml).toContain("PHP 2,500.00");
    expect(xml).toContain("EDITED RECOMMENDATION");
    expect(xml).toContain("EDITED SIGNATORY");
    expect(xml).not.toContain("Prepared by:");
    expect(xml).not.toContain("additional computer terminals");
  });

  it("falls back to the bundled COMEA text when no draft is supplied", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Accomplishment Report of (COMEA)");
    // The printed (canonical) wording — the .docx used to drift here.
    expect(xml).toContain("additional computer units or laptops");
    expect(xml).toContain("Prepared by:");
  });

  it("takes the period, date and venue from the draft when one is supplied", async () => {
    const xml = await extractBodyXml({
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
    expect(xml).toContain("2031-2032");
    expect(xml).toContain("March 3, 2031 8:00 AM");
    expect(xml).toContain("EDITED VENUE");
    expect(xml).not.toContain("IGNORED-PERIOD");
    expect(xml).not.toContain("IGNORED VENUE");
  });

  it("lays signatory blocks out two per row with the last lone one centred", async () => {
    const xml = await extractBodyXml({
      ...sampleInput,
      draft: {
        ...defaultAccomplishmentReportDraft(),
        signatoryGroups: [
          {
            heading: "Noted by:",
            signatories: [
              { name: "FIRST PERSON", role: "Role 1" },
              { name: "SECOND PERSON", role: "Role 2" },
              { name: "THIRD PERSON", role: "Role 3" },
            ],
          },
        ],
      },
    });
    expect(xml).toContain("FIRST PERSON");
    expect(xml).toContain("THIRD PERSON");
    expect(xml).toContain("w:gridSpan");
  });
});

describe("saveAccomplishmentReportDocx", () => {
  it("triggers browser download", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    (URL as any).createObjectURL = () => "blob:mock";
    (URL as any).revokeObjectURL = () => {};

    const spy: { clicked: boolean; download?: string } = { clicked: false };
    const originalAppend = document.body.appendChild;
    const originalRemove = document.body.removeChild;

    document.body.appendChild = ((node: HTMLElement) => {
      if (node.tagName === "A") {
        const a = node as HTMLAnchorElement;
        spy.download = a.download;
        a.click = () => {
          spy.clicked = true;
        };
      }
      return node;
    }) as any;
    document.body.removeChild = ((node: HTMLElement) => node) as any;

    try {
      await saveAccomplishmentReportDocx(sampleInput, "test-report.docx");
      expect(spy.clicked).toBe(true);
      expect(spy.download).toBe("test-report.docx");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      document.body.appendChild = originalAppend;
      document.body.removeChild = originalRemove;
    }
  });
});

