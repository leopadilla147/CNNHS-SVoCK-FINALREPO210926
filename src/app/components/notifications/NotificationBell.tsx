import { useState, useRef, useEffect } from "react";
import { Bell, CheckCheck, X, ExternalLink, Clock, CheckCircle, XCircle, UserPlus, FileText, Flag, Megaphone, AlertCircle, Send, Fingerprint } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useApp, NotificationType, AppNotification } from "../../context/AppContext";
import { useNavigate } from "react-router";

const TYPE_ICONS: Record<NotificationType, { icon: React.ReactNode; color: string }> = {
  candidacy_pending: { icon: <Clock size={14} />, color: "#F59E0B" },
  candidacy_approved: { icon: <CheckCircle size={14} />, color: "#10B981" },
  candidacy_rejected: { icon: <XCircle size={14} />, color: "#EF4444" },
  official_list_posted: { icon: <Megaphone size={14} />, color: "#5C0102" },
  nomination_received: { icon: <FileText size={14} />, color: "#3B82F6" },
  nomination_status_changed: { icon: <FileText size={14} />, color: "#8B5CF6" },
  party_membership_request: { icon: <UserPlus size={14} />, color: "#3B82F6" },
  party_membership_approved: { icon: <CheckCircle size={14} />, color: "#10B981" },
  party_membership_rejected: { icon: <XCircle size={14} />, color: "#EF4444" },
  student_registered: { icon: <UserPlus size={14} />, color: "#3B82F6" },
  student_approved: { icon: <CheckCircle size={14} />, color: "#10B981" },
  student_rejected: { icon: <XCircle size={14} />, color: "#EF4444" },
  complaint_filed: { icon: <AlertCircle size={14} />, color: "#F59E0B" },
  complaint_resolved: { icon: <CheckCircle size={14} />, color: "#10B981" },
  election_opened: { icon: <Flag size={14} />, color: "#5C0102" },
  election_closed: { icon: <Flag size={14} />, color: "#6B7280" },
  results_published: { icon: <Megaphone size={14} />, color: "#8B5CF6" },
  submitted_to_chief: { icon: <Send size={14} />, color: "#F59E0B" },
  rules_discussion_meeting: { icon: <Megaphone size={14} />, color: "#1D4ED8" },
  fingerprint_registration: { icon: <Fingerprint size={14} />, color: "#2563EB" },
  admin_notification: { icon: <Megaphone size={14} />, color: "#5C0102" },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleNotifClick = (notif: AppNotification) => {
    if (!notif.isRead) markAsRead(notif.id);
    if (notif.link) navigate(notif.link);
    setOpen(false);
  };

  if (!currentUser) return null;

  return (
    <div ref={bellRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-all"
        title="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4.5 h-4.5 text-[10px] font-bold text-white rounded-full"
            style={{ backgroundColor: "#EF4444", minWidth: "18px", minHeight: "18px", lineHeight: "18px" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50"
            style={{ maxHeight: "480px" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100" style={{ backgroundColor: "#5C0102" }}>
              <div className="flex items-center gap-2 text-white">
                <Bell size={16} />
                <span className="text-sm font-medium">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/20 text-white">{unreadCount} new</span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-[11px] text-white/80 hover:text-white transition-colors"
                >
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: "380px" }}>
              {notifications.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-sm">
                  <Bell size={32} className="mx-auto mb-2 opacity-30" />
                  No notifications yet
                </div>
              ) : (
                notifications.slice(0, 20).map((notif) => {
                  const typeConfig = TYPE_ICONS[notif.type] || TYPE_ICONS.admin_notification;
                  return (
                    <button
                      key={notif.id}
                      onClick={() => handleNotifClick(notif)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-gray-50 border-b border-gray-50 last:border-b-0 ${!notif.isRead ? "bg-red-50/40" : ""}`}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: `${typeConfig.color}18`, color: typeConfig.color }}
                      >
                        {typeConfig.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className={`text-xs ${!notif.isRead ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
                            {notif.title}
                          </span>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">
                            {timeAgo(notif.createdAt)}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                        {notif.link && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 mt-0.5">
                            <ExternalLink size={10} /> View
                          </span>
                        )}
                      </div>
                      {!notif.isRead && (
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ backgroundColor: "#5C0102" }} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
