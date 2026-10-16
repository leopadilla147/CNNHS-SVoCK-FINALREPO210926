import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { Archive, FileText, Download, Search, Filter } from "lucide-react";
import { useState } from "react";

export default function AdminArchive() {
  // Candidacy documents from every election: the live period's rows plus the
  // archived ones.  Everywhere else in the app `candidates` is scoped to the
  // live period only; this page is the deliberate exception, since an archive
  // that only holds the current election is not an archive.
  const { candidates, archivedCandidates, complaints } = useApp();
  const [search, setSearch] = useState("");

  const archivedDocs = [
    ...[...candidates, ...archivedCandidates]
      .filter((c) => c.documents.applicationForm || c.documents.reportCard)
      .map((c) => ({
      id: c.id,
      title: `Application - ${c.givenName} ${c.surname}`,
      type: "Candidacy Document",
      date: c.submittedAt,
      student: `${c.givenName} ${c.surname}`,
    })),
    ...complaints.filter((c) => c.status === "accepted" || c.status === "rejected").map((c) => ({
      id: c.id,
      title: c.subject,
      type: "Complaint Record",
      date: c.resolvedAt || c.submittedAt,
      student: c.studentName,
    })),
  ].filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.student.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Archived Documents</h1>
        <p className="text-gray-500 text-sm">Archived candidacy documents and resolved complaint records.</p>
      </motion.div>

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
          <div key={doc.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                <FileText size={16} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">{doc.title}</div>
                <div className="text-xs text-gray-500">{doc.type} · {doc.date} · {doc.student}</div>
              </div>
            </div>
            <button className="p-2 text-gray-400 hover:text-[#5C0102] rounded-lg hover:bg-gray-100 transition-colors">
              <Download size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
