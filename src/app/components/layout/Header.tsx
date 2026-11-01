import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Menu,
  X,
  LogOut,
  User,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { getCalendarHref, getUserNavItems, getUserRoleTitle, type NavItem } from "./roleNav";
import { useConfirm } from "../../lib/useConfirm";
import cnnhsLogo from "../../assets/CNNHS_Logo1.png";

/** Every dropdown shut — the state each "close all" path returns to. */
const CLOSED_DROPDOWNS = {
  results: false,
  resources: false,
  user: false,
};

export function Header() {
  const { currentUser, setCurrentUser, students, candidates, electionPeriod } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdowns, setDropdowns] = useState(CLOSED_DROPDOWNS);

  // The desktop bar and the mobile panel are siblings, so the outside-click
  // check needs a ref for each.
  const headerRef = useRef<HTMLElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

  /** Close every menu — used by outside click, Escape and navigation. */
  const closeAll = () => {
    setDropdowns(CLOSED_DROPDOWNS);
    setMobileOpen(false);
  };

  // Clicking away or pressing Escape closes whatever is open.
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (headerRef.current?.contains(target) || mobilePanelRef.current?.contains(target)) {
        return;
      }
      closeAll();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Following a link must not leave a menu dangling over the new page.
  useEffect(() => {
    closeAll();
  }, [pathname]);

  // Logout asks first — same wording as the dashboard sidebar's confirm.
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
    closeAll();
  };

  const getDashboardLink = () => {
    if (!currentUser) return "/";
    if (currentUser.role === "student") return "/student/dashboard";
    if (currentUser.role === "admin") return "/admin/dashboard";
    return "/";
  };

  // Opening one menu closes the others: only a single panel is ever open.
  const toggleDropdown = (dropdownName: keyof typeof dropdowns) => {
    setDropdowns((prev) => ({
      ...CLOSED_DROPDOWNS,
      [dropdownName]: !prev[dropdownName],
    }));
  };

  // 072/073: the signed-in user's photo (when set) instead of the initial.
  // Students resolve theirs off the students list (live after an upload);
  // staff read it off currentUser (073 profile RPC refresh).  Photo-less
  // users keep the initial.
  const avatarPictureUrl =
    currentUser?.role === "student"
      ? students?.find((s) => s.id === currentUser.id)?.profilePictureUrl
      : currentUser?.profilePictureUrl;

  // The signed-in user's profile page — students have their own, staff share
  // the admin one.  It is the dropdown's "My Profile" entry, so the profile
  // hrefs are filtered out of the tab list below (no duplicate).
  const profileHref = !currentUser
    ? "/"
    : currentUser.role === "student"
      ? "/student/profile"
      : "/admin/profile";

  // The signed-in user's own tabs — the same items their dashboard sidebar
  // shows (roleNav is the shared source).  Students additionally hide
  // "View Candidates" until they have a candidacy or the official list is
  // posted, mirroring the sidebar's rule.
  const hasCandidacy = candidates?.some((c) => c.studentId === currentUser?.id) ?? false;
  const userTabs: NavItem[] = !currentUser
    ? []
    : getUserNavItems(currentUser)
        .filter(
          (item) =>
            !(
              item.href === "/student/candidates" &&
              !hasCandidacy &&
              !electionPeriod?.officialListPosted
            ),
        )
        .filter((item) => item.href !== "/student/profile" && item.href !== "/admin/profile");
  // A signed-in user whose role carries no nav still gets a way back in.
  if (currentUser && userTabs.length === 0) {
    userTabs.push({ label: "Dashboard", href: getDashboardLink(), icon: <User size={14} /> });
  }

  return (
    <>
      <header ref={headerRef} className="w-full bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo + Name */}
            <Link to="/" className="flex items-center gap-3 flex-shrink-0">
              <img src={cnnhsLogo} alt="CNNHS Logo" className="w-10 h-10 rounded-full object-cover" />
              <div className="hidden sm:block">
                <div className="text-sm font-bold" style={{ color: "#5C0102" }}>
                  CNNHS
                </div>
                <div className="text-xs text-gray-500 leading-tight">Online Voting System</div>
              </div>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-6">
              {/* About CNNHS — direct tab, leftmost of the tabs */}
              <Link
                to="/about"
                className="px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
              >
                About CNNHS
              </Link>

              {/* Student Registration — direct tab; hidden once any user is
                  signed in (the Register CTA follows the same rule). */}
              {!currentUser && (
                <Link
                  to="/register"
                  className="px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  Student Registration
                </Link>
              )}

              {/* Current Election — direct tab */}
              <Link
                to="/current-election"
                className="px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
              >
                Current Election
              </Link>

              {/* Results Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown("results")}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  Results
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {dropdowns.results && (
                  <div className="absolute left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
                    <Link
                      to="/official-results"
                      onClick={() => toggleDropdown("results")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Official Results
                    </Link>
                    <Link
                      to="/past-elections"
                      onClick={() => toggleDropdown("results")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Past Elections
                    </Link>
                  </div>
                )}
              </div>

              {/* Resources Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown("resources")}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  Resources
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {dropdowns.resources && (
                  <div className="absolute left-0 mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
                    <Link
                      to="/guidelines"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Election Guidelines
                    </Link>
                    <Link
                      to={getCalendarHref(currentUser)}
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Election Calendar
                    </Link>
                    <Link
                      to="/faq"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      FAQ
                    </Link>
                    <Link
                      to="/contact"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Contact Information
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* User Actions */}
            <div className="hidden md:flex items-center gap-4">
              {!currentUser ? (
                <>
                  <Link
                    to="/login"
                    className="text-gray-600 hover:text-[#5C0102] transition-colors text-sm"
                  >
                    Login
                  </Link>
                  <Link
                    to="/register"
                    className="px-4 py-2 rounded-lg text-white text-sm transition-colors"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    Register
                  </Link>
                </>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => toggleDropdown("user")}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold overflow-hidden" style={{ backgroundColor: "#5C0102" }}>
                      {avatarPictureUrl ? (
                        <img src={avatarPictureUrl} alt="" className="w-7 h-7 object-cover" />
                      ) : (
                        currentUser.name.charAt(0)
                      )}
                    </div>
                    <span className="text-gray-700">{currentUser.name}</span>
                    <ChevronDown size={14} className="text-gray-500" />
                  </button>
                  {dropdowns.user && (
                    <div className="absolute right-0 mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                      {/* Identity block — photo, name, role/title, My Profile */}
                      <div className="px-4 pt-3 pb-3 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold overflow-hidden flex-shrink-0" style={{ backgroundColor: "#5C0102" }}>
                            {avatarPictureUrl ? (
                              <img src={avatarPictureUrl} alt="" className="w-10 h-10 object-cover" />
                            ) : (
                              currentUser.name.charAt(0)
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">{currentUser.name}</div>
                            <div className="text-xs text-gray-500 truncate">{getUserRoleTitle(currentUser)}</div>
                          </div>
                        </div>
                        <Link
                          to={profileHref}
                          onClick={() => toggleDropdown("user")}
                          className="mt-2.5 flex w-full items-center gap-2 rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <User size={14} /> My Profile
                        </Link>
                      </div>
                      {/* The user's own tabs — mirrors their dashboard sidebar */}
                      {userTabs.map((item) => (
                        <Link
                          key={item.href}
                          to={item.href}
                          onClick={() => toggleDropdown("user")}
                          className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {item.icon}
                          <span>{item.label}</span>
                        </Link>
                      ))}
                      {userTabs.length > 0 && <div className="border-t border-gray-100" />}
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left"
                      >
                        <LogOut size={16} /> Logout
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mobile menu toggle — the mobile panel below is hidden until tapped */}
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu — toggled by the hamburger; hidden until opened */}
      <div
        id="mobile-nav"
        ref={mobilePanelRef}
        className={`${mobileOpen ? "block" : "hidden"} md:hidden border-t border-gray-200 bg-white px-4 py-4 space-y-2`}
      >
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="block py-2 text-gray-700 text-sm"
        >
          Home
        </Link>
        <div className="border-t border-gray-200 pt-2">
          {/* Mobile About CNNHS */}
          <Link
            to="/about"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-gray-700 text-sm"
          >
            About CNNHS
          </Link>

          {/* Mobile Student Registration — hidden once any user is signed in */}
          {!currentUser && (
            <Link
              to="/register"
              onClick={() => setMobileOpen(false)}
              className="block py-2 text-gray-700 text-sm"
            >
              Student Registration
            </Link>
          )}

          {/* Mobile Current Election */}
          <Link
            to="/current-election"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-gray-700 text-sm"
          >
            Current Election
          </Link>

          {/* Mobile Results */}
          <div className="py-2">
            <button
              onClick={() => toggleDropdown("results")}
              className="w-full text-left text-gray-700 py-2 hover:bg-gray-50"
            >
              Results
              {dropdowns.results ? (
                <ChevronUp size={16} className="ml-2 text-gray-500" />
              ) : (
                <ChevronDown size={16} className="ml-2 text-gray-500" />
              )}
            </button>
            {dropdowns.results && (
              <>
                <Link
                  to="/official-results"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("results");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Official Results
                </Link>
                <Link
                  to="/past-elections"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("results");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Past Elections
                </Link>
              </>
            )}
          </div>

          {/* Mobile Resources */}
          <div className="py-2">
            <button
              onClick={() => toggleDropdown("resources")}
              className="w-full text-left text-gray-700 py-2 hover:bg-gray-50"
            >
              Resources
              {dropdowns.resources ? (
                <ChevronUp size={16} className="ml-2 text-gray-500" />
              ) : (
                <ChevronDown size={16} className="ml-2 text-gray-500" />
              )}
            </button>
            {dropdowns.resources && (
              <>
                  <Link
                    to="/guidelines"
                    onClick={() => {
                      setMobileOpen(false);
                      toggleDropdown("resources");
                    }}
                    className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                  >
                    Election Guidelines
                  </Link>
                <Link
                  to={getCalendarHref(currentUser)}
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Election Calendar
                </Link>
                <Link
                  to="/faq"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  FAQ
                </Link>
                <Link
                  to="/contact"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Contact Information
                </Link>
              </>
            )}
          </div>
        </div>

        {!currentUser ? (
          <>
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="block py-2 text-gray-700 text-sm"
            >
              Login
            </Link>
            <Link
              to="/register"
              onClick={() => setMobileOpen(false)}
              className="block py-2 px-4 rounded-lg text-white text-sm text-center"
              style={{ backgroundColor: "#5C0102" }}
            >
              Register
            </Link>
          </>
        ) : (
          <>
            {/* Signed-in tabs — mirrors the desktop user dropdown */}
            {userTabs.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 py-2 text-gray-700 text-sm"
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
            <Link
              to={profileHref}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 py-2 text-gray-700 text-sm"
            >
              <User size={18} /> My Profile
            </Link>
            <button
              onClick={() => {
                handleLogout();
                setMobileOpen(false);
              }}
              className="block py-2 text-red-600 text-sm w-full text-left"
            >
              Logout
            </button>
          </>
        )}
      </div>
      {logoutConfirm.dialog}
    </>
  );
}