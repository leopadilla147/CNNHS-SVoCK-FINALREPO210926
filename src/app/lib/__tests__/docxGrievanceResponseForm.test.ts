import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import {
  buildGrievanceResponseFormDocx,
  saveGrievanceResponseFormDocx,
  formatResponseFormDate,
  GRIEVANCE_RESPONSE_FORM_FILENAME,
  type GrievanceResponseFormInput,
} from "../docxGrievanceResponseForm";

const sampleInput: GrievanceResponseFormInput = {
  complaint: {
    subject: "Impersonation",
    description: "First narrative line.\nSecond narrative line.",
  },
  commissionerName: "IVY DENICE M. ABOGADO, RGC",
  schoolYear: "2026-2027",
  date: new Date(2026, 9, 23),
};

async function extractBodyXml(input: GrievanceResponseFormInput): Promise<string> {
  const blob = await Packer.toBlob(buildGrievanceResponseFormDocx(input));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("missing word/document.xml in packed docx");
  return xml;
}

describe("formatResponseFormDate", () => {
  it("prints the long-format en-US date for the Date: line", () => {
    expect(formatResponseFormDate(new Date(2026, 9, 23))).toBe("October 23, 2026");
  });
});

describe("buildGrievanceResponseFormDocx", () => {
  it("builds the Communication for Respondent letterhead", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("CAMARINES NORTE NATIONAL HIGH SCHOOL");
    expect(xml).toContain("SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS");
    expect(xml).toContain("SCHOOL YEAR 2026-2027");
    expect(xml).toContain("COMMUNICATION FOR RESPONDENT");
  });

  it("fills the Date: line with the current date", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Date: ");
    expect(xml).toContain("October 23, 2026");
    // The template's blank is gone.
    expect(xml).not.toContain("Date: ________________");
  });

  it("renames NAME OF RESPONDENT to Name: and leaves the Mr./Ms. line blank", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Name:");
    expect(xml).not.toContain("NAME OF RESPONDENT");
    expect(xml).toContain("Mr. / Ms. _______________________________");
  });

  it("fills the 'concerning you regarding' blank with the Nature of Complaint", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Impersonation");
    expect(xml).not.toContain("_____________________________________________");
  });

  it("replaces the summary placeholder with the Narrative Report", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("First narrative line.");
    expect(xml).toContain("Second narrative line.");
    expect(xml).not.toContain("[Summary of the Complaint");
  });

  it("prints the Grievance Commissioner's name in the middle of the signature space, before the NAME OF COMMISSIONER placeholder", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("IVY DENICE M. ABOGADO, RGC");
    expect(xml).toContain("NAME OF COMMISSIONER");
    expect(xml).toContain("Learner Government COMEA");
    // Signature order: closing → typed name → placeholder → title.
    expect(xml.indexOf("Very truly yours,")).toBeLessThan(xml.indexOf("IVY DENICE M. ABOGADO, RGC"));
    expect(xml.indexOf("IVY DENICE M. ABOGADO, RGC")).toBeLessThan(xml.indexOf("NAME OF COMMISSIONER"));
    expect(xml.indexOf("NAME OF COMMISSIONER")).toBeLessThan(xml.indexOf("Learner Government COMEA"));
  });

  it("prints the signature name bold and one point larger than the body (11pt)", async () => {
    const xml = await extractBodyXml(sampleInput);
    const signatureRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*IVY DENICE M\. ABOGADO(?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(signatureRun).not.toBeNull();
    expect(signatureRun![0]).toContain("<w:b/>");
    expect(signatureRun![0]).toContain('<w:sz w:val="22"/>');
  });

  it("falls back to the template school year when the period has none", async () => {
    const xml = await extractBodyXml({ ...sampleInput, schoolYear: "  " });
    expect(xml).toContain("SCHOOL YEAR 2026-2027");
  });

  it("seeds the school year from the current election period", async () => {
    const xml = await extractBodyXml({ ...sampleInput, schoolYear: "2025-2026" });
    expect(xml).toContain("SCHOOL YEAR 2025-2026");
    expect(xml).not.toContain("SCHOOL YEAR 2026-2027");
  });
});

describe("saveGrievanceResponseFormDocx", () => {
  it("downloads the form under the template's exact file name", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    // jsdom has no URL.createObjectURL / HTMLAnchorElement.click.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(click as unknown as () => void);

    let appended: HTMLAnchorElement | null = null;
    const appendChild = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      appended = node as HTMLAnchorElement;
      return appendChild(node);
    });

    try {
      await saveGrievanceResponseFormDocx(sampleInput);
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(appended).not.toBeNull();
      expect(appended!.download).toBe("CNNHS-Grievance-Commissioner-Response-Form.docx");
      expect(GRIEVANCE_RESPONSE_FORM_FILENAME).toBe("CNNHS-Grievance-Commissioner-Response-Form.docx");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    } finally {
      clickSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
