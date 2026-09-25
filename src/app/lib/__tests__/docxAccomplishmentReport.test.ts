import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import { buildAccomplishmentReportDocx, saveAccomplishmentReportDocx } from "../docxAccomplishmentReport";

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

async function extractBodyXml(input: typeof sampleInput): Promise<string> {
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
    expect(xml).toContain("Juan Dela Cruz");
    expect(xml).toContain("Mabuhay Party");
    expect(xml).toContain("750");
    expect(xml).toContain("MARIEL D. PAULAR");
    expect(xml).toContain("FRANCISCO D. TORRERO, SSP-II");
  });

  it("handles empty results gracefully", async () => {
    const xml = await extractBodyXml({ ...sampleInput, results: [] });
    expect(xml).toContain("No results to report");
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

