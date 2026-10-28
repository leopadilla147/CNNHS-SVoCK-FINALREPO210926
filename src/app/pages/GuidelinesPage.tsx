import { motion } from "motion/react";
import {
  BookOpenCheck, CheckCircle2, Download, FileText,
} from "lucide-react";
import { useApp, defaultHomepageSettings } from "../context/AppContext";

/**
 * The public Election Guidelines page (Resources dropdown).  The document
 * itself is uploaded by the Chief Commissioner under Homepage Setting
 * (migration 115) and lives in the homepage-files bucket; the footer's
 * Contact Us block is separate content from the same settings row.
 */
export default function GuidelinesPage() {
  // Destructure default covers flat context stubs while the row loads.
  const { homepageSettings = defaultHomepageSettings } = useApp();
  const guidelinesUrl = homepageSettings.guidelinesUrl;
  // Browsers render PDFs natively, so the file can be previewed inline;
  // DOC/DOCX get a download card only.
  const isPdf = (guidelinesUrl || "").toLowerCase().endsWith(".pdf");

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden mb-8 text-white"
          style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
        >
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <h1 className="text-3xl sm:text-4xl font-semibold flex items-center gap-3">
              <BookOpenCheck size={32} className="flex-shrink-0" />
              <span>Election Guidelines</span>
            </h1>
            <p className="text-white/75 mt-2">
              The document provides the official guidelines for implementing the
              Learner Government Program (LGP) in elementary and secondary schools.
            </p>
          </div>
        </motion.div>

        {/* The file */}
        {guidelinesUrl ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mt-8">
            <div className="flex flex-wrap items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0"
                style={{ color: "#5C0102" }}
              >
                <FileText size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg text-gray-900 truncate">
                  {homepageSettings.guidelinesName || "Election Guidelines"}
                </h2>
                <p className="text-gray-500 text-xs">
                  Official document · issued by the COMEA
                </p>
              </div>
              <a
                href={guidelinesUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#5C0102" }}
              >
                <Download size={14} /> Open Guidelines
              </a>
            </div>
            {isPdf && (
              <div className="mt-6 rounded-xl overflow-hidden border border-gray-200">
                <iframe
                  title="Election Guidelines document preview"
                  src={guidelinesUrl}
                  className="w-full h-[70vh] block"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mt-8 text-center py-14">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-5">
              <FileText size={36} className="text-gray-400" />
            </div>
            <h2 className="text-2xl text-gray-900 mb-2">No Guidelines Posted Yet</h2>
            <p className="text-gray-500 max-w-md mx-auto text-sm">
              The official Election Guidelines document will be posted here once
              the Chief Commissioner uploads it for the current election.
            </p>
            <p className="text-gray-400 text-xs mt-4 flex items-center justify-center gap-1.5">
              <CheckCircle2 size={12} /> Posted documents are final and official.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
