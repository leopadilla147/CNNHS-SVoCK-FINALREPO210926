/**
 * Masterlist .docx extraction + row parsing (MASTER-01).
 *
 * Security (R3): mammoth is a parser, not a sanitizer — we use
 * `extractRawText` ONLY and never convert uploaded .docx to HTML.
 * Input is capped at 5MB and the extract step is wrapped in try/catch
 * with a user-facing message.
 */
import mammoth from "mammoth";

export interface MasterlistRow {
  lrn: string;
  fullName: string;
  birthdate: string;
  gradeSection: string;
  strand: string;
  /** Normalized to "Male" / "Female"; empty when the cell is unreadable. */
  sex: string;
  /** Canonical DB form ("Grade 7".."Grade 12"); empty when unreadable. */
  gradeLevel: string;
  section: string;
  parentGuardian: string;
  adviser: string;
  /** 1-based number of the row in the sheet (2 = first data row), stamped by
   *  the parse loop so error messages can point at the right line. */
  sheetRow?: number;
}

/**
 * Title Case a name: "PADILLA, LEONARD A." / "leonard padilla" →
 * "Padilla, Leonard A." — only the first letter of each name part is a
 * capital.  A separator (space, hyphen, apostrophe, period, comma) starts a
 * new capitalised part, so "DELA CRUZ" → "Dela Cruz" and "O'BRIEN" →
 * "O'Brien".  Never apply this to acronym-valued cells (STRAND "STEM",
 * "GAS"), which stay as written.
 */
export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s\-'.,])([a-z])/g, (_match, separator: string, letter: string) => separator + letter.toUpperCase());
}

/** A single-letter token with an optional period ("A", "A.") — a middle initial. */
const SINGLE_INITIAL_RE = /^[A-Za-z].?$/;

interface NameParts {
  lastName: string;
  firstName: string;
  middleName: string;
}

/**
 * Split the template's comma-separated name cell — "LAST NAME, FIRST NAME,
 * MIDDLE INITIAL" — into its parts.  The comma is the field separator, so
 * everything between the first and second comma is the WHOLE first name: a
 * two-word first name ("DELA CRUZ, MARIA GRACE, A." → first "Maria Grace")
 * is never split, and no comma is ever left glued to a part.  In the
 * single-comma form ("DELA CRUZ, JUAN A.") a trailing single-initial token
 * still reads as the middle initial, matching sheets that keep the
 * documented space-separated layout.  A comma-less name falls back to
 * first/middle/last tokens so the DB NOT NULL columns stay filled rather
 * than rejecting the whole row (validation separately requires the comma).
 */
export function parseNameParts(fullName: string): NameParts {
  const collapsed = fullName.trim().replace(/\s+/g, " ");
  const segments = collapsed.split(",").map((s) => s.trim());

  if (segments.length > 1 && (segments[0] !== "" || segments[1] !== "")) {
    const tailTokens = (segments[1] || "").split(" ").filter(Boolean);
    // "LAST, JUAN A." — with no third segment, a trailing single-initial
    // token in the second segment is the middle initial.
    const trailingInitial =
      segments.length === 2 &&
      tailTokens.length > 1 &&
      SINGLE_INITIAL_RE.test(tailTokens[tailTokens.length - 1]);
    return {
      lastName: segments[0],
      firstName: trailingInitial ? tailTokens.slice(0, -1).join(" ") : tailTokens.join(" "),
      middleName: trailingInitial
        ? tailTokens[tailTokens.length - 1]
        : segments.slice(2).filter(Boolean).join(" "),
    };
  }

  const tokens = collapsed.split(" ").filter(Boolean);
  if (tokens.length <= 1) {
    return { lastName: collapsed, firstName: "", middleName: "" };
  }
  return {
    firstName: tokens[0],
    middleName: tokens.slice(1, -1).join(" "),
    lastName: tokens[tokens.length - 1],
  };
}

/** Title-Case wrapper over `parseNameParts` for display/DB storage. */
export function splitFullName(fullName: string): {
  lastName: string;
  firstName: string;
  middleName: string;
} {
  const parts = parseNameParts(fullName);
  return {
    lastName: toTitleCase(parts.lastName),
    firstName: toTitleCase(parts.firstName),
    middleName: toTitleCase(parts.middleName),
  };
}

/** "M" / "MALE" / "Male" → "Male"; "F" / "FEMALE" → "Female"; else "". */
export function normalizeSex(value: string): string {
  const key = value.trim().toLowerCase();
  if (key.startsWith("m")) return "Male";
  if (key.startsWith("f")) return "Female";
  return "";
}

/** "7", "grade 7", "GRADE 7" → "Grade 7" (DB CHECK shape); else trimmed raw. */
export function normalizeGradeLevel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const numeric = trimmed.replace(/^grade\s*/i, "").trim();
  if (/^\d{1,2}$/.test(numeric)) return `Grade ${numeric}`;
  if (/^grade\s*\d{1,2}$/i.test(trimmed)) return trimmed.replace(/^grade\s*/i, "Grade ");
  return trimmed;
}

export interface MasterlistParseResult {
  /** Every valid row — reading CONTINUES past invalid ones (partial import). */
  rows: MasterlistRow[];
  /** Number of rejected rows: invalid details, or a repeated LRN in the sheet. */
  skipped: number;
  /** One message per rejected row, each starting with "Row N:" and saying
   *  what is wrong and how to fix it. */
  errors: string[];
}

/** 5MB hard cap on uploaded masterlist files (R3 DoS mitigation). */
export const MASTERLIST_MAX_BYTES = 5 * 1024 * 1024;

/** Strict template birthdate shape: zero-padded MM/DD/YYYY. */
const BIRTHDATE_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;

/** True when the MM/DD/YYYY string is a real calendar date (rejects 02/30/2009). */
export function isValidCalendarDate(value: string): boolean {
  if (!BIRTHDATE_RE.test(value)) return false;
  const [mm, dd, yyyy] = value.split("/").map(Number);
  const probe = new Date(Date.UTC(yyyy, mm - 1, dd));
  return probe.getUTCFullYear() === yyyy && probe.getUTCMonth() === mm - 1 && probe.getUTCDate() === dd;
}

type ColumnKey =
  | "lrn"
  | "name"
  | "sex"
  | "birthdate"
  | "grade"
  | "section"
  | "strand"
  | "parent"
  | "adviser";

/** Canonical header keys of `Based Documents/CNNHS-MASTER-LIST-FORMAT.docx`.
 *  Matching is containment-based so decorated headers like
 *  "FULL NAME (LAST, FIRST, MIDDLE)" and "BIRTHDATE (MM/DD/YYYY)" resolve. */

function headerKey(cell: string): string {
  const key = cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  // "FULL NAME OF PARENT/LEGAL GUARDIAN" and "ADVISER NAME" both contain
  // "name", so they must resolve BEFORE the generic name check.
  if (key.includes("parent") || key.includes("guardian")) return "parent";
  if (key.includes("adviser")) return "adviser";
  if (key.includes("lrn")) return "lrn";
  if (key.includes("birth")) return "birthdate";
  if (key.includes("sex") || key.includes("gender")) return "sex";
  if (key.includes("strand") || key.includes("cluster")) return "strand";
  if (key.includes("grade")) return "grade";
  if (key.includes("section")) return "section";
  if (key.includes("name")) return "name";
  return "";
}

function normalizeCell(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Map a header row's cells to a { columnKey → fieldIndex } position map.
 * Returns null when the row carries no recognizable masterlist header.
 * A genuine header row always names at least LRN + name + birthdate, so
 * a 2-key minimum keeps data rows like "BAD-LRN\t..." from being consumed.
 */
export function buildHeaderIndexFromCells(cells: string[]): Record<string, number> | null {
  const index: Record<string, number> = {};
  let found = 0;
  cells.forEach((cell, i) => {
    const key = headerKey(cell);
    if (key && index[key] === undefined) {
      index[key] = i;
      found += 1;
    }
  });
  return found >= 2 ? index : null;
}

/** Tab-line variant of `buildHeaderIndexFromCells` (mammoth text path). */
export function buildHeaderIndex(line: string): Record<string, number> | null {
  return buildHeaderIndexFromCells(line.split(/\t+/).filter((c) => c.trim() !== ""));
}

/**
 * True when any cell carries a 12-digit LRN (a "1)" row-marker prefix is
 * tolerated).  Title/label rows above the column headers — "STUDENT MASTER
 * LIST", "SY: 2026-2027", the school name — never carry one, so they are
 * dropped before the header is found instead of being counted (and
 * mis-reported) as data rows.  Requirement: the title/header must never
 * count as a row.
 */
function rowLooksLikeData(cells: string[]): boolean {
  return cells.some((c) => /\d{12}/.test(c.replace(/^\s*\d{1,3}[).]\s*/, "")));
}

const POSITIONAL_DEFAULTS: Record<ColumnKey, number> = {
  lrn: 0,
  name: 1,
  sex: 2,
  birthdate: 3,
  grade: 6,
  strand: 7,
  section: 8,
  parent: 5,
  adviser: 9,
};

/**
 * Outcome of validating one raw masterlist row:
 *   - "ignored"  the row carries no LRN — an unfilled template row; it is
 *                silently skipped (no error, no skip count).
 *   - "ok"       every required field is present and well-formed.
 *   - "invalid"  the row HAS an LRN but at least one required detail is
 *                missing or malformed; `problems` names each one so the
 *                adviser can fix the exact cell.
 * Only LRN, Full Name, Sex/Gender, Birthdate, and Grade Level are required —
 * Age, Parent/Guardian, Strand/Cluster, Section, and Adviser are ignored.
 */
export type MasterlistRowResult =
  | { kind: "ignored" }
  | { kind: "ok"; row: MasterlistRow }
  | { kind: "invalid"; problems: string[] };

/**
 * Validate one row of raw fields against the masterlist format:
 *   LRN         — exactly 12 digits, numbers only (a pre-printed "1)" row
 *                 marker sharing the cell is tolerated).
 *   Full Name   — "LAST NAME, FIRST NAME, MIDDLE INITIAL(optional)"; the
 *                 comma is the field separator (a two-word first name stays
 *                 whole), and the middle part must be a single initial.
 *   Sex/Gender  — Male / Female (case-insensitive) or M / F.
 *   Birthdate   — MM/DD/YYYY, a real calendar date.
 *   Grade Level — Grade 7 to Grade 12 (case-insensitive) or bare 7-12.
 * `index` maps canonical column keys to field positions; when absent, the
 * template column order is assumed (LRN, FULL NAME, SEX, BIRTHDATE, AGE,
 * PARENT/GUARDIAN, GRADE LEVEL, STRAND/CLUSTER, SECTION, ADVISER NAME).
 */
export function validateMasterlistRow(
  fields: string[],
  index?: Record<string, number> | null
): MasterlistRowResult {
  const at = (key: ColumnKey): string => {
    const position = (index?.[key] ?? POSITIONAL_DEFAULTS[key]) as number;
    return normalizeCell(fields[position] || "");
  };
  const problems: string[] = [];

  // Row gate, checked against the LRN column position:
  //   * EXACTLY 12 digits in the cell → the row is read (a legacy "1)" row
  //     marker sharing the cell, i.e. "1) 136400110001", is tolerated);
  //   * an EMPTY cell → an unfilled template row, silently ignored;
  //   * any other non-empty cell → an invalid LRN (error + stop).
  // Only the LRN cell is inspected, so a stray 12-digit number in another
  // column can never masquerade as the LRN.
  const lrnCell = at("lrn");
  const compact = lrnCell.replace(/\s+/g, "");
  const withoutMarker = compact.replace(/^\d{1,3}[).]/, "");
  const lrn = /^\d{12}$/.test(withoutMarker) ? withoutMarker : "";
  if (!lrn) {
    if (!lrnCell) return { kind: "ignored" };
    return {
      kind: "invalid",
      problems: ["invalid LRN — must be exactly 12 digits, numbers only"],
    };
  }

  // Full Name — "LAST NAME, FIRST NAME, MIDDLE INITIAL(optional)": the comma
  // is the field separator, so the WHOLE second segment is the first name
  // (a two-word first name like "JUAN CARLOS" stays one name) and the third
  // segment, when present, must be a single initial.
  const fullName = at("name");
  if (!fullName) {
    problems.push("missing Full Name (Last Name, First Name, Middle Initial)");
  } else {
    const parts = parseNameParts(fullName);
    if (!fullName.includes(",") || !parts.lastName || !parts.firstName) {
      problems.push('invalid Full Name — use "Last Name, First Name, Middle Initial"');
    } else if (parts.middleName && !/^[A-Za-z]\.?$/.test(parts.middleName.replace(/\s+/g, ""))) {
      problems.push("invalid Full Name — the middle name must be a single initial");
    }
  }

  // Sex/Gender — Male / Female (or M / F shorthand), case-insensitive.
  const sexRaw = at("sex");
  const sex = normalizeSex(sexRaw);
  if (!sexRaw) {
    problems.push("missing Sex/Gender (Male or Female)");
  } else if (!sex) {
    problems.push("invalid Sex/Gender — use Male or Female");
  }

  // Birthdate — MM/DD/YYYY, real calendar date.
  const birthdate = at("birthdate");
  if (!birthdate) {
    problems.push("missing Birthdate (MM/DD/YYYY)");
  } else if (!isValidCalendarDate(birthdate)) {
    problems.push("invalid Birthdate — use MM/DD/YYYY");
  }

  // Grade Level — Grade 7 to Grade 12 (or bare 7-12).
  const gradeRaw = at("grade");
  const gradeLevel = normalizeGradeLevel(gradeRaw);
  if (!gradeRaw) {
    problems.push("missing Grade Level (Grade 7 to Grade 12)");
  } else if (!/^Grade (7|8|9|10|11|12)$/.test(gradeLevel)) {
    problems.push("invalid Grade Level — use Grade 7 to Grade 12");
  }

  if (problems.length > 0) return { kind: "invalid", problems };

  const grade = gradeRaw.replace(/^grade\s*/i, "").trim();
  const section = at("section");
  const strand = at("strand");

  return {
    kind: "ok",
    row: {
      lrn,
      // Names are Title Cased ("Padilla, Leonard A."), never ALL CAPS.
      // Strand / Section keep their acronym casing ("STEM", "GAS").
      fullName: toTitleCase(fullName),
      birthdate,
      gradeSection: [grade, section].filter(Boolean).join(" - ") || grade,
      strand,
      sex,
      gradeLevel,
      section,
      parentGuardian: toTitleCase(at("parent")),
      adviser: toTitleCase(at("adviser")),
    },
  };
}

/**
 * Back-compat wrapper: the validated row, or null when the row is an
 * unfilled (LRN-less) template row or failed validation.
 */
export function toMasterlistRow(
  fields: string[],
  index?: Record<string, number> | null
): MasterlistRow | null {
  const result = validateMasterlistRow(fields, index);
  return result.kind === "ok" ? result.row : null;
}

/**
 * Shared body reader for both parse paths (MASTER-01, partial import):
 * validates each row against the 5 required columns and COLLECTS every
 * problem instead of stopping at the first one.  A row is rejected as a
 * whole when ANY of its required details is missing or malformed — the
 * valid rows around it still import.
 *
 * An LRN may appear only ONCE per sheet: the FIRST occurrence stays valid
 * and every later copy is rejected as a row (the sheet's other rows still
 * import, and the import's upsert guard stays satisfied).  The same LRN in
 * a DIFFERENT school year is legitimate, and re-uploading a corrected sheet
 * updates the existing row via the (lrn, school_year) upsert.
 */
function readBodyRows(
  body: string[][],
  headerIndex: Record<string, number> | null
): MasterlistParseResult {
  const result: MasterlistParseResult = { rows: [], skipped: 0, errors: [] };
  const seenLrn = new Map<string, number>();

  for (const [i, fields] of body.entries()) {
    if (!fields.some((c) => c.trim())) continue;
    const sheetRow = i + 2;
    const outcome = validateMasterlistRow(fields, headerIndex);

    if (outcome.kind === "ignored") continue; // unfilled template row

    if (outcome.kind === "invalid") {
      result.skipped += 1;
      result.errors.push(
        `Row ${sheetRow}: ${outcome.problems.join("; ")} — this row was not imported. Fix the highlighted details and upload the sheet again.`
      );
      continue;
    }

    const firstSeen = seenLrn.get(outcome.row.lrn);
    if (firstSeen !== undefined) {
      result.skipped += 1;
      result.errors.push(
        `Row ${sheetRow}: duplicate LRN ${outcome.row.lrn} — it already appears in Row ${firstSeen}. This row was not imported; keep each LRN to a single row.`
      );
      continue;
    }
    seenLrn.set(outcome.row.lrn, sheetRow);
    result.rows.push({ ...outcome.row, sheetRow });
  }

  return result;
}

/** Why an LRN from a sheet cannot be imported. */
export interface LrnConflictInfo {
  /** "registered" — a student account already holds this LRN;
   *  "listed" — the LRN is already on the Student Masterlist. */
  reason: "registered" | "listed";
  /** Account status ("approved"/"pending"/"rejected") or enrollment status. */
  detail: string;
}

/**
 * Pointed skip message for a sheet row whose LRN already exists in the
 * system (MASTER-01 partial import): the row is NOT re-uploaded, the rest
 * of the sheet still imports.
 */
export function describeSkippedLrn(row: MasterlistRow, info: LrnConflictInfo): string {
  const where =
    info.reason === "registered"
      ? `already registered (${info.detail} account)`
      : "already on the Student Masterlist (awaiting registration)";
  return `Row ${row.sheetRow ?? "?"}: LRN ${row.lrn} ${where} — skipped, not re-uploaded.`;
}

/**
 * Parse mammoth raw text into masterlist rows. Rows are recovered by
 * splitting on newlines (tables render one row per paragraph); cells are
 * recovered from tabs, with a multi-space fallback for hand-built files.
 * Every row is validated and ALL problem rows are reported (partial
 * import — valid rows are never discarded because of a bad neighbour).
 */
export function parseMasterlist(text: string): MasterlistParseResult {
  // Lines are NOT trimmed wholesale: a leading tab is a real empty first
  // cell (no LRN), which trimming would silently shift into the next column.
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  let headerIndex: Record<string, number> | null = null;
  const body: string[][] = [];

  for (const line of lines) {
    // Single-tab split: preserves empty cells, so `\t\tF\t...` keeps its
    // empty name column instead of collapsing to `F\t...`.
    const cells = line.split("\t");
    if (cells.length > 1) {
      const index = buildHeaderIndex(line);
      if (index) {
        headerIndex = index;
        continue;
      }
      // Before the header is found, a multi-cell line that carries no LRN is
      // a title/label line (often tab-formatted in exported sheets) — drop
      // it so it never counts as a row.  After the header, everything is
      // data and is validated as usual.
      if (!headerIndex && !rowLooksLikeData(cells)) continue;
      body.push(cells);
    } else {
      // Multi-space fallback for non-tabular files (leading spacing is
      // meaningless here, so trim before splitting).  A SINGLE-cell line is
      // a document title/heading — never a data row (a real row carries the
      // LRN plus at least one more column) — so it is dropped entirely:
      // titles are neither counted (requirement: header/title rows stay out
      // of every count) nor mis-reported as "invalid LRN", and the first
      // tabular data line keeps its Row 2 numbering after the header.
      const trimmed = line.trim();
      const spaced = trimmed.split(/ {2,}/);
      if (spaced.length > 1) body.push(spaced);
    }
  }

  return readBodyRows(body, headerIndex);
}

/**
 * Parse rows recovered from the docx's actual table XML
 * (`extractMasterlistDocx`) — one entry per w:tr, one cell per w:tc, so
 * empty cells keep their positions and no row structure is lost (the
 * mammoth text path flattens every cell onto its own line).
 */
export function parseMasterlistRows(tableRows: string[][]): MasterlistParseResult {
  let headerIndex: Record<string, number> | null = null;
  const body: string[][] = [];

  for (const cells of tableRows) {
    if (!cells.some((c) => c.trim() !== "")) continue;
    if (!headerIndex) {
      const index = buildHeaderIndexFromCells(cells);
      if (index) {
        headerIndex = index;
        continue;
      }
      // Not the header yet: filled sheets often carry title/label rows
      // INSIDE the table above the column headers ("STUDENT MASTER LIST",
      // "SY: 2026-2027").  They carry no LRN, so drop them here — they must
      // not be counted as rows or rejected as "invalid LRN".
      if (!rowLooksLikeData(cells)) continue;
    }
    body.push(cells);
  }

  return readBodyRows(body, headerIndex);
}

/** WordprocessingML namespace of word/document.xml. */
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface MasterlistDocxContents {
  /** One entry per table row (w:tr), one entry per cell (w:tc). */
  rows: string[][];
  /** All paragraph text, one line per w:p (header lines included). */
  text: string;
}

/**
 * Read the uploaded .docx's table structure directly (JSZip + DOMParser on
 * word/document.xml).  Returns null when the file is not a readable docx
 * with a table — the caller then falls back to mammoth text extraction.
 * The XML is only ever parsed for text; no markup from the upload reaches
 * the DOM (R3).
 */
export async function extractMasterlistDocx(file: File): Promise<MasterlistDocxContents | null> {
  if (file.size > MASTERLIST_MAX_BYTES) {
    throw new Error("The masterlist file is larger than 5MB. Please upload a smaller file.");
  }
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const docXml = await zip.file("word/document.xml")?.async("string");
    if (!docXml) return null;

    const doc = new DOMParser().parseFromString(docXml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return null;

    const table = doc.getElementsByTagNameNS(W_NS, "tbl")[0];
    if (!table) return null;

    const rows: string[][] = [];
    for (const tr of Array.from(table.getElementsByTagNameNS(W_NS, "tr"))) {
      rows.push(
        Array.from(tr.getElementsByTagNameNS(W_NS, "tc")).map((tc) =>
          Array.from(tc.getElementsByTagNameNS(W_NS, "t"))
            .map((t) => t.textContent || "")
            .join("")
        )
      );
    }
    if (rows.length === 0) return null;

    const text = Array.from(doc.getElementsByTagNameNS(W_NS, "p"))
      .map((p) =>
        Array.from(p.getElementsByTagNameNS(W_NS, "t"))
          .map((t) => t.textContent || "")
          .join("")
      )
      .filter((l) => l.trim() !== "")
      .join("\n");

    return { rows, text };
  } catch {
    return null;
  }
}

/**
 * Combined upload entry point (MASTER-01): try the structured docx table
 * path first — the real CNNHS-MASTER-LIST-FORMAT.docx stores rows as a
 * table, which mammoth's flat text cannot recover — and fall back to the
 * tab/multi-space text parse for hand-built files.
 */
export async function extractAndParseMasterlist(
  file: File
): Promise<{ parsed: MasterlistParseResult; text: string }> {
  const docx = await extractMasterlistDocx(file);
  if (docx) {
    const parsed = parseMasterlistRows(docx.rows);
    // A real table with at least one body row wins — falling back would only
    // re-parse the same sheet (and would report the same problem rows a
    // second time, differently worded).
    if (parsed.rows.length > 0 || parsed.errors.length > 0 || docx.rows.length > 1) {
      return { parsed, text: docx.text };
    }
  }
  const text = await extractMasterlistText(file);
  return { parsed: parseMasterlist(text), text };
}

/**
 * Extract raw text from an uploaded .docx. Throws a user-facing error on
 * oversized files (>5MB) or unreadable documents. Never converts to HTML.
 */
export async function extractMasterlistText(file: File): Promise<string> {
  if (file.size > MASTERLIST_MAX_BYTES) {
    throw new Error("The masterlist file is larger than 5MB. Please upload a smaller file.");
  }
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || "";
  } catch {
    throw new Error("Could not read the masterlist file. Make sure it is a valid .docx in the CNNHS masterlist format.");
  }
}

/**
 * D-10 full-match predicate: LRN AND normalized full name AND birthdate
 * AND sex AND grade level all match the registered student. Comparisons
 * are whitespace-collapsed and case-insensitive; birthdates are compared
 * by calendar component so the sheet's MM/DD/YYYY agrees with the DB's
 * YYYY-MM-DD regardless of digit order.
 * Sex/grade are only decisive when BOTH sides carry a value — a blank
 * masterlist cell never fails an otherwise-exact student.
 */
export function isFullMasterlistMatch(
  row: MasterlistRow,
  student: {
    lrn: string;
    firstName: string;
    lastName: string;
    birthdate: string;
    gender?: string;
    gradeLevel?: string;
  }
): boolean {
  if (row.lrn !== (student.lrn || "").trim()) return false;

  // Token comparison: order-insensitive, drops single-letter middle initials
  // so "DELA CRUZ, JUAN A.", "JUAN A. DELA CRUZ", and "Juan Dela Cruz" agree.
  const nameTokenKey = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s,]+/g, " ")
      .split(/[\s,]+/)
      .filter((t) => t.length > 1)
      .sort()
      .join(" ");
  const rowName = nameTokenKey(row.fullName);
  const studentName = nameTokenKey(`${student.lastName} ${student.firstName}`);
  if (rowName !== studentName || !rowName) return false;

  // Calendar-component comparison: the sheet stores MM/DD/YYYY while the
  // students table stores YYYY-MM-DD — a raw digit collapse would compare
  // "05142009" with "20090514" and reject every real match.
  const dateParts = (value: string): [string, string, string] | null => {
    const trimmed = value.trim();
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
    if (iso) return [iso[1], iso[2].padStart(2, "0"), iso[3].padStart(2, "0")];
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (us) return [us[3], us[1].padStart(2, "0"), us[2].padStart(2, "0")];
    return null;
  };
  const rowDate = dateParts(row.birthdate);
  const studentDate = dateParts(student.birthdate);
  if (
    !rowDate || !studentDate ||
    rowDate[0] !== studentDate[0] ||
    rowDate[1] !== studentDate[1] ||
    rowDate[2] !== studentDate[2]
  ) {
    return false;
  }

  if (row.sex && student.gender && row.sex !== student.gender) return false;
  if (row.gradeLevel && student.gradeLevel && row.gradeLevel !== student.gradeLevel) return false;

  return true;
}

export interface MasterlistMatchPartition {
  /** Registered, still-PENDING students the sheet fully matches → approve. */
  pendingIds: string[];
  /** Already-approved students the sheet fully matches → (re)stamp the
   *  verdict to 'automatic' (never an error — the RPC treats it as a stamp). */
  alreadyApprovedIds: string[];
  /** LRN matches a registered student but a detail differs → adviser review. */
  forReview: number;
  /** Sheet rows with no registered account yet → awaiting registration. */
  awaiting: number;
  /** Matched students whose registration was REJECTED — left untouched (an
   *  explicit rejection is never silently overturned). */
  alreadyRejected: number;
}

/**
 * Partition masterlist rows against the registered students (MASTER-01
 * upload flow).  Pure — the caller decides what to do with each bucket.
 * A row only counts as a match when `isFullMasterlistMatch` agrees on LRN +
 * name + birthdate + grade + gender, so a student the adviser manually
 * approved over a mismatch is never re-labelled 'automatic'.
 */
export function partitionMasterlistMatches(
  rows: MasterlistRow[],
  students: Array<{
    id: string;
    lrn: string;
    firstName: string;
    lastName: string;
    birthdate: string;
    gender?: string;
    gradeLevel?: string;
    status: string;
  }>
): MasterlistMatchPartition {
  const partition: MasterlistMatchPartition = {
    pendingIds: [],
    alreadyApprovedIds: [],
    forReview: 0,
    awaiting: 0,
    alreadyRejected: 0,
  };

  for (const row of rows) {
    const existing = students.find((s) => s.lrn === row.lrn);
    if (!existing) {
      partition.awaiting += 1;
      continue;
    }
    if (!isFullMasterlistMatch(row, existing)) {
      partition.forReview += 1;
      continue;
    }
    if (existing.status === "pending") partition.pendingIds.push(existing.id);
    else if (existing.status === "approved") partition.alreadyApprovedIds.push(existing.id);
    else partition.alreadyRejected += 1;
  }

  return partition;
}

/** "SY: 2026-2027" / "S.Y. 2026-2027" header line → "2026-2027". Returns
 *  "" when the document carries no recognizable school-year label. */
export function extractSchoolYear(text: string): string {
  const match = /S\.?Y\.?:?\s*(\d{4})\s*[-–—]\s*(\d{4})/i.exec(text);
  if (!match) return "";
  return `${match[1]}-${match[2]}`;
}

/** "MM/DD/YYYY" (template format) → "YYYY-MM-DD" (Postgres date). Returns
 *  the trimmed input unchanged when it is already ISO-shaped or unparseable. */
export function toIsoBirthdate(value: string): string {
  const trimmed = value.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return trimmed;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}