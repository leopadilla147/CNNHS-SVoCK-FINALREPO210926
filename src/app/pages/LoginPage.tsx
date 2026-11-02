import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  GraduationCap,
  Shield,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
  Mail,
  Lock,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { signInWithSupabase, signInStudentDirect } from "../lib/supabaseData";
import { getUserRoleTitle } from "../components/layout/roleNav";

type LoginMode = "select" | "student" | "staff";

interface RoleMeta {
  title: string;
  subtitle: string;
  badge: string;
  icon: typeof GraduationCap;
  hint: string;
}

const ROLE_DETAILS: Record<Exclude<LoginMode, "select">, RoleMeta> = {
  student: {
    title: "Student",
    subtitle: "Voters & Candidates",
    badge: "Voter & Candidate Access",
    icon: GraduationCap,
    hint: "Use your registered student email and password to vote or view election status.",
  },
  staff: {
    title: "Admin",
    subtitle: "Commissioners & Adviser",
    badge: "Staff & Commissioners",
    icon: Shield,
    hint: "One login for the Chief Commissioner, Commissioners, Co-commissioners, and the SSLG Adviser. Your account automatically opens the right portal.",
  },
};

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("select");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { setCurrentUser, addLog } = useApp();
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError("");
    setLoading(true);

    if (!isSupabaseConfigured) {
      setError("System is not connected to the database. Please try again later.");
      setLoading(false);
      return;
    }

    // Artificial delay for UX
    await new Promise((r) => setTimeout(r, 800));

    // Student uses direct table login (no Supabase Auth)
    if (mode === "student") {
      try {
        const user = await signInStudentDirect(email, password);
        setCurrentUser(user);
        addLog({
          user: user.name,
          role: "Student",
          action: "Login",
          details: "Successful login",
          type: "success",
        });
        navigate("/student/dashboard");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid email or password.";
        setError(message);
        addLog({
          user: email,
          role: "Student",
          action: "Login Failed",
          details: message,
          type: "error",
        });
      }
      setLoading(false);
      return;
    }

    // Staff — one login for the Chief Commissioner, Commissioners,
    // Co-commissioners, and the SSLG Adviser.  login_staff_direct_v2
    // authenticates any staff account and its row carries the real role,
    // so there are no client-side portal gates to get wrong.
    if (mode === "staff") {
      try {
        const user = await signInWithSupabase(email, password);
        setCurrentUser(user);
        addLog({
          user: user.name,
          role: getUserRoleTitle(user),
          action: "Login",
          details: "Successful login",
          type: "success",
        });
        navigate("/admin/dashboard");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid email or password.";
        setError(message);
        addLog({
          user: email,
          role: "admin",
          action: "Login Failed",
          details: message,
          type: "error",
        });
      }
      setLoading(false);
      return;
    }

    setLoading(false);
  };

  if (mode === "select") {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10 bg-gradient-to-b from-stone-50 via-gray-50 to-stone-100 relative overflow-hidden">
        {/* Decorative ambient gradients */}
        <div className="absolute top-0 -left-20 w-96 h-96 rounded-full bg-red-100/40 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 -right-20 w-96 h-96 rounded-full bg-amber-100/30 blur-3xl pointer-events-none" />

        <div className="w-full max-w-2xl z-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full"
          >
            {/* Institution Header */}
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-b from-red-50 to-red-100/60 border border-red-200/80 border-b-2 border-b-red-300 text-[#5C0102] text-xs font-bold uppercase tracking-wider mb-4 shadow-[0_2px_8px_rgba(92,1,2,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]">
                <Sparkles size={13} className="text-[#5C0102]" />
                <span>Camarines Norte National High School</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-2.5">
                SVoCK Portal Sign-in
              </h1>
              <p className="text-gray-600 text-sm sm:text-base max-w-lg mx-auto">
                Select your designated role to enter the secure Supreme Student Government voting and commission system.
              </p>
            </div>

            {/* Role Cards Grid — two portals: students and staff */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {(["student", "staff"] as const).map((roleKey, idx) => {
                const role = ROLE_DETAILS[roleKey];
                const Icon = role.icon;
                return (
                  <motion.button
                    key={roleKey}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: idx * 0.08 }}
                    whileHover={{ y: -5, transition: { duration: 0.2 } }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setMode(roleKey);
                      setEmail("");
                      setPassword("");
                      setError("");
                    }}
                    className="group relative flex flex-col items-center text-center p-7 bg-gradient-to-b from-[#ffffff] via-[#fff9f9] to-[#fbf0f0] rounded-2xl border border-stone-200/80 border-b-[4px] border-b-stone-300 shadow-[0_8px_20px_-4px_rgba(92,1,2,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] hover:from-[#ffffff] hover:via-[#fff3f3] hover:to-[#f9e6e6] hover:border-[#8B0103]/50 hover:border-b-[#5C0102] hover:shadow-[0_18px_38px_-6px_rgba(92,1,2,0.15),0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] transition-all duration-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#5C0102] focus:ring-offset-2"
                  >
                    {/* Top Accent Pill */}
                    <span className="text-[11px] font-bold tracking-wider uppercase px-3 py-1 rounded-full bg-gradient-to-b from-white to-stone-100 text-stone-600 border border-stone-200/90 border-b-2 border-b-stone-300 shadow-[0_1px_3px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] group-hover:bg-gradient-to-b group-hover:from-red-50 group-hover:to-red-100/70 group-hover:text-[#5C0102] group-hover:border-red-200 group-hover:border-b-red-300 transition-all mb-5">
                      {role.badge}
                    </span>

                    {/* Icon container */}
                    <div className="flex-1 flex items-center justify-center w-full my-5">
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white bg-gradient-to-b from-[#7A0203] via-[#5C0102] to-[#450001] border-b-2 border-b-[#2e0001] shadow-[0_6px_16px_rgba(92,1,2,0.28),inset_0_1px_0_rgba(255,255,255,0.3)] group-hover:scale-110 group-hover:shadow-[0_10px_24px_rgba(92,1,2,0.38)] transition-all duration-300"
                      >
                        <Icon size={28} className="transition-transform group-hover:rotate-3" />
                      </div>
                    </div>

                    {/* Labels matching test query: role.title + " " + role.subtitle */}
                    <div className="font-extrabold text-gray-900 text-lg mb-1 group-hover:text-[#5C0102] transition-colors tracking-tight">
                      {role.title}
                    </div>
                    <div className="text-xs font-semibold text-gray-500 mb-2.5">
                      {role.subtitle}
                    </div>

                    <div className="mt-6 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-[#5C0102] bg-red-50/80 border border-red-200/60 shadow-[0_1px_3px_rgba(92,1,2,0.06)] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-200">
                      <span>Continue</span>
                      <span aria-hidden="true">&rarr;</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* Bottom Footer Note */}
            <div className="mt-10 text-center">
              <p className="text-sm text-gray-600">
                Are you a student without an account?{" "}
                <Link
                  to="/register"
                  className="font-semibold text-[#5C0102] hover:underline underline-offset-4 transition-colors"
                >
                  Register here
                </Link>
              </p>
              <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                <CheckCircle2 size={13} className="text-emerald-600" />
                <span>Secure 256-bit Encrypted DepEd CNNHS Electoral Network</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  const role = ROLE_DETAILS[mode];
  const Icon = role.icon;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10 bg-gradient-to-b from-stone-50 via-gray-50 to-stone-100 relative overflow-hidden">
      {/* Decorative ambient gradients */}
      <div className="absolute top-0 -left-20 w-96 h-96 rounded-full bg-red-100/40 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-20 w-96 h-96 rounded-full bg-amber-100/30 blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-md mx-auto z-10"
      >
        <div className="bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] rounded-3xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.04)] border border-gray-200/90 border-b-[4px] border-b-gray-300 overflow-hidden">
          {/* Header Banner */}
          <div
            className="px-8 pt-8 pb-7 text-white text-center relative overflow-hidden bg-gradient-to-b from-[#730203] via-[#5C0102] to-[#450001] border-b border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-xs border border-white/30 border-b-2 border-b-black/25 flex items-center justify-center mx-auto mb-3.5 shadow-[0_4px_12px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.35)]">
              <Icon size={26} className="text-white drop-shadow-xs" />
            </div>
            <div className="inline-block px-3 py-0.5 rounded-full bg-white/15 border border-white/25 text-white/95 text-xs font-bold mb-2 tracking-wide uppercase shadow-[0_2px_4px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.2)]">
              {role.badge}
            </div>
            <h2 className="text-xl font-extrabold text-white tracking-tight drop-shadow-xs">
              {role.title} Portal
            </h2>
            <p className="text-red-100/85 text-xs mt-1 font-medium">
              Camarines Norte National High School
            </p>
          </div>

          {/* Form Body */}
          <div className="p-7">
            <button
              type="button"
              onClick={() => setMode("select")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-gray-600 hover:text-[#5C0102] bg-white border border-gray-200/80 border-b-2 border-b-gray-300 hover:border-[#5C0102]/40 hover:bg-red-50/50 mb-5 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)] cursor-pointer active:translate-y-[1px]"
            >
              <ArrowLeft size={14} /> Back to role selection
            </button>

            <div className="bg-gradient-to-b from-amber-50 to-amber-100/50 border border-amber-200/90 border-b-[2.5px] border-b-amber-300 rounded-xl p-3.5 mb-5 text-xs text-amber-900 flex items-start gap-2.5 shadow-[0_2px_6px_rgba(245,158,11,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
              <AlertCircle size={15} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-medium">{role.hint}</div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-b from-red-50 to-red-100/50 border border-red-200/90 border-b-[2.5px] border-b-red-300 rounded-xl p-3.5 mb-5 flex items-start gap-2.5 text-xs text-red-700 shadow-[0_2px_6px_rgba(239,68,68,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]"
              >
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                <span className="leading-relaxed font-medium">{error}</span>
              </motion.div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
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
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50/70 border border-gray-200/90 border-b-[2.5px] border-b-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 shadow-[inset_0_1px_1px_rgba(0,0,0,0.04)] focus:outline-none focus:ring-4 focus:ring-[#5C0102]/10 focus:border-[#5C0102] focus:border-b-[#5C0102] focus:bg-white focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)] transition-all"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-11 py-2.5 bg-gray-50/70 border border-gray-200/90 border-b-[2.5px] border-b-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 shadow-[inset_0_1px_1px_rgba(0,0,0,0.04)] focus:outline-none focus:ring-4 focus:ring-[#5C0102]/10 focus:border-[#5C0102] focus:border-b-[#5C0102] focus:bg-white focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)] transition-all"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full mt-2 py-3 text-white rounded-xl text-sm font-bold tracking-wide transition-all bg-gradient-to-b from-[#7A0203] via-[#5C0102] to-[#450001] border-b-[3.5px] border-b-[#2e0001] shadow-[0_4px_14px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] hover:brightness-105 hover:shadow-[0_6px_18px_rgba(92,1,2,0.32)] active:translate-y-[2px] active:border-b-2 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  "Login"
                )}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-xs font-semibold text-[#5C0102] hover:underline underline-offset-4 cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {mode === "student" && (
              <p className="text-center text-xs text-gray-500 mt-6">
                Don&apos;t have an account yet?{" "}
                <Link
                  to="/register"
                  className="font-semibold text-[#5C0102] hover:underline underline-offset-4"
                >
                  Register here
                </Link>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
