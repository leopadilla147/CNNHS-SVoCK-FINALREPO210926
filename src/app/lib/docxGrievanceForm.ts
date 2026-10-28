import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { Complaint, ComplaintEvidence } from "../context/AppContext";

/**
 * The student's Grievance Form (CNNHS-Grievance-Form-for-SSLG-Elections.docx),
 * generated per filed complaint and downloadable from My Complaint History.
 *
 * The paper source of truth is `Based Documents/CNNHS-Grievance-Form-for-SSLG-
 * Elections.docx`; this builder reproduces it (Arial 10pt, bold centered
 * letterhead, justified body, bold checkbox tables, Letter page, 1" margins)
 * with the complaint's data filled in:
 *   - I. Complainant's Information — "Name:", "Email Address:", "Date Filed:",
 *     "Time:" and "Age:" (computed from the student's birthdate) are filled
 *     (Address / Contact Number stay blank — the app does not collect them),
 *   - II. Complaint Against — every option is listed; only the filed choice's
 *     checkbox carries a bold, centered tick ("Others:" carries the free-text
 *     value when the choice is not one of the labels),
 *   - III. Nature of Complaint — same, matching the complaint's subject,
 *   - IV. Narrative Report — the writing lines carry the Narrative Report,
 *     separated from the instruction by a blank line,
 *   - V. Attachments — the evidence's images are embedded as real pictures
 *     with their bold file-name titles below them (fetched when the form is
 *     downloaded; JPEG/PNG/GIF/BMP only, since the docx format cannot carry
 *     WebP/PDF/Word) and other files stay as name listings,
 *   - the data privacy notice prints its act names italic and the DepEd
 *     notice URL as a live link,
 *   - VI. Certification and the "Received by" block stay blank for wet
 *     signatures (the student signs; the Commissioner receives).
 */
export interface GrievanceFormInput {
  /** The filed complaint. */
  complaint: Pick<
    Complaint,
    "subject" | "description" | "complaintAgainst" | "submittedAt" | "submittedAtExact" | "evidence"
  >;
  /** The complainant's full name (students/users full_name). */
  complainantName?: string;
  /** The complainant's email (users.email). */
  complainantEmail?: string;
  /** The complainant's birthdate (students.birthdate, "yyyy-mm-dd") — fills Age. */
  complainantBirthdate?: string;
  /** The current election's school year, e.g. "2026-2027". */
  schoolYear?: string;
  /** As-of date for the computed Age; defaults to today (injectable for tests). */
  ageAsOf?: Date;
  /** Evidence images prepared by {@link fetchEvidenceImages} — when present,
   *  section V embeds them as real pictures instead of name-only listings. */
  evidenceImages?: EmbeddedEvidenceImage[];
}

/** Download name — kept identical to the Based Documents template file. */
export const GRIEVANCE_FORM_FILENAME = "CNNHS-Grievance-Form-for-SSLG-Elections.docx";

const FONT = "Arial";
/** 10pt in half-points — every run in the template is sz 20. */
const SIZE = 20;
/** The tick character used to mark a checkbox on the generated form. */
const TICK = "\u2713";
/** The template's default school-year line, used when the period has none. */
const DEFAULT_SCHOOL_YEAR = "2026-2027";

/** The template's underscore blanks — exact run lengths from the source docx. */
const BLANK = {
  name: 64,
  address: 63,
  contactNumber: 32,
  age: 20,
  email: 58,
  dateFiled: 37,
  time: 19,
  againstOthers: 23,
  natureOthers: 62,
  narrative: 380,
  narrativeExtra: 40,
  signature: 22,
  receivedBy: 34,
  receivedDate: 25,
} as const;

const underscores = (count: number) => "_".repeat(count);

/** Checkbox-table labels — must match the paper form exactly. */
const AGAINST_LABELS = ["Learner Government COMEA", "Teacher", "Learner", "Candidate", "Political Party"];
const NATURE_LABELS = [
  "Dishonesty",
  "Falsification",
  "Oppression",
  "Vote-solicitation",
  "Disgraceful and Immoral Conduct",
  "Negligence of Duty",
  "Impersonation",
  "Misconduct",
];

/** The DepEd data privacy notice — printed as a live link in the notice. */
const DEPED_DATA_PRIVACY_NOTICE_URL = "https://www.deped.gov.ph/about-deped/data-privacy-notice/";

function run(text: string, bold = false, italics = false): TextRun {
  return new TextRun({ text, bold, italics, font: FONT, size: SIZE });
}

type Alignment = (typeof AlignmentType)[keyof typeof AlignmentType];

function paragraph(
  children: (TextRun | ExternalHyperlink)[],
  alignment: Alignment = AlignmentType.JUSTIFIED
): Paragraph {
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

/** Case/punctuation-insensitive comparison so app labels match the paper form
 *  (the app's "Vote Solicitation" is the form's "Vote-solicitation"). */
function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A checked checkbox row choice. */
interface CheckboxChoice {
  label: string;
  /** The filed "Others" free text, printed on the Others line. */
  other?: string;
}

/**
 * Resolve which checkbox to tick.  A stored value that is none of the known
 * labels was filed as "Others" free text — it prints on the Others line.
 */
export function resolveCheckbox(value: string | undefined, labels: string[]): CheckboxChoice | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const known = labels.find((label) => sameLabel(label, trimmed));
  return known ? { label: known } : { label: "Others", other: trimmed };
}

/**
 * The complainant's age in whole years from their birthdate ("yyyy-mm-dd"),
 * as of `asOf` (today by default).  Returns null when the birthdate is
 * missing, malformed, or in the future — the Age blank stays hand-written.
 */
export function computeAgeFromBirthdate(birthdate: string | undefined, asOf: Date = new Date()): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate?.trim() ?? "");
  if (!parts) return null;
  const birth = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < birth.getMonth() ||
    (asOf.getMonth() === birth.getMonth() && asOf.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

const GRID_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const TABLE_BORDERS = {
  top: GRID_BORDER,
  bottom: GRID_BORDER,
  left: GRID_BORDER,
  right: GRID_BORDER,
  insideHorizontal: GRID_BORDER,
  insideVertical: GRID_BORDER,
};

/**
 * One checkbox cell — ticked when it matches the filed choice.  The tick is
 * bold and centered in the middle of the box (horizontal + vertical).
 */
function checkboxCell(checked: boolean, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [paragraph(checked ? [run(TICK, true)] : [], AlignmentType.CENTER)],
  });
}

/** A label cell — the row's option label, always printed (bold, like all
 *  checkbox-table text). */
function textCell(label: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [paragraph([run(label, true)], AlignmentType.LEFT)],
  });
}

/** The Complaint-Against table's "Others:" cell — blank on paper, or the
 *  filed free text when the choice was not one of the labels. */
function othersCell(choice: CheckboxChoice | null, width: number, blankCount: number): TableCell {
  const children = choice?.other
    ? [run("Others: ", true), run(choice.other, true)]
    : [run(`Others: ${underscores(blankCount)}`, true)];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [paragraph(children, AlignmentType.LEFT)],
  });
}

/** Which side of a checkbox row carries the filed choice's tick. */
type CheckedSide = "left" | "right" | null;

function checkedSide(choice: CheckboxChoice | null, leftLabel: string, rightLabel: string): CheckedSide {
  if (choice?.label === leftLabel) return "left";
  if (choice?.label === rightLabel) return "right";
  return null;
}

/**
 * A two-choice checkbox row — widths 704/3970/708/3968 twips, the template's
 * exact cell grid.  Every option label always prints; only the filed choice's
 * box carries the bold, centered tick.
 */
function choiceRow(leftLabel: string, rightLabel: string, checked: CheckedSide): TableRow {
  return new TableRow({
    children: [
      checkboxCell(checked === "left", 704),
      textCell(leftLabel, 3970),
      checkboxCell(checked === "right", 708),
      textCell(rightLabel, 3968),
    ],
  });
}

/** The Complaint-Against table's third row — "Learner" | "Others: ___". */
function againstOthersRow(against: CheckboxChoice | null): TableRow {
  const others = against?.label === "Others" ? against : null;
  return new TableRow({
    children: [
      checkboxCell(against?.label === "Learner", 704),
      textCell("Learner", 3970),
      checkboxCell(Boolean(others), 708),
      othersCell(others, 3968, BLANK.againstOthers),
    ],
  });
}

/** The Nature table's fifth row — one merged "Others: ___" cell. */
function othersRow(other: string | undefined): TableRow {
  const children = other
    ? [run("Others: ", true), run(other, true)]
    : [run(`Others: ${underscores(BLANK.natureOthers)}`, true)];
  return new TableRow({
    children: [
      checkboxCell(Boolean(other), 704),
      new TableCell({
        width: { size: 8646, type: WidthType.DXA },
        columnSpan: 3,
        verticalAlign: VerticalAlign.CENTER,
        children: [paragraph(children, AlignmentType.LEFT)],
      }),
    ],
  });
}

/**
 * Long-format date for the "Date Filed:" line, e.g. "October 23, 2026".
 * Explicit en-US so the form does not change with the reader's locale.
 */
export function formatGrievanceFormDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** 12-hour time for the "Time:" line, e.g. "3:45 PM". */
export function formatGrievanceFormTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** The Date Filed/Time pair from the raw submitted_at stamps.  A date-only
 *  submittedAt (no exact timestamp) fills the date and leaves the time blank. */
export function formatGrievanceFormFiledAt(
  complaint: Pick<Complaint, "submittedAt" | "submittedAtExact">
): { dateText: string; timeText: string } {
  const raw = complaint.submittedAtExact;
  if (raw) {
    const exact = new Date(raw);
    if (!Number.isNaN(exact.getTime())) {
      return { dateText: formatGrievanceFormDate(exact), timeText: formatGrievanceFormTime(exact) };
    }
  }
  // Date-only stamp "yyyy-mm-dd" — parsed as local parts to avoid timezone drift.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(complaint.submittedAt ?? "");
  if (parts) {
    const local = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (!Number.isNaN(local.getTime())) return { dateText: formatGrievanceFormDate(local), timeText: "" };
  }
  return { dateText: complaint.submittedAt, timeText: "" };
}

/** A filled "Label: value" line — the blank underscores disappear. */
function filledLine(label: string, value: string): Paragraph {
  return paragraph([run(`${label}: `), run(value, true)]);
}

/** A paragraph with an indent (first-line / left / right, in twips). */
function indented(
  text: string,
  indent: { firstLine?: number; left?: number; right?: number },
  options: { bold?: boolean; italics?: boolean; alignment?: Alignment } = {}
): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.JUSTIFIED,
    spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
    indent,
    children: [run(text, options.bold ?? false, options.italics ?? false)],
  });
}

/** An evidence image fetched and prepared for embedding into the docx. */
export interface EmbeddedEvidenceImage {
  name: string;
  data: Uint8Array;
  format: "png" | "jpg" | "gif" | "bmp";
  displayWidth: number;
  displayHeight: number;
}

/** Evidence pictures print up to this box (px at 96dpi ≈ 3.33"). */
const EVIDENCE_IMAGE_MAX_PX = 320;

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  );
}

/** Sniff the image format from magic bytes (extensions and MIME can lie). */
function detectImageFormat(bytes: Uint8Array): EmbeddedEvidenceImage["format"] | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return null;
}

/** Intrinsic pixel size from the image header — no decoder needed. */
function readImageSize(bytes: Uint8Array, format: EmbeddedEvidenceImage["format"]): { width: number; height: number } | null {
  if (format === "png" && bytes.length >= 24 && readU32BE(bytes, 12) === 0x49484452) {
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  if (format === "gif" && bytes.length >= 10) {
    return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) };
  }
  if (format === "bmp" && bytes.length >= 26) {
    return { width: readU32LE(bytes, 18), height: readU32LE(bytes, 22) };
  }
  if (format === "jpg") {
    // Scan the marker segments for a start-of-frame (SOF) header.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // Standalone markers carry no length field.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      }
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    }
  }
  return null;
}

/** Fit the picture into the square display box, preserving aspect ratio. */
function fitDisplaySize(size: { width: number; height: number } | null): { displayWidth: number; displayHeight: number } {
  if (!size || !size.width || !size.height) {
    return { displayWidth: EVIDENCE_IMAGE_MAX_PX, displayHeight: EVIDENCE_IMAGE_MAX_PX };
  }
  const scale = Math.min(EVIDENCE_IMAGE_MAX_PX / size.width, EVIDENCE_IMAGE_MAX_PX / size.height, 1);
  return {
    displayWidth: Math.max(1, Math.round(size.width * scale)),
    displayHeight: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Fetch every evidence attachment and prepare the embeddable pictures
 * (JPEG/PNG/GIF/BMP only — the docx format cannot carry WebP, PDF or Word
 * files, so those stay as name listings).  An item that fails to fetch or
 * does not sniff as an image is simply left as a name listing.
 */
export async function fetchEvidenceImages(evidence?: ComplaintEvidence[]): Promise<EmbeddedEvidenceImage[]> {
  const images: EmbeddedEvidenceImage[] = [];
  for (const item of evidence ?? []) {
    try {
      const response = await fetch(item.url);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const format = detectImageFormat(bytes);
      if (!format) continue;
      const { displayWidth, displayHeight } = fitDisplaySize(readImageSize(bytes, format));
      images.push({ name: item.name, data: bytes, format, displayWidth, displayHeight });
    } catch {
      // Network/CORS failure — the attachment stays a name listing.
    }
  }
  return images;
}

/**
 * Section V's content — each embeddable picture prints with its bold file-name
 * title below it (centered); files that are not embeddable images (or that
 * failed to fetch) stay as name listings.
 */
function attachmentsBlocks(evidence: ComplaintEvidence[], images: EmbeddedEvidenceImage[]): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  for (const item of evidence) {
    const image = images.find((candidate) => candidate.name === item.name);
    if (!image) {
      blocks.push(body(item.name));
      continue;
    }
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [
          new ImageRun({
            type: image.format,
            data: image.data,
            transformation: { width: image.displayWidth, height: image.displayHeight },
          }),
        ],
      })
    );
    blocks.push(indented(item.name, {}, { bold: true, alignment: AlignmentType.CENTER }));
  }
  return blocks;
}

export function buildGrievanceFormDocx(input: GrievanceFormInput): Document {
  const { complaint } = input;
  const schoolYear = input.schoolYear?.trim() || DEFAULT_SCHOOL_YEAR;
  const { dateText, timeText } = formatGrievanceFormFiledAt(complaint);
  // Age from the student's birthdate, as of today (the printed form's date).
  const age = computeAgeFromBirthdate(input.complainantBirthdate, input.ageAsOf ?? new Date());

  const against = resolveCheckbox(complaint.complaintAgainst, AGAINST_LABELS);
  const nature = resolveCheckbox(complaint.subject, NATURE_LABELS);

  // Section I's "Label: ______" lines — filled fields drop their blanks;
  // Address / Contact Number stay hand-written (the app never collects them);
  // Age fills from the birthdate when it is on record.
  const infoLines = [
    input.complainantName?.trim()
      ? filledLine("Name", input.complainantName.trim())
      : body(`Name: ${underscores(BLANK.name)}`),
    body(`Address: ${underscores(BLANK.address)}`),
    paragraph([
      run(`Contact Number: ${underscores(BLANK.contactNumber)} Age: `),
      age !== null ? run(String(age), true) : run(underscores(BLANK.age)),
    ]),
    input.complainantEmail?.trim()
      ? filledLine("Email Address", input.complainantEmail.trim())
      : body(`Email Address: ${underscores(BLANK.email)}`),
    paragraph([
      run("Date Filed: "),
      run(dateText, true),
      run(" Time: "),
      timeText ? run(timeText, true) : run(underscores(BLANK.time)),
    ]),
  ];

  const children: (Paragraph | Table)[] = [
    // Letterhead — bold, centered.
    centerBold("CAMARINES NORTE NATIONAL HIGH SCHOOL"),
    centerBold("SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS"),
    centerBold(`SCHOOL YEAR ${schoolYear}`),
    blank(AlignmentType.CENTER),
    centerBold("GRIEVANCE FORM"),
    blank(AlignmentType.CENTER),

    // Data privacy notice (plain body — the template's stray bold whitespace
    // runs are invisible, so a single plain paragraph matches).  The two act
    // names print italic, and the DepEd privacy notice URL is a live link.
    paragraph([
      run(
        "In the processing of these data and information, the Department of Education is committed to ensure the free flow of information as required under the "
      ),
      run("Freedom of Information Act", false, true),
      run(
        " (Executive Order No. 2, s. 2016) and to protect and respect the confidentiality and privacy of these data and information as required under the "
      ),
      run("Data Privacy Act of 2012", false, true),
      run(" (Republic Act No. 10173) read: "),
      new ExternalHyperlink({
        link: DEPED_DATA_PRIVACY_NOTICE_URL,
        children: [
          new TextRun({
            text: DEPED_DATA_PRIVACY_NOTICE_URL,
            font: FONT,
            size: SIZE,
            style: "Hyperlink",
            color: "0563C1",
            underline: {},
          }),
        ],
      }),
      run("). Data generated are not shared with any other party."),
    ]),
    blank(),

    // I. Complainant's Information
    body("I. COMPLAINANT'S INFORMATION", true),
    ...infoLines,
    blank(),

    // II. Complaint Against — every option listed, ticked for the filed choice.
    body("II. COMPLAINT AGAINST", true),
    new Table({
      width: { size: 9350, type: WidthType.DXA },
      borders: TABLE_BORDERS,
      rows: [
        choiceRow(
          "Learner Government COMEA",
          "Candidate",
          checkedSide(against, "Learner Government COMEA", "Candidate")
        ),
        choiceRow("Teacher", "Political Party", checkedSide(against, "Teacher", "Political Party")),
        againstOthersRow(against),
      ],
    }),
    blank(),

    // III. Nature of Complaint — every option listed, ticked for the filed subject.
    body("III. NATURE OF COMPLAINT", true),
    new Table({
      width: { size: 9350, type: WidthType.DXA },
      borders: TABLE_BORDERS,
      rows: [
        choiceRow("Dishonesty", "Falsification", checkedSide(nature, "Dishonesty", "Falsification")),
        choiceRow("Oppression", "Vote-solicitation", checkedSide(nature, "Oppression", "Vote-solicitation")),
        choiceRow(
          "Disgraceful and Immoral Conduct",
          "Negligence of Duty",
          checkedSide(nature, "Disgraceful and Immoral Conduct", "Negligence of Duty")
        ),
        choiceRow("Impersonation", "Misconduct", checkedSide(nature, "Impersonation", "Misconduct")),
        othersRow(nature?.label === "Others" ? nature.other : undefined),
      ],
    }),
    blank(),

    // IV. Narrative Report — the writing lines carry the typed narrative.
    body("IV. NARRATIVE REPORT", true),
    // The paper template bolds only the "Instruction:" label — the sentence
    // itself is plain, with the sheet note italic.
    paragraph([
      run("Instruction:", true),
      run(" Write in detail the incident or complaint including the persons involved, date and time. "),
      run("(May use additional sheet/s of paper if necessary)", false, true),
    ]),
    // A blank line separates the instruction from the typed answer.
    blank(),
    ...(complaint.description.trim()
      ? complaint.description.split(/\r?\n/).map((line) => body(line))
      : [paragraph([run(underscores(BLANK.narrative)), run(underscores(BLANK.narrativeExtra))])]),
    blank(),

    // V. Attachments — the evidence's images embedded as real pictures,
    // other files by name.
    body("V. ATTACHMENTS (Proofs e.g. picture, video etc.) *if available", true),
    ...attachmentsBlocks(complaint.evidence ?? [], input.evidenceImages ?? []),
    blank(),

    // VI. Certification — left for the student's wet signature.  The sentence
    // keeps the template's half-inch first-line indent (its leading tab).
    body("VI. CERTIFICATION", true),
    blank(),
    indented(
      "I hereby certify that the information stated herein is true and correct to the best of my knowledge.",
      { firstLine: 720 }
    ),
    blank(),

    // Signature — on the right side of the page; the line sits centered over
    // the caption.  The caption (≈199pt wide) is longer than the 22-underscore
    // line (≈122pt), so the line is inset from the right by half the
    // difference (≈38pt = 770 twips) to align both centers.
    indented(underscores(BLANK.signature), { right: 770 }, { alignment: AlignmentType.RIGHT }),
    indented("Signature of Complainant over Printed Name", {}, { alignment: AlignmentType.RIGHT }),
    blank(AlignmentType.CENTER),

    // Received by — left for the Commissioner on Grievance.  The caption sits
    // below its line, centered on it: the 34-underscore line (≈189pt) is
    // longer than the caption (≈123pt), so the caption is indented by half
    // the difference (≈33pt = 660 twips).  The caption and the "Date:" label
    // print italic.
    body("Received by:"),
    body(underscores(BLANK.receivedBy)),
    indented("Commissioner on Grievance", { left: 660 }, { italics: true }),
    paragraph([run("Date: ", false, true), run(underscores(BLANK.receivedDate))]),
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

/** Pack the grievance form as a .docx file and trigger browser download. */
export async function saveGrievanceFormDocx(
  input: GrievanceFormInput,
  filename: string = GRIEVANCE_FORM_FILENAME
): Promise<void> {
  // Evidence images are fetched first so the packed docx carries the real
  // pictures; a failed fetch falls back to the name-only listing.
  const evidenceImages = await fetchEvidenceImages(input.complaint.evidence);
  const doc = buildGrievanceFormDocx({ ...input, evidenceImages });
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
