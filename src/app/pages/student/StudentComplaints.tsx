import { useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Send, Clock, CheckCircle, XCircle, CalendarDays, MessageSquare, Lock, Paperclip, Upload, X, Download } from "lucide-react";
import { useApp } from "../../context/AppContext";
import type { Complaint, ComplaintEvidence } from "../../context/AppContext";
import { insertComplaint, uploadComplaintEvidence } from "../../lib/supabaseData";
import { EvidenceFileThumb, EvidenceAttachment } from "../../components/EvidencePreview";
import { saveGrievanceFormDocx } from "../../lib/docxGrievanceForm";
import { statusMeta, sortFiledFirst, complaintWindowOpen, complaintsForElection, COMPLAINT_SUBJECTS, COMPLAINT_SUBJECT_OTHERS, resolveComplaintSubject, COMPLAINT_AGAINST_OPTIONS, COMPLAINT_AGAINST_OTHERS, resolveComplaintAgainst, COMPLAINT_CERTIFICATION, validateComplaintForm, formatSubmittedAt, validateEvidenceFiles, EVIDENCE_ACCEPT, EVIDENCE_MAX_FILES, EVIDENCE_TYPES_LABEL } from "../../lib/complaints";
import type { ComplaintFormErrors } from "../../lib/complaints";

/** Human-readable evidence size for the attachment chips. */
const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
};

export default function StudentComplaints() {
  const { complaints, setComplaints, currentUser, addLog, electionPeriod, students } = useApp();
  const [complaintAgainst, setComplaintAgainst] = useState("");
  const [otherAgainst, setOtherAgainst] = useState("");
  const [subject, setSubject] = useState("");
  const [otherSubject, setOtherSubject] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [certified, setCertified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ComplaintFormErrors>({});
  // 096: optional supporting-evidence files picked for the next complaint.
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [evidenceError, setEvidenceError] = useState("");
  // The complaint whose grievance form is currently being generated.
  const [generatingForm, setGeneratingForm] = useState<string | null>(null);

  // 089: the filing window opens at the campaign stage and closes as soon as
  // voting ends; complaints also only ever show for their own election.
  const windowOpen = complaintWindowOpen(electionPeriod);
  const myComplaints = sortFiledFirst(complaintsForElection(complaints, electionPeriod.id));

  const getStatusBadge = (status: string) => {
    const meta = statusMeta(status as Complaint["status"]);
    return (
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 w-fit ${TONE_CLASSES[meta.tone]}`}>
        {status === "accepted" ? <CheckCircle size={11} /> : status === "rejected" ? <XCircle size={11} /> : <Clock size={11} />}
        {meta.label}
      </span>
    );
  };

  // Clear a single field's error as soon as the student edits it.
  const clearFieldError = (field: keyof ComplaintFormErrors) =>
    setFieldErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });

  // 096: append freshly picked files after validating them against the cap,
  // type, and size limits (the bucket enforces the same on upload).
  const handleEvidenceSelect = (picked: File[]) => {
    if (picked.length === 0) return;
    const problem = validateEvidenceFiles(picked, evidenceFiles.length);
    if (problem) {
      setEvidenceError(problem);
      return;
    }
    setEvidenceError("");
    setEvidenceFiles((previous) => [...previous, ...picked]);
  };

  const removeEvidenceFile = (index: number) => {
    setEvidenceError("");
    setEvidenceFiles((previous) => previous.filter((_, i) => i !== index));
  };

  // Generates and downloads the filled Grievance Form
  // (CNNHS-Grievance-Form-for-SSLG-Elections.docx) for this filed complaint.
  const handleDownloadGrievanceForm = async (complaint: Complaint) => {
    setGeneratingForm(complaint.id);
    try {
      await saveGrievanceFormDocx({
        complaint,
        complainantName: currentUser?.name,
        complainantEmail: currentUser?.email,
        complainantBirthdate: students.find((s) => s.id === currentUser?.id)?.birthdate,
        schoolYear: electionPeriod.schoolYear,
      });
    } catch (err) {
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Grievance Form Download Failed",
        details: err instanceof Error ? err.message : "Failed to generate the grievance form",
        type: "error",
      });
    }
    setGeneratingForm(null);
  };

  const resetEvidence = () => {
    setEvidenceFiles([]);
    setEvidenceError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.id) return;
    const nextErrors = validateComplaintForm({ complaintAgainst, otherAgainst, subject, otherSubject, description, incidentDate, certified });
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSuccess("");
      setError("Please complete the required fields highlighted below.");
      return;
    }
    const evidenceProblem = evidenceFiles.length > 0 ? validateEvidenceFiles(evidenceFiles) : null;
    if (evidenceProblem) {
      setEvidenceError(evidenceProblem);
      setSuccess("");
      setError("Please fix the supporting evidence and try again.");
      return;
    }
    const resolvedSubject = resolveComplaintSubject(subject, otherSubject);
    const resolvedAgainst = resolveComplaintAgainst(complaintAgainst, otherAgainst);
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      // 096: upload every picked file first, then file the complaint with
      // the resulting attachment URLs (one INSERT, no orphaned complaint).
      const evidence: ComplaintEvidence[] = [];
      for (const file of evidenceFiles) {
        evidence.push(await uploadComplaintEvidence(file, `complaint_${currentUser.id}`));
      }
      const row = await insertComplaint({
        studentId: currentUser.id,
        title: resolvedSubject,
        description: description.trim(),
        incidentDate,
        complaintAgainst: resolvedAgainst,
        evidence,
      });
      setComplaints([row, ...complaints]);
      setComplaintAgainst("");
      setOtherAgainst("");
      setSubject("");
      setOtherSubject("");
      setDescription("");
      setIncidentDate("");
      setCertified(false);
      setFieldErrors({});
      resetEvidence();
      setSuccess("Your complaint has been filed and is now awaiting review by the Commissioner of Grievance.");
      addLog({
        user: currentUser?.name || "Student",
        role: "Student",
        action: "Filed Complaint",
        details: `Filed complaint "${resolvedSubject}"`,
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
        <p className="text-gray-500 text-sm">File a complaint about the current election or track the complaints you have filed for it.</p>
      </motion.div>

      {/* Submit form */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-8">
        <h3 className="text-gray-900 text-sm mb-4 flex items-center gap-2">
          <AlertCircle size={16} style={{ color: "#5C0102" }} /> File a Complaint
        </h3>
        {windowOpen ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="complaint-against" className="block text-xs font-medium text-gray-500 mb-1">Complaint Against</label>
            <div className="flex gap-2">
              <select
                id="complaint-against"
                value={complaintAgainst}
                onChange={(e) => { setComplaintAgainst(e.target.value); clearFieldError("complaintAgainst"); }}
                aria-invalid={Boolean(fieldErrors.complaintAgainst)}
                className={`px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] ${
                  complaintAgainst === COMPLAINT_AGAINST_OTHERS ? "w-2/5 shrink-0" : "w-full"
                }`}
              >
                <option value="" disabled>Select who the complaint is against...</option>
                {COMPLAINT_AGAINST_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {complaintAgainst === COMPLAINT_AGAINST_OTHERS && (
                <input
                  type="text"
                  value={otherAgainst}
                  onChange={(e) => { setOtherAgainst(e.target.value); clearFieldError("complaintAgainst"); }}
                  placeholder="Please specify"
                  maxLength={200}
                  aria-invalid={Boolean(fieldErrors.complaintAgainst)}
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
                />
              )}
            </div>
            {fieldErrors.complaintAgainst && <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors.complaintAgainst}</p>}
          </div>
          <div>
            <label htmlFor="complaint-subject" className="block text-xs font-medium text-gray-500 mb-1">Nature of Complaint</label>
            <div className="flex gap-2">
              <select
                id="complaint-subject"
                value={subject}
                onChange={(e) => { setSubject(e.target.value); clearFieldError("subject"); }}
                aria-invalid={Boolean(fieldErrors.subject)}
                className={`px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] ${
                  subject === COMPLAINT_SUBJECT_OTHERS ? "w-2/5 shrink-0" : "w-full"
                }`}
              >
                <option value="" disabled>Select the nature of the complaint...</option>
                {COMPLAINT_SUBJECTS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {subject === COMPLAINT_SUBJECT_OTHERS && (
                <input
                  type="text"
                  value={otherSubject}
                  onChange={(e) => { setOtherSubject(e.target.value); clearFieldError("subject"); }}
                  placeholder="Please specify"
                  maxLength={200}
                  aria-invalid={Boolean(fieldErrors.subject)}
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
                />
              )}
            </div>
            {fieldErrors.subject && <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors.subject}</p>}
          </div>
          <div>
            <label htmlFor="complaint-description" className="block text-xs font-medium text-gray-500 mb-1">Narrative Report</label>
            <textarea
              id="complaint-description"
              value={description}
              onChange={(e) => { setDescription(e.target.value); clearFieldError("description"); }}
              placeholder="Narrate what happened, including any people involved and when..."
              rows={4}
              maxLength={2000}
              aria-invalid={Boolean(fieldErrors.description)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
            />
            {fieldErrors.description && <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>}
          </div>
          <div>
            <label htmlFor="complaint-incident-date" className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
              <CalendarDays size={12} /> Date of Incident
            </label>
            <input
              id="complaint-incident-date"
              type="date"
              value={incidentDate}
              onChange={(e) => { setIncidentDate(e.target.value); clearFieldError("incidentDate"); }}
              aria-invalid={Boolean(fieldErrors.incidentDate)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102]"
            />
            {fieldErrors.incidentDate && <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors.incidentDate}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
              <Paperclip size={12} /> Supporting Evidence (optional)
            </label>
            <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 cursor-pointer hover:border-[#5C0102] hover:text-[#5C0102] transition-colors">
              <Upload size={13} /> Attach files
              <input
                type="file"
                multiple
                accept={EVIDENCE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  handleEvidenceSelect(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <span className="ml-2 text-xs text-gray-400">Up to {EVIDENCE_MAX_FILES} files · {EVIDENCE_TYPES_LABEL} · max 10 MB each</span>
            {evidenceFiles.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {evidenceFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                    <EvidenceFileThumb file={file} size={36} />
                    <span className="text-gray-700 truncate flex-1">{file.name}</span>
                    <span className="text-gray-400 shrink-0">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeEvidenceFile(index)}
                      aria-label={`Remove ${file.name}`}
                      className="text-gray-400 hover:text-red-600 shrink-0"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {evidenceError && <p role="alert" className="mt-1 text-xs text-red-600">{evidenceError}</p>}
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 p-3">
            <input
              id="complaint-certify"
              type="checkbox"
              checked={certified}
              onChange={(e) => { setCertified(e.target.checked); clearFieldError("certified"); }}
              aria-invalid={Boolean(fieldErrors.certified)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#5C0102]"
            />
            <label htmlFor="complaint-certify" className="text-xs text-gray-600 leading-relaxed">
              {COMPLAINT_CERTIFICATION}
            </label>
          </div>
          {fieldErrors.certified && <p role="alert" className="text-xs text-red-600">{fieldErrors.certified}</p>}
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
        ) : (
          <div className="flex items-start gap-3 py-4">
            <Lock size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <div>
              <div className="text-sm font-medium text-gray-700">The complaint window for this election has closed.</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Complaints could be filed from the campaign period until voting ended. You can still review the complaints you filed below.
              </div>
            </div>
          </div>
        )}
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
                  <span className="text-xs text-gray-400">Filed {formatSubmittedAt(complaint)}</span>
                </div>
                {complaint.complaintAgainst && (
                  <p className="text-xs text-gray-500 mb-1">Against: <strong className="text-gray-700">{complaint.complaintAgainst}</strong></p>
                )}
                <p className="text-xs text-gray-600 mb-2">{complaint.description}</p>
                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  {complaint.incidentDate && <span>Incident date: <strong className="text-gray-600">{complaint.incidentDate}</strong></span>}
                  {complaint.resolvedAt && <span>Resolved: <strong className="text-gray-600">{complaint.resolvedAt}</strong></span>}
                </div>
                {complaint.evidence && complaint.evidence.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                      <Paperclip size={11} /> Supporting evidence
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
                {complaint.status === "accepted" && (
                  <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-100">
                    <div className="text-xs font-medium text-green-800 mb-0.5">{statusMeta(complaint.status).label}</div>
                    <p className="text-xs text-green-700 mb-2">
                      Your complaint was reviewed and resolved by the Commissioner of Grievance
                      {complaint.resolvedByName ? ` — ${complaint.resolvedByName}` : ""}.
                    </p>
                    {complaint.findings && (
                      <>
                        <div className="text-xs font-medium text-green-800 mb-0.5 uppercase tracking-wide">Findings</div>
                        <p className="text-xs text-green-900 whitespace-pre-wrap mb-3">{complaint.findings}</p>
                      </>
                    )}
                    {complaint.findingsEvidence && complaint.findingsEvidence.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-medium text-green-800 mb-1.5 flex items-center gap-1">
                          <Paperclip size={11} /> Evidence from the Commission
                        </div>
                        <ul className="space-y-1.5">
                          {complaint.findingsEvidence.map((item, index) => (
                            <li key={`${item.url}-${index}`}>
                              <EvidenceAttachment item={item} linkClassName="text-xs text-green-800 underline" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={() => handleDownloadGrievanceForm(complaint)}
                    disabled={generatingForm === complaint.id}
                    aria-label="Download CNNHS-Grievance-Form-for-SSLG-Elections.docx"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <Download size={12} />
                    {generatingForm === complaint.id ? "Preparing..." : "Grievance Form"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}