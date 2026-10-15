import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  CalendarDays,
  Loader2,
  MapPin,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  getCurrentPublicElection,
  type PublicCurrentCandidate,
  type PublicCurrentElection,
} from "../lib/supabaseData";

const POSITION_ORDER = [
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "PRO",
  "PIO",
  "Protocol Officer",
  "Grade 7 Representative",
  "Grade 8 Representative",
  "Grade 9 Representative",
  "Grade 10 Representative",
  "Grade 11 Representative",
  "Grade 12 Representative",
];

const POSITION_INDEX = new Map<string, number>(
  POSITION_ORDER.map((position, index) => [position, index]),
);

export interface CandidatePartyGroup {
  name: string;
  candidates: PublicCurrentCandidate[];
}

export function groupCandidatesByParty(candidates: PublicCurrentCandidate[]): CandidatePartyGroup[] {
  const groups = new Map<string, CandidatePartyGroup>();

  candidates.forEach((candidate) => {
    const name = candidate.partyAffiliation?.trim() || "Independent";
    const key = name.toLowerCase();
    const group = groups.get(key);

    if (group) {
      group.candidates.push(candidate);
    } else {
      groups.set(key, { name, candidates: [candidate] });
    }
  });

  return [...groups.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((group) => ({
      ...group,
      candidates: [...group.candidates].sort((left, right) => {
        const positionDifference =
          (POSITION_INDEX.get(left.position) ?? POSITION_ORDER.length) -
          (POSITION_INDEX.get(right.position) ?? POSITION_ORDER.length);
        return positionDifference || left.name.localeCompare(right.name);
      }),
    }));
}

function formatDateRange(election: PublicCurrentElection): string {
  if (!election.electionDate) return "Date to be announced";
  if (election.endDate && election.endDate !== election.electionDate) {
    return `${election.electionDate} – ${election.endDate}`;
  }
  return election.electionDate;
}

function formatVotingWindow(election: PublicCurrentElection): string {
  if (election.startTime && election.endTime) {
    return `${election.startTime} – ${election.endTime}`;
  }
  return election.startTime || election.endTime || "Time to be announced";
}

export default function CurrentElectionPage() {
  const [election, setElection] = useState<PublicCurrentElection | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHasError(false);

    getCurrentPublicElection()
      .then((result) => {
        if (active) setElection(result);
      })
      .catch(() => {
        if (active) {
          setElection(null);
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const partyGroups = useMemo(
    () => (election ? groupCandidatesByParty(election.candidates) : []),
    [election],
  );

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <Loader2 className="animate-spin mb-4" size={36} style={{ color: "#5C0102" }} />
            <p className="text-gray-600">Loading current election...</p>
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl text-gray-900 mb-2">Unable to Load Current Election</h1>
            <p className="text-gray-500 max-w-md">
              We could not retrieve the current election information. Please try again later.
            </p>
            <Link
              to="/"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : !election ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-5">
              <CalendarDays size={36} className="text-gray-400" />
            </div>
            <h1 className="text-3xl text-gray-900 mb-3">No Current Election</h1>
            <p className="text-gray-500 max-w-md">
              Voting is not currently active. Approved candidates will appear here when the next election begins.
            </p>
            <Link
              to="/"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden mb-8 text-white"
              style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
            >
              <div className="px-6 py-8 sm:px-10 sm:py-10">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-white/75 mb-3">
                      <ShieldCheck size={18} />
                      <span>Public election information</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-semibold">Current Election</h1>
                    <p className="text-white/75 mt-2">Meet the approved candidates for the active election.</p>
                  </div>
                  <div className="inline-flex items-center gap-2 self-start rounded-full bg-white/15 border border-white/20 px-4 py-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-green-300" />
                    Voting in progress
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3 mt-8 text-sm">
                  <div className="flex items-start gap-2">
                    <CalendarDays size={17} className="mt-0.5 text-white/75" />
                    <div>
                      <div className="text-white/60">Date</div>
                      <div className="mt-0.5">{formatDateRange(election)}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={17} className="mt-0.5 text-white/75" />
                    <div>
                      <div className="text-white/60">Voting window</div>
                      <div className="mt-0.5">{formatVotingWindow(election)}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin size={17} className="mt-0.5 text-white/75" />
                    <div>
                      <div className="text-white/60">Venue</div>
                      <div className="mt-0.5">{election.venue || "To be announced"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {election.candidates.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white py-20 px-6 text-center shadow-sm">
                <Users size={40} className="mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl text-gray-900 mb-2">No Approved Candidates Yet</h2>
                <p className="text-gray-500">Approved candidates will appear here when they are posted.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {partyGroups.map((group) => (
                  <section key={group.name.toLowerCase()} aria-labelledby={`party-${group.name.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
                          style={{ backgroundColor: "#5C0102" }}
                        >
                          <Users size={19} />
                        </div>
                        <h2
                          id={`party-${group.name.toLowerCase().replace(/\s+/g, "-")}`}
                          className="text-xl text-gray-900"
                        >
                          {group.name}
                        </h2>
                      </div>
                      <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-3 py-1">
                        {group.candidates.length} candidate{group.candidates.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {group.candidates.map((candidate) => (
                        <article
                          key={candidate.id}
                          className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-center gap-3">
                            {candidate.picture ? (
                              <img
                                src={candidate.picture}
                                alt={candidate.name}
                                className="w-14 h-14 rounded-full object-cover border-2 flex-shrink-0"
                                style={{ borderColor: "#5C0102" }}
                              />
                            ) : (
                              <div
                                className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"
                                style={{ border: "2px solid #5C0102" }}
                              >
                                <Users size={24} className="text-gray-400" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <h3 className="font-medium text-gray-900 truncate">{candidate.name}</h3>
                              <p className="text-sm text-gray-500 truncate">{candidate.position}</p>
                            </div>
                          </div>
                          <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1.5">
                            <div className="flex justify-between gap-3">
                              <span>Party</span>
                              <span className="text-gray-700 text-right">{candidate.partyAffiliation || "Independent"}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span>Grade</span>
                              <span className="text-gray-700">{candidate.gradeLevel}</span>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
