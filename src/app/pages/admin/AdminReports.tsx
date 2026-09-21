import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Printer, Trophy, Award, ChevronDown } from "lucide-react";
import { useApp, Candidate, ElectionPeriod, LogEntry } from "../../context/AppContext";
import {
  generateComeaCertificate, generateChiefElectionReport, openPrintWindow,
} from "../../lib/reports";
import {
  getLiveResultsRpc, getAbstainSummaryRpc, type LiveResultRow,
} from "../../lib/supabaseData";

// Canonical core-position ordering; every other position (including the
// grade-level representatives) is derived from the live results.
const CORE_POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "PRO"];
const isGradeRep = (p: string) => /representative/i.test(p);

/**
 * Election Reports (Chief Commissioner).
 *
 * v1.2 scope per the Chief's request:
 *   * the DepEd Enclosure Reports grid and the estimated voter-turnout
 *     charts/sections are REMOVED;
 *   * the results now come from the chief-gated get_live_results_rpc
 *     (real per-candidate vote counts) and get_abstain_summary_rpc
 *     (046 abstain ledger), so the abstain percentage and the winners
 *     summary are computed from actual ballots;
 *   * the Winners Summary lists EVERY position on the ballot — including
 *     the grade-level representatives — each with a dropdown of all its
 *     candidates sorted by votes (highest first).
 */
export default function AdminReports() {
  const { candidates, electionPeriod, logs } = useApp();
  const approved = candidates.filter((c) => c.status === "approved");

  const [liveResults, setLiveResults] = useState<LiveResultRow[] | null>(null);
  const [abstainByPosition, setAbstainByPosition] = useState<Record<string, number>>({});
  const [resultsError, setResultsError] = useState("");

  // Live results + abstain ledger are chief-gated RPCs (027 / 046); this
  // tab is Chief-only, but a failure degrades to the candidate list with
  // zero counts rather than breaking the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, abstain] = await Promise.all([
          getLiveResultsRpc(),
          getAbstainSummaryRpc().catch(() => [] as { position: string; abstain_count: number }[]),
        ]);
        if (cancelled) return;
        setLiveResults(rows);
        const map: Record<string, number> = {};
        abstain.forEach((a) => { map[a.position] = Number(a.abstain_count) || 0; });
        setAbstainByPosition(map);
      } catch (err) {
        if (!cancelled) setResultsError(err instanceof Error ? err.message : "Live results unavailable.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Per-position candidate rows sorted by votes (highest first).  Live
   * rows win when available; otherwise the approved candidate list is
   * used (votes stay 0 until ballots exist).
   */
  const resultsByPosition = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; party: string; gradeLevel: string; votes: number; picture?: string }>>();

    if (liveResults && liveResults.length > 0) {
      liveResults.forEach((r) => {
        const list = map.get(r.position) ?? [];
        list.push({
          id: r.candidate_id,
          name: `${r.given_name} ${r.surname}`,
          party: r.party_name || "Independent",
          gradeLevel: "",
          votes: Number(r.votes) || 0,
        });
        map.set(r.position, list);
      });
      // Enrich grade level from the candidate roster where available.
      map.forEach((list) => list.forEach((row) => {
        const c = approved.find((x) => x.id === row.id);
        if (c) { row.gradeLevel = c.gradeLevel || ""; row.picture = c.picture; }
      }));
    } else {
      approved.forEach((c) => {
        const list = map.get(c.position) ?? [];
        list.push({
          id: c.id,
          name: `${c.givenName} ${c.surname}`,
          party: c.partyAffiliation || "Independent",
          gradeLevel: c.gradeLevel || "",
          votes: c.votes || 0,
          picture: c.picture,
        });
        map.set(c.position, list);
      });
    }

    map.forEach((list) => list.sort((a, b) => b.votes - a.votes));
    return map;
  }, [liveResults, approved]);

  const positions = useMemo(() => {
    const rank = (p: string): [number, string] => {
      const i = CORE_POSITIONS.indexOf(p);
      if (i >= 0) return [i, ""];
      if (isGradeRep(p)) return [2, p];
      return [1, p];
    };
    return [...resultsByPosition.keys()].sort((a, b) => {
      const [ra, na] = rank(a);
      const [rb, nb] = rank(b);
      return ra !== rb ? ra - rb : na.localeCompare(nb);
    });
  }, [resultsByPosition]);

  const totalVotesCast = useMemo(
    () => [...resultsByPosition.values()].reduce((sum, list) => sum + list.reduce((s, c) => s + c.votes, 0), 0),
    [resultsByPosition]
  );
  const totalAbstains = useMemo(
    () => Object.values(abstainByPosition).reduce((s, n) => s + n, 0),
    [abstainByPosition]
  );
  const totalBallots = totalVotesCast + totalAbstains;
  const abstainPct = totalBallots > 0 ? Math.round((totalAbstains / totalBallots) * 1000) / 10 : 0;

  const ctx: ReportContext = { candidates, electionPeriod, logs };
  const [certWinnerId, setCertWinnerId] = useState("");
  const certWinner = approved.find((c) => c.id === certWinnerId) ?? approved[0];

  const startYear = new Date(electionPeriod.startDate).getFullYear();
  const schoolYear = Number.isNaN(startYear) ? "2026-2027" : `${startYear}-${startYear + 1}`;

  interface ReportContext {
    candidates: Candidate[];
    electionPeriod: ElectionPeriod;
    logs: LogEntry[];
  }

  const results = positions
    .map((position) => {
      const list = resultsByPosition.get(position) ?? [];
      const winner = list[0];
      return winner ? {
        position,
        winnerName: winner.name,
        party: winner.party,
        gradeLevel: winner.gradeLevel,
        votes: winner.votes,
      } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const handleComeaPrint = () => {
    if (!certWinner) return;
    openPrintWindow(generateComeaCertificate({
      studentName: `${certWinner.givenName} ${certWinner.surname}`,
      position: certWinner.position,
      academicYear: schoolYear,
    }));
  };

  // Participation estimate for the accomplishment report: the busiest
  // position's ballot count is the best available participation measure
  // (each voter casts one ballot per position).
  const busiestBallots = Math.max(0, ...positions.map((p) => {
    const list = resultsByPosition.get(p) ?? [];
    return list.reduce((s, c) => s + c.votes, 0) + (abstainByPosition[p] ?? 0);
  }));
  const turnoutPct = electionPeriodIsActiveGuard(busiestBallots);

  const handleChiefReportPrint = () => {
    openPrintWindow(generateChiefElectionReport({
      periodLabel: schoolYear,
      totals: {
        totalVoters: approved.length,
        voted: busiestBallots,
        notVoted: Math.max(approved.length - busiestBallots, 0),
        turnoutPct,
      },
      approvedCandidates: approved,
      results,
    }));
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-gray-900 mb-1">Election Reports</h1>
            <p className="text-gray-500 text-sm">Live results, abstain percentage, and winners summary for the CNNHS Student Election.</p>
          </div>
          <button
            onClick={handleChiefReportPrint}
            className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm transition-all hover:opacity-90"
            style={{ backgroundColor: "#5C0102" }}
          >
            <Printer size={16} /> Print Report
          </button>
        </div>
      </motion.div>

      {resultsError && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          {resultsError} — showing approved candidates with zero counts.
        </div>
      )}

      {/* COMEA Certificate & Chief Election Report */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-4 text-sm flex items-center gap-2">
          <Award size={16} style={{ color: "#5C0102" }} /> COMEA Certificate & Election Report
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-gray-100 rounded-xl p-3 flex flex-col">
            <div className="text-xs font-bold" style={{ color: "#5C0102" }}>COMEA Certificate</div>
            <div className="text-sm text-gray-800 mt-1 flex-1">Certificate of recognition for an elected candidate.</div>
            <div className="text-xs text-gray-400 mt-1 capitalize">Winner</div>
            <select
              value={certWinner?.id ?? ""}
              onChange={(e) => setCertWinnerId(e.target.value)}
              className="mt-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white"
            >
              {approved.map((c) => (
                <option key={c.id} value={c.id}>{c.givenName} {c.surname} — {c.position}</option>
              ))}
            </select>
            <button
              onClick={handleComeaPrint}
              disabled={approved.length === 0}
              className="mt-2 px-3 py-1.5 text-white rounded-lg text-xs font-medium self-start hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#5C0102" }}
            >
              Print Certificate
            </button>
          </div>

          <div className="border border-gray-100 rounded-xl p-3 flex flex-col">
            <div className="text-xs font-bold" style={{ color: "#5C0102" }}>Chief Commissioner Election Report</div>
            <div className="text-sm text-gray-800 mt-1 flex-1">Accomplishment report mirroring the LG-COMEA template with results and participation.</div>
            <div className="text-xs text-gray-400 mt-1 capitalize">Election period {schoolYear}</div>
            <button
              onClick={handleChiefReportPrint}
              className="mt-2 px-3 py-1.5 text-white rounded-lg text-xs font-medium self-start hover:opacity-90"
              style={{ backgroundColor: "#5C0102" }}
            >
              Print Report
            </button>
          </div>
        </div>
      </div>

      {/* Summary Header */}
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6 text-center"
        style={{ borderTop: "4px solid #5C0102" }}
      >
        <h2 className="text-gray-900 mb-1">CNNHS Student Election</h2>
        <p className="text-gray-500 text-sm">Camarines Norte National High School</p>
        <p className="text-gray-400 text-xs mt-1">
          Election Period: {electionPeriod.startDate} {electionPeriod.startTime} — {electionPeriod.endDate} {electionPeriod.endTime}
        </p>
        <div className="flex flex-wrap justify-center gap-6 mt-4 pt-4 border-t border-gray-100">
          {[
            { label: "Registered Voters", value: approved.length, color: "#5C0102" },
            { label: "Total Votes Cast", value: totalVotesCast.toLocaleString(), color: "#5C0102" },
            { label: "Abstain Votes", value: totalAbstains.toLocaleString(), color: "#9CA3AF" },
            { label: "Abstain Percentage", value: `${abstainPct}%`, color: "#B91C1C" },
            { label: "Active Candidates", value: approved.length, color: "#5C0102" },
            { label: "Positions", value: positions.length, color: "#5C0102" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-gray-400">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Winners Summary — every position, incl. grade-level representatives */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-1 text-sm flex items-center gap-2">
          <Trophy size={16} style={{ color: "#5C0102" }} /> Winners Summary (Based on Current Results)
        </h3>
        <p className="text-gray-400 text-xs mb-4">
          Every position on the ballot — including grade-level representatives. Expand a position to see all of its candidates sorted by votes (highest first).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#FFF5F5" }}>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Position</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Leading Candidate</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Party</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Votes</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Vote %</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Abstain %</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">Grade</th>
                <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500">All Candidates</th>
              </tr>
            </thead>
              <tbody className="divide-y divide-gray-50">
                {positions.map((position) => {
                  const list = resultsByPosition.get(position) ?? [];
                  const winner = list[0];
                  const posTotal = list.reduce((s, c) => s + c.votes, 0);
                  const abstains = abstainByPosition[position] ?? 0;
                  const posBallots = posTotal + abstains;
                  return (
                    <tr key={position} className="hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="py-3 px-4 font-medium text-gray-900">{position}</td>
                      <td className="py-3 px-4">
                        {winner ? (
                          <div className="flex items-center gap-2">
                            {winner.picture && <img src={winner.picture} alt="" className="w-7 h-7 rounded-full object-cover" />}
                            <span className="text-gray-800">{winner.name}</span>
                            <Trophy size={12} style={{ color: "#5C0102" }} />
                          </div>
                        ) : <span className="text-gray-400">No candidates</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{winner?.party || "—"}</td>
                      <td className="py-3 px-4 font-bold" style={{ color: "#5C0102" }}>{winner ? winner.votes.toLocaleString() : "—"}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{winner && posTotal > 0 ? `${Math.round((winner.votes / posTotal) * 100)}%` : "—"}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">
                        {posBallots > 0 ? `${Math.round((abstains / posBallots) * 100)}%` : "—"}
                        <span className="text-gray-300 ml-1">({abstains})</span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{winner?.gradeLevel || "—"}</td>
                      <td className="py-3 px-4">
                        {list.length > 0 ? (
                          <select
                            defaultValue="0"
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white"
                            title="All candidates for this position, sorted by votes (highest first)"
                          >
                            {list.map((c, i) => (
                              <option key={c.id} value={String(i)}>
                                {i + 1}. {c.name} — {c.votes.toLocaleString()} vote{c.votes === 1 ? "" : "s"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {positions.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400 text-sm">No results yet.</td></tr>
                )}
              </tbody>
           </table>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
          <ChevronDown size={12} /> Click any row to open the dropdown and see all candidates for that position, sorted by votes (highest first). The winner is shown by default.
        </div>
      </motion.div>
    </div>
  );
}

/** Turnout estimate kept for the printable accomplishment report only. */
function electionPeriodIsActiveGuard(ballots: number): number {
  return ballots;
}