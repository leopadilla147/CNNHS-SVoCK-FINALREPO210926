import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import {
  buildGrievanceFormDocx,
  saveGrievanceFormDocx,
  formatGrievanceFormDate,
  formatGrievanceFormTime,
  formatGrievanceFormFiledAt,
  computeAgeFromBirthdate,
  fetchEvidenceImages,
  resolveCheckbox,
  GRIEVANCE_FORM_FILENAME,
  type EmbeddedEvidenceImage,
  type GrievanceFormInput,
} from "../docxGrievanceForm";

const sampleInput: GrievanceFormInput = {
  complaint: {
    subject: "Impersonation",
    description: "First narrative line.\nSecond narrative line.",
    complaintAgainst: "Teacher",
    submittedAt: "2026-10-23",
    submittedAtExact: "2026-10-23T07:45:00.000Z",
    evidence: [{ url: "https://example.com/proof.png", name: "proof.png" }],
  },
  complainantName: "JUAN D. DELA CRUZ",
  complainantEmail: "juan.delacruz@cnnhs.edu",
  complainantBirthdate: "2008-05-10",
  schoolYear: "2026-2027",
  ageAsOf: new Date(2026, 9, 23),
};

async function extractBodyXml(input: GrievanceFormInput): Promise<string> {
  const blob = await Packer.toBlob(buildGrievanceFormDocx(input));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("missing word/document.xml in packed docx");
  return xml;
}

const underscores = (count: number) => "_".repeat(count);

/** A minimal PNG byte buffer — signature + IHDR carrying the given size. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
  bytes.set([0, 0, 0, 13], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("formatGrievanceFormDate / formatGrievanceFormTime", () => {
  it("prints the long-format en-US date and 12-hour time", () => {
    const d = new Date(2026, 9, 23, 15, 45);
    expect(formatGrievanceFormDate(d)).toBe("October 23, 2026");
    expect(formatGrievanceFormTime(d)).toBe("3:45 PM");
  });
});

describe("formatGrievanceFormFiledAt", () => {
  it("uses the exact submitted_at timestamp for the Date Filed and Time lines", () => {
    const { dateText, timeText } = formatGrievanceFormFiledAt({
      submittedAt: "2026-10-23",
      submittedAtExact: "2026-10-23T07:45:00.000Z",
    });
    expect(dateText).toBe("October 23, 2026");
    expect(timeText).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("falls back to the date-only stamp and leaves the time blank", () => {
    const { dateText, timeText } = formatGrievanceFormFiledAt({
      submittedAt: "2026-10-23",
      submittedAtExact: undefined,
    });
    expect(dateText).toBe("October 23, 2026");
    expect(timeText).toBe("");
  });
});

describe("resolveCheckbox", () => {
  it("matches known labels case/punctuation-insensitively", () => {
    expect(resolveCheckbox("Vote Solicitation", ["Vote-solicitation"])).toEqual({ label: "Vote-solicitation" });
    expect(resolveCheckbox("teacher", ["Teacher", "Learner"])).toEqual({ label: "Teacher" });
  });

  it("falls back to Others with the filed free text", () => {
    expect(resolveCheckbox("PTA President", ["Teacher", "Learner"])).toEqual({
      label: "Others",
      other: "PTA President",
    });
  });

  it("returns null for an empty/missing choice", () => {
    expect(resolveCheckbox(undefined, ["Teacher"])).toBeNull();
    expect(resolveCheckbox("   ", ["Teacher"])).toBeNull();
  });
});

describe("computeAgeFromBirthdate", () => {
  const asOf = new Date(2026, 9, 23); // October 23, 2026

  it("computes whole years from the birthdate", () => {
    expect(computeAgeFromBirthdate("2008-05-10", asOf)).toBe(18);
  });

  it("has not counted a birthday that has not happened yet this year", () => {
    expect(computeAgeFromBirthdate("2008-12-01", asOf)).toBe(17);
  });

  it("counts the birthday falling exactly on the as-of date", () => {
    expect(computeAgeFromBirthdate("2008-10-23", asOf)).toBe(18);
  });

  it("returns null for missing, malformed, or future birthdates", () => {
    expect(computeAgeFromBirthdate(undefined, asOf)).toBeNull();
    expect(computeAgeFromBirthdate("  ", asOf)).toBeNull();
    expect(computeAgeFromBirthdate("not-a-date", asOf)).toBeNull();
    expect(computeAgeFromBirthdate("2030-01-01", asOf)).toBeNull();
  });
});

describe("fetchEvidenceImages", () => {
  const evidence = [{ url: "https://storage.example.com/proof.png", name: "proof.png" }];

  it("fetches an image and fits it into the display box, preserving aspect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => pngBytes(640, 480).buffer }))
    );
    try {
      const images = await fetchEvidenceImages(evidence);
      expect(images).toHaveLength(1);
      expect(images[0]).toMatchObject({ name: "proof.png", format: "png", displayWidth: 320, displayHeight: 240 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves small images at their natural size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => pngBytes(200, 100).buffer }))
    );
    try {
      const images = await fetchEvidenceImages(evidence);
      expect(images[0]).toMatchObject({ displayWidth: 200, displayHeight: 100 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips non-image attachments (PDF, Word)", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 just a pdf");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => pdfBytes.buffer }))
    );
    try {
      const images = await fetchEvidenceImages(evidence);
      expect(images).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips attachments that fail to fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    try {
      const images = await fetchEvidenceImages(evidence);
      expect(images).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("buildGrievanceFormDocx", () => {
  it("builds the Grievance Form letterhead", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("CAMARINES NORTE NATIONAL HIGH SCHOOL");
    expect(xml).toContain("SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS");
    expect(xml).toContain("SCHOOL YEAR 2026-2027");
    expect(xml).toContain("GRIEVANCE FORM");
  });

  it("keeps all six numbered sections", async () => {
    const xml = (await extractBodyXml(sampleInput)).replace(
      new RegExp(`${String.fromCharCode(38)}apos;`, "g"),
      "'"
    );
    expect(xml).toContain("I. COMPLAINANT'S INFORMATION");
    expect(xml).toContain("II. COMPLAINT AGAINST");
    expect(xml).toContain("III. NATURE OF COMPLAINT");
    expect(xml).toContain("IV. NARRATIVE REPORT");
    expect(xml).toContain("V. ATTACHMENTS (Proofs e.g. picture, video etc.) *if available");
    expect(xml).toContain("VI. CERTIFICATION");
    expect(xml).toContain("I hereby certify that the information stated herein is true and correct to the best of my knowledge.");
  });

  it("fills Name: and Email Address: from the complainant", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("JUAN D. DELA CRUZ");
    expect(xml).toContain("juan.delacruz@cnnhs.edu");
    // The filled blanks are gone.
    expect(xml).not.toContain("Name: ____");
    expect(xml).not.toContain("Email Address: ____");
  });

  it("leaves Address / Contact Number blank (the app does not collect them)", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Address: ____");
    expect(xml).toContain("Contact Number: ____");
    // The Age blank is gone — it fills from the birthdate.
    expect(xml).not.toContain("Age: ____");
  });

  it("fills Age: from the complainant's birthdate, bold", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("Age: ");
    const ageRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*<w:t[^>]*>18<\/w:t><\/w:r>/s);
    expect(ageRun).not.toBeNull();
    expect(ageRun![0]).toContain("<w:b/>");
  });

  it("keeps the Age blank hand-writable when no birthdate is on record", async () => {
    const xml = await extractBodyXml({ ...sampleInput, complainantBirthdate: undefined });
    // The "Age:" label run is followed by a plain (not bold) 20-underscore run.
    const ageBlankRun = xml.match(/Age: <\/w:t><\/w:r><w:r>(?:(?!<\/w:r>).)*_{20}<\/w:t><\/w:r>/s);
    expect(ageBlankRun).not.toBeNull();
    expect(ageBlankRun![0]).not.toContain("<w:b/>");
  });

  it("fills Date Filed: with the filed date and Time: with the filed time", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("October 23, 2026");
    expect(xml).not.toContain("Date Filed: ____");
  });

  it("ticks the Complaint Against checkbox before the matching label", async () => {
    const xml = await extractBodyXml(sampleInput);
    const tickIndex = xml.indexOf("\u2713");
    expect(tickIndex).toBeGreaterThan(-1);
    const teacherIndex = xml.indexOf("Teacher");
    expect(tickIndex).toBeLessThan(teacherIndex);
    // Exactly one tick per checkbox table (Against + Nature).
    expect(xml.split("\u2713").length - 1).toBe(2);
  });

  it("ticks the Nature of Complaint checkbox on the matching row", async () => {
    const xml = await extractBodyXml(sampleInput);
    const lastTick = xml.lastIndexOf("\u2713");
    expect(lastTick).toBeGreaterThan(-1);
    // The Impersonation row's tick sits in the checkbox cell before its label,
    // and after the Against table's tick (Teacher's) — a distinct second tick.
    expect(lastTick).toBeGreaterThan(xml.indexOf("Teacher"));
    expect(lastTick).toBeLessThan(xml.indexOf("Impersonation"));
  });

  it("ticks only the filed choice — every option is still listed", async () => {
    const xml = await extractBodyXml(sampleInput);
    // All options present.
    for (const label of [
      "Learner Government COMEA",
      "Teacher",
      "Learner",
      "Candidate",
      "Political Party",
      "Dishonesty",
      "Falsification",
      "Oppression",
      "Vote-solicitation",
      "Disgraceful and Immoral Conduct",
      "Negligence of Duty",
      "Impersonation",
      "Misconduct",
    ]) {
      expect(xml).toContain(label);
    }
    // Exactly two ticks in the whole form: Teacher (Against) + Impersonation (Nature).
    expect(xml.split("\u2713").length - 1).toBe(2);
  });

  it("prints the tick bold and centered in the middle of its box", async () => {
    const xml = await extractBodyXml(sampleInput);
    const tickRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*\u2713(?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(tickRun).not.toBeNull();
    expect(tickRun![0]).toContain("<w:b/>");
    // Centered horizontally (jc center) and vertically (vAlign center).
    const tickParagraph = xml.match(/<w:p>(?:(?!<\/w:p>).)*\u2713(?:(?!<\/w:p>).)*<\/w:p>/s);
    expect(tickParagraph).not.toBeNull();
    expect(tickParagraph![0]).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:vAlign w:val="center"/>');
  });

  it("prints all checkbox-table text bold, including the tick", async () => {
    const xml = await extractBodyXml(sampleInput);
    for (const label of ["Teacher", "Impersonation", "Learner Government COMEA", "Vote-solicitation"]) {
      const labelRun = xml.match(new RegExp(`<w:r>(?:(?!<\\/w:r>).)*${label}(?:(?!<\\/w:r>).)*<\\/w:r>`, "s"));
      expect(labelRun).not.toBeNull();
      expect(labelRun![0]).toContain("<w:b/>");
    }
    // The Others blank run is bold too.
    const othersRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*Others: (?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(othersRun).not.toBeNull();
    expect(othersRun![0]).toContain("<w:b/>");
  });

  it("prints the Others line with the filed free text when the choice is not a label", async () => {
    const xml = await extractBodyXml({
      ...sampleInput,
      complaint: {
        ...sampleInput.complaint,
        complaintAgainst: "PTA President",
        subject: "Election Fraud",
      },
    });
    expect(xml).toContain("PTA President");
    expect(xml).toContain("Election Fraud");
    // Both Others rows are filled, so no unfilled Others blank remains.
    expect(xml).not.toContain("Others: ____");
  });

  it("replaces the narrative writing lines with the Narrative Report", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("First narrative line.");
    expect(xml).toContain("Second narrative line.");
    // The template's writing line (380 + 40 underscores) is gone — longer than
    // any surviving blank (Address 63 / Others 62).
    expect(xml).not.toContain(underscores(80));
  });

  it("lists the filed evidence under Attachments", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("proof.png");
  });

  it("embeds a fetched evidence image as a real picture under its file name", async () => {
    const image: EmbeddedEvidenceImage = {
      name: "proof.png",
      data: pngBytes(640, 480),
      format: "png",
      displayWidth: 320,
      displayHeight: 240,
    };
    const blob = await Packer.toBlob(buildGrievanceFormDocx({ ...sampleInput, evidenceImages: [image] }));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    // The picture lands in the package's media folder…
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith("word/media/") && !name.endsWith("/")
    );
    expect(media).toHaveLength(1);
    // …and the document body draws it, with its bold file-name title BELOW it.
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toContain("<w:drawing>");
    expect(xml!.indexOf("<w:drawing>")).toBeLessThan(xml!.indexOf("proof.png"));
    const titleRun = xml!.match(/<w:r>(?:(?!<\/w:r>).)*proof\.png(?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(titleRun).not.toBeNull();
    expect(titleRun![0]).toContain("<w:b/>");
  });

  it("separates the instruction from the typed answer with a blank line", async () => {
    const xml = await extractBodyXml(sampleInput);
    const between = xml.slice(xml.indexOf("(May use additional"), xml.indexOf("First narrative line."));
    // An empty paragraph (the blank line) sits between them.
    expect(between).toContain('<w:t xml:space="preserve"></w:t>');
  });

  it("italicizes the act names, the sheet note, the caption and the Date: label", async () => {
    const xml = await extractBodyXml(sampleInput);
    for (const text of [
      "Freedom of Information Act",
      "Data Privacy Act of 2012",
      "May use additional sheet/s of paper if necessary",
      "Commissioner on Grievance",
    ]) {
      const italicRun = xml.match(new RegExp(`<w:r>(?:(?!<\\/w:r>).)*${text}(?:(?!<\\/w:r>).)*<\\/w:r>`, "s"));
      expect(italicRun).not.toBeNull();
      expect(italicRun![0]).toContain("<w:i/>");
    }
    const dateLabelRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*Date: (?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(dateLabelRun).not.toBeNull();
    expect(dateLabelRun![0]).toContain("<w:i/>");
  });

  it("makes the DepEd data privacy notice URL a clickable link", async () => {
    const blob = await Packer.toBlob(buildGrievanceFormDocx(sampleInput));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toContain("<w:hyperlink");
    expect(xml!).toContain('w:val="Hyperlink"');
    // The link relationship points at the DepEd notice.
    const rels = await zip.file("word/_rels/document.xml.rels")?.async("string");
    expect(rels).toContain("https://www.deped.gov.ph/about-deped/data-privacy-notice/");
  });

  it("keeps the Instruction label bold but the sentence itself plain", async () => {
    const xml = await extractBodyXml(sampleInput);
    const labelRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*Instruction:(?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(labelRun).not.toBeNull();
    expect(labelRun![0]).toContain("<w:b/>");
    const sentenceRun = xml.match(/<w:r>(?:(?!<\/w:r>).)*Write in detail(?:(?!<\/w:r>).)*<\/w:r>/s);
    expect(sentenceRun).not.toBeNull();
    expect(sentenceRun![0]).not.toContain("<w:b/>");
  });

  it("indents the certification sentence with a half-inch first line", async () => {
    const xml = await extractBodyXml(sampleInput);
    const certParagraph = xml.match(/<w:p>(?:(?!<\/w:p>).)*I hereby certify(?:(?!<\/w:p>).)*<\/w:p>/s);
    expect(certParagraph).not.toBeNull();
    expect(certParagraph![0]).toContain('<w:ind w:firstLine="720"/>');
  });

  it("puts the signature line on the right, centered over its right-aligned caption", async () => {
    const xml = await extractBodyXml(sampleInput);
    // The exactly-22-underscore signature line.
    const lineParagraph = xml.match(/<w:p>(?:(?!<\/w:p>).)*<w:t[^>]*>_{22}<\/w:t><\/w:r>(?:(?!<\/w:p>).)*<\/w:p>/s);
    expect(lineParagraph).not.toBeNull();
    expect(lineParagraph![0]).toContain('<w:jc w:val="right"/>');
    expect(lineParagraph![0]).toContain('<w:ind w:right="770"/>');
    const captionParagraph = xml.match(/<w:p>(?:(?!<\/w:p>).)*Signature of Complainant(?:(?!<\/w:p>).)*<\/w:p>/s);
    expect(captionParagraph).not.toBeNull();
    expect(captionParagraph![0]).toContain('<w:jc w:val="right"/>');
  });

  it("centers the Commissioner on Grievance caption under its line", async () => {
    const xml = await extractBodyXml(sampleInput);
    const captionParagraph = xml.match(/<w:p>(?:(?!<\/w:p>).)*Commissioner on Grievance(?:(?!<\/w:p>).)*<\/w:p>/s);
    expect(captionParagraph).not.toBeNull();
    expect(captionParagraph![0]).toContain('<w:ind w:left="660"/>');
  });

  it("keeps the certification and Received by blocks blank for wet signatures", async () => {
    const xml = await extractBodyXml(sampleInput);
    expect(xml).toContain("______________________");
    expect(xml).toContain("Signature of Complainant over Printed Name");
    expect(xml).toContain("Received by:");
    expect(xml).toContain("Commissioner on Grievance");
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

describe("saveGrievanceFormDocx", () => {
  it("downloads the form under the template's exact file name", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    // jsdom has no URL.createObjectURL / HTMLAnchorElement.click.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // No evidence images are fetched in this test — every fetch reports
    // "not ok" and the attachment stays a name listing.
    const fetchSpy = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchSpy);
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
      await saveGrievanceFormDocx(sampleInput);
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(appended).not.toBeNull();
      expect(appended!.download).toBe("CNNHS-Grievance-Form-for-SSLG-Elections.docx");
      expect(GRIEVANCE_FORM_FILENAME).toBe("CNNHS-Grievance-Form-for-SSLG-Elections.docx");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
