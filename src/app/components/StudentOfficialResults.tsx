import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Loader2, PartyPopper, Trophy } from "lucide-react";
import type { PastElectionResults } from "../lib/supabaseData";
import ElectionResultsView, { candidateNameMatches } from "./ElectionResultsView";

/**
 * Stage 5 — the Apply-for-Candidacy tab's official result: the FULL published
 * tally (every position, every candidate, vote bars and proclaimed-winner
 * badges, via the shared ElectionResultsView), topped by a "Congratulations"
 * banner when the viewer's own candidacy is among the proclaimed winners.
 * The viewer's own rows — won or not — are ringed and badged "You".
 *
 * Container-less on purpose: the caller decides the padded wrapper (the
 * closed screen renders it alone at max-w-5xl, the status screens embed it
 * below their card).
 */
export default function StudentOfficialResults({
  results,
  loading,
  myName,
  fallback = null,
}: {
  results: PastElectionResults | null;
  loading: boolean;
  /** The viewer's own candidate full name, built exactly like the archive
   *  builds candidate_name (given + middle + surname + extension) — the key
   *  that highlights their rows and powers the congratulations banner. */
  myName?: string | null;
  /** Rendered instead when the read failed — the closed screen uses it so
   *  it never blanks once the closed notice is hidden. */
  fallback?: ReactNode;
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center flex flex-col items-center">
        <Loader2 className="animate-spin" size={28} style={{ color: "#5C0102" }} />
        <p className="text-gray-500 text-sm mt-3">Loading the official result...</p>
      </div>
    );
  }
  if (!results) return <>{fallback}</>;

  // The positions this viewer won — the congratulations banner lists them.
  const myWinPositions = myName
    ? [
        ...new Set(
          results.positions
            .filter((p) =>
              p.candidates.some(
                (c) => c.proclaimedWinner && candidateNameMatches(c.name, myName),
              ),
            )
            .map((p) => p.position),
        ),
      ]
    : [];

  return (
    <div className="space-y-6">
      {myWinPositions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-5 flex items-start gap-3 border border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50"
        >
          <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <PartyPopper size={20} className="text-amber-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Congratulations!</h3>
            <p className="text-sm text-amber-800 mt-0.5">
              You have been proclaimed as{" "}
              <strong>{myWinPositions.join(" and ")}</strong>
              {results.election.schoolYear ? (
                <>
                  {" "}for School Year <strong>{results.election.schoolYear}</strong>
                </>
              ) : null}
              . The school community celebrates with you.
            </p>
          </div>
        </motion.div>
      )}

      <ElectionResultsView
        results={results}
        eyebrow="Official Election Result"
        eyebrowIcon={<Trophy size={16} />}
        highlightName={myName}
        showPositionTabs
      />
    </div>
  );
}
