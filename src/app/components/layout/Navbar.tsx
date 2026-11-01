import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Menu, X, LogOut, User, ChevronDown } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import cnnhsLogo from "../../assets/CNNHS_Logo1.png";

export function Navbar() {
  const { currentUser, setCurrentUser } = useApp();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
    navigate("/");
    setDropdownOpen(false);
  };

  const getDashboardLink = () => {
    if (!currentUser) return "/";
    if (currentUser.role === "student") return "/student/dashboard";
    if (currentUser.role === "admin") return "/admin/dashboard";
    return "/";
  };

  return (
    <nav className="w-full bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo + Name */}
          <Link to="/" className="flex items-center gap-3 flex-shrink-0">
            <img src={cnnhsLogo} alt="CNNHS Logo" className="w-10 h-10 rounded-full object-cover" />
            <div className="hidden sm:block">
              <div className="text-sm font-bold" style={{ color: "#5C0102" }}>CNNHS</div>
              <div className="text-xs text-gray-500 leading-tight">Online Voting System</div>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            <Link to="/" className="text-gray-600 hover:text-[#5C0102] transition-colors text-sm">Home</Link>
            <Link to="/calendar" className="text-gray-600 hover:text-[#5C0102] transition-colors text-sm">Calendar</Link>
            {!currentUser ? (
              <>
                <Link to="/login" className="text-gray-600 hover:text-[#5C0102] transition-colors text-sm">Login</Link>
                <Link to="/register" className="px-4 py-2 rounded-lg text-white text-sm transition-colors" style={{ backgroundColor: "#5C0102" }}>Register</Link>
              </>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                >
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold overflow-hidden" style={{ backgroundColor: "#5C0102" }}>
                    {currentUser.profilePictureUrl ? (
                      <img src={currentUser.profilePictureUrl} alt="" className="w-7 h-7 object-cover" />
                    ) : (
                      currentUser.name.charAt(0)
                    )}
                  </div>
                  <span className="text-gray-700">{currentUser.name}</span>
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                    <Link to={getDashboardLink()} onClick={() => setDropdownOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <User size={14} /> Dashboard
                    </Link>
                    <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full text-left">
                      <LogOut size={14} /> Logout
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white px-4 py-4 space-y-2">
          <Link to="/" onClick={() => setMobileOpen(false)} className="block py-2 text-gray-700 text-sm">Home</Link>
          <Link to="/calendar" onClick={() => setMobileOpen(false)} className="block py-2 text-gray-700 text-sm">Calendar</Link>
          {!currentUser ? (
            <>
              <Link to="/login" onClick={() => setMobileOpen(false)} className="block py-2 text-gray-700 text-sm">Login</Link>
              <Link to="/register" onClick={() => setMobileOpen(false)} className="block py-2 px-4 rounded-lg text-white text-sm text-center" style={{ backgroundColor: "#5C0102" }}>Register</Link>
            </>
          ) : (
            <>
              <Link to={getDashboardLink()} onClick={() => setMobileOpen(false)} className="block py-2 text-gray-700 text-sm">Dashboard</Link>
              <button onClick={handleLogout} className="block py-2 text-red-600 text-sm w-full text-left">Logout</button>
            </>
          )}
        </div>
      )}
    </nav>
  );
}