import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Lock, Eye, RefreshCw, Wifi, WifiOff } from "lucide-react";

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
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl p-12 shadow-sm border border-gray-100 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Lock size={28} className="text-gray-400" />
          </div>
          <h2 className="text-gray-900 mb-2">Results Locked</h2>
          <p className="text-gray-500 text-sm">Election results will be available once the voting period begins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-gray-900">Live Election Results</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            electionPeriod.proclaimed
              ? "bg-amber-100 text-amber-700"
              : electionPeriod.resultsPublished
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
          }`}>
            {electionPeriod.proclaimed ? "Official" : electionPeriod.resultsPublished ? "Published" : "Unofficial"}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            {isSubscribed ? (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <Wifi size={12} /> Live
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <WifiOff size={12} /> Disconnected
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              title="Refresh results"
            >
              <RefreshCw size={16} className={`text-gray-500 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="text-gray-500 text-sm">
          Vote counts per position {!electionPeriod.proclaimed && !electionPeriod.resultsPublished && "(live, unofficial)"}
          {lastUpdated && ` · Last updated: ${lastUpdated.toLocaleTimeString()}`}
        </p>
      </motion.div>

      <div className="space-y-4">
        {POSITIONS.map((pos) => {
          const posCandidates = approved.filter((c) => c.position === pos);
          if (posCandidates.length === 0) return null;

          const positionResults = liveResults.get(pos) || [];
          const candidateVotes = posCandidates.map((c) => ({
            name: `${c.givenName} ${c.surname}`,
            votes: getVotes(pos, c.id),
            party: c.partyAffiliation || "Independent",
            picture: c.picture,
          })).sort((a, b) => b.votes - a.votes);

          const totalVotes = candidateVotes.reduce((s, c) => s + c.votes, 0);
          const winner = candidateVotes[0];

          return (
            <div key={pos} className="bg-white rounded-xl shadow-sm border border-gray-100">
              {/* Position Header */}
              <div className="flex items-center gap-3 p-4 border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Eye size={16} style={{ color: "#5C0102" }} />
                    <h3 className="text-gray-900 text-sm font-medium">{pos}</h3>
                    {winner && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                        Leading: {winner.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Total: {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
                    {lastUpdated && ` · Updated: ${lastUpdated.toLocaleTimeString()}`}
                  </p>
                </div>
              </div>

              {/* Candidates List */}
              <div className="divide-y divide-gray-50">
                {candidateVotes.map((candidate, index) => (
                  <div key={candidate.name} className="flex items-center gap-3 px-4 py-3">
                    <span className={`text-xs font-medium w-6 text-gray-400 ${index === 0 ? "text-green-600" : ""}`}>
                      {index + 1}
                    </span>
                    {candidate.picture && (
                      <img
                        src={candidate.picture}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 font-medium truncate">{candidate.name}</div>
                      <div className="text-xs text-gray-400 truncate">{candidate.party}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900">{candidate.votes.toLocaleString()}</div>
                      <div className="text-xs text-gray-400">votes</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}