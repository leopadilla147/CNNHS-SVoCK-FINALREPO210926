import { Link } from "react-router";
import { motion } from "motion/react";
import { Shield, Users, Calendar, ChevronRight, Award, Megaphone, FileText, Vote, Trophy } from "lucide-react";
import { useApp } from "../context/AppContext";
import { distinctPartyNames, FULL_POSITION_ORDER as POSITIONS } from "../lib/partyScope";
import { applicationStageEnded } from "../lib/electionStage";
// The campaign window arrives as raw timestamptz strings; toDate trims them
// to the same YYYY-MM-DD display the other milestone cards use.
import { toDate } from "../lib/supabaseData";
import { HeroCarousel } from "../components/home/HeroCarousel";
import { getCalendarHref } from "../components/layout/roleNav";

/** The placeholder the three gated info cards share while their data is unset. */
function ToBeAnnounced() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
      To be announced
    </span>
  );
}

export default function HomePage() {
  const { currentUser, candidates, electionPeriod } = useApp();

  // The candidate and party cards are announced only after the Electoral
  // Board ENDS the Candidacy Application Stage (Stage 1) in Election Setup —
  // until then they read "To be announced" regardless of live applications.
  // Parties are counted from the approved set so pending or rejected
  // applications never leak onto the public homepage.
  const candidacyAnnounced = applicationStageEnded(electionPeriod);
  const approvedCandidates = candidates.filter((c) => c.status === "approved");
  const partyCount = distinctPartyNames(approvedCandidates).length;
  // Stage 4's Voting Schedule (election_date) is what unlocks the day & venue card.
  const votingScheduled = Boolean(electionPeriod.startDate);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section — rotating slider (welcome, registration, election, results) */}
      <HeroCarousel />

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
                    <Shield size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Approved Candidates</h3>
                  {/* Announced only once the Candidacy Application Stage (Stage 1) has ended. */}
                  {candidacyAnnounced ? (
                    <p className="text-gray-600 text-sm">{approvedCandidates.length} candidates</p>
                  ) : (
                    <ToBeAnnounced />
                  )}
                </div>
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <Users size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Political Parties</h3>
                  {/* Same Stage 1 gate, counted from approved candidates only. */}
                  {candidacyAnnounced ? (
                    <p className="text-gray-600 text-sm">{partyCount} parties</p>
                  ) : (
                    <ToBeAnnounced />
                  )}
                </div>
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <Calendar size={24} style={{ color: "#5C0102" }} />
                  </div>
                  <h3 className="text-gray-900 mb-2">Voting Day & Venue</h3>
                  {/* Appears only after the Stage 4 Voting Schedule is set — no
                      default venue leaks before then. */}
                  {votingScheduled ? (
                    <>
                      <p className="text-gray-600 text-sm">
                        {electionPeriod.startDate}
                        {electionPeriod.startTime ? ` at ${electionPeriod.startTime}` : ""}
                      </p>
                      <p className="text-gray-500 text-xs mt-1">{electionPeriod.venue || "CNNHS Covered Court"}</p>
                    </>
                  ) : (
                    <ToBeAnnounced />
                  )}
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
                <Link
                  to={getCalendarHref(currentUser)}
                  className="inline-flex items-center gap-1.5 mt-4 px-5 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  View Full Calendar <ChevronRight size={14} />
                </Link>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    step: "01",
                    icon: <FileText size={20} />,
                    title: "Candidacy Filing",
                    when: electionPeriod.startDate
                      ? `${electionPeriod.startDate}${electionPeriod.endDate ? ` – ${electionPeriod.endDate}` : ""}`
                      : "",
                    desc: "Aspiring candidates submit their application forms and supporting documents.",
                  },
                  {
                    step: "02",
                    icon: <Megaphone size={20} />,
                    title: "Campaign Period",
                    when: electionPeriod.campaignStartDate
                      ? `${toDate(electionPeriod.campaignStartDate)}${
                          electionPeriod.campaignEndDate ? ` – ${toDate(electionPeriod.campaignEndDate)}` : ""
                        }`
                      : "",
                    desc: "Official campaign activities — posters, rallies, and party pronouncements.",
                  },
                  {
                    step: "03",
                    icon: <Vote size={20} />,
                    title: "Voting Day",
                    when: electionPeriod.startDate
                      ? `${electionPeriod.startDate}${electionPeriod.startTime ? ` at ${electionPeriod.startTime}` : ""}`
                      : "",
                    desc: "Cast your ballot at the biometric kiosks — one scan, one secure vote.",
                  },
                  {
                    step: "04",
                    icon: <Trophy size={20} />,
                    title: "Results Publication",
                    when: "Within 48 hours after voting closes",
                    desc: "Official results are posted publicly once the vote is concluded.",
                  },
                ].map((milestone) => (
                  <div
                    key={milestone.step}
                    className="group relative bg-white rounded-2xl border border-gray-100 shadow-sm p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors group-hover:bg-[#5C0102]"
                        style={{ backgroundColor: "rgba(92, 1, 2, 0.08)", color: "#5C0102" }}
                      >
                        {milestone.icon}
                      </div>
                      <span
                        className="text-3xl font-bold select-none transition-colors group-hover:text-[#5C0102]"
                        style={{ color: "rgba(92, 1, 2, 0.12)" }}
                      >
                        {milestone.step}
                      </span>
                    </div>
                    <h3 className="text-gray-900 font-medium">{milestone.title}</h3>
                    {milestone.when ? (
                      <p className="text-sm font-medium mt-1.5" style={{ color: "#5C0102" }}>{milestone.when}</p>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                        To be announced
                      </span>
                    )}
                    <p className="text-gray-500 text-xs leading-relaxed mt-2.5">{milestone.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
