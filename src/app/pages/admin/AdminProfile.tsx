import { useRef, useState } from "react";
import { motion } from "motion/react";
import { Shield, User, Mail, Lock, Save, Eye, EyeOff, AlertCircle, CheckCircle, Camera, Trash2 } from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  updateAdminPassword,
  uploadAdminPicture,
  updateMyAdminPictureRpc,
  deleteAdminPictureRpc,
} from "../../lib/supabaseData";
import { useConfirm } from "../../lib/useConfirm";

const commissionerLabels: Record<string, string> = {
  chief: "Chief Commissioner",
  screening_validation: "Commissioner of Screening & Validation",
  electoral_board: "Commissioner of Electoral Board",
  appointment: "Commissioner of Appointment",
  grievance: "Commissioner of Grievance",
};

// Mirrors the admin-pictures bucket limits (073): 2 MB, jpeg/png/webp.
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const PICTURE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// The page is shared by every staff role on the /admin tree (all four
// commissioners + the SSLG Adviser), so role labels fall back by role.
const roleLabels: Record<string, string> = {
  admin: "Administrator",
  sslg_adviser: "SSLG Adviser",
};

const roleLabel = (role: string | null | undefined): string =>
  (role ? roleLabels[role] : undefined) ?? "Administrator";

export default function AdminProfile() {
  const { currentUser, addLog, setCurrentUser } = useApp();
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
    description: "Your profile will show your initial instead.",
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

  if (!currentUser) return null;

  const handlePasswordChange = async () => {
    const confirmed = await passwordConfirm.confirm();
    if (!confirmed) return;
    setPasswordError("");
    if (!newPassword) { setPasswordError("New password is required."); return; }
    if (newPassword.length < 6) { setPasswordError("New password must be at least 6 characters."); return; }
    if (newPassword !== confirmNewPassword) { setPasswordError("New passwords do not match."); return; }
    try {
      await updateAdminPassword(currentPassword, newPassword);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      addLog({
        user: currentUser.name,
        role: currentUser.commissionerRole ? "Admin" : roleLabel(currentUser.role),
        action: "Password Changed",
        details: "Admin password updated successfully.",
        type: "success",
      });
      // ACCT-05 client half: the server killed the active session on the
      // password change; reset the user state so the layout routes to login
      // (persistCurrentUser also clears the dead session token).
      setCurrentUser(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Password update failed.");
    }
  };

  // 073: best-effort storage cleanup via the delete_profile_picture edge
  // function — the profile_picture_url column is the source of truth, so
  // a storage hiccup must never surface an error or undo a removal/
  // replace that the RPC already persisted (worst case: one orphaned file
  // until a manual bucket sweep).
  const cleanupPictureObject = async (url: string | undefined) => {
    if (!url) return;
    try {
      await deleteAdminPictureRpc(url);
    } catch {
      /* best-effort — see comment above */
    }
  };

  // 073: upload -> RPC (the RPC re-validates the URL bucket server-side) ->
  // currentUser refresh so the header/sidebar/navbar pick the photo up too
  // (setCurrentUser = persistCurrentUser, so the blob survives reloads).
  const handlePictureSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a cancel
    if (!file || !currentUser?.id) return;
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
    const previousUrl = currentUser.profilePictureUrl;
    setPictureUploading(true);
    try {
      const url = await uploadAdminPicture(currentUser.id, file);
      await updateMyAdminPictureRpc(url);
      setCurrentUser({ ...currentUser, profilePictureUrl: url });
      setPictureSaved(true);
      setTimeout(() => setPictureSaved(false), 2000);
      // 073: the upload minted a NEW object; drop the old one only after
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
    const confirmed = await removePictureConfirm.confirm();
    if (!confirmed) return;
    setPictureError("");
    const previousUrl = currentUser.profilePictureUrl;
    setPictureUploading(true);
    try {
      await updateMyAdminPictureRpc(null);
      setCurrentUser({ ...currentUser, profilePictureUrl: undefined });
      // 073: column cleared first — the object is unreferenced now, so the
      // edge function will allow the storage delete.
      await cleanupPictureObject(previousUrl);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : "Could not remove the picture.");
    } finally {
      setPictureUploading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">My Profile</h1>
        <p className="text-gray-500 text-sm">View your account information and change your password.</p>
      </motion.div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="p-6 text-white" style={{ backgroundColor: "#5C0102" }}>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 flex-shrink-0">
              {currentUser.profilePictureUrl ? (
                <img
                  src={currentUser.profilePictureUrl}
                  alt={currentUser.name}
                  className="w-16 h-16 rounded-full object-cover border-2 border-white/30"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold">
                  {currentUser.name.charAt(0)}
                </div>
              )}
              <button
                type="button"
                onClick={() => pictureInputRef.current?.click()}
                disabled={pictureUploading}
                title={currentUser.profilePictureUrl ? "Change profile picture" : "Upload profile picture"}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-[#5C0102] hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <Camera size={12} />
              </button>
              <input
                ref={pictureInputRef}
                type="file"
                accept={PICTURE_MIME_TYPES.join(",")}
                className="hidden"
                onChange={handlePictureSelect}
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-white text-lg">{currentUser.name}</h2>
              <p className="text-white/70 text-sm">{currentUser.commissionerRole ? commissionerLabels[currentUser.commissionerRole] : roleLabel(currentUser.role)}</p>
              {currentUser.profilePictureUrl && (
                <button
                  type="button"
                  onClick={handlePictureRemove}
                  disabled={pictureUploading}
                  className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors disabled:opacity-60"
                >
                  <Trash2 size={11} /> Remove picture
                </button>
              )}
            </div>
          </div>
          {pictureError && (
            <p className="mt-3 text-xs text-red-200 flex items-center gap-1">
              <AlertCircle size={12} /> {pictureError}
            </p>
          )}
          {pictureSaved && (
            <p className="mt-3 text-xs text-green-200 flex items-center gap-1">
              <CheckCircle size={12} /> Picture updated
            </p>
          )}
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Mail size={16} className="text-gray-400" />
            <div><div className="text-sm text-gray-900">{currentUser.email}</div><div className="text-xs text-gray-500">Email</div></div>
          </div>
          <div className="flex items-center gap-3">
            <Shield size={16} className="text-gray-400" />
            <div><div className="text-sm text-gray-900 capitalize">{currentUser.commissionerRole ? currentUser.commissionerRole.replace(/_/g, " ") : roleLabel(currentUser.role)}</div><div className="text-xs text-gray-500">Role</div></div>
          </div>
          <div className="flex items-center gap-3">
            <User size={16} className="text-gray-400" />
            <div><div className="text-sm text-gray-900 capitalize">{currentUser.role?.replace(/_/g, " ")}</div><div className="text-xs text-gray-500">Account Type</div></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-gray-900 text-sm flex items-center gap-2 mb-5">
          <Lock size={16} style={{ color: "#5C0102" }} /> Change Password
        </h3>
        <div className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Current Password</label>
            <div className="relative">
              <input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 pr-10" />
              <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">New Password</label>
            <div className="relative">
              <input type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 pr-10" />
              <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showNew ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Confirm New Password</label>
            <div className="relative">
              <input type={showConfirm ? "text" : "password"} value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 pr-10" />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          {passwordError && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={12} /> {passwordError}
            </p>
          )}
          <button
            onClick={handlePasswordChange}
            className="px-4 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90"
            style={{ backgroundColor: "#5C0102" }}
          >
            {saved ? <><CheckCircle size={14} /> Saved</> : <><Save size={14} /> Update Password</>}
          </button>
        </div>
      </div>
      {passwordConfirm.dialog}
      {pictureConfirm.dialog}
      {removePictureConfirm.dialog}
    </div>
  );
}
