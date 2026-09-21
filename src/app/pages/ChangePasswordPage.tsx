import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { KeyRound, Eye, EyeOff, AlertCircle, ArrowLeft, CheckCircle, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { changePasswordForCurrentUser } from "../lib/supabaseData";

/**
 * D-04 forced-change screen (05-01 T3).
 *
 * Rendered OUTSIDE both layouts (routes.tsx) so it is the ONLY page a
 * flagged account may reach.  The form calls changePasswordForCurrentUser
 * (student -> change_my_password RPC; staff -> change_password edge fn).
 * On success the server cleared the flag and bumped session_version
 * (killing every prior session), the client drops its stored session
 * blob, and the user is routed to /login to sign in with the new
 * password (D-14).
 *
 * When the flag is NOT set the page bounces to /login (a direct visit
 * must not show the form).
 */
export default function ChangePasswordPage() {
  const { currentUser, setCurrentUser } = useApp();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }
  if (!currentUser.mustChangePassword) {
    return <Navigate to="/login" replace />;
  }

  const handleChange = async () => {
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must differ from the current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    if (!isSupabaseConfigured) {
      setError("System is not connected to the database. Please try again later.");
      return;
    }

    setLoading(true);
    try {
      await changePasswordForCurrentUser(currentPassword, newPassword);
      // D-14: the flag is cleared server-side and every session (ours
      // included) is dead — drop the stored user + token and re-login.
      setCurrentUser(null);
      setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Password change failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-8 text-white text-center" style={{ backgroundColor: "#5C0102" }}>
            <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center mx-auto mb-4">
              <KeyRound size={24} />
            </div>
            <h2 className="text-white mb-1">Change Password</h2>
            <p className="text-white/70 text-xs">You must set a new password before continuing (D-04)</p>
          </div>

          <div className="p-6">
            {success ? (
              <div className="text-center py-6">
                <CheckCircle size={40} className="mx-auto mb-3 text-green-500" />
                <p className="text-sm text-gray-700 font-medium mb-1">Password changed successfully</p>
                <p className="text-xs text-gray-500 mb-5">Sign in again with your new password.</p>
                <button
                  onClick={() => navigate("/login")}
                  className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  Go to Login
                </button>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-5 text-xs text-amber-700">
                  Your account was provisioned with a temporary password. Set a permanent password to unlock the system.
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">Current / Temporary Password</label>
                    <div className="relative">
                      <input
                        type={showCurrent ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter your temporary password"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrent(!showCurrent)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">New Password</label>
                    <div className="relative">
                      <input
                        type={showNew ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNew(!showNew)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">Confirm New Password</label>
                    <div className="relative">
                      <input
                        type={showConfirm ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter the new password"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 pr-10"
                        onKeyDown={(e) => e.key === "Enter" && handleChange()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handleChange}
                    disabled={loading}
                    className="w-full py-2.5 text-white rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Changing password...
                      </>
                    ) : (
                      "Change Password"
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setCurrentUser(null);
                      navigate("/login");
                    }}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mx-auto"
                  >
                    <ArrowLeft size={14} /> Log out instead
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}