import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { GraduationCap, Shield, Eye, EyeOff, ArrowLeft, AlertCircle, ClipboardList, BookOpen } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { signInWithSupabase, signInStudentDirect, signInSslgAdviser } from "../lib/supabaseData";

type LoginMode = "select" | "student" | "commissioner" | "admin" | "sslg_adviser";

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

  const roleConfig = {
    student: {
      label: "Student Login",
      icon: <GraduationCap size={28} />,
      color: "#5C0102",
      hint: "Use your registered email and password.",
    },
    commissioner: {
      label: "Commissioner Login",
      icon: <ClipboardList size={28} />,
      color: "#5C0102",
      hint: "For appointed Commissioners (Screening, Electoral Board, Appointment, Grievance).",
    },
    admin: {
      label: "Chief Commissioner Login",
      icon: <Shield size={28} />,
      color: "#5C0102",
      hint: "Restricted to the Chief Commissioner only.",
    },
    sslg_adviser: {
      label: "SSLG Adviser Login",
      icon: <BookOpen size={28} />,
      color: "#5C0102",
      hint: "Login with your SSLG Adviser credentials.",
    },
  };

  if (mode === "select") {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 bg-gray-50">
        <div className="w-full max-w-4xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="text-center mb-10">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white" style={{ backgroundColor: "#5C0102" }}>
                <Shield size={28} />
              </div>
              <h1 className="text-gray-900 mb-2">Welcome Back</h1>
              <p className="text-gray-500 text-sm">Select your role to continue to the login portal</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {(["student", "commissioner", "admin", "sslg_adviser"] as const).map((role, i) => (
                <motion.button
                  key={role}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  onClick={() => { setMode(role); setEmail(""); setPassword(""); setError(""); }}
                  className="bg-white border-2 border-gray-200 hover:border-[#5C0102] hover:shadow-md rounded-2xl p-6 flex flex-col items-center gap-3 transition-all group cursor-pointer"
                >
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white group-hover:scale-105 transition-transform" style={{ backgroundColor: "#5C0102" }}>
                    {role === "student" && <GraduationCap size={24} />}
                    {role === "commissioner" && <ClipboardList size={24} />}
                    {role === "admin" && <Shield size={24} />}
                    {role === "sslg_adviser" && <BookOpen size={24} />}
                  </div>
                  <div className="text-center">
                    <div className="font-medium text-gray-900 text-sm">{role === "sslg_adviser" ? "SSLG Adviser" : role.charAt(0).toUpperCase() + role.slice(1)}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {role === "student" && "Voters & Candidates"}
                      {role === "commissioner" && "Review & Validate"}
                      {role === "admin" && "System Control"}
                      {role === "sslg_adviser" && "Student Supervision"}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            <p className="text-center text-sm text-gray-500 mt-8">
              Don't have an account?{" "}
              <Link to="/register" className="font-medium" style={{ color: "#5C0102" }}>Register here</Link>
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  const config = roleConfig[mode];

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 bg-gray-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="p-8 text-white text-center" style={{ backgroundColor: "#5C0102" }}>
            <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center mx-auto mb-4">
              {config.icon}
            </div>
            <h2 className="text-white mb-1">{config.label}</h2>
            <p className="text-white/70 text-xs">Camarines Norte National High School</p>
          </div>

          {/* Form */}
          <div className="p-6">
            <button onClick={() => setMode("select")} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5 transition-colors">
              <ArrowLeft size={14} /> Back to role selection
            </button>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-5 text-xs text-blue-700">
              {config.hint}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 pr-10"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full py-2.5 text-white rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  "Login"
                )}
              </button>
            </div>

            {mode === "student" && (
              <p className="text-center text-sm text-gray-500 mt-5">
                No account yet?{" "}
                <Link to="/register" className="font-medium" style={{ color: "#5C0102" }}>Register here</Link>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
