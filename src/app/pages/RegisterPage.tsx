import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { registerStudentDirect } from "../lib/supabaseData";
import { useConfirm } from "../lib/useConfirm";

const GRADE_LEVELS = ["Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
const GENDERS = ["Male", "Female"];

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
      className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all bg-gray-50 ${
        error ? "border-red-400" : "border-gray-200"
      }`}
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
  const { students, setStudents, registeredLRNs, addLog } = useApp();
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
  const submitConfirm = useConfirm({ title: "Submit Registration?", description: "Are you sure you want to register with the provided information?", confirmText: "Submit" });

  const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const nameFields = new Set(["firstName", "middleName", "lastName"]);

  const update = (field: string, value: string) => {
    let v = value;
    if (field === "lrn") v = value.replace(/\D/g, "").slice(0, 12);
    else if (nameFields.has(field)) v = capitalizeFirst(value);
    setForm((f) => ({ ...f, [field]: v }));
    setErrors((e) => ({ ...e, [field]: "" }));
  };

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
    } else if (registeredLRNs.has(form.lrn.trim())) {
      newErrors.lrn = "This LRN is already registered in the system.";
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
    const ok = await submitConfirm.confirm();
    if (!ok) return;

    if (!isSupabaseConfigured) {
      setErrors({ email: "System is not connected to the database. Please try again later." });
      return;
    }

    setLoading(true);
    try {
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
              Your details are checked against the Student Masterlist (LRN, full name,
              birthdate, grade level, and gender). Exact matches are approved
              automatically; any mismatch waits for SSLG Adviser review.
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
                  hint="Optional"
                  value={form.middleName}
                  onChange={update}
                  error={errors.middleName}
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

              {/* Grade and Gender */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              </div>

              {/* Birthdate and LRN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InputField
                  label="Birthdate"
                  field="birthdate"
                  type="date"
                  value={form.birthdate}
                  onChange={update}
                  error={errors.birthdate}
                />
                <InputField
                  label="LRN (Learner Reference Number)"
                  field="lrn"
                  placeholder="12-digit LRN"
                  hint="Must be a unique 12-digit number"
                  value={form.lrn}
                  onChange={update}
                  error={errors.lrn}
                />
              </div>

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
                <strong>Important:</strong> If your LRN is not in the school master list,
                registration cannot continue. The system does not reveal which personal field is
                wrong when multiple details fail verification.
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
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
