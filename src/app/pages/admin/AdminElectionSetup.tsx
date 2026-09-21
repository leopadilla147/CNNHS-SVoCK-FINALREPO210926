import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar, Clock, MapPin, Save, Play, Square, Trophy,
  CheckCircle2, Lock, AlertCircle, Loader2, Eye,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useConfirm } from "../../lib/useConfirm";
import {
  getCurrentElectionId,
  openElectionRpc,
  closeElectionRpc,
  publishResultsRpc,
  proclaimWinnersRpc,
} from "../../lib/supabaseData";
import { isSupabaseConfigured } from "../../lib/supabase";

type Stage = "schedule" | "voting" | "results";

interface StageConfig {
  id: Stage;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const STAGES: StageConfig[] = [
  { id: "schedule", label: "Schedule", icon: <Calendar size={18} />, description: "Set the voting period start and end" },
  { id: "voting", label: "Voting", icon: <Play size={18} />, description: "Open and close the voting period" },
  { id: "results", label: "Results", icon: <Trophy size={18} />, description: "Publish results and proclaim winners" },
];

function getCurrentStage(electionPeriod: ReturnType<typeof useApp>["electionPeriod"]): Stage {
  if (electionPeriod.proclaimed) return "results";
  if (electionPeriod.resultsPublished) return "results";
  if (electionPeriod.isActive) return "voting";
  if (electionPeriod.startDate) return "voting";
  return "schedule";
}

function isStageComplete(stage: Stage, electionPeriod: ReturnType<typeof useApp>["electionPeriod"]): boolean {
  switch (stage) {
    case "schedule": return !!electionPeriod.startDate && !!electionPeriod.startTime && !!electionPeriod.endDate && !!electionPeriod.endTime;
    case "voting": return !!electionPeriod.isActive === false && !!electionPeriod.startDate;
    case "results": return !!electionPeriod.proclaimed;
  }
}

function isStageAccessible(stage: Stage, electionPeriod: ReturnType<typeof useApp>["electionPeriod"]): boolean {
  switch (stage) {
    case "schedule": return true;
    case "voting": return !!electionPeriod.startDate;
    case "results": return !!electionPeriod.isActive === false && !!electionPeriod.startDate;
  }
}

export default function AdminElectionSetup() {
  const { electionPeriod, setElectionPeriod, addLog, currentUser, candidates } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [electionId, setElectionId] = useState<string | null>(null);
  const [proclaimedWinners, setProclaimedWinners] = useState<{ position: string; winnerName: string; votes: number }[]>([]);

  const currentStage = getCurrentStage(electionPeriod);

  const [form, setForm] = useState({
    startDate: electionPeriod.startDate,
    startTime: electionPeriod.startTime,
    endDate: electionPeriod.endDate,
    endTime: electionPeriod.endTime,
    venue: electionPeriod.venue || "IoT biometric kiosk precinct",
    rulesDiscussionAt: electionPeriod.rulesDiscussionAt || "",
    votingMethod: electionPeriod.votingMethod || "plurality",
  });

  const saveConfirm = useConfirm({ title: "Save Election Schedule?", description: "This will save the voting period schedule.", confirmText: "Save" });
  const finalizeConfirm = useConfirm({ title: "Finalize Election Schedule?", description: "This will lock the voting period schedule. These settings cannot be changed after finalization.", confirmText: "Finalize Schedule", destructive: true });
  const openConfirm = useConfirm({ title: "Open Voting?", description: "This will start the voting period and enable kiosk voting.", confirmText: "Open Voting" });
  const closeConfirm = useConfirm({ title: "Close Voting?", description: "This will end the voting period early. Students will no longer be able to cast votes.", confirmText: "Close Voting", destructive: true });
  const publishConfirm = useConfirm({ title: "Publish Results?", description: "Election results will be visible to students and the public.", confirmText: "Publish" });
  const proclaimConfirm = useConfirm({ title: "Proclaim Winners?", description: "This will officially compute and proclaim the winners per position. This action is irreversible.", confirmText: "Proclaim Winners", destructive: true });

  const approvedCount = candidates.filter((c) => c.status === "approved").length;
  const logUser = currentUser?.name || "Electoral Board";

  useEffect(() => {
    if (isSupabaseConfigured) {
      getCurrentElectionId().then(setElectionId);
    }
  }, []);

  const showError = (msg: string) => {
    setError(msg);
    setSuccess(null);
    setTimeout(() => setError(null), 5000);
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 5000);
  };

  const handleSave = async () => {
    setError(null);
    if (!form.startDate || !form.endDate) {
      showError("Voting period start and end dates are required.");
      return;
    }
    if (form.endDate < form.startDate) {
      showError("End date must be after start date.");
      return;
    }
    const ok = await saveConfirm.confirm();
    if (!ok) return;
    setElectionPeriod({
      ...electionPeriod,
      ...form,
    });
    addLog({
      user: logUser, role: "Admin",
      action: "Election Schedule Updated",
      details: `Voting period: ${form.startDate} ${form.startTime} - ${form.endDate} ${form.endTime}, Rules discussion: ${form.rulesDiscussionAt || "TBD"}, Voting method: ${form.votingMethod}`,
      type: "info",
    });
    showSuccess("Election schedule saved.");
  };

  const handleFinalize = async () => {
    setError(null);
    if (!form.startDate || !form.startTime || !form.endDate || !form.endTime) {
      showError("Complete all voting period fields before finalizing.");
      return;
    }
    if (form.endDate < form.startDate) {
      showError("End date must be after start date.");
      return;
    }
    const ok = await finalizeConfirm.confirm();
    if (!ok) return;

    setLoading(true);
    try {
      setElectionPeriod({ ...electionPeriod, ...form });
      addLog({
        user: logUser, role: "Admin",
        action: "Election Schedule Finalized",
        details: "Voting period schedule has been finalized and locked.",
        type: "success",
      });
      showSuccess("Election schedule finalized successfully.");
    } catch (err: any) {
      showError(err.message || "Failed to finalize election schedule.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenElection = async () => {
    setError(null);
    const ok = await openConfirm.confirm();
    if (!ok) return;

    setLoading(true);
    try {
      if (electionId && isSupabaseConfigured) {
        await openElectionRpc(electionId);
      }
      setElectionPeriod({ ...electionPeriod, isActive: true });
      addLog({
        user: logUser, role: "Admin",
        action: "Election Opened",
        details: "Voting period has been opened.",
        type: "success",
      });
      showSuccess("Voting period is now open.");
    } catch (err: any) {
      showError(err.message || "Failed to open election.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseElection = async () => {
    setError(null);
    const ok = await closeConfirm.confirm();
    if (!ok) return;

    setLoading(true);
    try {
      if (electionId && isSupabaseConfigured) {
        await closeElectionRpc(electionId);
      }
      setElectionPeriod({ ...electionPeriod, isActive: false });
      addLog({
        user: logUser, role: "Admin",
        action: "Election Closed",
        details: "Voting period has been closed.",
        type: "warning",
      });
      showSuccess("Voting period closed.");
    } catch (err: any) {
      showError(err.message || "Failed to close election.");
    } finally {
      setLoading(false);
    }
  };

  const handlePublishResults = async () => {
    setError(null);
    const ok = await publishConfirm.confirm();
    if (!ok) return;

    setLoading(true);
    try {
      if (electionId && isSupabaseConfigured) {
        await publishResultsRpc(electionId);
      }
      setElectionPeriod({ ...electionPeriod, resultsPublished: true });
      addLog({
        user: logUser, role: "Admin",
        action: "Results Published",
        details: "Election results have been published.",
        type: "success",
      });
      showSuccess("Election results published.");
    } catch (err: any) {
      showError(err.message || "Failed to publish results.");
    } finally {
      setLoading(false);
    }
  };

  const handleProclaim = async () => {
    setError(null);
    const ok = await proclaimConfirm.confirm();
    if (!ok) return;

    setLoading(true);
    try {
      let winners: { position: string; winnerName: string; votes: number }[] = [];
      if (electionId && isSupabaseConfigured) {
        winners = await proclaimWinnersRpc(electionId);
      }
      setProclaimedWinners(winners);
      setElectionPeriod({ ...electionPeriod, proclaimed: true, proclaimedAt: new Date().toISOString() });
      addLog({
        user: logUser, role: "Admin",
        action: "Winners Proclaimed",
        details: `Winners proclaimed for ${winners.length} positions.`,
        type: "success",
      });
      showSuccess(`Winners proclaimed for ${winners.length} positions.`);
    } catch (err: any) {
      showError(err.message || "Failed to proclaim winners.");
    } finally {
      setLoading(false);
    }
  };

  const stageStatus = (stage: Stage) => {
    const complete = isStageComplete(stage, electionPeriod);
    const current = currentStage === stage;
    const accessible = isStageAccessible(stage, electionPeriod);

    if (complete) return "complete";
    if (current) return "current";
    if (!accessible) return "locked";
    return "upcoming";
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-gray-900">Election Planning Hub</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Electoral Board</span>
        </div>
        <p className="text-gray-500 text-sm">Manage the election lifecycle: schedule the voting period, open/close voting, and proclaim winners.</p>
      </motion.div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {/* Progress Indicator */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-6">
        <div className="flex items-center justify-between">
          {STAGES.map((stage, i) => {
            const status = stageStatus(stage.id);
            return (
              <div key={stage.id} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    status === "complete" ? "bg-green-500 text-white" :
                    status === "current" ? "bg-[#5C0102] text-white" :
                    status === "locked" ? "bg-gray-100 text-gray-400" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {status === "complete" ? <CheckCircle2 size={16} /> : stage.icon}
                  </div>
                  <div className="hidden sm:block">
                    <div className={`text-xs font-medium ${
                      status === "complete" ? "text-green-600" :
                      status === "current" ? "text-[#5C0102]" :
                      "text-gray-400"
                    }`}>{stage.label}</div>
                    <div className="text-[10px] text-gray-400">{stage.description}</div>
                  </div>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${
                    status === "complete" ? "bg-green-500" :
                    "bg-gray-200"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage 1: Schedule */}
      <AnimatePresence mode="wait">
        <motion.div
          key="schedule"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="mb-6"
        >
          <div className={`bg-white rounded-xl p-6 shadow-sm border transition-all ${
            stageStatus("schedule") === "locked" ? "border-gray-100 opacity-60" :
            "border-gray-100"
          }`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-gray-900 text-sm flex items-center gap-2">
                <Calendar size={16} style={{ color: "#5C0102" }} />
                Stage 1: Voting Period Schedule
              </h3>
              {isStageComplete("schedule", electionPeriod) && (
                <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
                  <CheckCircle2 size={14} /> Scheduled
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Voting Period</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                    <input type="date" value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Start Time</label>
                    <input type="time" value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">End Date</label>
                    <input type="date" value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">End Time</label>
                    <input type="time" value={form.endTime}
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Venue</label>
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-gray-400" />
                    <input value={form.venue}
                      onChange={(e) => setForm({ ...form, venue: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Rules & Voting Method</h4>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Rules Discussion Date</label>
                    <input type="date" value={form.rulesDiscussionAt}
                      onChange={(e) => setForm({ ...form, rulesDiscussionAt: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" />
                    <p className="text-xs text-gray-400 mt-1">Date the election rules are discussed with candidates and party representatives.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Voting Method</label>
                    <select value={form.votingMethod}
                      onChange={(e) => setForm({ ...form, votingMethod: e.target.value })}
                      disabled={!!electionPeriod.startDate}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                      <option value="plurality">Plurality (highest votes wins)</option>
                      <option value="plurality_with_run_off">Plurality with Run-off</option>
                      <option value="ranked_choice">Ranked Choice</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">How winners are determined for each position.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <div className="text-xs text-gray-400">
                {electionPeriod.startDate ? "Schedule is locked" : "Save draft or finalize to lock settings"}
              </div>
              <div className="flex gap-2">
                {!electionPeriod.startDate && (
                  <>
                    <button onClick={handleSave}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-gray-200">
                      <Save size={15} /> Save Draft
                    </button>
                    <button onClick={handleFinalize} disabled={loading}
                      className="px-4 py-2 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: "#5C0102" }}>
                      {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      Finalize Schedule
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Stage 2: Voting */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !isStageAccessible("voting", electionPeriod) && !isStageComplete("voting", electionPeriod) ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Play size={16} style={{ color: "#5C0102" }} />
            Stage 2: Voting Period
          </h3>
          {electionPeriod.isActive && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <Play size={12} /> Voting Active
            </span>
          )}
          {!electionPeriod.isActive && electionPeriod.startDate && !electionPeriod.resultsPublished && (
            <span className="text-xs flex items-center gap-1 text-gray-400 font-medium">
              <Square size={12} /> Voting Closed
            </span>
          )}
        </div>
        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-400" />
            Voting period: {electionPeriod.startDate || "Not set"} {electionPeriod.startTime} &rarr; {electionPeriod.endDate || "Not set"} {electionPeriod.endTime}
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-gray-400" />
            Venue: {electionPeriod.venue || "Not set"}
          </div>
        </div>

        {!isStageAccessible("voting", electionPeriod) && !isStageComplete("voting", electionPeriod) ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Schedule the voting period first.
          </div>
        ) : (
          <div className="flex gap-3">
            {!electionPeriod.isActive && !electionPeriod.resultsPublished && (
              <button onClick={handleOpenElection} disabled={loading}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#5C0102" }}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Open Voting
              </button>
            )}
            {electionPeriod.isActive && (
              <button onClick={handleCloseElection} disabled={loading}
                className="px-5 py-2.5 bg-red-100 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-red-200 disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                Close Voting
              </button>
            )}
            {!electionPeriod.isActive && electionPeriod.startDate && !electionPeriod.resultsPublished && (
              <div className="flex items-center gap-2 text-xs text-gray-400 ml-2">
                <Eye size={14} />
                Or wait until the voting period ends automatically
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stage 3: Results */}
      <div className={`bg-white rounded-xl p-6 shadow-sm border mb-6 transition-all ${
        !isStageAccessible("results", electionPeriod) && !isStageComplete("results", electionPeriod) ? "opacity-60" : ""
      }`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 text-sm flex items-center gap-2">
            <Trophy size={16} style={{ color: "#5C0102" }} />
            Stage 3: Results & Proclamation
          </h3>
          {electionPeriod.resultsPublished && (
            <span className="text-xs flex items-center gap-1 text-green-600 font-medium">
              <CheckCircle2 size={14} /> Results Published
            </span>
          )}
          {electionPeriod.proclaimed && (
            <span className="text-xs flex items-center gap-1 text-amber-600 font-medium">
              <Trophy size={14} /> Winners Proclaimed
            </span>
          )}
        </div>

        {!isStageAccessible("results", electionPeriod) ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 p-3 bg-gray-50 rounded-lg">
            <Lock size={14} /> Close the voting period first to access results.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3">
              {!electionPeriod.resultsPublished && (
                <button onClick={handlePublishResults} disabled={loading || electionPeriod.isActive}
                  className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#5C0102" }}>
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
                  Publish Results
                </button>
              )}
              {electionPeriod.resultsPublished && !electionPeriod.proclaimed && (
                <button onClick={handleProclaim} disabled={loading}
                  className="px-5 py-2.5 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#5C0102" }}>
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}
                  Proclaim Winners
                </button>
              )}
            </div>

            {proclaimedWinners.length > 0 && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <h4 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                  <Trophy size={16} /> Proclaimed Winners
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {proclaimedWinners.map((w) => (
                    <div key={w.position} className="bg-white p-3 rounded-lg border border-amber-100 text-sm">
                      <div className="text-xs text-gray-500">{w.position}</div>
                      <div className="font-medium text-gray-900">{w.winnerName}</div>
                      <div className="text-xs text-gray-400">{w.votes} vote{w.votes !== 1 ? "s" : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(electionPeriod.proclaimed && proclaimedWinners.length === 0) && (
              <div className="text-sm text-gray-500 italic">
                Winners have been proclaimed. View full details in Live Results.
              </div>
            )}
          </div>
        )}
      </div>

      {saveConfirm.dialog}
      {finalizeConfirm.dialog}
      {openConfirm.dialog}
      {closeConfirm.dialog}
      {publishConfirm.dialog}
      {proclaimConfirm.dialog}
    </div>
  );
}