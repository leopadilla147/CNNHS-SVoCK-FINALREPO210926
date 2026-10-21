import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, CheckCircle, XCircle, Clock, Search, MessageSquare, Shield } from "lucide-react";
import { motion } from "motion/react";
import { useApp, Complaint } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import { decideComplaintRpc } from "../../lib/supabaseData";
import { statusMeta, sortFiledFirst, complaintsForElection } from "../../lib/complaints";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState(() => readFilterParam(searchParams.get("filter")));
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [showFindings, setShowFindings] = useState<string | null>(null);
  const [findingsDraft, setFindingsDraft] = useState("");
  // 090: the complaint that was blocked from resolving for lack of Findings —
  // drives the inline "required" error on the Findings input.
  const [findingsNeeded, setFindingsNeeded] = useState<string | null>(null);
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
  };

  const toggleFindings = (complaint: Complaint) => {
    if (showFindings === complaint.id) {
      closeFindings();
    } else {
      setShowFindings(complaint.id);
      setFindingsDraft(complaint.findings ?? "");
      setFindingsNeeded(null);
    }
  };

  const handleResolve = async (complaint: Complaint) => {
    // 091: Resolved saves the Findings and decides in one step.  The draft
    // (panel open) is the source of truth; otherwise the saved note stands.
    const effectiveFindings = (showFindings === complaint.id ? findingsDraft : (complaint.findings ?? "")).trim();
    if (!effectiveFindings) {
      // 090: findings are mandatory — surface the requirement on the input
      // (auto-open the panel) instead of a dead button.
      setShowFindings(complaint.id);
      setFindingsDraft(complaint.findings ?? "");
      setFindingsNeeded(complaint.id);
      return;
    }
    const ok = await resolveConfirm.confirm();
    if (!ok) return;
    setProcessing(complaint.id);
    try {
      // 092: the response letter is no longer auto-downloaded here — it
      // belongs to the student, who downloads it from My Complaints.
      await decideComplaintRpc(complaint.id, "accepted", undefined, effectiveFindings);
      const updated = complaints.map((c) =>
        c.id === complaint.id
          ? { ...c, status: "accepted" as const, findings: effectiveFindings, resolvedAt: new Date().toISOString().split("T")[0] }
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
            className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
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
                  <span>Submitted: <strong className="text-gray-600">{complaint.submittedAt}</strong></span>
                  {complaint.incidentDate && <span>Incident: <strong className="text-gray-600">{complaint.incidentDate}</strong></span>}
                  {complaint.resolvedAt && <span>Decided: <strong className="text-gray-600">{complaint.resolvedAt}</strong></span>}
                </div>
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
                  </div>
                )}
              </div>
              {complaint.status === "filed" && (
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                  <button
                    onClick={() => toggleFindings(complaint)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                  >
                    Findings
                  </button>
                  <button
                    onClick={() => handleResolve(complaint)}
                    disabled={processing === complaint.id}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-60 flex items-center gap-1"
                  >
                    {processing === complaint.id ? "..." : <CheckCircle size={11} />}
                    {processing === complaint.id ? "" : "Resolved"}
                  </button>
                </div>
              )}
            </div>
            {showFindings === complaint.id && complaint.status === "filed" && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
                  <Shield size={12} /> Findings
                  <span className="text-gray-400">(required to resolve — saved when you click Resolved)</span>
                </div>
                {findingsNeeded === complaint.id && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 mb-2">
                    <AlertCircle size={12} /> Findings are required before this complaint can be resolved.
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
              </motion.div>
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
