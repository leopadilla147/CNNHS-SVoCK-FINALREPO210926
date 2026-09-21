import { useState } from "react";
import { AlertCircle, CheckCircle, XCircle, Clock, Search, MessageSquare, Send, Shield, Download } from "lucide-react";
import { motion } from "motion/react";
import { useApp, Complaint } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import { decideComplaintRpc } from "../../lib/supabaseData";
import { saveResponseLetter } from "../../lib/docxResponseLetter";
import { statusMeta, sortFiledFirst } from "../../lib/complaints";

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
};

export default function AdminComplaints() {
  const { complaints, setComplaints, addLog, currentUser } = useApp();
  const isChief = currentUser?.commissionerRole === "chief";
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [resolution, setResolution] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [showFactFind, setShowFactFind] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const acceptConfirm = useConfirm({ title: "Accept Complaint?", description: "Accept this complaint and generate the response letter.", confirmText: "Accept" });
  const sendToChiefConfirm = useConfirm({ title: "Send to Chief?", description: "Forward this complaint's initial decision to the Chief Commissioner for review.", confirmText: "Send to Chief" });

  const filtered = sortFiledFirst(complaints.filter((c) => {
    const matchSearch = `${c.studentName} ${c.subject}`.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || c.status === filter;
    return matchSearch && matchFilter;
  }));

  const handleAccept = async (complaint: Complaint) => {
    const ok = await acceptConfirm.confirm();
    if (!ok) return;
    setProcessing(complaint.id);
    try {
      await decideComplaintRpc(complaint.id, "accepted");
      await saveResponseLetter(
        { studentName: complaint.studentName, subject: complaint.subject, status: "accepted" },
        `grievance-response-${complaint.id}.docx`
      );
      const updated = complaints.map((c) =>
        c.id === complaint.id
          ? { ...c, status: "accepted" as const, resolvedAt: new Date().toISOString().split("T")[0] }
          : c
      );
      setComplaints(updated);
    } catch (err) {
      addLog({
        user: currentUser?.name || "Commissioner",
        role: "Admin",
        action: "Accept Failed",
        details: err instanceof Error ? err.message : "Failed to accept complaint",
        type: "error",
      });
    }
    setProcessing(null);
    setSelected(null);
  };

  const handleReject = async (complaint: Complaint, reason: string) => {
    if (!reason.trim()) return;
    if (rejectingId !== complaint.id) return;
    setProcessing(complaint.id);
    try {
      await decideComplaintRpc(complaint.id, "rejected", reason.trim());
      const updated = complaints.map((c) =>
        c.id === complaint.id
          ? { ...c, status: "rejected" as const, rejectionReason: reason.trim(), resolvedAt: new Date().toISOString().split("T")[0] }
          : c
      );
      setComplaints(updated);
    } catch (err) {
      addLog({
        user: currentUser?.name || "Commissioner",
        role: "Admin",
        action: "Reject Failed",
        details: err instanceof Error ? err.message : "Failed to reject complaint",
        type: "error",
      });
    }
    setProcessing(null);
    setRejectingId(null);
    setRejectReason("");
    setSelected(null);
  };

  const handleSendToChief = async (complaint: Complaint) => {
    const ok = await sendToChiefConfirm.confirm();
    if (!ok) return;
    setProcessing(complaint.id);
    await new Promise((r) => setTimeout(r, 600));
    addLog({
      user: currentUser?.name || "Commissioner",
      role: "Admin",
      action: "Forwarded to Chief Commissioner",
      details: `Initial decision forwarded for complaint: "${complaint.subject}"`,
      type: "info",
    });
    setProcessing(null);
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
    { label: "Total", count: complaints.length, color: "#5C0102" },
    { label: "Filed", count: complaints.filter((c) => c.status === "filed").length, color: "#F59E0B" },
    { label: "Accepted", count: complaints.filter((c) => c.status === "accepted").length, color: "#10B981" },
    { label: "Rejected", count: complaints.filter((c) => c.status === "rejected").length, color: "#9CA3AF" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-gray-900">Complaint Management</h1>
          {!isChief && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Grievance</span>}
          {isChief && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Chief Commissioner</span>}
        </div>
        <p className="text-gray-500 text-sm">Review, validate, conduct fact-finding, and submit initial decisions to the Chief Commissioner.</p>
      </motion.div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
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
            {["all", "filed", "accepted", "rejected"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-all ${filter === f ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={filter === f ? { backgroundColor: "#5C0102" } : {}}
              >
                {f}
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
              </div>
              {complaint.status === "filed" && (
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                  <button
                    onClick={() => setShowFactFind(showFactFind === complaint.id ? null : complaint.id)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                  >
                    Fact-Find
                  </button>
                  <button
                    onClick={() => handleAccept(complaint)}
                    disabled={processing === complaint.id}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-60 flex items-center gap-1"
                  >
                    {processing === complaint.id ? "..." : <Download size={11} />}
                    {processing === complaint.id ? "" : "Accept"}
                  </button>
                  {rejectingId === complaint.id ? (
                    <div className="flex flex-col gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg w-72">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Reason for rejection (required)"
                        autoFocus
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-400"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReject(complaint, rejectReason)}
                          disabled={processing === complaint.id || !rejectReason.trim()}
                          className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {processing === complaint.id ? "..." : "Confirm Reject"}
                        </button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason(""); }}
                          className="px-3 py-1.5 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setRejectingId(complaint.id); setRejectReason(""); }}
                      disabled={processing === complaint.id}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      Reject
                    </button>
                  )}
                  {!isChief && (
                    <button
                      onClick={() => handleSendToChief(complaint)}
                      disabled={processing === complaint.id}
                      className="px-3 py-1.5 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:opacity-90 disabled:opacity-60"
                      style={{ backgroundColor: "#5C0102" }}
                    >
                      <Send size={11} /> Send to Chief
                    </button>
                  )}
                </div>
              )}
            </div>
            {showFactFind === complaint.id && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
                  <Shield size={12} /> Fact-Finding Investigation
                </div>
                <textarea
                  placeholder="Enter fact-finding notes, commissioner comments, and initial decision recommendation..."
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 mb-2"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 text-white rounded-lg text-xs font-medium hover:opacity-90" style={{ backgroundColor: "#5C0102" }}>
                    Save Notes
                  </button>
                  <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 flex items-center gap-1">
                    <Send size={11} /> Notify Commissioners
                  </button>
                </div>
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
      {acceptConfirm.dialog}
      {sendToChiefConfirm.dialog}
    </div>
  );
}
