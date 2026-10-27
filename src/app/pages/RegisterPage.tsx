import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
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
    <label className="block text-sm text-gray-700 mb-1.5">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(field, e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 ${
        error ? "border-red-400" : "border-gray-200"
      } ${disabled ? "opacity-60 cursor-not-allowed bg-gray-100" : ""}`}
    />
    {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    {error && (
      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
        <AlertCircle size={12} /> {error}
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
  const submitConfirm = useConfirm({ title: "Submit Registration?", description: "Are you sure you want to register with the provided information?", confirmText: "Submit" });

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
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 max-w-md w-full text-center"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ backgroundColor: "#FFF0F0" }}
          >
            <CheckCircle size={32} style={{ color: "#5C0102" }} />
          </div>
          <h2 className="text-gray-900 mb-3">Registration Submitted!</h2>
          <p className="text-gray-500 text-sm mb-6">
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
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mb-6">
              The SSLG Adviser can approve your account from Student Enrollment once your details are verified.
            </div>
          )}
          <Link
            to="/login"
            className="block w-full py-2.5 text-white rounded-lg text-sm font-medium text-center transition-all hover:opacity-90"
            style={{ backgroundColor: "#5C0102" }}
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
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
          <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          Checking LRN in the system...
        </div>
      );
    }
    if (lrnStatus === "approved") {
      return (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            This LRN is already registered and approved. Please{" "}
            <Link to="/login" className="underline font-medium">log in instead</Link>.
          </span>
        </div>
      );
    }
    if (lrnStatus === "pendingReview") {
      return (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>This LRN already has a registration awaiting SSLG Adviser review. You cannot register again with this LRN.</span>
        </div>
      );
    }
    if (lrnStatus === "inMasterlist") {
      return (
        <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
          <CheckCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            LRN found in the <strong>Student Masterlist</strong>. Enter your details exactly as
            enrolled — full name, grade level, gender, and birthdate. Exact matches are approved
            automatically; any mismatch prevents registration.
          </span>
        </div>
      );
    }
    if (lrnStatus === "notFound") {
      return (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Your LRN was not found in the system or the Student Masterlist. You may still
            register, but your account will <strong>wait for SSLG Adviser verification</strong>.
          </span>
        </div>
      );
    }
    if (lrnStatus === "error") {
      return (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>The system could not check this LRN right now. You can still submit — duplicate registrations are rejected automatically.</span>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="mb-6">
            <Link
              to="/login"
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5 transition-colors"
            >
              <ArrowLeft size={14} /> Back to Login
            </Link>
            <h1 className="text-gray-900 mb-1">Student Registration</h1>
            <p className="text-gray-500 text-sm">
              Enter your LRN first — the system checks it as you type. LRNs found in the
              Student Masterlist must match it exactly to be approved automatically;
              LRNs not in the system yet wait for SSLG Adviser review.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100" style={{ backgroundColor: "#FFF5F5" }}>
              <h3 className="text-sm" style={{ color: "#5C0102" }}>
                Personal Information
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Fields marked with * are required</p>
            </div>

            <div className="p-6 space-y-4">
              {/* LRN — first field, checked against the system as you type */}
              <div className="space-y-2">
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

              {/* Name Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">
                    Grade Level <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.gradeLevel}
                    onChange={(e) => update("gradeLevel", e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 ${
                      errors.gradeLevel ? "border-red-400" : "border-gray-200"
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
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.gradeLevel}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">
                    Gender <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.gender}
                    onChange={(e) => update("gender", e.target.value)}
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 ${
                      errors.gender ? "border-red-400" : "border-gray-200"
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
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.gender}
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
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Your details do not match the Student Masterlist record for this LRN.
                    Registration cannot continue until all details match.
                  </span>
                </div>
              )}

              {/* Account Details */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-sm font-medium text-gray-700 mb-4">Account Details</h3>
                <div className="space-y-4">
                  <InputField
                    label="Email Address"
                    field="email"
                    type="email"
                    placeholder="your.email@example.com"
                    value={form.email}
                    onChange={update}
                    error={errors.email}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={form.password}
                          onChange={(e) => update("password", e.target.value)}
                          placeholder="Min. 6 characters"
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 pr-10 ${
                            errors.password ? "border-red-400" : "border-gray-200"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {errors.password && (
                        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                          <AlertCircle size={12} /> {errors.password}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        Confirm Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          value={form.confirmPassword}
                          onChange={(e) => update("confirmPassword", e.target.value)}
                          placeholder="Re-enter password"
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 pr-10 ${
                            errors.confirmPassword ? "border-red-400" : "border-gray-200"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {errors.confirmPassword && (
                        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                          <AlertCircle size={12} /> {errors.confirmPassword}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Important Notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800">
                <strong>Important:</strong> If your LRN is in the Student Masterlist, your details
                (name, grade level, gender, birthdate) must match it exactly — any mismatch will
                prevent registration. If your LRN is not in the system or the masterlist yet, your
                registration will wait for SSLG Adviser verification. The system does not reveal
                which personal field is wrong.
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading || lrnBlocked}
                className="w-full py-3 text-white rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                style={{ backgroundColor: "#5C0102" }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Submitting Registration...
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
