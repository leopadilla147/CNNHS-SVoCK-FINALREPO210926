import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Gavel, PartyPopper, Trophy, Users } from "lucide-react";
import { ProclaimedWinner } from "../lib/supabaseData";
import { positionRank } from "../lib/partyScope";

/**
 * Stage 5 — the student-facing face of the proclamation ledger.  When the
 * Electoral Board has proclaimed the winners, this card lists every one of
 * them in the Board's canonical reading order (the same sort the admin
 * Stage 5 grid uses).  When the viewer's own candidacy is among the winners
 * a "Congratulations" banner rides on top; everyone else gets the winners
 * list alone.  Renders nothing until there is something to show — callers
 * can mount it unconditionally once the period is proclaimed.
 *
 * Data comes from getProclaimedWinners() (the `proclamations` ledger,
 * public-readable), so this needs no new database surface.
 */

/** One winner tile — photo (Users-icon fallback), position, name, party and
 *  votes, plus the same resolution badges the admin Stage 5 grid carries.
 *  The viewer's own seat is ringed and badged "You". */
function WinnerTile({ winner: w, isMine }: { winner: ProclaimedWinner; isMine: boolean }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div
      className={`bg-white p-3 rounded-lg border text-sm flex items-center gap-3 ${
        isMine ? "border-[#5C0102] ring-2 ring-[#5C0102]/15" : "border-amber-100"
      }`}
    >
      {w.picture && !imgFailed ? (
        <img
          src={w.picture}
          alt={w.winnerName}
          onError={() => setImgFailed(true)}
          className="w-11 h-11 rounded-full object-cover border-2 flex-shrink-0"
          style={{ borderColor: "#5C0102" }}
        />
      ) : (
        <div
          className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"
          style={{ border: "2px solid #5C0102" }}
        >
          <Users size={18} className="text-gray-400" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs text-gray-500 truncate flex items-center gap-1.5">
          {w.position}
          {isMine && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-white bg-[#5C0102] rounded-full px-1.5 py-px">
              You
            </span>
          )}
        </div>
        <div className="font-medium text-gray-900 truncate">{w.winnerName}</div>
        <div className="text-xs text-gray-500 truncate">{w.partyName || "Independent"}</div>
        <div className="text-xs text-gray-400">
          {w.votes} vote{w.votes !== 1 ? "s" : ""}
        </div>
        {w.resolutionMethod === "manual" && (
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
            <Gavel size={11} /> Board's choice
          </div>
        )}
        {w.resolutionMethod === "tie_both" && (
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
            <Gavel size={11} /> Tie — both proclaimed
          </div>
        )}
        {/* 122 — the affirmation badge; an affirmed 2-way Grade Rep tie
            (tie_both rows) carries it too. */}
        {w.remainWinner && w.resolutionMethod !== "manual" && (
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-green-700 flex items-center gap-1">
            <CheckCircle2 size={11} /> Winner stands
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProclaimedWinnersCard({
  winners,
  myCandidateId,
  schoolYear,
  className = "",
}: {
  winners: ProclaimedWinner[];
  /** The viewer's own candidacy row id — matching a proclaimed winner
   *  switches the card into the Congratulations variant. */
  myCandidateId?: string | null;
  schoolYear?: string;
  /** Extra classes on the root — the Apply page uses it for bottom margin. */
  className?: string;
}) {
  // The Board's reading order — officers first, then Grade Level
  // Representatives — instead of the ledger's alphabetical one.
  const sorted = useMemo(
    () =>
      [...winners].sort(
        (a, b) =>
          positionRank(a.position) - positionRank(b.position) ||
          a.winnerName.localeCompare(b.winnerName),
      ),
    [winners],
  );

  if (sorted.length === 0) return null;

  // One candidacy per student per period, so this is 0 or 1 rows in
  // practice; the join keeps it correct even if that ever changes.
  const myWins = myCandidateId
    ? sorted.filter((w) => w.candidateId === myCandidateId)
    : [];
  const stamp = sorted.find((w) => w.proclaimedAt)?.proclaimedAt;
  const stampDate = stamp ? new Date(stamp) : null;

  return (
    <section className={`space-y-4 ${className}`}>
      {myWins.length > 0 && (
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
              <strong>{myWins.map((w) => w.position).join(" and ")}</strong>
              {schoolYear ? (
                <>
                  {" "}for School Year <strong>{schoolYear}</strong>
                </>
              ) : null}
              . The school community celebrates with you.
            </p>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#5C0102" }}
          >
            <Trophy size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900">Proclaimed Winners</h3>
            <p className="text-xs text-gray-500">
              Officially proclaimed by the Electoral Board
              {stampDate && !Number.isNaN(stampDate.getTime())
                ? ` on ${stampDate.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}`
                : ""}
            </p>
          </div>
          <span className="ml-auto shrink-0 text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2.5 py-1">
            {sorted.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sorted.map((w) => (
            <WinnerTile
              key={`${w.position}:${w.candidateId ?? w.winnerName}`}
              winner={w}
              isMine={myCandidateId != null && w.candidateId === myCandidateId}
            />
          ))}
        </div>
      </motion.div>
    </section>
  );
}
