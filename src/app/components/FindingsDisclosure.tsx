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
  /** 127 — the sanctions imposed, as human labels (e.g. "Verbal Warning"). */
  sanctions?: string[];
  /** 127 — names of the candidates a Disqualification sanction removes. */
  disqualifiedNames?: string[];
}

/**
 * One grievance row in the proclamation flow.  The Nature of Complaint is a
 * toggle: clicking it reveals the Grievance Commissioner's findings as plain
 * text at the bottom of the row — never evidence files or pictures (those
 * live on the Complaints page) — and clicking again hides them.  Read-only.
 */
export function FindingsDisclosure({ id, subject, decisionLabel, findings, sanctions, disqualifiedNames }: FindingsDisclosureProps) {
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
          {((sanctions && sanctions.length > 0) || (disqualifiedNames && disqualifiedNames.length > 0)) && (
            <div className="mt-2 pt-2 border-t border-red-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Sanction(s) imposed</div>
              {sanctions && sanctions.length > 0 && (
                <p className="mt-0.5 text-xs text-gray-700">{sanctions.join(", ")}</p>
              )}
              {disqualifiedNames && disqualifiedNames.length > 0 && (
                <p className="mt-0.5 text-xs text-gray-700">
                  Candidate(s) to be disqualified: {disqualifiedNames.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
