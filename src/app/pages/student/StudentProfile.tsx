// file: StudentProfile.tsx
import { useRef, useState } from "react";
import { User, Mail, Calendar, BookOpen, GraduationCap, Hash, CheckCircle, Activity, Clock, AlertCircle, Eye, EyeOff, Camera, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { updateStudentPassword, uploadStudentPicture, updateMyProfilePictureRpc, deleteStudentPictureRpc } from "../../lib/supabaseData";
import { useConfirm } from "../../lib/useConfirm";

const formatStatus = (status: string) =>
  status === "ongoingSubmission" ? "Ongoing Submission" : status.charAt(0).toUpperCase() + status.slice(1);

// Mirrors the student-pictures bucket limits (072): 2 MB, jpeg/png/webp.
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const PICTURE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function StudentProfile() {
  const { currentUser, students, candidates, logs, setCurrentUser, setStudents } = useApp();
  const passwordConfirm = useConfirm({
    title: "Change Password?",
    description: "Are you sure you want to update your password?",
    confirmText: "Update",
  });
  const pictureConfirm = useConfirm({
    title: "Update Profile Picture?",
    description: "This will replace your current profile picture.",
    confirmText: "Upload",
  });
  const removePictureConfirm = useConfirm({
    title: "Remove Profile Picture?",
    description: "Your profile will show your initials instead.",
    confirmText: "Remove",
    destructive: true,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [pictureUploading, setPictureUploading] = useState(false);
  const [pictureError, setPictureError] = useState("");
  const [pictureSaved, setPictureSaved] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  const student = students.find((s) => s.id === currentUser?.id);
  const myApplication = candidates.find((c) => c.studentId === currentUser?.id);

  // Filter logs for the current student only
  const myLogs = logs.filter(
    (log) =>
      log.role.toLowerCase() === "student" &&
      log.user === (currentUser?.name ?? "")
  );

  const handlePasswordChange = async () => {
    const confirmed = await passwordConfirm.confirm();
    if (!confirmed) return;
    setPasswordError("");
    if (!newPassword) { setPasswordError("New password is required."); return; }
    if (newPassword.length < 6) { setPasswordError("New password must be at least 6 characters."); return; }
    if (newPassword !== confirmNewPassword) { setPasswordError("New passwords do not match."); return; }
    if (!student?.id) { setPasswordError("Student information not found."); return; }
    try {
      await updateStudentPassword(student.id, currentPassword, newPassword);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      // ACCT-05 client half: the change_my_password RPC deleted the active
      // sessions; reset the user state so the layout routes to login.
      setCurrentUser(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Password update failed.");
    }
  };

  // Best-effort storage cleanup via the delete_profile_picture edge
  // function — the profile_picture_url column is the source of truth, so
  // a storage hiccup must never surface an error or undo a removal/
  // replace that the RPC already persisted (worst case: one orphaned file
  // until a manual bucket sweep).
  const cleanupPictureObject = async (url: string | undefined) => {
    if (!url) return;
    try {
      await deleteStudentPictureRpc(url);
    } catch {
      /* best-effort — see comment above */
    }
  };

  // 072: upload -> RPC (the RPC re-validates the URL bucket server-side) ->
  // local context refresh so the header/sidebar pick the photo up too.
  const handlePictureSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a cancel
    if (!file || !student?.id) return;
    setPictureError("");
    if (!PICTURE_MIME_TYPES.includes(file.type)) {
      setPictureError("Only JPEG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      setPictureError("Image must be 2 MB or smaller.");
      return;
    }
    const confirmed = await pictureConfirm.confirm();
    if (!confirmed) return;
    const previousUrl = student.profilePictureUrl;
    setPictureUploading(true);
    try {
      const url = await uploadStudentPicture(student.id, file);
      await updateMyProfilePictureRpc(url);
      setStudents(students.map((s) => (s.id === student.id ? { ...s, profilePictureUrl: url } : s)));
      setPictureSaved(true);
      setTimeout(() => setPictureSaved(false), 2000);
      // The upload minted a NEW object; drop the old one only after
      // the column points at the new URL (the edge function refuses to
      // delete a still-referenced object).
      await cleanupPictureObject(previousUrl);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : "Picture upload failed.");
    } finally {
      setPictureUploading(false);
    }
  };

  const handlePictureRemove = async () => {
    if (!student?.id) return;
    const confirmed = await removePictureConfirm.confirm();
    if (!confirmed) return;
    setPictureError("");
    const previousUrl = student.profilePictureUrl;
    setPictureUploading(true);
    try {
      await updateMyProfilePictureRpc(null);
      setStudents(students.map((s) => (s.id === student.id ? { ...s, profilePictureUrl: undefined } : s)));
      // Column cleared first — the object is unreferenced now, so the
      // edge function will allow the storage delete.
      await cleanupPictureObject(previousUrl);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : "Could not remove the picture.");
    } finally {
      setPictureUploading(false);
    }
  };

  if (!student) return <div className="p-8 text-gray-500">Student information not found.</div>;

  const InfoRow = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FFF0F0" }}>
        <span style={{ color: "#5C0102" }}>{icon}</span>
      </div>
      <div>
        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
        <div className="text-sm font-medium text-gray-900">{value || "—"}</div>
      </div>
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-gray-900 mb-1">My Profile</h1>
        <p className="text-gray-500 text-sm">View and manage your student information</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-1">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
          >
            <div className="p-8 text-center" style={{ background: "linear-gradient(135deg, #5C0102, #8B0103)" }}>
              <div className="relative w-20 h-20 mx-auto mb-3">
                {student.profilePictureUrl ? (
                  <img
                    src={student.profilePictureUrl}
                    alt={`${student.firstName} ${student.lastName}`}
                    className="w-20 h-20 rounded-full object-cover border-4 border-white/30"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-white/20 border-4 border-white/30 flex items-center justify-center">
                    <span className="text-3xl font-bold text-white">
                      {student.firstName.charAt(0)}{student.lastName.charAt(0)}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => pictureInputRef.current?.click()}
                  disabled={pictureUploading}
                  title={student.profilePictureUrl ? "Change profile picture" : "Upload profile picture"}
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-[#5C0102] hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  <Camera size={14} />
                </button>
                <input
                  ref={pictureInputRef}
                  type="file"
                  accept={PICTURE_MIME_TYPES.join(",")}
                  className="hidden"
                  onChange={handlePictureSelect}
                />
              </div>
              <h3 className="text-white">{student.firstName} {student.lastName}</h3>
              <p className="text-white/70 text-xs mt-1">{student.gradeLevel}</p>
              <span className={`inline-block mt-2 text-xs px-3 py-1 rounded-full font-medium ${
                student.status === "approved" ? "bg-green-400/20 text-green-200" :
                student.status === "pending" ? "bg-amber-400/20 text-amber-200" : "bg-red-400/20 text-red-200"
              }`}>
                {student.status.charAt(0).toUpperCase() + student.status.slice(1)}
              </span>
              {pictureError && (
                <p className="mt-3 text-xs text-red-200 flex items-center justify-center gap-1">
                  <AlertCircle size={12} /> {pictureError}
                </p>
              )}
              {pictureSaved && (
                <p className="mt-3 text-xs text-green-200 flex items-center justify-center gap-1">
                  <CheckCircle size={12} /> Picture updated
                </p>
              )}
              {student.profilePictureUrl && (
                <button
                  type="button"
                  onClick={handlePictureRemove}
                  disabled={pictureUploading}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors disabled:opacity-60"
                >
                  <Trash2 size={12} /> Remove picture
                </button>
              )}
            </div>
            <div className="p-4 space-y-1">
              <InfoRow icon={<User size={14} />} label="Full Name" value={`${student.firstName} ${student.middleName ? student.middleName + " " : ""}${student.lastName}`} />
              <InfoRow icon={<Mail size={14} />} label="Email" value={student.email || ""} />
              <InfoRow icon={<GraduationCap size={14} />} label="Grade Level" value={student.gradeLevel} />
              <InfoRow icon={<User size={14} />} label="Gender" value={student.gender} />
              <InfoRow icon={<Calendar size={14} />} label="Birthdate" value={student.birthdate} />
              <InfoRow icon={<Hash size={14} />} label="LRN" value={student.lrn} />
              <InfoRow icon={<BookOpen size={14} />} label="Registered On" value={student.registeredAt} />
            </div>
          </motion.div>
        </div>

        {/* Details */}
        <div className="lg:col-span-2 space-y-5">
          {/* Account Status */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
          >
            <h3 className="text-gray-900 mb-4 text-sm">Account Status</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: "Registration", value: student.status, color: student.status === "approved" ? "green" : student.status === "pending" ? "amber" : "red" },
                { label: "Voting Eligibility", value: student.status === "approved" ? "Eligible" : "Not Eligible", color: student.status === "approved" ? "green" : "red" },
                { label: "Candidacy", value: myApplication ? myApplication.status : "Not Applied", color: myApplication?.status === "approved" ? "green" : myApplication?.status === "pending" ? "amber" : myApplication?.status === "ongoingSubmission" ? "blue" : "gray" },
              ].map((item) => (
                <div key={item.label} className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs text-gray-400 mb-2">{item.label}</div>
                  <div className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${
                    item.color === "green" ? "bg-green-100 text-green-700" :
                    item.color === "amber" ? "bg-amber-100 text-amber-700" :
                    item.color === "blue" ? "bg-blue-100 text-blue-700" :
                    item.color === "red" ? "bg-red-100 text-red-700" : "bg-gray-200 text-gray-600"
                  }`}>
                    {formatStatus(item.value)}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Candidacy Info */}
          {myApplication && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
            >
              <h3 className="text-gray-900 mb-4 text-sm">Candidacy Application</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Position</div>
                  <div className="font-medium text-gray-900">{myApplication.position}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Party</div>
                  <div className="font-medium text-gray-900">{myApplication.status === "approved" ? (myApplication.partyAffiliation || "Independent") : "Pending approval"}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Status</div>
                  <div className={`font-medium ${
                    myApplication.status === "approved" ? "text-green-600" :
                    myApplication.status === "pending" ? "text-amber-600" :
                    myApplication.status === "ongoingSubmission" ? "text-blue-600" : "text-red-600"
                  }`}>
                    {formatStatus(myApplication.status)}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Submitted</div>
                  <div className="font-medium text-gray-900">{myApplication.submittedAt}</div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Password Change */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
          >
            <h3 className="text-gray-900 mb-4 text-sm">Change Password</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1.5">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 pr-10"
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
                <label className="block text-sm text-gray-600 mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 pr-10"
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
                <label className="block text-sm text-gray-600 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 pr-10"
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
              {passwordError && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={12} /> {passwordError}
                </p>
              )}
              <button
                onClick={handlePasswordChange}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-lg text-sm transition-all hover:opacity-90"
                style={{ backgroundColor: "#5C0102" }}
              >
                {saved ? <><CheckCircle size={16} /> Saved!</> : "Update Password"}
              </button>
            </div>
          </motion.div>

          {/* My Activity Logs */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
          >
            <h3 className="text-gray-900 mb-4 text-sm flex items-center gap-2">
              <Activity size={16} style={{ color: "#5C0102" }} />
              My Activity Logs
            </h3>
            {myLogs.length === 0 ? (
              <p className="text-gray-400 text-sm">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {myLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 text-sm border-b border-gray-50 pb-3 last:border-0"
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                        log.type === "success"
                          ? "bg-green-500"
                          : log.type === "error"
                          ? "bg-red-500"
                          : log.type === "warning"
                          ? "bg-amber-500"
                          : "bg-blue-500"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-800 font-medium">{log.action}</div>
                      <div className="text-gray-500 text-xs mt-0.5">{log.details}</div>
                      <div className="text-gray-400 text-xs mt-0.5 flex items-center gap-1">
                        <Clock size={10} />
                        {log.timestamp}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
      {passwordConfirm.dialog}
      {pictureConfirm.dialog}
      {removePictureConfirm.dialog}
    </div>
  );
}