import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  FileText, Upload, Trash2, ExternalLink, Mail, MapPin, Clock, Save,
  AlertCircle, CheckCircle, ShieldAlert, Globe,
} from "lucide-react";
import { useApp, formatOfficeTime } from "../../context/AppContext";
import { uploadGuidelinesFile, saveHomepageSettingsRpc } from "../../lib/supabaseData";
import { useConfirm } from "../../lib/useConfirm";

// Mirrors the homepage-files bucket limits (115): 10 MB, pdf/doc/docx.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_EXTENSIONS = ["pdf", "doc", "docx"];
const FILE_ACCEPT = FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export default function AdminHomepageSettings() {
  const { currentUser, homepageSettings, setHomepageSettings, addLog } = useApp();
  const uploadConfirm = useConfirm({
    title: "Upload Election Guidelines?",
    description: "The file becomes downloadable from the Resources dropdown on the homepage.",
    confirmText: "Upload",
  });
  const removeConfirm = useConfirm({
    title: "Remove Election Guidelines?",
    description: "The Resources dropdown will no longer link to a guidelines file.",
    confirmText: "Remove",
    destructive: true,
  });
  const saveConfirm = useConfirm({
    title: "Save Contact Us?",
    description: "The homepage footer's Contact Us section updates for every visitor.",
    confirmText: "Save",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guidelinesUploading, setGuidelinesUploading] = useState(false);
  const [guidelinesError, setGuidelinesError] = useState("");
  const [guidelinesSaved, setGuidelinesSaved] = useState(false);

  const [email, setEmail] = useState(homepageSettings.contactEmail);
  const [location, setLocation] = useState(homepageSettings.location);
  const [hoursStart, setHoursStart] = useState(homepageSettings.officeHoursStart);
  const [hoursEnd, setHoursEnd] = useState(homepageSettings.officeHoursEnd);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactError, setContactError] = useState("");
  const [contactSaved, setContactSaved] = useState(false);

  // The settings row arrives with the post-login state fetch, which can land
  // after this page mounts — follow the context until the Chief edits a field.
  useEffect(() => {
    if (dirty) return;
    setEmail(homepageSettings.contactEmail);
    setLocation(homepageSettings.location);
    setHoursStart(homepageSettings.officeHoursStart);
    setHoursEnd(homepageSettings.officeHoursEnd);
  }, [dirty, homepageSettings]);

  if (!currentUser) return null;

  // The sidebar only shows this tab to the Chief, but the route itself must
  // not trust that — every other staff role gets a plain refusal here.
  if (currentUser.commissionerRole !== "chief") {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <ShieldAlert size={32} className="mx-auto mb-3 text-gray-400" />
          <h1 className="text-gray-900 mb-1">Homepage Setting</h1>
          <p className="text-gray-500 text-sm">Only the Chief Commissioner can manage the homepage settings.</p>
        </div>
      </div>
    );
  }

  const logAction = (action: string, details: string) => {
    addLog({
      user: currentUser.name,
      role: "Admin",
      action,
      details,
      type: "success",
    });
  };

  // Upload -> RPC (the RPC re-validates the URL bucket server-side) ->
  // context refresh so the Resources dropdown picks the file up at once.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a cancel
    if (!file) return;
    setGuidelinesError("");

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!FILE_EXTENSIONS.includes(ext)) {
      setGuidelinesError("Only PDF, DOC, or DOCX files are allowed.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setGuidelinesError("File must be 10 MB or smaller.");
      return;
    }

    const confirmed = await uploadConfirm.confirm();
    if (!confirmed) return;

    setGuidelinesUploading(true);
    try {
      const url = await uploadGuidelinesFile(file);
      const saved = await saveHomepageSettingsRpc({
        guidelinesUrl: url,
        guidelinesName: file.name,
        contactEmail: homepageSettings.contactEmail,
        location: homepageSettings.location,
        officeHoursStart: homepageSettings.officeHoursStart,
        officeHoursEnd: homepageSettings.officeHoursEnd,
      });
      setHomepageSettings(saved);
      setGuidelinesSaved(true);
      setTimeout(() => setGuidelinesSaved(false), 2500);
      logAction("Election Guidelines Updated", `Uploaded "${file.name}" as the Election Guidelines file.`);
    } catch (err) {
      setGuidelinesError(err instanceof Error ? err.message : "Guidelines upload failed.");
    } finally {
      setGuidelinesUploading(false);
    }
  };

  const handleFileRemove = async () => {
    const confirmed = await removeConfirm.confirm();
    if (!confirmed) return;
    setGuidelinesError("");
    setGuidelinesUploading(true);
    try {
      const saved = await saveHomepageSettingsRpc({
        guidelinesUrl: null,
        guidelinesName: null,
        contactEmail: homepageSettings.contactEmail,
        location: homepageSettings.location,
        officeHoursStart: homepageSettings.officeHoursStart,
        officeHoursEnd: homepageSettings.officeHoursEnd,
      });
      setHomepageSettings(saved);
      logAction("Election Guidelines Removed", "Removed the Election Guidelines file from the homepage.");
    } catch (err) {
      setGuidelinesError(err instanceof Error ? err.message : "Could not remove the file.");
    } finally {
      setGuidelinesUploading(false);
    }
  };

  const handleSaveContact = async () => {
    setContactError("");
    const trimmedEmail = email.trim();
    const trimmedLocation = location.trim();
    if (!trimmedEmail) { setContactError("The contact email is required."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) { setContactError("Enter a valid email address."); return; }
    if (!trimmedLocation) { setContactError("The location is required."); return; }
    if (!hoursStart !== !hoursEnd) { setContactError("Set both the opening and closing time, or leave both empty."); return; }
    if (hoursStart && hoursEnd && hoursEnd <= hoursStart) {
      setContactError("The office closing time must be after the opening time.");
      return;
    }

    const confirmed = await saveConfirm.confirm();
    if (!confirmed) return;

    setSaving(true);
    try {
      const saved = await saveHomepageSettingsRpc({
        guidelinesUrl: homepageSettings.guidelinesUrl ?? null,
        guidelinesName: homepageSettings.guidelinesName ?? null,
        contactEmail: trimmedEmail,
        location: trimmedLocation,
        officeHoursStart: hoursStart,
        officeHoursEnd: hoursEnd,
      });
      setHomepageSettings(saved);
      setDirty(false);
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 2500);
      logAction(
        "Homepage Settings Updated",
        `Contact Us saved: ${trimmedEmail} · office hours ${formatOfficeTime(hoursStart)}–${formatOfficeTime(hoursEnd)}.`,
      );
    } catch (err) {
      setContactError(err instanceof Error ? err.message : "Could not save the contact details.");
    } finally {
      setSaving(false);
    }
  };

  const mapsEmbedSrc = `https://www.google.com/maps?q=${encodeURIComponent(location.trim() || homepageSettings.location)}&output=embed`;

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Homepage Setting</h1>
        <p className="text-gray-500 text-sm">
          Manage the Election Guidelines file and the Contact Us details shown on the public homepage.
        </p>
      </motion.div>

      {/* Election Guidelines */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="p-5 text-white flex items-center gap-3" style={{ backgroundColor: "#5C0102" }}>
          <FileText size={20} />
          <div>
            <h2 className="text-white text-base">Election Guidelines</h2>
            <p className="text-white/70 text-xs">Downloadable from the Resources dropdown on the homepage.</p>
          </div>
        </div>
        <div className="p-6">
          {homepageSettings.guidelinesUrl ? (
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0" style={{ color: "#5C0102" }}>
                <FileText size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900 truncate">{homepageSettings.guidelinesName || "Election Guidelines"}</div>
                <a
                  href={homepageSettings.guidelinesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs inline-flex items-center gap-1 hover:underline"
                  style={{ color: "#5C0102" }}
                >
                  Open current file <ExternalLink size={10} />
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-4">No guidelines file uploaded yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={guidelinesUploading}
              className="px-4 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: "#5C0102" }}
            >
              {guidelinesUploading ? <><Clock size={14} className="animate-spin" /> Working…</> : <><Upload size={14} /> {homepageSettings.guidelinesUrl ? "Replace File" : "Upload File"}</>}
            </button>
            {homepageSettings.guidelinesUrl && (
              <button
                type="button"
                onClick={handleFileRemove}
                disabled={guidelinesUploading}
                className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 border border-gray-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
              >
                <Trash2 size={14} /> Remove
              </button>
            )}
            <span className="text-xs text-gray-400">PDF, DOC, or DOCX · up to 10 MB</span>
          </div>
          {guidelinesError && (
            <p className="mt-3 text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={12} /> {guidelinesError}
            </p>
          )}
          {guidelinesSaved && (
            <p className="mt-3 text-xs text-green-600 flex items-center gap-1">
              <CheckCircle size={12} /> Guidelines file updated
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {/* Contact Us */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 text-white flex items-center gap-3" style={{ backgroundColor: "#5C0102" }}>
          <MapPin size={20} />
          <div>
            <h2 className="text-white text-base">Contact Us</h2>
            <p className="text-white/70 text-xs">Shown in the footer of every public page.</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="contact-email" className="block text-xs text-gray-600 mb-1">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setDirty(true); }}
                placeholder="voting@cnnhs.edu.ph"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="contact-location" className="block text-xs text-gray-600 mb-1">Location</label>
            <textarea
              id="contact-location"
              rows={2}
              value={location}
              onChange={(e) => { setLocation(e.target.value); setDirty(true); }}
              placeholder="Camarines Norte National High School, Daet, Camarines Norte, Philippines"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <Globe size={11} /> Rendered with a Google Maps preview in the footer.
            </p>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Office Hours</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  id="office-hours-start"
                  type="time"
                  aria-label="Office hours opening time"
                  value={hoursStart}
                  onChange={(e) => { setHoursStart(e.target.value); setDirty(true); }}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
                />
              </div>
              <span className="text-gray-400 text-sm">to</span>
              <input
                id="office-hours-end"
                type="time"
                aria-label="Office hours closing time"
                value={hoursEnd}
                onChange={(e) => { setHoursEnd(e.target.value); setDirty(true); }}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
              />
            </div>
          </div>

          {/* Google Maps preview of the address as it is typed */}
          <div>
            <p className="text-xs text-gray-600 mb-1">Google Maps preview</p>
            <div className="rounded-lg overflow-hidden border border-gray-200">
              <iframe
                title="Google Maps preview of the saved location"
                src={mapsEmbedSrc}
                className="w-full h-44 block"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>

          {contactError && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={12} /> {contactError}
            </p>
          )}
          <button
            onClick={handleSaveContact}
            disabled={saving}
            className="px-4 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: "#5C0102" }}
          >
            {contactSaved ? <><CheckCircle size={14} /> Saved</> : <><Save size={14} /> Save Contact Us</>}
          </button>
        </div>
      </div>
      {uploadConfirm.dialog}
      {removeConfirm.dialog}
      {saveConfirm.dialog}
    </div>
  );
}
