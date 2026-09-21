import { describe, it, expect } from "vitest";
import {
  MASTERLIST_MAX_BYTES,
  buildHeaderIndex,
  toMasterlistRow,
  parseMasterlist,
  extractMasterlistText,
  isFullMasterlistMatch,
} from "../masterlistDocx";

const HEADER =
  "LRN\tFULL NAME (LAST, FIRST, MIDDLE)\tSEX\tBIRTHDATE (MM/DD/YYYY)\tAGE AS OF\tPARENT/GUARDIAN\tGRADE LEVEL\tSTRAND/CLUSTER\tSECTION\tADVISER NAME";

describe("buildHeaderIndex", () => {
  it("maps header cells to canonical column positions", () => {
    const index = buildHeaderIndex(HEADER);
    expect(index).not.toBeNull();
    expect(index!.lrn).toBe(0);
    expect(index!.name).toBe(1);
    expect(index!.birthdate).toBe(3);
    expect(index!.grade).toBe(6);
    expect(index!.strand).toBe(7);
    expect(index!.section).toBe(8);
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
    expect(row!.fullName).toBe("DELA CRUZ, JUAN A.");
    expect(row!.birthdate).toBe("05/14/2009");
    expect(row!.gradeSection).toBe("7 - SAMPAGUITA");
    expect(row!.strand).toBe("STEM");
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
      "Malformed line without tabs breaks into cells",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.errors.length).toBe(result.skipped);
    expect(result.rows[0].lrn).toBe("123456789012");
    expect(result.rows[0].fullName).toBe("DELA CRUZ, JUAN A.");
    expect(result.rows[1].gradeSection).toBe("8 - ROSAL");
    expect(result.rows[1].strand).toBe("GAS");
  });

  it("skips malformed rows and reports per-row errors", () => {
    const text = [
      HEADER,
      "123456789012\tDELA CRUZ, JUAN A.\tM\t05/14/2009\t15\tDELA CRUZ, MARIA\t7\tSTEM\tSAMPAGUITA\tMS. SANTOS",
      "BAD-LRN\tSANTOS, MARIA L.\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
      "123456789013\t\tF\t02/22/2010\t14\tSANTOS, PEDRO\t8\tGAS\tROSAL\tMR. REYES",
    ].join("\n");

    const result = parseMasterlist(text);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(2);
    expect(result.errors[0]).toContain("Row 3");
    expect(result.errors[1]).toContain("Row 4");
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
});

describe("isFullMasterlistMatch (D-10)", () => {
  const row = {
    lrn: "123456789012",
    fullName: "DELA CRUZ, JUAN A.",
    birthdate: "05/14/2009",
    gradeSection: "7 - SAMPAGUITA",
    strand: "STEM",
  };
  const student = {
    lrn: "123456789012",
    firstName: "Juan",
    lastName: "Dela Cruz",
    birthdate: "05/14/2009",
  };

  it("matches on LRN + normalized full name + birthdate", () => {
    expect(isFullMasterlistMatch(row, student)).toBe(true);
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
});