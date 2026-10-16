import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertCircle, CheckCircle2, Loader2, Trophy } from "lucide-react";
import { getOfficialResults, type PastElectionResults } from "../lib/supabaseData";
import ElectionResultsView from "../components/ElectionResultsView";

/**
 * The CURRENT election's official results.
 *
 * A published result stays here until the Electoral Board Commissioner
 * creates a new election; only then does it move to /past-elections.
 */
export default function OfficialResultsPage() {
  const [results, setResults] = useState<PastElectionResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHasError(false);

    getOfficialResults()
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
  }, []);

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <Loader2 className="animate-spin mb-4" size={36} style={{ color: "#5C0102" }} />
            <p className="text-gray-600">Loading official results...</p>
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl text-gray-900 mb-2">Unable to Load Official Results</h1>
            <p className="text-gray-500 max-w-md">
              We could not retrieve the current results. Please try again later.
            </p>
            <Link
              to="/"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : !results ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-5">
              <Trophy size={36} className="text-gray-400" />
            </div>
            <h1 className="text-3xl text-gray-900 mb-3">No Official Results Yet</h1>
            <p className="text-gray-500 max-w-md">
              The official results for the current election appear here once the
              Electoral Board publishes them. Finished elections move to Past
              Elections when a new election begins.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/current-election"
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
                style={{ backgroundColor: "#5C0102" }}
              >
                <CheckCircle2 size={16} />
                View Current Election
              </Link>
              <Link
                to="/past-elections"
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-100"
              >
                Past Elections
              </Link>
            </div>
          </div>
        ) : (
          <ElectionResultsView results={results} eyebrow="Official results" />
        )}
      </div>
    </div>
  );
}
