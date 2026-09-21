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
}

export interface MasterlistParseResult {
  rows: MasterlistRow[];
  skipped: number;
  errors: string[];
}

/** 5MB hard cap on uploaded masterlist files (R3 DoS mitigation). */
export const MASTERLIST_MAX_BYTES = 5 * 1024 * 1024;

const LRN_RE = /^\d{12}$/;

type ColumnKey = "lrn" | "name" | "birthdate" | "grade" | "section" | "strand";

/** Canonical header keys of `Based Documents/CNNHS-MASTER-LIST-FORMAT.docx`.
 *  Matching is containment-based so decorated headers like
 *  "FULL NAME (LAST, FIRST, MIDDLE)" and "BIRTHDATE (MM/DD/YYYY)" resolve. */

function headerKey(cell: string): string {
  const key = cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key.includes("adviser")) return "";
  if (key.includes("lrn")) return "lrn";
  if (key.includes("birth")) return "birthdate";
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
 * Map a header line to a { columnKey → fieldIndex } position map.
 * Returns null when the line carries no recognizable masterlist header.
 * A genuine header row always names at least LRN + name + birthdate, so
 * a 2-key minimum keeps data rows like "BAD-LRN\t..." from being consumed.
 */
export function buildHeaderIndex(line: string): Record<string, number> | null {
  const cells = line.split(/\t+/).filter((c) => c.trim() !== "");
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

const POSITIONAL_DEFAULTS: Record<ColumnKey, number> = {
  lrn: 0,
  name: 1,
  birthdate: 3,
  grade: 6,
  strand: 7,
  section: 8,
};

/**
 * Convert one row of raw fields into a MasterlistRow.
 * Malformed rows (short, invalid LRN, missing name/birthdate) return null.
 * `index` maps canonical column keys to field positions; when absent, the
 * template column order is assumed (LRN, FULL NAME, SEX, BIRTHDATE, AGE,
 * PARENT/GUARDIAN, GRADE LEVEL, STRAND/CLUSTER, SECTION, ADVISER NAME).
 */
export function toMasterlistRow(
  fields: string[],
  index?: Record<string, number> | null
): MasterlistRow | null {
  const at = (key: ColumnKey): string => {
    const position = (index?.[key] ?? POSITIONAL_DEFAULTS[key]) as number;
    return normalizeCell(fields[position] || "");
  };

  const lrn = at("lrn");
  const fullName = at("name");
  const birthdate = at("birthdate");
  if (!LRN_RE.test(lrn)) return null;
  if (!fullName || !birthdate) return null;

  const grade = at("grade").replace(/^grade\s*/i, "").trim();
  const section = at("section");
  const strand = at("strand");

  return {
    lrn,
    fullName: fullName.toUpperCase(),
    birthdate,
    gradeSection: [grade, section].filter(Boolean).join(" - ") || grade,
    strand,
  };
}

/**
 * Parse mammoth raw text into masterlist rows. Rows are recovered by
 * splitting on newlines (tables render one row per paragraph); cells are
 * recovered from tabs, with a multi-space fallback for hand-built files.
 * Malformed rows are skipped and reported.
 */
export function parseMasterlist(text: string): MasterlistParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const result: MasterlistParseResult = { rows: [], skipped: 0, errors: [] };

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
      body.push(cells);
    } else {
      // Multi-space fallback for non-tabular files
      const spaced = line.split(/ {2,}/);
      body.push(spaced.length > 1 ? spaced : [line]);
    }
  }

  body.forEach((fields, i) => {
    if (!fields.some((c) => c.trim())) return;
    const row = toMasterlistRow(fields, headerIndex);
    if (row) {
      result.rows.push(row);
    } else {
      result.skipped += 1;
      result.errors.push(`Row ${i + 2}: malformed or incomplete (expected 12-digit LRN, name, and birthdate).`);
    }
  });

  return result;
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
 * all match the existing student. Comparisons are whitespace-collapsed
 * and case-insensitive; masterlist birthdates (MM/DD/YYYY) are compared
 * digit-by-digit so either date format resolves.
 */
export function isFullMasterlistMatch(
  row: MasterlistRow,
  student: { lrn: string; firstName: string; lastName: string; birthdate: string }
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

  const collapseDate = (s: string) => s.replace(/[^0-9]/g, "");
  return collapseDate(row.birthdate) === collapseDate(student.birthdate);
}