import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, CheckCircle, XCircle, Clock, Search, MessageSquare, Shield, Paperclip, Upload, X, ChevronDown, Download } from "lucide-react";
import { motion } from "motion/react";
import { useApp, Complaint } from "../../context/AppContext";
import type { ComplaintEvidence } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import { decideComplaintRpc, uploadComplaintEvidence } from "../../lib/supabaseData";
import { saveGrievanceResponseFormDocx } from "../../lib/docxGrievanceResponseForm";
import { statusMeta, sortFiledFirst, complaintsForElection, validateEvidenceFiles, EVIDENCE_ACCEPT, EVIDENCE_MAX_FILES, EVIDENCE_TYPES_LABEL, COMPLAINT_DECISION_VALUES, COMPLAINT_DECISION_LABELS, complaintDecisionDefinition, formatSubmittedAt } from "../../lib/complaints";
import { EvidenceFileThumb, EvidenceAttachment } from "../../components/EvidencePreview";

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
};

// 086/087/090/091 model: the stored 'accepted' literal displays as "Resolved",
// and "Send to Chief" / "Notify Commissioners" / "Reject" / "Save Findings"
// were removed.  The Commissioner records Findings — the single official
// explanation (complaint true → actions taken; complaint false → the reason,
// e.g. "No Evidence") — and 091: clicking Resolved SAVES those Findings and
// decides in one atomic call (090 still refuses a blank explanation, and the
// UI surfaces the requirement on click).  Status literals stay 'filed' |
// 'accepted' in the DB.
const FILTER_LABELS: Record<string, string> = { all: "All", filed: "Filed", accepted: "Resolved" };

// Deep links (dashboard stat cards) arrive with ?filter=...; anything else
// falls back to "all" instead of producing an empty, unexplained list.
const FILTER_VALUES = ["all", "filed", "accepted"] as const;
const readFilterParam = (param: string | null) =>
  param && FILTER_VALUES.includes(param as (typeof FILTER_VALUES)[number]) ? param : "all";

export default function AdminComplaints() {
  const { complaints, setComplaints, addLog, currentUser, electionPeriod } = useApp();
  const isChief = currentUser?.commissionerRole === "chief";
  // Only the Grievance Commissioner serves the respondent — the "Communication
  // for Respondent" download belongs to this role alone (not the Chief).
  const isGrievance = currentUser?.commissionerRole === "grievance";
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => readFilterParam(searchParams.get("filter")));
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  // The complaint whose response form is currently being generated.
  const [generatingForm, setGeneratingForm] = useState<string | null>(null);
  const [showFindings, setShowFindings] = useState<string | null>(null);
  const [findingsDraft, setFindingsDraft] = useState("");
  // 096: evidence files the Commissioner is attaching to the open Findings.
  const [findingsEvidenceFiles, setFindingsEvidenceFiles] = useState<File[]>([]);
  const [findingsEvidenceError, setFindingsEvidenceError] = useState("");
  // 090: the complaint that was blocked from resolving for lack of Findings —
  // drives the inline "required" error on the Findings input.
  const [findingsNeeded, setFindingsNeeded] = useState<string | null>(null);
  // 097: the required decision classification for the open Findings.
  const [findingsDecision, setFindingsDecision] = useState<Complaint["decision"] | "">("");
  const [decisionNeeded, setDecisionNeeded] = useState<string | null>(null);
  const resolveConfirm = useConfirm({ title: "Mark as Resolved?", description: "Mark this complaint as resolved? The Findings are saved and the student is notified — they can download the response letter from My Complaints.", confirmText: "Resolved" });

  // Deep links (dashboard stat cards) arrive with ?filter=...; the chip is
  // applied and the param is immediately stripped from the address bar
  // (replace, so Back doesn't resurrect it).  The tab always OPENS on "All"
  // — the deep link only decides the very first view, it never sticks.
  useEffect(() => {
    const param = searchParams.get("filter");
    if (!param) return;
    setFilter(readFilterParam(param));
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  // 089: complaints stay with the election they were filed under — this tab
  // manages the current election's rows; earlier elections' complaints are
  // kept in the Archive.
  const electionComplaints = complaintsForElection(complaints, electionPeriod.id);

  const filtered = sortFiledFirst(electionComplaints.filter((c) => {
    const matchSearch = `${c.studentName} ${c.subject}`.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || c.status === filter;
    return matchSearch && matchFilter;
  }));

  const closeFindings = () => {
    setShowFindings(null);
    setFindingsDraft("");
    setFindingsNeeded(null);
    setFindingsDecision("");
    setDecisionNeeded(null);
    setFindingsEvidenceFiles([]);
    setFindingsEvidenceError("");
  };

  const toggleFindings = (complaint: Complaint) => {
    if (showFindings === complaint.id) {
      closeFindings();
    } else {
      setShowFindings(complaint.id);
      setFindingsDraft(complaint.findings ?? "");
      setFindingsNeeded(null);
      setFindingsDecision("");
      setDecisionNeeded(null);
      setFindingsEvidenceFiles([]);
      setFindingsEvidenceError("");
    }
  };

  // 096: append findings-evidence picks after validating the cap/type/size.
  const handleFindingsEvidenceSelect = (picked: File[]) => {
    if (picked.length === 0) return;
    const problem = validateEvidenceFiles(picked, findingsEvidenceFiles.length);
    if (problem) {
      setFindingsEvidenceError(problem);
      return;
    }
    setFindingsEvidenceError("");
    setFindingsEvidenceFiles((previous) => [...previous, ...picked]);
  };

  const removeFindingsEvidenceFile = (index: number) => {
    setFindingsEvidenceError("");
    setFindingsEvidenceFiles((previous) => previous.filter((_, i) => i !== index));
  };

  // Generates and downloads the filled "Communication for Respondent" letter
  // (CNNHS-Grievance-Commissioner-Response-Form.docx) for this complaint —
  // Grievance Commissioner only.
  const handleDownloadResponseForm = async (complaint: Complaint) => {
    setGeneratingForm(complaint.id);
    try {
      await saveGrievanceResponseFormDocx({
        complaint,
        commissionerName: currentUser?.name,
        schoolYear: electionPeriod.schoolYear,
      });
    } catch (err) {
      addLog({
        user: currentUser?.name || "Commissioner",
        role: "Admin",
        action: "Response Form Download Failed",
        details: err instanceof Error ? err.message : "Failed to generate the response form",
        type: "error",
      });
    }
    setGeneratingForm(null);
  };

  const handleResolve = async (complaint: Complaint) => {
    // 091: Resolved saves the Findings and decides in one step.  The draft
    // (panel open) is the source of truth; otherwise the saved note stands.
    const panelOpen = showFindings === complaint.id;
    const effectiveFindings = (panelOpen ? findingsDraft : (complaint.findings ?? "")).trim();
    // 097: the classification is chosen in the panel (it is not persisted
    // until resolve), so a closed panel means "not chosen yet".
    const effectiveDecision = panelOpen ? findingsDecision : "";
    if (!effectiveFindings || !effectiveDecision) {
      // 090/097: both are mandatory — surface the requirement on the input
      // (auto-open the panel) instead of a dead button.
      setShowFindings(complaint.id);
      setFindingsDraft(complaint.findings ?? "");
      setFindingsNeeded(effectiveFindings ? null : complaint.id);
      setDecisionNeeded(effectiveDecision ? null : complaint.id);
      return;
    }
    // 096: findings evidence is optional, but if any was picked it must pass.
    if (findingsEvidenceFiles.length > 0) {
      const problem = validateEvidenceFiles(findingsEvidenceFiles);
      if (problem) {
        setFindingsEvidenceError(problem);
        return;
      }
    }
    const ok = await resolveConfirm.confirm();
    if (!ok) return;
    setProcessing(complaint.id);
    try {
      // 096: upload the findings evidence first, then decide — the RPC writes
      // the note AND the evidence URLs in one atomic call.
      const findingsEvidence: ComplaintEvidence[] = [];
      for (const file of findingsEvidenceFiles) {
        findingsEvidence.push(await uploadComplaintEvidence(file, `finding_${complaint.id}`));
      }
      // 092: the response letter is no longer auto-downloaded here — it
      // belongs to the student, who downloads it from My Complaints.
      await decideComplaintRpc(complaint.id, "accepted", undefined, effectiveFindings, findingsEvidence, effectiveDecision);
      const updated = complaints.map((c) =>
        c.id === complaint.id
          ? { ...c, status: "accepted" as const, findings: effectiveFindings, findingsEvidence, decision: effectiveDecision, resolvedAt: new Date().toISOString().split("T")[0] }
          : c
      );
      setComplaints(updated);
    } catch (err) {
      addLog({
        user: currentUser?.name || "Commissioner",
        role: "Admin",
        action: "Resolve Failed",
        details: err instanceof Error ? err.message : "Failed to resolve complaint",
        type: "error",
      });
    }
    setProcessing(null);
    closeFindings();
  };

  const getStatusBadge = (status: Complaint["status"]) => {
    const meta = statusMeta(status);
    return (
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 w-fit ${TONE_CLASSES[meta.tone]}`}>
        {status === "accepted" ? <CheckCircle size={11} /> : status === "rejected" ? <XCircle size={11} /> : <Clock size={11} />}
        {meta.label}
      </span>
    );
  };

  const stats = [
    { label: "Total", count: electionComplaints.length, color: "#5C0102" },
    { label: "Filed", count: electionComplaints.filter((c) => c.status === "filed").length, color: "#F59E0B" },
    { label: "Resolved", count: electionComplaints.filter((c) => c.status === "accepted").length, color: "#10B981" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-gray-900">Complaint Management</h1>
          {!isChief && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Grievance</span>}
          {isChief && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Chief Commissioner</span>}
        </div>
        <p className="text-gray-500 text-sm">Review, validate, record findings, and resolve student complaints.</p>
        <p className="text-xs text-gray-400 mt-1">
          Showing complaints filed for the current election{electionPeriod.schoolYear ? ` (${electionPeriod.schoolYear})` : ""}.
          Earlier elections' complaints are kept in the <a href="/admin/complaints-archive" className="underline">Complaints Archive</a>.
        </p>
      </motion.div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <div className="text-2xl font-bold mb-0.5" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search complaints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
            />
          </div>
          <div className="flex gap-2">
            {["all", "filed", "accepted"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${filter === f ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={filter === f ? { backgroundColor: "#5C0102" } : {}}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((complaint) => (
          <motion.div
            key={complaint.id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            // 097: a filed card is click-to-expand — the whole card toggles the
            // inline Findings input (no modal, no separate button).
            onClick={complaint.status === "filed" ? () => toggleFindings(complaint) : undefined}
            onKeyDown={complaint.status === "filed" ? (e) => {
              // Only the card itself responds — a space typed into the
              // Findings textarea (or the select) must not collapse it.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleFindings(complaint);
              }
            } : undefined}
            role={complaint.status === "filed" ? "button" : undefined}
            tabIndex={complaint.status === "filed" ? 0 : undefined}
            aria-expanded={complaint.status === "filed" ? showFindings === complaint.id : undefined}
            className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 transition-shadow ${
              complaint.status === "filed"
                ? "cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-100"
                : "hover:shadow-md"
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#FFF0F0" }}>
                <MessageSquare size={18} style={{ color: "#5C0102" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-start gap-2 mb-1">
                  <h4 className="text-gray-900 text-sm">{complaint.subject}</h4>
                  {getStatusBadge(complaint.status)}
                </div>
                <p className="text-xs text-gray-500 mb-2">{complaint.description}</p>
                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  <span>From: <strong className="text-gray-600">{complaint.studentName}</strong></span>
                  {complaint.complaintAgainst && <span>Against: <strong className="text-gray-600">{complaint.complaintAgainst}</strong></span>}
                  <span>Submitted: <strong className="text-gray-600">{formatSubmittedAt(complaint)}</strong></span>
                  {complaint.incidentDate && <span>Incident: <strong className="text-gray-600">{complaint.incidentDate}</strong></span>}
                  {complaint.resolvedAt && <span>Decided: <strong className="text-gray-600">{complaint.resolvedAt}</strong></span>}
                </div>
                {complaint.evidence && complaint.evidence.length > 0 && (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <div className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                      <Paperclip size={11} /> Student evidence
                    </div>
                    <ul className="space-y-1.5">
                      {complaint.evidence.map((item, index) => (
                        <li key={`${item.url}-${index}`}>
                          <EvidenceAttachment item={item} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {complaint.status === "rejected" && complaint.rejectionReason && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-100">
                    <div className="text-xs font-medium text-red-800 mb-0.5">Rejection reason</div>
                    <p className="text-xs text-red-700">{complaint.rejectionReason}</p>
                  </div>
                )}
                {complaint.status !== "filed" && complaint.findings && (
                  <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="text-xs font-medium text-gray-600 mb-0.5">Findings</div>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{complaint.findings}</p>
                    {complaint.findingsEvidence && complaint.findingsEvidence.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <ul className="space-y-1.5">
                          {complaint.findingsEvidence.map((item, index) => (
                            <li key={`${item.url}-${index}`}>
                              <EvidenceAttachment item={item} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {complaint.status === "filed" && (
                <div className="flex items-center gap-1 text-xs font-medium text-gray-400 flex-shrink-0 select-none">
                  Findings
                  <motion.span
                    animate={{ rotate: showFindings === complaint.id ? 180 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="inline-flex"
                  >
                    <ChevronDown size={16} />
                  </motion.span>
                </div>
              )}
            </div>
            {showFindings === complaint.id && complaint.status === "filed" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                onClick={(e) => e.stopPropagation()}
                className="mt-4 pt-4 border-t border-gray-100"
              >
                <div className="flex items-center gap-2 text-xs text-gray-600 mb-2 flex-wrap">
                  <Shield size={12} /> Findings
                  <span className="text-gray-400">(required to resolve — saved when you click Resolved)</span>
                  {/* 097: the classification, inline on the far right. */}
                  <select
                    aria-label="Complaint decision"
                    value={findingsDecision}
                    onChange={(e) => {
                      setFindingsDecision(e.target.value as Complaint["decision"]);
                      setDecisionNeeded(null);
                    }}
                    className={`ml-auto px-2.5 py-1.5 border rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] ${
                      decisionNeeded === complaint.id ? "border-red-400" : "border-gray-200"
                    } ${findingsDecision ? "text-gray-800" : "text-gray-400"}`}
                  >
                    <option value="" disabled>Select a decision...</option>
                    {COMPLAINT_DECISION_VALUES.map((value) => (
                      <option key={value} value={value} title={complaintDecisionDefinition(value)}>
                        {COMPLAINT_DECISION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>
                {findingsDecision && (
                  <p className="text-xs text-gray-500 mb-2">
                    <span className="font-medium text-gray-600">{COMPLAINT_DECISION_LABELS[findingsDecision]} — </span>
                    {complaintDecisionDefinition(findingsDecision)}
                  </p>
                )}
                {findingsNeeded === complaint.id && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 mb-2">
                    <AlertCircle size={12} /> Findings are required before this complaint can be resolved.
                  </div>
                )}
                {decisionNeeded === complaint.id && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 mb-2">
                    <AlertCircle size={12} /> A complaint decision is required before this complaint can be resolved.
                  </div>
                )}
                <textarea
                  placeholder="Explain the decision — if the complaint is true, state the actions taken; if false, state the reason (e.g., No Evidence)..."
                  value={findingsDraft}
                  onChange={(e) => {
                    setFindingsDraft(e.target.value);
                    setFindingsNeeded(null);
                  }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 mb-2 focus:outline-none ${
                    findingsNeeded === complaint.id
                      ? "border-red-400 focus:ring-2 focus:ring-red-100"
                      : "border-gray-200"
                  }`}
                  rows={3}
                />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                    <Paperclip size={12} /> Supporting evidence (optional)
                  </label>
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 cursor-pointer hover:border-[#5C0102] hover:text-[#5C0102] transition-colors">
                    <Upload size={13} /> Attach files
                    <input
                      type="file"
                      multiple
                      accept={EVIDENCE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        handleFindingsEvidenceSelect(Array.from(e.target.files ?? []));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span className="ml-2 text-xs text-gray-400">Up to {EVIDENCE_MAX_FILES} files · {EVIDENCE_TYPES_LABEL} · max 10 MB each</span>
                  {findingsEvidenceFiles.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {findingsEvidenceFiles.map((file, index) => (
                        <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                          <EvidenceFileThumb file={file} size={36} />
                          <span className="text-gray-700 truncate flex-1">{file.name}</span>
                          <span className="text-gray-400 shrink-0">{formatBytes(file.size)}</span>
                          <button
                            type="button"
                            onClick={() => removeFindingsEvidenceFile(index)}
                            aria-label={`Remove ${file.name}`}
                            className="text-gray-400 hover:text-red-600 shrink-0"
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {findingsEvidenceError && <p role="alert" className="mt-1 text-xs text-red-600">{findingsEvidenceError}</p>}
                </div>
              </motion.div>
            )}
            {complaint.status === "filed" && (
              <div className={`mt-4 pt-4 border-t border-gray-100 flex items-center ${isGrievance ? "justify-between" : "justify-end"}`}>
                {isGrievance && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownloadResponseForm(complaint); }}
                    disabled={generatingForm === complaint.id}
                    aria-label="Download CNNHS-Grievance-Commissioner-Response-Form.docx"
                    className="px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-xs font-medium hover:border-[#5C0102] hover:text-[#5C0102] transition-colors disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <Download size={12} />
                    {generatingForm === complaint.id ? "Preparing..." : "Response Form"}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleResolve(complaint); }}
                  disabled={processing === complaint.id}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-60 flex items-center gap-1.5"
                >
                  {processing === complaint.id ? "..." : <CheckCircle size={12} />}
                  {processing === complaint.id ? "" : "Resolved"}
                </button>
              </div>
            )}
          </motion.div>
        ))}

        {filtered.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
            <AlertCircle size={36} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-400 text-sm">No complaints found.</p>
          </div>
        )}
      </div>
      {resolveConfirm.dialog}
    </div>
  );
}
