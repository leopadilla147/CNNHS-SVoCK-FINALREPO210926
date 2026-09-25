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
} from "docx";
import type { Candidate } from "../context/AppContext";
import type { ChiefElectionResultRow } from "./reports";

export interface AccomplishmentReportDocxInput {
  periodLabel: string;
  dateTime?: string;
  venue?: string;
  totals: {
    totalVoters: number;
    voted: number;
    notVoted: number;
    turnoutPct: number;
  };
  approvedCandidates: Candidate[];
  results: ChiefElectionResultRow[];
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
 * Builds the official DepEd COMEA Accomplishment Report (.docx) Document,
 * faithfully mirroring:
 * "Based Documents/LG-COMEA_ACCOMPLISHMENT-REPORT.SSLG-AND-YES-O-26-27.docx"
 */
export function buildAccomplishmentReportDocx(input: AccomplishmentReportDocxInput): Document {
  const { periodLabel, dateTime, venue, totals, approvedCandidates, results } = input;
  const eventDateTime = dateTime || "February 11, 2026 7:30 AM";
  const eventVenue =
    venue ||
    "Camarines Norte National High School at the School's Computer Laboratory using the CNNHS SVoCK Online Voting System";

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
                  children: [
                    new TextRun({
                      text: "Accomplishment Report of (COMEA) Learners Government — Commission on Election and Appointment.",
                      bold: true,
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 100 },
                  alignment: AlignmentType.JUSTIFIED,
                  children: [
                    new TextRun(
                      `The conduct of the ${periodLabel} Student Election for the Supreme Secondary Learner Government (SSLG) aims to promote democratic participation and leadership among students of Camarines Norte National High School. Through this activity, students are given the opportunity to exercise their right to vote and select capable student leaders who will represent their interests and initiate programs that contribute to the improvement of the school community.`
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 100 },
                  alignment: AlignmentType.JUSTIFIED,
                  children: [
                    new TextRun(
                      "This election also encourages students to become responsible citizens by understanding the importance of leadership, accountability, and active involvement in school governance. The use of a digital voting platform through the CNNHS SVoCK Online Voting System ensures an organized, efficient, and transparent election process while promoting responsible use of technology among learners."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 120 },
                  alignment: AlignmentType.JUSTIFIED,
                  children: [
                    new TextRun(
                      "Furthermore, the activity strengthens student engagement and cooperation in school organizations such as SSLG which play vital roles in implementing programs related to student welfare and environmental awareness. Through this election, the school ensures that student representation remains active, inclusive, and responsive to the needs of the learners."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 80, after: 60 },
                  children: [new TextRun({ text: "2. Objectives", bold: true })],
                }),
                new Paragraph({
                  spacing: { after: 60 },
                  children: [
                    new TextRun(
                      `a. To conduct a fair, honest, and organized election for the selection of Supreme Secondary Learner Government (SSLG) officers for School Year ${periodLabel}.`
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 60 },
                  children: [
                    new TextRun(
                      "b. To encourage students to actively participate in school governance through responsible voting."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 60 },
                  children: [
                    new TextRun(
                      "c. To develop leadership, responsibility, and cooperation among students through participation in student organizations."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 60 },
                  children: [
                    new TextRun(
                      "d. To promote awareness of the importance of democratic processes and environmental responsibility in the school community."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 120 },
                  children: [
                    new TextRun(
                      "e. To utilize digital technology such as the CNNHS SVoCK Online Voting System to ensure a systematic and efficient election process."
                    ),
                  ],
                }),
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
                new Paragraph({
                  alignment: AlignmentType.JUSTIFIED,
                  spacing: { after: 80 },
                  children: [
                    new TextRun({
                      italics: true,
                      text: `The ${periodLabel} Student Election for SSLG was successfully conducted at the Computer Laboratory of Camarines Norte National High School using the CNNHS SVoCK Online Voting System as the official voting platform. Students from different grade levels in high school participated actively in the election, demonstrating enthusiasm and cooperation throughout the activity. The election process was organized and supervised by the adviser of the Organization and student officers of COMEA to ensure fairness and transparency. Students were oriented on the proper voting procedures before the activity started. The use of an online voting system made the process faster, more convenient, and well-organized, helping students understand the value of leadership, responsibility, and participation in school governance. It also strengthened students' awareness of the importance of choosing responsible leaders who will serve the school community.`,
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.JUSTIFIED,
                  spacing: { after: 100 },
                  children: [
                    new TextRun({
                      italics: true,
                      text: `Even after facing some challenges such as the limited designated area available for catering to voters, the officers and members of the organization showcased their ability to communicate clearly and implement a strategic scheduling system to accommodate all high school voters. The voting day was held successfully and every objective of the event was fulfilled with active participation from the officers and members of the COMEA organization. Overall, the activity was conducted smoothly and achieved its intended objectives.`,
                    }),
                  ],
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
                  children: [
                    new TextRun({
                      text: "Financial Accomplishment/Liquidation Report (if any)",
                      bold: true,
                    }),
                  ],
                  spacing: { after: 40 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: "NONE", bold: true })],
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
                new Paragraph({
                  spacing: { after: 40 },
                  children: [
                    new TextRun(
                      "• It is recommended that future SSLG elections continue to utilize digital voting platforms such as the CNNHS SVoCK Online Voting System to ensure a faster, more organized, and transparent election process."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 40 },
                  children: [
                    new TextRun(
                      "• It is recommended that the school provide a reliable network connection and additional computer terminals during future student elections to improve the efficiency and accessibility of the voting process."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 40 },
                  children: [
                    new TextRun(
                      "• It is also recommended that students be given prior orientation regarding the roles and responsibilities of SSLG officers to help them choose qualified and responsible leaders."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 40 },
                  children: [
                    new TextRun(
                      "• The school may continue to strengthen student participation in future elections by encouraging active involvement across all grade levels."
                    ),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 60 },
                  children: [
                    new TextRun(
                      "• Continuous supervision and coordination among teachers, advisers, and student officers are recommended to maintain the credibility and orderliness of the electoral process."
                    ),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  // Participation Summary / Highlights Table
  children.push(
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: "Election Summary / Highlights", bold: true })],
    })
  );

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Metric", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Value", bold: true })],
                }),
              ],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: "Approved Candidates" })] }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, text: String(approvedCandidates.length) })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: "Registered Voters" })] }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, text: String(totals.totalVoters) })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: "Already Voted" })] }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, text: String(totals.voted) })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: "Not Yet Voted" })] }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, text: String(totals.notVoted) })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: "Voter Turnout" })] }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, text: `${totals.turnoutPct}%` })],
            }),
          ],
        }),
      ],
    })
  );

  // Election Results Table
  children.push(
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [
        new TextRun({
          text: "The Result of the Election and Elected Candidates for Supreme Secondary Learners Government (SSLG) Election",
          bold: true,
        }),
      ],
    })
  );

  const resultRows = results.map(
    (r) =>
      new TableRow({
        children: [
          new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: r.position })] }),
          new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: r.winnerName })] }),
          new TableCell({ borders: BORDER_SINGLE, children: [new Paragraph({ text: r.party })] }),
          new TableCell({
            borders: BORDER_SINGLE,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, text: r.gradeLevel })],
          }),
          new TableCell({
            borders: BORDER_SINGLE,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, text: String(r.votes) })],
          }),
        ],
      })
  );

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Position", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Name of Winner", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [new Paragraph({ children: [new TextRun({ text: "Party", bold: true })] })],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Grade", bold: true })],
                }),
              ],
            }),
            new TableCell({
              borders: BORDER_SINGLE,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Total Votes", bold: true })],
                }),
              ],
            }),
          ],
        }),
        ...(resultRows.length > 0
          ? resultRows
          : [
              new TableRow({
                children: [
                  new TableCell({
                    borders: BORDER_SINGLE,
                    columnSpan: 5,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        text: "No results to report",
                      }),
                    ],
                  }),
                ],
              }),
            ]),
      ],
    })
  );

  // Official Signatories
  children.push(new Paragraph({ spacing: { before: 240, after: 120 } }));

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Prepared by:", bold: true })],
      spacing: { after: 120 },
    })
  );

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_NONE,
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  children: [new TextRun({ text: "MARIEL D. PAULAR", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Student Chairperson", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
            new TableCell({
              borders: BORDER_NONE,
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  children: [new TextRun({ text: "MARIA ZAIRA L. RIVERA", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Student Secretary", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Noted by:", bold: true })],
      spacing: { before: 200, after: 120 },
    })
  );

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_NONE,
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  children: [new TextRun({ text: "MELISSA M. MELENDREZ", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Electoral Commissioner", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
            new TableCell({
              borders: BORDER_NONE,
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  children: [new TextRun({ text: "MA. LOURDES M. BALANE, HT-III", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Screening and Validation Commissioner", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_NONE,
              children: [
                new Paragraph({
                  text: "____________________________________",
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 180 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: "RAY DUOVANI N. REGONDOLA", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Electoral Co-commissioner", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
            new TableCell({
              borders: BORDER_NONE,
              children: [
                new Paragraph({
                  text: "____________________________________",
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 180 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: "IVY DENICE M. ABOGADO, RGC", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Grievance Commissioner", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_NONE,
              columnSpan: 2,
              children: [
                new Paragraph({
                  text: "____________________________________",
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 180 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: "WILSON ANGEL H. VILLARIN, ASP-II", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "LG-COMEA Appointed Commissioner", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Approved by:", bold: true })],
      spacing: { before: 200, after: 120 },
    })
  );

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: BORDER_NONE,
              children: [
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  children: [new TextRun({ text: "FRANCISCO D. TORRERO, SSP-II", bold: true })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: "School Head / LG-COMEA Chief Commissioner", italics: true })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

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
