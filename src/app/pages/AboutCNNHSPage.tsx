import { motion } from "motion/react";
import {
  Building2, Eye, Flag, Target,
} from "lucide-react";
import { useApp, defaultHomepageSettings } from "../context/AppContext";

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
              <Building2 size={32} className="flex-shrink-0" />
              <span>About CNNHS</span>
            </h1>
            <p className="text-white/75 mt-2">
              A brief look at the school and the values that guide it.
            </p>
          </div>
        </motion.div>

        {/* Brief school information */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-6">
          <h2 className="text-lg text-gray-900 font-medium">Camarines Norte National High School</h2>
          {briefInfo.split("\n").filter((line) => line.trim() !== "").map((line, i) => (
            <p key={i} className="text-gray-600 text-sm leading-relaxed mt-2 whitespace-pre-wrap">
              {line}
            </p>
          ))}
        </div>

        {/* DepEd Vision */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-6">
          <h2 className="text-lg text-gray-900 font-medium flex items-center gap-2 mb-3">
            <Eye size={18} style={{ color: "#5C0102" }} /> DepEd Vision
          </h2>
          {vision.split("\n").filter((line) => line.trim() !== "").map((line, i) => (
            <p key={i} className={`text-gray-600 text-sm leading-relaxed whitespace-pre-wrap ${i === 0 ? "" : "mt-3"}`}>
              {line}
            </p>
          ))}
        </div>

        {/* DepEd Mission */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-6">
          <h2 className="text-lg text-gray-900 font-medium flex items-center gap-2 mb-3">
            <Target size={18} style={{ color: "#5C0102" }} /> DepEd Mission
          </h2>
          {missionParagraphs.map((line, i) => (
            <p key={i} className={`text-gray-600 text-sm leading-relaxed whitespace-pre-wrap ${i === 0 ? "" : "mt-3"}`}>
              {line}
            </p>
          ))}
          {missionBullets.length > 0 && (
            <ul className="mt-3 space-y-2.5">
              {missionBullets.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#5C0102" }} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Core Values */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <h2 className="text-lg text-gray-900 font-medium flex items-center gap-2 mb-4">
            <Flag size={18} style={{ color: "#5C0102" }} /> Our Core Values
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {coreValues.map((value) => (
              <div key={value.title} className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                <p className="font-medium" style={{ color: "#5C0102" }}>{value.title}</p>
                {value.gloss && <p className="text-gray-500 text-sm mt-0.5">{value.gloss}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
