import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Menu,
  X,
  LogOut,
  User,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Search,
  Calendar,
  Users,
  Vote,
  BarChart2,
  Folder,
  Shield,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import cnnhsLogo from "../../assets/CNNHS_Logo1.png";

export function Header() {
  const { currentUser, setCurrentUser } = useApp();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdowns, setDropdowns] = useState({
    voterReg: false,
    elections: false,
    voting: false,
    results: false,
    resources: false,
    user: false,
  });

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
    navigate("/");
    // Close all dropdowns
    setDropdowns({
      voterReg: false,
      elections: false,
      voting: false,
      results: false,
      resources: false,
      user: false,
    });
  };

  const getDashboardLink = () => {
    if (!currentUser) return "/";
    if (currentUser.role === "student") return "/student/dashboard";
    if (currentUser.role === "admin") return "/admin/dashboard";
    return "/";
  };

  const toggleDropdown = (dropdownName: keyof typeof dropdowns) => {
    setDropdowns((prev) => ({
      ...prev,
      [dropdownName]: !prev[dropdownName],
    }));
  };

  return (
    <>
      <header className="w-full bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
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
              {/* Voter Registration Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown("voterReg")}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  Voter Registration
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {dropdowns.voterReg && (
                  <div className="absolute left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
                    <Link
                      to="/register"
                      onClick={() => toggleDropdown("voterReg")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Register to Vote
                    </Link>
                  </div>
                )}
              </div>

              {/* Elections Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown("elections")}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  Elections
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {dropdowns.elections && (
                  <div className="absolute left-0 mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
                    <Link
                      to="/current-election"
                      onClick={() => toggleDropdown("elections")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Current Election
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("elections")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Election Calendar
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("elections")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Candidates
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("elections")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Parties
                    </Link>
                  </div>
                )}
              </div>

              {/* Voting Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown("voting")}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  Voting
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {dropdowns.voting && (
                  <div className="absolute left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("voting")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      How to Vote
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("voting")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      FAQ
                    </Link>
                  </div>
                )}
              </div>

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
                      to="/past-elections"
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
                      to="/"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Election Guidelines
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Forms
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      FAQ
                    </Link>
                    <Link
                      to="/"
                      onClick={() => toggleDropdown("resources")}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Contact
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
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: "#5C0102" }}>
                      {currentUser.name.charAt(0)}
                    </div>
                    <span className="text-gray-700">{currentUser.name}</span>
                    <ChevronDown size={14} className="text-gray-500" />
                  </button>
                  {dropdowns.user && (
                    <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
                      <Link
                        to={getDashboardLink()}
                        onClick={() => toggleDropdown("user")}
                        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <User size={14} /> Dashboard
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left"
                      >
                        <LogOut size={14} /> Logout
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      <div className="md:hidden border-t border-gray-200 bg-white px-4 py-4 space-y-2">
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="block py-2 text-gray-700 text-sm"
        >
          Home
        </Link>
        <div className="border-t border-gray-200 pt-2">
          {/* Mobile Voter Registration */}
          <div className="py-2">
            <button
              onClick={() => {
                setMobileOpen(false);
                toggleDropdown("voterReg");
              }}
              className="w-full text-left text-gray-700 py-2 hover:bg-gray-50"
            >
              Voter Registration
              {dropdowns.voterReg ? (
                <ChevronUp size={16} className="ml-2 text-gray-500" />
              ) : (
                <ChevronDown size={16} className="ml-2 text-gray-500" />
              )}
            </button>
            {dropdowns.voterReg && (
              <>
                <Link
                  to="/register"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("voterReg");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Register to Vote
                </Link>
              </>
            )}
          </div>

          {/* Mobile Elections */}
          <div className="py-2">
            <button
              onClick={() => {
                setMobileOpen(false);
                toggleDropdown("elections");
              }}
              className="w-full text-left text-gray-700 py-2 hover:bg-gray-50"
            >
              Elections
              {dropdowns.elections ? (
                <ChevronUp size={16} className="ml-2 text-gray-500" />
              ) : (
                <ChevronDown size={16} className="ml-2 text-gray-500" />
              )}
            </button>
            {dropdowns.elections && (
              <>
                <Link
                  to="/current-election"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("elections");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Current Election
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("elections");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Election Calendar
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("elections");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Candidates
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("elections");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Parties
                </Link>
              </>
            )}
          </div>

          {/* Mobile Voting */}
          <div className="py-2">
            <button
              onClick={() => {
                setMobileOpen(false);
                toggleDropdown("voting");
              }}
              className="w-full text-left text-gray-700 py-2 hover:bg-gray-50"
            >
              Voting
              {dropdowns.voting ? (
                <ChevronUp size={16} className="ml-2 text-gray-500" />
              ) : (
                <ChevronDown size={16} className="ml-2 text-gray-500" />
              )}
            </button>
            {dropdowns.voting && (
              <>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("voting");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  How to Vote
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("voting");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  FAQ
                </Link>
              </>
            )}
          </div>

          {/* Mobile Results */}
          <div className="py-2">
            <button
              onClick={() => {
                setMobileOpen(false);
                toggleDropdown("results");
              }}
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
                  to="/past-elections"
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
              onClick={() => {
                setMobileOpen(false);
                toggleDropdown("resources");
              }}
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
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Election Guidelines
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Forms
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  FAQ
                </Link>
                <Link
                  to="/"
                  onClick={() => {
                    setMobileOpen(false);
                    toggleDropdown("resources");
                  }}
                  className="block pl-8 py-1 text-sm text-gray-600 hover:text-[#5C0102]"
                >
                  Contact
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
            <Link
              to={getDashboardLink()}
              onClick={() => setMobileOpen(false)}
              className="block py-2 text-gray-700 text-sm"
            >
              Dashboard
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
    </>
  );
}