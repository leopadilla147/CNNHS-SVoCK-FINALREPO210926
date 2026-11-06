/**
 * Masterlist .xlsx/.xls extraction + Excel template generation.
 *
 * Excel workbooks are converted to the SAME `string[][]` shape the docx
 * table reader produces (`extractMasterlistDocx`), so ONE validation
 * pipeline (parseMasterlistRows → validateMasterlistRow) covers both
 * formats — no duplicated rules.
 *
 * Reading is done with SheetJS (`xlsx`, pinned in package.json to the
 * official SheetJS CDN build). The module is dynamically imported so it
 * never lands in the initial bundle. As with the docx path, uploaded
 * workbooks are only ever READ — no markup/value from an upload reaches
 * the DOM (R3).
 *
 * Date note: Excel stores dates as numeric serials carrying a date number
 * format (typing "09/05/2009" into a General cell converts the cell). The
 * reader detects date-formatted numeric cells via the cell's number format
 * string and converts the serial back to "MM/DD/YYYY", so the shared
 * validator accepts them unchanged. The downloadable template additionally
 * pre-formats the LRN and Birthdate columns as Text ("@") so Excel never
 * strips LRN leading zeros or rewrites typed birthdates in the first place.
 */
import type { CellObject, WorkBook, WorkSheet } from "xlsx";

/** File extensions of workbooks the uploader accepts (.xlsm is the
 *  macro-enabled twin of .xlsx — the same reader handles it, so rejecting
 *  it would only confuse). */
const EXCEL_EXTENSIONS = [".xlsx", ".xlsm", ".xls"];

/** MIME types of OOXML spreadsheets (.xlsx/.xlsm) and legacy .xls. */
const EXCEL_MIME_RE =
  /^application\/vnd\.(openxmlformats-officedocument\.spreadsheetml\.sheet|ms-excel)\b/;

/** User-facing error for bytes that are not a readable Excel workbook. */
const UNREADABLE_EXCEL_MESSAGE =
  "Could not read any worksheet from the Excel file. Make sure it is a valid .xlsx or .xls copy of the CNNHS masterlist format.";

/** True when an uploaded file looks like an Excel workbook (by extension
 *  or MIME type) and should take the SheetJS path instead of the docx one. */
export function isMasterlistExcelFile(file: { name: string; type?: string }): boolean {
  const name = (file.name || "").toLowerCase();
  if (EXCEL_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return EXCEL_MIME_RE.test((file.type || "").toLowerCase());
}

export interface MasterlistXlsxContents {
  /** One entry per worksheet row in the used range, one entry per column —
   *  empty cells are "" so positions never shift. Blank worksheet rows are
   *  included (as all-"" rows) so row numbers stay true to the sheet. */
  rows: string[][];
  /** Every non-empty cell's text, one per line — feeds extractSchoolYear
   *  (title rows like "SY: 2026-2027" are real cells in Excel). */
  text: string;
  /** 1-based worksheet row number of rows[0] (the used range's first row).
   *  Passed to parseMasterlistRows so error messages cite the row the
   *  adviser actually sees, even with title rows above the header. */
  firstRowNumber: number;
}

/**
 * Convert an uploaded workbook to masterlist rows. Throws a user-facing
 * error when the bytes are not a readable workbook; an empty/blank sheet
 * is NOT an error (the shared pipeline reports it like an empty docx).
 *
 * `pickSheet` (optional) chooses which worksheet to read when the workbook
 * carries several: the first sheet whose rows satisfy it wins, falling back
 * to the first readable sheet. The caller passes its header recognizer so
 * a masterlist pasted into sheet 2 of a workbook still uploads.
 */
export async function extractMasterlistXlsx(
  buffer: ArrayBuffer,
  pickSheet?: (rows: string[][]) => boolean
): Promise<MasterlistXlsxContents> {
  const XLSX = await import("xlsx");

  // File-signature gate FIRST: .xlsx is a ZIP ("PK…"), legacy .xls is an
  // OLE2 compound file (D0 CF 11 E0 A1 B1 1A E1).  SheetJS silently falls
  // back to a plain-text/CSV parse for ANY other bytes (a renamed PDF, a
  // truncated download) and returns an empty sheet, so without this gate a
  // wrong-type file would quietly import nothing instead of erroring.
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle2 =
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1;
  if (!isZip && !isOle2) throw new Error(UNREADABLE_EXCEL_MESSAGE);

  let workbook: WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellNF: true });
  } catch {
    throw new Error(UNREADABLE_EXCEL_MESSAGE);
  }

  const candidates: MasterlistXlsxContents[] = [];
  for (const sheetName of workbook.SheetNames) {
    const converted = worksheetToContents(XLSX, workbook, workbook.Sheets[sheetName]);
    if (converted) candidates.push(converted);
  }
  if (candidates.length === 0) throw new Error(UNREADABLE_EXCEL_MESSAGE);
  return (pickSheet && candidates.find((c) => pickSheet(c.rows))) || candidates[0];
}

/** Convert one worksheet to { rows, text, firstRowNumber }; null when empty. */
function worksheetToContents(
  XLSX: typeof import("xlsx"),
  workbook: WorkBook,
  ws: WorkSheet
): MasterlistXlsxContents | null {
  if (!ws || !ws["!ref"]) return null;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  // 1904-system workbooks (legacy Mac Excel) offset their serials by four
  // years — 1462 days — from the standard 1900 system.
  const epochShift = (workbook.Workbook as { date1904?: boolean } | undefined)?.date1904
    ? 1462
    : 0;

  const rows: string[][] = [];
  const textLines: string[] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const value = cellToText(ws[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined, epochShift);
      row.push(value);
      if (value.trim() !== "") textLines.push(value);
    }
    rows.push(row);
  }
  return { rows, text: textLines.join("\n"), firstRowNumber: range.s.r + 1 };
}

/**
 * One cell → its text. Numbers stay plain digits (a 12-digit LRN typed as a
 * number survives exactly — float64 is exact to 15 significant digits),
 * date-formatted numbers become "MM/DD/YYYY", everything else is read raw.
 */
function cellToText(cell: CellObject | undefined, epochShift: number): string {
  if (!cell) return "";
  // "str" (a formula's string result) is a real runtime cell type even
  // though SheetJS's ExcelDataType union omits it — read shared strings and
  // formula strings the same way.
  const type = cell.t as string;
  if (type === "s" || type === "str") return String(cell.v ?? "");
  switch (cell.t) {
    case "n": {
      const num = typeof cell.v === "number" ? cell.v : Number(cell.v);
      if (!Number.isFinite(num)) return "";
      if (isDateFormatted(cell)) return formatExcelSerialDate(num + epochShift);
      return String(num);
    }
    case "d": {
      // Date-typed cells only appear when a producer stored real Dates;
      // UTC getters keep the calendar components as entered.
      const date = cell.v instanceof Date ? cell.v : new Date(cell.v as unknown as string);
      if (Number.isNaN(date.getTime())) return "";
      return formatUtcDate(date);
    }
    case "b":
      return cell.v ? "TRUE" : "FALSE";
    default:
      // "e" (cell error), "z" (stub) — nothing usable for a masterlist.
      return "";
  }
}

/** True when a NUMERIC cell carries a date/time number format (e.g.
 *  "mm/dd/yyyy"). Format literals the validator must not mistake for date
 *  tokens — locale prefixes [$-409], quoted text "AM/PM", escaped "\d" —
 *  are stripped first, so "#,##0" or "0.00%" never read as dates. */
function isDateFormatted(cell: CellObject): boolean {
  const format = String((cell as { z?: unknown }).z ?? "")
    .trim()
    .toLowerCase();
  if (!format || format === "general") return false;
  const stripped = format
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "");
  return /[ymdhs]/.test(stripped);
}

/** Excel 1900-system serial → "MM/DD/YYYY". Serial 25569 is 1970-01-01, so
 *  the millisecond conversion lands exactly on midnight UTC for date-only
 *  cells — timezone-independent by construction. */
function formatExcelSerialDate(serial: number): string {
  if (!Number.isFinite(serial)) return "";
  return formatUtcDate(new Date(Math.round((serial - 25569) * 86400000)));
}

function formatUtcDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ */
/* Downloadable Excel template                                        */
/* ------------------------------------------------------------------ */

const TEMPLATE_FILENAME = "CNNHS-MASTER-LIST-FORMAT.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Column headers copied verbatim from the official
 *  Based Documents/CNNHS-MASTER-LIST-FORMAT.docx (the containment-based
 *  header recognizer in masterlistDocx.ts maps every one of them). */
const TEMPLATE_HEADERS = [
  "LRN",
  "FULL NAME (LAST NAME, FIRST NAME, MIDDLE NAME)",
  "SEX (MALE OR FEMALE)",
  "BIRTHDATE(MM/DD/YYYY)",
  "AGE AS OF JUNE 8, 2026",
  "FULL NAME OF PARENT/LEGAL GUARDIAN",
  "GRADE LEVEL",
  "STRAND/CLUSTER(IF SHS)",
  "SECTION",
  "ADVISER NAME",
];

/** Title rows mirroring the docx template. The "SY:" line is not decorative:
 *  extractSchoolYear reads the school year from it on upload. */
function templateTitleRows(schoolYear: string): string[][] {
  return [
    ["CAMARINES NORTE NATIONAL HIGH SCHOOL"],
    ["SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS"],
    ["STUDENT MASTER LIST"],
    [`SY: ${schoolYear}`],
  ];
}

/** Blank pre-formatted rows under the header — typing into them keeps the
 *  Text format on the LRN / Birthdate columns. */
const TEMPLATE_BLANK_ROWS = 30;

/** Column widths (characters), matching each header's content. */
const TEMPLATE_COLUMN_WIDTHS = [14, 36, 18, 16, 8, 30, 12, 18, 16, 24];

/**
 * Build the downloadable Excel masterlist template (same layout and labels
 * as CNNHS-MASTER-LIST-FORMAT.docx) and return the .xlsx bytes. Exported
 * for tests — the UI uses `saveMasterlistTemplateXlsx`.
 */
export async function buildMasterlistTemplateXlsx(schoolYear?: string): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");

  const sy = (schoolYear || "").trim() || "2026-2027";
  const aoa: (string | number)[][] = [...templateTitleRows(sy), TEMPLATE_HEADERS];
  for (let i = 0; i < TEMPLATE_BLANK_ROWS; i += 1) {
    aoa.push(TEMPLATE_HEADERS.map(() => ""));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Text format ("@") on the LRN (col A) and Birthdate (col D) data cells:
  // Excel keeps leading zeros on LRNs and leaves "09/05/2009" as typed.
  // The cells are created explicitly (t:"s", v:"") so the format always
  // rides on a real cell regardless of aoa_to_sheet's blank-cell handling.
  for (let r = aoa.length - TEMPLATE_BLANK_ROWS; r < aoa.length; r += 1) {
    ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: "s", v: "", z: "@" };
    ws[XLSX.utils.encode_cell({ r, c: 3 })] = { t: "s", v: "", z: "@" };
  }

  ws["!cols"] = TEMPLATE_COLUMN_WIDTHS.map((wch) => ({ wch }));
  // Center each title line across the ten columns, like the docx layout.
  ws["!merges"] = templateTitleRows(sy).map((_row, r) => ({
    s: { r, c: 0 },
    e: { r, c: TEMPLATE_HEADERS.length - 1 },
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Masterlist");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/** Build the Excel template and trigger the browser download (same save
 *  pattern as the docx generators in this codebase). */
export async function saveMasterlistTemplateXlsx(schoolYear?: string): Promise<void> {
  const bytes = await buildMasterlistTemplateXlsx(schoolYear);
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = TEMPLATE_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
