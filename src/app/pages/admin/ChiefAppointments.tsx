import { useState, useEffect } from "react";
import { Shield, BookOpen, UserPlus, Loader2, Crown, Trash2, AlertTriangle, Pencil, CornerDownRight } from "lucide-react";
import { motion } from "motion/react";
import { useApp, type CommissionerRole, type OfficerStatus, type Commissioner } from "../../context/AppContext";
import {
  createCommissioner, createCoCommissioner, createSslgAdviser,
  setAppointmentCommissioner, setOfficerStatus,
  listStaffRosterRpc, removeOfficerRpc,
  type StaffRosterRow,
} from "../../lib/supabaseData";
import { missingRequiredRoles } from "../../lib/staffReadiness";
import { TempPasswordModal } from "../../components/TempPasswordModal";
import { useConfirm } from "../../lib/useConfirm";

/**
 * D-01 Officer Management (05-01 T3 — the Chief's appointment surface;
 * replaces the old commissioners page).
 *
 * The commissioners table is the single surface for the four
 * commissioner slots — Screening & Validation, Electoral Board,
 * Grievance, and the records-only Commissioner of Appointment — each
 * shown in fixed order with its co-commissioner rows nested directly
 * beneath it (104: the roster returns co_commissioner_of).  A slot with
 * no officer renders a "Vacant" placeholder; the appointment slot's
 * placeholder carries a Designate action (name + email, NO account).
 *
 * 104 — "Add Co-commissioner" lives on each non-chief primary row
 * (including the appointment record).  New accounts get their ROLE'S
 * default password (electoral123 / grievance123 / screening123 /
 * sslg123 — bcrypt-hashed at rest, shown once in the D-03 modal).
 * The appointment commissioner's co-commissioner is records-only like
 * the appointment commissioner itself: name + email, no account, no
 * password, and the RPC returns null so no modal appears.
 *
 * 103 — creation moved from the legacy create_commissioner /
 * create_sslg_adviser edge functions (which still wrote the
 * commissioners/sslg_advisers tables 037 dropped) to chief-gated RPCs
 * over adminprofiles, the single staff identity table since 035.
 *
 * 103 — per-officer lifecycle status (Active / On Leave / Retired /
 * Resigned) via set_officer_status_rpc.  Retired/resigned officers are
 * signed out immediately and refuse future login; only Active counts
 * as serving the role.  The chief row exposes no status control
 * (succession is deliberately out of scope).  The per-row "Reset
 * password" action was removed at the Chief's request.
 *
 * 068: each row keeps a "Remove" action — confirmation ->
 * chief-gated remove_officer_rpc which deletes the adminprofiles row,
 * purges the target's sessions, and keeps history via the set-null FK
 * contract.  The chief row has no remove action, and the RPC refuses
 * the chief row and self-removal server-side.
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
  appointment: "Commissioner of Appointment",
};

/** Fixed slot order for the commissioners table (104). */
const ROLE_SLOT_ORDER: CommissionerRole[] = [
  "screening_validation",
  "electoral_board",
  "grievance",
  "appointment",
];

const statusLabel: Record<OfficerStatus, string> = {
  active: "Active",
  on_leave: "On Leave",
  retired: "Retired",
  resigned: "Resigned",
};

const statusStyles: Record<OfficerStatus, string> = {
  active: "bg-green-100 text-green-700",
  on_leave: "bg-amber-100 text-amber-700",
  retired: "bg-gray-100 text-gray-600",
  resigned: "bg-gray-100 text-gray-600",
};

const OFFICER_STATUSES: OfficerStatus[] = ["active", "on_leave", "retired", "resigned"];

/** Roster row + the nesting info needed to render it under its primary. */
interface OfficerRow extends Commissioner {
  roleType: string;
  /** 104: co_commissioner_of — null for primaries/chief/orphaned co rows. */
  primaryId: string | null;
}

interface SslgAdviserRow {
  id: string;
  name: string;
  email: string;
  status: string;
}

const toOfficerStatus = (raw: string): OfficerStatus =>
  (OFFICER_STATUSES as string[]).includes(raw) ? (raw as OfficerStatus) : "active";

/** Split a stored full name into the dialog's first/last fields. */
const splitName = (full: string): { first: string; last: string } => {
  const trimmed = full.trim();
  const idx = trimmed.indexOf(" ");
  return idx === -1
    ? { first: trimmed, last: "" }
    : { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1) };
};

/**
 * The name+email dialog reused for "Add Co-commissioner" and the
 * appointment designation (104).  Records-only flows are flagged in the
 * subtitle so the Chief knows no account is being created.
 */
function OfficerFormDialog({
  title,
  subtitle,
  submitLabel,
  initialName,
  initialEmail,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  initialName: string;
  initialEmail: string;
  busy: boolean;
  onSubmit: (name: string, email: string) => void;
  onClose: () => void;
}) {
  const parts = splitName(initialName);
  const [firstName, setFirstName] = useState(parts.first);
  const [lastName, setLastName] = useState(parts.last);
  const [email, setEmail] = useState(initialEmail);

  const valid = firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200"
      >
        <div className="p-5 text-white rounded-t-2xl" style={{ backgroundColor: "#5C0102" }}>
          <h3 className="text-white">{title}</h3>
          <p className="text-white/70 text-xs mt-1">{subtitle}</p>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">First Name</label>
              <input
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Last Name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="account@cnnhs.edu"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() => onSubmit(`${firstName.trim()} ${lastName.trim()}`, email)}
              className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              style={{ backgroundColor: "#5C0102" }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {busy ? "Saving..." : submitLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function ChiefAppointments() {
  // audit actor = the acting chief's real name (falls back to the role
  // label for non-chief/legacy contexts).
  const { addLog, currentUser } = useApp();
  const actorName = currentUser?.name || "Chief Commissioner";

  const [cForm, setCForm] = useState({ firstName: "", lastName: "", email: "", role: "screening_validation" as CommissionerRole });
  const [creating, setCreating] = useState(false);
  const [sslForm, setSslForm] = useState({ firstName: "", lastName: "", email: "" });
  const [creatingSsl, setCreatingSsl] = useState(false);
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);

  // 104: the per-row name+email dialog — co-commissioner creation and
  // the appointment designation share one surface.
  const [dialog, setDialog] = useState<
    | { kind: "co"; role: CommissionerRole; primaryName: string }
    | { kind: "appointment"; initialName: string; initialEmail: string }
    | null
  >(null);
  const [dialogBusy, setDialogBusy] = useState(false);

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
  const officers: OfficerRow[] = roster
    .filter((r) => r.role_type === "chief" || r.role_type === "commissioner" || r.role_type === "co_commissioner")
    .map((r) => ({
      id: r.id,
      name: r.full_name || "—",
      email: r.email || "—",
      roleType: r.role_type,
      primaryId: r.co_commissioner_of ?? null,
      role: (r.commissioner_role || (r.role_type === "chief" ? "chief" : "screening_validation")) as CommissionerRole,
      status: toOfficerStatus(r.status),
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

  // 104: the commissioners table renders the four role slots in fixed
  // order, each primary followed by its nested co-commissioner rows.
  // A slot with no officer shows a "Vacant" placeholder (the appointment
  // slot's placeholder carries the Designate action).
  type RosterLine =
    | { kind: "chief"; officer: OfficerRow }
    | { kind: "primary"; officer: OfficerRow }
    | { kind: "co"; officer: OfficerRow }
    | { kind: "vacant"; role: CommissionerRole };

  const rosterLines: RosterLine[] = [];
  const chiefRow = officers.find((o) => o.roleType === "chief");
  if (chiefRow) rosterLines.push({ kind: "chief", officer: chiefRow });

  const primaries = officers.filter((o) => o.roleType === "commissioner");
  const coRows = officers.filter((o) => o.roleType === "co_commissioner");

  ROLE_SLOT_ORDER.forEach((role) => {
    const primary = primaries.find((o) => o.role === role);
    if (!primary) {
      rosterLines.push({ kind: "vacant", role });
      return;
    }
    rosterLines.push({ kind: "primary", officer: primary });
    coRows
      .filter((c) => c.primaryId === primary.id)
      .forEach((c) => rosterLines.push({ kind: "co", officer: c }));
  });

  // Co-rows whose primary was removed (co_commissioner_of nulled by the
  // set-null FK) still appear — full width, at the end of the table.
  coRows
    .filter((c) => !c.primaryId)
    .forEach((c) => rosterLines.push({ kind: "co", officer: c }));

  const appointmentRecord = primaries.find((o) => o.role === "appointment");

  // 103: the five roles the system needs to run (shared with the
  // Chief Dashboard banner).  Only ACTIVE primaries fill a role.
  const missingRoles = loadingRoster ? [] : missingRequiredRoles(roster);

  // 068: per-officer "Remove" action. The RPC refuses the chief row and
  // self-removal server-side; the button is likewise never rendered on
  // the chief row.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeConfirm = useConfirm({
    title: "Remove Officer?",
    description: "This permanently deletes the officer record. Their sessions are signed out immediately and they can no longer log in. Past records that referenced them are kept, without the attribution. This cannot be undone.",
    confirmText: "Remove",
    destructive: true,
  });

  // 103: retiring or accepting a resignation ends the officer's service
  // immediately — sessions are purged and future logins refused.
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const statusConfirm = useConfirm({
    title: "End this officer's service?",
    description: "Retired and Resigned officers are signed out immediately and can no longer log in. Their record stays on the roster until you explicitly Remove it.",
    confirmText: "Set Status",
    destructive: true,
  });

  const fullName = (f: string, l: string) => `${f.trim().charAt(0).toUpperCase() + f.trim().slice(1)} ${l.trim().charAt(0).toUpperCase() + l.trim().slice(1)}`.trim();

  const appointCommissioner = async () => {
    if (!cForm.firstName.trim() || !cForm.lastName.trim() || !cForm.email.trim()) return;
    setError("");
    setCreating(true);
    const name = fullName(cForm.firstName, cForm.lastName);
    try {
      const result = await createCommissioner(name, cForm.email.trim(), cForm.role);
      setTempPassword({ name: result.name, email: result.email, password: result.password });
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
      setTempPassword({ name: result.name, email: result.email, password: result.password });
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

  // 104: submit the per-row dialog — a co-commissioner for the dialog's
  // role (records-only, no password, for the appointment role) or the
  // appointment designation itself.
  const submitDialog = async (name: string, email: string) => {
    if (!dialog) return;
    setError("");
    setDialogBusy(true);
    try {
      if (dialog.kind === "co") {
        const result = await createCoCommissioner(name, email.trim(), dialog.role);
        if (result.password) {
          setTempPassword({ name: result.name, email: result.email, password: result.password });
        }
        addLog({
          user: actorName,
          role: "Admin",
          action: "Appointed Co-commissioner",
          details: `${name} appointed as Co-commissioner of ${roleLabel[dialog.role] || dialog.role} (serving with ${dialog.primaryName})${result.password ? "" : " — records only, no account"}`,
          type: "success",
        });
      } else {
        await setAppointmentCommissioner(name, email.trim());
        addLog({
          user: actorName,
          role: "Admin",
          action: "Designated Commissioner of Appointment",
          details: `${name} designated as Commissioner of Appointment (${email.trim()}) — records only, no account`,
          type: "success",
        });
      }
      setDialog(null);
      await loadRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the officer.");
    } finally {
      setDialogBusy(false);
    }
  };

  // 103: Active / On Leave / Retired / Resigned.  Retired/resigned ask
  // for confirmation (sessions die immediately); the roster reload in
  // every path also reverts the select if the change was cancelled.
  const changeStatus = async (officer: OfficerRow, status: OfficerStatus) => {
    if (status === officer.status) return;
    setError("");
    if (status === "retired" || status === "resigned") {
      const ok = await statusConfirm.confirm();
      if (!ok) {
        await loadRoster();
        return;
      }
    }
    setChangingStatusId(officer.id);
    try {
      await setOfficerStatus(officer.id, status);
      addLog({
        user: actorName,
        role: "Admin",
        action: "Officer Status Changed",
        details: `Set ${officer.name} (${officer.email}) to ${statusLabel[status]}`,
        type: status === "retired" || status === "resigned" ? "warning" : "info",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update the officer's status.");
    } finally {
      setChangingStatusId(null);
      await loadRoster();
    }
  };

  // 068: remove an officer record (chief-gated RPC).
  const removeOfficer = async (officer: { id: string; name: string; email: string }) => {
    const ok = await removeConfirm.confirm();
    if (!ok) return;
    setError("");
    setRemovingId(officer.id);
    try {
      await removeOfficerRpc(officer.id);
      addLog({
        user: actorName,
        role: "Admin",
        action: "Removed Officer",
        details: `Removed ${officer.name} (${officer.email})`,
        type: "warning",
      });
      await loadRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the officer.");
    } finally {
      setRemovingId(null);
    }
  };

  const roleDisplay = (o: OfficerRow) =>
    o.roleType === "co_commissioner"
      ? `Co-commissioner — ${roleLabel[o.role] || o.role}`
      : o.roleType === "commissioner" && o.role === "appointment"
        ? roleLabel.appointment
        : roleLabel[o.role] || o.role;

  const noLoginBadge = (
    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" title="Records only — this designation has no login account">
      No login
    </span>
  );

  const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50";
  const smallBtn = "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-60";

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Officer Management</h1>
        <p className="text-gray-500 text-sm">
          Appoint commissioners and SSLG Advisers, add Co-commissioners under each commissioner row, and manage
          officer status (Active, On Leave, Retired, Resigned). New accounts use their role's default password,
          shown once. The Commissioner of Appointment and its Co-commissioner are records-only — no account, no login.
        </p>
      </motion.div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {/* 103 staffing readiness — the five roles the system needs to run */}
      {missingRoles.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900">Required officers missing</p>
            <p className="mt-0.5">
              Every required role needs an active officer before the system can run elections. Currently missing:{" "}
              <span className="font-semibold">{missingRoles.join(", ")}</span>.
            </p>
          </div>
        </div>
      )}

      {/* Commissioner creation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-1 text-sm flex items-center gap-2">
          <Shield size={16} style={{ color: "#5C0102" }} /> Appoint Commissioner
        </h3>
        <p className="text-xs text-gray-400 mb-4">Commissioner of Screening & Validation, Electoral Board, or Grievance.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">First Name</label>
            <input
              value={cForm.firstName}
              onChange={(e) => setCForm({ ...cForm, firstName: e.target.value })}
              placeholder="First name"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Last Name</label>
            <input
              value={cForm.lastName}
              onChange={(e) => setCForm({ ...cForm, lastName: e.target.value })}
              placeholder="Last name"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={cForm.email}
              onChange={(e) => setCForm({ ...cForm, email: e.target.value })}
              placeholder="account@cnnhs.edu"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Role</label>
            <select
              value={cForm.role}
              onChange={(e) => setCForm({ ...cForm, role: e.target.value as CommissionerRole })}
              className={inputClass}
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

      {/* Commissioners list — the four role slots with nested co-commissioners */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h3 className="text-gray-900 mb-3 text-sm flex items-center gap-2">
          <Crown size={16} style={{ color: "#5C0102" }} /> Commissioners
          {loadingRoster && <Loader2 size={12} className="animate-spin text-gray-400" />}
        </h3>
        {rosterLines.length === 0 ? (
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
                {rosterLines.map((line) => {
                  if (line.kind === "vacant") {
                    const isAppointment = line.role === "appointment";
                    return (
                      <tr key={`vacant-${line.role}`} className="bg-gray-50/40">
                        <td className="py-3 px-4 text-gray-400 italic">—</td>
                        <td className="py-3 px-4 text-gray-400 italic">—</td>
                        <td className="py-3 px-4 text-gray-500">{roleLabel[line.role]}</td>
                        <td className="py-3 px-4">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Vacant</span>
                        </td>
                        <td className="py-3 px-4">
                          {isAppointment ? (
                            <button
                              onClick={() => setDialog({ kind: "appointment", initialName: "", initialEmail: "" })}
                              disabled={dialogBusy}
                              className={`${smallBtn} border-[#5C0102]/30 text-[#5C0102] hover:bg-red-50`}
                              title="Designate the Commissioner of Appointment — records only, no account"
                            >
                              <UserPlus size={12} /> Designate
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Appoint from the form above</span>
                          )}
                        </td>
                      </tr>
                    );
                  }

                  const o = line.officer;
                  const isCo = line.kind === "co";
                  const isAppointment = o.roleType === "commissioner" && o.role === "appointment";
                  return (
                    <tr key={o.id} className={isCo ? "bg-gray-50/40" : undefined}>
                      <td className={`py-3 px-4 text-gray-900 font-medium ${isCo ? "pl-10" : ""}`}>
                        {isCo && <CornerDownRight size={12} className="inline-block mr-1.5 -mt-0.5 text-gray-400" />}
                        {o.name}
                        {o.roleType === "chief" && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Chief</span>}
                        {isAppointment && noLoginBadge}
                        {isCo && o.role === "appointment" && noLoginBadge}
                      </td>
                      <td className="py-3 px-4 text-gray-600">{o.email}</td>
                      <td className="py-3 px-4 text-gray-500">{roleDisplay(o)}</td>
                      <td className="py-3 px-4">
                        {o.roleType === "chief" ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyles[o.status]}`}>
                            {statusLabel[o.status]}
                          </span>
                        ) : (
                          <select
                            value={o.status}
                            disabled={changingStatusId === o.id || removingId === o.id}
                            onChange={(e) => void changeStatus(o, e.target.value as OfficerStatus)}
                            className={`text-xs px-2 py-1 rounded-full font-medium cursor-pointer border-0 disabled:opacity-60 ${statusStyles[o.status]}`}
                          >
                            {OFFICER_STATUSES.map((s) => (
                              <option key={s} value={s}>{statusLabel[s]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {o.roleType !== "chief" && (
                          <div className="flex items-center gap-2">
                            {line.kind === "primary" && (
                              <button
                                onClick={() =>
                                  setDialog({
                                    kind: "co",
                                    role: o.role,
                                    primaryName: o.name,
                                  })
                                }
                                disabled={removingId === o.id || changingStatusId === o.id || dialogBusy}
                                className={`${smallBtn} border-gray-200 text-gray-600 hover:bg-gray-50`}
                                title={
                                  isAppointment
                                    ? "Add a records-only Co-commissioner — no account, no login"
                                    : "Add a Co-commissioner for this role — same default password as this commissioner"
                                }
                              >
                                <UserPlus size={12} /> Add Co-commissioner
                              </button>
                            )}
                            {isAppointment && (
                              <button
                                onClick={() =>
                                  setDialog({
                                    kind: "appointment",
                                    initialName: o.name,
                                    initialEmail: o.email === "—" ? "" : o.email,
                                  })
                                }
                                disabled={removingId === o.id || changingStatusId === o.id || dialogBusy}
                                className={`${smallBtn} border-gray-200 text-gray-600 hover:bg-gray-50`}
                                title="Edit the records-only designation (name and email)"
                              >
                                <Pencil size={12} /> Edit record
                              </button>
                            )}
                            <button
                              onClick={() => removeOfficer(o)}
                              disabled={removingId === o.id || changingStatusId === o.id || dialogBusy}
                              className={`${smallBtn} border-red-200 text-red-600 hover:bg-red-50`}
                              title="Remove this officer record permanently"
                            >
                              {removingId === o.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              {removingId === o.id ? "Removing..." : "Remove"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Last Name</label>
            <input
              value={sslForm.lastName}
              onChange={(e) => setSslForm({ ...sslForm, lastName: e.target.value })}
              placeholder="Last name"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={sslForm.email}
              onChange={(e) => setSslForm({ ...sslForm, email: e.target.value })}
              placeholder="adviser@cnnhs.edu"
              className={inputClass}
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

      {dialog && dialog.kind === "co" && (
        <OfficerFormDialog
          title={`Add Co-commissioner — ${roleLabel[dialog.role] || dialog.role}`}
          subtitle={
            dialog.role === "appointment"
              ? "Records-only, like the Commissioner of Appointment: name and email kept for the roster and report signatories — no account, no login."
              : `Serves alongside ${dialog.primaryName}. The account uses the role's default password, shown once after saving.`
          }
          submitLabel="Add Co-commissioner"
          initialName=""
          initialEmail=""
          busy={dialogBusy}
          onSubmit={(name, email) => void submitDialog(name, email)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog && dialog.kind === "appointment" && (
        <OfficerFormDialog
          title="Commissioner of Appointment"
          subtitle="Records-only designation: the name and email are kept for the roster, staffing checks, and report signatories — no account is created and this officer cannot log in."
          submitLabel={dialog.initialName ? "Update Record" : "Designate"}
          initialName={dialog.initialName}
          initialEmail={dialog.initialEmail}
          busy={dialogBusy}
          onSubmit={(name, email) => void submitDialog(name, email)}
          onClose={() => setDialog(null)}
        />
      )}

      {statusConfirm.dialog}
      {removeConfirm.dialog}
    </div>
  );
}
