import { motion, AnimatePresence } from "motion/react";
import { Link } from "react-router";
import { useApp, Candidate } from "../../context/AppContext";
import { Archive, FileText, Download, Search, Eye, Clock, CheckCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

// One row of the archive list.  It carries the SOURCE record (not just its
// title) so the preview modal can render the actual documents — the display
// fields below are what the list itself needs.
//
// 092: this page is now candidacy documents only — complaint records moved
// to the dedicated Complaints Archive (/admin/complaints-archive).
interface ArchivedDoc {
  id: string;
  title: string;
  type: "Candidacy Document";
  date: string;
  student: string;
  candidate: Candidate;
}

export default function AdminArchive() {
  // Candidacy documents from every election: the live period's rows plus the
  // archived ones.  Everywhere else in the app `candidates` is scoped to the
  // live period only; this page is the deliberate exception, since an archive
  // that only holds the current election is not an archive.
  const { candidates, archivedCandidates } = useApp();
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<ArchivedDoc | null>(null);

  // A pending application is the one thing this archive cannot answer —
  // send the commissioner back to the live review surface instead.
  const pendingCount = candidates.filter((c) => c.status === "pending").length;

  const archivedDocs: ArchivedDoc[] = [
    ...[...candidates, ...archivedCandidates]
      .filter((c) => c.documents.applicationForm)
      .map<ArchivedDoc>((c) => ({
        id: c.id,
        title: `Application - ${c.givenName} ${c.surname}`,
        type: "Candidacy Document",
        date: c.submittedAt,
        student: `${c.givenName} ${c.surname}`,
        candidate: c,
      })),
  ].filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.student.toLowerCase().includes(search.toLowerCase())
  );

  // Escape closes the preview (the backdrop click does too).
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Candidates Archived Document</h1>
        <p className="text-gray-500 text-sm">Archived candidacy documents from every election.</p>
      </motion.div>

      {/* Pending notification — archived records can't be reviewed, so point
          back to Candidate Review with the pending filter applied. */}
      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
              <Clock size={16} /> {pendingCount} candidate application(s) pending review
            </div>
            <Link
              to="/admin/candidates?filter=pending"
              className="w-fit px-4 py-2 rounded-lg text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#5C0102" }}
            >
              Review now
            </Link>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search archived documents..."
            className="w-full bg-transparent outline-none text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
        {archivedDocs.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Archive size={20} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-500">No archived documents found.</p>
          </div>
        ) : archivedDocs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer"
            onClick={() => setPreview(doc)}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                <FileText size={16} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">{doc.title}</div>
                <div className="text-xs text-gray-500">{doc.type} · {doc.date} · {doc.student}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview(doc);
                }}
                className="p-2 text-gray-400 hover:text-[#5C0102] rounded-lg hover:bg-gray-100 transition-colors"
                title="Preview"
              >
                <Eye size={16} />
              </button>
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-2 text-gray-400 hover:text-[#5C0102] rounded-lg hover:bg-gray-100 transition-colors"
                title="Download"
              >
                <Download size={16} />
              </button>
            </div>
          </div>
        ))}
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
                    <FileText size={13} /> {preview.type}
                  </div>
                  <h3 className="text-white">{preview.title}</h3>
                  <p className="text-white/70 text-xs mt-0.5">{preview.date}</p>
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                  title="Close"
                >
                  <XCircle size={18} />
                </button>
              </div>

              <div className="p-5 space-y-5 text-sm">
                <CandidacyPreview candidate={preview.candidate} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status }: { status: Candidate["status"] }) {
  if (status === "approved")
    return (
      <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1 w-fit">
        <CheckCircle size={11} /> Approved
      </span>
    );
  if (status === "rejected")
    return (
      <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium flex items-center gap-1 w-fit">
        <XCircle size={11} /> Rejected
      </span>
    );
  if (status === "ongoingSubmission")
    return (
      <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium flex items-center gap-1 w-fit">
        <Clock size={11} /> Ongoing Submission
      </span>
    );
  return (
    <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1 w-fit">
      <Clock size={11} /> Pending
    </span>
  );
}

// The archive's answer to "what did this candidate actually file?" — only the
// EAF photos are real uploaded files; every other document is a yes/no
// checklist flag, so it is rendered as a checklist rather than a file.
// The EAF covers the old Application/Screening/Report Card/Good Moral list —
// those are all sections of the EAF itself, so only the EAF flag remains.
function CandidacyPreview({ candidate }: { candidate: Candidate }) {
  const docs: { label: string; present: boolean }[] = [
    { label: "EAF (Election Application Form)", present: candidate.documents.applicationForm },
    { label: "Introductory Profile", present: candidate.documents.introductoryProfile },
    { label: "EAF Front", present: !!candidate.eafFrontImage || !!candidate.documents.eafFront },
    { label: "EAF Back", present: !!candidate.eafBackImage || !!candidate.documents.eafBack },
  ];
  const complete = docs.filter((d) => d.present).length;

  return (
    <>
      <div className="flex items-start gap-4">
        {candidate.picture ? (
          <img
            src={candidate.picture}
            alt=""
            className="w-16 h-16 rounded-full object-cover border-4 border-gray-100 flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-xl font-bold text-gray-500 flex-shrink-0">
            {candidate.givenName.charAt(0)}
          </div>
        )}
        <div>
          <div className="text-base font-semibold text-gray-900">
            {candidate.givenName} {candidate.middleName} {candidate.surname}
          </div>
          <div className="text-sm text-gray-600">{candidate.position}</div>
          <div className="text-xs text-gray-400">{candidate.partyAffiliation || "Independent"}</div>
          <div className="mt-1.5">
            <StatusBadge status={candidate.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          ["Grade Level", candidate.gradeLevel],
          ["Gender", candidate.gender],
          ["Age", `${candidate.age} years old`],
          ["Date of Birth", candidate.dateOfBirth],
          ["Email", candidate.email],
          ["Mobile", candidate.mobileNumber],
          ["Address", candidate.homeAddress],
          ["Date Submitted", candidate.submittedAt],
        ].map(([label, val]) => (
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-0.5">{label}</div>
            <div className="text-gray-800 font-medium text-xs break-all">{val}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Documents</div>
          <span className={`text-xs font-medium ${complete === docs.length ? "text-green-600" : "text-amber-600"}`}>
            {complete}/{docs.length} complete
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {docs.map((doc) => (
            <div
              key={doc.label}
              className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5"
            >
              <span className="text-xs text-gray-700">{doc.label}</span>
              {doc.present ? (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle size={13} /> Submitted
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <XCircle size={13} /> Not submitted
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {(candidate.eafFrontImage || candidate.eafBackImage) && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">EAF Photos</div>
          <div className="grid grid-cols-2 gap-3">
            {candidate.eafFrontImage && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Front side</div>
                <img
                  src={candidate.eafFrontImage}
                  alt="EAF Front"
                  className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => window.open(candidate.eafFrontImage, "_blank")}
                />
              </div>
            )}
            {candidate.eafBackImage && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Back side</div>
                <img
                  src={candidate.eafBackImage}
                  alt="EAF Back"
                  className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => window.open(candidate.eafBackImage, "_blank")}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
