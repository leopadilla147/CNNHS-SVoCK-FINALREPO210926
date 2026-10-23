import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle,
  ImageRun,
} from "docx";
import {
  defaultAccomplishmentReportDraft,
  type AccomplishmentReportDraft,
  type ReportSignatoryGroup,
} from "./accomplishmentReportContent";

export interface AccomplishmentReportDocxInput {
  periodLabel: string;
  dateTime?: string;
  venue?: string;
  /**
   * The acting Chief Commissioner's name (adminprofiles.full_name) for the
   * "Approved by" signatory line.  Optional — when absent the bundled
   * template name is printed, which is only a fallback after 068 renamed
   * every officer account.
   */
  chiefName?: string;
  /**
   * Session-only photo documentation attached by the Chief.  `data` holds the
   * raw image bytes (Word embeds bytes, not URLs).
   */
  documentationImages?: AccomplishmentReportImage[];
  /**
   * The editable document body built by the Reports page editor.  When it is
   * omitted the bundled COMEA template text is used, seeded with the
   * period/date/venue/chief values above.
   */
  draft?: AccomplishmentReportDraft;
}

export interface AccomplishmentReportImage {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  /** Already-fitted render size in points. */
  width: number;
  height: number;
  caption?: string;
}

const BORDER_SINGLE = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
};

const BORDER_NONE = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

/**
 * Lay a signatory block out two per row (a lone signatory spans the row),
 * mirroring the bundled COMEA template.
 */
function signatoryRows(group: ReportSignatoryGroup): TableRow[] {
  const rows: TableRow[] = [];

  for (let i = 0; i < group.signatories.length; i += 2) {
    const pair = group.signatories.slice(i, i + 2);
    const isContinuation = rows.length > 0;

    rows.push(
      new TableRow({
        children: pair.map((signatory) =>
          new TableCell({
            borders: BORDER_NONE,
            ...(pair.length === 1
              ? { columnSpan: 2 }
              : { width: { size: 50, type: WidthType.PERCENTAGE } }),
            children: [
              new Paragraph({
                text: "____________________________________",
                alignment: AlignmentType.CENTER,
                ...(isContinuation ? { spacing: { before: 180 } } : {}),
              }),
              new Paragraph({
                children: [new TextRun({ text: signatory.name, bold: true })],
                alignment: AlignmentType.CENTER,
              }),
              new Paragraph({
                children: [new TextRun({ text: signatory.role, italics: true })],
                alignment: AlignmentType.CENTER,
              }),
            ],
          })
        ),
      })
    );
  }

  return rows;
}

/**
 * Builds the official DepEd COMEA Accomplishment Report (.docx) Document,
 * faithfully mirroring:
 * "Based Documents/LG-COMEA_ACCOMPLISHMENT-REPORT.SSLG-AND-YES-O-26-27.docx"
 */
export function buildAccomplishmentReportDocx(input: AccomplishmentReportDocxInput): Document {
  const {
    periodLabel: inputPeriodLabel,
    dateTime,
    venue,
    chiefName,
    documentationImages = [],
    draft: suppliedDraft,
  } = input;

  // Everything the Chief can edit lives in the draft; without one we fall back
  // to the bundled COMEA template text (keeps the two outputs in lockstep).
  const draft = suppliedDraft ?? defaultAccomplishmentReportDraft({
    periodLabel: inputPeriodLabel,
    dateTime,
    venue,
    chiefName,
  });

  const periodLabel = draft.periodLabel || inputPeriodLabel;
  const eventDateTime = draft.dateTime;
  const eventVenue = draft.venue;

  const children: (Paragraph | Table)[] = [];

  // Top Table: Region / Division / School & Details
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              width: { size: 33, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: "Region", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              width: { size: 33, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: "Division", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              width: { size: 34, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: "School", bold: true })] })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ text: "Region V-Bicol" })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ text: "SDO-Camarines Norte" })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ text: "Camarines Norte National High School" })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Title of the Activity", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Date/Time", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Place/Venue/Platform", bold: true })] })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  text: `${periodLabel} Student Election for SSLG (Supreme Secondary Learner Government)`,
                }),
              ],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ text: eventDateTime })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ text: eventVenue })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              columnSpan: 3,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120, after: 80 },
                  children: [
                    new TextRun({
                      text: "DETAILS OF THE ACTIVITY",
                      bold: true,
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 120 },
                  children: [
                    new TextRun({
                      text: "(Rationale & Objectives)",
                      bold: true,
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 80, after: 60 },
                  children: [new TextRun({ text: "1. Rationale", bold: true })],
                }),
                new Paragraph({
                  spacing: { after: 80 },
                  children: [new TextRun({ text: draft.rationaleLead, bold: true })],
                }),
                ...draft.rationaleParagraphs.map(
                  (text) =>
                    new Paragraph({
                      spacing: { after: 100 },
                      alignment: AlignmentType.JUSTIFIED,
                      children: [new TextRun(text)],
                    })
                ),
                new Paragraph({
                  spacing: { before: 80, after: 60 },
                  children: [new TextRun({ text: "2. Objectives", bold: true })],
                }),
                ...draft.objectives.map(
                  (text, index) =>
                    new Paragraph({
                      spacing: { after: 60 },
                      children: [new TextRun(`${String.fromCharCode(97 + index)}. ${text}`)],
                    })
                ),
              ],
            }),
          ],
        }),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { before: 180, after: 80 } }));

  // Highlights Section
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: "Highlights", bold: true })],
                  spacing: { after: 80 },
                }),
                ...draft.highlights.map(
                  (text, index) =>
                    new Paragraph({
                      alignment: AlignmentType.JUSTIFIED,
                      spacing: { after: index === draft.highlights.length - 1 ? 100 : 80 },
                      children: [new TextRun({ italics: true, text })],
                    })
                ),
              ],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "Financial Accomplishment/Liquidation Report (if any)",
                      bold: true,
                    }),
                  ],
                  spacing: { after: 40 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: draft.financialLiquidation, bold: true })],
                  spacing: { after: 60 },
                }),
              ],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: "Recommendation/s:", bold: true })],
                  spacing: { after: 60 },
                }),
                ...draft.recommendations.map(
                  (text, index) =>
                    new Paragraph({
                      spacing: { after: index === draft.recommendations.length - 1 ? 60 : 40 },
                      children: [new TextRun(`• ${text}`)],
                    })
                ),
              ],
            }),
          ],
        }),
      ],
    })
  );

  // Official Signatories ("Prepared by" / "Noted by" / "Approved by" …), driven
  // by the editable draft so the .docx always matches the printed report.
  children.push(new Paragraph({ spacing: { before: 240, after: 120 } }));

  draft.signatoryGroups.forEach((group, groupIndex) => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: group.heading, bold: true })],
        spacing: { before: groupIndex === 0 ? 0 : 200, after: 120 },
      })
    );

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: signatoryRows(group),
      })
    );
  });
  // Photo Documentation (v1.3, Chief's request): the "Election Summary /
  // Highlights" and winners tables were removed from the document. The photos
  // the Chief attached for this session are rendered as the final section,
  // below the COMEA signatories ("Prepared by / Noted by / Approved by").
  if (documentationImages.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 320, after: 120 },
        children: [new TextRun({ text: "Documentation", bold: true })],
      })
    );

    documentationImages.forEach((image) => {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 40 },
          children: [
            new ImageRun({
              type: image.type,
              data: image.data,
              transformation: { width: image.width, height: image.height },
            }),
          ],
        })
      );
      if (image.caption) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({ text: image.caption, italics: true, size: 18 })],
          })
        );
      }
    });
  }

  return new Document({
    sections: [{ children }],
  });
}

/** Pack the Accomplishment Report as a .docx file and trigger browser download. */
export async function saveAccomplishmentReportDocx(
  input: AccomplishmentReportDocxInput,
  filename: string
): Promise<void> {
  const doc = buildAccomplishmentReportDocx(input);
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
