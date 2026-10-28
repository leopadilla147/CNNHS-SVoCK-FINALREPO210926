import { Link } from "react-router";
import { motion } from "motion/react";
import { Shield, Users, Calendar, ChevronRight, Award } from "lucide-react";
import { useApp } from "../context/AppContext";
import { distinctPartyNames, FULL_POSITION_ORDER as POSITIONS } from "../lib/partyScope";
import cnnhsHero from "../assets/CNNHS1.jpg";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

export default function HomePage() {
  const { candidates, electionPeriod } = useApp();

  return (
    <div className="min-h-screen bg-white">
      {/* Enhanced Hero Section */}
      <section
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 50%, #3D0001 100%)" }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${cnnhsHero})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.15,
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <img src={cnnhsLogo} alt="CNNHS Logo" className="w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-6" />
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white px-4 py-1.5 rounded-full text-xs mb-6">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              {electionPeriod.isActive ? "Kiosk voting is active" : "Election portal open"}
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl text-white mb-4" style={{ fontWeight: 700 }}>
              Camarines Norte<br />National High School
            </h1>
            <p className="text-white/70 text-lg sm:text-xl mb-8 max-w-2xl mx-auto">
              Secure Online Elections for CNNHS Supreme Student Learner Government
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                to="/register"
                className="px-6 py-3 bg-white rounded-xl text-sm font-medium transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ color: "#5C0102" }}
              >
                Student Registration <ChevronRight size={16} className="inline" />
              </Link>
              <Link
                to="/current-election"
                className="px-6 py-3 border border-white/40 text-white rounded-xl text-sm font-medium hover:bg-white/10 transition-all"
              >
                Current Election
              </Link>
              <Link
                to="/official-results"
                className="px-6 py-3 border border-white/40 text-white rounded-xl text-sm font-medium hover:bg-white/10 transition-all"
              >
                Official Results
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="space-y-12">

        {/* Current Election Information Section */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="bg-white py-12 px-4">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-10">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <Shield size={20} style={{ color: "#5C0102" }} />
                  <span className="text-sm font-medium uppercase tracking-wider" style={{ color: "#5C0102" }}>Election Information</span>
                </div>
                <h2 className="text-gray-900 mb-2">Current Election Details</h2>
                <p className="text-gray-500 text-sm">Information about the ongoing SSLG election</p>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <Award size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Positions Contested</h3>
                  <p className="text-gray-600 text-sm">{POSITIONS.length} positions</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <Users size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Political Parties</h3>
                  <p className="text-gray-600 text-sm">
                    {distinctPartyNames(candidates).length} parties
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <Calendar size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Voting Day & Venue</h3>
                  <p className="text-gray-600 text-sm">
                    {electionPeriod.startDate ? `${electionPeriod.startDate}${electionPeriod.startTime ? ` at ${electionPeriod.startTime}` : ""}` : "To be announced"}
                  </p>
                  <p className="text-gray-500 text-xs mt-1">{electionPeriod.venue || "CNNHS Covered Court"}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <Shield size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Approved Candidates</h3>
                  <p className="text-gray-600 text-sm">{candidates.filter((c) => c.status === "approved").length} candidates</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Election Calendar Section */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <div className="bg-gray-50 py-12 px-4">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-10">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <Calendar size={20} style={{ color: "#5C0102" }} />
                  <span className="text-sm font-medium uppercase tracking-wider" style={{ color: "#5C0102" }}>Election Calendar</span>
                </div>
                <h2 className="text-gray-900 mb-2">Important Dates</h2>
                <p className="text-gray-500 text-sm">Key dates and deadlines for the SSLG election process</p>
              </div>

              <div className="space-y-8">
                {/* Timeline Items */}
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-2 h-2 rounded-full bg-[#5C0102] flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-gray-900 font-medium">Registration Period</h3>
                      <p className="text-gray-600 text-sm">{electionPeriod.startDate || "To be announced"}{electionPeriod.endDate && ` - ${electionPeriod.endDate}`}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-2 h-2 rounded-full bg-[#5C0102] flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-gray-900 font-medium">Candidacy Filing</h3>
                      <p className="text-gray-600 text-sm">{electionPeriod.startDate || "To be announced"}{electionPeriod.endDate && ` - ${electionPeriod.endDate}`}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-2 h-2 rounded-full bg-[#5C0102] flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-gray-900 font-muted">Voting Day</h3>
                      <p className="text-gray-600 text-sm">{electionPeriod.startDate || "To be announced"} {electionPeriod.startTime && `at ${electionPeriod.startTime}`}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-2 h-2 rounded-full bg-[#5C0102] flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-gray-900 font-medium">Results Publication</h3>
                      <p className="text-gray-600 text-sm">Within 48 hours after voting closes</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
