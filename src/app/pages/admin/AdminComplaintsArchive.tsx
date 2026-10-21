import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useApp, Complaint } from "../../context/AppContext";
import { statusMeta } from "../../lib/complaints";
import { listElectionPeriodLabels } from "../../lib/supabaseData";
import { FolderArchive, MessageSquare, Search, Eye, XCircle, Clock, CheckCircle } from "lucide-react";

// 092 — the dedicated complaint archive.  Unlike Complaint Management (which
// scopes to the live election via complaintsForElection), this page lists
// EVERY complaint ever filed, from every election period, with no
// election-stage gating: complaints are never deleted from the live
// `complaints` table (085), so the full history is already in context.
//
// The response letter is NOT downloadable here — it belongs to the student
// who filed the complaint, who downloads it from My Complaints.

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
};

const FILTER_LABELS: Record<string, string> = { all: "All", filed: "Filed", accepted: "Resolved" };

export default function AdminComplaintsArchive() {
  const { complaints } = useApp();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "filed" | "accepted">("all");
  const [preview, setPreview] = useState<Complaint | null>(null);
  // Election period id → school year, so each row names the election it
  // was filed under (the context only carries the live period).
  const [periodLabels, setPeriodLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    listElectionPeriodLabels().then((labels) => {
      if (!cancelled) setPeriodLabels(labels);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      complaints
        .filter((c) => filter === "all" || c.status === filter)
        .filter((c) =>
          `${c.studentName} ${c.subject}`.toLowerCase().includes(search.toLowerCase())
        )
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0)),
    [complaints, filter, search]
  );

  const stats = [
    { label: "Total", count: complaints.length, color: "#5C0102" },
    { label: "Filed", count: complaints.filter((c) => c.status === "filed").length, color: "#F59E0B" },
    { label: "Resolved", count: complaints.filter((c) => c.status === "accepted").length, color: "#10B981" },
  ];

  // Escape closes the preview (the backdrop click does too).
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  const periodLabel = (complaint: Complaint) =>
    (complaint.electionPeriodId && periodLabels[complaint.electionPeriodId]) || "";

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-gray-900 mb-1">Complaints Archive</h1>
        <p className="text-gray-500 text-sm">
          Every complaint ever filed, across all elections — filed or resolved, with no election-period restriction.
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
              placeholder="Search archived complaints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
            />
          </div>
          <div className="flex gap-2">
            {(["all", "filed", "accepted"] as const).map((f) => (
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <FolderArchive size={20} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-500">No archived complaints found.</p>
          </div>
        ) : (
          filtered.map((complaint) => {
            const meta = statusMeta(complaint.status);
            const label = periodLabel(complaint);
            return (
              <div
                key={complaint.id}
                className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => setPreview(complaint)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#FFF0F0" }}>
                    <MessageSquare size={16} style={{ color: "#5C0102" }} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{complaint.subject}</div>
                    <div className="text-xs text-gray-500">
                      {meta.label} · {complaint.submittedAt} · {complaint.studentName}
                      {label && ` · ${label}`}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreview(complaint);
                  }}
                  className="p-2 text-gray-400 hover:text-[#5C0102] rounded-lg hover:bg-gray-100 transition-colors"
                  title="Preview"
                >
                  <Eye size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
            onClick={() => setPreview(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              role="dialog"
              aria-modal="true"
              className="bg-white rounded-2xl shadow-xl max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 text-white flex items-start justify-between gap-4" style={{ backgroundColor: "#5C0102" }}>
                <div>
                  <div className="flex items-center gap-2 text-white/70 text-xs uppercase tracking-wide mb-1">
                    <MessageSquare size={13} /> Complaint Record
                  </div>
                  <h3 className="text-white">{preview.subject}</h3>
                  <p className="text-white/70 text-xs mt-0.5">
                    Filed by {preview.studentName}
                    {periodLabel(preview) && ` · ${periodLabel(preview)}`}
                  </p>
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                  title="Close"
                >
                  <XCircle size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 w-fit ${TONE_CLASSES[statusMeta(preview.status).tone]}`}>
                    {preview.status === "accepted" ? <CheckCircle size={11} /> : preview.status === "rejected" ? <XCircle size={11} /> : <Clock size={11} />}
                    {statusMeta(preview.status).label}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    ["Filed", preview.submittedAt],
                    ...(preview.incidentDate ? [["Incident Date", preview.incidentDate]] : []),
                    ...(preview.resolvedAt ? [["Resolved", preview.resolvedAt]] : []),
                  ].map(([label, val]) => (
                    <div key={label} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
                      <div className="text-gray-800 font-medium text-xs break-all">{val}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Description</div>
                  <p className="text-gray-800 whitespace-pre-wrap text-sm">{preview.description}</p>
                </div>

                {preview.findings && (
                  <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                    <div className="text-xs font-medium text-green-800 mb-1 uppercase tracking-wide">Findings</div>
                    <p className="text-green-900 whitespace-pre-wrap text-sm">{preview.findings}</p>
                  </div>
                )}

                {preview.rejectionReason && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <div className="text-xs font-medium text-red-700 mb-1 uppercase tracking-wide">Resolution Reason</div>
                    <p className="text-red-800 text-sm">{preview.rejectionReason}</p>
                  </div>
                )}

                {preview.resolvedByName && (
                  <div className="text-xs text-gray-500">
                    Resolved by <strong className="text-gray-700">{preview.resolvedByName}</strong>, Learner Government Commissioner of Grievance
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
