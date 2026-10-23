import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  getLiveAbstainSummaryRpc,
  getProclamationAnnotations,
  type LiveAbstainSummaryRow,
  type ProclamationAnnotations,
} from "../../lib/supabaseData";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Lock, RefreshCw, Trophy, Activity, Users, BarChart3, MinusCircle, Gavel } from "lucide-react";
import { FULL_POSITION_ORDER as POSITIONS } from "../../lib/partyScope";
import { complaintsForElection } from "../../lib/complaints";
import { ComplaintRecordSection } from "../../components/ComplaintRecordSection";

type LiveResult = {
  candidate_id: string;
  given_name: string;
  surname: string;
  party_name: string | null;
  position: string;
  votes: number;
};

export default function AdminLiveResults() {
  const { candidates: contextCandidates, electionPeriod, complaints = [] } = useApp();
  const [liveResults, setLiveResults] = useState<Map<string, LiveResult[]>>(new Map());
  // 079: per-position abstain counts, kept in step with the live tally —
  // abstain rows are votes INSERTs, so the realtime subscription refreshes
  // them through the same fetchLiveResults call.
  const [abstainByPosition, setAbstainByPosition] = useState<Map<string, number>>(new Map());
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // 081 — the proclamation record: which positions were ties (and how each
  // was resolved), the proclaimed winner per position, and the board's note
  // on the complaint(s) of record.  Loaded once per mount + manual refresh.
  const [annotations, setAnnotations] = useState<ProclamationAnnotations>({ ties: [] });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const electionIdRef = useRef<string | null>(null);

  const approved = contextCandidates.filter((c) => c.status === "approved");
  const showResults = electionPeriod.isActive || electionPeriod.resultsPublished;

  const fetchLiveResults = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      // The abstain RPC fails soft (e.g. unexpected role gate) so the vote
      // tally always renders; abstains just stay at their previous value.
      const [{ data, error }, abstainRows] = await Promise.all([
        supabase.rpc("get_live_results_rpc"),
        getLiveAbstainSummaryRpc().catch(() => [] as LiveAbstainSummaryRow[]),
      ]);
      if (error) {
        console.warn("get_live_results_rpc query failed, falling back to context candidates:", error.message);
        return;
      }
      if (!data) return;
      const grouped = new Map<string, LiveResult[]>();
      (data as LiveResult[]).forEach((r) => {
        if (!grouped.has(r.position)) grouped.set(r.position, []);
        grouped.get(r.position)!.push(r);
      });
      setLiveResults(grouped);
      const abstains = new Map<string, number>();
      abstainRows.forEach((r) => abstains.set(r.position, r.abstain_count));
      setAbstainByPosition(abstains);
      setLastUpdated(new Date());
    } catch (err) {
      console.warn("Failed to fetch live results:", err);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (!showResults || !isSupabaseConfigured || !supabase) return;

    fetchLiveResults();

    const setupRealtime = async () => {
      const { data: ep } = await supabase!
        .from("election_periods")
        .select("id")
        .order("election_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!alive) return;
      electionIdRef.current = ep?.id || null;
      // 081 — load the tie/proclamation/complaint record for the period; the
      // helper fails soft so an un-migrated database just shows no badges.
      if (electionIdRef.current) {
        getProclamationAnnotations(electionIdRef.current).then((record) => {
          if (alive) setAnnotations(record);
        });
      }

      if (channelRef.current) {
        supabase!.removeChannel(channelRef.current);
      }

      const filter = ep?.id
        ? `election_period_id=eq.${ep.id}`
        : undefined;

      channelRef.current = supabase!
        .channel("live-votes")
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "votes", filter },
          () => {
            fetchLiveResults();
          }
        )
        .subscribe((status) => {
          setIsSubscribed(status === "SUBSCRIBED");
        });
    };

    setupRealtime();

    return () => {
      alive = false;
      if (channelRef.current) {
        supabase!.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [showResults, fetchLiveResults]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchLiveResults();
    // 081 — a manual refresh may follow a fresh proclamation, so the tie /
    // winner / complaint record is re-read alongside the tally.
    if (electionIdRef.current) {
      setAnnotations(await getProclamationAnnotations(electionIdRef.current));
    }
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const getVotes = (pos: string, candidateId: string): number => {
    const positionResults = liveResults.get(pos);
    if (positionResults) {
      const found = positionResults.find((r) => r.candidate_id === candidateId);
      if (found) return found.votes;
    }
    return 0;
  };

  // Header total: candidate votes summed across every position.  Abstains
  // are not votes for a candidate, so they are excluded here (they show
  // beside each position's vote count instead).
  const totalVotesAll = useMemo(
    () =>
      [...liveResults.values()].reduce(
        (sum, rows) => sum + rows.reduce((s, r) => s + (Number(r.votes) || 0), 0),
        0,
      ),
    [liveResults],
  );

  // 099 — the election's complaint record, straight from the admin context
  // (the complaints table is admin-readable), shaped for the shared record
  // section: substantiated grievances with their findings, other decisions,
  // and whatever is still on file.
  const liveComplaints = useMemo(
    () =>
      complaintsForElection(complaints, electionPeriod.id).map((c) => ({
        id: c.id,
        subject: c.subject,
        status: c.status,
        decision: c.decision ?? null,
        findings: c.findings ?? null,
      })),
    [complaints, electionPeriod.id],
  );

  if (!showResults) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6 md:p-8">
        <motion.div 
           initial={{ opacity: 0, scale: 0.95 }} 
           animate={{ opacity: 1, scale: 1 }} 
           className="bg-white/90 backdrop-blur-xl rounded-3xl p-12 max-w-md w-full shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-gray-100 text-center relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#5C0102]/20 via-[#5C0102] to-[#5C0102]/20" />
          <div className="w-24 h-24 rounded-full bg-gray-50 border-2 border-gray-100 flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Lock size={36} className="text-[#5C0102]/60" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">Results Locked</h2>
          <p className="text-gray-500 text-sm leading-relaxed font-medium">
            Live election results will automatically become available here once the voting period begins.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
           <div className="p-3 rounded-2xl bg-[#5C0102]/5 border border-[#5C0102]/10 text-[#5C0102] mt-1 lg:mt-0">
              <Activity size={28} />
           </div>
           <div>
             <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">Live Election Results</h1>
             <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-2">
               <span className={`text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full font-bold ${
                 electionPeriod.proclaimed
                   ? "bg-amber-100 text-amber-700 border border-amber-200"
                   : electionPeriod.resultsPublished
                     ? "bg-green-100 text-green-700 border border-green-200"
                     : "bg-[#5C0102]/10 text-[#5C0102] border border-[#5C0102]/20"
               }`}>
                 {electionPeriod.proclaimed ? "Official" : electionPeriod.resultsPublished ? "Published" : "Unofficial"}
               </span>
               <p className="text-sm font-medium text-gray-500 flex items-center gap-2">
                 <span className="hidden md:inline">•</span>
                 {!electionPeriod.proclaimed && !electionPeriod.resultsPublished ? "Live vote counting in progress" : "Final vote tallies"}
               </p>
             </div>
           </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
           <div className="flex items-center gap-2.5 min-w-[130px]">
             <div className="p-2 rounded-xl bg-[#5C0102]/5 border border-[#5C0102]/10 text-[#5C0102]">
               <BarChart3 size={16} />
             </div>
             <div className="leading-tight">
               <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total Votes</div>
               <div className="text-lg font-black text-gray-900">{totalVotesAll.toLocaleString()}</div>
             </div>
           </div>

           <div className="hidden sm:block h-6 w-px bg-gray-300"></div>

           <div className="flex items-center gap-2 min-w-[130px]">
             {isSubscribed ? (
               <>
                 <span className="relative flex h-3 w-3">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                 </span>
                 <span className="text-xs font-bold text-green-600 uppercase tracking-widest">Live System</span>
               </>
             ) : (
               <>
                 <span className="relative flex h-3 w-3">
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-gray-400"></span>
                 </span>
                 <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Disconnected</span>
               </>
             )}
           </div>
           
           <div className="hidden sm:block h-6 w-px bg-gray-300"></div>

           <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
             {lastUpdated && (
               <div className="text-[11px] font-semibold text-gray-400 text-right sm:text-left leading-tight">
                 <div>Last updated</div>
                 <div className="text-gray-600">{lastUpdated.toLocaleTimeString()}</div>
               </div>
             )}
             <button
               onClick={handleRefresh}
               disabled={isRefreshing}
               className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 shadow-sm text-sm font-bold text-gray-700"
             >
               <RefreshCw size={16} className={`${isRefreshing ? "animate-spin text-[#5C0102]" : "text-gray-500"}`} />
               <span className="hidden sm:inline">Refresh</span>
             </button>
           </div>
        </div>
      </motion.div>

      <div className="mb-6">
        <ComplaintRecordSection
          entries={liveComplaints}
          complaintNote={annotations.complaintNote}
          decisionReason={annotations.decisionReason}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {POSITIONS.map((pos) => {
          const posCandidates = approved.filter((c) => c.position === pos);
          if (posCandidates.length === 0) return null;

          const positionResults = liveResults.get(pos) || [];
          const candidateVotes = posCandidates.map((c) => ({
            id: c.id,
            name: `${c.givenName} ${c.surname}`,
            votes: getVotes(pos, c.id),
            party: c.partyAffiliation || "Independent",
            picture: c.picture,
          })).sort((a, b) => b.votes - a.votes);

          const totalVotes = candidateVotes.reduce((s, c) => s + c.votes, 0);
          const winner = candidateVotes[0];
          const hasVotes = totalVotes > 0;
          // 081 — the proclamation record for this position: the tie badge in
          // the header and the per-candidate "Proclaimed winner" badge.
          const positionProclamation = annotations.ties.find((t) => t.position === pos);
          const positionTie = positionProclamation?.wasTie ? positionProclamation : undefined;

          return (
            <motion.div 
              key={pos} 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="bg-white rounded-3xl shadow-sm hover:shadow-md transition-shadow border border-gray-100 overflow-hidden flex flex-col"
            >
              {/* Position Header */}
              <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100 bg-gradient-to-br from-gray-50 to-white">
                <div className="flex gap-3 items-start">
                   <div className="p-2.5 rounded-xl bg-[#5C0102]/5 border border-[#5C0102]/10 text-[#5C0102]">
                     <BarChart3 size={20} />
                   </div>
                   <div className="flex-1 min-w-0 pt-0.5">
                     <h3 className="text-gray-900 font-black text-lg leading-tight mb-1">{pos}</h3>
                     <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                       <Users size={12}/> {totalVotes.toLocaleString()} {totalVotes === 1 ? "vote" : "votes"}
                       <span className="text-gray-300">•</span>
                       <MinusCircle size={12}/> {(abstainByPosition.get(pos) ?? 0).toLocaleString()}{" "}
                       {(abstainByPosition.get(pos) ?? 0) === 1 ? "abstain" : "abstains"}
                     </div>
                     {positionTie && (
                       <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                         <Gavel size={11} />
                         {positionTie.tieBreakNote ? `Tie — resolved via ${positionTie.tieBreakNote}` : "Tie resolved by the Board"}
                       </span>
                     )}
                   </div>
                </div>
              </div>

              {/* Candidates List */}
              <div className="p-3 flex-1 flex flex-col gap-2 bg-gray-50/30">
                {candidateVotes.map((candidate, index) => {
                  const percentage = hasVotes ? (candidate.votes / totalVotes) * 100 : 0;
                  const isWinner = index === 0 && candidate.votes > 0;
                  const isTie = index > 0 && candidate.votes === winner.votes && candidate.votes > 0;
                  const isLeader = isWinner || isTie;
                  // 081 — the board's proclaimed pick: the whole row wears the
                  // proclamation colour, matching the Proclamation Dialog.
                  const isProclaimed = positionProclamation?.candidateId === candidate.id;

                  return (
                    <div key={candidate.id} className={`relative overflow-hidden rounded-2xl p-3 flex items-center gap-3 z-10 transition-colors border ${isProclaimed ? 'bg-[#5C0102] border-[#5C0102] shadow-sm' : isLeader ? 'bg-white border-amber-200/60 shadow-sm' : 'bg-white/60 border-transparent hover:bg-white hover:border-gray-100'}`}>
                      {/* Progress Bar Background */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 z-0 ${isProclaimed ? 'bg-white opacity-[0.14]' : `opacity-[0.08] ${isLeader ? 'bg-amber-500' : 'bg-[#5C0102]'}`}`}
                        style={{ width: `${percentage}%`, transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
                      />

                      <div className="z-10 flex items-center justify-center w-6 shrink-0">
                        {isLeader || isProclaimed ? (
                           <Trophy size={20} className={isProclaimed ? 'text-amber-300 drop-shadow-sm' : 'text-amber-500 drop-shadow-sm'} />
                        ) : (
                           <span className="text-xs font-black text-gray-300">{index + 1}</span>
                        )}
                      </div>

                      {candidate.picture ? (
                        <img
                          src={candidate.picture}
                          alt=""
                          className={`w-11 h-11 rounded-full object-cover z-10 border-2 shrink-0 ${isProclaimed ? 'border-white' : isLeader ? 'border-amber-400' : 'border-gray-100'}`}
                        />
                      ) : (
                        <div className={`w-11 h-11 rounded-full z-10 flex items-center justify-center border-2 shrink-0 ${isProclaimed ? 'border-white bg-white/10 text-white/70' : isLeader ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-gray-100 bg-gray-50 text-gray-400'}`}>
                           <Users size={18} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0 z-10">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-sm font-bold truncate leading-tight ${isProclaimed ? 'text-white' : isLeader ? 'text-gray-900' : 'text-gray-700'}`}>{candidate.name}</span>
                          {isProclaimed ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white text-[#5C0102] border border-white px-2 py-0.5 text-[10px] font-bold">
                              <Gavel size={10} />
                              Proclaimed winner
                            </span>
                          ) : !electionPeriod.proclaimed && isLeader ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold">
                              <Trophy size={10} />
                              Leading
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                           <span className={`text-[11px] font-semibold truncate max-w-[120px] ${isProclaimed ? 'text-white/70' : 'text-gray-500'}`}>{candidate.party}</span>
                           {hasVotes && (
                             <>
                               <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                               <span className={`text-[11px] font-black ${isProclaimed ? 'text-white/80' : isLeader ? 'text-amber-600' : 'text-gray-400'}`}>{percentage.toFixed(1)}%</span>
                             </>
                           )}
                        </div>
                      </div>

                      <div className="text-right z-10 pl-2 shrink-0">
                        <div className={`text-lg font-black leading-none ${isProclaimed ? 'text-white' : isLeader ? 'text-green-600' : 'text-gray-900'}`}>
                           {candidate.votes.toLocaleString()}
                        </div>
                        <div className={`text-[9px] font-bold uppercase tracking-widest mt-1 ${isProclaimed ? 'text-white/60' : 'text-gray-400'}`}>votes</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}