import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import {
  getPastElectionResults,
  type PastElectionResults,
} from "../lib/supabaseData";
import ElectionResultsView, { sortPositions } from "../components/ElectionResultsView";

// Re-exported so existing callers/tests keep importing it from the page.
export { sortPositions };

export default function PastElectionDetailPage() {
  const { electionId } = useParams<{ electionId: string }>();
  const [results, setResults] = useState<PastElectionResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!electionId) return;
    let active = true;
    setLoading(true);
    setHasError(false);

    getPastElectionResults(electionId)
      .then((result) => {
        if (active) setResults(result);
      })
      .catch(() => {
        if (active) {
          setResults(null);
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [electionId]);

  return (
    <div className="min-h-[70vh] bg-gradient-to-b from-stone-50 via-gray-50 to-stone-100/80 relative overflow-hidden">
      {/* Decorative ambient gradients */}
      <div className="absolute top-0 -left-20 w-96 h-96 rounded-full bg-red-100/30 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-20 w-96 h-96 rounded-full bg-amber-100/25 blur-3xl pointer-events-none" />

      <div className="max-w-7xl 2xl:max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 relative z-10">
        <Link
          to="/past-elections"
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold text-gray-700 bg-white border border-gray-200/90 border-b-2 border-b-gray-300 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:bg-stone-50 hover:text-[#5C0102] hover:border-[#5C0102]/30 active:translate-y-[1px] mb-6 transition-all cursor-pointer"
        >
          <ArrowLeft size={16} />
          All past elections
        </Link>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200/80 border-b-[3px] border-b-gray-300 shadow-[0_4px_12px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)] flex items-center justify-center mb-4">
              <Loader2 className="animate-spin" size={32} style={{ color: "#5C0102" }} />
            </div>
            <p className="text-gray-700 font-semibold text-sm">Loading official results...</p>
          </div>
        ) : hasError || !results ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 max-w-lg mx-auto bg-gradient-to-b from-white to-red-50/30 rounded-3xl border border-red-200/80 border-b-[4px] border-b-red-300 shadow-[0_12px_32px_-6px_rgba(239,68,68,0.1),inset_0_1px_0_rgba(255,255,255,1)] text-center" role="alert">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-b from-red-100 to-red-200/80 border border-red-300 border-b-2 border-b-red-400 flex items-center justify-center mb-4 shadow-[0_3px_8px_rgba(239,68,68,0.2)]">
              <AlertCircle size={32} className="text-red-600" />
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight mb-2">Results Not Available</h1>
            <p className="text-gray-600 text-sm max-w-md leading-relaxed">
              These results are either not published yet or the election does not exist.
            </p>
            <Link
              to="/past-elections"
              className="mt-6 px-5 py-2.5 rounded-xl text-white text-sm font-bold bg-gradient-to-b from-[#7A0203] via-[#5C0102] to-[#450001] border-b-[3px] border-b-[#2e0001] shadow-[0_3px_10px_rgba(92,1,2,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] hover:brightness-105 active:translate-y-[1px] active:border-b-2 transition-all cursor-pointer"
            >
              Back to Past Elections
            </Link>
          </div>
        ) : (
          <ElectionResultsView results={results} eyebrow="Past election record" showPositionTabs />
        )}
      </div>
    </div>
  );
}
