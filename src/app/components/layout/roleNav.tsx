import type { ReactNode } from "react";
import {
  LayoutDashboard, Users, UserCheck, FileText,
  AlertCircle, UserPlus, Trophy, HelpCircle, Activity,
  Archive, FolderArchive, Settings, Eye, Home, GraduationCap,
  CalendarDays,
} from "lucide-react";
import type { CommissionerRole, UserRole } from "../../context/AppContext";

/**
 * Single source of truth for per-role navigation — the dashboard sidebar and
 * the public header's user dropdown both render from these lists, so the two
 * surfaces can never drift apart.
 */

export interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

// Placement rule: every role's tab list keeps "Election Calendar" directly
// above the profile tab — the calendar is the last tab before "My Profile"
// in both the dashboard sidebar and the header's user dropdown.
export const studentNavItems: NavItem[] = [
  { label: "Dashboard", href: "/student/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "View Candidates", href: "/student/candidates", icon: <Users size={18} /> },
  { label: "Apply for Candidacy", href: "/student/apply", icon: <UserPlus size={18} /> },
  { label: "My Complaints", href: "/student/complaints", icon: <AlertCircle size={18} /> },
  { label: "Election Calendar", href: "/student/calendar", icon: <CalendarDays size={18} /> },
  { label: "My Profile", href: "/student/profile", icon: <UserCheck size={18} /> },
];

export const chiefTopItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Officer Management", href: "/admin/officers", icon: <UserPlus size={18} /> },
  { label: "Election Reports", href: "/admin/reports", icon: <FileText size={18} /> },
  { label: "Live Results", href: "/admin/live-results", icon: <Eye size={18} /> },
  { label: "All System Logs", href: "/admin/logs", icon: <Activity size={18} /> },
  { label: "Election Calendar", href: "/admin/calendar", icon: <CalendarDays size={18} /> },
  { label: "Admin Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
  { label: "Homepage Setting", href: "/admin/homepage-settings", icon: <Home size={18} /> },
];

// v1.2 (Chief's request): the other commissioners' tab groups
// (Screening & Validation, Electoral Board, Grievance) are REMOVED from
// the Chief's sidebar — those tabs stay available to the commissioners
// themselves via their own role navs below.
export const sslgAdviserTopItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Student Enrollment", href: "/admin/students", icon: <GraduationCap size={18} /> },
  { label: "System Logs", href: "/admin/logs", icon: <Activity size={18} /> },
  { label: "Election Calendar", href: "/admin/calendar", icon: <CalendarDays size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

export const screeningNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Candidates Review", href: "/admin/candidates", icon: <Trophy size={18} /> },
  { label: "Candidates Archived Document", href: "/admin/archive", icon: <Archive size={18} /> },
  { label: "Election Calendar", href: "/admin/calendar", icon: <CalendarDays size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

export const electoralNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Election Setup", href: "/admin/election", icon: <Settings size={18} /> },
  { label: "Live Results", href: "/admin/live-results", icon: <Eye size={18} /> },
  { label: "Election Calendar", href: "/admin/calendar", icon: <CalendarDays size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

export const grievanceNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Complaints", href: "/admin/complaints", icon: <AlertCircle size={18} /> },
  { label: "Complaints Archive", href: "/admin/complaints-archive", icon: <FolderArchive size={18} /> },
  { label: "Election Help Desk", href: "/admin/help-desk", icon: <HelpCircle size={18} /> },
  { label: "Election Calendar", href: "/admin/calendar", icon: <CalendarDays size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

export const roleConfig: Record<NonNullable<UserRole>, { items: NavItem[]; label: string; color: string }> = {
  student: { items: studentNavItems, label: "Student Portal", color: "#5C0102" },
  admin: { items: [], label: "Admin Portal", color: "#5C0102" },
  sslg_adviser: { items: [], label: "SSLG Adviser Portal", color: "#5C0102" },
};

// 103: 'appointment' is a records-only designation (no login), so its nav
// never renders — the entries below exist only to satisfy the Record type.
export const commissionerNavMap: Record<CommissionerRole, NavItem[]> = {
  chief: chiefTopItems,
  screening_validation: screeningNavItems,
  electoral_board: electoralNavItems,
  grievance: grievanceNavItems,
  appointment: screeningNavItems,
};

export const commissionerLabelMap: Record<CommissionerRole, string> = {
  chief: "Chief Commissioner",
  screening_validation: "Commissioner of Screening & Validation",
  electoral_board: "Commissioner of Electoral Board",
  grievance: "Commissioner of Grievance",
  appointment: "Commissioner of Appointment",
};

// 103: co-commissioners sit under a primary, so their title names
// the primary's board (e.g. "Co-commissioner of Electoral Board").  The
// chief/appointment entries are unreachable for a signed-in co (103
// creation only accepts the three boards; the appointment designation is
// a records-only role_type='commissioner' with no login) — they exist to
// satisfy the Record type.
export const coCommissionerLabelMap: Record<CommissionerRole, string> = {
  chief: "Co-commissioner",
  screening_validation: "Co-commissioner of Screening & Validation",
  electoral_board: "Co-commissioner of Electoral Board",
  grievance: "Co-commissioner of Grievance",
  appointment: "Co-commissioner of Appointment",
};

/** Title shown under the user's name (sidebar header + profile dropdown). */
export function getUserRoleTitle(
  currentUser: { role: UserRole; commissionerRole?: CommissionerRole; isCoCommissioner?: boolean },
): string {
  if (currentUser.role === "admin" && currentUser.commissionerRole) {
    return currentUser.isCoCommissioner
      ? coCommissionerLabelMap[currentUser.commissionerRole]
      : commissionerLabelMap[currentUser.commissionerRole];
  }
  if (currentUser.role === "sslg_adviser") return "SSLG Adviser";
  if (currentUser.role === "student") return "Student";
  return "Admin";
}

/**
 * The signed-in user's own tabs — the same set the sidebar renders, chief and
 * SSLG Adviser special cases included.  (Students may further hide
 * "View Candidates" per the sidebar's candidacy rule; that filter needs live
 * app data, so callers apply it themselves.)
 */
export function getUserNavItems(
  currentUser: { role: UserRole; commissionerRole?: CommissionerRole },
): NavItem[] {
  if (currentUser.role === "admin") {
    if (currentUser.commissionerRole === "chief") return chiefTopItems;
    if (currentUser.commissionerRole) return commissionerNavMap[currentUser.commissionerRole];
    return [];
  }
  if (currentUser.role === "sslg_adviser") return sslgAdviserTopItems;
  if (currentUser.role === "student") return studentNavItems;
  return [];
}

/**
 * Where public "Election Calendar" links (homepage section + hero carousel,
 * header Resources, footer) should lead: a signed-in user lands on the
 * calendar inside their own portal, a guest gets the public page.  The SSLG
 * Adviser shares the admin calendar (DashboardLayout no longer blocks it).
 */
export function getCalendarHref(
  currentUser: { role: UserRole } | null | undefined,
): string {
  if (!currentUser) return "/calendar";
  if (currentUser.role === "student") return "/student/calendar";
  if (currentUser.role === "admin" || currentUser.role === "sslg_adviser") return "/admin/calendar";
  return "/calendar";
}

/** Sidebar portal label ("… Portal" / the commissioner's board title). */
export function getUserPortalLabel(
  currentUser: { role: UserRole; commissionerRole?: CommissionerRole },
): string {
  if (currentUser.role === "admin" && currentUser.commissionerRole) {
    return commissionerLabelMap[currentUser.commissionerRole];
  }
  return roleConfig[currentUser.role ?? "student"].label;
}
