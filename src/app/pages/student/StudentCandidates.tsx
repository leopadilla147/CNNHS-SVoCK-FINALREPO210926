import { useState } from "react";
import { Search, Trophy, Mail, Phone, MapPin, EyeOff, CalendarX } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { candidatesInLivePeriod, FULL_POSITION_ORDER as ALL_POSITION_ORDER } from "../../lib/partyScope";

export default function StudentCandidates() {
  const { candidates, currentUser, electionPeriod } = useApp();
  const [search, setSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<typeof candidates[0] | null>(null);

  // Determine the student's party from their own candidacy application
  const periodCandidates = candidatesInLivePeriod(candidates, electionPeriod);
  const myApplication = periodCandidates.find((c) => c.studentId === currentUser?.id);
  const myParty = myApplication?.status === "approved" ? (myApplication.partyAffiliation ?? null) : null;

  // No period row at all (every election completed/cancelled, or none yet):
  // nothing is live, so past rosters stay in the archive and this page says
  // so plainly instead of implying an election is coming.
  const hasElectionPeriod = Boolean(electionPeriod.id);

  // Candidates visible only if admin posted the official list, or student is an approved candidate
  const canViewCandidates = electionPeriod.officialListPosted || myApplication?.status === "approved";

  // Only show approved candidates from the student's own party.
  // Independent candidates (no party / declared "Independent") are hidden
  // from the student side.
  const partyApproved = periodCandidates.filter(
    (c) =>
      c.status === "approved" &&
      !!c.partyAffiliation &&
      c.partyAffiliation !== "Independent" &&
      (myParty ? c.partyAffiliation === myParty : true)
  );

  const filtered = partyApproved.filter((c) =>
    `${c.givenName} ${c.surname} ${c.partyAffiliation}`.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce((acc, c) => {
    const list = acc[c.position] ?? [];
    list.push(c);
    acc[c.position] = list;
    return acc;
  }, {} as Record<string, typeof candidates>);

  // Render positions in canonical order first, then any other positions that
  // have approved candidates.
  const orderedPositions = [
    ...ALL_POSITION_ORDER,
    ...Object.keys(grouped).filter((p) => !ALL_POSITION_ORDER.includes(p)),
  ].filter((p) => grouped[p] && grouped[p].length > 0);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-gray-900 mb-1">
          {myParty ? `${myParty} — Candidates` : "Official Candidates"}
        </h1>
        <p className="text-gray-500 text-sm">
          {myParty
            ? `Viewing approved candidates running under ${myParty}`
            : "View all approved candidates running in this election"}
        </p>
      </motion.div>

      {/* Party info banner */}
      {myParty && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-4 mb-6 flex items-center gap-3"
          style={{ background: "linear-gradient(135deg, #5C0102, #8B0103)" }}
        >
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
            <Trophy size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white text-sm font-medium">Party: {myParty}</div>
            <div className="text-white/70 text-xs">You can only view candidates from your party</div>
          </div>
        </motion.div>
      )}

      {/* No election period at all: nothing from past elections may read as current */}
      {!hasElectionPeriod && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-8 mb-6 text-center"
          style={{ background: "linear-gradient(135deg, #5C0102, #8B0103)" }}
        >
          <CalendarX size={40} className="mx-auto mb-3 text-white/60" />
          <h2 className="text-white text-lg mb-2">No Active Election Period</h2>
          <p className="text-white/70 text-sm max-w-md mx-auto">
            There is no election underway right now, so no candidates are shown. Candidate
            rosters will appear here once the Electoral Board opens a new election period.
          </p>
        </motion.div>
      )}

      {/* Not yet posted */}
      {hasElectionPeriod && !canViewCandidates && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-8 mb-6 text-center"
          style={{ background: "linear-gradient(135deg, #5C0102, #8B0103)" }}
        >
          <EyeOff size={40} className="mx-auto mb-3 text-white/60" />
          <h2 className="text-white text-lg mb-2">Official List Not Yet Posted</h2>
          <p className="text-white/70 text-sm max-w-md mx-auto">
            The official list of candidates has not been published yet. Please wait for the
            administrator to post the official list.
          </p>
        </motion.div>
      )}

      {/* Search & Candidates */}
      {canViewCandidates && (
        <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
          />
        </div>
      </div>

      {/* Candidates grouped by position */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Trophy size={40} className="mx-auto mb-3 opacity-30" />
          <p>No candidates found.</p>
        </div>
      ) : (
        orderedPositions.map((position) => {
          const positionCandidates = grouped[position];
          return (
          <motion.div
            key={position}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: "#5C0102" }}
              >
                <Trophy size={14} />
              </div>
              <h3 className="text-gray-900">{position}</h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {positionCandidates.length} candidate{positionCandidates.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {positionCandidates.map((candidate, i) => (
                <motion.div
                  key={candidate.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
                  onClick={() => setSelectedCandidate(candidate)}
                >
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <img
                        src={candidate.picture}
                        alt={candidate.givenName}
                        className="w-14 h-14 rounded-full object-cover flex-shrink-0 border-2"
                        style={{ borderColor: "#5C0102" }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 text-sm truncate">
                          {candidate.givenName} {candidate.surname}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {candidate.partyAffiliation || "Independent"}
                        </div>
                        <div className="text-xs text-gray-400">{candidate.gradeLevel}</div>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        className="text-xs px-2.5 py-1 rounded-lg text-white transition-all hover:opacity-80"
                        style={{ backgroundColor: "#5C0102" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCandidate(candidate);
                        }}
                      >
                        View
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
          );
        })
      )}

      {/* Candidate Detail Modal */}
      {selectedCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
          onClick={() => setSelectedCandidate(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-white text-center" style={{ backgroundColor: "#5C0102" }}>
              <img
                src={selectedCandidate.picture}
                alt={selectedCandidate.givenName}
                className="w-20 h-20 rounded-full object-cover mx-auto mb-3 border-4 border-white/30"
              />
              <h3 className="text-white">
                {selectedCandidate.givenName}{" "}
                {selectedCandidate.middleName ? selectedCandidate.middleName + " " : ""}
                {selectedCandidate.surname}{" "}
                {selectedCandidate.extensionName || ""}
              </h3>
              <div className="inline-block bg-white/20 text-white text-xs px-3 py-1 rounded-full mt-1">
                {selectedCandidate.position}
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Party</div>
                  <div className="text-gray-900 font-medium">
                    {selectedCandidate.partyAffiliation || "Independent"}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Grade Level</div>
                  <div className="text-gray-900 font-medium">{selectedCandidate.gradeLevel}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Gender</div>
                  <div className="text-gray-900 font-medium">{selectedCandidate.gender}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Age</div>
                  <div className="text-gray-900 font-medium">{selectedCandidate.age} years old</div>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Mail size={14} style={{ color: "#5C0102" }} />
                  <span>{selectedCandidate.email}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone size={14} style={{ color: "#5C0102" }} />
                  <span>{selectedCandidate.mobileNumber}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin size={14} style={{ color: "#5C0102" }} />
                  <span>{selectedCandidate.homeAddress}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors mt-2"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
        </>
      )}
    </div>
  );
}