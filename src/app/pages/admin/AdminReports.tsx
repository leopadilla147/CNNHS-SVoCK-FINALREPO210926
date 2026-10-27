import { motion } from "motion/react";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  Printer,
  ChevronDown,
  Download,
  FileCheck,
  ImagePlus,
  Eye,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Check,
  Trash2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  generateChiefElectionReport, openPrintWindow, wrapReportDocument,
} from "../../lib/reports";
import {
  saveAccomplishmentReportDocx,
  type AccomplishmentReportImage,
} from "../../lib/docxAccomplishmentReport";
import {
  defaultVenueLine,
  resolveCommissionerNames,
  resolveSignatoryRoleSelection,
  SIGNATORY_ROLE_OPTIONS,
  SIGNATORY_ROLE_OTHER,
  type AccomplishmentReportDraft,
  type ReportSignatory,
  type ReportSignatoryGroup,
} from "../../lib/accomplishmentReportContent";
import {
  getReportDraft,
  refreshReportDraftIfPristine,
  resetReportDraft,
  setReportDraft,
  useReportDraft,
} from "../../lib/reportDraft";
import { listStaffRosterRpc } from "../../lib/supabaseData";
import {
  addReportImages,
  clearReportImages,
  fileToReportImage,
  removeReportImage,
  setReportImageCaption,
  useReportImages,
} from "../../lib/reportImages";
import { useConfirm } from "../../lib/useConfirm";

/** Photo documentation: fixed render box for .docx embedding (in points). */
const DOCX_IMAGE_MAX_WIDTH = 420;
const DOCX_IMAGE_MAX_HEIGHT = 320;
const REPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Natural size of a data-URL image, scaled to fit the .docx render box. */
async function fitImage(dataUrl: string): Promise<{ width: number; height: number }> {
  const natural = await new Promise<{ width: number; height: number }>((resolve) => {
    const el = new Image();
    el.onload = () =>
      resolve({
        width: el.naturalWidth || DOCX_IMAGE_MAX_WIDTH,
        height: el.naturalHeight || DOCX_IMAGE_MAX_HEIGHT,
      });
    el.onerror = () => resolve({ width: DOCX_IMAGE_MAX_WIDTH, height: DOCX_IMAGE_MAX_HEIGHT });
    el.src = dataUrl;
  });
  const scale = Math.min(
    1,
    DOCX_IMAGE_MAX_WIDTH / natural.width,
    DOCX_IMAGE_MAX_HEIGHT / natural.height
  );
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

/**
 * Election Reports (Chief Commissioner).
 *
 * v1.4 scope per the Chief's request:
 *   * the on-page "CNNHS Student Election" summary and the Winners Summary
 *     table are REMOVED — the page now focuses on the official LG-COMEA
 *     Accomplishment Report (edit → preview → print → .docx);
 *   * every editor field keeps unsaved local state and is persisted only
 *     through its own Save button;
 *   * "Reset to default text" asks for confirmation first;
 *   * defaults come from the live election: the active period's school year
 *     ("None" until a period exists), the current date/time, and the school +
 *     Stage-4 venue on the SVoCK platform;
 *   * signatory "Position / role" is a dropdown of the LG-COMEA titles
 *     ("Others" reveals a free-text field);
 *   * the "Download Base Template (.docx)" link is removed.
 */
export default function AdminReports() {
  const { electionPeriod, currentUser } = useApp();

  // 068 renamed every officer account, so the acting chief's name replaces
  // the bundled template signatory.  Only the chief can resolve officer
  // names (list_staff_roster_rpc is chief-gated), so any other staff role
  // printing this page keeps the template line.
  const chiefName =
    currentUser?.commissionerRole === "chief" ? currentUser.name : undefined;

  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);

  // School year shown on the card badge and in the .docx filename.
  const startYear = new Date(electionPeriod.startDate).getFullYear();
  const schoolYear = Number.isNaN(startYear) ? "2026-2027" : `${startYear}-${startYear + 1}`;

  /**
   * Default "School year / period": the active election period's school year,
   * or "None" until an election period exists.
   */
  const defaultPeriodLabel = electionPeriod.schoolYear?.trim() || "None";

  /**
   * Default "Date / time": the moment the report page is opened (fixed for
   * the lifetime of the page so re-renders don't move the timestamp).
   */
  const [currentDateTime] = useState(() => {
    const now = new Date();
    const date = now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const time = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${date} ${time}`;
  });

  // Session-only photo documentation (see lib/reportImages.ts).
  const reportImages = useReportImages();
  const [imageError, setImageError] = useState<string | null>(null);

  // Chief-gated staff roster (046): resolves the acting commissioner's name
  // for each signatory role, so choosing a commissioner title prefills the
  // Name field (still editable).  The RPC refuses non-chiefs (046 raises,
  // which PostgREST surfaces as a 400), so non-chief admins skip the call
  // entirely and keep manual names — the same posture as chiefName above.
  // A chief-side failure is surfaced so a bad deploy is diagnosable.
  const [commissionerNames, setCommissionerNames] = useState<Record<string, string>>({});
  const [rosterError, setRosterError] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.commissionerRole !== "chief") return;
    let cancelled = false;
    listStaffRosterRpc()
      .then((rows) => {
        if (cancelled) return;
        setCommissionerNames(resolveCommissionerNames(rows));
        setRosterError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setRosterError(
            err instanceof Error ? err.message : "Could not load the staff roster."
          );
        }
      });
    return () => { cancelled = true; };
  }, [currentUser?.commissionerRole]);

  /**
   * Editable body of the report.  Seeded from the live election the first time
   * the page is opened, then kept in this browser's localStorage so the Chief's
   * edits survive a reload (see lib/reportDraft.ts — no database involved).
   */
  const reportDraftSeed = {
    periodLabel: defaultPeriodLabel,
    dateTime: currentDateTime,
    venue: defaultVenueLine(electionPeriod.venue),
    chiefName,
    officerNames: commissionerNames,
  };
  const reportDraft = useReportDraft(reportDraftSeed);

  /**
   * The roster (and the election period) resolve asynchronously, after the
   * draft has already been seeded.  While the Chief hasn't edited anything
   * yet, upgrade the template-fresh draft in place so the default signatory
   * names are the acting officers' names; any edit locks the draft in.
   */
  useEffect(() => {
    refreshReportDraftIfPristine(reportDraftSeed);
  });

  /** Apply a partial edit on top of the current draft. */
  const patchDraft = (patch: Partial<AccomplishmentReportDraft>) =>
    setReportDraft({ ...reportDraft, ...patch });

  /** Replace one of the draft's repeating text lists (paragraphs, bullets…). */
  const setDraftList = (
    key: "rationaleParagraphs" | "objectives" | "highlights" | "recommendations",
    next: string[]
  ) => {
    const patch: Partial<AccomplishmentReportDraft> = {};
    patch[key] = next;
    setReportDraft({ ...reportDraft, ...patch });
  };

  const handleAddImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    const accepted: File[] = [];
    let error: string | null = null;
    files.forEach((file) => {
      if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
        error = `${file.name} was skipped — only PNG or JPG images are supported.`;
      } else if (file.size > REPORT_IMAGE_MAX_BYTES) {
        error = `${file.name} was skipped — images must be 5 MB or smaller.`;
      } else {
        accepted.push(file);
      }
    });
    setImageError(error);
    if (accepted.length === 0) return;
    addReportImages(await Promise.all(accepted.map(fileToReportImage)));
  };

  const documentationForPrint = reportImages.map((image) => ({
    url: image.dataUrl,
    caption: image.caption.trim() || undefined,
  }));

  const buildDocumentationForDocx = (): Promise<AccomplishmentReportImage[]> =>
    Promise.all(
      reportImages.map(async (image) => {
        const { width, height } = await fitImage(image.dataUrl);
        return {
          data: new Uint8Array(await image.blob.arrayBuffer()),
          type: image.blob.type === "image/png" ? ("png" as const) : ("jpg" as const),
          width,
          height,
          caption: image.caption.trim() || undefined,
        };
      })
    );

  /**
   * Everything the printed report, the .docx export and the on-page preview
   * share — including the Chief's edited draft, so all three stay in lockstep.
   */
  const chiefReportInput = {
    chiefName,
    draft: reportDraft,
    periodLabel: defaultPeriodLabel,
    dateTime: currentDateTime,
    venue: defaultVenueLine(electionPeriod.venue),
  };

  // The document as it will print — rendered in the page for review.
  const reportPreviewDocument = wrapReportDocument(
    generateChiefElectionReport({
      ...chiefReportInput,
      documentationImages: documentationForPrint,
    }),
    `LG-COMEA Accomplishment Report ${schoolYear}`
  );

  const handleChiefReportPrint = () => {
    openPrintWindow(generateChiefElectionReport({
      ...chiefReportInput,
      documentationImages: documentationForPrint,
    }));
  };

  const handleDownloadDocx = async () => {
    try {
      setIsDownloadingDocx(true);
      await saveAccomplishmentReportDocx(
        {
          ...chiefReportInput,
          documentationImages: await buildDocumentationForDocx(),
        },
        `LG-COMEA_ACCOMPLISHMENT-REPORT-SSLG-${schoolYear}.docx`
      );
    } catch (err) {
      console.error("Failed to generate docx report:", err);
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  // "Reset to default text" is destructive (it discards every edit for this
  // school year), so it asks for confirmation first.
  const { confirm, dialog: confirmDialog } = useConfirm({
    title: "Reset to default text?",
    description:
      "This will discard all of your edits and restore the bundled LG-COMEA template text. This cannot be undone.",
    confirmText: "Reset to default",
    cancelText: "Cancel",
    destructive: true,
  });

  const handleResetDraft = async () => {
    if (await confirm()) resetReportDraft(reportDraftSeed);
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-gray-900 mb-1">Election Reports</h1>
            <p className="text-gray-500 text-sm">Official LG-COMEA Accomplishment Report for the CNNHS Student Election — edit, preview, print, and export as .docx.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleChiefReportPrint}
              className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm transition-all hover:opacity-90 cursor-pointer shadow-xs"
              style={{ backgroundColor: "#5C0102" }}
            >
              <Printer size={16} /> Print Report
            </button>
            <button
              onClick={handleDownloadDocx}
              disabled={isDownloadingDocx}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-800 rounded-xl text-sm font-medium transition-all hover:bg-gray-50 cursor-pointer shadow-xs disabled:opacity-60"
            >
              {isDownloadingDocx ? (
                <div className="w-4 h-4 border-2 border-gray-400 border-t-gray-800 rounded-full animate-spin" />
              ) : (
                <Download size={16} className="text-[#5C0102]" />
              )}
              Export .docx
            </button>
          </div>
        </div>
      </motion.div>

      {/* Chief Commissioner Election Report Card (LG-COMEA Accomplishment Report) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-[#5C0102]">
              <FileCheck size={22} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">
                Chief Commissioner Election Report (LG-COMEA Accomplishment Report)
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Official DepEd LG-COMEA Accomplishment Report based on <span className="font-mono text-gray-700 font-semibold">LG-COMEA_ACCOMPLISHMENT-REPORT.SSLG-AND-YES-O-26-27.docx</span>
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-[#5C0102] border border-red-200/60">
            S.Y. {schoolYear} SSLG Election
          </span>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed mb-5 bg-gray-50/70 p-3.5 rounded-xl border border-gray-100">
          This report compiles the official Rationale, 5 Objectives, Activity Highlights, the attached Photo Documentation, Financial Liquidation (NONE), 5 COMEA Recommendations, and complete Commission Signatories (Student Chairperson, Student Secretary, Electoral Commissioner, Screening Commissioner, Co-commissioner, Grievance Commissioner, Appointed Commissioner, and School Head / Chief Commissioner).
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleChiefReportPrint}
            className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-xs font-semibold transition-all hover:opacity-90 cursor-pointer shadow-xs"
            style={{ backgroundColor: "#5C0102" }}
          >
            <Printer size={15} />
            <span>Print Official Report</span>
          </button>

          <button
            onClick={handleDownloadDocx}
            disabled={isDownloadingDocx}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-60"
          >
            {isDownloadingDocx ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Download size={15} />
            )}
            <span>Download Filled Report (.docx)</span>
          </button>
        </div>
      </div>

      {/* Editable report body — persisted in this browser (localStorage) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-[#5C0102]">
              <PenLine size={20} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">Edit Report Content</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Everything you type here goes straight into the printed report and the .docx export. Each field keeps its own Save button; saved in this browser only.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleResetDraft()}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            <RotateCcw size={13} /> Reset to default text
          </button>
        </div>

        <div className="space-y-3">
          <EditorSection title="Activity details" defaultOpen>
            <div className="grid sm:grid-cols-3 gap-3">
              <EditorTextField
                label="School year / period"
                value={reportDraft.periodLabel}
                onCommit={(value) => patchDraft({ periodLabel: value })}
              />
              <EditorTextField
                label="Date / time"
                value={reportDraft.dateTime}
                onCommit={(value) => patchDraft({ dateTime: value })}
              />
              <EditorTextField
                label="Place / venue / platform"
                value={reportDraft.venue}
                onCommit={(value) => patchDraft({ venue: value })}
              />
            </div>
          </EditorSection>

          <EditorSection title="Rationale">
            <EditorTextField
              label="Lead line"
              value={reportDraft.rationaleLead}
              onCommit={(value) => patchDraft({ rationaleLead: value })}
            />
            <EditorListField
              legend="Rationale paragraphs"
              items={reportDraft.rationaleParagraphs}
              rows={4}
              addLabel="Add paragraph"
              onCommit={(next) => setDraftList("rationaleParagraphs", next)}
            />
          </EditorSection>

          <EditorSection title="Objectives">
            <EditorListField
              legend="Objectives"
              hint="Rendered as a. b. c. … in the document."
              items={reportDraft.objectives}
              rows={2}
              addLabel="Add objective"
              onCommit={(next) => setDraftList("objectives", next)}
            />
          </EditorSection>

          <EditorSection title="Highlights">
            <EditorListField
              legend="Highlights"
              items={reportDraft.highlights}
              rows={4}
              addLabel="Add paragraph"
              onCommit={(next) => setDraftList("highlights", next)}
            />
          </EditorSection>

          <EditorSection title="Financial liquidation">
            <EditorTextField
              label="Financial Accomplishment / Liquidation Report (if any)"
              value={reportDraft.financialLiquidation}
              onCommit={(value) => patchDraft({ financialLiquidation: value })}
            />
          </EditorSection>

          <EditorSection title="Recommendations">
            <EditorListField
              legend="Recommendation/s"
              items={reportDraft.recommendations}
              rows={2}
              addLabel="Add recommendation"
              onCommit={(next) => setDraftList("recommendations", next)}
            />
          </EditorSection>

          <EditorSection title="Signatories">
            {rosterError && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Commissioner names couldn't be preloaded — {rosterError} You can still type names manually.
              </p>
            )}
            <SignatoryGroupsEditor
              groups={reportDraft.signatoryGroups}
              commissionerNames={commissionerNames}
              onChange={(next) => patchDraft({ signatoryGroups: next })}
            />
          </EditorSection>
        </div>
      </div>

      {/* On-page document preview (same shell as the print window) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-[#5C0102]">
              <Eye size={20} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base">Document Preview</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Exactly what will print and what the .docx export contains — updates as you edit above.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleChiefReportPrint}
              className="flex items-center gap-2 px-3 py-2 text-white rounded-xl text-xs font-semibold transition-all hover:opacity-90 cursor-pointer shadow-xs"
              style={{ backgroundColor: "#5C0102" }}
            >
              <Printer size={14} /> Print
            </button>
            <button
              type="button"
              onClick={handleDownloadDocx}
              disabled={isDownloadingDocx}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-60"
            >
              {isDownloadingDocx ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Export .docx
            </button>
          </div>
        </div>

        <iframe
          title="LG-COMEA Accomplishment Report preview"
          srcDoc={reportPreviewDocument}
          className="w-full h-[860px] rounded-xl border border-gray-200 bg-white"
        />
      </div>

      {/* Photo Documentation — session-only attachments for the report */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-gray-900 text-sm flex items-center gap-2">
              <ImagePlus size={16} style={{ color: "#5C0102" }} /> Photo Documentation
            </h3>
            <p className="text-gray-400 text-xs mt-1 max-w-2xl">
              Attach photos of the election activity — they are inserted into the "Documentation" section of both the printed report and the downloaded .docx. Photos are kept for this browser session only.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label
              className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-xs font-semibold transition-all hover:opacity-90 cursor-pointer shadow-xs"
              style={{ backgroundColor: "#5C0102" }}
            >
              <ImagePlus size={15} />
              <span>Add photos</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                multiple
                className="hidden"
                onChange={handleAddImages}
              />
            </label>
            {reportImages.length > 0 && (
              <button
                type="button"
                onClick={() => { clearReportImages(); setImageError(null); }}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {imageError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{imageError}</p>
        )}

        {reportImages.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No photos attached yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {reportImages.map((image) => (
              <div key={image.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                <img src={image.dataUrl} alt={image.caption || image.name} className="w-full h-36 object-cover bg-gray-50" />
                <div className="p-2.5 space-y-2">
                  <input
                    type="text"
                    value={image.caption}
                    onChange={(e) => setReportImageCaption(image.id, e.target.value)}
                    placeholder="Optional caption"
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-gray-400 truncate">{image.name}</span>
                    <button
                      type="button"
                      onClick={() => removeReportImage(image.id)}
                      className="text-[11px] font-semibold text-[#B91C1C] hover:underline cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}

/** Collapsible group inside the "Edit Report Content" card. */
function EditorSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer"
      >
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* Children stay mounted while collapsed so unsaved edits survive. */}
      <div className={open ? "px-4 pb-4 space-y-3" : "hidden px-4 pb-4 space-y-3"}>
        {description && <p className="text-[11px] text-gray-400">{description}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Local unsaved state for one editor control.  Edits stay in component state
 * until the control's Save button commits them; the committed value re-syncs
 * the local state whenever it changes underneath the editor (after a Save, or
 * after "Reset to default text").
 */
function useDraftField<T>(committed: T, commit: (next: T) => void) {
  const [local, setLocal] = useState(committed);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    setLocal(committed);
  }, [committed]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    []
  );

  const dirty = local !== committed;

  const save = () => {
    commit(local);
    setJustSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setJustSaved(false), 1800);
  };

  return { local, setLocal, dirty, justSaved, save };
}

/** Per-field Save control: disabled until edited, flashes "Saved" after committing. */
function FieldSaveButton({
  dirty,
  justSaved,
  onClick,
}: {
  dirty: boolean;
  justSaved: boolean;
  onClick: () => void;
}) {
  if (justSaved) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 shrink-0">
        <Check size={11} /> Saved
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!dirty}
      title={dirty ? "Save this field" : "No changes to save"}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold shrink-0 transition-colors ${
        dirty
          ? "bg-[#5C0102] text-white hover:opacity-90 cursor-pointer"
          : "bg-gray-100 text-gray-400 cursor-not-allowed"
      }`}
    >
      <Save size={11} /> Save
    </button>
  );
}

/**
 * Labelled single-line input used throughout the report editor.  Edits stay
 * local until the field's Save button commits them into the report draft
 * (Enter also saves).
 */
function EditorTextField({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const { local, setLocal, dirty, justSaved, save } = useDraftField(value, onCommit);

  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <FieldSaveButton dirty={dirty} justSaved={justSaved} onClick={save} />
      </span>
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={(event) => setLocal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (dirty) save();
          }
        }}
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
      />
    </label>
  );
}

/** Add/remove editor for one of the document's repeating text lists. */
function EditorListField({
  legend,
  hint,
  items,
  rows = 3,
  addLabel,
  onCommit,
}: {
  legend: string;
  hint?: string;
  items: string[];
  rows?: number;
  addLabel: string;
  onCommit: (next: string[]) => void;
}) {
  const { local, setLocal, dirty, justSaved, save } = useDraftField(items, onCommit);

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{legend}</div>
          {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setLocal([...local, ""])}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#5C0102] hover:underline cursor-pointer"
          >
            <Plus size={12} /> {addLabel}
          </button>
          <FieldSaveButton dirty={dirty} justSaved={justSaved} onClick={save} />
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {local.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            <textarea
              value={item}
              rows={rows}
              onChange={(event) =>
                setLocal(local.map((value, i) => (i === index ? event.target.value : value)))
              }
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 bg-white leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-100"
            />
            <button
              type="button"
              title="Remove"
              onClick={() => setLocal(local.filter((_, i) => i !== index))}
              className="mt-1 p-2 rounded-lg text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {local.length === 0 && <p className="text-[11px] text-gray-400 italic">No entries.</p>}
      </div>
    </div>
  );
}

/** Editor for the "Prepared by" / "Noted by" / "Approved by" signatory blocks. */
function SignatoryGroupsEditor({
  groups,
  commissionerNames,
  onChange,
}: {
  groups: ReportSignatoryGroup[];
  /** { dropdown title -> acting commissioner's name } for Name prefilling. */
  commissionerNames: Record<string, string>;
  onChange: (next: ReportSignatoryGroup[]) => void;
}) {
  const patchGroup = (index: number, patch: Partial<ReportSignatoryGroup>) =>
    onChange(groups.map((group, i) => (i === index ? { ...group, ...patch } : group)));

  const patchSignatory = (
    groupIndex: number,
    signatoryIndex: number,
    patch: Partial<ReportSignatory>
  ) => {
    const group = groups[groupIndex];
    patchGroup(groupIndex, {
      signatories: group.signatories.map((signatory, i) =>
        i === signatoryIndex ? { ...signatory, ...patch } : signatory
      ),
    });
  };

  return (
    <div className="space-y-3">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="rounded-xl border border-gray-100 bg-white p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <EditorTextField
                label="Heading"
                value={group.heading}
                onCommit={(value) => patchGroup(groupIndex, { heading: value })}
              />
            </div>
            <button
              type="button"
              title="Remove this block"
              onClick={() => onChange(groups.filter((_, i) => i !== groupIndex))}
              className="mb-1 p-2 rounded-lg text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="mt-2 space-y-2">
            {group.signatories.map((signatory, signatoryIndex) => (
              <SignatoryRowEditor
                key={signatoryIndex}
                signatory={signatory}
                commissionerNames={commissionerNames}
                onCommit={(patch) => patchSignatory(groupIndex, signatoryIndex, patch)}
                onRemove={() =>
                  patchGroup(groupIndex, {
                    signatories: group.signatories.filter((_, i) => i !== signatoryIndex),
                  })
                }
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              patchGroup(groupIndex, {
                signatories: [...group.signatories, { name: "", role: "" }],
              })
            }
            className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#5C0102] hover:underline cursor-pointer"
          >
            <Plus size={12} /> Add signatory
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...groups, { heading: "", signatories: [{ name: "", role: "" }] }])}
        className="flex items-center gap-1 text-[11px] font-semibold text-[#5C0102] hover:underline cursor-pointer"
      >
        <Plus size={12} /> Add signatory block
      </button>
    </div>
  );
}

/**
 * One signatory row: name + "Position / role" dropdown.  The dropdown offers
 * the official LG-COMEA titles; choosing a commissioner title prefills the
 * Name with that acting commissioner's name (from the staff roster) — the
 * Name stays fully editable afterwards.  "Others" (and any title without a
 * roster match) reveal/keep a free-text role field and never touch the Name.
 * Name and role commit together through the row's Save button.
 */
function SignatoryRowEditor({
  signatory,
  commissionerNames,
  onCommit,
  onRemove,
}: {
  signatory: ReportSignatory;
  /** { dropdown title -> acting commissioner's name } for Name prefilling. */
  commissionerNames: Record<string, string>;
  onCommit: (patch: Partial<ReportSignatory>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(signatory.name);
  const [roleOption, setRoleOption] = useState(
    () => resolveSignatoryRoleSelection(signatory.role).option
  );
  const [customRole, setCustomRole] = useState(
    () => resolveSignatoryRoleSelection(signatory.role).customText
  );
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  // Re-sync when the committed signatory changes underneath the row (after a
  // Save, or after "Reset to default text", or when rows are removed/shifted).
  useEffect(() => {
    const selection = resolveSignatoryRoleSelection(signatory.role);
    setName(signatory.name);
    setRoleOption(selection.option);
    setCustomRole(selection.customText);
  }, [signatory]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    []
  );

  const effectiveRole = roleOption === SIGNATORY_ROLE_OTHER ? customRole : roleOption;
  const dirty = name !== signatory.name || effectiveRole !== signatory.role;

  /** Choosing a commissioner title drops that commissioner's name into the
   *  (still editable) Name field; other choices leave the Name untouched. */
  const handleRoleOptionChange = (nextOption: string) => {
    setRoleOption(nextOption);
    const commissionerName = commissionerNames[nextOption];
    if (commissionerName) setName(commissionerName);
  };

  const save = () => {
    onCommit({ name, role: effectiveRole });
    setJustSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setJustSaved(false), 1800);
  };

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 grid sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
          />
        </label>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Position / role
          </span>
          <div className="mt-1 flex flex-col sm:flex-row gap-2">
            <select
              value={roleOption}
              onChange={(event) => handleRoleOptionChange(event.target.value)}
              className="w-full sm:flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-red-100 cursor-pointer"
            >
              {SIGNATORY_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
              <option value={SIGNATORY_ROLE_OTHER}>{SIGNATORY_ROLE_OTHER}</option>
            </select>
            {roleOption === SIGNATORY_ROLE_OTHER && (
              <input
                type="text"
                value={customRole}
                onChange={(event) => setCustomRole(event.target.value)}
                placeholder="Specify position / role"
                className="w-full sm:flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
              />
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 pt-4">
        {justSaved ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
            <Check size={11} /> Saved
          </span>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            title={dirty ? "Save this signatory" : "No changes to save"}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
              dirty
                ? "bg-[#5C0102] text-white hover:opacity-90 cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            <Save size={11} /> Save
          </button>
        )}
        <button
          type="button"
          title="Remove signatory"
          onClick={onRemove}
          className="p-2 rounded-lg text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
