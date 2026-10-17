import { useState, useEffect } from "react";
import { Shield, BookOpen, UserPlus, Loader2, Crown, KeyRound, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useApp, CommissionerRole, Commissioner } from "../../context/AppContext";
import {
  createCommissioner, createSslgAdviser, resetPassword,
  listStaffRosterRpc, removeOfficerRpc, type StaffRosterRow,
} from "../../lib/supabaseData";
import { TempPasswordModal } from "../../components/TempPasswordModal";
import { useConfirm } from "../../lib/useConfirm";

/**
 * D-01 Officer Management (05-01 T3 — the Chief's appointment surface;
 * replaces the old commissioners page).
 *
 * The Chief's appointment surface: lists commissioners (+ co-commissioners)
 * and SSLG advisers, and provisions new accounts through the existing
 * createCommissioner / createSslgAdviser edge functions.  Every successful
 * creation opens the D-03 TempPasswordModal — the one-time temp password
 * is shown exactly once and never persisted.
 *
 * 05-02 (D-05 / ACCT-04): each commissioner/co-commissioner row gains a
 * "Reset password" action — confirmation -> resetPassword -> the same
 * D-03 show-once modal.  The reset sets must_change_password=true and
 * kills the target's sessions (D-14).  The chief row has no reset action
 * (the Chief's own password is managed via the change-password surface).
 *
 * 068: each commissioner/co-commissioner row also gains a "Remove" action
 * — confirmation -> chief-gated remove_officer_rpc (068 migration) which
 * deletes the adminprofiles row, purges the target's sessions, and keeps
 * history via the set-null FK contract.  The chief row has no remove
 * action, and the RPC refuses the chief row and self-removal server-side.
 *
 * The removed Commissioner of Appointment role ('appointment') has no
 * presence here (Phase 3 REMOVE-08), and there is NO hardcoded-password
 * fallback path (R3) — provisioning only ever returns a generated
 * one-time password from the edge function.
 */
const commissionerRoles: Array<{ value: CommissionerRole; label: string }> = [
  { value: "screening_validation", label: "Commissioner of Screening & Validation" },
  { value: "electoral_board", label: "Commissioner of Electoral Board" },
  { value: "grievance", label: "Commissioner of Grievance" },
];

const roleLabel: Record<string, string> = {
  chief: "Chief Commissioner",
  screening_validation: "Screening & Validation",
  electoral_board: "Electoral Board",
  grievance: "Grievance",
};

interface SslgAdviserRow {
  id: string;
  name: string;
  email: string;
  status: string;
}

export default function ChiefAppointments() {
  // audit actor = the acting chief's real name (falls back to the role
  // label for non-chief/legacy contexts).
  const { addLog, currentUser } = useApp();
  const actorName = currentUser?.name || "Chief Commissioner";

  const [cForm, setCForm] = useState({ firstName: "", lastName: "", email: "", role: "screening_validation" as CommissionerRole });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);

  const [sslForm, setSslForm] = useState({ firstName: "", lastName: "", email: "" });
  const [creatingSsl, setCreatingSsl] = useState(false);

  // 046: the existing roster (commissioners + SSLG advisers) is read
  // through the chief-gated list_staff_roster_rpc — 037 dropped the
  // commissioners/sslg_advisers tables and 038 revoked direct SELECT on
  // adminprofiles, so this SECURITY DEFINER RPC is the only client-readable
  // roster surface.
  const [roster, setRoster] = useState<StaffRosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);

  const loadRoster = async () => {
    setLoadingRoster(true);
    try {
      setRoster(await listStaffRosterRpc());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the staff roster.");
    } finally {
      setLoadingRoster(false);
    }
  };

  useEffect(() => {
    void loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Existing officers, mapped from the roster (never password material).
  const commissioners: Commissioner[] = roster
    .filter((r) => r.role_type === "chief" || r.role_type === "commissioner" || r.role_type === "co_commissioner")
    .map((r) => ({
      id: r.id,
      name: r.full_name || "—",
      email: r.email || "—",
      role: (r.commissioner_role || (r.role_type === "chief" ? "chief" : "screening_validation")) as CommissionerRole,
      status: r.status === "inactive" ? "inactive" : "active",
      appointedAt: (r.appointed_at || "").slice(0, 10),
    }));

  const sslAdvisers: SslgAdviserRow[] = roster
    .filter((r) => r.role_type === "sslg_adviser")
    .map((r) => ({
      id: r.id,
      name: r.full_name || "—",
      email: r.email || "—",
      status: r.status,
    }));

  // 05-02 (D-05): per-commissioner/co-commissioner "Reset password" action.
  const [resettingId, setResettingId] = useState<string | null>(null);
  const resetConfirm = useConfirm({
    title: "Reset Password?",
    description: "This generates a new one-time temporary password for the account. Every existing session is signed out immediately and the next login forces a password change (D-04).",
    confirmText: "Reset Password",
    destructive: true,
  });

  // 068: per-commissioner/co-commissioner "Remove" action. The RPC refuses
  // the chief row and self-removal server-side; the button is likewise
  // never rendered on the chief row.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeConfirm = useConfirm({
    title: "Remove Officer?",
    description: "This permanently deletes the commissioner account. Their sessions are signed out immediately and they can no longer log in. Past records that referenced them are kept, without the attribution. This cannot be undone.",
    confirmText: "Remove",
    destructive: true,
  });

  // (roster loaded above — the adviser list reflects existing accounts)

  const resetCommissionerPassword = async (commissioner: Commissioner) => {
    const ok = await resetConfirm.confirm();
    if (!ok) return;
    setError("");
    setResettingId(commissioner.id);
    try {
      // targetRole 'commissioner' covers co-commissioner rows too — both
      // live in the commissioners table and the edge fn resolves by id.
      const result = await resetPassword("commissioner", commissioner.id);
      setTempPassword({ name: result.name, email: result.email, password: result.password });
      addLog({
        user: actorName,
        role: "Admin",
        action: "Reset Password",
        details: `Reset password for ${result.name} (${result.email})`,
        type: "warning",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset the password.");
    } finally {
      setResettingId(null);
    }
  };

  // 068: remove a commissioner/co-commissioner account (chief-gated RPC).
  const removeOfficer = async (commissioner: Commissioner) => {
    const ok = await removeConfirm.confirm();
    if (!ok) return;
    setError("");
    setRemovingId(commissioner.id);
    try {
      await removeOfficerRpc(commissioner.id);
      addLog({
        user: actorName,
        role: "Admin",
        action: "Removed Officer",
        details: `Removed ${commissioner.name} (${commissioner.email})`,
        type: "warning",
      });
      await loadRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the officer.");
    } finally {
      setRemovingId(null);
    }
  };

  const fullName = (f: string, l: string) => `${f.trim().charAt(0).toUpperCase() + f.trim().slice(1)} ${l.trim().charAt(0).toUpperCase() + l.trim().slice(1)}`.trim();

  const appointCommissioner = async () => {
    if (!cForm.firstName.trim() || !cForm.lastName.trim() || !cForm.email.trim()) return;
    setError("");
    setCreating(true);
    const name = fullName(cForm.firstName, cForm.lastName);
    try {
      const result = await createCommissioner(name, cForm.email.trim(), cForm.role);
      setTempPassword({ name, email: result.email, password: result.password });
      await loadRoster();
      addLog({
        user: actorName,
        role: "Admin",
        action: "Appointed Commissioner",
        details: `${name} appointed as ${roleLabel[cForm.role] || cForm.role} Commissioner`,
        type: "success",
      });
      setCForm({ firstName: "", lastName: "", email: "", role: "screening_validation" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create commissioner account.");
    } finally {
      setCreating(false);
    }
  };

  const appointSslgAdviser = async () => {
    if (!sslForm.firstName.trim() || !sslForm.lastName.trim() || !sslForm.email.trim()) return;
    setError("");
    setCreatingSsl(true);
    const name = fullName(sslForm.firstName, sslForm.lastName);
    try {
      const result = await createSslgAdviser(name, sslForm.email.trim());
      setTempPassword({ name, email: result.email, password: result.password });
      await loadRoster();
      addLog({
        user: actorName,
        role: "Admin",
        action: "Appointed SSLG Adviser",
        details: `${name} appointed as SSLG Adviser`,
        type: "success",
      });
      setSslForm({ firstName: "", lastName: "", email: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create SSLG Adviser account.");
    } finally {
      setCreatingSsl(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Officer Management</h1>
        <p className="text-gray-500 text-sm">
          Appoint commissioners and SSLG advisers, or reset an account's password. Each reset generates a one-time temporary password shown once. Removing an officer deletes their account permanently.
        </p>
      </motion.div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {/* Commissioner creation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-1 text-sm flex items-center gap-2">
          <Shield size={16} style={{ color: "#5C0102" }} /> Appoint Commissioner
        </h3>
        <p className="text-xs text-gray-400 mb-4">Commissioner of Screening &amp; Validation, Electoral Board, or Grievance.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">First Name</label>
            <input
              value={cForm.firstName}
              onChange={(e) => setCForm({ ...cForm, firstName: e.target.value })}
              placeholder="First name"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Last Name</label>
            <input
              value={cForm.lastName}
              onChange={(e) => setCForm({ ...cForm, lastName: e.target.value })}
              placeholder="Last name"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={cForm.email}
              onChange={(e) => setCForm({ ...cForm, email: e.target.value })}
              placeholder="account@cnnhs.edu"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Role</label>
            <select
              value={cForm.role}
              onChange={(e) => setCForm({ ...cForm, role: e.target.value as CommissionerRole })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            >
              {commissionerRoles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              onClick={appointCommissioner}
              disabled={creating}
              className="px-4 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
              style={{ backgroundColor: "#5C0102" }}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {creating ? "Appointing..." : "Appoint Commissioner"}
            </button>
          </div>
        </div>
      </div>

      {/* Commissioners list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-3 text-sm flex items-center gap-2">
          <Crown size={16} style={{ color: "#5C0102" }} /> Commissioners
          {loadingRoster && <Loader2 size={12} className="animate-spin text-gray-400" />}
        </h3>
        {commissioners.length === 0 ? (
          <p className="text-sm text-gray-400">{loadingRoster ? "Loading officers..." : "No commissioners appointed yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Name</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Email</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Role</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Status</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {commissioners.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3 px-4 text-gray-900 font-medium">
                      {c.name}
                      {c.role === "chief" && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Chief</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{c.email}</td>
                    <td className="py-3 px-4 text-gray-500">{roleLabel[c.role] || c.role}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {c.role !== "chief" && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => resetCommissionerPassword(c)}
                            disabled={resettingId === c.id || removingId === c.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                            title="Reset password — the next login forces a change (D-04)"
                          >
                            {resettingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                            {resettingId === c.id ? "Resetting..." : "Reset password"}
                          </button>
                          <button
                            onClick={() => removeOfficer(c)}
                            disabled={removingId === c.id || resettingId === c.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                            title="Remove this officer account permanently"
                          >
                            {removingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            {removingId === c.id ? "Removing..." : "Remove"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SSLG Adviser creation + list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-1 text-sm flex items-center gap-2">
          <BookOpen size={16} style={{ color: "#5C0102" }} /> Appoint SSLG Adviser
        </h3>
        <p className="text-xs text-gray-400 mb-4">SSLG Advisers supervise students and approve registrations.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">First Name</label>
            <input
              value={sslForm.firstName}
              onChange={(e) => setSslForm({ ...sslForm, firstName: e.target.value })}
              placeholder="First name"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Last Name</label>
            <input
              value={sslForm.lastName}
              onChange={(e) => setSslForm({ ...sslForm, lastName: e.target.value })}
              placeholder="Last name"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={sslForm.email}
              onChange={(e) => setSslForm({ ...sslForm, email: e.target.value })}
              placeholder="adviser@cnnhs.edu"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div>
            <button
              onClick={appointSslgAdviser}
              disabled={creatingSsl}
              className="px-4 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
              style={{ backgroundColor: "#5C0102" }}
            >
              {creatingSsl ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {creatingSsl ? "Appointing..." : "Appoint Adviser"}
            </button>
          </div>
        </div>

        {sslAdvisers.length > 0 && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Name</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Email</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sslAdvisers.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 px-4 text-gray-900 font-medium">{a.name}</td>
                    <td className="py-3 px-4 text-gray-600">{a.email}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tempPassword && (
        <TempPasswordModal
          name={tempPassword.name}
          email={tempPassword.email}
          password={tempPassword.password}
          onClose={() => setTempPassword(null)}
        />
      )}

      {resetConfirm.dialog}
      {removeConfirm.dialog}
    </div>
  );
}