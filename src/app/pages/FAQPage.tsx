import { useState } from "react";
import { motion } from "motion/react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  HelpCircle,
  LifeBuoy,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Search,
  X,
} from "lucide-react";
import { useApp, defaultHomepageSettings, formatOfficeTime } from "../context/AppContext";
import { helpDeskFaqs } from "../lib/helpDeskFaqs";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">

        {/* ── Hero Banner ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl overflow-hidden mb-8 sm:mb-10 text-white shadow-xl"
          style={{
            background: "linear-gradient(135deg, #5C0102 0%, #8B0103 60%, #6B0203 100%)",
          }}
        >
          {/* Subtle decorative radial glows */}
          <div
            className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.08]"
            style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 w-80 h-80 rounded-full opacity-[0.05]"
            style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
          />

          <div className="relative px-6 py-8 sm:px-10 sm:py-12">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {/* School Seal */}
              <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center flex-shrink-0 shadow-lg p-2.5">
                <img
                  src={cnnhsLogo}
                  alt=""
                  className="w-13 h-13 sm:w-16 sm:h-16 rounded-full object-contain"
                />
              </div>

              <div className="text-center sm:text-left">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-medium tracking-wider uppercase mb-3.5 text-white/90">
                  <HelpCircle size={13} />
                  Help Center & Knowledge Base
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight">
                  Frequently Asked Questions
                </h1>
                <p className="text-white/75 mt-2.5 text-sm sm:text-base max-w-xl leading-relaxed">
                  Quick answers about registration, candidacy, kiosk voting, and
                  where to get help during the SSLG election.
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Search Bar Card ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 p-3 sm:p-4 mb-8"
        >
          <div className="flex items-center gap-3 bg-gray-50/80 border border-gray-200/80 rounded-xl px-4 py-3 focus-within:border-[#5C0102]/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-[#5C0102]/10 transition-all duration-200">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "rgba(92, 1, 2, 0.08)", color: "#5C0102" }}
            >
              <Search size={16} />
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions by topic, keyword, or rule..."
              aria-label="Search FAQ"
              className="w-full bg-transparent outline-none text-sm sm:text-base text-gray-900 placeholder:text-gray-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
            <span className="hidden sm:inline-block text-xs font-medium text-gray-400 border-l border-gray-200 pl-3 shrink-0">
              {filtered.length} {filtered.length === 1 ? "question" : "questions"}
            </span>
          </div>
        </motion.div>

        {/* ── Accordion List ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.2 }}
          className="bg-white rounded-3xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden mb-10"
        >
          {filtered.length === 0 ? (
            <div className="p-12 sm:p-16 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-gray-100 shadow-sm"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
              >
                <LifeBuoy size={32} />
              </div>
              <h2 className="text-gray-900 text-lg font-semibold tracking-tight">
                No matching questions
              </h2>
              <p className="text-gray-500 text-sm mt-1 max-w-sm mx-auto leading-relaxed">
                Try a different word, or reach out below.
              </p>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-4 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90 shadow-sm"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  Clear search query
                </button>
              )}
            </div>
          ) : (
            filtered.map((item, i) => {
              const isOpen = openIndex === i;
              return (
                <div key={item.q} className="transition-colors">
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className={`w-full flex items-center justify-between p-5 sm:p-6 text-left transition-all duration-200 group ${
                      isOpen ? "bg-gray-50/70" : "hover:bg-gray-50/40"
                    }`}
                  >
                    <div className="flex items-start gap-4 pr-4 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold transition-colors ${
                          isOpen
                            ? "text-white"
                            : "group-hover:text-white"
                        }`}
                        style={{
                          backgroundColor: isOpen
                            ? "#5C0102"
                            : "rgba(92, 1, 2, 0.07)",
                          color: isOpen ? "#ffffff" : "#5C0102",
                        }}
                      >
                        <MessageCircleQuestion size={16} />
                      </div>
                      <span
                        className={`text-sm sm:text-base font-semibold leading-relaxed transition-colors ${
                          isOpen
                            ? "text-[#5C0102]"
                            : "text-gray-900 group-hover:text-[#5C0102]"
                        }`}
                      >
                        {item.q}
                      </span>
                    </div>

                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        isOpen
                          ? "text-white shadow-sm"
                          : "bg-gray-100 text-gray-500 group-hover:bg-gray-200"
                      }`}
                      style={{
                        backgroundColor: isOpen ? "#5C0102" : undefined,
                      }}
                    >
                      {isOpen ? (
                        <ChevronDown size={17} />
                      ) : (
                        <ChevronRight size={17} />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 sm:px-6 pb-6 pt-2 bg-gray-50/70">
                      <div className="pl-12 sm:pl-12 border-l-2 ml-4 border-[#5C0102]/20">
                        <p className="text-sm sm:text-base text-gray-600 leading-relaxed whitespace-pre-wrap">
                          {item.a}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </motion.div>

        {/* ── Need More Help Card ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 relative overflow-hidden"
        >
          {/* Top accent line */}
          <div
            className="absolute top-0 left-0 right-0 h-1.5"
            style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
          />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3.5">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border border-gray-100 shadow-sm"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
              >
                <LifeBuoy size={22} />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
                  Need More Help?
                </h2>
                <p className="text-gray-500 text-xs sm:text-sm mt-0.5">
                  Reach out directly to the election support team and committee.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 pt-2">
            {/* Email Contact */}
            <a
              href={`mailto:${homepageSettings.contactEmail}`}
              className="group flex items-start gap-3 p-4 rounded-2xl bg-gray-50/80 border border-gray-100 hover:border-[#5C0102]/20 hover:bg-gray-50 transition-all duration-200"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors group-hover:text-white"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.08)", color: "#5C0102" }}
              >
                <Mail size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Email Support
                </div>
                <div className="text-xs sm:text-sm font-semibold text-gray-900 truncate group-hover:text-[#5C0102] transition-colors mt-0.5">
                  {homepageSettings.contactEmail}
                </div>
              </div>
            </a>

            {/* School Location */}
            <a
              href={mapsLink}
              target="_blank"
              rel="noreferrer"
              title="View on Google Maps"
              className="group flex items-start gap-3 p-4 rounded-2xl bg-gray-50/80 border border-gray-100 hover:border-[#5C0102]/20 hover:bg-gray-50 transition-all duration-200"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors group-hover:text-white"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.08)", color: "#5C0102" }}
              >
                <MapPin size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Campus Location
                </div>
                <div className="text-xs sm:text-sm font-semibold text-gray-900 truncate group-hover:text-[#5C0102] transition-colors mt-0.5">
                  {homepageSettings.location}
                </div>
              </div>
            </a>

            {/* Office Hours */}
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-gray-50/80 border border-gray-100">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.08)", color: "#5C0102" }}
              >
                <Clock size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Service Hours
                </div>
                <div className="text-xs sm:text-sm font-semibold text-gray-900 mt-0.5">
                  Office Hours: {formatOfficeTime(homepageSettings.officeHoursStart)} - {formatOfficeTime(homepageSettings.officeHoursEnd)}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
