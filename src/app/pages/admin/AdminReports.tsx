import { motion } from "motion/react";
import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Printer,
  Trophy,
  ChevronDown,
  Download,
  FileText,
  FileCheck,
  ImagePlus,
  Eye,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useApp, Candidate, ElectionPeriod, LogEntry } from "../../context/AppContext";
import {
  generateChiefElectionReport, openPrintWindow, wrapReportDocument,
} from "../../lib/reports";
import {
  saveAccomplishmentReportDocx,
  type AccomplishmentReportImage,
} from "../../lib/docxAccomplishmentReport";
import {
  type AccomplishmentReportDraft,
  type ReportSignatoryGroup,
} from "../../lib/accomplishmentReportContent";
import {
  resetReportDraft,
  setReportDraft,
  useReportDraft,
} from "../../lib/reportDraft";
import {
  addReportImages,
  clearReportImages,
  fileToReportImage,
  removeReportImage,
  setReportImageCaption,
  useReportImages,
} from "../../lib/reportImages";
import {
  getLiveResultsRpc, getAbstainSummaryRpc, type LiveResultRow,
} from "../../lib/supabaseData";

// Canonical core-position ordering; every other position (including the
// grade-level representatives) is derived from the live results.
const CORE_POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "PRO"];
const isGradeRep = (p: string) => /representative/i.test(p);

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
 * v1.2 scope per the Chief's request:
 *   * the DepEd Enclosure Reports grid and the estimated voter-turnout
 *     charts/sections are REMOVED;
 *   * the results now come from the role-gated get_live_results_rpc
 *     (real per-candidate vote counts) and get_abstain_summary_rpc
 *     (046 abstain ledger), so the abstain percentage and the winners
 *     summary are computed from actual ballots;
 *   * the Winners Summary lists EVERY position on the ballot — including
 *     the grade-level representatives — each with a dropdown of all its
 *     candidates sorted by votes (highest first).
 */
export default function AdminReports() {
  const { candidates, electionPeriod, logs, currentUser } = useApp();

  // 068 renamed every officer account, so the acting chief's name replaces
  // the bundled template signatory.  Only the chief can resolve officer
  // names (list_staff_roster_rpc is chief-gated), so any other staff role
  // printing this page keeps the template line.
  const chiefName =
    currentUser?.commissionerRole === "chief" ? currentUser.name : undefined;
  const approved = candidates.filter((c) => c.status === "approved");

  const [liveResults, setLiveResults] = useState<LiveResultRow[] | null>(null);
  const [abstainByPosition, setAbstainByPosition] = useState<Record<string, number>>({});
  const [resultsError, setResultsError] = useState("");

  // Live results + abstain ledger are chief-gated RPCs (027 / 046); this
  // tab is Chief-only, but a failure degrades to the candidate list with
  // zero counts rather than breaking the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, abstain] = await Promise.all([
          getLiveResultsRpc(),
          getAbstainSummaryRpc().catch(() => [] as { position: string; abstain_count: number }[]),
        ]);
        if (cancelled) return;
        setLiveResults(rows);
        const map: Record<string, number> = {};
        abstain.forEach((a) => { map[a.position] = Number(a.abstain_count) || 0; });
        setAbstainByPosition(map);
      } catch (err) {
        if (!cancelled) setResultsError(err instanceof Error ? err.message : "Live results unavailable.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Per-position candidate rows sorted by votes (highest first).  Live
   * rows win when available; otherwise the approved candidate list is
   * used (votes stay 0 until ballots exist).
   */
  const resultsByPosition = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; party: string; gradeLevel: string; votes: number; picture?: string }>>();

    if (liveResults && liveResults.length > 0) {
      liveResults.forEach((r) => {
        const list = map.get(r.position) ?? [];
        list.push({
          id: r.candidate_id,
          name: `${r.given_name} ${r.surname}`,
          party: r.party_name || "Independent",
          gradeLevel: "",
          votes: Number(r.votes) || 0,
        });
        map.set(r.position, list);
      });
      // Enrich grade level from the candidate roster where available.
      map.forEach((list) => list.forEach((row) => {
        const c = approved.find((x) => x.id === row.id);
        if (c) { row.gradeLevel = c.gradeLevel || ""; row.picture = c.picture; }
      }));
    } else {
      approved.forEach((c) => {
        const list = map.get(c.position) ?? [];
        list.push({
          id: c.id,
          name: `${c.givenName} ${c.surname}`,
          party: c.partyAffiliation || "Independent",
          gradeLevel: c.gradeLevel || "",
          votes: c.votes || 0,
          picture: c.picture,
        });
        map.set(c.position, list);
      });
    }

    map.forEach((list) => list.sort((a, b) => b.votes - a.votes));
    return map;
  }, [liveResults, approved]);

  const positions = useMemo(() => {
    const rank = (p: string): [number, string] => {
      const i = CORE_POSITIONS.indexOf(p);
      if (i >= 0) return [i, ""];
      if (isGradeRep(p)) return [2, p];
      return [1, p];
    };
    return [...resultsByPosition.keys()].sort((a, b) => {
      const [ra, na] = rank(a);
      const [rb, nb] = rank(b);
      return ra !== rb ? ra - rb : na.localeCompare(nb);
    });
  }, [resultsByPosition]);

  const totalVotesCast = useMemo(
    () => [...resultsByPosition.values()].reduce((sum, list) => sum + list.reduce((s, c) => s + c.votes, 0), 0),
    [resultsByPosition]
  );
  const totalAbstains = useMemo(
    () => Object.values(abstainByPosition).reduce((s, n) => s + n, 0),
    [abstainByPosition]
  );
  const totalBallots = totalVotesCast + totalAbstains;
  const abstainPct = totalBallots > 0 ? Math.round((totalAbstains / totalBallots) * 1000) / 10 : 0;

  const ctx: ReportContext = { candidates, electionPeriod, logs };

  const startYear = new Date(electionPeriod.startDate).getFullYear();
  const schoolYear = Number.isNaN(startYear) ? "2026-2027" : `${startYear}-${startYear + 1}`;

  /**
   * Editable body of the report.  Seeded from the live election the first time
   * the page is opened, then kept in this browser's localStorage so the Chief's
   * edits survive a reload (see lib/reportDraft.ts — no database involved).
   */
  const reportDraftSeed = {
    periodLabel: schoolYear,
    dateTime: electionPeriod.startDate
      ? `${electionPeriod.startDate} ${electionPeriod.startTime}`
      : undefined,
    venue: electionPeriod.venue,
    chiefName,
  };
  const reportDraft = useReportDraft(reportDraftSeed);

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

  // Session-only photo documentation (see lib/reportImages.ts).
  const reportImages = useReportImages();
  const [imageError, setImageError] = useState<string | null>(null);

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

  interface ReportContext {
    candidates: Candidate[];
    electionPeriod: ElectionPeriod;
    logs: LogEntry[];
  }

  const results = positions
    .map((position) => {
      const list = resultsByPosition.get(position) ?? [];
      const winner = list[0];
      return winner ? {
        position,
        winnerName: winner.name,
        party: winner.party,
        gradeLevel: winner.gradeLevel,
        votes: winner.votes,
      } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Participation estimate for the accomplishment report: the busiest
  // position's ballot count is the best available participation measure
  // (each voter casts one ballot per position).
  const busiestBallots = Math.max(0, ...positions.map((p) => {
    const list = resultsByPosition.get(p) ?? [];
    return list.reduce((s, c) => s + c.votes, 0) + (abstainByPosition[p] ?? 0);
  }));
  const turnoutPct = electionPeriodIsActiveGuard(busiestBallots);

  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);

  /**
   * Everything the printed report, the .docx export and the on-page preview
   * share — including the Chief's edited draft, so all three stay in lockstep.
   */
  const chiefReportInput = {
    chiefName,
    draft: reportDraft,
    periodLabel: schoolYear,
    dateTime: reportDraftSeed.dateTime,
    venue: electionPeriod.venue,
    totals: {
      totalVoters: approved.length,
      voted: busiestBallots,
      notVoted: Math.max(approved.length - busiestBallots, 0),
      turnoutPct,
    },
    approvedCandidates: approved,
    results,
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

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-gray-900 mb-1">Election Reports</h1>
            <p className="text-gray-500 text-sm">Live results, abstain percentage, and official LG-COMEA Accomplishment Report for the CNNHS Student Election.</p>
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

      {resultsError && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          {resultsError} — showing approved candidates with zero counts.
        </div>
      )}

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

          <a
            href="/templates/LG-COMEA_ACCOMPLISHMENT-REPORT.SSLG-AND-YES-O-26-27.docx"
            download="LG-COMEA_ACCOMPLISHMENT-REPORT.SSLG-AND-YES-O-26-27.docx"
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            <FileText size={15} className="text-gray-500" />
            <span>Download Base Template (.docx)</span>
          </a>
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
                Everything you type here goes straight into the printed report and the .docx export. Saved in this browser only.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resetReportDraft(reportDraftSeed)}
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
                onChange={(value) => patchDraft({ periodLabel: value })}
              />
              <EditorTextField
                label="Date / time"
                value={reportDraft.dateTime}
                onChange={(value) => patchDraft({ dateTime: value })}
              />
              <EditorTextField
                label="Place / venue / platform"
                value={reportDraft.venue}
                onChange={(value) => patchDraft({ venue: value })}
              />
            </div>
          </EditorSection>

          <EditorSection title="Rationale">
            <EditorTextField
              label="Lead line"
              value={reportDraft.rationaleLead}
              onChange={(value) => patchDraft({ rationaleLead: value })}
            />
            <EditorListField
              legend="Rationale paragraphs"
              items={reportDraft.rationaleParagraphs}
              rows={4}
              addLabel="Add paragraph"
              onChange={(next) => setDraftList("rationaleParagraphs", next)}
            />
          </EditorSection>

          <EditorSection title="Objectives">
            <EditorListField
              legend="Objectives"
              hint="Rendered as a. b. c. … in the document."
              items={reportDraft.objectives}
              rows={2}
              addLabel="Add objective"
              onChange={(next) => setDraftList("objectives", next)}
            />
          </EditorSection>

          <EditorSection title="Highlights">
            <EditorListField
              legend="Highlights"
              items={reportDraft.highlights}
              rows={4}
              addLabel="Add paragraph"
              onChange={(next) => setDraftList("highlights", next)}
            />
          </EditorSection>

          <EditorSection title="Financial liquidation">
            <EditorTextField
              label="Financial Accomplishment / Liquidation Report (if any)"
              value={reportDraft.financialLiquidation}
              onChange={(value) => patchDraft({ financialLiquidation: value })}
            />
          </EditorSection>

          <EditorSection title="Recommendations">
            <EditorListField
              legend="Recommendation/s"
              items={reportDraft.recommendations}
              rows={2}
              addLabel="Add recommendation"
              onChange={(next) => setDraftList("recommendations", next)}
            />
          </EditorSection>

          <EditorSection title="Signatories">
            <SignatoryGroupsEditor
              groups={reportDraft.signatoryGroups}
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

      {/* Summary Header */}
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6 text-center"
        style={{ borderTop: "4px solid #5C0102" }}
      >
        <h2 className="text-gray-900 mb-1">CNNHS Student Election</h2>
        <p className="text-gray-500 text-sm">Camarines Norte National High School</p>
        <p className="text-gray-400 text-xs mt-1">
          Election Period: {electionPeriod.startDate} {electionPeriod.startTime} — {electionPeriod.endDate} {electionPeriod.endTime}
        </p>
        <div className="flex flex-wrap justify-center gap-6 mt-4 pt-4 border-t border-gray-100">
          {[
            { label: "Registered Voters", value: approved.length, color: "#5C0102" },
            { label: "Total Votes Cast", value: totalVotesCast.toLocaleString(), color: "#5C0102" },
            { label: "Abstain Votes", value: totalAbstains.toLocaleString(), color: "#9CA3AF" },
            { label: "Abstain Percentage", value: `${abstainPct}%`, color: "#B91C1C" },
            { label: "Active Candidates", value: approved.length, color: "#5C0102" },
            { label: "Positions", value: positions.length, color: "#5C0102" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-gray-400">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Winners Summary — every position, incl. grade-level representatives */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-1 text-sm flex items-center gap-2">
          <Trophy size={16} style={{ color: "#5C0102" }} /> Winners Summary (Based on Current Results)
        </h3>
        <p className="text-gray-400 text-xs mb-4">
          Every position on the ballot — including grade-level representatives. Expand a position to see all of its candidates sorted by votes (highest first).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#FFF5F5" }}>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Position</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Leading Candidate</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Party</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Votes</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Vote %</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Abstain %</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Grade</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">All Candidates</th>
              </tr>
            </thead>
              <tbody className="divide-y divide-gray-50">
                {positions.map((position) => {
                  const list = resultsByPosition.get(position) ?? [];
                  const winner = list[0];
                  const posTotal = list.reduce((s, c) => s + c.votes, 0);
                  const abstains = abstainByPosition[position] ?? 0;
                  const posBallots = posTotal + abstains;
                  return (
                    <tr key={position} className="hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="py-3 px-4 font-medium text-gray-900">{position}</td>
                      <td className="py-3 px-4">
                        {winner ? (
                          <div className="flex items-center gap-2">
                            {winner.picture && <img src={winner.picture} alt="" className="w-7 h-7 rounded-full object-cover" />}
                            <span className="text-gray-800">{winner.name}</span>
                            <Trophy size={12} style={{ color: "#5C0102" }} />
                          </div>
                        ) : <span className="text-gray-400">No candidates</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{winner?.party || "—"}</td>
                      <td className="py-3 px-4 font-bold" style={{ color: "#5C0102" }}>{winner ? winner.votes.toLocaleString() : "—"}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{winner && posTotal > 0 ? `${Math.round((winner.votes / posTotal) * 100)}%` : "—"}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">
                        {posBallots > 0 ? `${Math.round((abstains / posBallots) * 100)}%` : "—"}
                        <span className="text-gray-300 ml-1">({abstains})</span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{winner?.gradeLevel || "—"}</td>
                      <td className="py-3 px-4">
                        {list.length > 0 ? (
                          <select
                            defaultValue="0"
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white"
                            title="All candidates for this position, sorted by votes (highest first)"
                          >
                            {list.map((c, i) => (
                              <option key={c.id} value={String(i)}>
                                {i + 1}. {c.name} — {c.votes.toLocaleString()} vote{c.votes === 1 ? "" : "s"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {positions.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400 text-sm">No results yet.</td></tr>
                )}
              </tbody>
           </table>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
          <ChevronDown size={12} /> Click any row to open the dropdown and see all candidates for that position, sorted by votes (highest first). The winner is shown by default.
        </div>
      </motion.div>
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
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {description && <p className="text-[11px] text-gray-400">{description}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

/** Labelled single-line input used throughout the report editor. */
function EditorTextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
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
  onChange,
}: {
  legend: string;
  hint?: string;
  items: string[];
  rows?: number;
  addLabel: string;
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{legend}</div>
          {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="flex items-center gap-1 text-[11px] font-semibold text-[#5C0102] hover:underline shrink-0 cursor-pointer"
        >
          <Plus size={12} /> {addLabel}
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            <textarea
              value={item}
              rows={rows}
              onChange={(event) =>
                onChange(items.map((value, i) => (i === index ? event.target.value : value)))
              }
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 bg-white leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-100"
            />
            <button
              type="button"
              title="Remove"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="mt-1 p-2 rounded-lg text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[11px] text-gray-400 italic">No entries.</p>}
      </div>
    </div>
  );
}

/** Editor for the "Prepared by" / "Noted by" / "Approved by" signatory blocks. */
function SignatoryGroupsEditor({
  groups,
  onChange,
}: {
  groups: ReportSignatoryGroup[];
  onChange: (next: ReportSignatoryGroup[]) => void;
}) {
  const patchGroup = (index: number, patch: Partial<ReportSignatoryGroup>) =>
    onChange(groups.map((group, i) => (i === index ? { ...group, ...patch } : group)));

  const patchSignatory = (
    groupIndex: number,
    signatoryIndex: number,
    patch: Partial<ReportSignatoryGroup["signatories"][number]>
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
                onChange={(value) => patchGroup(groupIndex, { heading: value })}
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
              <div key={signatoryIndex} className="flex items-end gap-2">
                <div className="flex-1 grid sm:grid-cols-2 gap-2">
                  <EditorTextField
                    label="Name"
                    value={signatory.name}
                    onChange={(value) => patchSignatory(groupIndex, signatoryIndex, { name: value })}
                  />
                  <EditorTextField
                    label="Position / role"
                    value={signatory.role}
                    onChange={(value) => patchSignatory(groupIndex, signatoryIndex, { role: value })}
                  />
                </div>
                <button
                  type="button"
                  title="Remove signatory"
                  onClick={() =>
                    patchGroup(groupIndex, {
                      signatories: group.signatories.filter((_, i) => i !== signatoryIndex),
                    })
                  }
                  className="mb-1 p-2 rounded-lg text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
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

/** Turnout estimate kept for the printable accomplishment report only. */
function electionPeriodIsActiveGuard(ballots: number): number {
  return ballots;
}