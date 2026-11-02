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
      <div className="space-y-0">

        {/* ── Section 1: Current Election Information ─────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-stone-50 via-gray-50/70 to-white overflow-hidden border-t border-gray-200/60"
        >
          {/* Subtle ambient gradients */}
          <div className="absolute top-10 -left-20 w-80 h-80 rounded-full bg-red-100/30 blur-3xl pointer-events-none" />
          <div className="absolute bottom-10 -right-20 w-80 h-80 rounded-full bg-amber-100/25 blur-3xl pointer-events-none" />

          <div className="max-w-7xl mx-auto relative z-10">
            {/* Section Header */}
            <div className="text-center mb-12 sm:mb-14">
              <div
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-3.5 bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_2px_6px_rgba(92,1,2,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
              >
                <Shield size={14} />
                <span>Election Information</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight drop-shadow-xs">
                Current Election Details
              </h2>
              <p className="text-gray-500 text-sm sm:text-base mt-2 max-w-xl mx-auto font-medium">
                Information about the ongoing SSLG election
              </p>
            </div>

            {/* 4 Quick Stat Cards */}
            <div className="grid gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
              {/* Card 1: Positions Contested */}
              <div className="group relative bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] rounded-3xl border border-gray-200/90 border-b-[4px] border-b-gray-300 p-6 sm:p-7 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#8B0103]/40 hover:border-b-[#5C0102] hover:shadow-[0_18px_38px_-6px_rgba(92,1,2,0.14),0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                {/* Bottom accent on hover */}
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-[#5C0102] via-[#8B0103] to-[#5C0102]"
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 bg-gradient-to-b from-red-50 to-red-100/80 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_4px_10px_rgba(92,1,2,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]"
                  >
                    <Award size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Positions Contested
                  </h3>
                  <div className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors drop-shadow-xs">
                    {POSITIONS.length}
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-semibold text-gray-500">
                  {POSITIONS.length} positions
                </div>
              </div>

              {/* Card 2: Approved Candidates */}
              <div className="group relative bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] rounded-3xl border border-gray-200/90 border-b-[4px] border-b-gray-300 p-6 sm:p-7 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#8B0103]/40 hover:border-b-[#5C0102] hover:shadow-[0_18px_38px_-6px_rgba(92,1,2,0.14),0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-[#5C0102] via-[#8B0103] to-[#5C0102]"
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 bg-gradient-to-b from-red-50 to-red-100/80 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_4px_10px_rgba(92,1,2,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]"
                  >
                    <Shield size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Approved Candidates
                  </h3>
                  {candidacyAnnounced ? (
                    <div className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors drop-shadow-xs">
                      {approvedCandidates.length}
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <ToBeAnnounced />
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-semibold text-gray-500">
                  {candidacyAnnounced ? `${approvedCandidates.length} candidates` : "Announced after Stage 1"}
                </div>
              </div>

              {/* Card 3: Political Parties */}
              <div className="group relative bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] rounded-3xl border border-gray-200/90 border-b-[4px] border-b-gray-300 p-6 sm:p-7 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#8B0103]/40 hover:border-b-[#5C0102] hover:shadow-[0_18px_38px_-6px_rgba(92,1,2,0.14),0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-[#5C0102] via-[#8B0103] to-[#5C0102]"
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 bg-gradient-to-b from-red-50 to-red-100/80 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_4px_10px_rgba(92,1,2,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]"
                  >
                    <Users size={26} />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Political Parties
                  </h3>
                  {candidacyAnnounced ? (
                    <div className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight group-hover:text-[#5C0102] transition-colors drop-shadow-xs">
                      {partyCount}
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <ToBeAnnounced />
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-semibold text-gray-500">
                  {candidacyAnnounced ? `${partyCount} parties` : "Participating slates"}
                </div>
              </div>

              {/* Card 4: Voting Day & Venue */}
              <div className="group relative bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] rounded-3xl border border-gray-200/90 border-b-[4px] border-b-gray-300 p-6 sm:p-7 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#8B0103]/40 hover:border-b-[#5C0102] hover:shadow-[0_18px_38px_-6px_rgba(92,1,2,0.14),0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:-translate-y-1.5 transition-all duration-300 overflow-hidden flex flex-col items-center text-center justify-between">
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-[#5C0102] via-[#8B0103] to-[#5C0102]"
                />

                <div className="w-full flex flex-col items-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 bg-gradient-to-b from-red-50 to-red-100/80 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_4px_10px_rgba(92,1,2,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]"
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

                <div className="mt-4 pt-3.5 border-t border-gray-100 w-full text-xs font-semibold text-gray-500 flex items-center justify-center gap-1.5 truncate">
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
          className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-white via-stone-50/70 to-stone-100/60 overflow-hidden border-t border-gray-200/80"
        >
          {/* Subtle ambient gradients */}
          <div className="absolute top-10 -right-20 w-80 h-80 rounded-full bg-red-100/30 blur-3xl pointer-events-none" />
          <div className="absolute bottom-10 -left-20 w-80 h-80 rounded-full bg-amber-100/25 blur-3xl pointer-events-none" />

          <div className="max-w-7xl mx-auto relative z-10">
            {/* Section Header */}
            <div className="text-center mb-12 sm:mb-16">
              <div
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-3.5 bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_2px_6px_rgba(92,1,2,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
              >
                <Calendar size={14} />
                <span>Election Calendar</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight drop-shadow-xs">
                Important Dates
              </h2>
              <p className="text-gray-500 text-sm sm:text-base mt-2 max-w-xl mx-auto font-medium">
                Key dates and deadlines for the SSLG election process
              </p>

              {/* View Full Calendar CTA Button */}
              <div className="mt-6">
                <Link
                  to={getCalendarHref(currentUser)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white shadow-[0_4px_14px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] border-b-[3px] border-b-[#2e0001] bg-gradient-to-b from-[#7A0203] via-[#5C0102] to-[#450001] hover:brightness-105 hover:shadow-[0_6px_18px_rgba(92,1,2,0.32)] active:translate-y-[1px] active:border-b-2 transition-all duration-200 group cursor-pointer"
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
                  className="group relative bg-gradient-to-b from-white via-[#fdfbfb] to-[#faf5f5] rounded-3xl border border-gray-200/90 border-b-[4px] border-b-gray-300 p-6 sm:p-7 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,1)] hover:border-[#8B0103]/40 hover:border-b-[#5C0102] hover:shadow-[0_18px_38px_-6px_rgba(92,1,2,0.14),0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-between overflow-hidden"
                >
                  {/* Top hover accent bar */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-[#5C0102] via-[#8B0103] to-[#5C0102]"
                  />

                  <div>
                    {/* Top Row: Icon Container and Large Step Watermark */}
                    <div className="flex items-start justify-between mb-5">
                      <div
                        className="w-13 h-13 rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 bg-gradient-to-b from-red-50 to-red-100/80 border border-red-200/90 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_3px_8px_rgba(92,1,2,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]"
                      >
                        {milestone.icon}
                      </div>

                      <span
                        className="text-4xl sm:text-5xl font-black select-none transition-colors duration-300 leading-none text-red-950/15 group-hover:text-[#5C0102]/30"
                      >
                        {milestone.step}
                      </span>
                    </div>

                    <h3 className="text-base sm:text-lg font-bold text-gray-900 group-hover:text-[#5C0102] transition-colors tracking-tight">
                      {milestone.title}
                    </h3>

                    {milestone.when ? (
                      <div
                        className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-lg text-xs font-bold bg-gradient-to-b from-red-50 to-red-100/70 border border-red-200/80 border-b-2 border-b-red-300 text-[#5C0102] shadow-[0_1px_3px_rgba(92,1,2,0.05),inset_0_1px_0_rgba(255,255,255,0.8)]"
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
                    <p className="text-gray-500 text-xs sm:text-sm leading-relaxed font-medium">
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
