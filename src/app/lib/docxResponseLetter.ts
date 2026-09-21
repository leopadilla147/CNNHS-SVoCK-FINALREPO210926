import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import type { Complaint } from "../context/AppContext";

/**
 * GRIEV-01 / D-02 — the grievance response letter (.docx).
 *
 * Mirrors the approved body of
 * "Based Documents/CNNHS-Grievance-Commissioner-Response-Form.docx":
 * letterhead (CNNHS / SSLG-YES-O / school year), commissioner header,
 * response text embedding the complaint title, student name, decision,
 * and — when rejected — the mandated reason.
 *
 * D-14 note: text goes into docx `TextRun` RAW — the docx library performs
 * its OWN XML escaping when packing. Do NOT run escapeHtml here: escaping
 * inside TextRun would bake literal `&amp;`/`&#39;` into the Word document.
 * escapeHtml stays scoped to HTML/print interpolations (reports.ts) only.
 */

const LETTER_TOP = [
  "CAMARINES NORTE NATIONAL HIGH SCHOOL",
  "SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS",
  "SCHOOL YEAR 2026-2027",
];

export interface ResponseLetterComplaint {
  studentName: string;
  subject: string;
  status: "accepted" | "rejected";
  rejectionReason?: string;
}

/** Build the .docx Document for a complaint decision. */
export function buildResponseLetter(complaint: ResponseLetterComplaint): Document {
  const accepted = complaint.status === "accepted";

  const paragraphs: Paragraph[] = LETTER_TOP.map(
    (line) => new Paragraph({ text: line, alignment: AlignmentType.CENTER })
  );

  paragraphs.push(
    new Paragraph({ text: "COMMUNICATION FOR RESPONDENT", alignment: AlignmentType.CENTER, spacing: { before: 320, after: 200 } }),
    new Paragraph({ text: "Date: ________________", spacing: { after: 200 } }),
    new Paragraph({ text: "NAME OF RESPONDENT", spacing: { after: 80 } }),
    new Paragraph({ text: `Mr. / Ms. ${complaint.studentName}`, spacing: { after: 200 } }),
    new Paragraph({ text: "Greetings of peace!" }),
    new Paragraph({
      children: [
        new TextRun("This is to inform you that the Learner Government Commission and Election and Appointment (LG COMEA) received a complaint concerning you regarding "),
        new TextRun({ text: `"${complaint.subject}"`, bold: true }),
        new TextRun("."),
      ],
      spacing: { before: 160 },
    }),
    new Paragraph({ text: "", spacing: { after: 80 } }),
  );

  if (accepted) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun("Decision: "),
          new TextRun({ text: "ACCEPTED", bold: true }),
          new TextRun(". The complaint was reviewed and acted upon by the LG COMEA."),
        ],
        spacing: { after: 160 },
      })
    );
  } else {
    const reason = complaint.rejectionReason?.trim();
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun("Decision: "),
          new TextRun({ text: "REJECTED", bold: true }),
          new TextRun(". After careful review, your complaint could not be acted upon for the following reason: "),
          new TextRun({ text: reason || "No reason provided.", italics: true }),
        ],
        spacing: { after: 160 },
      })
    );
  }

  paragraphs.push(
    new Paragraph({
      text: "Thank you.",
      spacing: { before: 160, after: 320 },
    }),
    new Paragraph({ text: "Very truly yours,", spacing: { after: 200 } }),
    new Paragraph({ text: "_________________________________", spacing: { after: 40 } }),
    new Paragraph({ text: "NAME OF COMMISSIONER", spacing: { after: 40 } }),
    new Paragraph({ text: "Learner Government Commissioner of Grievance" })
  );

  return new Document({ sections: [{ children: paragraphs }] });
}

/** Pack the response letter and trigger a browser download. */
export async function saveResponseLetter(complaint: ResponseLetterComplaint, filename: string): Promise<void> {
  const blob = await Packer.toBlob(buildResponseLetter(complaint));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}