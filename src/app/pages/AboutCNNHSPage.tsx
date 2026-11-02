import { motion } from "motion/react";
import {
  Building2,
  ExternalLink,
  Eye,
  Flag,
  MapPin,
  Sparkles,
  Target,
} from "lucide-react";
import { useApp, defaultHomepageSettings } from "../context/AppContext";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

/** Official school campus address */
const SCHOOL_OFFICIAL_LOCATION = "Brgy. Camambugan, Daet, Camarines Norte, Daet, Philippines, 4600";
const SCHOOL_MAPS_LINK = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  "Camarines Norte National High School, Brgy. Camambugan, Daet, Camarines Norte, 4600"
)}`;

/**
 * The public About CNNHS page (top header + footer).  A brief school
 * profile followed by the DepEd Vision, Mission, and Core Values — nothing
 * else.  119: the wording is editable Homepage Setting content — the Chief
 * Commissioner saves it under Homepage Setting; an empty field or an empty
 * Core Values list falls back to the school's shipped statement.
 */
export default function AboutCNNHSPage() {
  const { homepageSettings = defaultHomepageSettings } = useApp();

  const briefInfo = homepageSettings.briefInfo || defaultHomepageSettings.briefInfo;
  const vision = homepageSettings.vision || defaultHomepageSettings.vision;
  const mission = homepageSettings.mission || defaultHomepageSettings.mission;
  const coreValues = homepageSettings.coreValues?.length
    ? homepageSettings.coreValues
    : defaultHomepageSettings.coreValues;

  // Mission lines starting with the '•' bullet render as the styled bullet
  // list; every other line is a plain paragraph (blank lines are dropped).
  const missionParagraphs = mission.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("•"));
  const missionBullets = mission
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("•"))
    .map((line) => line.slice(1).trim());

  return (
    <div className="min-h-[70vh] bg-gray-50">

      {/* ── Hero Banner (High Visual Impact) ───────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden text-white shadow-2xl"
        style={{
          background: "linear-gradient(135deg, #4A0102 0%, #5C0102 35%, #8B0103 70%, #6B0203 100%)",
        }}
      >
        {/* Layered decorative ambient light glows */}
        <div
          className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-[0.09]"
          style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-28 -left-28 w-88 h-88 rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[300px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(ellipse, #ffffff 0%, transparent 80%)" }}
        />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-7 sm:gap-9">
            {/* School Crest Badge with double ring glow */}
            <div className="relative group">
              <div
                className="absolute -inset-1 rounded-3xl blur-md opacity-30 group-hover:opacity-50 transition duration-300"
                style={{ background: "linear-gradient(135deg, #ffffff, #8B0103)" }}
              />
              <div className="relative w-22 h-22 sm:w-28 sm:h-28 rounded-3xl bg-white/12 backdrop-blur-md border border-white/25 flex items-center justify-center flex-shrink-0 shadow-2xl p-3">
                <img
                  src={cnnhsLogo}
                  alt=""
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-contain drop-shadow-md"
                />
              </div>
            </div>

            <div className="text-center sm:text-left flex-1">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/12 backdrop-blur-md border border-white/20 text-xs font-semibold tracking-wider uppercase mb-4 text-white/95 shadow-xs">
                <Building2 size={13} />
                Official School Profile
              </div>
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight">
                About CNNHS
              </h1>
              <p className="text-white/80 mt-3.5 text-base sm:text-lg max-w-2xl leading-relaxed font-normal">
                A brief look at the school and the values that guide it.
              </p>

              {/* Quick institutional info pill tags */}
              <div className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-2.5 text-xs text-white/75 font-medium">
                <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15">
                  DepEd Region V
                </span>
                <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15">
                  Division of Camarines Norte
                </span>
                <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15">
                  Daet, Philippines
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Content Container ───────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-10">

        {/* ── Brief School Information & Official Location Card ─────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-10 relative overflow-hidden">
            {/* Top decorative gradient line */}
            <div
              className="absolute top-0 left-0 right-0 h-1.5"
              style={{ background: "linear-gradient(90deg, #5C0102, #8B0103, #6B0203)" }}
            />

            {/* School Title Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
              <div className="flex items-start gap-4">
                <div
                  className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0 border border-gray-100 shadow-sm"
                  style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
                >
                  <Building2 size={24} />
                </div>
                <div>
                  <div
                    className="text-xs font-semibold uppercase tracking-wider mb-1"
                    style={{ color: "#5C0102" }}
                  >
                    Public Secondary Institution
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
                    Camarines Norte National High School
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
                    Department of Education · Division of Camarines Norte
                  </p>
                </div>
              </div>
            </div>

            {/* ── Official School Location Box ──────────────────────── */}
            <div
              className="rounded-2xl p-5 sm:p-6 mb-8 border border-gray-100 shadow-xs"
              style={{ backgroundColor: "rgba(92, 1, 2, 0.02)" }}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-sm mt-0.5"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    <MapPin size={20} />
                  </div>
                  <div className="min-w-0">
                    <span
                      className="inline-block text-[11px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: "#5C0102" }}
                    >
                      Official School Location
                    </span>
                    <p className="text-gray-900 font-semibold text-sm sm:text-base leading-snug">
                      {SCHOOL_OFFICIAL_LOCATION}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="px-2.5 py-0.5 rounded-md bg-white border border-gray-200 font-medium">
                        Brgy. Camambugan
                      </span>
                      <span className="px-2.5 py-0.5 rounded-md bg-white border border-gray-200 font-medium">
                        Daet, Camarines Norte
                      </span>
                      <span className="px-2.5 py-0.5 rounded-md bg-white border border-gray-200 font-medium">
                        Postal Code: 4600
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex-shrink-0 pt-2 md:pt-0 pl-14 md:pl-0">
                  <a
                    href={SCHOOL_MAPS_LINK}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white transition-opacity hover:opacity-90 shadow-sm"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    <span>View on Google Maps</span>
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </div>

            {/* Narrative overview paragraph */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                About the Institution
              </div>
              {briefInfo.split("\n").filter((line) => line.trim() !== "").map((line, i) => (
                <p key={i} className="text-gray-700 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                  {line}
                </p>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── DepEd Vision & Mission Grid ──────────────────────────── */}
        <div className="grid lg:grid-cols-2 gap-8">

          {/* DepEd Vision */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-9 h-full relative overflow-hidden flex flex-col justify-between">
              {/* Decorative top accent */}
              <div
                className="absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl"
                style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
              />

              <div>
                <div className="flex items-center gap-3.5 mb-6 pt-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border border-gray-100 shadow-sm"
                    style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
                  >
                    <Eye size={22} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#5C0102" }}>
                      Department of Education
                    </p>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                      DepEd Vision
                    </h2>
                  </div>
                </div>

                <div className="space-y-3.5">
                  {vision.split("\n").filter((line) => line.trim() !== "").map((line, i) => (
                    <p key={i} className="text-gray-600 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* DepEd Mission */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-9 h-full relative overflow-hidden flex flex-col justify-between">
              {/* Decorative top accent */}
              <div
                className="absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl"
                style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
              />

              <div>
                <div className="flex items-center gap-3.5 mb-6 pt-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border border-gray-100 shadow-sm"
                    style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
                  >
                    <Target size={22} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#5C0102" }}>
                      Department of Education
                    </p>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                      DepEd Mission
                    </h2>
                  </div>
                </div>

                <div className="space-y-3.5">
                  {missionParagraphs.map((line, i) => (
                    <p key={i} className="text-gray-600 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                      {line}
                    </p>
                  ))}
                </div>
                {missionBullets.length > 0 && (
                  <ul className="mt-5 space-y-3.5">
                    {missionBullets.map((line) => (
                      <li key={line} className="flex items-start gap-3.5 text-sm sm:text-base text-gray-600">
                        <span
                          className="mt-2 w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: "#5C0102" }}
                        />
                        <span className="leading-relaxed">{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Core Values Section ──────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-10 relative overflow-hidden">
            {/* Top decorative gradient line */}
            <div
              className="absolute top-0 left-0 right-0 h-1.5"
              style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
            />

            <div className="text-center mb-10 pt-2">
              <div
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-3.5"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
              >
                <Sparkles size={13} />
                Guiding Principles
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight flex items-center justify-center gap-2.5">
                <Flag size={24} style={{ color: "#5C0102" }} />
                Our Core Values
              </h2>
              <p className="text-gray-500 text-sm sm:text-base mt-2 max-w-lg mx-auto">
                The four national pillars that shape and guide every Filipino learner.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {coreValues.map((value, i) => (
                <motion.div
                  key={value.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.5 + 0.08 * i }}
                  className="group relative rounded-2xl border border-gray-100 p-6 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1.5 overflow-hidden"
                  style={{ backgroundColor: "rgba(92, 1, 2, 0.02)" }}
                >
                  {/* Hover accent bottom line */}
                  <div
                    className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                  />

                  {/* Numbered Monogram Badge */}
                  <div
                    className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center text-base font-bold transition-all duration-300 group-hover:scale-110 shadow-xs"
                    style={{
                      backgroundColor: "rgba(92, 1, 2, 0.08)",
                      color: "#5C0102",
                    }}
                  >
                    <span>{value.title.charAt(0)}</span>
                  </div>

                  <p className="font-bold text-gray-900 text-base sm:text-lg group-hover:text-[#5C0102] transition-colors duration-200">
                    {value.title}
                  </p>
                  {value.gloss && (
                    <p className="text-gray-500 text-xs sm:text-sm mt-1.5 font-medium leading-relaxed">
                      {value.gloss}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
