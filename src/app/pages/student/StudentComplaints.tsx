import { useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Send, Clock, CheckCircle, XCircle, CalendarDays, MessageSquare } from "lucide-react";
import { useApp } from "../../context/AppContext";
import type { Complaint } from "../../context/AppContext";
import { insertComplaint } from "../../lib/supabaseData";
import { statusMeta, sortFiledFirst } from "../../lib/complaints";

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
};

export default function StudentComplaints() {
  const { complaints, setComplaints, currentUser, addLog } = useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const myComplaints = sortFiledFirst(complaints);

  const getStatusBadge = (status: string) => {
    const meta = statusMeta(status as Complaint["status"]);
    return (
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 w-fit ${TONE_CLASSES[meta.tone]}`}>
        {status === "accepted" ? <CheckCircle size={11} /> : status === "rejected" ? <XCircle size={11} /> : <Clock size={11} />}
        {meta.label}
      </span>
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.id) return;
    if (!title.trim() || !description.trim()) {
      setError("Please provide a subject and a description.");
      return;
    }
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const row = await insertComplaint({
        studentId: currentUser.id,
        title: title.trim(),
        description: description.trim(),
        incidentDate: incidentDate || undefined,
      });
      setComplaints([row, ...complaints]);
      setTitle("");
      setDescription("");
      setIncidentDate("");
      setSuccess("Your complaint has been filed and is now awaiting review by the Commissioner of Grievance.");
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Filed Complaint",
        details: `Filed complaint "${title.trim()}"`,
        type: "info",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file complaint. Please try again.");
    }
    setSubmitting(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">My Complaints</h1>
        <p className="text-gray-500 text-sm">File a complaint about the election process or track your previously filed complaints.</p>
      </motion.div>

      {/* Submit form */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-8">
        <h3 className="text-gray-900 text-sm mb-4 flex items-center gap-2">
          <AlertCircle size={16} style={{ color: "#5C0102" }} /> File a Complaint
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Vote buying reported in Grade 11"
              maxLength={200}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened, including any people involved and when..."
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
              <CalendarDays size={12} /> Date of Incident (optional)
            </label>
            <input
              type="date"
              value={incidentDate}
              onChange={(e) => setIncidentDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: "#5C0102" }}
          >
            {submitting ? <span className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" /> : <Send size={14} />}
            Submit Complaint
          </button>
        </form>
      </motion.div>

      {/* Status list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-gray-900 text-sm mb-4 flex items-center gap-2">
          <MessageSquare size={16} style={{ color: "#5C0102" }} /> My Complaint History
        </h3>
        {myComplaints.length === 0 ? (
          <div className="text-center py-10">
            <AlertCircle size={32} className="mx-auto mb-2 text-gray-300" />
            <p className="text-gray-400 text-sm">You have not filed any complaints yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myComplaints.map((complaint) => (
              <div key={complaint.id} className="border border-gray-100 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-gray-900 text-sm font-medium">{complaint.subject}</h4>
                    {getStatusBadge(complaint.status)}
                  </div>
                  <span className="text-xs text-gray-400">Filed {complaint.submittedAt}</span>
                </div>
                <p className="text-xs text-gray-600 mb-2">{complaint.description}</p>
                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  {complaint.incidentDate && <span>Incident date: <strong className="text-gray-600">{complaint.incidentDate}</strong></span>}
                  {complaint.resolvedAt && <span>Resolved: <strong className="text-gray-600">{complaint.resolvedAt}</strong></span>}
                </div>
                {complaint.status === "rejected" && complaint.rejectionReason && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-100">
                    <div className="text-xs font-medium text-red-800 mb-0.5">Rejection reason</div>
                    <p className="text-xs text-red-700">{complaint.rejectionReason}</p>
                  </div>
                )}
                {complaint.status === "accepted" && (
                  <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-100">
                    <div className="text-xs font-medium text-green-800 mb-0.5">{statusMeta(complaint.status).label}</div>
                    <p className="text-xs text-green-700">Your complaint was reviewed and accepted by the Commissioner of Grievance.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}