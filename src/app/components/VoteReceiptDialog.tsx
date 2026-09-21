import { useState } from "react";
import { motion } from "motion/react";
import { ReceiptText, Copy, CheckCircle, ShieldCheck } from "lucide-react";
import type { VoteReceipt } from "../lib/voteApi";

export interface VoteReceiptDialogProps {
  receipts: VoteReceipt[];
  /** Called when the dialog is closed by the acknowledgement button. */
  onClose: () => void;
}

/**
 * D-06 one-time receipt display (05-03 T3, W-1).
 *
 * Shown exactly once after a successful web cast: the server-generated
 * Crockford base32 receipt codes per position (display-only plaintext —
 * the committed value is code_hash, never co-located with voter identity).
 * Copy buttons move a code to the clipboard; only the acknowledgement
 * button closes the dialog.  The receipts array lives in the caller's
 * component state and is dropped once the dialog closes (re-fetch via
 * verify_receipt needs the code itself — the voter keeps their copy).
 */
export function VoteReceiptDialog({ receipts, onClose }: VoteReceiptDialogProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Clipboard unavailable (permissions/iframe) — codes are visible.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => { /* receipt shown once — close only via acknowledgement */ }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200"
      >
        <div className="p-6 text-white text-center rounded-t-2xl" style={{ backgroundColor: "#5C0102" }}>
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mx-auto mb-3">
            <ReceiptText size={22} />
          </div>
          <h3 className="text-white mb-1">Ballot Received</h3>
          <p className="text-white/70 text-sm">Your vote has been recorded</p>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-5">
            <ShieldCheck size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              Keep these codes — they are your ballot's proof of count.
              Receipt codes do not reveal your choices.
            </span>
          </div>

          <div className="space-y-3 mb-6">
            {receipts.map((receipt) => (
              <div
                key={receipt.voteId}
                className="border border-gray-100 rounded-xl p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{receipt.position}</div>
                  <div className="text-gray-500 text-sm">Receipt Code</div>
                  <div className="font-mono text-base tracking-widest" style={{ color: "#5C0102" }}>
                    {receipt.receiptCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(receipt.receiptCode)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 flex-shrink-0"
                  aria-label={`Copy receipt code for ${receipt.position}`}
                >
                  {copiedCode === receipt.receiptCode ? (
                    <CheckCircle size={14} className="text-green-500" />
                  ) : (
                    <Copy size={14} />
                  )}
                  {copiedCode === receipt.receiptCode ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: "#5C0102" }}
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}