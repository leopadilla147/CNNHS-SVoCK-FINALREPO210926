import { emptyElectionPeriod, defaultHomepageSettings } from "../context/AppContext";
import type {
  Candidate,
  Commissioner,
  CommissionerRole,
  Complaint,
  ComplaintEvidence,
  ComplaintSanction,
  DisqualifiedCandidate,
  CurrentUser,
  ElectionPeriod,
  HomepageSettings,
  KioskStatus,
  LogEntry,
  OfficerStatus,
  PartySummary,
  ReportTemplate,
  Student,
  StudentMasterlistEntry,
  UserRole,
} from "../context/AppContext";
import { isSupabaseConfigured, supabase } from "./supabase";
import { clearSessionToken, saveSessionToken } from "./session";
import { canonicalAuditRole } from "./auditRoles";
import { toEvidenceArray, toSanctionArray, toDisqualifiedCandidates } from "./complaints";
import {
  splitFullName,
  toIsoBirthdate,
  toTitleCase,
  type LrnConflictInfo,
  type MasterlistRow,
} from "./masterlistDocx";

export const toDate = (value?: string) => value ? value.slice(0, 10) : "";
// v1.1 election_periods stores start_time/end_time as PostgreSQL `time`
// values ("08:00:00"), which `new Date()` cannot parse.  Accept a bare
// HH:MM[:SS] string first and fall back to the timestamp path so the
// helper keeps working for both `time` and `timestamptz` inputs.
export const toTime = (value?: string) => {
  if (!value) return "";
  const bare = /^(\d{2}:\d{2})/.exec(value);
  if (bare) return bare[1];
  return new Date(value).toTimeString().slice(0, 5);
};
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const normalize = (value?: string | null) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");

const requireSupabase = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
};

/**
 * The commissioner_role CHECK set (035) — used to narrow the raw
 * adminprofiles.commissioner_role string before it reaches the typed
 * CurrentUser.commissionerRole field (login_staff_direct_v2 returns an
 * untyped DB string).
 */
const COMMISSIONER_ROLES: CommissionerRole[] = [
  "chief",
  "screening_validation",
  "electoral_board",
  "grievance",
];

function toCommissionerRole(value?: string | null): CommissionerRole | undefined {
  return value && (COMMISSIONER_ROLES as string[]).includes(value)
    ? (value as CommissionerRole)
    : undefined;
}

export interface StaffLoginRow {
  token?: string | null;
  id: string;
  role_type: string;
  commissioner_role?: string | null;
  full_name?: string | null;
  email?: string | null;
}

export function mapStaffLoginRow(row: StaffLoginRow, fallbackEmail: string): CurrentUser {
  let role: string;
  if (row.role_type === "chief" || row.role_type === "commissioner" || row.role_type === "co_commissioner") {
    role = "admin";
  } else if (row.role_type === "sslg_adviser") {
    role = "sslg_adviser";
  } else {
    throw new Error("This account does not have admin privileges.");
  }

  if (role === "admin") {
    return {
      id: row.id,
      name: row.full_name || "Chief Commissioner",
      role: "admin",
      email: row.email || fallbackEmail,
      commissionerRole: toCommissionerRole(row.commissioner_role) || "chief",
      // The raw role_type survives the admin collapse so the sidebar can
      // title a co-commissioner after their primary ("Co-commissioner of
      // Electoral Board") instead of with the primary's own title.
      isCoCommissioner: row.role_type === "co_commissioner",
      mustChangePassword: false,
    };
  }

  return {
    id: row.id,
    name: row.full_name || "",
    role: "sslg_adviser",
    email: row.email || fallbackEmail,
    commissionerRole: undefined,
    mustChangePassword: false,
  };
}

export async function signInWithSupabase(email: string, password: string): Promise<CurrentUser> {
  const client = requireSupabase();

  // Single Phase 2 staff-login RPC: one token minted per success server-side,
  // no client-supplied identity parameter (AUTH-05). Forced-change flag removed
  // in v1.1 — the 035 return does not contain it.
  const { data, error } = await client.rpc("login_staff_direct_v2", {
    p_email: email,
    p_password: password,
  });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Invalid email or password.");
  const row = data[0];

  const user = mapStaffLoginRow(row, email);

  if (row.token) saveSessionToken(row.token);

  return user;
}

/**
 * Shape returned by the 106 RPC `check_registration_lrn` — booleans plus the
 * students.status only, never any PII (names, emails, hashes).
 */
export interface LrnRegistrationCheck {
  /** A students row already exists for this LRN (any status). */
  inStudents: boolean;
  /** students.status when inStudents, else null. */
  studentStatus: "approved" | "pending" | "rejected" | null;
  /** An enrolled student_masterlist row exists for this LRN. */
  inMasterlist: boolean;
}

/**
 * LRN-first registration pre-check (REG-LRN-01).  Anonymous visitors cannot
 * read `students` (insert-only RLS), so the live "already registered?" gate
 * is the 106 SECURITY DEFINER RPC.  If the RPC is not deployed yet, the
 * masterlist half still works through the public "masterlist registration
 * lookup" policy while the students half stays unknown (false) — the
 * insert-time duplicate-key guard in registerStudentDirect remains the last
 * line of defence.
 */
export async function checkLrnRegistration(lrn: string): Promise<LrnRegistrationCheck> {
  const client = requireSupabase();
  const value = lrn.trim();

  const { data, error } = await client.rpc("check_registration_lrn", { p_lrn: value });
  if (!error && data) {
    // Older supabase-js builds hand back a raw JSON string for scalar json
    // returns — parse before mapping.
    const raw = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
    const row = (Array.isArray(raw) ? raw[0] : raw) as Partial<LrnRegistrationCheck> & {
      in_students?: boolean;
      student_status?: LrnRegistrationCheck["studentStatus"];
      in_masterlist?: boolean;
    } | null;
    if (row) {
      return {
        inStudents: Boolean(row.in_students ?? row.inStudents),
        studentStatus: row.student_status ?? row.studentStatus ?? null,
        inMasterlist: Boolean(row.in_masterlist ?? row.inMasterlist),
      };
    }
  }

  // Fallback (RPC 106 not applied yet): the masterlist is publicly readable
  // for enrolled rows, so inMasterlist stays accurate.
  const { data: master } = await client
    .from("student_masterlist")
    .select("id")
    .eq("lrn", value)
    .eq("enrollment_status", "enrolled")
    .maybeSingle();
  return { inStudents: false, studentStatus: null, inMasterlist: Boolean(master) };
}

/** The masterlist columns the registration form verifies against. */
export interface MasterlistMatchRecord {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birthdate: string;
  grade_level: string;
  gender: string | null;
}

/**
 * Fetch the enrolled masterlist row for an LRN (public read policy
 * "masterlist registration lookup").  Used by the registration form to
 * enforce the locked MASTER-02 rule: when the LRN is in the masterlist, the
 * typed details must match it exactly — any mismatch blocks registration.
 * The middle_name column (036) also tells the form whether the Middle Name
 * input should be offered at all.
 */
export async function getMasterlistRecord(lrn: string): Promise<MasterlistMatchRecord | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("student_masterlist")
    .select("id, first_name, middle_name, last_name, birthdate, grade_level, gender")
    .eq("lrn", lrn.trim())
    .eq("enrollment_status", "enrolled")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MasterlistMatchRecord | null) ?? null;
}

/**
 * The locked MASTER-02 rule: a registration whose LRN exists in the
 * masterlist must match the record EXACTLY — first name, last name,
 * birthdate, grade level, and gender (LRN is the lookup key).  Single source
 * of truth for the comparison, shared by the RegisterPage pre-check and
 * registerStudentDirect.
 */
export function matchesMasterlistRecord(
  input: { firstName: string; lastName: string; birthdate: string; gradeLevel: string; gender: string },
  master: MasterlistMatchRecord,
): boolean {
  return ![
    normalize(master.first_name) !== normalize(input.firstName),
    normalize(master.last_name) !== normalize(input.lastName),
    toDate(master.birthdate) !== input.birthdate,
    normalize(master.grade_level) !== normalize(input.gradeLevel),
    normalize(master.gender) !== normalize(input.gender),
  ].some(Boolean);
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function registerStudentDirect(input: {
  firstName: string;
  middleName?: string;
  lastName: string;
  gradeLevel: string;
  gender: string;
  birthdate: string;
  lrn: string;
  email: string;
  password: string;
}): Promise<Student> {
  const client = requireSupabase();
  const lrn = input.lrn.trim();
  const passwordHash = await hashPassword(input.password);
  const id = crypto.randomUUID();

  // Names are stored Title Cased ("Leonard Padilla"), matching the masterlist
  // presentation — only the first letter of each name part is a capital.
  // Comparisons against the masterlist stay case-insensitive (normalize()).
  const firstName = toTitleCase(input.firstName.trim());
  const middleName = toTitleCase((input.middleName || "").trim());
  const lastName = toTitleCase(input.lastName.trim());

  const { data: master, error: masterError } = await client
    .from("student_masterlist")
    .select("id, first_name, middle_name, last_name, birthdate, grade_level, gender")
    .eq("lrn", lrn)
    .eq("enrollment_status", "enrolled")
    .maybeSingle();

  if (masterError) throw new Error(masterError.message);

  let status: "pending" | "approved";
  let verificationStatus: "automatic" | "manual";
  let mismatchCount: number;
  let masterlistId: string | null;

  if (master) {
    // Locked flow (MASTER-02, hardened): a full match (first name, last
    // name, birthdate, grade level, gender — LRN is the lookup key) approves
    // the registration automatically.  ANY mismatch is a hard block: the
    // registration is rejected BEFORE the insert, no pending row is created
    // and nothing reaches the adviser queue.  Only LRNs that are NOT in the
    // masterlist at all can land in pending for SSLG Adviser review.  The
    // mismatch error stays generic — the form never reveals which field is
    // wrong.
    if (!matchesMasterlistRecord(
      {
        firstName,
        lastName,
        birthdate: input.birthdate,
        gradeLevel: input.gradeLevel,
        gender: input.gender,
      },
      master,
    )) {
      throw new Error(
        "Your registration details do not match the Student Masterlist record for this LRN. " +
        "Registration cannot continue until all details match.",
      );
    }
    status = "approved";
    verificationStatus = "automatic";
    mismatchCount = 0;
    masterlistId = master.id;
  } else {
    status = "pending";
    verificationStatus = "manual";
    mismatchCount = 0;
    masterlistId = null;
  }

  // v1.1 (036) trimmed students: verification_status / mismatch_count /
  // reviewed_at / must_change_password / session_version were DROPPED, so
  // they must NOT appear in the insert (PGRST204 column-not-found -> 400).
  // Migration 100 re-introduces students.verification ('automatic' /
  // 'manual') for the masterlist flow; the verification badge is rendered
  // from it (see mapStudent).
  const { error } = await client
    .from("students")
    .insert({
      id,
      masterlist_id: masterlistId,
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      grade_level: input.gradeLevel,
      gender: input.gender,
      birthdate: input.birthdate,
      lrn,
      email: input.email,
      password_hash: passwordHash,
      status,
      verification: verificationStatus,
    });

  if (error) {
    if (error.message.includes("duplicate key")) {
      if (error.message.includes("email")) throw new Error("This email is already registered.");
      if (error.message.includes("lrn")) throw new Error("This LRN is already registered.");
    }
    throw new Error(error.message);
  }

  return {
    id,
    firstName,
    middleName: middleName || undefined,
    lastName,
    gradeLevel: input.gradeLevel,
    gender: input.gender,
    birthdate: input.birthdate,
    lrn,
    email: input.email,
    status,
    verificationStatus,
    mismatchCount,
    registeredAt: new Date().toISOString().slice(0, 10),
  };
}

export async function signInStudentDirect(email: string, password: string): Promise<CurrentUser> {
  const client = requireSupabase();

  // v2 entrypoint (022): the server verifies the plaintext password against
  // the stored SHA-256 and mints the session token — the hash never leaves
  // the database.
  const { data, error } = await client.rpc("login_student_direct_v2", {
    p_email: email,
    p_password: password,
  });

  // A PostgREST 400 here is a RAISED SQL error, not a transport failure.
  // The RPC deliberately emits a single identical 'Invalid credentials'
  // text for both a bad password AND a lockout (SEC-03), so surface that
  // text instead of masking every error as a generic credential failure —
  // otherwise a stale schema-cache / lockout is indistinguishable to the
  // user and to us.
  if (error) {
    const msg = error.message || "";
    if (/invalid credentials/i.test(msg)) {
      throw new Error(
        "Invalid email or password. If you have tried several times, the account is temporarily locked for 15 minutes."
      );
    }
    const detail = [error.message, (error as { details?: string }).details, (error as { hint?: string }).hint]
      .filter(Boolean)
      .join(" | ");
    throw new Error(detail || "Login failed. Please try again.");
  }
  if (!data || data.length === 0) throw new Error("Invalid email or password.");
  const session = data[0];

  if (session.status !== "approved") {
    throw new Error(
      session.status === "pending"
        ? "Your account is still awaiting SSLG Adviser approval."
        : "Your account has been rejected. Please contact the SSLG Adviser."
    );
  }

  // Persist the raw 64-hex token; the transport interceptor attaches it to
  // /rest/v1 requests as the "x-session-token" side-channel header
  // (fallback transport, migration 039 — the edge 401s a non-JWT bearer).
  saveSessionToken(session.token);

  return {
    id: session.id,
    name: `${session.first_name} ${session.last_name}`,
    role: "student",
    email: session.email,
    // v1.1 (036) dropped students.must_change_password — the login RPC no
    // longer returns it, so the flag is always false on this path.
    mustChangePassword: false,
  };
}

type CsvImportResult = { imported: number; skipped: number; errors: string[] };

export async function importStudentMasterlistCsv(csvText: string, schoolYear: string): Promise<CsvImportResult> {
  const client = requireSupabase();
  const rows = parseCsv(csvText);
  const [header, ...body] = rows;
  if (!header?.length) return { imported: 0, skipped: 0, errors: ["CSV is empty."] };

  const columns = header.map((h) => normalize(h).replace(/[^a-z0-9]+/g, "_"));
  const required = ["lrn", "first_name", "last_name", "birthdate", "grade_level"];
  const missing = required.filter((key) => !columns.includes(key));
  if (missing.length) return { imported: 0, skipped: 0, errors: [`Missing required columns: ${missing.join(", ")}`] };

  const payload: Record<string, string>[] = [];
  const errors: string[] = [];
  let skipped = 0;

  body.forEach((row, index) => {
    if (!row.some((cell) => cell.trim())) return;
    const record = Object.fromEntries(columns.map((col, colIndex) => [col, row[colIndex]?.trim() || ""]));
    if (!/^\d{12}$/.test(record.lrn)) {
      skipped += 1;
      errors.push(`Row ${index + 2}: LRN must be 12 digits.`);
      return;
    }
    payload.push({
      lrn: record.lrn,
      first_name: record.first_name,
      last_name: record.last_name,
      birthdate: record.birthdate,
      grade_level: record.grade_level,
      gender: record.gender || "",
      school_year: schoolYear,
      enrollment_status: record.enrollment_status || "enrolled",
    });
  });

  if (!payload.length) return { imported: 0, skipped, errors };

  const { error } = await client
    .from("student_masterlist")
    .upsert(payload, { onConflict: "lrn,school_year" });

  if (error) throw new Error(error.message);
  return { imported: payload.length, skipped, errors };
}

/**
 * Which of the supplied LRNs already exist in the system (MASTER-01 upload
 * pre-check): as a registered student account (public.students) or as an
 * existing Student Masterlist row (the awaiting-registration list).
 *
 * School year is deliberately ignored — an LRN identifies one learner — so a
 * sheet may not re-introduce an LRN the system already knows about.  Rows are
 * keyed by LRN, and a registered account wins the description when both
 * exist.  Lookups are chunked to keep the PostgREST query string bounded.
 */
export async function findExistingLrns(
  lrns: string[]
): Promise<Map<string, LrnConflictInfo>> {
  const client = requireSupabase();
  const found = new Map<string, LrnConflictInfo>();
  const unique = Array.from(new Set(lrns));
  const CHUNK = 300;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const [studentsRes, masterlistRes] = await Promise.all([
      client.from("students").select("lrn, status").in("lrn", batch),
      client.from("student_masterlist").select("lrn, enrollment_status").in("lrn", batch),
    ]);
    if (studentsRes.error) throw new Error(studentsRes.error.message);
    if (masterlistRes.error) throw new Error(masterlistRes.error.message);

    for (const row of studentsRes.data || []) {
      found.set(row.lrn, { reason: "registered", detail: row.status || "pending" });
    }
    for (const row of masterlistRes.data || []) {
      if (!found.has(row.lrn)) {
        found.set(row.lrn, { reason: "listed", detail: row.enrollment_status || "enrolled" });
      }
    }
  }

  return found;
}

/**
 * Persist parsed CNNHS-MASTER-LIST-FORMAT.docx rows into student_masterlist
 * (MASTER-01 insert flow).  Upserts on (lrn, school_year) so re-uploading a
 * corrected sheet updates rather than duplicates.  Rows whose grade level or
 * birthdate cannot be mapped to the DB CHECK shapes are skipped and reported
 * — a partially-readable row must not abort the whole sheet.
 */
export async function importStudentMasterlistDocx(
  rows: MasterlistRow[],
  schoolYear: string
): Promise<CsvImportResult> {
  const client = requireSupabase();

  // Guard: one LRN may appear only once per sheet.  Duplicates would make
  // PostgREST's upsert fail with the cryptic "ON CONFLICT DO UPDATE command
  // cannot affect row a second time"; the parser already rejects them, so
  // this only catches a caller that bypassed it.
  const seenLrn = new Set<string>();
  for (const row of rows) {
    if (seenLrn.has(row.lrn)) {
      throw new Error(
        `Duplicate LRN ${row.lrn} in the masterlist — no LRN may appear twice in the same sheet.`
      );
    }
    seenLrn.add(row.lrn);
  }

  const payload: Record<string, string | null>[] = [];
  const errors: string[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const { lastName, firstName, middleName } = splitFullName(row.fullName);
    const gradeLevel = /^Grade (7|8|9|10|11|12)$/.test(row.gradeLevel) ? row.gradeLevel : "";
    const birthdate = toIsoBirthdate(row.birthdate);
    if (!firstName || !lastName || !gradeLevel || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      skipped += 1;
      errors.push(`Row ${row.sheetRow ?? index + 2}: unreadable name, grade level, or birthdate — skipped.`);
      return;
    }
    payload.push({
      lrn: row.lrn,
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      birthdate,
      grade_level: gradeLevel,
      gender: row.sex || null,
      section: row.section || null,
      strand: row.strand || null,
      parent_guardian: row.parentGuardian || null,
      adviser_name: row.adviser || null,
      school_year: schoolYear,
      enrollment_status: "enrolled",
    });
  });

  if (!payload.length) return { imported: 0, skipped, errors };

  const { error } = await client
    .from("student_masterlist")
    .upsert(payload, { onConflict: "lrn,school_year" });

  if (error) throw new Error(error.message);
  return { imported: payload.length, skipped, errors };
}

export async function fetchSupabaseState() {
  if (!isSupabaseConfigured || !supabase) return null;

  // v1.1 domain trim (036/037) removed surfaces the original loader read,
  // which made the boot load throw 404/400:
  //   * public.commissioners  — dropped by 037 (staff identity now lives in
  //                             public.adminprofiles, read via the staff RPCs)
  //   * public.kiosk_devices  — dropped by 037 (kiosk build is a separate project)
  //   * election_periods.start_at — dropped by 036 (schedule is election_date
  //                             + start_time/end_time now)
  //   * candidates ... votes(id)  — the votes->candidates FK was dropped by
  //                             018 (abstain votes), so PostgREST can no longer
  //                             resolve the embed (400).  Vote counts for the
  //                             candidate card are not part of this boot load.
  // Every select below now targets a surviving table/column only.
  const [
    studentsRes,
    masterlistRes,
    electionRes,
    candidatesRes,
    partiesRes,
    complaintsRes,
    reportsRes,
    logsRes,
    homepageRes,
  ] = await Promise.all([
    safeSelect("students", "*", "registered_at"),
    safeSelect("student_masterlist", "*", "imported_at"),
    safeSelect("election_periods", "*", "updated_at", 1, "completed"),
    safeSelect("candidates", "*, parties(name)", "submitted_at"),
    // 052's "parties scoped readable" policy already lets any signed-in role
    // read the live period's parties, so this needs no extra grant.  The
    // candidates embed above already reaches the same table, so if this read
    // ever fails the Apply page still falls back to candidate-derived names.
    safeSelect("parties", "id, name, election_period_id", "created_at"),
    safeSelect("complaints", "*, students(first_name,last_name)", "submitted_at"),
    safeSelect("report_templates", "*", "enclosure"),
    safeSelect("audit_logs", "*", "timestamp", 150),
    // 115: singleton row, world-readable (the footer renders logged-out).
    safeSelect("homepage_settings", "*", "updated_at", 1),
  ]);

  return {
    students: studentsRes.map(mapStudent),
    studentMasterlist: masterlistRes.map(mapMasterlistEntry),
    // No commissioner/kiosk tables in v1.1 — keep the state shape without
    // firing a request at a dropped relation.
    commissioners: [] as Commissioner[],
    electionPeriod: electionRes[0] ? mapElectionPeriod(electionRes[0]) : emptyElectionPeriod,
    candidates: candidatesRes.map(mapCandidate),
    parties: partiesRes.map(mapParty),
    complaints: complaintsRes.map(mapComplaint),
    reportTemplates: reportsRes.map(mapReportTemplate),
    kioskStatuses: [] as KioskStatus[],
    homepageSettings: homepageRes[0] ? mapHomepageSettings(homepageRes[0]) : defaultHomepageSettings,
    logs: logsRes.map(mapLog),
  };
}

/**
 * Pure builder for the students UPDATE payload (client state → DB).
 *
 * 036 trimmed students.reviewed_at, so only surviving columns are written.
 * 100 adds `verification` ('automatic' | 'manual'), which rides along so
 * client-side student state changes keep the persisted verdict in sync —
 * but ONLY when the client actually knows it.  A state row that never
 * carried a verdict must not blank out the DB value the registration /
 * review flow already persisted (an auto-approved student must keep
 * 'automatic', never be rewritten to null).
 */
export function buildStudentSyncPayload(student: Student) {
  return {
    first_name: student.firstName,
    middle_name: student.middleName || null,
    last_name: student.lastName,
    grade_level: student.gradeLevel,
    gender: student.gender,
    birthdate: student.birthdate,
    lrn: student.lrn,
    email: student.email,
    status: student.status,
    ...(student.verificationStatus ? { verification: student.verificationStatus } : {}),
  };
}

export async function syncStudents(next: Student[], previous: Student[]) {
  if (!supabase) return;
  const db = supabase;
  await Promise.all(next.map((student) => {
    if (!isUuid(student.id)) return Promise.resolve();
    const before = previous.find((s) => s.id === student.id);
    if (before && JSON.stringify(before) === JSON.stringify(student)) return Promise.resolve();
    return db.from("students").update(buildStudentSyncPayload(student)).eq("id", student.id);
  }));
}

/**
 * Pure builder for the election_periods UPDATE payload.
 *
 * v1.3 (082) adds the Campaign window back (`campaign_start_at` /
 * `campaign_end_at`, dropped by 036, re-added for the Stage 2 date pickers)
 * and `election_modality` (Digital / Manual / Hybrid, informational).  The
 * meeting is no longer written here: `rules_discussion_at` is saved from
 * Stage 1 through save_meeting_schedule_rpc, which guards the stage — a
 * Stage 4 "Save Schedule" click must not clobber it.  The legacy
 * `nomination_open` / `official_list_posted` / `plan_finalized` columns
 * remain dropped — referencing them would 400 (PGRST204 column not found).
 *
 * 093 moves the Campaign window out of this payload entirely: it is a
 * locked record now, written only by save_campaign_window_rpc.
 */
export function buildElectionPeriodSyncPayload(period: ElectionPeriod) {
  return {
    election_date: period.startDate || null,
    end_date: period.endDate || null,
    start_time: period.startTime || null,
    end_time: period.endTime || null,
    is_active: period.isActive,
    venue: period.venue || null,
    candidacy_open: Boolean(period.candidacyOpen),
    results_published: Boolean(period.resultsPublished),
    proclaimed: Boolean(period.proclaimed),
    proclaimed_at: period.proclaimedAt ? `${period.proclaimedAt}` : null,
    voting_method: period.votingMethod || "plurality",
    election_modality: period.electionModality || "digital",
    // lifecycle_stage is deliberately ABSENT.  This function backs the plain
    // schedule editor, which has no business moving the election between
    // stages: writing a default here would let a "Save Schedule" click reset a
    // live campaign back to Stage 1.  Only the 058 RPCs may change it.
    //
    // voting_ended_at is ABSENT for the same reason (113): the End Voting
    // Stage stamp belongs to end_voting_stage_rpc, and a schedule save must
    // never clear or fake it.
    // campaign_start_at / campaign_end_at are ABSENT for the same reason
    // (093): the Campaign window is a locked record with a guarded RPC of its
    // own.  Leaving the columns here would let a Stage 4 "Save Schedule"
    // click rewrite the window behind save_campaign_window_rpc's stage guard.
  };
}

export async function syncElectionPeriod(period: ElectionPeriod): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Supabase is not configured." };

  // 058: never touch an archived period.  Reset Election Plan sets
  // lifecycle_stage = 'completed' on the row it retires, and the old
  // "order by election_date desc limit 1" lookup could resolve one of
  // those — Postgres sorts NULLs first on DESC, so a freshly reset
  // period and a retired one both end up in contention.
  const { data } = await supabase
    .from("election_periods")
    .select("id")
    .neq("lifecycle_stage", "completed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let electionId = data?.id ?? null;

  if (!electionId) {
    // No live election_periods row exists yet.  school_year is UNIQUE
    // (020:404), so a hardcoded label would collide the second time this
    // runs; derive one that cannot.
    const { data: created, error: createError } = await supabase
      .from("election_periods")
      .insert({ school_year: await nextSchoolYear() })
      .select("id")
      .maybeSingle();
    if (createError) return { ok: false, message: createError.message };
    electionId = created?.id ?? null;
  }

  if (!electionId) return { ok: false, message: "No election period row found to update." };

  // Null values in the payload ("no value yet") leave the column unchanged —
  // required for the NOT NULL start_time/end_time columns when a caller
  // toggles a flag before any schedule is recorded.
  const payload = buildElectionPeriodSyncPayload(period);
  const updateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== null) updateData[key] = value;
  }

  const { error } = await supabase.from("election_periods").update(updateData).eq("id", electionId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * A school year that cannot collide with an existing election_periods row.
 * Counts up from the newest existing label rather than parsing it, so a
 * non-numeric label in a hand-edited database cannot produce a bad one.
 */
async function nextSchoolYear(): Promise<string> {
  const { data } = await supabase!
    .from("election_periods")
    .select("school_year")
    .order("school_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  const match = /(\d{4})\s*-\s*(\d{4})/.exec(data?.school_year || "");
  if (!match) return "2026-2027";

  const start = Number(match[1]);
  for (let step = 1; step <= 20; step += 1) {
    const candidate = `${start + step}-${start + step + 1}`;
    const { data: clash } = await supabase!
      .from("election_periods")
      .select("id")
      .eq("school_year", candidate)
      .maybeSingle();
    if (!clash) return candidate;
  }
  return `${start + 21}-${start + 22}`;
}


export async function syncComplaints(next: Complaint[], previous: Complaint[]) {
  if (!supabase) return;
  const db = supabase;
  await Promise.all(next.map((complaint) => {
    if (!isUuid(complaint.id)) return Promise.resolve();
    const before = previous.find((c) => c.id === complaint.id);
    if (before && JSON.stringify(before) === JSON.stringify(complaint)) return Promise.resolve();
    return db.from("complaints").update({
      status: complaint.status,
      resolution_note: complaint.rejectionReason || null,
      findings_note: complaint.findings || null,
      incident_date: complaint.incidentDate || null,
      resolved_at: complaint.resolvedAt || null,
    }).eq("id", complaint.id);
  }));
}

/** Insert a complaint as the current student (028 RLS owner-keyed insert leg; status defaults to 'filed'). */
export async function insertComplaint(row: {
  studentId: string;
  title: string;
  description: string;
  incidentDate?: string;
  /** 098: who/what the complaint is against (resolved "Others" text included). */
  complaintAgainst?: string;
  /** 096: supporting evidence already uploaded to the complaint-evidence bucket. */
  evidence?: ComplaintEvidence[];
}): Promise<Complaint> {
  const db = requireSupabase();
  const { data, error } = await db.from("complaints").insert({
    student_id: row.studentId,
    subject: row.title,
    description: row.description,
    incident_date: row.incidentDate || null,
    complaint_against: row.complaintAgainst || null,
    evidence_urls: row.evidence ?? [],
  }).select("*, students(first_name,last_name)").single();
  if (error) throw new Error(error.message);
  return mapComplaint(data);
}

/**
 * 096: upload one complaint-evidence file to the public 'complaint-evidence'
 * bucket.  `prefix` scopes the object name (student or findings); a random
 * suffix keeps names unguessable and collision-free (072 precedent).
 */
export async function uploadComplaintEvidence(file: File | Blob, prefix: string): Promise<ComplaintEvidence> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const name = file instanceof File && file.name ? file.name : "evidence";
  const ext = name.match(/\.(\w+)$/)?.[1]?.toLowerCase() || "bin";
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now()}`;
  const fileName = `${prefix}_${Date.now()}_${unique}.${ext}`;
  const { error } = await supabase.storage.from("complaint-evidence").upload(fileName, file);
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from("complaint-evidence").getPublicUrl(fileName);
  return { url: publicUrl, name };
}

/**
 * Resolve a complaint via the role-guarded RPC — the ONLY complaints
 * mutation path (security R2).  087 model: 'accepted' (displayed as
 * "Resolved") is the only decision.  090: the RPC refuses to resolve a
 * complaint without Findings.  091: the call may carry the Findings text
 * itself (the Resolved button saves + decides in one step); a non-blank
 * p_findings overwrites the saved note.
 */
export async function decideComplaintRpc(
  complaintId: string,
  action: "accepted",
  reason?: string,
  findings?: string,
  findingsEvidence?: ComplaintEvidence[],
  decision?: Complaint["decision"],
  // 127: sanctions (Substantiated Grievance only) and, when a Disqualification
  // is imposed, the candidates it removes.  Names are derived server-side.
  sanctions?: ComplaintSanction[],
  disqualifiedCandidates?: DisqualifiedCandidate[],
  // 128: the acting Commissioner's OWN password — REQUIRED for a
  // Disqualification resolve, re-verified server-side by the RPC.
  password?: string
): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.rpc("decide_complaint_rpc", {
    p_complaint_id: complaintId,
    p_action: action,
    p_reason: reason || null,
    p_findings: findings || null,
    p_findings_evidence: findingsEvidence ?? [],
    p_decision: decision || null,
    p_sanctions: sanctions ?? [],
    p_disqualified_candidate_ids: (disqualifiedCandidates ?? []).map((c) => c.id).filter(Boolean),
    p_disqualified_candidate_names: (disqualifiedCandidates ?? []).map((c) => c.name).filter(Boolean),
    p_password: password || null,
  });
  if (error) throw new Error(error.message);
}

/**
 * 128 — the password gate in front of a Disqualification resolve.  The RPC
 * verifies the SESSION Commissioner's own adminprofiles password (bcrypt via
 * crypt(), the 107 disable-panel pattern) and the resolve RPC re-verifies the
 * same password server-side before writing.
 */
export async function verifyGrievancePasswordRpc(p_password: string): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("verify_grievance_password_rpc", { p_password });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return Boolean(data);
}

export async function insertAuditLog(entry: Omit<LogEntry, "id" | "timestamp">, actorId?: string) {
  if (!supabase) return;
  try {
    await supabase.rpc("insert_audit_log_rpc", {
      p_actor_id: actorId && isUuid(actorId) ? actorId : null,
      p_actor_name: entry.user,
      // 027's check constraint only accepts admin|student|system|sslg_adviser.
      // Callers pass display strings ("SSLG Adviser", "Administrator") — a
      // rejected insert was previously swallowed silently, so those rows
      // never persisted.  Canonicalize onto the constraint set first.
      p_actor_role: canonicalAuditRole(entry.role),
      p_action: entry.action,
      p_details: entry.details,
      p_type: entry.type,
    });
  } catch {
    // silently fail — audit log is best-effort
  }
}

async function safeSelect(
  table: string,
  select: string,
  orderBy: string,
  limit?: number,
  notLifecycleStage?: string
) {
  if (!supabase) return [];
  let query = supabase.from(table).select(select).order(orderBy, { ascending: false });
  // 058: retired election periods carry lifecycle_stage = 'completed' and must
  // never be mistaken for the live one.
  if (notLifecycleStage) query = query.neq("lifecycle_stage", notLifecycleStage);
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) {
    console.warn(`Supabase table skipped (${table}):`, error.message);
    return [];
  }
  return data || [];
}

function mapStudent(row: any): Student {
  return {
    id: row.id,
    firstName: row.first_name,
    middleName: row.middle_name || undefined,
    lastName: row.last_name,
    gradeLevel: row.grade_level,
    gender: row.gender,
    birthdate: toDate(row.birthdate),
    lrn: row.lrn,
    status: row.status,
    email: row.email,
    registeredAt: toDate(row.registered_at),
    profilePictureUrl: row.profile_picture_url || undefined,
    // 100: persisted 'automatic' | 'manual' verdict (was client-derived
    // after 036 dropped verification_status).
    verificationStatus: row.verification || undefined,
    // 107: account disabled by the SSLG Adviser (graduated / transferred).
    disabled: row.disabled_at != null,
    disabledReason: row.disabled_reason || undefined,
  };
}

function mapMasterlistEntry(row: any): StudentMasterlistEntry {
  return {
    id: row.id,
    lrn: row.lrn,
    firstName: row.first_name,
    lastName: row.last_name,
    birthdate: toDate(row.birthdate),
    gradeLevel: row.grade_level,
    gender: row.gender || undefined,
    schoolYear: row.school_year,
    enrollmentStatus: row.enrollment_status,
    importedAt: toDate(row.imported_at),
  };
}

function mapCommissioner(row: any): Commissioner {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.commissioner_role,
    status: row.status,
    appointedAt: toDate(row.appointed_at),
  };
}

function mapElectionPeriod(row: any): ElectionPeriod {
  // v1.3 (082) shape: the Campaign window is back (campaign_start_at /
  // campaign_end_at, re-added after 036 dropped them) and election_modality
  // records Digital / Manual / Hybrid.  The nomination_open /
  // official_list_posted / plan_finalized columns remain dropped, so each
  // maps to an explicit empty/false default.
  return {
    id: row.id,
    startDate: toDate(row.election_date),
    startTime: toTime(row.start_time),
    endDate: toDate(row.end_date) || toDate(row.election_date),
    endTime: toTime(row.end_time),
    isActive: Boolean(row.is_active),
    venue: row.venue || undefined,
    candidacyOpen: Boolean(row.candidacy_open),
    nominationOpen: false,
    resultsPublished: Boolean(row.results_published),
    officialListPosted: false,
    campaignStartDate: row.campaign_start_at || undefined,
    campaignStartTime: "",
    campaignEndDate: row.campaign_end_at || undefined,
    campaignEndTime: "",
    planFinalized: false,
    proclaimed: Boolean(row.proclaimed),
    proclaimedAt: row.proclaimed_at ? row.proclaimed_at : undefined,
    rulesDiscussionAt: row.rules_discussion_at || undefined,
    votingMethod: row.voting_method || undefined,
    electionModality: row.election_modality || undefined,
    schoolYear: row.school_year || undefined,
    lifecycleStage: (row.lifecycle_stage as ElectionPeriod["lifecycleStage"]) || "application",
    // 060 columns.  Absent until the migration is applied, so keep the
    // undefined default rather than inventing a value.
    fingerprintRegistrationStartAt: row.fingerprint_registration_start_at || undefined,
    fingerprintRegistrationEndAt: row.fingerprint_registration_end_at || undefined,
    // 081 columns — the merged publish & proclaim flow's board decision text.
    proclamationDecisionReason: row.proclamation_decision_reason || undefined,
    proclamationComplaintNote: row.proclamation_complaint_note || undefined,
    // 113 column — stamps the End Voting Stage action; null while the vote is
    // merely closed.  Absent until the migration is applied, so null (not a
    // fake value) is the default.
    votingEndedAt: row.voting_ended_at || null,
  };
}

function mapCandidate(row: any): Candidate {
  return {
    id: row.id,
    surname: row.surname,
    givenName: row.given_name,
    middleName: row.middle_name || undefined,
    extensionName: row.extension_name || undefined,
    gradeLevel: row.grade_level,
    position: row.position,
    partyAffiliation: row.parties?.name || undefined,
    partyId: row.party_id || undefined,
    gender: row.gender,
    dateOfBirth: toDate(row.date_of_birth),
    age: row.age,
    email: row.email,
    mobileNumber: row.mobile_number,
    landline: row.landline || undefined,
    homeAddress: row.home_address,
    addressProvinceCode: row.home_address_province_code || undefined,
    addressCityCode: row.home_address_city_code || undefined,
    addressBarangayCode: row.home_address_barangay_code || undefined,
    parentGuardianName: row.parent_guardian_name || undefined,
    parentGuardianContact: row.parent_guardian_contact || undefined,
    picture: row.picture_url || undefined,
    documents: {
      applicationForm: row.doc_application_form,
      introductoryProfile: row.doc_introductory_profile,
      eafFront: row.doc_eaf_front,
      eafBack: row.doc_eaf_back,
    },
    eafFrontImage: row.eaf_front_url || undefined,
    eafBackImage: row.eaf_back_url || undefined,
    positionApprovalStatus: row.position_approval_status || undefined,
    partyDecidedAt: row.party_decided_at || undefined,
    leadershipProfile: row.leadership_profile || undefined,
    rejectionReason: row.rejection_reason || undefined,
    rejectionDetails: row.rejection_details || undefined,
    rejectionTier: row.rejection_tier || undefined,
    status: row.status,
    submittedAt: toDate(row.submitted_at),
    votes: row.votes?.length || 0,
    studentId: row.student_id,
    electionPeriodId: row.election_period_id || undefined,
  };
}

function mapParty(row: any): PartySummary {
  return {
    id: row.id,
    name: row.name,
    electionPeriodId: row.election_period_id,
  };
}

function mapComplaint(row: any): Complaint {
  const studentName = row.students ? `${row.students.first_name} ${row.students.last_name}` : "Student";
  return {
    id: row.id,
    studentName,
    subject: row.subject,
    description: row.description,
    complaintAgainst: row.complaint_against || undefined,
    status: row.status,
    submittedAt: toDate(row.submitted_at),
    submittedAtExact: row.submitted_at || undefined,
    decision: row.decision || undefined,
    sanctions: toSanctionArray(row.sanctions),
    disqualifiedCandidates: toDisqualifiedCandidates(
      row.disqualified_candidate_ids,
      row.disqualified_candidate_names
    ),
    evidence: toEvidenceArray(row.evidence_urls),
    findingsEvidence: toEvidenceArray(row.findings_evidence_urls),
    rejectionReason: row.resolution_note || undefined,
    findings: row.findings_note || undefined,
    incidentDate: row.incident_date ? toDate(row.incident_date) : undefined,
    resolvedAt: row.resolved_at ? toDate(row.resolved_at) : undefined,
    resolvedByName: row.resolved_by_name || undefined,
    electionPeriodId: row.election_period_id || undefined,
  };
}

function mapReportTemplate(row: any): ReportTemplate {
  return {
    id: row.id,
    enclosure: row.enclosure,
    title: row.title,
    ownerRole: row.owner_role,
    category: row.category,
  };
}

function mapKioskStatus(row: any): KioskStatus {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    lastSeenAt: row.last_seen_at?.replace("T", " ").slice(0, 19),
    syncStatus: row.sync_status,
    queuedVotes: row.queued_votes || 0,
  };
}

function mapLog(row: any): LogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp?.replace("T", " ").slice(0, 19) || "",
    user: row.actor_name,
    role: row.actor_role,
    action: row.action,
    details: row.details,
    type: row.type,
  };
}

export async function uploadCandidateImage(
  bucket: "candidate-pictures" | "candidate-documents",
  file: File | Blob,
  fileName: string
): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.storage.from(bucket).upload(fileName, file, { upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return publicUrl;
}

/** 072: student profile pictures live in their own public bucket. */
export async function uploadStudentPicture(studentId: string, file: File | Blob): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const ext = file instanceof File && file.name.match(/\.(\w+)$/)
    ? file.name.match(/\.(\w+)$/)![1].toLowerCase()
    : "jpg";
  // Unique name per upload so the insert-only storage policy always
  // applies (no upsert needed) and a replaced photo can never 409.
  const fileName = `student_${studentId}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("student-pictures").upload(fileName, file);
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from("student-pictures").getPublicUrl(fileName);
  return publicUrl;
}

/**
 * 072: persist (or clear, with null) the signed-in student's picture URL.
 * The RPC derives the actor from the session spine and refuses URLs that
 * are not student-pictures uploads, so the URL argument is validated
 * server-side too.
 */
export async function updateMyProfilePictureRpc(pPictureUrl: string | null): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("update_my_profile_picture", {
    p_picture_url: pPictureUrl,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return data;
}

/**
 * Storage cleanup: ask the delete_profile_picture edge function
 * (x-session-token side channel) to remove the storage object behind a
 * student picture URL.  The function only deletes objects owned by the
 * session's student AND no longer referenced by profile_picture_url, so
 * callers must clear/replace the column via updateMyProfilePictureRpc
 * FIRST.  (One edge function serves both audiences; the student session
 * role routes this call to the student-pictures bucket.)
 */
export async function deleteStudentPictureRpc(pictureUrl: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("delete_profile_picture", {
    body: { pictureUrl },
  });
  // Prefer the function's own error body (real reason) over the
  // generic non-2xx wrapper message invoke attaches.
  if (data && (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error!);
  }
  if (error) throw new Error(error.message);
}

/** 073: staff profile pictures live in their own public bucket. */
export async function uploadAdminPicture(adminId: string, file: File | Blob): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const ext = file instanceof File && file.name.match(/\.(\w+)$/)
    ? file.name.match(/\.(\w+)$/)![1].toLowerCase()
    : "jpg";
  // Unique name per upload so the insert-only storage policy always
  // applies (no upsert needed) and a replaced photo can never 409;
  // delete_profile_picture keys its ownership check on admin_<id>_.
  const fileName = `admin_${adminId}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("admin-pictures").upload(fileName, file);
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from("admin-pictures").getPublicUrl(fileName);
  return publicUrl;
}

/** 115: map the homepage_settings singleton row onto client state. */
export function mapHomepageSettings(row: any): HomepageSettings {
  // 119: About content — blank stored values fall back to the shipped
  // wording so a cleared field never strands the About page.
  const coreValues = Array.isArray(row.core_values)
    ? row.core_values.map((v: any) => ({ title: String(v?.title ?? ""), gloss: String(v?.gloss ?? "") }))
    : [];
  return {
    guidelinesUrl: row.guidelines_url || undefined,
    guidelinesName: row.guidelines_name || undefined,
    contactEmail: row.contact_email || defaultHomepageSettings.contactEmail,
    location: row.location || defaultHomepageSettings.location,
    // `time`-style values can arrive as "08:00:00" — keep the HH:MM the
    // <input type="time"> controls expect.
    officeHoursStart: (row.office_hours_start || "").slice(0, 5) || defaultHomepageSettings.officeHoursStart,
    officeHoursEnd: (row.office_hours_end || "").slice(0, 5) || defaultHomepageSettings.officeHoursEnd,
    briefInfo: row.brief_info || defaultHomepageSettings.briefInfo,
    vision: row.vision || defaultHomepageSettings.vision,
    mission: row.mission || defaultHomepageSettings.mission,
    coreValues: coreValues.length > 0 ? coreValues : defaultHomepageSettings.coreValues,
  };
}

/**
 * 115: the Election Guidelines document lives in its own public bucket
 * (10 MB, pdf/doc/docx — mirrors migration 115).  Unique name per upload so
 * the insert-only storage policy always applies; the replaced file is left
 * in the bucket (acceptable orphan for a once-per-election document).
 */
export async function uploadGuidelinesFile(file: File): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const ext = file.name.match(/\.(\w+)$/)?.[1]?.toLowerCase() || "pdf";
  const safeBase = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "election_guidelines";
  const fileName = `guidelines_${Date.now()}_${safeBase}.${ext}`;
  const { error } = await supabase.storage.from("homepage-files").upload(fileName, file);
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from("homepage-files").getPublicUrl(fileName);
  return publicUrl;
}

/**
 * 115: persist the homepage settings through the Chief-gated RPC.  The RPC
 * re-validates every field server-side (email shape, HH:MM office hours,
 * guidelines URL bucket) and returns the saved row, which becomes the new
 * client state.  119: the About CNNHS content (brief info, Vision,
 * Mission, Core Values) rides in the same row and RPC.
 */
export async function saveHomepageSettingsRpc(payload: {
  guidelinesUrl: string | null;
  guidelinesName: string | null;
  contactEmail: string;
  location: string;
  officeHoursStart: string;
  officeHoursEnd: string;
  briefInfo: string;
  vision: string;
  mission: string;
  coreValues: Array<{ title: string; gloss: string }>;
}): Promise<HomepageSettings> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("save_homepage_settings_rpc", {
    p_guidelines_url: payload.guidelinesUrl,
    p_guidelines_name: payload.guidelinesName,
    p_contact_email: payload.contactEmail,
    p_location: payload.location,
    p_office_hours_start: payload.officeHoursStart,
    p_office_hours_end: payload.officeHoursEnd,
    p_brief_info: payload.briefInfo,
    p_vision: payload.vision,
    p_mission: payload.mission,
    p_core_values: payload.coreValues,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return mapHomepageSettings(data);
}

/**
 * 073: persist (or clear, with null) the signed-in staff member's picture
 * URL.  The RPC derives the actor from the session spine, gates the role
 * to admin/sslg_adviser, and refuses URLs that are not admin-pictures
 * uploads, so the URL argument is validated server-side too.
 */
export async function updateMyAdminPictureRpc(pPictureUrl: string | null): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("update_my_admin_profile_picture", {
    p_picture_url: pPictureUrl,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return data;
}

/**
 * 073: ask the delete_profile_picture edge function (x-session-token
 * side channel) to remove the storage object behind a staff picture URL.
 * The function only deletes objects owned by the session's staff member
 * AND no longer referenced by profile_picture_url, so callers must
 * clear/replace the column via updateMyAdminPictureRpc FIRST.  (One edge
 * function serves both audiences; the staff session role routes this
 * call to the admin-pictures bucket.)
 */
export async function deleteAdminPictureRpc(pictureUrl: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("delete_profile_picture", {
    body: { pictureUrl },
  });
  // Prefer the function's own error body (real reason) over the
  // generic non-2xx wrapper message invoke attaches.
  if (data && (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error!);
  }
  if (error) throw new Error(error.message);
}

export async function submitCandidacyRpc(payload: {
  p_action: "create" | "update" | "finalize";
  p_candidate_data?: Record<string, unknown>;
  p_candidate_id?: string;
  p_picture_url?: string;
  p_eaf_front_url?: string;
  p_eaf_back_url?: string;
}): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("submit_candidacy_rpc", payload);
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return data;
}

export async function reviewStudentRpc(
  p_student_id: string,
  p_action: "approve" | "reject",
  // Retained for call-site compatibility; 036 (AUTH-05) removed the
  // server-side p_actor_id parameter — the actor derives exclusively from
  // the session spine — so it is intentionally NOT sent.
  _p_actor_id?: string,
  // 100: optional verification stamp on the approve path.  The upload
  // auto-approve passes "automatic"; the adviser's manual review passes
  // nothing (the RPC keeps the registration's own verdict, defaulting to
  // 'manual').
  p_verification?: "automatic" | "manual"
): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("review_student_rpc", {
    p_student_id,
    p_action,
    p_verification: p_verification ?? null,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return data;
}

/** 107 — the password gate in front of the "Disable Student Accounts"
 *  panel.  The RPC verifies the SESSION adviser's own password
 *  (bcrypt via crypt); the actor derives from the session spine. */
export async function verifyAdviserPasswordRpc(p_password: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("verify_adviser_password_rpc", {
    p_password,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return Boolean(data);
}

/** 107 — the consequential move: disable approved student accounts
 *  (graduated / transferred).  The RPC re-verifies the password
 *  server-side and writes the audit entry.  Returns the disabled count. */
export async function disableStudentAccountsRpc(
  p_student_ids: string[],
  p_reason: "graduated" | "transferred",
  p_password: string
): Promise<{ disabled: number }> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("disable_student_accounts_rpc", {
    p_student_ids,
    p_reason,
    p_password,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { disabled?: number } | null;
  return { disabled: Number(row?.disabled ?? 0) };
}

export async function reviewCandidacyRpc(
  p_candidate_id: string,
  p_action: "approve" | "reject",
  p_rejection_reason?: string,
  p_rejection_details?: string,
  p_rejection_tier?: "low" | "high",
  // Retained for call-site compatibility; 036 (AUTH-05) removed the
  // server-side p_actor_id parameter — the actor derives exclusively from
  // the session spine — so it is intentionally NOT sent (sending it makes
  // PostgREST fail the signature match with PGRST202 → 404).
  _p_actor_id?: string
): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("review_candidacy_rpc", {
    p_candidate_id,
    p_action,
    p_rejection_reason: p_action === "reject" ? p_rejection_reason : null,
    p_rejection_details: p_action === "reject" ? p_rejection_details : null,
    p_rejection_tier: p_action === "reject" ? p_rejection_tier : null,
  });
  if (error) {
    const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
    throw new Error(msg);
  }
  return data;
}

/**
 * 030 (D-14) bootstrap/profile refresh: re-read the acting user's profile
 * (incl. must_change_password) from the server.  The session spine derives
 * the actor from the stored token, so a page reload cannot bypass the
 * forced-change gate by replaying a stale stored user.
 */
export interface CurrentProfile {
  id: string;
  role: string;
  commissioner_role: string | null;
  full_name: string | null;
  email: string | null;
  must_change_password: boolean;
  /** 073: staff photo (adminprofiles); students get theirs off the
   *  students list (live after upload) — returned here too for the
   *  public Navbar's single-field read. */
  profile_picture_url: string | null;
}

export async function getCurrentProfileRpc(): Promise<CurrentProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_current_profile_rpc");
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return {
    id: row.id,
    role: row.role,
    commissioner_role: row.commissioner_role ?? null,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    must_change_password: Boolean(row.must_change_password),
    profile_picture_url: row.profile_picture_url ?? null,
  };
}

/**
 * D-22 dispatch: the password-change path branches on the acting user's
 * role. Students change via the change_my_password RPC (actor derived from
 * the session spine); admin/commissioner/adviser change via the
 * change_password edge function (identity from the x-session-token header
 * the 02-01 transport interceptor attaches to /functions/v1/ calls).
 *
 * The new password travels PLAINTEXT over TLS to the server, which hashes
 * it — no client-side hashing on any password-change path (D-22/D-23).
 * On success the dead session token is cleared client-side (ACCT-05 half);
 * the caller additionally resets the app user state so the UI routes to
 * login (DashboardLayout guard).
 */
export async function changePasswordForCurrentUser(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const client = requireSupabase();

  let currentRole: string | null = null;
  try {
    const raw = localStorage.getItem("svock_current_user");
    currentRole = raw ? ((JSON.parse(raw) as { role?: string | null }).role ?? null) : null;
  } catch {
    currentRole = null;
  }

  if (currentRole === "student") {
    const { error } = await client.rpc("change_my_password", {
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });
    if (error) throw new Error(error.message);
  } else {
    // Staff/commissioner/adviser — the interceptor supplies the session
    // token in the x-session-token header; none is passed from here.
    const { data, error } = await client.functions.invoke("change_password", {
      body: { currentPassword, newPassword },
    });
    if (error) throw new Error(error.message);
    if (data && (data as { error?: string }).error) throw new Error((data as { error?: string }).error!);
  }

  // ACCT-05 client half: a successful change killed the server-side
  // sessions; never keep a dead token around.
  clearSessionToken();
}

export async function updateStudentPassword(
  _studentId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await changePasswordForCurrentUser(currentPassword, newPassword);
}

export async function updateAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await changePasswordForCurrentUser(currentPassword, newPassword);
}

/**
 * Forgot-password (email OTP) — request half.  Posts { email } to the
 * send_password_reset edge function (verify_jwt = false; pre-login, so no
 * x-session-token exists yet and none is attached).  The server answers
 * ok:true whether or not the account exists (anti-enumeration), so the
 * caller always shows the same "check your inbox" copy on success.  A
 * thrown error means a real infrastructure problem (Brevo outage /
 * secrets missing) or malformed input, not "email unknown".
 */
export async function requestPasswordResetCode(email: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.functions.invoke("send_password_reset", {
    body: { email },
  });
  if (error) {
    throw new Error("Unable to send the reset code right now. Please try again later.");
  }
}

/**
 * Forgot-password — verify half.  The code + new password go to the
 * verify_password_reset RPC (migration 120, SECURITY DEFINER; granted to
 * anon per the 108 convention because the caller has no session yet).
 * The new password travels PLAINTEXT over TLS — same convention as
 * changePasswordForCurrentUser; the server bcrypt-hashes it (023 D-10),
 * bumps session_version and kills every active session (D-14).
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("verify_password_reset", {
    p_email: email,
    p_code: code,
    p_new_password: newPassword,
  });
  if (error) throw new Error(error.message);
}

/**
 * The party President's decision on a join request.  The database decides
 * whether the caller actually presides over that party — the President id is
 * never passed from the client, precisely because that is the one thing a
 * client must not be able to assert about itself.
 */
export async function reviewPartyCandidacyRpc(
  pCandidateId: string,
  pAction: "approve" | "reject"
): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("review_party_candidacy_rpc", {
    p_candidate_id: pCandidateId,
    p_action: pAction,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Put a declined application back in the running, if the seat is free. */
export async function reapplyPartyCandidacyRpc(pCandidateId: string): Promise<any> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("reapply_party_candidacy_rpc", {
    p_candidate_id: pCandidateId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Re-read one candidacy row, so the student can see a party President's
 * decision without a full page reload.
 *
 * The party President's dashboard is a different browser session, so the
 * approval lands in the database with nothing to push it into the applicant's
 * already-hydrated state. This is the read the "Check approval status" button
 * makes. RLS is satisfied by "candidates self session select" (043:62) — a
 * student reads their own row at any status — so no new grant is involved.
 *
 * Returns the fully mapped candidate, or null when the row is not visible.
 */
export async function fetchCandidateGate(pCandidateId: string): Promise<Candidate | null> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("candidates")
    .select("*, parties(name)")
    .eq("id", pCandidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCandidate(data) : null;
}

/**
 * 103 — officer creation moved from the legacy create_commissioner /
 * create_sslg_adviser edge functions (which still wrote the
 * commissioners/sslg_advisers tables 037 dropped, plus auth.users rows
 * staff login never reads) to chief-gated SECURITY DEFINER RPCs over
 * adminprofiles — the single staff identity table since 035.  Each RPC
 * generates a one-time temp password, stores only its bcrypt hash, and
 * returns the plaintext exactly once (D-03 modal contract).
 */

/** Serving commissioner roles — 'appointment' is records-only (103). */
export const SERVING_COMMISSIONER_ROLES: CommissionerRole[] = [
  "screening_validation",
  "electoral_board",
  "grievance",
];

export async function createCommissioner(
  name: string,
  email: string,
  role: CommissionerRole
): Promise<{ name: string; email: string; password: string }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_commissioner_rpc", {
    p_name: name,
    p_email: email,
    p_commissioner_role: role,
  });
  if (error) throw new Error(error.message);
  return { name, email, password: String(data) };
}

/**
 * 103 — a Co-commissioner can only be created for a role that currently
 * has an ACTIVE primary commissioner; the RPC re-checks server-side (the
 * UI gate is convenience, not security).  Multiple co-commissioners per
 * role are allowed.  104: the 'appointment' role is accepted too — its
 * co-commissioner is RECORDS-ONLY (no account) and the RPC returns a
 * null password, so no credential modal is shown.  118: account-backed
 * co-commissioners get the role's CO-PREFIXED default password
 * (coelectoral123 / cogrievance123 / coscreening123), distinct from
 * their primary's role default.
 */
export async function createCoCommissioner(
  name: string,
  email: string,
  role: CommissionerRole
): Promise<{ name: string; email: string; password: string | null }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_co_commissioner_rpc", {
    p_name: name,
    p_email: email,
    p_commissioner_role: role,
  });
  if (error) throw new Error(error.message);
  return { name, email, password: data == null ? null : String(data) };
}

export async function createSslgAdviser(
  name: string,
  email: string
): Promise<{ name: string; email: string; password: string }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_sslg_adviser_rpc", {
    p_name: name,
    p_email: email,
  });
  if (error) throw new Error(error.message);
  return { name, email, password: String(data) };
}

/**
 * 103 — records-only Commissioner of Appointment: upserts the single
 * 'appointment' adminprofiles row (no auth_id, no password_hash) — it
 * fills the appointment vacancy and prefills report signatories but can
 * never log in.  Call again with new values to update the record.
 */
export async function setAppointmentCommissioner(
  name: string,
  email: string
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("set_appointment_commissioner_rpc", {
    p_name: name,
    p_email: email,
  });
  if (error) throw new Error(error.message);
}

/**
 * 103 — Active / On Leave / Retired / Resigned.  The RPC refuses the
 * chief row and purges the officer's sessions on retired/resigned.
 */
export async function setOfficerStatus(
  officerId: string,
  status: OfficerStatus
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("set_officer_status_rpc", {
    p_officer_id: officerId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

// Role-gated live results (03-01). The blanket grant on
// live_results_restricted was revoked in migration 027; the only
// read path is this RPC, which enforces the Chief or Electoral Board
// role server-side (T-03-01 / T-03-05). Mirror of the
// get_live_results_rpc return columns, kept in the same shape as the
// view.
export interface LiveResultRow {
  election_period_id: string;
  position: string;
  candidate_id: string;
  given_name: string;
  surname: string;
  party_name: string | null;
  votes: number;
}

export async function getLiveResultsRpc(): Promise<LiveResultRow[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("get_live_results_rpc");
  if (error) throw new Error(error.message);
  return (data || []) as LiveResultRow[];
}

/**
 * 046 — Chief-gated staff roster (Officer Management).  037 dropped
 * commissioners/sslg_advisers and 038 revoked direct SELECT on
 * adminprofiles, so this SECURITY DEFINER RPC is the only client-readable
 * roster; it never exposes password material.
 */
export interface StaffRosterRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role_type: string;
  commissioner_role: string | null;
  status: string;
  appointed_at: string | null;
  /** 104: the co-commissioner's primary — null for non-co rows (and for
   *  co rows whose primary was removed: the FK is ON DELETE SET NULL). */
  co_commissioner_of: string | null;
}

export async function listStaffRosterRpc(): Promise<StaffRosterRow[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("list_staff_roster_rpc");
  if (error) throw new Error(error.message);
  return (data || []) as StaffRosterRow[];
}

/**
 * The two EAF page-1 signatory names (110) — the ACTIVE Screening and
 * Validation Commissioner and the ACTIVE Chief Commissioner.  Students call
 * this when rendering the EAF preview: list_staff_roster_rpc is chief-gated
 * and adminprofiles is unreadable directly, so this minimal SECURITY DEFINER
 * read is the only path to the printed "Verified by / Approved by" names.
 * Null means the role is vacant — the EAF falls back to its placeholders.
 */
export interface EafSignatories {
  screening_commissioner: string | null;
  chief_commissioner: string | null;
}

export async function fetchEafSignatoriesRpc(): Promise<EafSignatories> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("eaf_signatories_rpc");
  if (error) throw new Error(error.message);
  return (data || { screening_commissioner: null, chief_commissioner: null }) as EafSignatories;
}

/**
 * 116 — the public Contact Information page (/contact).  An UNGATED public
 * RPC (the page renders for logged-out visitors, like homepage_settings):
 * the ACTIVE Chief Commissioner, SSLG Adviser and Grievance Commissioner,
 * each as name + email ONLY.  A null entry means the role is vacant or the
 * officer has no email on file — the page renders a vacancy notice for it.
 */
export interface ContactInfoEntry {
  name: string;
  email: string;
}

export interface ContactInformation {
  chief_commissioner: ContactInfoEntry | null;
  sslg_adviser: ContactInfoEntry | null;
  grievance_commissioner: ContactInfoEntry | null;
}

export async function fetchContactInformationRpc(): Promise<ContactInformation> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("contact_information_rpc");
  if (error) throw new Error(error.message);
  return (data || {
    chief_commissioner: null,
    sslg_adviser: null,
    grievance_commissioner: null,
  }) as ContactInformation;
}

/**
 * 068 — Chief-gated officer removal (Officer Management "Remove" action).
 * SECURITY DEFINER RPC: the DB refuses non-chief callers, the chief's own
 * row, and self-removal, purges the target's sessions, and nulls every
 * FK that referenced the row (035 set-null contract) so history survives.
 */
export async function removeOfficerRpc(officerId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("remove_officer_rpc", { p_officer_id: officerId });
  if (error) throw new Error(error.message);
}

/**
 * 046 — Chief-gated per-position abstain counts (Election Reports).
 * 018 stores an abstain as a votes row with abstained=true and
 * candidate_id NULL; the client never reads public.votes directly, so
 * the abstain percentage is computed from this RPC.
 */
export interface AbstainSummaryRow {
  election_period_id: string;
  position: string;
  abstain_count: number;
}

export async function getAbstainSummaryRpc(): Promise<AbstainSummaryRow[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("get_abstain_summary_rpc");
  if (error) throw new Error(error.message);
  return (data || []).map((row: AbstainSummaryRow) => ({
    ...row,
    abstain_count: Number(row.abstain_count) || 0,
  }));
}

/**
 * 079 — per-position abstain counts for the Live Results tab, gated like
 * get_live_results_rpc (chief OR electoral_board) and scoped to the same
 * active period, so abstains appear exactly when live results do.
 */
export interface LiveAbstainSummaryRow {
  election_period_id: string;
  position: string;
  abstain_count: number;
}

export async function getLiveAbstainSummaryRpc(): Promise<LiveAbstainSummaryRow[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("get_live_abstain_summary_rpc");
  if (error) throw new Error(error.message);
  return (data || []).map((row: LiveAbstainSummaryRow) => ({
    ...row,
    abstain_count: Number(row.abstain_count) || 0,
  }));
}

export interface PublicCurrentCandidate {
  id: string;
  name: string;
  position: string;
  gradeLevel: string;
  partyAffiliation?: string;
  picture?: string;
}

/**
 * The lifecycle stages the current election is publicized under.  058's flow
 * runs application -> campaign -> fingerprint_registration -> voting ->
 * results: during Stage 1 (application) the page only announces that the
 * election is underway (and which stage it is in) — the approved slate stays
 * private while application is still current and becomes public the moment
 * the Commissioner schedules the campaign meeting, then never disappears
 * again mid-election.
 */
export type PublicCurrentStage =
  | "application"
  | "campaign"
  | "fingerprint_registration"
  | "voting"
  | "results";

const PUBLIC_CURRENT_STAGES: readonly string[] = [
  "application",
  "campaign",
  "fingerprint_registration",
  "voting",
  "results",
];

export interface PublicCurrentElection {
  id: string;
  stage: PublicCurrentStage;
  electionDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  venue?: string;
  votingMethod?: string;
  candidates: PublicCurrentCandidate[];
}

export async function getCurrentPublicElection(): Promise<PublicCurrentElection | null> {
  const client = requireSupabase();
  // Same "current period" rule as current_election_period_id() (058:91) and
  // getCurrentElectionId(): never a retired (completed) row, most recently
  // updated wins.  The old filter here was is_active = true, which only turns
  // on when voting opens (060/063) — it kept the public slate hidden through
  // the whole Campaign stage.  RLS already lets anon read approved candidates
  // and election_periods at any stage (001:548/558), so the stage gate below
  // is the only visibility rule that belongs on the client.
  //
  // The embedded `parties(name)` needs that same standing: 052's parties
  // policy only opened up at `is_active`, so from the moment this slate was
  // publicised at the Campaign stage every candidate read back with a null
  // embed and rendered as "Independent".  070_parties_current_period_read
  // widens it to the current period, so the embed resolves here.
  const { data: election, error: electionError } = await client
    .from("election_periods")
    .select("id, lifecycle_stage, election_date, start_time, end_date, end_time, venue, voting_method")
    .neq("lifecycle_stage", "completed")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("school_year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (electionError) throw new Error(electionError.message);
  if (!election) return null;

  // Stage 1 (application) publicizes the period only: approved or not, the
  // slate stays private until the campaign meeting has been scheduled.
  const stage = election.lifecycle_stage as PublicCurrentStage | undefined;
  if (!stage || !PUBLIC_CURRENT_STAGES.includes(stage)) return null;

  let candidateRows: any[] = [];
  if (stage !== "application") {
    const { data, error: candidateError } = await client
      .from("candidates")
      .select("id, given_name, middle_name, surname, extension_name, grade_level, position, party_id, picture_url, parties(name)")
      .eq("election_period_id", election.id)
      .eq("status", "approved")
      .order("surname", { ascending: true })
      .order("given_name", { ascending: true });
    if (candidateError) throw new Error(candidateError.message);
    candidateRows = data || [];
  }

  return {
    id: election.id,
    stage,
    electionDate: toDate(election.election_date),
    startTime: toTime(election.start_time),
    endDate: toDate(election.end_date) || toDate(election.election_date),
    endTime: toTime(election.end_time),
    venue: election.venue || undefined,
    votingMethod: election.voting_method || undefined,
    candidates: (candidateRows || []).map((row: any) => ({
      id: row.id,
      name: [row.given_name, row.middle_name, row.surname, row.extension_name]
        .filter(Boolean)
        .join(" "),
      position: row.position,
      gradeLevel: row.grade_level,
      partyAffiliation: row.parties?.name || undefined,
      picture: row.picture_url || undefined,
    })),
  };
}

export async function getCurrentElectionId(): Promise<string | null> {
  if (!supabase) return null;
  // 058: an archived period (lifecycle_stage = 'completed', left behind by
  // Reset Election Plan) must never resolve as the current one.
  const { data } = await supabase
    .from("election_periods")
    .select("id")
    .neq("lifecycle_stage", "completed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

export interface PastElectionSummary {
  id: string;
  schoolYear: string;
  electionDate?: string;
  endDate?: string;
  venue?: string;
  votingMethod?: string;
  proclaimed: boolean;
  proclaimedAt?: string;
  positionsContested: number;
  approvedCandidates: number;
  votesCast: number;
  abstentions: number;
  totalBallots: number;
  /** 081 — the announcement resolved at least one tied position. */
  hadTies?: boolean;
  /** 081 — a complaint was on record when the winners were proclaimed. */
  hadComplaint?: boolean;
}

export interface PastElectionCandidateTally {
  name: string;
  gradeLevel: string;
  partyName?: string;
  votes: number;
  /** Total votes cast in this candidate's race (position). */
  totalVotes: number;
  picture?: string;
  isWinner: boolean;
  proclaimedWinner: boolean;
}

export interface PastElectionPositionResult {
  position: string;
  votesCast: number;
  abstentions: number;
  candidates: PastElectionCandidateTally[];
  /** 081 — this position ended in a tie the Board resolved manually. */
  wasTie?: boolean;
  /** How the Board recorded the resolution (e.g. "Coin Toss"). */
  tieBreakNote?: string;
}

export interface PastElectionResults {
  election: {
    id: string;
    schoolYear: string;
    electionDate?: string;
    endDate?: string;
    venue?: string;
    votingMethod?: string;
    proclaimed: boolean;
    proclaimedAt?: string;
    /** 081 — the board's public note on the complaint(s) of record. */
    complaintNote?: string;
    /** 097/114 — the Board's one-time Complaint Resolution and Justification
     *  (owed whenever any Findings decision is on record). */
    decisionReason?: string;
    /** 099 — the election's sanitized public complaint record. */
    complaints?: ElectionComplaintRecord[];
  };
  totals: {
    positionsContested: number;
    approvedCandidates: number;
    votesCast: number;
    abstentions: number;
    totalBallots: number;
  };
  positions: PastElectionPositionResult[];
}

export function mapPastElectionSummary(row: any): PastElectionSummary {
  return {
    id: row.election_period_id,
    schoolYear: row.school_year || "",
    electionDate: row.election_date ? toDate(row.election_date) : undefined,
    endDate: row.end_date ? toDate(row.end_date) : undefined,
    venue: row.venue || undefined,
    votingMethod: row.voting_method || undefined,
    proclaimed: Boolean(row.proclaimed),
    proclaimedAt: row.proclaimed_at || undefined,
    positionsContested: Number(row.positions_contested ?? 0),
    approvedCandidates: Number(row.approved_candidates ?? 0),
    votesCast: Number(row.votes_cast ?? 0),
    abstentions: Number(row.abstentions ?? 0),
    totalBallots: Number(row.total_ballots ?? 0),
  };
}

function mapPastElectionCandidate(row: any): PastElectionCandidateTally {
  return {
    name: row.name || "",
    gradeLevel: row.gradeLevel || "",
    partyName: row.partyName || undefined,
    votes: Number(row.votes ?? 0),
    totalVotes: Number(row.totalVotes ?? row.votes ?? 0),
    picture: row.picture || undefined,
    isWinner: Boolean(row.isWinner),
    proclaimedWinner: Boolean(row.proclaimedWinner),
  };
}

export function mapPastElectionResults(payload: any): PastElectionResults {
  return {
    election: {
      id: payload.election.id,
      schoolYear: payload.election.schoolYear || "",
      electionDate: payload.election.electionDate ? toDate(payload.election.electionDate) : undefined,
      endDate: payload.election.endDate ? toDate(payload.election.endDate) : undefined,
      venue: payload.election.venue || undefined,
      votingMethod: payload.election.votingMethod || undefined,
      proclaimed: Boolean(payload.election.proclaimed),
      proclaimedAt: payload.election.proclaimedAt || undefined,
    },
    totals: {
      positionsContested: Number(payload.totals?.positionsContested ?? 0),
      approvedCandidates: Number(payload.totals?.approvedCandidates ?? 0),
      votesCast: Number(payload.totals?.votesCast ?? 0),
      abstentions: Number(payload.totals?.abstentions ?? 0),
      totalBallots: Number(payload.totals?.totalBallots ?? 0),
    },
    positions: (payload.positions || []).map((position: any) => ({
      position: position.position,
      votesCast: Number(position.votesCast ?? 0),
      abstentions: Number(position.abstentions ?? 0),
      candidates: (position.candidates || []).map(mapPastElectionCandidate),
    })),
  };
}

/** Closed elections whose results the Electoral Board has published. */
export async function listPastElections(): Promise<PastElectionSummary[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("list_past_elections_rpc");
  if (error) throw new Error(error.message);
  const summaries = (data || []).map(mapPastElectionSummary);
  // 081 — badge each card with whether the announcement resolved ties or was
  // made over a complaint of record.  The proclamations table is publicly
  // readable and its rows are retained forever, so the live read covers
  // archived periods too.  Best effort: badges never break the list.
  try {
    const ids = summaries.map((s: PastElectionSummary) => s.id).filter(Boolean);
    if (ids.length > 0) {
      const [proclamationsRes, periodsRes] = await Promise.all([
        client
          .from("proclamations")
          .select("election_period_id, resolution_method")
          .in("election_period_id", ids),
        client
          .from("election_periods")
          .select("id, proclamation_complaint_note")
          .in("id", ids),
      ]);
      if (!proclamationsRes.error && !periodsRes.error) {
        const tieIds = new Set(
          (proclamationsRes.data || [])
            // 117 — 'tie_both' (a 2-way Grade Level Representative tie that
            // proclaimed both winners) badges the card as a tie of record.
            .filter((row: any) => row.resolution_method === "manual" || row.resolution_method === "tie_both")
            .map((row: any) => row.election_period_id as string),
        );
        const complaintIds = new Set(
          (periodsRes.data || [])
            .filter((row: any) => row.proclamation_complaint_note)
            .map((row: any) => row.id as string),
        );
        for (const summary of summaries) {
          summary.hadTies = tieIds.has(summary.id);
          summary.hadComplaint = complaintIds.has(summary.id);
        }
      }
    }
  } catch {
    /* the badges are an addition to the record, never a gate */
  }
  return summaries;
}

export interface ProclamationTieAnnotation {
  position: string;
  wasTie: boolean;
  tieBreakNote?: string;
  /** The proclaimed candidate for this position (every proclaimed position
   *  appears in `ties`, tie or not — so this doubles as the winners list). */
  candidateId?: string;
}

export interface ProclamationAnnotations {
  ties: ProclamationTieAnnotation[];
  complaintNote?: string;
  /** 097/114 — the Board's one-time Complaint Resolution and Justification
   *  (owed whenever ANY Findings decision is on record).  Public on the
   *  results pages with the note. */
  decisionReason?: string;
}

/**
 * 099 — one sanitized complaint in an election's public record.  The
 * `get_election_complaint_record_rpc` definer view deliberately omits the
 * student's name, the complaint text and every evidence URL (the 085
 * privacy rule) — the results pages show subject + decision + findings.
 */
export interface ElectionComplaintRecord {
  id: string;
  subject: string;
  status: "filed" | "accepted" | "rejected";
  /** 097 — null while the complaint is filed or unclassified. */
  decision?: "substantiated" | "unsubstantiated" | "dismissed" | null;
  /** 086 — the Grievance Commissioner's findings note. */
  findings?: string | null;
  resolvedAt?: string | null;
  /** 127 — the sanctions imposed on a Substantiated Grievance. */
  sanctions?: ComplaintSanction[] | null;
  /** 127 — candidates removed by a Disqualification sanction (names only —
   *  the public record is sanitized, so the ids are left blank). */
  disqualifiedCandidates?: DisqualifiedCandidate[] | null;
}

/**
 * 099 — the complaint record for one election, current or archived (the
 * live `complaints` rows are never trimmed).  Fails soft to an empty
 * record: an un-migrated database must never break the results pages.
 */
export async function getElectionComplaintRecordRpc(
  electionPeriodId: string
): Promise<ElectionComplaintRecord[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc("get_election_complaint_record_rpc", {
      p_election_period_id: electionPeriodId,
    });
    if (error || !data) return [];
    return (data as any[]).map((row) => ({
      id: row.id,
      subject: row.subject || "",
      status: row.status === "accepted" || row.status === "rejected" ? row.status : "filed",
      decision: row.decision ?? null,
      findings: row.findings ?? null,
      resolvedAt: row.resolved_at ?? null,
      sanctions: toSanctionArray(row.sanctions),
      disqualifiedCandidates: toDisqualifiedCandidates([], row.disqualified_candidate_names),
    }));
  } catch {
    return [];
  }
}

/**
 * 081 — the proclamation's public decision record for one election: which
 * positions ended in a tie the Board resolved (and how), the proclaimed
 * winner per position, plus the board's note on the complaint(s) of record.
 * Both source tables are publicly readable and the rows are retained
 * forever, so this serves the current official results, the live results
 * page, AND archived past elections.  Soft-fails to an empty record so an
 * un-migrated database can never break the results pages.
 */
export async function getProclamationAnnotations(
  electionPeriodId: string
): Promise<ProclamationAnnotations> {
  if (!supabase) return { ties: [] };
  try {
    const [proclamationsRes, periodRes] = await Promise.all([
      supabase
        .from("proclamations")
        .select("winning_position, candidate_id, resolution_method, tie_break_note")
        .eq("election_period_id", electionPeriodId),
      supabase
        .from("election_periods")
        .select("proclamation_complaint_note, proclamation_decision_reason")
        .eq("id", electionPeriodId)
        .maybeSingle(),
    ]);
    if (proclamationsRes.error || periodRes.error) return { ties: [] };
    const ties: ProclamationTieAnnotation[] = (proclamationsRes.data || []).map((row: any) => ({
      position: row.winning_position,
      // 117 — 'tie_both' (a 2-way Grade Level Representative tie that
      // proclaimed both winners) is a tie of record just like 'manual'.
      wasTie: row.resolution_method === "manual" || row.resolution_method === "tie_both",
      tieBreakNote: row.tie_break_note || undefined,
      candidateId: row.candidate_id || undefined,
    }));
    const complaintNote = periodRes.data?.proclamation_complaint_note || undefined;
    const decisionReason = periodRes.data?.proclamation_decision_reason || undefined;
    return { ties, complaintNote, decisionReason };
  } catch {
    return { ties: [] };
  }
}

/** Full tallies, abstentions and proclaimed winners for one past election. */
export async function getPastElectionResults(
  electionPeriodId: string
): Promise<PastElectionResults | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_past_election_results_rpc", {
    p_election_period_id: electionPeriodId,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const results = mapPastElectionResults(data);
  // 081 — annotate the record with the tie/complaint facts; a failure here
  // must never hide the tally itself.  099 — the complaint record joins the
  // same best-effort pass.
  try {
    const annotations = await getProclamationAnnotations(electionPeriodId);
    results.election.complaintNote = annotations.complaintNote;
    results.election.decisionReason = annotations.decisionReason;
    for (const position of results.positions) {
      // 117 — a Grade Level Representative position can carry TWO
      // proclamation rows; a tie annotation on any of them flags the
      // position, and the first recorded tie-break note wins.
      const tie = annotations.ties.find((t) => t.position === position.position && t.wasTie);
      if (tie) {
        position.wasTie = true;
        position.tieBreakNote = tie.tieBreakNote;
      }
    }
    results.election.complaints = await getElectionComplaintRecordRpc(electionPeriodId);
  } catch {
    /* the annotations are an addition to the record, never a gate */
  }
  return results;
}

/**
 * 085 — one complaint frozen into a period's archive.  Unlike the tally
 * snapshots this table is admin-only (its RLS mirrors the 028 complaints
 * rule: `current_app_role() = 'admin'`), so any other session simply
 * reads zero rows.
 */
export interface PastArchivedComplaint {
  id: string;
  electionPeriodId: string;
  /** The live complaints.id at freeze time — traceability only, no FK. */
  complaintId?: string;
  studentName?: string;
  subject: string;
  description: string;
  status: "filed" | "accepted" | "rejected";
  submittedAt?: string;
  incidentDate?: string;
  resolutionNote?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  archivedDocumentUrl?: string;
}

export function mapPastArchivedComplaint(row: any): PastArchivedComplaint {
  return {
    id: row.id,
    electionPeriodId: row.election_period_id,
    complaintId: row.complaint_id || undefined,
    studentName: row.student_name || undefined,
    subject: row.subject || "",
    description: row.description || "",
    status:
      row.status === "accepted" || row.status === "rejected"
        ? row.status
        : "filed",
    submittedAt: row.submitted_at ? toDate(row.submitted_at) : undefined,
    incidentDate: row.incident_date ? toDate(row.incident_date) : undefined,
    resolutionNote: row.resolution_note || undefined,
    resolvedByName: row.resolved_by_name || undefined,
    resolvedAt: row.resolved_at ? toDate(row.resolved_at) : undefined,
    archivedDocumentUrl: row.archived_document_url || undefined,
  };
}

/**
 * 085 — every complaint the archive holds, for the Admin Archive page.
 * Rows only exist because an archive run froze them (publish, proclaim,
 * the manual Electoral-Board freeze, or a reset), so a complaint filed
 * on an election that was later reset survives here with the name it
 * had at freeze time.  Best-effort: an un-migrated database degrades to
 * an empty record, never an error.
 */
export async function listArchivedComplaints(): Promise<PastArchivedComplaint[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("past_election_complaints")
      .select("*")
      .order("submitted_at", { ascending: true });
    if (error) return [];
    return (data || []).map(mapPastArchivedComplaint);
  } catch {
    return [];
  }
}

/**
 * 092 — school-year labels for every election period, keyed by id.
 *
 * The Complaints Archive shows complaints from ALL elections, so each row
 * names the election it was filed under.  The app context only carries the
 * live period; this one-shot fetch covers the retired ones too.
 * Best-effort: failure degrades to an empty map, never an error.
 */
export async function listElectionPeriodLabels(): Promise<Record<string, string>> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from("election_periods")
      .select("id, school_year");
    if (error) return {};
    const labels: Record<string, string> = {};
    for (const row of data || []) {
      if (row?.id && row.school_year) labels[String(row.id)] = String(row.school_year);
    }
    return labels;
  } catch {
    return {};
  }
}

/**
 * The CURRENT election's official results.
 *
 * Resolves the live, published, not-yet-superseded period (the row still
 * sitting at lifecycle_stage = 'results') and returns its tally, or null
 * when nothing has been published yet.  A result leaves this view only
 * when the Commissioner creates a new election (the period is then marked
 * 'completed' and moves to Past Elections).
 */
export async function getOfficialResults(): Promise<PastElectionResults | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("election_periods")
    .select("id")
    .neq("lifecycle_stage", "completed")
    .eq("results_published", true)
    .eq("is_active", false)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  return getPastElectionResults(data.id as string);
}

export async function openElectionRpc(pElectionId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("open_election_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

export async function forceOpenVotingRpc(pElectionId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("force_open_voting_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

export async function closeElectionRpc(pElectionId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("close_election_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Resume a paused vote (084).  Requires the caller's own Electoral Board
 * password — the RPC verifies it server-side before flipping is_active.
 */
export async function reopenVotingRpc(pElectionId: string, password: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("reopen_voting_rpc", {
    p_election_id: pElectionId,
    p_password: password,
  });
  if (error) throw new Error(error.message);
}

/**
 * Finalize the Voting Stage into Stage 5 (084).  Requires the caller's own
 * Electoral Board password — verified server-side by the RPC.
 */
export async function endVotingStageRpc(pElectionId: string, password: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("end_voting_stage_rpc", {
    p_election_id: pElectionId,
    p_password: password,
  });
  if (error) throw new Error(error.message);
}

/**
 * Void the election (113).  Deletes every recorded vote of the period and
 * returns the SAME period to the Voting Stage, paused — Stage 1-3 records,
 * candidates, complaints and the schedule are untouched.  Requires the
 * caller's own Electoral Board password — verified server-side by the RPC.
 * Only possible before the results are published / winners proclaimed.
 */
export async function voidElectionRpc(pElectionId: string, password: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("void_election_rpc", {
    p_election_id: pElectionId,
    p_password: password,
  });
  if (error) throw new Error(error.message);
}

export async function publishResultsRpc(pElectionId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("publish_results_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

/**
 * 069 — one row of the running order for a position.  Zero-vote candidates
 * are included so the Election Plan tab can render every position and spot
 * an all-zero tie; the caller ranks within a position.
 */
export interface ProclamationTallyRow {
  position: string;
  candidateId: string;
  candidateName: string;
  partyName: string | null;
  votes: number;
}

export async function getProclamationTallyRpc(electionId: string): Promise<ProclamationTallyRow[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("get_proclamation_tally_rpc", {
    p_election_id: electionId,
  });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    position: row.position,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name,
    partyName: row.party_name ?? null,
    votes: Number(row.votes) || 0,
  }));
}

/** How the Electoral Board resolves a tied position before proclaiming,
 *  and — 117 — affirms a default winner when a complaint is on record.
 *  081 — the pick records how the tie was resolved (e.g. "Coin Toss").
 *  117 — Grade Level Representative positions elect TWO winners: a manual
 *  resolution names the Board's pick(s) in candidateIds (1 for a single
 *  seat, 2 for a 3+-way Grade Rep tie), while a 2-way Grade Rep tie
 *  proclaims BOTH automatically and needs no resolution at all. */
export type TieResolution = {
  /** 'manual' when the board picked the winner(s) of a tied position. */
  method?: "manual";
  /** The board's pick(s) among the tied candidates. */
  candidateIds?: string[];
  /** How the tie was resolved — the one shared decision (085b). */
  tieBreak?: string;
  /** 117 — the board affirmed the default (highest-vote) winner stands
   *  despite the complaint on record. */
  remainWinner?: boolean;
};

export interface ProclaimedWinner {
  position: string;
  winnerName: string;
  votes: number;
  /** 'manual' when the seat was a Board-resolved tie, 'tie_both' when a
   *  2-way Grade Level Representative tie proclaimed both winners, else
   *  null for a default winner. */
  resolutionMethod: string | null;
  /** 117 — the Board affirmed this default winner stands ("Remain
   *  Winner") because a complaint was on record. */
  remainWinner?: boolean;
  /** Candidate photo (public storage URL) for the Stage 5 winners grid. */
  picture?: string | null;
  /** Winner's candidate row id — present on rows read back from the ledger. */
  candidateId?: string | null;
  /** The party the winner ran under (null for an Independent) — shown on
   *  the Stage 5 winners grid beside the name. */
  partyName?: string | null;
  /** The moment this winner's proclamation was recorded (the ledger's
   *  own stamp) — the certificate date line prefers it over the period's
   *  stamp, so the certificate never falls back to the download date. */
  proclaimedAt?: string;
}

/**
 * 069 — proclaim the winners.  117 — Grade Level Representative positions
 * elect TWO winners: a unique 1-2 finish or a 2-way top tie proclaims both
 * automatically, while a 3+-way tie (or a tie for the remaining seat) must
 * carry a manual resolution naming the Board's pick(s).  A single-seat tie
 * keeps the 069 behavior: exactly one of the tied candidates must be named.
 * When ANY complaint is on record, every default (highest-vote) winner must
 * be affirmed with remainWinner — the RPC rejects the proclamation
 * otherwise.  081 adds the per-tie how-resolved text and the board's
 * complaint note.  The RPC's other optional params (p_decision_reason) are
 * simply left at their defaults.
 */
export async function proclaimWinnersRpc(
  pElectionId: string,
  resolutions: Record<string, TieResolution> = {},
  decision?: { complaintNote?: string; decisionReason?: string },
): Promise<ProclaimedWinner[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const payload: Record<
    string,
    { method?: string; candidate_id?: string; candidate_ids?: string[]; tie_break?: string; remain_winner?: boolean }
  > = {};
  for (const [position, resolution] of Object.entries(resolutions)) {
    const entry: (typeof payload)[string] = {};
    if (resolution.method === "manual" && resolution.candidateIds?.length) {
      entry.method = "manual";
      entry.candidate_ids = resolution.candidateIds;
      entry.tie_break = resolution.tieBreak || undefined;
    }
    if (resolution.remainWinner) {
      entry.remain_winner = true;
    }
    payload[position] = entry;
  }
  const { data, error } = await supabase.rpc("proclaim_winners_rpc", {
    p_election_id: pElectionId,
    p_resolutions: payload,
    // 097/114 — the one-time Complaint Resolution and Justification
    // (required whenever ANY Findings decision — Substantiated,
    // Unsubstantiated, or Dismissed — is on record; blank otherwise).
    p_decision_reason: decision?.decisionReason || null,
    p_complaint_note: decision?.complaintNote || null,
  });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    position: row.winning_position,
    winnerName: row.winner_name,
    votes: row.votes,
    resolutionMethod: row.resolution_method ?? null,
  }));
}

/**
 * Read the proclaimed winners back from the `proclamations` ledger.  The RPC
 * above only returns them at the moment of proclaiming — the admin setup
 * page holds them in component state, so a page reload would blank the
 * Stage 5 grid even though the rows persist forever.  This rehydrates them,
 * joining the candidate row for the display name (same order as the RPC:
 * given name then surname), the public photo URL and the party name through
 * the candidate's `parties` FK.  Soft-fails to an empty list so an
 * un-migrated database can never break the page — the fallback text covers
 * the gap.
 */
export async function getProclaimedWinners(
  electionPeriodId: string
): Promise<ProclaimedWinner[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("proclamations")
      .select(
        "winning_position, candidate_id, votes, resolution_method, remain_winner, proclaimed_at, " +
        "candidates(surname, given_name, picture_url, parties(name))"
      )
      .eq("election_period_id", electionPeriodId)
      .order("winning_position");
    if (error) return [];
    return (data || []).map((row: any) => {
      const cand = row.candidates;
      return {
        position: row.winning_position,
        winnerName: cand ? `${cand.given_name} ${cand.surname}`.trim() : "",
        votes: row.votes,
        resolutionMethod: row.resolution_method ?? null,
        remainWinner: row.remain_winner === true,
        candidateId: row.candidate_id || null,
        picture: cand?.picture_url || null,
        partyName: cand?.parties?.name ?? null,
        proclaimedAt: row.proclaimed_at || undefined,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// 058 + 060 — election lifecycle stages
// ---------------------------------------------------------------------

/**
 * Re-read the live election period from the database.
 *
 * The lifecycle RPCs are authoritative and can do things the local state
 * cannot know about — start_candidacy_period_rpc may CREATE a period with a
 * brand new id, and reset_election_plan_rpc may retire the current one. So
 * every caller re-reads instead of guessing what the row now looks like.
 *
 * Returns the empty period when nothing is configured, so callers never have
 * to null-check.
 */
export async function reloadElectionPeriod(): Promise<ElectionPeriod> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("election_periods")
    .select("*")
    .neq("lifecycle_stage", "completed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapElectionPeriod(data) : emptyElectionPeriod;
}

/** Stage 1: open the Candidate Application Period, creating the period if needed. */
export async function startCandidacyPeriodRpc(schoolYear?: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("start_candidacy_period_rpc", {
    p_school_year: schoolYear || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The election period could not be started.");
  return String(data);
}

/** Stage 1: save (or re-save) the Rules Discussion meeting.  The RPC refuses
 *  once the Application Stage has ended — the schedule locks with the stage. */
export async function saveMeetingScheduleRpc(
  pElectionId: string,
  meetingAtIso: string
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("save_meeting_schedule_rpc", {
    p_election_id: pElectionId,
    p_meeting_at: meetingAtIso,
  });
  if (error) throw new Error(error.message);
}

/** Stage 1: end the Application Stage.  Applications close for the rest of
 *  the election and the lifecycle moves to the Campaign Stage.  One-way; the
 *  RPC requires the meeting to be saved first. */
export async function endCandidacyPeriodRpc(pElectionId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("end_candidacy_period_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

/** Stage 3 (060): open the Fingerprint Registration window at the kiosks. */
export async function startFingerprintRegistrationRpc(
  pElectionId: string,
  startAtIso?: string | null,
  endAtIso?: string | null
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("start_fingerprint_registration_rpc", {
    p_election_id: pElectionId,
    p_start_at: startAtIso || null,
    p_end_at: endAtIso || null,
  });
  if (error) throw new Error(error.message);
}

/** Stage 3 (060): close the Fingerprint Registration window early. */
export async function closeFingerprintRegistrationRpc(pElectionId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("close_fingerprint_registration_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

/** Stop the Campaign Period early (080): advance straight to the Fingerprint
 *  Registration stage without opening an enrolment window. */
export async function stopCampaignRpc(pElectionId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("stop_campaign_rpc", {
    p_election_id: pElectionId,
  });
  if (error) throw new Error(error.message);
}

/** Stage 2 (093): record the Campaign Period window.  The RPC is the only
 *  writer of `campaign_start_at` / `campaign_end_at` — it guards the stage
 *  (the election must still be in the 'campaign' stage) and the commissioner
 *  role, and it writes the audit row inside the transaction. */
export async function saveCampaignWindowRpc(
  pElectionId: string,
  startAtIso: string,
  endAtIso: string,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("save_campaign_window_rpc", {
    p_election_id: pElectionId,
    p_campaign_start_at: startAtIso,
    p_campaign_end_at: endAtIso,
  });
  if (error) throw new Error(error.message);
}

/** Filed (unresolved) complaints for one election period — the Stage 4 banner count. */
export async function countActiveComplaintsRpc(pElectionId: string): Promise<number> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("count_active_complaints_rpc", {
    p_election_period_id: pElectionId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface ResetElectionPlanResult {
  /** Null when the reset archived the period without starting a new one —
   * the School Year is then set in Stage 1, which creates the period. */
  electionPeriodId: string | null;
  archivedPrevious: boolean;
  archivedElectionPeriodId?: string;
  schoolYear?: string;
  /**
   * "cleared" = reset in place, "archived" = old period retired,
   * "started" = a new period was created in the same transaction,
   * "noop" = nothing was in progress.
   */
  mode: "cleared" | "archived" | "started" | "noop";
}

/**
 * Reset the whole election plan.  Requires the caller's own Electoral Board
 * password — the RPC verifies it server-side and nothing is ever deleted.
 */
export async function resetElectionPlanRpc(
  password: string,
  schoolYear?: string
): Promise<ResetElectionPlanResult> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("reset_election_plan_rpc", {
    p_password: password,
    p_school_year: schoolYear || null,
  });
  if (error) throw new Error(error.message);
  const row = (data || {}) as Record<string, unknown>;
  return {
    electionPeriodId: row.election_period_id ? String(row.election_period_id) : null,
    archivedPrevious: Boolean(row.archived_previous),
    archivedElectionPeriodId: row.archived_election_period_id
      ? String(row.archived_election_period_id)
      : undefined,
    schoolYear: row.school_year ? String(row.school_year) : undefined,
    mode: (row.mode as ResetElectionPlanResult["mode"]) || "cleared",
  };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.some((cell) => cell.trim()));
}