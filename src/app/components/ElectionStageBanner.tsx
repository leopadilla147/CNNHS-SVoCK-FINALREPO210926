import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Link } from "react-router";
import {
  Users,
  Megaphone,
  Fingerprint,
  Vote,
  Trophy,
  CheckCircle2,
  ArrowRight,
  Ban,
  CalendarX,
} from "lucide-react";
import { useApp, type ElectionStage } from "../context/AppContext";
import { resolveStage } from "../pages/admin/AdminElectionSetup";

/** 058/060 lifecycle order — "Stage N of 5" is derived from this. */
const STAGE_ORDER: ElectionStage[] = [
  "application",
  "campaign",
  "fingerprint_registration",
  "voting",
  "results",
];

interface StageAnnouncement {
  label: string;
  description: string;
  icon: ReactNode;
}

const ANNOUNCEMENTS: Record<ElectionStage, StageAnnouncement> = {
  application: {
    label: "Application",
    description:
      "Candidate application is open — students may file their certificates of candidacy.",
    icon: <Users size={22} />,
  },
  campaign: {
    label: "Campaign",
    description:
      "The rules discussion and campaign period are underway.",
    icon: <Megaphone size={22} />,
  },
  fingerprint_registration: {
    label: "Fingerprint Registration",
    description:
      "Approved voters must enrol their fingerprints at the kiosks to be able to vote.",
    icon: <Fingerprint size={22} />,
  },
  voting: {
    label: "Voting",
    description:
      "Voting is open — monitor turnout and live results in real time.",
    icon: <Vote size={22} />,
  },
  results: {
    label: "Results",
    description:
      "Results are published — winners may now be proclaimed.",
    icon: <Trophy size={22} />,
  },
  completed: {
    label: "Completed",
    description:
      "This election has been completed and archived.",
    icon: <CheckCircle2 size={22} />,
  },
  // 131 — terminal but never current: resolveStage() can only land here on a
  // stale row object held across a finalize/reset refresh.  Kept for the
  // Record's exhaustiveness and for that stale-tick window.
  cancelled: {
    label: "Cancelled",
    description:
      "This election was cancelled before its results were published and its winners proclaimed.",
    icon: <Ban size={22} />,
  },
};

/**
 * 058/060: the election lifecycle stage (election_periods.lifecycle_stage)
 * announced on every admin dashboard.  resolveStage() is authoritative —
 * it trusts lifecycle_stage and falls back to the legacy booleans, so this
 * banner never shows a bogus stage on an unmigrated database.
 *
 * With no period row at all — every election completed/cancelled, or none
 * created yet — resolveStage() would land on "application" and the banner
 * would announce "Stage 1 of 5" over an election that does not exist, while
 * the stat cards under it read a live candidate list that partyScope
 * deliberately empties.  A distinct "No Active Election Period" state says
 * plainly that nothing from past elections is being shown as current.
 */
export default function ElectionStageBanner({ className = "" }: { className?: string }) {
  const { electionPeriod, currentUser } = useApp();
  const stage = resolveStage(electionPeriod);
  const info = ANNOUNCEMENTS[stage];
  const stageNumber = STAGE_ORDER.indexOf(stage) + 1;
  // Only the Commissioner of the Electoral Board advances the stages, so only
  // that officer gets the stage description and the Election Setup shortcut.
  const isElectoralBoard = currentUser?.commissionerRole === "electoral_board";

  // No period row: no election is underway, and past rosters stay in the
  // archive instead of reading as current.  The explanation is shown to
  // every officer (it is why their stat cards read zero); the Election
  // Setup shortcut stays Electoral-Board-only, as above.
  if (!electionPeriod.id) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl p-5 shadow-md text-white bg-gradient-to-r from-[#5C0102] to-[#8B0103] ${className}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <CalendarX size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-0.5">
              Election Stage Announcement
            </div>
            <div className="text-lg sm:text-xl font-extrabold tracking-tight">
              No Active Election Period
            </div>
            <p className="text-sm text-white/80 mt-1">
              No election is underway, so nothing from past elections shows as current. Past
              elections remain available in the archive.
            </p>
          </div>
          {isElectoralBoard && (
            <Link
              to="/admin/election"
              className="inline-flex items-center gap-1.5 self-start sm:self-center px-4 py-2.5 rounded-xl bg-white text-[#5C0102] text-sm font-bold hover:opacity-90 transition-opacity shrink-0"
            >
              <span>Go to Election Setup</span>
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-5 shadow-md text-white bg-gradient-to-r from-[#5C0102] to-[#8B0103] ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
          {info.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-0.5">
            Election Stage Announcement
          </div>
          <div className="text-lg sm:text-xl font-extrabold tracking-tight">
            {stageNumber > 0
              ? `Stage ${stageNumber} of ${STAGE_ORDER.length}: ${info.label}`
              : info.label}
          </div>
          {isElectoralBoard && (
            <p className="text-sm text-white/80 mt-1">{info.description}</p>
          )}
        </div>
        {isElectoralBoard && (
          <Link
            to="/admin/election"
            className="inline-flex items-center gap-1.5 self-start sm:self-center px-4 py-2.5 rounded-xl bg-white text-[#5C0102] text-sm font-bold hover:opacity-90 transition-opacity shrink-0"
          >
            <span>Go to Election Setup</span>
            <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </motion.div>
  );
}
