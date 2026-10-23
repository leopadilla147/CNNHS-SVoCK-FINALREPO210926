import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { Complaint } from "../context/AppContext";

/**
 * The Grievance Commissioner's "Communication for Respondent" letter
 * (CNNHS-Grievance-Commissioner-Response-Form.docx), generated per complaint.
 *
 * The paper source of truth is `Based Documents/CNNHS-Grievance-Commissioner-
 * Response-Form.docx`; this builder reproduces it (Arial 10pt, bold centered
 * letterhead, justified body, Letter page, 1" margins) with the complaint's
 * data filled in:
 *   - "Date:" gets the current date,
 *   - "NAME OF RESPONDENT" prints as "Name:" (Mr./Ms. line left blank),
 *   - the "received a complaint concerning you regarding ___" blank gets the
 *     Nature of Complaint (complaint.subject),
 *   - the "[Summary of the Complaint ...]" placeholder gets the Narrative
 *     Report (complaint.description),
 *   - the Grievance Commissioner's name prints bold, one point larger than the
 *     body, in the middle of the signature space — between "Very truly yours,"
 *     and the "NAME OF COMMISSIONER" placeholder (which stays).
 */
export interface GrievanceResponseFormInput {
  /** The filed complaint — only its Nature (subject) and Narrative (description) are used. */
  complaint: Pick<Complaint, "subject" | "description">;
  /** The acting Grievance Commissioner's name (adminprofiles.full_name). */
  commissionerName?: string;
  /** The current election's school year, e.g. "2026-2027". */
  schoolYear?: string;
  /** The "Date:" value; defaults to today (injectable for tests). */
  date?: Date;
}

/** Download name — kept identical to the Based Documents template file. */
export const GRIEVANCE_RESPONSE_FORM_FILENAME =
  "CNNHS-Grievance-Commissioner-Response-Form.docx";

const FONT = "Arial";
/** 10pt in half-points — every run in the template is sz 20. */
const SIZE = 20;
/** The typed signature is one point larger than the body text (11pt). */
const SIGNATURE_SIZE = 22;
/** The template's default school-year line, used when the period has none. */
const DEFAULT_SCHOOL_YEAR = "2026-2027";

function run(text: string, bold = false): TextRun {
  return new TextRun({ text, bold, font: FONT, size: SIZE });
}

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

function paragraph(children: TextRun[], alignment: Alignment = AlignmentType.JUSTIFIED): Paragraph {
  return new Paragraph({
    alignment,
    spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
    children,
  });
}

/** An empty line — the template spaces its paragraphs with blank paragraphs. */
function blank(alignment: Alignment = AlignmentType.JUSTIFIED): Paragraph {
  return paragraph([run("")], alignment);
}

function centerBold(text: string): Paragraph {
  return paragraph([run(text, true)], AlignmentType.CENTER);
}

function body(text: string, bold = false): Paragraph {
  return paragraph([run(text, bold)]);
}

/** The typed signature — bold, one point larger than the body. */
function signatureName(text: string): Paragraph {
  return paragraph([new TextRun({ text, bold: true, font: FONT, size: SIGNATURE_SIZE })]);
}

/**
 * Long-format date for the "Date:" line, e.g. "October 23, 2026". Explicit
 * en-US so the letter does not change with the reader's locale.
 */
export function formatResponseFormDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function buildGrievanceResponseFormDocx(input: GrievanceResponseFormInput): Document {
  const { complaint } = input;
  const dateText = formatResponseFormDate(input.date ?? new Date());
  const schoolYear = input.schoolYear?.trim() || DEFAULT_SCHOOL_YEAR;

  const children: Paragraph[] = [
    // Letterhead — bold, centered.
    centerBold("CAMARINES NORTE NATIONAL HIGH SCHOOL"),
    centerBold("SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS"),
    centerBold(`SCHOOL YEAR ${schoolYear}`),
    blank(AlignmentType.CENTER),
    centerBold("COMMUNICATION FOR RESPONDENT"),
    blank(AlignmentType.CENTER),

    // "Date:" filled with today's date.
    paragraph([run("Date: "), run(dateText, true)]),
    blank(),

    // "NAME OF RESPONDENT" prints as "Name:" (kept bold); the Mr./Ms. line
    // stays blank — the Commissioner writes the respondent in by hand.
    body("Name:", true),
    blank(),
    blank(),
    body("Mr. / Ms. _______________________________"),
    blank(),

    body("Greetings of peace!"),
    blank(),

    // The "regarding ___" blank carries the Nature of Complaint.
    paragraph([
      run(
        "This is to inform you that the Learner Government Commission and Election and Appointment (LG COMEA) received a complaint concerning you regarding "
      ),
      run(complaint.subject, true),
      run("."),
    ]),
    blank(),

    // The "[Summary of the Complaint ...]" placeholder carries the Narrative
    // Report — one paragraph per typed line, blanks kept as gaps.
    ...complaint.description.split(/\r?\n/).map((line) => body(line)),
    blank(),

    body(
      "Relative to this, you are hereby requested to submit a written explanation about the complaint to the LG COMEA within forty-eight (48) hours upon receipt of this letter."
    ),
    blank(),

    body("LG COMEA highly encourages your utmost cooperation regarding this matter."),
    blank(),

    body("Thank you."),
    blank(),
    blank(),

    body("Very truly yours,"),
    blank(),

    // The typed signature sits in the MIDDLE of the signature space — between
    // the closing and the "NAME OF COMMISSIONER" placeholder — bold and one
    // point larger than the body text.
    signatureName(input.commissionerName?.trim() || ""),
    blank(),

    body("NAME OF COMMISSIONER", true),
    body("Learner Government COMEA"),
  ];

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: {
          page: {
            // Letter (12240 × 15840 twips) with 1" margins — the template's sectPr.
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 },
          },
        },
        children,
      },
    ],
  });
}

/** Pack the response form as a .docx file and trigger browser download. */
export async function saveGrievanceResponseFormDocx(
  input: GrievanceResponseFormInput,
  filename: string = GRIEVANCE_RESPONSE_FORM_FILENAME
): Promise<void> {
  const doc = buildGrievanceResponseFormDocx(input);
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
