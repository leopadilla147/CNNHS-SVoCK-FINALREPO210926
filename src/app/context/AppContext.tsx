import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  fetchSupabaseState,
  getCurrentProfileRpc,
  insertAuditLog,
  syncComplaints,
  syncElectionPeriod,
  syncStudents,
} from "../lib/supabaseData";
import { bootstrapSession, clearSessionToken } from "../lib/session";

export type UserRole = "student" | "admin" | "sslg_adviser" | null;
export type CommissionerRole =
  | "chief"
  | "screening_validation"
  | "electoral_board"
  | "grievance";

export interface CurrentUser {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  commissionerRole?: CommissionerRole;
  /** 030 forced-change flag (D-04): the next login must go through /change-password. */
  mustChangePassword: boolean;
}

export interface Student {
  id: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gradeLevel: string;
  gender: string;
  birthdate: string;
  lrn: string;
  status: "pending" | "approved" | "rejected";
  email?: string;
  password?: string;
  registeredAt: string;
  verificationStatus?: "autoApproved" | "forReview" | "blocked";
  mismatchCount?: number;
}

export interface StudentMasterlistEntry {
  id: string;
  lrn: string;
  firstName: string;
  lastName: string;
  birthdate: string;
  gradeLevel: string;
  gender?: string;
  schoolYear: string;
  enrollmentStatus: "enrolled" | "transferred" | "graduated" | "inactive";
  importedAt: string;
}

export interface Candidate {
  id: string;
  surname: string;
  givenName: string;
  middleName?: string;
  extensionName?: string;
  gradeLevel: string;
  position: string;
  partyAffiliation?: string;
  partyId?: string;
  gender: string;
  dateOfBirth: string;
  age: number;
  email: string;
  mobileNumber: string;
  landline?: string;
  homeAddress: string;
  parentGuardianName?: string;
  parentGuardianContact?: string;
  picture?: string;
  documents: {
    applicationForm: boolean;
    introductoryProfile: boolean;
    screeningForm: boolean;
    reportCard: boolean;
    goodMoralCert: boolean;
    eafFront?: boolean;
    eafBack?: boolean;
  };
  eafFrontImage?: string;
  eafBackImage?: string;
  positionApprovalStatus?: "notRequired" | "presidentApprovalRequired" | "presidentApproved";
  leadershipProfile?: {
    qualities: string;
    skills: string[];
    skillsExplanation: string;
    threeYearVision: string;
    makaDiyosProject?: string;
    makaDiyosDescription?: string;
    makaTaoProject?: string;
    makaTaoDescription?: string;
    makakalikasanProject?: string;
    makakalikasanDescription?: string;
    makabansaProject?: string;
    makabansaDescription?: string;
  };
  rejectionReason?: string;
  rejectionDetails?: string;
  rejectionTier?: "low" | "high";
  status: "ongoingSubmission" | "pending" | "approved" | "rejected";
  submittedAt: string;
  votes: number;
  studentId: string;
}

export interface Commissioner {
  id: string;
  name: string;
  email: string;
  role: CommissionerRole;
  status: "active" | "inactive";
  appointedAt: string;
}

export interface SslgAdviser {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface ElectionPeriod {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  isActive: boolean;
  venue?: string;
  candidacyOpen?: boolean;
  nominationOpen?: boolean;
  resultsPublished?: boolean;
  officialListPosted?: boolean;
  campaignStartDate?: string;
  campaignStartTime?: string;
  campaignEndDate?: string;
  campaignEndTime?: string;
  planFinalized?: boolean;
  proclaimed?: boolean;
  proclaimedAt?: string;
  /** 029 column: date/time of the rules discussion (Electoral Board/Chief sets it). */
  rulesDiscussionAt?: string;
  /** 029 column: fixed D-06 voting method ('plurality' default). */
  votingMethod?: string;
}

export interface Complaint {
  id: string;
  studentName: string;
  subject: string;
  description: string;
  status: "filed" | "accepted" | "rejected";
  submittedAt: string;
  rejectionReason?: string;
  incidentDate?: string;
  resolvedAt?: string;
}

export interface ReportTemplate {
  id: string;
  enclosure: string;
  title: string;
  ownerRole: CommissionerRole | "chief";
  category: "candidacy" | "grievance" | "results" | "audit" | "forms";
}

export interface KioskStatus {
  id: string;
  name: string;
  location: string;
  lastSeenAt?: string;
  syncStatus: "online" | "offline" | "syncing";
  queuedVotes: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  action: string;
  details: string;
  type: "info" | "warning" | "success" | "error";
}

export type NotificationType =
  | "candidacy_pending"
  | "candidacy_approved"
  | "candidacy_rejected"
  | "official_list_posted"
  | "nomination_received"
  | "nomination_status_changed"
  | "party_membership_request"
  | "party_membership_approved"
  | "party_membership_rejected"
  | "student_registered"
  | "student_approved"
  | "student_rejected"
  | "complaint_filed"
  | "complaint_resolved"
  | "election_opened"
  | "election_closed"
  | "results_published"
  | "submitted_to_chief"
  | "rules_discussion_meeting"
  | "admin_notification";

export interface AppNotification {
  id: string;
  userId: string;
  role: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface PartyMember {
  id: string;
  partyId: string;
  partyName?: string;
  studentId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  studentName?: string;
  studentGrade?: string;
}

interface AppContextType {
  currentUser: CurrentUser | null;
  setCurrentUser: (user: CurrentUser | null) => void;
  students: Student[];
  setStudents: (students: Student[]) => void;
  studentMasterlist: StudentMasterlistEntry[];
  setStudentMasterlist: (entries: StudentMasterlistEntry[]) => void;
  candidates: Candidate[];
  setCandidates: (candidates: Candidate[]) => void;
  commissioners: Commissioner[];
  setCommissioners: (commissioners: Commissioner[]) => void;
  electionPeriod: ElectionPeriod;
  setElectionPeriod: (period: ElectionPeriod) => Promise<{ ok: boolean; message?: string }>;
  complaints: Complaint[];
  setComplaints: (complaints: Complaint[]) => void;
  reportTemplates: ReportTemplate[];
  setReportTemplates: (reports: ReportTemplate[]) => void;
  kioskStatuses: KioskStatus[];
  setKioskStatuses: (statuses: KioskStatus[]) => void;
  logs: LogEntry[];
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  registeredLRNs: Set<string>;
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  insertNotification: (notif: Omit<AppNotification, "id" | "isRead" | "createdAt">) => void;
  partyMembers: PartyMember[];
  setPartyMembers: (members: PartyMember[]) => void;
  fetchPartyMembers: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const emptyElectionPeriod: ElectionPeriod = {
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  isActive: false,
  venue: "IoT biometric kiosk precinct",
  candidacyOpen: false,
  nominationOpen: false,
  resultsPublished: false,
  officialListPosted: false,
  campaignStartDate: "",
  campaignStartTime: "",
  campaignEndDate: "",
  campaignEndTime: "",
  planFinalized: false,
  proclaimed: false,
  proclaimedAt: "",
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    try {
      const saved = localStorage.getItem("svock_current_user");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [students, setStudentsState] = useState<Student[]>([]);
  const [studentMasterlist, setStudentMasterlist] = useState<StudentMasterlistEntry[]>([]);
  const [candidates, setCandidatesState] = useState<Candidate[]>([]);
  const [commissioners, setCommissioners] = useState<Commissioner[]>([]);
  const [electionPeriod, setElectionPeriodState] = useState<ElectionPeriod>(emptyElectionPeriod);
  const [complaints, setComplaintsState] = useState<Complaint[]>([]);
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [kioskStatuses, setKioskStatuses] = useState<KioskStatus[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [partyMembers, setPartyMembersState] = useState<PartyMember[]>([]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const registeredLRNs = new Set(students.map((s) => s.lrn));

  const loadSupabaseState = async () => {
    const state = await fetchSupabaseState();
    if (!state) return;

    setStudentsState(state.students);
    setStudentMasterlist(state.studentMasterlist);
    setCandidatesState(state.candidates);
    setCommissioners(state.commissioners);
    setElectionPeriodState(state.electionPeriod || emptyElectionPeriod);
    setComplaintsState(state.complaints);
    setReportTemplates(state.reportTemplates);
    setKioskStatuses(state.kioskStatuses);
    setLogs(state.logs);
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    loadSupabaseState();
  }, []);

  // Session bootstrap (phase-02 spine): when a saved user exists, validate
  // the saved session token against the server once per mount.  A dead
  // token clears the user and redirects to login with a notice; a missing
  // token (legacy admin/officer/adviser sessions, until 023 mints them)
  // keeps the saved user untouched.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!currentUser?.id) return;

    let cancelled = false;
    bootstrapSession(supabase).then(async ({ valid, expired }) => {
      if (cancelled) return;
      if (expired) {
        localStorage.removeItem("svock_current_user");
        setCurrentUser(null);
        window.location.assign("/login?notice=session_expired");
        return;
      }
      if (valid) {
        // D-14 refresh-safe gate: the forced-change flag lives in the
        // stored user blob AND is re-read from the server on every mount,
        // so a page refresh can never bypass /change-password.
        try {
          const profile = await getCurrentProfileRpc();
          if (cancelled || !profile) return;
          if (profile.must_change_password !== currentUser.mustChangePassword) {
            const merged: CurrentUser = {
              ...currentUser,
              name: profile.full_name || currentUser.name,
              email: profile.email || currentUser.email,
              mustChangePassword: profile.must_change_password,
            };
            localStorage.setItem("svock_current_user", JSON.stringify(merged));
            setCurrentUser(merged);
          }
        } catch {
          // Profile refresh is best-effort; the stored flag still gates.
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  // D-05 cross-tab logout sync: when another tab removes the token or the
  // saved user (or clears localStorage), this tab logs out too. Read-only —
  // the handler only reads the watched keys and never touches session.ts
  // primitives (AUTH-04 single-writer rule).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const keyedRemoval =
        (e.key === "svock_session_token" || e.key === "svock_current_user") &&
        e.newValue === null;
      const clearRemoval =
        e.key === null &&
        localStorage.getItem("svock_session_token") === null &&
        localStorage.getItem("svock_current_user") === null;
      if (!keyedRemoval && !clearRemoval) return;

      // Re-read CURRENT storage before acting: a queued removal event can
      // arrive after this tab has already logged in again, and a fresh
      // session (either key present) must not be bounced.
      if (
        localStorage.getItem("svock_session_token") !== null ||
        localStorage.getItem("svock_current_user") !== null
      ) {
        return;
      }

      setCurrentUser(null);
      window.location.assign("/login?notice=session_expired");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setStudents = (next: Student[]) => {
    setStudentsState((previous) => {
      if (isSupabaseConfigured) void syncStudents(next, previous);
      return next;
    });
  };

  const setCandidates = (next: Candidate[]) => {
    setCandidatesState(next);
  };

  const setElectionPeriod = (period: ElectionPeriod) => {
    setElectionPeriodState(period);
    if (isSupabaseConfigured) return syncElectionPeriod(period);
    return Promise.resolve({ ok: true });
  };

  const setComplaints = (next: Complaint[]) => {
    setComplaintsState((previous) => {
      if (isSupabaseConfigured) void syncComplaints(next, previous);
      return next;
    });
  };

  const addLog = (entry: Omit<LogEntry, "id" | "timestamp">) => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setLogs((prev) => [{ ...entry, id: `l${Date.now()}`, timestamp }, ...prev]);
    if (isSupabaseConfigured) void insertAuditLog(entry, currentUser?.id);
  };

  const markAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    if (isSupabaseConfigured) {
      supabase!.rpc("mark_notification_read_rpc", { p_notification_id: id }).then(() => {}, () => {});
    }
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    if (isSupabaseConfigured && currentUser?.id) {
      supabase!.rpc("mark_all_notifications_read_rpc", { p_user_id: currentUser.id }).then(() => {}, () => {});
    }
  };

  const insertNotification = (notif: Omit<AppNotification, "id" | "isRead" | "createdAt">) => {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const full: AppNotification = { ...notif, id, isRead: false, createdAt };
    setNotifications((prev) => [full, ...prev]);
    if (isSupabaseConfigured) {
      supabase!.rpc("insert_notification_rpc", {
        p_user_id: notif.userId,
        p_role: notif.role,
        p_type: notif.type,
        p_title: notif.title,
        p_message: notif.message,
        p_link: notif.link || null,
      }).then(() => {}, () => {});
    }
  };

  const setPartyMembers = (next: PartyMember[]) => {
    setPartyMembersState(next);
  };

  const fetchPartyMembers = async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase
      .from("party_members")
      .select("*, students(first_name, last_name, grade_level), parties(name)")
      .order("requested_at", { ascending: false });
    if (data) {
      setPartyMembersState(data.map((row: any) => ({
        id: row.id,
        partyId: row.party_id,
        partyName: row.parties?.name || undefined,
        studentId: row.student_id,
        status: row.status,
        requestedAt: row.requested_at,
        reviewedBy: row.reviewed_by || undefined,
        reviewedAt: row.reviewed_at || undefined,
        studentName: row.students ? `${row.students.first_name} ${row.students.last_name}` : undefined,
        studentGrade: row.students?.grade_level || undefined,
      })));
    }
  };

  const fetchNotifications = async () => {
    if (!isSupabaseConfigured || !supabase || !currentUser?.id) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) {
      setNotifications(data.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        role: row.role,
        type: row.type,
        title: row.title,
        message: row.message,
        link: row.link || undefined,
        isRead: row.is_read,
        createdAt: row.created_at,
      })));
    }
  };

  useEffect(() => {
    if (currentUser?.id) {
      fetchNotifications();
      fetchPartyMembers();
    }
  }, [currentUser?.id]);

  const persistCurrentUser = useCallback((user: CurrentUser | null) => {
    if (user) localStorage.setItem("svock_current_user", JSON.stringify(user));
    else {
      localStorage.removeItem("svock_current_user");
      // A session token must never outlive the user session it belongs to;
      // this single point covers every logout path (sidebar, header, navbar).
      clearSessionToken();
    }
    setCurrentUser(user);
  }, []);

  return (
    <AppContext.Provider value={{
      currentUser,
      setCurrentUser: persistCurrentUser,
      students,
      setStudents,
      studentMasterlist,
      setStudentMasterlist,
      candidates,
      setCandidates,
      commissioners,
      setCommissioners,
      electionPeriod,
      setElectionPeriod,
      complaints,
      setComplaints,
      reportTemplates,
      setReportTemplates,
      kioskStatuses,
      setKioskStatuses,
      logs,
      addLog,
      registeredLRNs,
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      insertNotification,
      partyMembers,
      setPartyMembers,
      fetchPartyMembers,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}
