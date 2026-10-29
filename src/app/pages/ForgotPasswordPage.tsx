import { useState } from "react";
import { useNavigate } from "react-router";
import { Mail, KeyRound, Eye, EyeOff, AlertCircle, ArrowLeft, CheckCircle, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { isSupabaseConfigured } from "../lib/supabase";
import { requestPasswordResetCode, resetPasswordWithCode } from "../lib/supabaseData";

/**
 * Forgot-password screen (email OTP reset — migration 120 + the
 * send_password_reset edge function).
 *
 * Two steps:
 *   1. email — requests a one-time code through the Brevo-backed edge
 *      function.  The server answers ok:true whether or not the account
 *      exists (anti-enumeration), so the same "check your inbox" copy is
 *      shown either way.
 *   2. code  — the code + a new password go to the verify_password_reset
 *      RPC, which bcrypt-hashes the password, kills every active session
 *      (D-14), and reuses the 023 login lockout for bad-code attempts.
 *
 * Rendered OUTSIDE both layouts (routes.tsx), like its sibling
 * ChangePasswordPage — this flow never touches the session spine.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendCode = async () => {
    setError("");
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!isSupabaseConfigured) {
      setError("System is not connected to the database. Please try again later.");
      return;
    }

    setLoading(true);
    try {
      await requestPasswordResetCode(trimmed);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send the reset code.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setError("");
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setError("Please enter the code from your email.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
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
      await resetPasswordWithCode(email.trim(), trimmedCode, newPassword);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
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
              {step === "done" ? <CheckCircle size={24} /> : step === "code" ? <KeyRound size={24} /> : <Mail size={24} />}
            </div>
            <h2 className="text-white mb-1">Forgot Password</h2>
            <p className="text-white/70 text-xs">
              {step === "email" && "We'll email you a one-time reset code"}
              {step === "code" && "Enter the code sent to your email"}
              {step === "done" && "All done"}
            </p>
          </div>

          <div className="p-6">
            {step === "done" ? (
              <div className="text-center py-6">
                <CheckCircle size={40} className="mx-auto mb-3 text-green-500" />
                <p className="text-sm text-gray-700 font-medium mb-1">Password reset successfully</p>
                <p className="text-xs text-gray-500 mb-5">Sign in with your new password.</p>
                <button
                  onClick={() => navigate("/login")}
                  className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  Go to Login
                </button>
              </div>
            ) : step === "email" ? (
              <>
                <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl p-3.5 mb-5 text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertCircle size={15} className="text-amber-700 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    Enter the email registered to your account — students and staff both reset here. If an account
                    exists, a one-time code valid for 1 hour will be sent.
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-red-700"
                  >
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    {error}
                  </motion.div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail
                        size={16}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                      />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50/70 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] focus:bg-white transition-all"
                        onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSendCode}
                    disabled={loading}
                    className="w-full py-2.5 text-white rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending code...
                      </>
                    ) : (
                      "Send Reset Code"
                    )}
                  </button>

                  <button
                    onClick={() => navigate("/login")}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mx-auto"
                  >
                    <ArrowLeft size={14} /> Back to Login
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl p-3.5 mb-5 text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertCircle size={15} className="text-amber-700 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    Sent to <strong>{email.trim()}</strong>. The code is uppercase and contains no letter O, I, or
                    digit 0/1. It expires after 1 hour — requesting a new code invalidates the old one.
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-red-700"
                  >
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    {error}
                  </motion.div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">Reset Code</label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="8-character code"
                      maxLength={8}
                      autoCapitalize="characters"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm tracking-[0.3em] uppercase text-center focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50"
                      onKeyDown={(e) => e.key === "Enter" && handleReset()}
                    />
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
                        onKeyDown={(e) => e.key === "Enter" && handleReset()}
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
                    onClick={handleReset}
                    disabled={loading}
                    className="w-full py-2.5 text-white rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Resetting password...
                      </>
                    ) : (
                      "Reset Password"
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setNewPassword("");
                      setConfirmPassword("");
                      setError("");
                    }}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mx-auto"
                  >
                    <ArrowLeft size={14} /> Use a different email
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
