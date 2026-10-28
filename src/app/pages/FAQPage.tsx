import { useState } from "react";
import { motion } from "motion/react";
import { HelpCircle, Search, ChevronDown, ChevronRight, Mail, MapPin, Clock, LifeBuoy } from "lucide-react";
import { useApp, defaultHomepageSettings, formatOfficeTime } from "../context/AppContext";
import { helpDeskFaqs } from "../lib/helpDeskFaqs";

/**
 * The public FAQ page (Resources dropdown).  It shares its Q&A content with
 * the staff Election Help Desk through lib/helpDeskFaqs, and its "Need More
 * Help?" card reads the same Chief-editable Contact Us settings the footer
 * shows (migration 115).
 */
export default function FAQPage() {
  // Destructure default covers flat context stubs while the row loads.
  const { homepageSettings = defaultHomepageSettings } = useApp();
  const [search, setSearch] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const filtered = helpDeskFaqs.filter((item) =>
    item.q.toLowerCase().includes(search.toLowerCase()) ||
    item.a.toLowerCase().includes(search.toLowerCase())
  );

  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(homepageSettings.location)}`;

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden mb-8 text-white"
          style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
        >
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <h1 className="text-3xl sm:text-4xl font-semibold flex items-center gap-3">
              <HelpCircle size={32} className="flex-shrink-0" />
              <span>Frequently Asked Questions</span>
            </h1>
            <p className="text-white/75 mt-2">
              Quick answers about registration, candidacy, kiosk voting, and
              where to get help during the SSLG election.
            </p>
          </div>
        </motion.div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search FAQ..."
              aria-label="Search FAQ"
              className="w-full bg-transparent outline-none text-sm"
            />
          </div>
        </div>

        {/* Accordion */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 mb-6">
          {filtered.length === 0 ? (
            <div className="p-10 text-center">
              <LifeBuoy size={30} className="mx-auto mb-3 text-gray-400" />
              <p className="text-gray-900 text-sm font-medium">No matching questions</p>
              <p className="text-gray-500 text-sm mt-1">Try a different word, or reach out below.</p>
            </div>
          ) : (
            filtered.map((item, i) => (
              <div key={item.q}>
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  aria-expanded={openIndex === i}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-900">{item.q}</span>
                  {openIndex === i ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                </button>
                {openIndex === i && (
                  <div className="px-4 pb-4 text-sm text-gray-600">{item.a}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Need More Help? — the same Contact Us content the footer shows */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-gray-900 text-sm flex items-center gap-2 mb-4">
            <LifeBuoy size={16} style={{ color: "#5C0102" }} /> Need More Help?
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-gray-600">
            <a
              href={`mailto:${homepageSettings.contactEmail}`}
              className="flex items-center gap-2 hover:text-[#5C0102] transition-colors"
            >
              <Mail size={14} /> {homepageSettings.contactEmail}
            </a>
            <a
              href={mapsLink}
              target="_blank"
              rel="noreferrer"
              title="View on Google Maps"
              className="flex items-center gap-2 hover:text-[#5C0102] transition-colors"
            >
              <MapPin size={14} /> {homepageSettings.location}
            </a>
            <span className="flex items-center gap-2">
              <Clock size={14} /> Office Hours: {formatOfficeTime(homepageSettings.officeHoursStart)} - {formatOfficeTime(homepageSettings.officeHoursEnd)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
