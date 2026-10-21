import { useState } from "react";
import { Activity, Search, Filter, CheckCircle, AlertCircle, Info, XCircle, Download, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "../../context/AppContext";
import { canonicalAuditRole, auditRoleLabel, type AuditRole } from "../../lib/auditRoles";

// Letters, numbers, and spaces only (see search input below).
const SEARCH_ALLOWED = /[^a-zA-Z0-9 ]/g;

// 027's constraint set — 'Officer' was removed from audit_logs.actor_role
// by migration 027, so no row can ever match it; the adviser lands here
// via the 075 RLS widening.
const ROLE_FILTERS: { value: AuditRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "student", label: "Student" },
  { value: "sslg_adviser", label: "SSLG Adviser" },
  { value: "system", label: "System" },
];

const ROLE_BADGE_CLASSES: Record<AuditRole, string> = {
  admin: "bg-red-100 text-red-700",
  student: "bg-green-100 text-green-700",
  sslg_adviser: "bg-blue-100 text-blue-700",
  system: "bg-gray-100 text-gray-600",
};

export default function AdminLogs() {
  const { logs } = useApp();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState<"all" | AuditRole>("all");

  const filtered = logs.filter((log) => {
    const matchSearch = `${log.user} ${log.action} ${log.details}`.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || log.type === typeFilter;
    // DB rows are lowercase ("admin", "sslg_adviser") while local
    // optimistic entries are display strings ("Admin") — canonicalize
    // both before comparing.
    const matchRole = roleFilter === "all" || canonicalAuditRole(log.role) === roleFilter;
    return matchSearch && matchType && matchRole;
  });

  const getTypeIcon = (type: string) => {
    if (type === "success") return <CheckCircle size={14} className="text-green-500 flex-shrink-0" />;
    if (type === "error") return <XCircle size={14} className="text-red-500 flex-shrink-0" />;
    if (type === "warning") return <AlertCircle size={14} className="text-amber-500 flex-shrink-0" />;
    return <Info size={14} className="text-blue-500 flex-shrink-0" />;
  };

  const getTypeBg = (type: string) => {
    if (type === "success") return "bg-green-50 border-green-200";
    if (type === "error") return "bg-red-50 border-red-200";
    if (type === "warning") return "bg-amber-50 border-amber-200";
    return "bg-blue-50 border-blue-200";
  };

  const getTypeLabel = (type: string) => {
    if (type === "success") return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Success</span>;
    if (type === "error") return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Error</span>;
    if (type === "warning") return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Warning</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Info</span>;
  };

  const stats = [
    { label: "Total Logs", count: logs.length, color: "#5C0102" },
    { label: "Success", count: logs.filter((l) => l.type === "success").length, color: "#10B981" },
    { label: "Warnings", count: logs.filter((l) => l.type === "warning").length, color: "#F59E0B" },
    { label: "Errors", count: logs.filter((l) => l.type === "error").length, color: "#EF4444" },
  ];

  const types = ["all", "success", "info", "warning", "error"];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-gray-900 mb-1">System Logs</h1>
            <p className="text-gray-500 text-sm">Complete audit trail of all system activities for transparency and security.</p>
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              <Download size={16} /> Export
            </button>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
            <div className="text-2xl font-bold mb-0.5" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-5">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search logs by user, action, or details..."
              value={search}
              // Letters, numbers, and spaces only — strip anything else
              // (symbols pasted in are dropped, spaces are kept so
              // multi-word names stay searchable).
              onChange={(e) => setSearch(e.target.value.replace(SEARCH_ALLOWED, ""))}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-gray-400 flex items-center gap-1 py-2"><Filter size={12} /> Type:</span>
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${typeFilter === t ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={typeFilter === t ? { backgroundColor: "#5C0102" } : {}}
              >
                {t}
              </button>
            ))}
            <span className="text-xs text-gray-400 flex items-center gap-1 py-2 ml-2">Role:</span>
            <button
              onClick={() => setRoleFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${roleFilter === "all" ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              style={roleFilter === "all" ? { backgroundColor: "#5C0102" } : {}}
            >
              All
            </button>
            {ROLE_FILTERS.map((r) => (
              <button
                key={r.value}
                onClick={() => setRoleFilter(r.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${roleFilter === r.value ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                style={roleFilter === r.value ? { backgroundColor: "#5C0102" } : {}}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#FFF5F5" }}>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Time</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">User</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Role</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Action</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Details</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-xs text-gray-400 font-mono whitespace-nowrap">{log.timestamp}</td>
                  <td className="py-3 px-4 text-gray-800 text-xs font-medium">{log.user}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      ROLE_BADGE_CLASSES[canonicalAuditRole(log.role)]
                    }`}>
                      {auditRoleLabel(log.role)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-700 text-xs font-medium">{log.action}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs max-w-xs truncate">{log.details}</td>
                  <td className="py-3 px-4">{getTypeLabel(log.type)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-gray-400 text-sm">
                    <Activity size={28} className="mx-auto mb-2 opacity-30" />
                    No logs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">Showing {filtered.length} of {logs.length} log entries</span>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <RefreshCw size={12} /> Auto-refreshes every 30 seconds
          </div>
        </div>
      </div>
    </div>
  );
}
