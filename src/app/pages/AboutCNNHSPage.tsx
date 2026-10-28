import { motion } from "motion/react";
import {
  Building2, Eye, Flag, Target,
} from "lucide-react";

/**
 * The public About CNNHS page (top header + footer).  A brief school
 * profile followed by the DepEd Vision, Mission, and Core Values — nothing
 * else.  The Vision/Mission wording follows the official DepEd statement.
 */
export default function AboutCNNHSPage() {
  const coreValues = [
    { title: "Maka-Diyos", gloss: "Love for God" },
    { title: "Maka-Tao", gloss: "Love for Fellowmen" },
    { title: "Maka-Kalikasan", gloss: "Love for Nature" },
    { title: "Maka-Bansa", gloss: "Love for Country" },
  ];

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
          <p className="text-gray-600 text-sm leading-relaxed mt-2">
            CNNHS is a public secondary school in Daet, Camarines Norte, serving
            its learner community under the Department of Education. The school
            upholds the DepEd Vision, Mission, and Core Values in everything it
            does — including the election of its learner leaders.
          </p>
        </div>

        {/* DepEd Vision */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-6">
          <h2 className="text-lg text-gray-900 font-medium flex items-center gap-2 mb-3">
            <Eye size={18} style={{ color: "#5C0102" }} /> DepEd Vision
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            We dream of Filipinos who passionately love their country and whose
            values and competencies enable them to realize their full potential
            and contribute meaningfully to building the nation.
          </p>
          <p className="text-gray-600 text-sm leading-relaxed mt-3">
            As a learner-centered public institution, the Department of
            Education continuously improves itself to better serve its
            stakeholders.
          </p>
        </div>

        {/* DepEd Mission */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-6">
          <h2 className="text-lg text-gray-900 font-medium flex items-center gap-2 mb-3">
            <Target size={18} style={{ color: "#5C0102" }} /> DepEd Mission
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            To protect and promote the right of every Filipino to quality,
            equitable, culture-based, and complete basic education where:
          </p>
          <ul className="mt-3 space-y-2.5">
            {[
              "Students learn in a child-friendly, gender-sensitive, safe, and motivating environment.",
              "Teachers facilitate learning and constantly nurture every learner.",
              "Administrators and staff, as stewards of the institution, ensure an enabling and supportive environment for effective learning to happen.",
              "Family, community, and other stakeholders are actively engaged and share responsibility for developing lifelong learners.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-gray-600">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#5C0102" }} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
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
                <p className="text-gray-500 text-sm mt-0.5">{value.gloss}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
