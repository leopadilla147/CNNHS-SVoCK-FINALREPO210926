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
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          to="/past-elections"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft size={16} />
          All past elections
        </Link>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <Loader2 className="animate-spin mb-4" size={36} style={{ color: "#5C0102" }} />
            <p className="text-gray-600">Loading official results...</p>
          </div>
        ) : hasError || !results ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl text-gray-900 mb-2">Results Not Available</h1>
            <p className="text-gray-500 max-w-md">
              These results are either not published yet or the election does not exist.
            </p>
            <Link
              to="/past-elections"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Back to Past Elections
            </Link>
          </div>
        ) : (
          <ElectionResultsView results={results} eyebrow="Past election record" />
        )}
      </div>
    </div>
  );
}
