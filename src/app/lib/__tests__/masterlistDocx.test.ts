import { describe, it, expect } from "vitest";
import {
  MASTERLIST_MAX_BYTES,
  buildHeaderIndex,
  buildHeaderIndexFromCells,
  toMasterlistRow,
  validateMasterlistRow,
  isValidCalendarDate,
  parseMasterlist,
  parseMasterlistRows,
  extractMasterlistText,
  extractAndParseMasterlist,
  isFullMasterlistMatch,
  partitionMasterlistMatches,
  describeSkippedLrn,
  splitFullName,
  toTitleCase,
  normalizeSex,
  normalizeGradeLevel,
  toIsoBirthdate,
  extractSchoolYear,
} from "../masterlistDocx";
import type { MasterlistRow } from "../masterlistDocx";

const HEADER =
  "LRN\tFULL NAME (LAST, FIRST, MIDDLE)\tSEX\tBIRTHDATE (MM/DD/YYYY)\tAGE AS OF\tPARENT/GUARDIAN\tGRADE LEVEL\tSTRAND/CLUSTER\tSECTION\tADVISER NAME";

describe("buildHeaderIndex", () => {
  it("maps header cells to canonical column positions", () => {
    const index = buildHeaderIndex(HEADER);
    expect(index).not.toBeNull();
    expect(index!.lrn).toBe(0);
    expect(index!.name).toBe(1);
    expect(index!.sex).toBe(2);
    expect(index!.birthdate).toBe(3);
    expect(index!.parent).toBe(5);
    expect(index!.grade).toBe(6);
    expect(index!.strand).toBe(7);
    expect(index!.section).toBe(8);
    expect(index!.adviser).toBe(9);
  });

  it("returns null for lines with no recognizable header", () => {
    expect(buildHeaderIndex("just some text")).toBeNull();
    expect(buildHeaderIndex("")).toBeNull();
  });
});

describe("toMasterlistRow", () => {
  it("maps template-position rows without an explicit header index", () => {
    const row = toMasterlistRow([
      "123456789012",
      "DELA CRUZ, JUAN A.",
      "M",
      "05/14/2009",
      "15",
      "DELA CRUZ, MARIA",
      "7",
      "STEM",
      "SAMPAGUITA",
      "MS. SANTOS",
    ]);
    expect(row).not.toBeNull();
    expect(row!.lrn).toBe("123456789012");
    // Names are Title Cased, strand/section keep their acronym casing.
    expect(row!.fullName).toBe("Dela Cruz, Juan A.");
    expect(row!.birthdate).toBe("05/14/2009");
    expect(row!.gradeSection).toBe("7 - SAMPAGUITA");
    expect(row!.strand).toBe("STEM");
    expect(row!.sex).toBe("Male");
    expect(row!.gradeLevel).toBe("Grade 7");
    expect(row!.section).toBe("SAMPAGUITA");
    expect(row!.parentGuardian).toBe("Dela Cruz, Maria");
    expect(row!.adviser).toBe("Ms. Santos");
  });

  it("rejects rows with an invalid LRN", () => {
    expect(
      toMasterlistRow(["12345", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "", "", "7", "", "SAMPAGUITA", ""])
    ).toBeNull();
  });

  it("rejects rows missing name or birthdate", () => {
    expect(
      toMasterlistRow(["123456789012", "", "M", "05/14/2009", "", "", "7", "", "SAMPAGUITA", ""])
    ).toBeNull();
    expect(
      toMasterlistRow(["123456789012", "DELA CRUZ, JUAN A.", "M", "", "", "", "7", "", "SAMPAGUITA", ""])
    ).toBeNull();
  });
});

describe("parseMasterlist", () => {
  it("parses tab-separated rows with a recognized header", () => {
    const text = [
      HEADER,
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
      "987654321098\tSANTOS, MARIA L.\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].lrn).toBe("123456789012");
    expect(result.rows[0].fullName).toBe("Dela Cruz, Juan A.");
    expect(result.rows[1].gradeSection).toBe("8 - ROSAL");
    expect(result.rows[1].strand).toBe("GAS");
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("silently skips rows with an empty LRN cell and keeps reading", () => {
    const text = [
      HEADER,
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
      // LRN cell empty even though other cells are filled — not read.
      "\tALVAREZ, PEDRO C.\tM\t06/06/2010\t14\tALVAREZ, ROSA\t8\tGAS\tROSAL\tMR. REYES",
      "987654321098\tSANTOS, MARIA L.\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("collects every invalid row and keeps the valid ones (partial import)", () => {
    const text = [
      HEADER,
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
      "987654321098\tSANTOS, MARIA L.\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
      "BAD-LRN\t\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
      "111111111111\tREYES, ANA B.\tF\t03/03/2011\t13\tREYES, LUIS\t9\tSTEM\tILANG\tMS. CRUZ",
    ].join("\n");

    const result = parseMasterlist(text);
    // The invalid row is rejected as a whole; the valid rows around it survive.
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.lrn)).toEqual(["123456789012", "987654321098", "111111111111"]);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Row 4");
    expect(result.errors[0]).toContain("invalid LRN");
    expect(result.errors[0]).toContain("not imported");
  });

  it("keeps the first occurrence of an LRN and rejects later copies as rows", () => {
    const text = [
      HEADER,
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lrn).toBe("123456789012");
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain("Row 3");
    expect(result.errors[0]).toContain("duplicate LRN 123456789012");
    expect(result.errors[0]).toContain("not imported");
  });

  it("reports a present-but-incomplete row (missing required details)", () => {
    const text = [
      HEADER,
      "123456789013\t\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain("Row 2");
    expect(result.errors[0]).toContain("missing Full Name");
  });

  it("drops title rows that sit inside the table above the header (never counted)", () => {
    // Filled sheets often carry the document title and school-year label as
    // merged rows INSIDE the table, above the real column headers.  They
    // carry no LRN, so they must be dropped — not counted, not reported as
    // "invalid LRN", and row numbering must still start at Row 2 for the
    // first data row.
    const title = ["STUDENT MASTER LIST", "", "", "", "", "", "", "", "", ""];
    const syLabel = ["SY: 2026-2027", "", "", "", "", "", "", "", "", ""];
    const header = ["LRN", "FULL NAME (LAST, FIRST, MIDDLE)", "SEX", "BIRTHDATE (MM/DD/YYYY)", "AGE", "PARENT", "GRADE LEVEL", "STRAND", "SECTION", "ADVISER"];
    const a = ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "15", "", "7", "STEM", "SAMPAGUITA", "MS. SANTOS"];
    const b = ["987654321098", "SANTOS, MARIA L.", "F", "02/22/2010", "14", "", "8", "GAS", "ROSAL", "MR. REYES"];

    const result = parseMasterlistRows([title, syLabel, header, a, b]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.lrn)).toEqual(["123456789012", "987654321098"]);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].sheetRow).toBe(2);
  });

  it("drops tab-formatted title lines in the text path too", () => {
    const text = [
      "STUDENT MASTER LIST\t\t\t",
      "SY: 2026-2027\t\t\t",
      HEADER,
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lrn).toBe("123456789012");
    expect(result.rows[0].sheetRow).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("counts a mixed sheet correctly: valid, invalid, duplicated and empty rows", () => {
    const text = [
      "STUDENT MASTER LIST",
      "SY: 2026-2027",
      HEADER, // header row (sheet row 1) is consumed, never counted
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS", // Row 2 valid
      "", // blank line between table rows
      "987654321098\tSANTOS, MARIA L.\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES", // Row 3 valid
      "555555555555\tREYES, ANA B.\tX\t13/45/2011\t13\tREYES, LUIS\tGrade 13\tSTEM\tILANG\tMS. CRUZ", // Row 4 invalid (3 bad columns, one row error)
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS", // Row 5 duplicate LRN
      "222222222222\tCRUZ, KENNETH M.\tM\t07/07/2010\t14\tCRUZ, ANNA\t9\tSTEM\tILANG\tMS. CRUZ", // Row 6 valid
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.lrn)).toEqual(["123456789012", "987654321098", "222222222222"]);
    expect(result.skipped).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Row 4");
    expect(result.errors[0]).toContain("invalid Sex/Gender");
    expect(result.errors[1]).toContain("Row 5");
    expect(result.errors[1]).toContain("duplicate LRN 123456789012");
    // Row numbering counts the header as row 1 — the first data row is Row 2.
    expect(result.rows[0].sheetRow).toBe(2);
  });

  it("handles newline-separated (multi-space) rows without a header index", () => {
    // Hand-built files may separate cells with multiple spaces and have no tabs
    const text = "123456789012  DELA CRUZ, JUAN A.  M  05/14/2009  15  DELA CRUZ, MARIA  7  STEM  SAMPAGUITA  MS. SANTOS";
    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lrn).toBe("123456789012");
  });
});

describe("extractMasterlistText", () => {
  it("rejects files over the 5MB cap with a user-facing message", async () => {
    const oversized = new File([new ArrayBuffer(MASTERLIST_MAX_BYTES + 1)], "oversized.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await expect(extractMasterlistText(oversized)).rejects.toThrow(
      "The masterlist file is larger than 5MB."
    );
  });
  it("silently ignores every unfilled template row (no LRN)", () => {
    const blank = [
      ["LRN", "FULL NAME (LAST, FIRST, MIDDLE)", "SEX", "BIRTHDATE (MM/DD/YYYY)", "AGE", "PARENT", "GRADE LEVEL", "STRAND", "SECTION", "ADVISER"],
      ...Array.from({ length: 3 }, () => ["", "", "", "", "", "", "", "", "", ""]),
    ];
    const result = parseMasterlistRows(blank);
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("keeps the first occurrence of an LRN and reports both row numbers", () => {
    const header = ["LRN", "FULL NAME (LAST, FIRST, MIDDLE)", "SEX", "BIRTHDATE (MM/DD/YYYY)", "AGE", "PARENT", "GRADE LEVEL", "STRAND", "SECTION", "ADVISER"];
    const rowA = ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "15", "", "7", "STEM", "SAMPAGUITA", "MS. SANTOS"];
    const rowB = ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "15", "", "7", "STEM", "SAMPAGUITA", "MS. SANTOS"];

    const result = parseMasterlistRows([header, rowA, rowB]);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Row 3");
    expect(result.errors[0]).toContain("duplicate LRN 123456789012");
    expect(result.errors[0]).toContain("Row 2");
  });

  it("allows distinct LRNs and re-uploads of the same LRN set", () => {
    const header = ["LRN", "FULL NAME (LAST, FIRST, MIDDLE)", "SEX", "BIRTHDATE (MM/DD/YYYY)", "AGE", "PARENT", "GRADE LEVEL", "STRAND", "SECTION", "ADVISER"];
    const a = ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "15", "", "7", "STEM", "SAMPAGUITA", "MS. SANTOS"];
    const b = ["987654321098", "SANTOS, MARIA L.", "F", "02/22/2010", "14", "", "8", "GAS", "ROSAL", "MR. REYES"];
    const result = parseMasterlistRows([header, a, b]);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects only the invalid row and keeps the valid prefix and suffix", () => {
    const header = ["LRN", "FULL NAME (LAST, FIRST, MIDDLE)", "SEX", "BIRTHDATE (MM/DD/YYYY)", "AGE", "PARENT", "GRADE LEVEL", "STRAND", "SECTION", "ADVISER"];
    const good = ["123456789012", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "15", "DELA CRUZ, MARIA", "7", "STEM", "SAMPAGUITA", "MS. SANTOS"];
    const good2 = ["987654321098", "SANTOS, MARIA L.", "F", "02/22/2010", "14", "SANTOS, PEDRO", "8", "GAS", "ROSAL", "MR. REYES"];
    const bad = ["555555555555", "REYES, ANA B.", "", "02/22/2010", "14", "SANTOS, PEDRO", "8", "GAS", "ROSAL", "MR. REYES"];

    const result = parseMasterlistRows([header, good, bad, good2]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.lrn)).toEqual(["123456789012", "987654321098"]);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Row 3");
    expect(result.errors[0]).toContain("missing Sex/Gender");
  });
});

describe("validateMasterlistRow (required-field rules)", () => {
  const ok = [
    "123456789012",
    "DELA CRUZ, JUAN A.",
    "M",
    "05/14/2009",
    "15",
    "DELA CRUZ, MARIA",
    "7",
    "STEM",
    "SAMPAGUITA",
    "MS. SANTOS",
  ];

  it("accepts a fully-formed row", () => {
    const result = validateMasterlistRow(ok);
    expect(result.kind).toBe("ok");
  });

  it("ignores a row with no LRN", () => {
    expect(validateMasterlistRow(["", "DELA CRUZ, JUAN A.", "M", "05/14/2009"]).kind).toBe("ignored");
  });

  it("flags an LRN cell that is present but not 12 digits", () => {
    for (const bad of ["1364001100", "ABCD12345678", "1364001100012"]) {
      const result = validateMasterlistRow([bad, ...ok.slice(1)]);
      expect(result.kind, `expected ${bad} to fail`).toBe("invalid");
      if (result.kind !== "invalid") continue;
      expect(result.problems.join(" ")).toContain("invalid LRN — must be exactly 12 digits, numbers only");
    }
  });

  it("does not treat a 12-digit number in another column as the LRN", () => {
    // LRN cell empty; a stray 12-digit run elsewhere must not rescue the row.
    const result = validateMasterlistRow(["", "DELA CRUZ, JUAN A.", "M", "05/14/2009", "15", "123456789012"]);
    expect(result.kind).toBe("ignored");
  });

  it("flags every missing required detail by name", () => {
    // LRN present; name, sex, birthdate, grade all blank.
    const result = validateMasterlistRow(["123456789012", "", "", "", "", "", "", "", "", ""]);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.join(" ")).toContain("missing Full Name");
    expect(result.problems.join(" ")).toContain("missing Sex/Gender");
    expect(result.problems.join(" ")).toContain("missing Birthdate");
    expect(result.problems.join(" ")).toContain("missing Grade Level");
  });

  it("rejects a Full Name that is not in LAST, FIRST format", () => {
    const result = validateMasterlistRow([...ok.slice(0, 1), "JUAN DELA CRUZ", ...ok.slice(2)]);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.join(" ")).toContain('invalid Full Name — use "Last Name, First Name, Middle Initial"');
  });

  it("rejects a multi-letter middle segment after the second comma", () => {
    // With two commas the third segment is explicitly the middle initial —
    // a multi-letter value there is still rejected.
    const result = validateMasterlistRow([...ok.slice(0, 1), "DELA CRUZ, JUAN, ANTHONY", ...ok.slice(2)]);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.join(" ")).toContain("middle name must be a single initial");
  });

  it("keeps a two-word first name whole (comma is the separator)", () => {
    // "JUAN CARLOS" between the commas is the whole first name — it must not
    // be read as first name + middle name.
    const result = validateMasterlistRow([...ok.slice(0, 1), "DELA CRUZ, JUAN CARLOS", ...ok.slice(2)]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.row.fullName).toBe("Dela Cruz, Juan Carlos");

    // The stated layout "Last name, Firstname, middle initial": the middle
    // initial is its own comma segment and the first name stays whole.
    const withInitial = validateMasterlistRow([
      ...ok.slice(0, 1),
      "DELA CRUZ, JUAN CARLOS, A.",
      ...ok.slice(2),
    ]);
    expect(withInitial.kind).toBe("ok");
    if (withInitial.kind !== "ok") return;
    expect(withInitial.row.fullName).toBe("Dela Cruz, Juan Carlos, A.");
  });

  it("accepts a middle initial written as its own comma segment", () => {
    const result = validateMasterlistRow([...ok.slice(0, 1), "DELA CRUZ, JUAN, A.", ...ok.slice(2)]);
    expect(result.kind).toBe("ok");
  });

  it("rejects an invalid Sex/Gender", () => {
    const result = validateMasterlistRow([...ok.slice(0, 2), "X", ...ok.slice(3)]);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.join(" ")).toContain("invalid Sex/Gender — use Male or Female");
  });

  it("rejects a malformed or impossible Birthdate", () => {
    for (const bad of ["2009-05-14", "13/45/2009", "02/30/2009", "5/4/2009"]) {
      const result = validateMasterlistRow([...ok.slice(0, 3), bad, ...ok.slice(4)]);
      expect(result.kind, `expected ${bad} to fail`).toBe("invalid");
      if (result.kind !== "invalid") continue;
      expect(result.problems.join(" ")).toContain("invalid Birthdate — use MM/DD/YYYY");
    }
  });

  it("rejects an out-of-range Grade Level", () => {
    const result = validateMasterlistRow([...ok.slice(0, 6), "Grade 13", ...ok.slice(7)]);
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.problems.join(" ")).toContain("invalid Grade Level — use Grade 7 to Grade 12");
  });

  it("accepts bare grades and M/F shorthand", () => {
    const result = validateMasterlistRow([...ok.slice(0, 2), "f", ...ok.slice(3, 6), "12", ...ok.slice(7)]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.row.sex).toBe("Female");
    expect(result.row.gradeLevel).toBe("Grade 12");
  });

  it("isValidCalendarDate accepts real dates and rejects impossible ones", () => {
    expect(isValidCalendarDate("02/29/2008")).toBe(true);
    expect(isValidCalendarDate("02/29/2009")).toBe(false);
    expect(isValidCalendarDate("12/31/2010")).toBe(true);
    expect(isValidCalendarDate("04/31/2010")).toBe(false);
  });
});

describe("extractAndParseMasterlist (structured docx table path)", () => {
  const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>STUDENT MASTER LIST</w:t></w:r></w:p>
    <w:p><w:r><w:t>SY: 2026-2027</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>LRN</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>FULL NAME (LAST NAME, FIRST NAME, MIDDLE NAME)</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>SEX (MALE OR FEMALE)</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>BIRTHDATE(MM/DD/YYYY)</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>AGE AS OF JUNE 8, 2026</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>FULL NAME OF PARENT/LEGAL GUARDIAN</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>GRADE LEVEL</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>STRAND/CLUSTER(IF SHS)</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>SECTION</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>ADVISER NAME</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>1) 123456789012</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>DELA CRUZ, JUAN A.</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>M</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>05/14/2009</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>15</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>DELA CRUZ, MARIA</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>SAMPAGUITA</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>MS. SANTOS</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>2) 987654321098</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>SANTOS, MARIA L.</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>F</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>02/22/2010</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>14</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>SANTOS, PEDRO</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>GAS</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>ROSAL</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>MR. REYES</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

  async function templateFile(): Promise<File> {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("word/document.xml", DOC_XML);
    const blob = await zip.generateAsync({ type: "blob" });
    return new File([blob], "masterlist.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  it("recovers rows from the real table layout, including the 1) LRN marker cell", async () => {
    const { parsed, text } = await extractAndParseMasterlist(await templateFile());
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows[0].lrn).toBe("123456789012");
    expect(parsed.rows[0].sex).toBe("Male");
    expect(parsed.rows[0].gradeLevel).toBe("Grade 7");
    expect(parsed.rows[0].section).toBe("SAMPAGUITA");
    expect(parsed.rows[0].fullName).toBe("Dela Cruz, Juan A.");
    expect(parsed.rows[0].parentGuardian).toBe("Dela Cruz, Maria");
    expect(parsed.rows[0].adviser).toBe("Ms. Santos");
    expect(parsed.rows[1].sex).toBe("Female");
    expect(parsed.rows[1].strand).toBe("GAS");
    expect(extractSchoolYear(text)).toBe("2026-2027");
  });
});

describe("isFullMasterlistMatch (D-10)", () => {
  const row = {
    lrn: "123456789012",
    fullName: "DELA CRUZ, JUAN A.",
    birthdate: "05/14/2009",
    gradeSection: "7 - SAMPAGUITA",
    strand: "STEM",
    sex: "Male",
    gradeLevel: "Grade 7",
    section: "SAMPAGUITA",
    parentGuardian: "DELA CRUZ, MARIA",
    adviser: "MS. SANTOS",
  };
  const student = {
    lrn: "123456789012",
    firstName: "Juan",
    lastName: "Dela Cruz",
    birthdate: "05/14/2009",
    gender: "Male",
    gradeLevel: "Grade 7",
  };

  it("matches on LRN + normalized full name + birthdate", () => {
    expect(isFullMasterlistMatch(row, student)).toBe(true);
  });

  it("matches the sheet's MM/DD/YYYY against the DB's ISO birthdate", () => {
    // The students table stores YYYY-MM-DD; a digit collapse would compare
    // "05142009" with "20090514" and reject every real match.
    expect(
      isFullMasterlistMatch(row, { ...student, birthdate: "2009-05-14" })
    ).toBe(true);
    expect(
      isFullMasterlistMatch(row, { ...student, birthdate: "2009-05-15" })
    ).toBe(false);
  });

  it("matches first-name-last order too", () => {
    expect(
      isFullMasterlistMatch({ ...row, fullName: "JUAN A. DELA CRUZ" }, student)
    ).toBe(true);
  });

  it("does not match on LRN mismatch", () => {
    expect(isFullMasterlistMatch({ ...row, lrn: "111111111111" }, student)).toBe(false);
  });

  it("does not match on birthdate mismatch with same LRN and name", () => {
    expect(isFullMasterlistMatch({ ...row, birthdate: "01/01/2000" }, student)).toBe(false);
  });

  it("does not match on name mismatch with same LRN and birthdate", () => {
    expect(
      isFullMasterlistMatch({ ...row, fullName: "SANTOS, MARIA L." }, student)
    ).toBe(false);
  });

  it("does not match on sex mismatch when both sides carry a value", () => {
    expect(
      isFullMasterlistMatch({ ...row, sex: "Female" }, { ...student, gender: "Male" })
    ).toBe(false);
    expect(
      isFullMasterlistMatch({ ...row, sex: "Male" }, { ...student, gender: "Male" })
    ).toBe(true);
  });

  it("ignores sex when the masterlist cell is blank", () => {
    expect(isFullMasterlistMatch({ ...row, sex: "" }, { ...student, gender: "Female" })).toBe(true);
  });

  it("does not match on grade level mismatch when both sides carry a value", () => {
    expect(
      isFullMasterlistMatch(
        { ...row, gradeLevel: "Grade 8" },
        { ...student, gradeLevel: "Grade 7" }
      )
    ).toBe(false);
    expect(
      isFullMasterlistMatch(
        { ...row, gradeLevel: "Grade 7" },
        { ...student, gradeLevel: "Grade 7" }
      )
    ).toBe(true);
  });
});

describe("splitFullName", () => {
  it("splits the template's LAST, FIRST MIDDLE form and Title Cases it", () => {
    expect(splitFullName("DELA CRUZ, JUAN A.")).toEqual({
      lastName: "Dela Cruz",
      firstName: "Juan",
      middleName: "A.",
    });
  });

  it("keeps a two-word first name whole between the commas", () => {
    expect(splitFullName("DELA CRUZ, JUAN CARLOS")).toEqual({
      lastName: "Dela Cruz",
      firstName: "Juan Carlos",
      middleName: "",
    });
    expect(splitFullName("DELA CRUZ, MARIA GRACE, A.")).toEqual({
      lastName: "Dela Cruz",
      firstName: "Maria Grace",
      middleName: "A.",
    });
  });

  it("reads the middle initial from its own comma segment (no comma glued to the first name)", () => {
    expect(splitFullName("DELA CRUZ, JUAN, A.")).toEqual({
      lastName: "Dela Cruz",
      firstName: "Juan",
      middleName: "A.",
    });
  });

  it("handles a comma-less name with a token fallback", () => {
    expect(splitFullName("JUAN A. DELA CRUZ")).toEqual({
      firstName: "Juan",
      middleName: "A. Dela",
      lastName: "Cruz",
    });
  });

  it("handles a single-token name", () => {
    expect(splitFullName("MARIANO")).toEqual({
      lastName: "Mariano",
      firstName: "",
      middleName: "",
    });
  });
});

describe("partitionMasterlistMatches (upload flow)", () => {
  const row = (lrn: string, extra: Partial<MasterlistRow> = {}): MasterlistRow => ({
    lrn,
    fullName: "Dela Cruz, Juan A.",
    birthdate: "05/14/2009",
    gradeSection: "7 - SAMPAGUITA",
    strand: "STEM",
    sex: "Male",
    gradeLevel: "Grade 7",
    section: "SAMPAGUITA",
    parentGuardian: "",
    adviser: "",
    ...extra,
  });
  const student = (id: string, lrn: string, status: string) => ({
    id,
    lrn,
    firstName: "Juan",
    lastName: "Dela Cruz",
    birthdate: "05/14/2009",
    gender: "Male",
    gradeLevel: "Grade 7",
    status,
  });

  it("routes pending matches to approval and approved ones to the stamp list", () => {
    const result = partitionMasterlistMatches(
      [row("111111111111"), row("222222222222")],
      [student("s1", "111111111111", "pending"), student("s2", "222222222222", "approved")]
    );
    expect(result.pendingIds).toEqual(["s1"]);
    expect(result.alreadyApprovedIds).toEqual(["s2"]);
    expect(result.forReview).toBe(0);
    expect(result.awaiting).toBe(0);
    expect(result.alreadyRejected).toBe(0);
  });

  it("counts unregistered rows as awaiting and mismatches as review", () => {
    const result = partitionMasterlistMatches(
      [row("111111111111"), row("222222222222"), row("333333333333", { fullName: "Santos, Maria L." })],
      [student("s2", "222222222222", "pending"), student("s3", "333333333333", "pending")]
    );
    expect(result.awaiting).toBe(1);
    expect(result.pendingIds).toEqual(["s2"]);
    expect(result.forReview).toBe(1);
  });

  it("never overturns an explicit rejection", () => {
    const result = partitionMasterlistMatches(
      [row("111111111111")],
      [student("s1", "111111111111", "rejected")]
    );
    expect(result.pendingIds).toEqual([]);
    expect(result.alreadyApprovedIds).toEqual([]);
    expect(result.alreadyRejected).toBe(1);
  });

  it("does not auto-approve when a required detail differs", () => {
    const result = partitionMasterlistMatches(
      [row("111111111111", { sex: "Female" })],
      [student("s1", "111111111111", "pending")]
    );
    expect(result.pendingIds).toEqual([]);
    expect(result.forReview).toBe(1);
  });
});

describe("describeSkippedLrn (partial import skips)", () => {
  const row = (lrn: string, sheetRow: number): MasterlistRow => ({
    lrn,
    fullName: "Dela Cruz, Juan A.",
    birthdate: "05/14/2009",
    gradeSection: "7 - SAMPAGUITA",
    strand: "STEM",
    sex: "Male",
    gradeLevel: "Grade 7",
    section: "SAMPAGUITA",
    parentGuardian: "",
    adviser: "",
    sheetRow,
  });

  it("words a registered LRN as skipped, not re-uploaded", () => {
    expect(
      describeSkippedLrn(row("123456789012", 5), { reason: "registered", detail: "approved" })
    ).toBe(
      "Row 5: LRN 123456789012 already registered (approved account) — skipped, not re-uploaded."
    );
  });

  it("words a masterlist LRN as skipped, not re-uploaded", () => {
    expect(
      describeSkippedLrn(row("987654321098", 7), { reason: "listed", detail: "enrolled" })
    ).toBe(
      "Row 7: LRN 987654321098 already on the Student Masterlist (awaiting registration) — skipped, not re-uploaded."
    );
  });
});

describe("toTitleCase", () => {
  it("capitalises only the first letter of each name part", () => {
    expect(toTitleCase("PADILLA, LEONARD")).toBe("Padilla, Leonard");
    expect(toTitleCase("leonard padilla")).toBe("Leonard Padilla");
    expect(toTitleCase("DELA CRUZ, JUAN A.")).toBe("Dela Cruz, Juan A.");
  });

  it("keeps hyphenated and apostrophised parts capitalised", () => {
    expect(toTitleCase("MARIA-CLARA")).toBe("Maria-Clara");
    expect(toTitleCase("O'BRIEN")).toBe("O'Brien");
    expect(toTitleCase("MC DONALD")).toBe("Mc Donald");
  });

  it("normalises stray casing and leaves short values alone", () => {
    expect(toTitleCase("dELA cRUZ")).toBe("Dela Cruz");
    expect(toTitleCase("a.")).toBe("A.");
    expect(toTitleCase("")).toBe("");
  });
});

describe("normalizeSex / normalizeGradeLevel / toIsoBirthdate / extractSchoolYear", () => {
  it("normalizes sex values", () => {
    expect(normalizeSex("M")).toBe("Male");
    expect(normalizeSex("MALE")).toBe("Male");
    expect(normalizeSex("female")).toBe("Female");
    expect(normalizeSex("F")).toBe("Female");
    expect(normalizeSex("")).toBe("");
    expect(normalizeSex("x")).toBe("");
  });

  it("normalizes grade levels to the DB CHECK shape", () => {
    expect(normalizeGradeLevel("7")).toBe("Grade 7");
    expect(normalizeGradeLevel("grade 11")).toBe("Grade 11");
    expect(normalizeGradeLevel("GRADE 12")).toBe("Grade 12");
    expect(normalizeGradeLevel("")).toBe("");
  });

  it("converts template birthdates to ISO", () => {
    expect(toIsoBirthdate("05/14/2009")).toBe("2009-05-14");
    expect(toIsoBirthdate("2009-05-14")).toBe("2009-05-14");
    expect(toIsoBirthdate("unknown")).toBe("unknown");
  });

  it("extracts the SY header label", () => {
    expect(extractSchoolYear("STUDENT MASTER LIST\nSY: 2026-2027")).toBe("2026-2027");
    expect(extractSchoolYear("S.Y. 2026 – 2027")).toBe("2026-2027");
    expect(extractSchoolYear("no year here")).toBe("");
  });
});