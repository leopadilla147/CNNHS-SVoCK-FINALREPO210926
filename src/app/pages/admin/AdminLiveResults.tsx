import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Lock, RefreshCw, Trophy, Activity, Users, BarChart3 } from "lucide-react";

type LiveResult = {
  candidate_id: string;
  given_name: string;
  surname: string;
  party_name: string | null;
  position: string;
  votes: number;
};

const POSITIONS = [
  "President", "Vice President", "Secretary", "Treasurer", "Auditor", "PRO", "PIO", "Protocol Officer",
  "Grade 7 Representative", "Grade 8 Representative", "Grade 9 Representative",
  "Grade 10 Representative", "Grade 11 Representative", "Grade 12 Representative"
];

export default function AdminLiveResults() {
  const { candidates: contextCandidates, electionPeriod } = useApp();
  const [liveResults, setLiveResults] = useState<Map<string, LiveResult[]>>(new Map());
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const electionIdRef = useRef<string | null>(null);

  const approved = contextCandidates.filter((c) => c.status === "approved");
  const showResults = electionPeriod.isActive || electionPeriod.resultsPublished;

  const fetchLiveResults = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase.rpc("get_live_results_rpc");
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
                     <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                       <Users size={12}/> {totalVotes.toLocaleString()} {totalVotes === 1 ? "vote" : "votes"}
                     </div>
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
                  
                  return (
                    <div key={candidate.id} className={`relative overflow-hidden rounded-2xl p-3 flex items-center gap-3 z-10 transition-colors border ${isLeader ? 'bg-white border-amber-200/60 shadow-sm' : 'bg-white/60 border-transparent hover:bg-white hover:border-gray-100'}`}>
                      {/* Progress Bar Background */}
                      <div 
                        className={`absolute left-0 top-0 bottom-0 opacity-[0.08] z-0 ${isLeader ? 'bg-amber-500' : 'bg-[#5C0102]'}`} 
                        style={{ width: `${percentage}%`, transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
                      />
                      
                      <div className="z-10 flex items-center justify-center w-6 shrink-0">
                        {isLeader ? (
                           <Trophy size={20} className="text-amber-500 drop-shadow-sm" />
                        ) : (
                           <span className="text-xs font-black text-gray-300">{index + 1}</span>
                        )}
                      </div>
                      
                      {candidate.picture ? (
                        <img
                          src={candidate.picture}
                          alt=""
                          className={`w-11 h-11 rounded-full object-cover z-10 border-2 shrink-0 ${isLeader ? 'border-amber-400' : 'border-gray-100'}`}
                        />
                      ) : (
                        <div className={`w-11 h-11 rounded-full z-10 flex items-center justify-center border-2 shrink-0 ${isLeader ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-gray-100 bg-gray-50 text-gray-400'}`}>
                           <Users size={18} />
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0 z-10">
                        <div className={`text-sm font-bold truncate leading-tight ${isLeader ? 'text-gray-900' : 'text-gray-700'}`}>{candidate.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                           <span className="text-[11px] font-semibold text-gray-500 truncate max-w-[120px]">{candidate.party}</span>
                           {hasVotes && (
                             <>
                               <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                               <span className={`text-[11px] font-black ${isLeader ? 'text-amber-600' : 'text-gray-400'}`}>{percentage.toFixed(1)}%</span>
                             </>
                           )}
                        </div>
                      </div>
                      
                      <div className="text-right z-10 pl-2 shrink-0">
                        <div className={`text-lg font-black leading-none ${isLeader ? 'text-green-600' : 'text-gray-900'}`}>
                           {candidate.votes.toLocaleString()}
                        </div>
                        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">votes</div>
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