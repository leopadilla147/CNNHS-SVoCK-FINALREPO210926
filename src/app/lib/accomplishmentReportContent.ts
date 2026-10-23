/**
 * Single source of truth for the body of the LG-COMEA Accomplishment Report.
 *
 * The document used to be hardcoded twice: once in `reports.ts` for the
 * printable HTML and once in `docxAccomplishmentReport.ts` for the .docx
 * export — and the two copies had already drifted apart.  Everything the
 * Chief Commissioner can edit on the Reports page lives here so the on-page
 * editor, the print window and the .docx export always render the same text.
 *
 * The wording below is the printed (HTML) wording, which is the canonical one.
 */

export interface ReportSignatory {
  name: string;
  role: string;
}

/** A signatory block, e.g. "Prepared by:" with its list of signatories. */
export interface ReportSignatoryGroup {
  heading: string;
  signatories: ReportSignatory[];
}

/** The editable body of the Accomplishment Report. */
export interface AccomplishmentReportDraft {
  /** School year / election period label, e.g. "2026-2027". */
  periodLabel: string;
  /** Date and time of the activity, e.g. "February 11, 2026 7:30 AM". */
  dateTime: string;
  /** Place / venue / platform line. */
  venue: string;
  /** Bold lead line above the rationale, e.g. "Accomplishment Report of (COMEA) …". */
  rationaleLead: string;
  /** Rationale narrative, one entry per paragraph. */
  rationaleParagraphs: string[];
  /** Numbered objectives. */
  objectives: string[];
  /** Italic "Highlights" narrative, one entry per paragraph. */
  highlights: string[];
  /** Financial accomplishment / liquidation line (usually "NONE"). */
  financialLiquidation: string;
  /** Bulleted recommendations. */
  recommendations: string[];
  /** "Prepared by" / "Noted by" / "Approved by" blocks. */
  signatoryGroups: ReportSignatoryGroup[];
}

/** Live values used to seed a brand-new draft (from the current election). */
export interface AccomplishmentReportSeed {
  periodLabel?: string;
  dateTime?: string;
  venue?: string;
  /** Acting Chief Commissioner's name — printed on the "Approved by" line. */
  chiefName?: string;
  /**
   * { signatory role title -> officer name } resolved from the chief-gated
   * staff roster.  When present it replaces the bundled template names on the
   * matching default signatory lines (Electoral / Screening / Grievance /
   * Co-commissioner) so a fresh report starts with the acting officers.
   */
  officerNames?: Record<string, string>;
}

export const DEFAULT_PERIOD_LABEL = "2026-2027";
export const DEFAULT_EVENT_DATE_TIME = "February 11, 2026 7:30 AM";

/** School prefix and platform suffix of the default "Place / venue / platform" line. */
const VENUE_LINE_SCHOOL = "Camarines Norte National High School";
const VENUE_LINE_PLATFORM = "Using Student Vote Counting Kiosk (SVoCK)";

/**
 * Default "Place / venue / platform" line: the school plus the venue chosen in
 * Election Setup Stage 4, on the Student Vote Counting Kiosk (SVoCK) platform.
 * Without a venue it degrades to "Camarines Norte National High School Using
 * Student Vote Counting Kiosk (SVoCK)".
 */
export function defaultVenueLine(venue?: string): string {
  const place = venue?.trim();
  return [VENUE_LINE_SCHOOL, place, VENUE_LINE_PLATFORM].filter(Boolean).join(" ");
}

export const DEFAULT_EVENT_VENUE = defaultVenueLine();

/**
 * The LG-COMEA position/role titles offered in the signatory editor's
 * dropdown.  The chosen title is what gets saved and printed on the report.
 */
export const SIGNATORY_ROLE_OPTIONS = [
  "LG-COMEA Electoral Commissioner",
  "LG-COMEA Screening and Validation Commissioner",
  "LG-COMEA Grievance Commissioner",
  "LG-COMEA Appointed Commissioner",
  "School Head / LG-COMEA Chief Commissioner",
] as const;

/** Dropdown sentinel for a custom (or pre-existing template) role. */
export const SIGNATORY_ROLE_OTHER = "Others";

/**
 * Dropdown titles that map onto a system commissioner role (the 035
 * commissioner_role CHECK set).  The signatory editor uses this, together
 * with the chief-gated staff roster, to prefill a signatory's Name when a
 * commissioner title is chosen.  "LG-COMEA Appointed Commissioner" has no
 * system role (the 'appointment' role was retired in Phase 3 REMOVE-08), so
 * it never prefills — its Name stays fully manual.
 */
export const SIGNATORY_ROLE_SYSTEM_ROLES: Record<string, string> = {
  "LG-COMEA Electoral Commissioner": "electoral_board",
  "LG-COMEA Screening and Validation Commissioner": "screening_validation",
  "LG-COMEA Grievance Commissioner": "grievance",
  "School Head / LG-COMEA Chief Commissioner": "chief",
};

/** Minimal shape of a list_staff_roster_rpc row needed for name resolution. */
export interface StaffRosterEntry {
  full_name: string | null;
  role_type: string;
  commissioner_role: string | null;
  status: string;
}

/** Dropdown titles resolved from a CO-commissioner roster row (the role they co-serve). */
const SIGNATORY_ROLE_CO_ROLES: Record<string, string> = {
  "LG-COMEA Electoral Co-commissioner": "electoral_board",
};

/**
 * Build the { dropdown title -> full name } prefill map from the staff
 * roster.  Only ACTIVE staff count; the chief comes from role_type='chief',
 * each commissioner title from the PRIMARY commissioner
 * (role_type='commissioner') holding that commissioner_role, and the
 * co-commissioner title from an active co_commissioner of that role.
 */
export function resolveCommissionerNames(
  roster: StaffRosterEntry[]
): Record<string, string> {
  const chiefName = roster.find(
    (row) =>
      row.status === "active" && row.role_type === "chief" && row.full_name?.trim()
  )?.full_name?.trim();

  const primaryByRole = new Map<string, string>();
  const coByRole = new Map<string, string>();
  roster.forEach((row) => {
    if (row.status !== "active") return;
    const name = row.full_name?.trim();
    if (!name || !row.commissioner_role) return;
    if (row.role_type === "commissioner") {
      if (!primaryByRole.has(row.commissioner_role)) {
        primaryByRole.set(row.commissioner_role, name);
      }
    } else if (row.role_type === "co_commissioner") {
      if (!coByRole.has(row.commissioner_role)) {
        coByRole.set(row.commissioner_role, name);
      }
    }
  });

  const names: Record<string, string> = {};
  Object.entries(SIGNATORY_ROLE_SYSTEM_ROLES).forEach(([label, systemRole]) => {
    const name = systemRole === "chief" ? chiefName : primaryByRole.get(systemRole);
    if (name) names[label] = name;
  });
  Object.entries(SIGNATORY_ROLE_CO_ROLES).forEach(([label, systemRole]) => {
    const name = coByRole.get(systemRole);
    if (name) names[label] = name;
  });
  return names;
}

/**
 * Map a stored signatory role onto the dropdown: a known LG-COMEA title
 * selects that option; anything else (a custom entry, or one of the bundled
 * template roles such as "LG-COMEA Student Chairperson") selects "Others" and
 * keeps the stored text for the free-text input.
 */
export function resolveSignatoryRoleSelection(role: string): {
  option: string;
  customText: string;
} {
  const trimmed = role.trim();
  if ((SIGNATORY_ROLE_OPTIONS as readonly string[]).includes(trimmed)) {
    return { option: trimmed, customText: "" };
  }
  return { option: SIGNATORY_ROLE_OTHER, customText: role };
}
/** Bundled template signatory, used only when the chief cannot be resolved. */
export const DEFAULT_CHIEF_SIGNATORY = "FRANCISCO D. TORRERO, SSP-II";
export const DEFAULT_CHIEF_ROLE = "School Head / LG-COMEA Chief Commissioner";

/** The bundled COMEA signatories, with the live officers' names swapped in. */
function defaultSignatoryGroups(
  chiefName: string,
  officerNames?: Record<string, string>
): ReportSignatoryGroup[] {
  // A roster-resolved name wins over the bundled template name for the lines
  // that map onto a system officer; everything else keeps the bundled text.
  const name = (role: string, bundled: string): string =>
    officerNames?.[role]?.trim() || bundled;

  return [
    {
      heading: "Prepared by:",
      signatories: [
        { name: "MARIEL D. PAULAR", role: "LG-COMEA Student Chairperson" },
        { name: "MARIA ZAIRA L. RIVERA", role: "LG-COMEA Student Secretary" },
      ],
    },
    {
      heading: "Noted by:",
      signatories: [
        {
          name: name("LG-COMEA Electoral Commissioner", "MELISSA M. MELENDREZ"),
          role: "LG-COMEA Electoral Commissioner",
        },
        {
          name: name("LG-COMEA Screening and Validation Commissioner", "MA. LOURDES M. BALANE, HT-III"),
          role: "LG-COMEA Screening and Validation Commissioner",
        },
        {
          name: name("LG-COMEA Electoral Co-commissioner", "RAY DUOVANI N. REGONDOLA"),
          role: "LG-COMEA Electoral Co-commissioner",
        },
        {
          name: name("LG-COMEA Grievance Commissioner", "IVY DENICE M. ABOGADO, RGC"),
          role: "LG-COMEA Grievance Commissioner",
        },
        {
          name: name("LG-COMEA Appointed Commissioner", "WILSON ANGEL H. VILLARIN, ASP-II"),
          role: "LG-COMEA Appointed Commissioner",
        },
      ],
    },
    {
      heading: "Approved by:",
      signatories: [{ name: chiefName, role: DEFAULT_CHIEF_ROLE }],
    },
  ];
}

/**
 * The bundled COMEA template text, with the live election values plugged in
 * where the template interpolates them (school year, date, venue, chief).
 */
export function defaultAccomplishmentReportDraft(
  seed: AccomplishmentReportSeed = {}
): AccomplishmentReportDraft {
  const periodLabel = seed.periodLabel?.trim() || DEFAULT_PERIOD_LABEL;
  const chiefName = seed.chiefName?.trim() || DEFAULT_CHIEF_SIGNATORY;

  return {
    periodLabel,
    dateTime: seed.dateTime?.trim() || DEFAULT_EVENT_DATE_TIME,
    venue: seed.venue?.trim() || defaultVenueLine(),
    rationaleLead:
      "Accomplishment Report of (COMEA) Learners Government — Commission on Election and Appointment.",
    rationaleParagraphs: [
      `The conduct of the ${periodLabel} Student Election for the Supreme Secondary Learner Government (SSLG) aims to promote democratic participation and leadership among students of Camarines Norte National High School. Through this activity, students are given the opportunity to exercise their right to vote and select capable student leaders who will represent their interests and initiate programs that contribute to the improvement of the school community.`,
      "This election also encourages students to become responsible citizens by understanding the importance of leadership, accountability, and active involvement in school governance. The use of a digital voting platform through the CNNHS SVoCK Online Voting System ensures an organized, efficient, and transparent election process while promoting responsible use of technology among learners.",
      "Furthermore, the activity strengthens student engagement and cooperation in school organizations such as SSLG which play vital roles in implementing programs related to student welfare and environmental awareness. Through this election, the school ensures that student representation remains active, inclusive, and responsive to the needs of the learners.",
    ],
    objectives: [
      `To conduct a fair, honest, and organized election for the selection of Supreme Secondary Learner Government (SSLG) officers for School Year ${periodLabel}.`,
      "To encourage students to actively participate in school governance through responsible voting.",
      "To develop leadership, responsibility, and cooperation among students through participation in student organizations.",
      "To promote awareness of the importance of democratic processes and environmental responsibility in the school community.",
      "To utilize digital technology such as the CNNHS SVoCK Online Voting System to ensure a systematic and efficient election process.",
    ],
    highlights: [
      `The ${periodLabel} Student Election for SSLG was successfully conducted at Camarines Norte National High School using the CNNHS SVoCK Online Voting System as the official voting platform. Students from different grade levels in high school participated actively in the election, demonstrating enthusiasm and cooperation throughout the activity. The election process was organized and supervised by the adviser of the Organization and student officers of COMEA to ensure fairness and transparency. Students were oriented on the proper voting procedures before the activity started. The use of an online voting system made the process faster, more convenient, and well-organized, helping students understand the value of leadership, responsibility, and participation in school governance.`,
      "Even after facing challenges such as the limited designated area available for catering to voters, the officers and members of the organization showcased their ability to communicate clearly and implement a strategic scheduling system to accommodate all high school voters. The voting day was held successfully and every objective of the event was accomplished and fulfilled with great participation from the officers and members of the organization of COMEA. Overall, the activity was conducted smoothly and achieved its intended objectives.",
    ],
    financialLiquidation: "NONE",
    recommendations: [
      "It is recommended that future SSLG elections continue to utilize digital voting platforms such as the CNNHS SVoCK Online Voting System to ensure a faster, more organized, and transparent election process.",
      "It is recommended that the school provide a more reliable network connection and additional computer units or laptops during future student elections to improve the efficiency and accessibility of the digital voting process.",
      "It is also recommended that students be given prior orientation regarding the roles and responsibilities of SSLG officers to help them choose qualified and responsible leaders.",
      "The school may continue to strengthen student participation in future elections by encouraging active involvement across all grade levels.",
      "Continuous supervision and proper coordination among teachers, advisers, and student officers are also recommended to maintain the credibility and orderliness of the election process.",
    ],
    signatoryGroups: defaultSignatoryGroups(chiefName, seed.officerNames),
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === "string")) return null;
  return value as string[];
}

/**
 * Rebuild a draft from untrusted input (localStorage) on top of the bundled
 * defaults, so a stale/hand-edited stored value can never crash the editor.
 */
export function normalizeAccomplishmentReportDraft(
  value: unknown,
  seed: AccomplishmentReportSeed = {}
): AccomplishmentReportDraft {
  const fallback = defaultAccomplishmentReportDraft(seed);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<AccomplishmentReportDraft>;

  const groups = Array.isArray(raw.signatoryGroups)
    ? raw.signatoryGroups
        .filter((group) => group && typeof group === "object")
        .map((group) => ({
          heading: typeof group.heading === "string" ? group.heading : "",
          signatories: Array.isArray(group.signatories)
            ? group.signatories
                .filter((signatory) => signatory && typeof signatory === "object")
                .map((signatory) => ({
                  name: typeof signatory.name === "string" ? signatory.name : "",
                  role: typeof signatory.role === "string" ? signatory.role : "",
                }))
            : [],
        }))
    : null;

  return {
    periodLabel: asString(raw.periodLabel) ?? fallback.periodLabel,
    dateTime: asString(raw.dateTime) ?? fallback.dateTime,
    venue: asString(raw.venue) ?? fallback.venue,
    rationaleLead: asString(raw.rationaleLead) ?? fallback.rationaleLead,
    rationaleParagraphs: asStringArray(raw.rationaleParagraphs) ?? fallback.rationaleParagraphs,
    objectives: asStringArray(raw.objectives) ?? fallback.objectives,
    highlights: asStringArray(raw.highlights) ?? fallback.highlights,
    financialLiquidation: asString(raw.financialLiquidation) ?? fallback.financialLiquidation,
    recommendations: asStringArray(raw.recommendations) ?? fallback.recommendations,
    signatoryGroups: groups && groups.length > 0 ? groups : fallback.signatoryGroups,
  };
}
