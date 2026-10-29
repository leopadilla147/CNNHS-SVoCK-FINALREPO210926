import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard, Users, UserCheck, FileText, BarChart2,
  AlertCircle, LogOut, Menu, X,
  Shield, GraduationCap, ChevronRight, Activity, UserPlus, Trophy,
  HelpCircle, UserCog, Archive, FolderArchive, Settings, Eye, Home,
} from "lucide-react";
import { useApp, UserRole, CommissionerRole } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { NotificationBell } from "../notifications/NotificationBell";
import cnnhsLogo from "../../assets/CNNHS_Logo1.png";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const studentNavItems: NavItem[] = [
  { label: "Dashboard", href: "/student/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "View Candidates", href: "/student/candidates", icon: <Users size={18} /> },
  { label: "Apply for Candidacy", href: "/student/apply", icon: <UserPlus size={18} /> },
  { label: "My Complaints", href: "/student/complaints", icon: <AlertCircle size={18} /> },
  { label: "My Profile", href: "/student/profile", icon: <UserCheck size={18} /> },
];

const chiefTopItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Officer Management", href: "/admin/officers", icon: <UserPlus size={18} /> },
  { label: "Election Reports", href: "/admin/reports", icon: <FileText size={18} /> },
  { label: "Live Results", href: "/admin/live-results", icon: <Eye size={18} /> },
  { label: "All System Logs", href: "/admin/logs", icon: <Activity size={18} /> },
  { label: "Admin Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
  { label: "Homepage Setting", href: "/admin/homepage-settings", icon: <Home size={18} /> },
];

// v1.2 (Chief's request): the other commissioners' tab groups
// (Screening & Validation, Electoral Board, Grievance) are REMOVED from
// the Chief's sidebar — those tabs stay available to the commissioners
// themselves via their own role navs below.
const sslgAdviserTopItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Student Enrollment", href: "/admin/students", icon: <GraduationCap size={18} /> },
  { label: "System Logs", href: "/admin/logs", icon: <Activity size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

const screeningNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Candidates Review", href: "/admin/candidates", icon: <Trophy size={18} /> },
  { label: "Candidates Archived Document", href: "/admin/archive", icon: <Archive size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

const electoralNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Election Setup", href: "/admin/election", icon: <Settings size={18} /> },
  { label: "Live Results", href: "/admin/live-results", icon: <Eye size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

const grievanceNavItems: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Complaints", href: "/admin/complaints", icon: <AlertCircle size={18} /> },
  { label: "Complaints Archive", href: "/admin/complaints-archive", icon: <FolderArchive size={18} /> },
  { label: "Election Help Desk", href: "/admin/help-desk", icon: <HelpCircle size={18} /> },
  { label: "My Profile", href: "/admin/profile", icon: <UserCheck size={18} /> },
];

const roleConfig: Record<NonNullable<UserRole>, { items: NavItem[]; label: string; color: string }> = {
  student: { items: studentNavItems, label: "Student Portal", color: "#5C0102" },
  admin: { items: [], label: "Admin Portal", color: "#5C0102" },
  sslg_adviser: { items: [], label: "SSLG Adviser Portal", color: "#5C0102" },
};

// 103: 'appointment' is a records-only designation (no login), so its nav
// never renders — the entries below exist only to satisfy the Record type.
const commissionerNavMap: Record<CommissionerRole, NavItem[]> = {
  chief: chiefTopItems,
  screening_validation: screeningNavItems,
  electoral_board: electoralNavItems,
  grievance: grievanceNavItems,
  appointment: screeningNavItems,
};

const commissionerLabelMap: Record<CommissionerRole, string> = {
  chief: "Chief Commissioner",
  screening_validation: "Commissioner of Screening & Validation",
  electoral_board: "Commissioner of Electoral Board",
  grievance: "Commissioner of Grievance",
  appointment: "Commissioner of Appointment",
};

export function DashboardSidebar() {
  const { currentUser, setCurrentUser, candidates, electionPeriod, students } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!currentUser || !currentUser.role) return null;

  const isChief = currentUser.role === "admin" && currentUser.commissionerRole === "chief";
  const isSslgAdviser = currentUser.role === "sslg_adviser";

  let navItems: NavItem[];
  let portalLabel: string;

  if (currentUser.role === "admin" && currentUser.commissionerRole) {
    navItems = commissionerNavMap[currentUser.commissionerRole];
    portalLabel = commissionerLabelMap[currentUser.commissionerRole];
  } else {
    const config = roleConfig[currentUser.role];
    navItems = config.items;
    portalLabel = config.label;
  }

  const hasApprovedCandidacy = candidates.some((c) => c.studentId === currentUser?.id && c.status === "approved");
  const hasCandidacy = candidates.some((c) => c.studentId === currentUser?.id);

  // 072/073: the signed-in user's photo (when set) instead of the initial.
  // Students resolve theirs off the students list (live after an upload);
  // staff read it off currentUser (073 profile RPC refresh).  `students`
  // is absent in some test stubs, hence ?.  Photo-less users keep the
  // initial.
  const avatarPictureUrl =
    currentUser.role === "student"
      ? students?.find((s) => s.id === currentUser.id)?.profilePictureUrl
      : currentUser.profilePictureUrl;

  const logoutConfirm = useConfirm({
    title: "Logout?",
    description: "Are you sure you want to logout of the voting system?",
    confirmText: "Logout",
    cancelText: "Cancel",
    destructive: true,
  });

  const handleLogout = async () => {
    const ok = await logoutConfirm.confirm();
    if (!ok) return;
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
    navigate("/");
  };

  const SidebarContent = () => (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 overflow-hidden">
            {avatarPictureUrl ? (
              <img src={avatarPictureUrl} alt="" className="w-10 h-10 object-cover" />
            ) : (
              currentUser.name.charAt(0)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-sm font-medium truncate">{currentUser.name}</div>
            <div className="text-white/60 text-xs capitalize">
              {currentUser.commissionerRole
                ? commissionerLabelMap[currentUser.commissionerRole]
                : currentUser.role}
            </div>
          </div>
          <NotificationBell align="left" />
        </div>
      </div>

      {/* Portal Label */}
      <div className="px-5 pt-5 pb-2">
        <span className="text-white/40 text-xs uppercase tracking-widest">{portalLabel}</span>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto pb-4">
        {isChief || isSslgAdviser ? (
          <>
            {(isChief ? chiefTopItems : sslgAdviserTopItems).map((item) => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${
                    active
                      ? "bg-white text-[#5C0102] font-medium shadow-sm"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className={active ? "text-[#5C0102]" : ""}>{item.icon}</span>
                  <span>{item.label}</span>
                  {active && <ChevronRight size={14} className="ml-auto" />}
                </Link>
              );
            })}
          </>
        ) : (
          navItems
            .filter((item) => {
              if (currentUser.role === "student" && item.href === "/student/candidates" && !hasCandidacy && !electionPeriod.officialListPosted) {
                return false;
              }
              if (currentUser.role === "student" && item.href === "/student/candidates" && hasApprovedCandidacy) {
                return true;
              }
              return true;
            })
            .map((item) => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${
                    active
                      ? "bg-white text-[#5C0102] font-medium shadow-sm"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className={active ? "text-[#5C0102]" : ""}>{item.icon}</span>
                  <span>{item.label}</span>
                  {active && <ChevronRight size={14} className="ml-auto" />}
                </Link>
              );
            })
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-sm"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 h-screen flex-shrink-0 sticky top-0"
        style={{ backgroundColor: "#5C0102" }}
      >
        {/* Logo */}
        <div className="p-5 border-b border-white/10">
          <Link to="/" className="flex items-center gap-2">
            <img src={cnnhsLogo} alt="CNNHS Logo" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            <div>
              <div className="text-white text-xs font-bold leading-tight">Camarines Norte NHS</div>
              <div className="text-white/50 text-xs">Voting System</div>
            </div>
          </Link>
        </div>
        <SidebarContent />
      </aside>

      {/* Mobile Top Bar */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 shadow-md"
        style={{ backgroundColor: "#5C0102" }}
      >
        <Link to="/" className="flex items-center gap-2">
          <img src={cnnhsLogo} alt="CNNHS Logo" className="w-7 h-7 rounded-full object-cover" />
          <span className="text-white text-sm font-bold">Voting System</span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button onClick={() => setMobileOpen(true)} className="text-white p-1">
            <Menu size={22} />
          </button>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside
            className="relative w-72 flex flex-col h-full shadow-xl"
            style={{ backgroundColor: "#5C0102" }}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <Link to="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                <img src={cnnhsLogo} alt="CNNHS Logo" className="w-7 h-7 rounded-full object-cover" />
                <span className="text-white text-sm font-bold">Voting System</span>
              </Link>
              <button onClick={() => setMobileOpen(false)} className="text-white/70 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}
      {logoutConfirm.dialog}
    </>
  );
}