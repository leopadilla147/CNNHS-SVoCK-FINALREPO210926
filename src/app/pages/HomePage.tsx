import { Link } from "react-router";
import { motion } from "motion/react";
import {
  Award,
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  MapPin,
  Megaphone,
  Shield,
  Sparkles,
  Trophy,
  Users,
  Vote,
} from "lucide-react";
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
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full font-medium">
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
      <div className="space-y-4 sm:space-y-8">

        {/* ── Section 1: Current Election Information ─────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative py-14 sm:py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-white via-gray-50/40 to-white"
        >
          <div className="max-w-7xl mx-auto">
            {/* Section Header */}
            <div className="text-center mb-12 sm:mb-14">
              <div
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-3.5 shadow-xs"
                style={{
                  backgroundColor: "rgba(92, 1, 2, 0.06)",
                  color: "#5C0102",
                  border: "1px solid rgba(92, 1, 2, 0.12)",
                }}
              >
                <Shield size={14} />
                <span>Election Information</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
                Current Election Details
              </h2>
              <p className="text-gray-500 text-sm sm:text-base mt-2 max-w-xl mx-auto">
                Information about the ongoing SSLG election
              </p>
            </div>

            {/* 4 Quick Stat Cards */}
            <div className="grid gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
              {/* Card 1: Positions Contested */}
              <div className="group relative bg-white rounded-3xl border border-gray-100 p-6 sm:p-7 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                {/* Bottom accent on hover */}
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 shadow-xs"
                    style={{
                      backgroundColor: "rgba(92, 1, 2, 0.07)",
                      color: "#5C0102",
                    }}
                  >
                    <Award size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Positions Contested
                  </h3>
                  <div className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors">
                    {POSITIONS.length}
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-medium text-gray-500">
                  {POSITIONS.length} positions
                </div>
              </div>

              {/* Card 2: Approved Candidates */}
              <div className="group relative bg-white rounded-3xl border border-gray-100 p-6 sm:p-7 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 shadow-xs"
                    style={{
                      backgroundColor: "rgba(92, 1, 2, 0.07)",
                      color: "#5C0102",
                    }}
                  >
                    <Shield size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Approved Candidates
                  </h3>
                  {candidacyAnnounced ? (
                    <div className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors">
                      {approvedCandidates.length}
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <ToBeAnnounced />
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-medium text-gray-500">
                  {candidacyAnnounced ? `${approvedCandidates.length} candidates` : "Announced after Stage 1"}
                </div>
              </div>

              {/* Card 3: Political Parties */}
              <div className="group relative bg-white rounded-3xl border border-gray-100 p-6 sm:p-7 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 shadow-xs"
                    style={{
                      backgroundColor: "rgba(92, 1, 2, 0.07)",
                      color: "#5C0102",
                    }}
                  >
                    <Users size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Political Parties
                  </h3>
                  {candidacyAnnounced ? (
                    <div className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors">
                      {partyCount}
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <ToBeAnnounced />
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-medium text-gray-500">
                  {candidacyAnnounced ? `${partyCount} parties` : "Participating slates"}
                </div>
              </div>

              {/* Card 4: Voting Day & Venue */}
              <div className="group relative bg-white rounded-3xl border border-gray-100 p-6 sm:p-7 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 shadow-xs"
                    style={{
                      backgroundColor: "rgba(92, 1, 2, 0.07)",
                      color: "#5C0102",
                    }}
                  >
                    <Calendar size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Voting Day & Venue
                  </h3>
                  {votingScheduled ? (
                    <div className="space-y-1">
                      <div className="text-base sm:text-lg font-bold text-gray-900 group-hover:text-[#5C0102] transition-colors">
                        {electionPeriod.startDate}
                        {electionPeriod.startTime ? ` at ${electionPeriod.startTime}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <ToBeAnnounced />
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-medium text-gray-500 flex items-center justify-center gap-1.5 truncate">
                  {votingScheduled ? (
                    <>
                      <MapPin size={13} className="shrink-0 text-gray-400" />
                      <span className="truncate">{electionPeriod.venue || "CNNHS Covered Court"}</span>
                    </>
                  ) : (
                    <span>Precinct & Kiosks schedule</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Section 2: Election Calendar & Timeline ──────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-gray-50 via-gray-50/80 to-white overflow-hidden border-t border-gray-100"
        >
          <div className="max-w-7xl mx-auto">
            {/* Section Header */}
            <div className="text-center mb-12 sm:mb-16">
              <div
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-3.5 shadow-xs"
                style={{
                  backgroundColor: "rgba(92, 1, 2, 0.06)",
                  color: "#5C0102",
                  border: "1px solid rgba(92, 1, 2, 0.12)",
                }}
              >
                <Calendar size={14} />
                <span>Election Calendar</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
                Important Dates
              </h2>
              <p className="text-gray-500 text-sm sm:text-base mt-2 max-w-xl mx-auto">
                Key dates and deadlines for the SSLG election process
              </p>

              {/* View Full Calendar CTA Button */}
              <div className="mt-6">
                <Link
                  to={getCalendarHref(currentUser)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 group"
                  style={{
                    background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)",
                  }}
                >
                  <span>View Full Calendar</span>
                  <ChevronRight size={15} className="transition-transform duration-200 group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            {/* 4 Progression Milestone Cards */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: "01",
                  icon: <FileText size={22} />,
                  title: "Candidacy Filing",
                  when: electionPeriod.startDate
                    ? `${electionPeriod.startDate}${electionPeriod.endDate ? ` – ${electionPeriod.endDate}` : ""}`
                    : "",
                  desc: "Aspiring candidates submit their application forms and supporting documents.",
                },
                {
                  step: "02",
                  icon: <Megaphone size={22} />,
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
                  icon: <Vote size={22} />,
                  title: "Voting Day",
                  when: electionPeriod.startDate
                    ? `${electionPeriod.startDate}${electionPeriod.startTime ? ` at ${electionPeriod.startTime}` : ""}`
                    : "",
                  desc: "Cast your ballot at the biometric kiosks — one scan, one secure vote.",
                },
                {
                  step: "04",
                  icon: <Trophy size={22} />,
                  title: "Results Publication",
                  when: "Within 48 hours after voting closes",
                  desc: "Official results are posted publicly once the vote is concluded.",
                },
              ].map((milestone) => (
                <div
                  key={milestone.step}
                  className="group relative bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-7 transition-all duration-300 hover:shadow-xl hover:-translate-y-1.5 flex flex-col justify-between overflow-hidden"
                >
                  {/* Top hover accent bar */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                  />

                  <div>
                    {/* Top Row: Icon Container and Large Step Watermark */}
                    <div className="flex items-start justify-between mb-5">
                      <div
                        className="w-13 h-13 rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 shadow-xs"
                        style={{
                          backgroundColor: "rgba(92, 1, 2, 0.07)",
                          color: "#5C0102",
                        }}
                      >
                        {milestone.icon}
                      </div>

                      <span
                        className="text-4xl sm:text-5xl font-black select-none transition-colors duration-300 leading-none group-hover:text-[#5C0102]"
                        style={{ color: "rgba(92, 1, 2, 0.12)" }}
                      >
                        {milestone.step}
                      </span>
                    </div>

                    <h3 className="text-base sm:text-lg font-bold text-gray-900 group-hover:text-[#5C0102] transition-colors tracking-tight">
                      {milestone.title}
                    </h3>

                    {milestone.when ? (
                      <div
                        className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-lg text-xs font-semibold"
                        style={{
                          backgroundColor: "rgba(92, 1, 2, 0.06)",
                          color: "#5C0102",
                        }}
                      >
                        <Clock size={12} className="shrink-0" />
                        <span>{milestone.when}</span>
                      </div>
                    ) : (
                      <div className="mt-2.5">
                        <ToBeAnnounced />
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-3.5 border-t border-gray-100">
                    <p className="text-gray-500 text-xs sm:text-sm leading-relaxed">
                      {milestone.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
