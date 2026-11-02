import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  GraduationCap,
  Lock,
  UserCheck,
} from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  checkLrnRegistration,
  getMasterlistRecord,
  matchesMasterlistRecord,
  registerStudentDirect,
  type MasterlistMatchRecord,
} from "../lib/supabaseData";
import { useConfirm } from "../lib/useConfirm";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

const GRADE_LEVELS = ["Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
const GENDERS = ["Male", "Female"];

// LRN-first flow (REG-LRN-01): the LRN is the first field and is checked
// against the system as soon as 12 digits are typed.
//   approved       -> block: already registered, go to login
//   pendingReview  -> block: a registration is already on file
//   inMasterlist   -> allowed, but details must match the masterlist exactly
//   notFound       -> allowed: registers as pending for SSLG Adviser review
type LrnStatus = "idle" | "checking" | "approved" | "pendingReview" | "inMasterlist" | "notFound" | "error";

interface InputFieldProps {
  label: string;
  field: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (field: string, value: string) => void;
  error?: string;
  disabled?: boolean;
}

const InputField = ({
  label,
  field,
  type = "text",
  placeholder,
  required = true,
  hint,
  value,
  onChange,
  error,
  disabled = false,
}: InputFieldProps) => (
  <div>
    <label className="block text-xs sm:text-[13px] font-bold text-gray-800 tracking-wide mb-1.5">
      {label} {required && <span className="text-red-500 font-bold ml-0.5">*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(field, e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-medium transition-all duration-200 outline-none ${
        disabled
          ? "opacity-60 cursor-not-allowed bg-gray-100 border border-gray-200 text-gray-500 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
          : error
            ? "border border-red-400 border-b-[2.5px] border-b-red-500 bg-red-50/20 text-gray-900 shadow-[0_2px_6px_rgba(239,68,68,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)] focus:ring-4 focus:ring-red-100 focus:border-red-500"
            : "border border-gray-200/90 border-b-[2.5px] border-b-gray-300 bg-gray-50/70 text-gray-900 placeholder:text-gray-400 shadow-[0_2px_4px_rgba(0,0,0,0.02),inset_0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#5C0102] focus:border-b-[#5C0102] focus:ring-4 focus:ring-[#5C0102]/10 focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)]"
      }`}
    />
    {hint && !error && <p className="text-xs text-gray-500 mt-1 font-medium">{hint}</p>}
    {error && (
      <p className="text-xs sm:text-sm text-red-600 mt-1.5 flex items-center gap-1 font-semibold">
        <AlertCircle size={14} className="shrink-0" /> {error}
      </p>
    )}
  </div>
);

export default function RegisterPage() {
  const { students, setStudents, addLog } = useApp();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    gradeLevel: "",
    gender: "",
    birthdate: "",
    lrn: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState<"approved" | "pending">("pending");
  const [loading, setLoading] = useState(false);
  const [lrnStatus, setLrnStatus] = useState<LrnStatus>("idle");
  const [masterRecord, setMasterRecord] = useState<MasterlistMatchRecord | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const submitConfirm = useConfirm({
    title: "Submit Registration?",
    description: "Are you sure you want to register with the provided information?",
    confirmText: "Submit",
  });

  // Sequence guard: only the newest LRN check may update state, so a slow
  // in-flight response can never overwrite the result of a newer one.
  const lrnCheckSeq = useRef(0);

  const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const nameFields = new Set(["firstName", "middleName", "lastName"]);

  const update = (field: string, value: string) => {
    let v = value;
    if (field === "lrn") v = value.replace(/\D/g, "").slice(0, 12);
    else if (nameFields.has(field)) v = capitalizeFirst(value);
    setForm((f) => ({ ...f, [field]: v }));
    setErrors((e) => ({ ...e, [field]: "" }));
    setMismatch(false);
  };

  /**
   * Search the system for an LRN and apply the resulting status.  Returns
   * the resolved status plus the enrolled masterlist record (when found) so
   * the submit handler can enforce the exact-match rule without waiting for
   * another render.
   */
  const runLrnCheck = useCallback(async (value: string): Promise<{ status: LrnStatus; record: MasterlistMatchRecord | null }> => {
    const seq = ++lrnCheckSeq.current;
    setLrnStatus("checking");
    setMasterRecord(null);
    const apply = (status: LrnStatus, record: MasterlistMatchRecord | null = null) => {
      if (lrnCheckSeq.current !== seq) return;
      setLrnStatus(status);
      setMasterRecord(record);
    };
    try {
      const check = await checkLrnRegistration(value);
      if (lrnCheckSeq.current !== seq) return { status: "idle", record: null };
      if (check.inStudents && check.studentStatus === "approved") {
        apply("approved");
        return { status: "approved", record: null };
      }
      if (check.inStudents) {
        // Any other students row (pending/rejected) means a registration is
        // already on file for this LRN — block duplicate registrations.
        apply("pendingReview");
        return { status: "pendingReview", record: null };
      }
      if (check.inMasterlist) {
        const record = await getMasterlistRecord(value);
        if (lrnCheckSeq.current !== seq) return { status: "idle", record: null };
        // The masterlist is authoritative: if it holds no middle name for
        // this learner, the Middle Name input is locked and any typed value
        // is dropped so nothing stale reaches the insert.
        if (record && !record.middle_name?.trim()) {
          setForm((f) => (f.middleName ? { ...f, middleName: "" } : f));
        }
        const status: LrnStatus = record ? "inMasterlist" : "notFound";
        apply(status, record);
        return { status, record };
      }
      apply("notFound");
      return { status: "notFound", record: null };
    } catch {
      apply("error");
      return { status: "error", record: null };
    }
  }, []);

  // Auto-check: 400ms after the LRN reaches exactly 12 digits.
  useEffect(() => {
    const value = form.lrn.trim();
    if (!/^\d{12}$/.test(value)) {
      lrnCheckSeq.current++;
      setLrnStatus("idle");
      setMasterRecord(null);
      return;
    }
    if (!isSupabaseConfigured) return;
    const timer = setTimeout(() => {
      void runLrnCheck(value);
    }, 400);
    return () => clearTimeout(timer);
  }, [form.lrn, runLrnCheck]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.firstName.trim()) newErrors.firstName = "First name is required.";
    if (!form.lastName.trim()) newErrors.lastName = "Last name is required.";
    if (!form.gradeLevel) newErrors.gradeLevel = "Grade level is required.";
    if (!form.gender) newErrors.gender = "Gender is required.";
    if (!form.birthdate) newErrors.birthdate = "Birthdate is required.";
    if (!form.lrn.trim()) {
      newErrors.lrn = "LRN is required.";
    } else if (!/^\d{12}$/.test(form.lrn.trim())) {
      newErrors.lrn = "LRN must be exactly 12 digits.";
    } else if (lrnStatus === "approved") {
      newErrors.lrn = "This LRN is already registered and approved. Please log in instead.";
    } else if (lrnStatus === "pendingReview") {
      newErrors.lrn = "This LRN already has a registration awaiting SSLG Adviser review.";
    }
    if (!form.email.trim()) {
      newErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = "Please enter a valid email address.";
    } else if (students.some((s) => s.email === form.email)) {
      newErrors.email = "This email is already registered.";
    }
    if (!form.password) {
      newErrors.password = "Password is required.";
    } else if (form.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters.";
    }
    if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }
    return newErrors;
  };

  const handleSubmit = async () => {
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!isSupabaseConfigured) {
      setErrors({ email: "System is not connected to the database. Please try again later." });
      return;
    }

    setLoading(true);
    try {
      // Fresh LRN check at submit time — the banner state may be stale.
      const { status, record } = await runLrnCheck(form.lrn.trim());
      if (status === "approved") {
        setErrors({ lrn: "This LRN is already registered and approved. Please log in instead." });
        return;
      }
      if (status === "pendingReview") {
        setErrors({ lrn: "This LRN already has a registration awaiting SSLG Adviser review." });
        return;
      }
      // Locked MASTER-02 rule: an LRN found in the masterlist must match it
      // exactly — any mismatch blocks registration before anything is stored.
      if (record && !matchesMasterlistRecord(
        {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          birthdate: form.birthdate,
          gradeLevel: form.gradeLevel,
          gender: form.gender,
        },
        record,
      )) {
        setMismatch(true);
        return;
      }
      setMismatch(false);

      const ok = await submitConfirm.confirm();
      if (!ok) return;

      const newStudent = await registerStudentDirect({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
        gradeLevel: form.gradeLevel,
        gender: form.gender,
        birthdate: form.birthdate,
        lrn: form.lrn.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      setStudents([...students, newStudent]);
      setSubmittedStatus(newStudent.status === "approved" ? "approved" : "pending");
      addLog({
        // newStudent carries the stored Title Cased name, not the raw input.
        user: `${newStudent.firstName} ${newStudent.lastName}`,
        role: "Student",
        action: "Student Registration",
        details: `Student registered (LRN: ${form.lrn}) - ${newStudent.status === "approved" ? "Auto approved via Student Masterlist" : "Awaiting SSLG Adviser review"}`,
        type: newStudent.status === "approved" ? "success" : "info",
      });
      setSubmitted(true);
    } catch (err) {
      setErrors({
        email: err instanceof Error ? err.message : "Unable to submit registration.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 bg-gray-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          className="bg-white rounded-3xl shadow-[0_20px_50px_-10px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,1)] border border-gray-200/90 border-b-[4px] border-b-gray-300 p-8 sm:p-12 max-w-lg w-full text-center relative overflow-hidden"
        >
          {/* Top accent gradient bar */}
          <div
            className="absolute top-0 left-0 right-0 h-2"
            style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
          />

          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_6px_16px_rgba(92,1,2,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] border border-rose-100 border-b-[2.5px] border-b-rose-200"
            style={{ backgroundColor: "rgba(92, 1, 2, 0.06)" }}
          >
            <CheckCircle size={40} style={{ color: "#5C0102" }} />
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 tracking-tight">
            Registration Submitted!
          </h2>

          <p className="text-gray-600 text-sm sm:text-base leading-relaxed mb-6 max-w-sm mx-auto">
            {submittedStatus === "approved" ? (
              <>
                Your registration details matched the official{" "}
                <strong>Student Masterlist</strong> (LRN, full name, birthdate,
                grade level, and gender). Your account has been{" "}
                <strong>automatically approved</strong> and is ready for login.
              </>
            ) : (
              <>
                Your registration has been submitted successfully. Your account is
                now <strong>awaiting SSLG Adviser review</strong>.
              </>
            )}
          </p>

          {submittedStatus === "pending" && (
            <div className="bg-gradient-to-b from-amber-50 to-amber-100/40 border border-amber-200/90 border-b-[3px] border-b-amber-300 rounded-2xl p-4 text-xs sm:text-sm text-amber-800 mb-6 text-left flex items-start gap-3 shadow-[0_2px_6px_rgba(245,158,11,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
              <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <span>
                The SSLG Adviser can approve your account from Student Enrollment once your details are verified against school records.
              </span>
            </div>
          )}

          <Link
            to="/login"
            className="block w-full py-3.5 text-white rounded-xl text-sm font-bold text-center transition-all duration-150 hover:brightness-105 active:translate-y-[2px] active:border-b-2 shadow-[0_6px_16px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] border-b-[3.5px] border-b-[#380001] cursor-pointer"
            style={{ background: "linear-gradient(135deg, #5C0102 0%, #7A0103 100%)" }}
          >
            Go to Login
          </Link>
        </motion.div>
      </div>
    );
  }

  const lrnBlocked = lrnStatus === "approved" || lrnStatus === "pendingReview";

  // The masterlist is authoritative on the middle name: no middle name on
  // record means the learner has none, so the input is locked.  Everyone
  // else (not in masterlist / still checking / errored) keeps a free field.
  const masterHasNoMiddleName = Boolean(masterRecord) && !masterRecord?.middle_name?.trim();

  const lrnBanner = (() => {
    if (lrnStatus === "checking") {
      return (
        <div className="flex items-center gap-2.5 bg-gray-50/90 border border-gray-200/90 border-b-[2.5px] border-b-gray-300 rounded-xl p-3 text-xs text-gray-600 shadow-[0_2px_4px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin shrink-0" />
          <span>Checking LRN in the system...</span>
        </div>
      );
    }
    if (lrnStatus === "approved") {
      return (
        <div className="flex items-start gap-2.5 bg-gradient-to-b from-red-50 to-red-100/40 border border-red-200/90 border-b-[3px] border-b-red-300 rounded-xl p-3.5 text-xs text-red-700 shadow-[0_4px_10px_rgba(239,68,68,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="leading-relaxed">
            This LRN is already registered and approved. Please{" "}
            <Link to="/login" className="underline font-bold hover:text-red-900">log in instead</Link>.
          </span>
        </div>
      );
    }
    if (lrnStatus === "pendingReview") {
      return (
        <div className="flex items-start gap-2.5 bg-gradient-to-b from-red-50 to-red-100/40 border border-red-200/90 border-b-[3px] border-b-red-300 rounded-xl p-3.5 text-xs text-red-700 shadow-[0_4px_10px_rgba(239,68,68,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="leading-relaxed">
            This LRN already has a registration awaiting SSLG Adviser review. You cannot register again with this LRN.
          </span>
        </div>
      );
    }
    if (lrnStatus === "inMasterlist") {
      return (
        <div className="flex items-start gap-2.5 bg-gradient-to-b from-emerald-50 to-emerald-100/40 border border-emerald-200/90 border-b-[3px] border-b-emerald-300 rounded-xl p-3.5 text-xs text-emerald-800 shadow-[0_4px_10px_rgba(16,185,129,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <CheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <span className="leading-relaxed">
            LRN found in the <strong>Student Masterlist</strong>. Enter your details exactly as
            enrolled — full name, grade level, gender, and birthdate. Exact matches are approved
            automatically; any mismatch prevents registration.
          </span>
        </div>
      );
    }
    if (lrnStatus === "notFound") {
      return (
        <div className="flex items-start gap-2.5 bg-gradient-to-b from-amber-50 to-amber-100/40 border border-amber-200/90 border-b-[3px] border-b-amber-300 rounded-xl p-3.5 text-xs text-amber-800 shadow-[0_4px_10px_rgba(245,158,11,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span className="leading-relaxed">
            Your LRN was not found in the system or the Student Masterlist. You may still
            register, but your account will <strong>wait for SSLG Adviser verification</strong>.
          </span>
        </div>
      );
    }
    if (lrnStatus === "error") {
      return (
        <div className="flex items-start gap-2.5 bg-gradient-to-b from-amber-50 to-amber-100/40 border border-amber-200/90 border-b-[3px] border-b-amber-300 rounded-xl p-3.5 text-xs text-amber-800 shadow-[0_4px_10px_rgba(245,158,11,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span className="leading-relaxed">
            The system could not check this LRN right now. You can still submit — duplicate registrations are rejected automatically.
          </span>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 py-3 sm:py-5 lg:py-6 px-4 sm:px-6 lg:px-8 flex flex-col justify-center">
      <div className="w-full max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full"
        >
          {/* ── Page Header ────────────────────────────────────── */}
          <div className="mb-3.5 sm:mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-white border border-gray-200 shadow-[0_3px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)] flex items-center justify-center p-1.5 shrink-0 border-b-[2.5px] border-b-gray-300">
                <img src={cnnhsLogo} alt="" className="w-full h-full object-contain rounded-full" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider block" style={{ color: "#5C0102" }}>
                  Learner Enrollment
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight leading-tight">
                  Student Registration
                </h1>
              </div>
            </div>

            {/* ── IMPORTANT INSTRUCTION ──────────────────────────── */}
            <div className="mt-3.5 p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-amber-50 to-amber-100/40 border border-amber-200/90 border-b-[3.5px] border-b-amber-300/80 shadow-[0_4px_14px_rgba(245,158,11,0.08),inset_0_1px_0_rgba(255,255,255,0.8)] flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 border-b-[2px] border-b-amber-600/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] flex items-center justify-center shrink-0 mt-0.5 text-amber-900">
                <AlertCircle size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-amber-950 flex items-center gap-1.5 mb-1.5">
                  <span>IMPORTANT INSTRUCTION</span>
                </div>
                <p className="text-amber-950 text-sm sm:text-[15px] leading-relaxed">
                  <strong className="font-bold text-[#5C0102]">Enter your LRN first</strong>. The system will automatically check it as you type. If your LRN is in the Student Masterlist, your <strong className="font-bold text-gray-950">name, grade level, gender, and birthdate</strong> must match the records exactly for automatic approval. <strong className="font-bold text-[#5C0102]">Any mismatch will prevent automatic approval</strong>. If your LRN is not yet in the system or Student Masterlist, your registration will remain <strong className="font-bold text-amber-900">pending SSLG Adviser verification</strong>. For security purposes, the system will not disclose which personal detail does not match.
                </p>
              </div>
            </div>
          </div>

          {/* ── Main Form Card ─────────────────────────────────── */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.07),0_4px_16px_-4px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,1)] border-b-[4px] border-b-gray-300 overflow-hidden relative">
            {/* Top decorative gradient line */}
            <div
              className="h-1.5 w-full"
              style={{ background: "linear-gradient(90deg, #5C0102, #8B0103, #6B0203)" }}
            />

            {/* Card Section Header */}
            <div
              className="px-6 sm:px-8 py-3.5 sm:py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50/90 via-white to-gray-50/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-[0_3px_8px_rgba(92,1,2,0.3),inset_0_1px_0_rgba(255,255,255,0.3)] border border-white/20 border-b-[2px] border-b-black/20"
                  style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
                >
                  <UserCheck size={18} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 tracking-tight">
                    Personal Information
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5 font-medium">Fields marked with * are required</p>
                </div>
              </div>

              <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-gray-700 bg-white border border-gray-200 shadow-[0_2px_4px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] border-b-[2px] border-b-gray-300">
                <GraduationCap size={13} style={{ color: "#5C0102" }} />
                <span>Student Verification</span>
              </div>
            </div>

            <div className="p-5 sm:p-7 space-y-4 sm:space-y-4.5">
              {/* LRN — first field, checked against the system as you type */}
              <div className="space-y-1.5">
                <InputField
                  label="LRN (Learner Reference Number)"
                  field="lrn"
                  placeholder="12-digit LRN"
                  hint="Your LRN is checked against the system once all 12 digits are entered"
                  value={form.lrn}
                  onChange={update}
                  error={errors.lrn}
                />
                {lrnBanner}
              </div>

              {/* Name Fields — 3 columns */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
                <InputField
                  label="First Name"
                  field="firstName"
                  placeholder="e.g. Maria"
                  value={form.firstName}
                  onChange={update}
                  error={errors.firstName}
                />
                <InputField
                  label="Middle Name"
                  field="middleName"
                  placeholder="e.g. Cruz"
                  required={false}
                  hint={masterHasNoMiddleName ? "Not on your masterlist record" : "Optional"}
                  value={form.middleName}
                  onChange={update}
                  error={errors.middleName}
                  disabled={masterHasNoMiddleName}
                />
                <InputField
                  label="Last Name"
                  field="lastName"
                  placeholder="e.g. Santos"
                  value={form.lastName}
                  onChange={update}
                  error={errors.lastName}
                />
              </div>

              {/* Grade Level, Gender, Birthdate — one line, 3 columns */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-[13px] font-bold text-gray-800 tracking-wide mb-1.5">
                    Grade Level <span className="text-red-500 font-bold ml-0.5">*</span>
                  </label>
                  <select
                    value={form.gradeLevel}
                    onChange={(e) => update("gradeLevel", e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-medium transition-all duration-200 outline-none ${
                      errors.gradeLevel
                        ? "border border-red-400 border-b-[2.5px] border-b-red-500 bg-red-50/20 text-gray-900 shadow-[0_2px_6px_rgba(239,68,68,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)] focus:ring-4 focus:ring-red-100"
                        : "border border-gray-200/90 border-b-[2.5px] border-b-gray-300 bg-gray-50/70 text-gray-900 focus:bg-white focus:border-[#5C0102] focus:border-b-[#5C0102] focus:ring-4 focus:ring-[#5C0102]/10 focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)]"
                    }`}
                  >
                    <option value="">Select grade level</option>
                    {GRADE_LEVELS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  {errors.gradeLevel && (
                    <p className="text-xs sm:text-sm text-red-600 mt-1.5 flex items-center gap-1 font-semibold">
                      <AlertCircle size={14} className="shrink-0" /> {errors.gradeLevel}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs sm:text-[13px] font-bold text-gray-800 tracking-wide mb-1.5">
                    Gender <span className="text-red-500 font-bold ml-0.5">*</span>
                  </label>
                  <select
                    value={form.gender}
                    onChange={(e) => update("gender", e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm sm:text-[15px] font-medium transition-all duration-200 outline-none ${
                      errors.gender
                        ? "border border-red-400 border-b-[2.5px] border-b-red-500 bg-red-50/20 text-gray-900 shadow-[0_2px_6px_rgba(239,68,68,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)] focus:ring-4 focus:ring-red-100"
                        : "border border-gray-200/90 border-b-[2.5px] border-b-gray-300 bg-gray-50/70 text-gray-900 focus:bg-white focus:border-[#5C0102] focus:border-b-[#5C0102] focus:ring-4 focus:ring-[#5C0102]/10 focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)]"
                    }`}
                  >
                    <option value="">Select gender</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  {errors.gender && (
                    <p className="text-xs sm:text-sm text-red-600 mt-1.5 flex items-center gap-1 font-semibold">
                      <AlertCircle size={14} className="shrink-0" /> {errors.gender}
                    </p>
                  )}
                </div>

                <InputField
                  label="Birthdate"
                  field="birthdate"
                  type="date"
                  value={form.birthdate}
                  onChange={update}
                  error={errors.birthdate}
                />
              </div>

              {/* Locked MASTER-02 rule: details must match the masterlist exactly */}
              {mismatch && (
                <div className="flex items-start gap-2.5 bg-gradient-to-b from-red-50 to-red-100/40 border border-red-200 border-b-[2.5px] border-b-red-400 rounded-xl p-3 text-xs sm:text-sm text-red-700 shadow-[0_2px_6px_rgba(239,68,68,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
                  <span className="leading-relaxed font-medium">
                    Your details do not match the Student Masterlist record for this LRN.
                    Registration cannot continue until all details match.
                  </span>
                </div>
              )}

              {/* ── Account Details Section ──────────────────────── */}
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2.5 mb-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 shadow-[0_2px_6px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] border border-white/20 border-b-[2px] border-b-black/20"
                    style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
                  >
                    <Lock size={14} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 tracking-tight">Account Credentials</h3>
                    <p className="text-xs text-gray-500 font-medium">Used for signing in and voter access</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
                  <InputField
                    label="Email Address"
                    field="email"
                    type="email"
                    placeholder="your.email@example.com"
                    value={form.email}
                    onChange={update}
                    error={errors.email}
                  />

                  <div>
                    <label className="block text-xs sm:text-[13px] font-bold text-gray-800 tracking-wide mb-1.5">
                      Password <span className="text-red-500 font-bold ml-0.5">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(e) => update("password", e.target.value)}
                        placeholder="Min. 6 characters"
                        className={`w-full pl-3.5 pr-10 py-2.5 rounded-xl text-sm sm:text-[15px] font-medium transition-all duration-200 outline-none ${
                          errors.password
                            ? "border border-red-400 border-b-[2.5px] border-b-red-500 bg-red-50/20 text-gray-900 shadow-[0_2px_6px_rgba(239,68,68,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)] focus:ring-4 focus:ring-red-100"
                            : "border border-gray-200/90 border-b-[2.5px] border-b-gray-300 bg-gray-50/70 text-gray-900 focus:bg-white focus:border-[#5C0102] focus:border-b-[#5C0102] focus:ring-4 focus:ring-[#5C0102]/10 focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)]"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                        tabIndex={-1}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-xs sm:text-sm text-red-600 mt-1.5 flex items-center gap-1 font-semibold">
                        <AlertCircle size={14} className="shrink-0" /> {errors.password}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs sm:text-[13px] font-bold text-gray-800 tracking-wide mb-1.5">
                      Confirm Password <span className="text-red-500 font-bold ml-0.5">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={form.confirmPassword}
                        onChange={(e) => update("confirmPassword", e.target.value)}
                        placeholder="Re-enter password"
                        className={`w-full pl-3.5 pr-10 py-2.5 rounded-xl text-sm sm:text-[15px] font-medium transition-all duration-200 outline-none ${
                          errors.confirmPassword
                            ? "border border-red-400 border-b-[2.5px] border-b-red-500 bg-red-50/20 text-gray-900 shadow-[0_2px_6px_rgba(239,68,68,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)] focus:ring-4 focus:ring-red-100"
                            : "border border-gray-200/90 border-b-[2.5px] border-b-gray-300 bg-gray-50/70 text-gray-900 focus:bg-white focus:border-[#5C0102] focus:border-b-[#5C0102] focus:ring-4 focus:ring-[#5C0102]/10 focus:shadow-[0_4px_12px_rgba(92,1,2,0.08),inset_0_1px_0_rgba(255,255,255,1)]"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                        tabIndex={-1}
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      >
                        {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <p className="text-xs sm:text-sm text-red-600 mt-1.5 flex items-center gap-1 font-semibold">
                        <AlertCircle size={14} className="shrink-0" /> {errors.confirmPassword}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Submit CTA */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || lrnBlocked}
                className="w-full py-3 sm:py-3.5 text-white rounded-xl text-sm sm:text-base font-extrabold transition-all duration-150 hover:brightness-105 active:translate-y-[2px] active:border-b-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:border-b-[3.5px] flex items-center justify-center gap-2 shadow-[0_6px_16px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] border-b-[3.5px] border-b-[#380001] cursor-pointer"
                style={{ background: "linear-gradient(135deg, #5C0102 0%, #7A0103 100%)" }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Submitting Registration...</span>
                  </>
                ) : (
                  "Submit Registration"
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
      {submitConfirm.dialog}
    </div>
  );
}
