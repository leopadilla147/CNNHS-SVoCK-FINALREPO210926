import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FindingsDisclosureProps {
  /** Unique id wiring the toggle to its findings panel. */
  id: string;
  /** The Nature of Complaint, e.g. "Impersonation" — clicking it toggles the findings. */
  subject: string;
  /** Optional classification shown after the subject, e.g. "Substantiated Grievance". */
  decisionLabel?: string;
  /** The Grievance Commissioner's recorded findings note. */
  findings?: string | null;
}

/**
 * One grievance row in the proclamation flow.  The Nature of Complaint is a
 * toggle: clicking it reveals the Grievance Commissioner's findings as plain
 * text at the bottom of the row — never evidence files or pictures (those
 * live on the Complaints page) — and clicking again hides them.  Read-only.
 */
export function FindingsDisclosure({ id, subject, decisionLabel, findings }: FindingsDisclosureProps) {
  const [open, setOpen] = useState(false);
  const text = (findings ?? "").trim();
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? `${id}-findings` : undefined}
        title={open ? "Hide the findings." : "Show the findings."}
        className="text-xs flex items-center gap-1 flex-wrap text-left hover:underline"
      >
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="font-semibold">{subject}</span>
        {decisionLabel && <span className="opacity-70">· {decisionLabel}</span>}
      </button>
      {open && (
        <div id={`${id}-findings`} className="mt-1 rounded-lg bg-white border border-red-100 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Findings</div>
          <p className="mt-0.5 text-xs text-gray-700 whitespace-pre-wrap">
            {text || "No findings recorded."}
          </p>
        </div>
      )}
    </li>
  );
}
