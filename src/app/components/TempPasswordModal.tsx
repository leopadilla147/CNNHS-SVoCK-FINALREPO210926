import { useState } from "react";
import { KeyRound, Eye, EyeOff, Copy, CheckCircle, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";

export interface TempPasswordModalProps {
  name: string;
  email: string;
  password: string;
  /** Called when the modal is permanently closed by the acknowledgement button. */
  onClose: () => void;
}

/**
 * D-03 one-time credential display (consumed by ChiefAppointments).
 *
 * 104: the credential shown is the account's ROLE DEFAULT password
 * (electoral123 / grievance123 / screening123 / sslg123 — chief123 seed
 * precedent; 118: a Co-commissioner instead gets the co-prefixed
 * default — coelectoral123 / cogrievance123 / coscreening123).  It is
 * shown EXACTLY once per creation:
 *   * masked by default with a reveal toggle (never visible on first paint);
 *   * a copy button moves it to the clipboard;
 *   * only the acknowledgement button closes the modal — the password
 *     state lives purely in this component's memory, so closing (or
 *     navigating away) loses it forever.  It is never persisted to
 *     localStorage, never written to the audit trail, never logged.
 * There is deliberately no forced first-login change (104 capstone
 * decision): the default stays valid until the officer changes it.
 */
export function TempPasswordModal({ name, email, password, onClose }: TempPasswordModalProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/iframe) — the reveal toggle is
      // the fallback; the password stays visible until the modal closes.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => { /* close only via acknowledgement */ }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200"
      >
        <div className="p-6 text-white text-center rounded-t-2xl" style={{ backgroundColor: "#5C0102" }}>
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mx-auto mb-3">
            <KeyRound size={22} />
          </div>
          <h3 className="text-white mb-1">Default Password</h3>
          <p className="text-white/70 text-xs">Shown once — copy it now</p>
        </div>

        <div className="p-6">
          <div className="text-xs text-gray-500 mb-4">
            <div><strong className="text-gray-700">{name}</strong></div>
            <div>{email}</div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4 flex items-start gap-2 text-xs text-amber-700">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            This is the account's default password — it stays valid until the officer changes it. Share it securely
            and advise changing it after the first login.
          </div>

          <div className="flex items-stretch gap-2 mb-5">
            <div className="flex-1 relative">
              <input
                readOnly
                type={revealed ? "text" : "password"}
                value={password}
                onFocus={(e) => e.target.select()}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setRevealed(!revealed)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={revealed ? "Hide password" : "Reveal password"}
              >
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
            >
              {copied ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: "#5C0102" }}
          >
            I've saved the password
          </button>
        </div>
      </motion.div>
    </div>
  );
}