/**
 * Excel (.xlsx/.xls) support for the Student Masterlist uploader
 * (masterlistXlsx.ts + the Excel branch of extractAndParseMasterlist).
 *
 * Workbooks are built in-test with the same SheetJS library the reader
 * uses, so every case round-trips through real .xlsx / .xls bytes.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { extractAndParseMasterlist, extractSchoolYear, parseMasterlistRows } from "../masterlistDocx";
import { buildMasterlistTemplateXlsx, isMasterlistExcelFile } from "../masterlistXlsx";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

/** Column headers copied verbatim from CNNHS-MASTER-LIST-FORMAT.docx. */
const HEADERS = [
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

type CellValue = string | number | Date;

/** The downloadable template's layout: 4 title rows, the header, then data. */
function templateAoa(dataRows: CellValue[][]): CellValue[][] {
  return [
    ["CAMARINES NORTE NATIONAL HIGH SCHOOL"],
    ["SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS"],
    ["STUDENT MASTER LIST"],
    ["SY: 2026-2027"],
    HEADERS,
    ...dataRows,
  ];
}

/** One filled data row in template column order. */
function dataRow(
  lrn: CellValue,
  name: string,
  sex: string,
  birthdate: CellValue,
  grade: string
): CellValue[] {
  return [lrn, name, sex, birthdate, "", "", grade, "", "", ""];
}

interface WorkbookFileOptions {
  bookType?: XLSX.BookType;
  mime?: string;
  /** Mutate the worksheet before it is written (simulate real Excel cells). */
  decorate?: (ws: XLSX.WorkSheet) => void;
}

/** Build an AOA workbook and wrap the written bytes in a File. */
function workbookFile(aoa: CellValue[][], fileName: string, options: WorkbookFileOptions = {}): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  options.decorate?.(ws);
  XLSX.utils.book_append_sheet(wb, ws, "Masterlist");
  const bytes = XLSX.write(wb, { bookType: options.bookType ?? "xlsx", type: "array" });
  return new File([bytes], fileName, { type: options.mime ?? XLSX_MIME });
}

/**
 * Excel 1900-system serial for a calendar date — serial = unix days + 25569
 * (25569 is 1970-01-01 in Excel's date system), the exact inverse of the
 * reader's serial→date conversion.  Used to fabricate date cells like real
 * Excel stores them (numeric value + a date number format).
 */
function excelSerial(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86400000) + 25569;
}

describe("isMasterlistExcelFile", () => {
  it("accepts .xlsx, .xlsm and .xls extensions, case-insensitively", () => {
    expect(isMasterlistExcelFile(new File([], "masterlist.xlsx"))).toBe(true);
    expect(isMasterlistExcelFile(new File([], "masterlist.XLSX"))).toBe(true);
    expect(isMasterlistExcelFile(new File([], "masterlist.Xls"))).toBe(true);
  });

  it("accepts a spreadsheet MIME type even without a usable extension", () => {
    expect(
      isMasterlistExcelFile(new File([], "download", { type: XLSX_MIME }))
    ).toBe(true);
    expect(isMasterlistExcelFile(new File([], "legacy", { type: XLS_MIME }))).toBe(true);
  });

  it("rejects non-Excel files so they keep the docx path", () => {
    expect(isMasterlistExcelFile(new File([], "masterlist.docx"))).toBe(false);
    expect(isMasterlistExcelFile(new File([], "masterlist.pdf"))).toBe(false);
    expect(isMasterlistExcelFile(new File([], "masterlist"))).toBe(false);
  });
});

describe("extractAndParseMasterlist (Excel path)", () => {
  it("parses the template layout with TRUE worksheet row numbers", async () => {
    const file = workbookFile(
      templateAoa([
        dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7"),
        dataRow("987654321098", "SANTOS, MARIA L.", "F", "02/22/2010", "8"),
      ]),
      "masterlist.xlsx"
    );

    const { parsed, text } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.skipped).toBe(0);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows[0]).toMatchObject({
      lrn: "123456789012",
      fullName: "Dela Cruz, Juan A.",
      sex: "Male",
      birthdate: "05/14/2009",
      gradeLevel: "Grade 7",
    });
    expect(parsed.rows[1].sex).toBe("Female");
    // Title rows 1–4 and the header row 5 precede the data: the first data
    // row lives on worksheet row 6, and error messages must say so.
    expect(parsed.rows[0].sheetRow).toBe(6);
    expect(parsed.rows[1].sheetRow).toBe(7);
    // The "SY: 2026-2027" title cell feeds the school-year lookup.
    expect(extractSchoolYear(text)).toBe("2026-2027");
  });

  it("reports invalid rows at their real worksheet row and keeps valid neighbours", async () => {
    const file = workbookFile(
      templateAoa([
        dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7"), // row 6
        dataRow("555555555555", "REYES, ANA B.", "X", "13/45/2011", "Grade 13"), // row 7 — invalid
        dataRow("222222222222", "CRUZ, KENNETH M.", "M", "07/07/2010", "9"), // row 8
      ]),
      "masterlist.xlsx"
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows.map((r) => r.lrn)).toEqual(["123456789012", "222222222222"]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.errors[0]).toContain("Row 7");
    expect(parsed.errors[0]).toContain("invalid Sex/Gender");
  });

  it("rejects a repeated LRN citing both real worksheet rows", async () => {
    const file = workbookFile(
      templateAoa([
        dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7"), // row 6
        dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7"), // row 7 — duplicate
      ]),
      "masterlist.xlsx"
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.errors[0]).toContain("Row 7");
    expect(parsed.errors[0]).toContain("already appears in Row 6");
  });

  it("reads a number-typed LRN cell exactly (no float drift)", async () => {
    const file = workbookFile(
      templateAoa([dataRow(123456789012, "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7")]),
      "masterlist.xlsx"
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lrn).toBe("123456789012");
  });

  it("keeps text-formatted LRN leading zeros", async () => {
    const file = workbookFile(
      templateAoa([dataRow("012345678901", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7")]),
      "masterlist.xlsx"
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lrn).toBe("012345678901");
  });

  it("converts Excel date-typed birthdate cells back to MM/DD/YYYY", async () => {
    // Excel converts "09/05/2009" typed into a General cell into a numeric
    // date serial carrying a date number format — simulate exactly that.
    const file = workbookFile(
      templateAoa([
        ["123456789012", "DELA CRUZ, JUAN A.", "M", "", "15", "", "7", "", "", ""],
      ]),
      "masterlist.xlsx",
      {
        decorate: (ws) => {
          ws[XLSX.utils.encode_cell({ r: 5, c: 3 })] = {
            t: "n",
            v: excelSerial(2009, 9, 5),
            z: "mm/dd/yyyy",
          };
        },
      }
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].birthdate).toBe("09/05/2009");
  });

  it("does not mistake plain numbers for dates (age/LRN stay digits)", async () => {
    const file = workbookFile(
      templateAoa([dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7")]),
      "masterlist.xlsx",
      {
        decorate: (ws) => {
          // A plain number with a thousands format is NOT a date.
          ws[XLSX.utils.encode_cell({ r: 5, c: 4 })] = { t: "n", v: 15, z: "#,##0" };
        },
      }
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lrn).toBe("123456789012");
  });

  it("parses a legacy .xls (BIFF8) workbook the same way", async () => {
    const file = workbookFile(
      templateAoa([dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7")]),
      "masterlist.xls",
      { bookType: "biff8", mime: XLS_MIME }
    );

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lrn).toBe("123456789012");
    expect(parsed.rows[0].sheetRow).toBe(6);
  });

  it("picks the sheet carrying the masterlist header in a multi-sheet workbook", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Random notes", "not a masterlist"]]), "Notes");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(templateAoa([dataRow("123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "7")])),
      "Masterlist"
    );
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const file = new File([bytes], "workbook.xlsx", { type: XLSX_MIME });

    const { parsed } = await extractAndParseMasterlist(file);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].lrn).toBe("123456789012");
  });

  it("rejects bytes that are not a workbook with a user-facing error", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "masterlist.xlsx", {
      type: XLSX_MIME,
    });

    await expect(extractAndParseMasterlist(file)).rejects.toThrow(
      /Could not read any worksheet/
    );
  });

  it("enforces the 5MB cap before touching the workbook", async () => {
    const oversized = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "masterlist.xlsx", {
      type: XLSX_MIME,
    });

    await expect(extractAndParseMasterlist(oversized)).rejects.toThrow(/larger than 5MB/);
  });
});

describe("parseMasterlistRows (true worksheet row numbers)", () => {
  it("numbers rows from firstRowNumber and skips blank worksheet rows in between", () => {
    const blank = Array.from({ length: 10 }, () => "");
    const rows: string[][] = [
      blank, // worksheet row 1 — blank, never counted
      ["STUDENT MASTER LIST", ...blank.slice(1)], // row 2 — title, dropped
      HEADERS, // row 3 — header
      ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "", "", "7", "", "", ""], // row 4
      blank, // row 5 — blank gap between data rows
      ["987654321098", "SANTOS, MARIA L.", "F", "02/22/2010", "", "", "8", "", "", ""], // row 6
    ];

    const result = parseMasterlistRows(rows, 1);

    expect(result.rows.map((r) => r.lrn)).toEqual(["123456789012", "987654321098"]);
    expect(result.rows[0].sheetRow).toBe(4);
    expect(result.rows[1].sheetRow).toBe(6);
  });
});

describe("buildMasterlistTemplateXlsx", () => {
  it("mirrors the docx template: title rows, headers, Text-format columns", async () => {
    const bytes = await buildMasterlistTemplateXlsx("2027-2028");
    const wb = XLSX.read(bytes, { type: "array", cellNF: true });
    const ws = wb.Sheets["Masterlist"];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });

    expect(aoa[0][0]).toBe("CAMARINES NORTE NATIONAL HIGH SCHOOL");
    expect(aoa[1][0]).toBe("SUPREME SECONDARY LEARNER GOVERNMENT AND YES-O ELECTIONS");
    expect(aoa[2][0]).toBe("STUDENT MASTER LIST");
    expect(aoa[3][0]).toBe("SY: 2027-2028");
    expect(aoa[4]).toEqual(HEADERS);

    // The first blank data row (worksheet row 6) — LRN (A) and Birthdate
    // (D) are Text-formatted so Excel preserves leading zeros and the
    // typed MM/DD/YYYY instead of converting cells.
    expect(ws["A6"]?.z).toBe("@");
    expect(ws["D6"]?.z).toBe("@");
    expect(ws["B6"]?.z).not.toBe("@"); // other columns keep their formats
    // Column widths are written to the file (Excel renders them); the
    // SheetJS reader does not restore !cols, so assert the raw sheet XML.
    const zip = await JSZip.loadAsync(bytes);
    const sheetXml = (await zip.file("xl/worksheets/sheet1.xml")?.async("string")) ?? "";
    expect(sheetXml.match(/<col /g)).toHaveLength(HEADERS.length);
    expect(sheetXml).toContain('<mergeCell ref="A1:J1"/>');
    expect(ws["!merges"]).toHaveLength(4); // one merge per title line
  });

  it("defaults the school year to the current election period format", async () => {
    const bytes = await buildMasterlistTemplateXlsx();
    const wb = XLSX.read(bytes, { type: "array" });
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Masterlist"], { header: 1, defval: "" });
    expect(aoa[3][0]).toBe("SY: 2026-2027");
  });

  it("round-trips through the uploader: fill a row into the template and upload it", async () => {
    const bytes = await buildMasterlistTemplateXlsx();
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets["Masterlist"];
    XLSX.utils.sheet_add_aoa(
      ws,
      [
        ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", 15, "DELA CRUZ, MARIA", "7", "STEM", "SAMPAGUITA", "MS. SANTOS"],
      ],
      { origin: "A6" }
    );
    const filled = XLSX.write(wb, { bookType: "xlsx", type: "array" });

    const { parsed, text } = await extractAndParseMasterlist(
      new File([filled], "filled.xlsx", { type: XLSX_MIME })
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows[0]).toMatchObject({
      lrn: "123456789012",
      fullName: "Dela Cruz, Juan A.",
      gradeLevel: "Grade 7",
      parentGuardian: "Dela Cruz, Maria",
      adviser: "Ms. Santos",
    });
    expect(parsed.rows[0].sheetRow).toBe(6);
    expect(extractSchoolYear(text)).toBe("2026-2027");
  });
});
