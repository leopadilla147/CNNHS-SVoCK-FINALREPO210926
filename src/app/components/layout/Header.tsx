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
  const [scrolled, setScrolled] = useState(false);

  // Monitor scroll for dynamic glassmorphic elevation
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Active path helpers
  const isActive = (href: string) => pathname === href;
  const isResultsActive = pathname === "/official-results" || pathname === "/past-elections";
  const isResourcesActive =
    pathname === "/guidelines" ||
    pathname === "/faq" ||
    pathname === "/contact" ||
    pathname.startsWith("/calendar");

  const navLinkClass = (active: boolean) =>
    `px-3.5 py-1.5 rounded-xl text-sm transition-all duration-200 ${
      active
        ? "text-[#5C0102] bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/90 border-b-2 border-b-red-300 font-bold shadow-[0_2px_5px_rgba(92,1,2,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
        : "text-gray-700 hover:text-[#5C0102] hover:bg-gradient-to-b hover:from-white hover:to-stone-100/80 border border-transparent hover:border-gray-200/70 hover:shadow-[0_2px_6px_rgba(0,0,0,0.03)] font-medium"
    }`;

  const dropdownTriggerClass = (active: boolean, isOpen: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
      active || isOpen
        ? "text-[#5C0102] bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/90 border-b-2 border-b-red-300 font-bold shadow-[0_2px_5px_rgba(92,1,2,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
        : "text-gray-700 hover:text-[#5C0102] hover:bg-gradient-to-b hover:from-white hover:to-stone-100/80 border border-transparent hover:border-gray-200/70 hover:shadow-[0_2px_6px_rgba(0,0,0,0.03)] font-medium"
    }`;

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
      <header
        ref={headerRef}
        className={`w-full sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-gray-200/90 border-b-[2.5px] border-b-gray-300/80 shadow-[0_6px_20px_-2px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.03)] bg-white/95 backdrop-blur-md"
            : "border-b border-gray-200/80 border-b-[2px] border-b-gray-200 shadow-[0_2px_10px_rgba(0,0,0,0.03)] bg-white/90 backdrop-blur-md"
        }`}
      >
        {/* Subtle top 3D accent border bar */}
        <div className="h-[2.5px] w-full bg-gradient-to-r from-[#5C0102] via-[#8B0103] to-[#5C0102] shadow-[0_1px_3px_rgba(92,1,2,0.3)]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo + Name */}
            <Link to="/" className="flex items-center gap-3 flex-shrink-0 group">
              <div className="relative p-0.5 rounded-full bg-gradient-to-b from-white to-stone-200 border border-stone-200/80 shadow-[0_2px_6px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,1)] group-hover:shadow-[0_3px_10px_rgba(92,1,2,0.2)] transition-all duration-200">
                <img
                  src={cnnhsLogo}
                  alt="CNNHS Logo"
                  className="w-10 h-10 rounded-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-extrabold tracking-tight group-hover:opacity-90 transition-opacity" style={{ color: "#5C0102" }}>
                  CNNHS
                </div>
                <div className="text-xs text-gray-500 leading-tight font-semibold">Online Voting System</div>
              </div>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1.5 lg:gap-2">
              {/* About — direct tab, leftmost of the tabs */}
              <Link
                to="/about"
                aria-label="About CNNHS"
                className={navLinkClass(isActive("/about"))}
              >
                About
              </Link>

              {/* Student Registration — direct tab; hidden once any user is
                  signed in (the Register CTA follows the same rule). */}
              {!currentUser && (
                <Link
                  to="/register"
                  className={navLinkClass(isActive("/register"))}
                >
                  Student Registration
                </Link>
              )}

              {/* Current Election — direct tab */}
              <Link
                to="/current-election"
                className={navLinkClass(isActive("/current-election"))}
              >
                Current Election
              </Link>

              {/* Results Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown("results")}
                  className={dropdownTriggerClass(isResultsActive, dropdowns.results)}
                >
                  <span>Results</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      dropdowns.results ? "rotate-180 text-[#5C0102]" : "text-gray-500"
                    }`}
                  />
                </button>
                {dropdowns.results && (
                  <div className="absolute left-0 mt-2 w-56 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] backdrop-blur-xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 rounded-2xl shadow-[0_16px_36px_-6px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] p-1.5 z-50">
                    <Link
                      to="/official-results"
                      onClick={() => toggleDropdown("results")}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-sm rounded-xl transition-all ${
                        pathname === "/official-results"
                          ? "bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 text-[#5C0102] font-bold shadow-[0_1px_3px_rgba(92,1,2,0.05)]"
                          : "text-gray-700 hover:text-[#5C0102] hover:bg-gray-100/80 font-medium"
                      }`}
                    >
                      Official Results
                    </Link>
                    <Link
                      to="/past-elections"
                      onClick={() => toggleDropdown("results")}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-sm rounded-xl transition-all ${
                        pathname === "/past-elections"
                          ? "bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 text-[#5C0102] font-bold shadow-[0_1px_3px_rgba(92,1,2,0.05)]"
                          : "text-gray-700 hover:text-[#5C0102] hover:bg-gray-100/80 font-medium"
                      }`}
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
                  className={dropdownTriggerClass(isResourcesActive, dropdowns.resources)}
                >
                  <span>Resources</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      dropdowns.resources ? "rotate-180 text-[#5C0102]" : "text-gray-500"
                    }`}
                  />
                </button>
                {dropdowns.resources && (
                  <div className="absolute left-0 mt-2 w-60 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] backdrop-blur-xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 rounded-2xl shadow-[0_16px_36px_-6px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] p-1.5 z-50">
                    <Link
                      to="/guidelines"
                      onClick={() => toggleDropdown("resources")}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-sm rounded-xl transition-all ${
                        pathname === "/guidelines"
                          ? "bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 text-[#5C0102] font-bold shadow-[0_1px_3px_rgba(92,1,2,0.05)]"
                          : "text-gray-700 hover:text-[#5C0102] hover:bg-gray-100/80 font-medium"
                      }`}
                    >
                      Election Guidelines
                    </Link>
                    <Link
                      to={getCalendarHref(currentUser)}
                      onClick={() => toggleDropdown("resources")}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-sm rounded-xl transition-all ${
                        pathname.startsWith("/calendar")
                          ? "bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 text-[#5C0102] font-bold shadow-[0_1px_3px_rgba(92,1,2,0.05)]"
                          : "text-gray-700 hover:text-[#5C0102] hover:bg-gray-100/80 font-medium"
                      }`}
                    >
                      Election Calendar
                    </Link>
                    <Link
                      to="/faq"
                      onClick={() => toggleDropdown("resources")}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-sm rounded-xl transition-all ${
                        pathname === "/faq"
                          ? "bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 text-[#5C0102] font-bold shadow-[0_1px_3px_rgba(92,1,2,0.05)]"
                          : "text-gray-700 hover:text-[#5C0102] hover:bg-gray-100/80 font-medium"
                      }`}
                    >
                      FAQ
                    </Link>
                    <Link
                      to="/contact"
                      onClick={() => toggleDropdown("resources")}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-sm rounded-xl transition-all ${
                        pathname === "/contact"
                          ? "bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 text-[#5C0102] font-bold shadow-[0_1px_3px_rgba(92,1,2,0.05)]"
                          : "text-gray-700 hover:text-[#5C0102] hover:bg-gray-100/80 font-medium"
                      }`}
                    >
                      Contact Information
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* User Actions */}
            <div className="hidden md:flex items-center gap-3">
              {!currentUser ? (
                <>
                  <Link
                    to="/login"
                    className="text-gray-700 hover:text-[#5C0102] px-3.5 py-1.5 rounded-xl hover:bg-gradient-to-b hover:from-white hover:to-stone-100/80 border border-transparent hover:border-gray-200/80 hover:shadow-[0_2px_5px_rgba(0,0,0,0.04)] transition-all duration-200 text-sm font-semibold"
                  >
                    Login
                  </Link>
                  <Link
                    to="/register"
                    className="px-4 py-1.5 rounded-xl text-white text-sm font-bold transition-all duration-200 bg-gradient-to-b from-[#7A0203] via-[#5C0102] to-[#450001] border-b-[2.5px] border-b-[#2e0001] shadow-[0_3px_10px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 hover:shadow-[0_5px_14px_rgba(92,1,2,0.35)] active:translate-y-[1px] active:border-b-2 active:brightness-95"
                  >
                    Register
                  </Link>
                </>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => toggleDropdown("user")}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200 text-sm cursor-pointer border ${
                      dropdowns.user
                        ? "bg-gradient-to-b from-stone-50 to-stone-100/90 border-stone-300 border-b-2 border-b-stone-400 shadow-[0_2px_6px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]"
                        : "bg-white/80 border-gray-200/80 border-b-2 border-b-gray-300/80 hover:bg-stone-50 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
                    }`}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold overflow-hidden shadow-[0_2px_4px_rgba(92,1,2,0.3)] ring-1 ring-white/90 bg-gradient-to-b from-[#7A0203] to-[#450001]"
                    >
                      {avatarPictureUrl ? (
                        <img src={avatarPictureUrl} alt="" className="w-7 h-7 object-cover" />
                      ) : (
                        currentUser.name.charAt(0)
                      )}
                    </div>
                    <span className="text-gray-800 font-bold">{currentUser.name}</span>
                    <ChevronDown
                      size={14}
                      className={`text-gray-500 transition-transform duration-200 ${
                        dropdowns.user ? "rotate-180 text-[#5C0102]" : ""
                      }`}
                    />
                  </button>
                  {dropdowns.user && (
                    <div className="absolute right-0 mt-2 w-64 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] backdrop-blur-xl border border-gray-200/90 border-b-[3.5px] border-b-gray-300 rounded-2xl shadow-[0_16px_36px_-6px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] z-50 p-1.5">
                      {/* Identity block — photo, name, role/title, My Profile */}
                      <div className="px-3.5 pt-3 pb-3 border border-gray-200/80 border-b-2 border-b-gray-300/80 bg-gradient-to-b from-white to-stone-50/90 rounded-xl mb-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,1)]">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold overflow-hidden flex-shrink-0 bg-gradient-to-b from-[#7A0203] to-[#450001] shadow-[0_2px_6px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] border-b-2 border-b-[#2e0001]"
                          >
                            {avatarPictureUrl ? (
                              <img src={avatarPictureUrl} alt="" className="w-10 h-10 object-cover" />
                            ) : (
                              currentUser.name.charAt(0)
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-extrabold text-gray-900 truncate">{currentUser.name}</div>
                            <div className="text-xs text-gray-500 truncate font-medium">{getUserRoleTitle(currentUser)}</div>
                          </div>
                        </div>
                        <Link
                          to={profileHref}
                          onClick={() => toggleDropdown("user")}
                          className="mt-2.5 flex w-full items-center gap-2 rounded-xl bg-white border border-gray-200/90 border-b-2 border-b-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-red-50/50 hover:text-[#5C0102] hover:border-[#5C0102]/30 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
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
                          className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:text-[#5C0102] hover:bg-stone-100/80 rounded-xl transition-colors font-medium"
                        >
                          {item.icon}
                          <span>{item.label}</span>
                        </Link>
                      ))}
                      {userTabs.length > 0 && <div className="border-t border-gray-100 my-1" />}
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50/90 rounded-xl transition-colors text-left font-bold cursor-pointer"
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
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl text-gray-700 hover:text-[#5C0102] bg-white border border-gray-200/80 border-b-2 border-b-gray-300 hover:bg-stone-50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 cursor-pointer active:translate-y-[1px]"
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
        className={`${
          mobileOpen ? "block" : "hidden"
        } md:hidden border-b-[3.5px] border-b-gray-300 bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] backdrop-blur-xl px-4 py-4 space-y-1.5 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.12)] transition-all duration-200`}
      >
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className={`block px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
            pathname === "/"
              ? "bg-[#5C0102]/10 text-[#5C0102] font-semibold"
              : "text-gray-700 hover:bg-gray-100/70"
          }`}
        >
          Home
        </Link>
        <div className="border-t border-gray-200/60 pt-2 space-y-1">
          {/* Mobile About */}
          <Link
            to="/about"
            onClick={() => setMobileOpen(false)}
            className={`block px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              pathname === "/about"
                ? "bg-[#5C0102]/10 text-[#5C0102] font-semibold"
                : "text-gray-700 hover:bg-gray-100/70"
            }`}
          >
            About
          </Link>

          {/* Mobile Student Registration — hidden once any user is signed in */}
          {!currentUser && (
            <Link
              to="/register"
              onClick={() => setMobileOpen(false)}
              className={`block px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                pathname === "/register"
                  ? "bg-[#5C0102]/10 text-[#5C0102] font-semibold"
                  : "text-gray-700 hover:bg-gray-100/70"
              }`}
            >
              Student Registration
            </Link>
          )}

          {/* Mobile Current Election */}
          <Link
            to="/current-election"
            onClick={() => setMobileOpen(false)}
            className={`block px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              pathname === "/current-election"
                ? "bg-[#5C0102]/10 text-[#5C0102] font-semibold"
                : "text-gray-700 hover:bg-gray-100/70"
            }`}
          >
            Current Election
          </Link>

          {/* Mobile Results */}
          <div className="py-1">
            <button
              onClick={() => toggleDropdown("results")}
              className={`flex items-center justify-between w-full px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                isResultsActive || dropdowns.results
                  ? "bg-[#5C0102]/10 text-[#5C0102] font-semibold"
                  : "text-gray-700 hover:bg-gray-100/70"
              }`}
            >
              <span>Results</span>
              {dropdowns.results ? (
                <ChevronUp size={16} className="text-[#5C0102]" />
              ) : (
                <ChevronDown size={16} className="text-gray-500" />
              )}
            </button>
            {dropdowns.results && (
              <div className="mt-1 space-y-1 pl-4">
                <Link
                  to="/official-results"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("results");
                  }}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname === "/official-results"
                      ? "text-[#5C0102] font-semibold"
                      : "text-gray-600 hover:text-[#5C0102] hover:bg-gray-50"
                  }`}
                >
                  Official Results
                </Link>
                <Link
                  to="/past-elections"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("results");
                  }}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname === "/past-elections"
                      ? "text-[#5C0102] font-semibold"
                      : "text-gray-600 hover:text-[#5C0102] hover:bg-gray-50"
                  }`}
                >
                  Past Elections
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Resources */}
          <div className="py-1">
            <button
              onClick={() => toggleDropdown("resources")}
              className={`flex items-center justify-between w-full px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                isResourcesActive || dropdowns.resources
                  ? "bg-[#5C0102]/10 text-[#5C0102] font-semibold"
                  : "text-gray-700 hover:bg-gray-100/70"
              }`}
            >
              <span>Resources</span>
              {dropdowns.resources ? (
                <ChevronUp size={16} className="text-[#5C0102]" />
              ) : (
                <ChevronDown size={16} className="text-gray-500" />
              )}
            </button>
            {dropdowns.resources && (
              <div className="mt-1 space-y-1 pl-4">
                <Link
                  to="/guidelines"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname === "/guidelines"
                      ? "text-[#5C0102] font-semibold"
                      : "text-gray-600 hover:text-[#5C0102] hover:bg-gray-50"
                  }`}
                >
                  Election Guidelines
                </Link>
                <Link
                  to={getCalendarHref(currentUser)}
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname.startsWith("/calendar")
                      ? "text-[#5C0102] font-semibold"
                      : "text-gray-600 hover:text-[#5C0102] hover:bg-gray-50"
                  }`}
                >
                  Election Calendar
                </Link>
                <Link
                  to="/faq"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname === "/faq"
                      ? "text-[#5C0102] font-semibold"
                      : "text-gray-600 hover:text-[#5C0102] hover:bg-gray-50"
                  }`}
                >
                  FAQ
                </Link>
                <Link
                  to="/contact"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname === "/contact"
                      ? "text-[#5C0102] font-semibold"
                      : "text-gray-600 hover:text-[#5C0102] hover:bg-gray-50"
                  }`}
                >
                  Contact Information
                </Link>
              </div>
            )}
          </div>
        </div>

        {!currentUser ? (
          <div className="pt-2 border-t border-gray-200/80 space-y-2">
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="block w-full py-2.5 px-4 rounded-xl text-center text-gray-700 bg-white border border-gray-200/80 border-b-2 border-b-gray-300 hover:bg-stone-50 font-bold text-sm shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all"
            >
              Login
            </Link>
            <Link
              to="/register"
              onClick={() => setMobileOpen(false)}
              className="block w-full py-2.5 px-4 rounded-xl text-white text-sm font-bold text-center bg-gradient-to-b from-[#7A0203] via-[#5C0102] to-[#450001] border-b-[2.5px] border-b-[#2e0001] shadow-[0_3px_10px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 active:translate-y-[1px] transition-all"
            >
              Register
            </Link>
          </div>
        ) : (
          <div className="pt-2 border-t border-gray-200/80 space-y-1">
            {/* Signed-in tabs — mirrors the desktop user dropdown */}
            {userTabs.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-gray-700 hover:text-[#5C0102] hover:bg-stone-100/80 text-sm font-medium transition-colors"
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
            <Link
              to={profileHref}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-gray-700 hover:text-[#5C0102] hover:bg-stone-100/80 text-sm font-medium transition-colors"
            >
              <User size={18} /> My Profile
            </Link>
            <button
              onClick={() => {
                handleLogout();
                setMobileOpen(false);
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-red-600 hover:bg-red-50 text-sm font-bold w-full text-left transition-colors cursor-pointer"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        )}
      </div>
      {logoutConfirm.dialog}
    </>
  );
}