import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  GraduationCap,
  Shield,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
  ClipboardList,
  BookOpen,
  Mail,
  Lock,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { signInWithSupabase, signInStudentDirect, signInSslgAdviser } from "../lib/supabaseData";

type LoginMode = "select" | "student" | "commissioner" | "admin" | "sslg_adviser";

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
  commissioner: {
    title: "Commissioner",
    subtitle: "Review & Validate",
    badge: "Commissioners",
    icon: ClipboardList,
    hint: "For appointed Commissioners (Screening, Electoral Board, Grievance).",
  },
  admin: {
    title: "Admin",
    subtitle: "System Control",
    badge: "Chief Commissioner",
    icon: Shield,
    hint: "Restricted to the Chief Commissioner only. Full election lifecycle control.",
  },
  sslg_adviser: {
    title: "SSLG Adviser",
    subtitle: "Student Supervision",
    badge: "Faculty & Advisory",
    icon: BookOpen,
    hint: "Login with your authorized SSLG Adviser credentials for supervision.",
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

    // Admin/Commissioner use Supabase Auth
    if (mode === "admin" || mode === "commissioner") {
      try {
        const user = await signInWithSupabase(email, password);
        if (mode === "admin" && user.commissionerRole !== "chief") {
          throw new Error("This account is not the Chief Commissioner. Use Commissioner login instead.");
        }
        if (mode === "commissioner" && (user.commissionerRole === "chief" || !user.commissionerRole)) {
          throw new Error("This account is not a commissioner. Use the correct login type.");
        }
        setCurrentUser(user);
        const roleLabel = mode === "admin" ? "admin" : "admin";
        addLog({
          user: user.name,
          role: roleLabel,
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

    // SSLG Adviser login
    if (mode === "sslg_adviser") {
      try {
        const user = await signInSslgAdviser(email, password);
        setCurrentUser(user);
        addLog({
          user: user.name,
          role: "admin",
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

        <div className="w-full max-w-5xl z-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full"
          >
            {/* Institution Header */}
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-50 border border-red-200/70 text-[#5C0102] text-xs font-semibold uppercase tracking-wider mb-4 shadow-xs">
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

            {/* Role Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {(["student", "commissioner", "admin", "sslg_adviser"] as const).map((roleKey, idx) => {
                const role = ROLE_DETAILS[roleKey];
                const Icon = role.icon;
                return (
                  <motion.button
                    key={roleKey}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: idx * 0.08 }}
                    whileHover={{ y: -4, transition: { duration: 0.2 } }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setMode(roleKey);
                      setEmail("");
                      setPassword("");
                      setError("");
                    }}
                    className="group relative flex flex-col items-center text-center p-7 bg-white rounded-2xl border border-gray-200/90 shadow-xs hover:border-[#5C0102] hover:shadow-xl hover:shadow-red-950/5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#5C0102] focus:ring-offset-2"
                  >
                    {/* Top Accent Pill */}
                    <span className="text-[11px] font-medium tracking-wide uppercase px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 group-hover:bg-red-50 group-hover:text-[#5C0102] transition-colors mb-5">
                      {role.badge}
                    </span>

                    {/* Icon container */}
                    <div className="flex-1 flex items-center justify-center w-full my-5">
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-md shadow-red-950/20 group-hover:scale-108 transition-all duration-300"
                        style={{ backgroundColor: "#5C0102" }}
                      >
                        <Icon size={28} className="transition-transform group-hover:rotate-3" />
                      </div>
                    </div>

                    {/* Labels matching test query: role.title + " " + role.subtitle */}
                    <div className="font-bold text-gray-900 text-base mb-1 group-hover:text-[#5C0102] transition-colors">
                      {role.title}
                    </div>
                    <div className="text-xs font-semibold text-gray-700 mb-2.5">
                      {role.subtitle}
                    </div>

                    <div className="mt-6 text-xs font-semibold text-[#5C0102] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
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
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/70 border border-gray-200/90 overflow-hidden">
          {/* Header Banner */}
          <div
            className="px-8 pt-8 pb-7 text-white text-center relative overflow-hidden"
            style={{ backgroundColor: "#5C0102" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-xs border border-white/25 flex items-center justify-center mx-auto mb-3.5 shadow-inner">
              <Icon size={26} className="text-white" />
            </div>
            <div className="inline-block px-2.5 py-0.5 rounded-full bg-white/15 text-white/90 text-xs font-semibold mb-2 tracking-wide uppercase">
              {role.badge}
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              {role.title} Portal
            </h2>
            <p className="text-red-100/80 text-xs mt-1">
              Camarines Norte National High School
            </p>
          </div>

          {/* Form Body */}
          <div className="p-7">
            <button
              type="button"
              onClick={() => setMode("select")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 mb-5 transition-colors cursor-pointer"
            >
              <ArrowLeft size={14} /> Back to role selection
            </button>

            <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl p-3.5 mb-5 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertCircle size={15} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{role.hint}</div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5 flex items-start gap-2.5 text-xs text-red-700"
              >
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                <span className="leading-relaxed font-medium">{error}</span>
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
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
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
                    className="w-full pl-10 pr-11 py-2.5 bg-gray-50/70 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] focus:bg-white transition-all"
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
                className="w-full mt-2 py-3 text-white rounded-xl text-sm font-semibold tracking-wide transition-all shadow-md hover:shadow-lg hover:brightness-105 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                style={{ backgroundColor: "#5C0102" }}
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
