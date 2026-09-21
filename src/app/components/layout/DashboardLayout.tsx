import { Outlet, Navigate, useLocation } from "react-router";
import { DashboardSidebar } from "./DashboardSidebar";
import { useApp, UserRole } from "../../context/AppContext";

interface DashboardLayoutProps {
  requiredRole: UserRole;
}

export function DashboardLayout({ requiredRole }: DashboardLayoutProps) {
  const { currentUser } = useApp();
  const location = useLocation();

  if (!currentUser) return <Navigate to="/login" replace />;

  // D-04 flag gate: a flagged account may not open ANY dashboard entry
  // point (admin, student, adviser) — it is routed to the forced-change
  // screen until the password is changed (session_version bump then
  // kills every prior session; the client re-logs-in).
  if (currentUser.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  const hasAccess =
    currentUser.role === requiredRole ||
    (requiredRole === "admin" && currentUser.role === "sslg_adviser");
  if (!hasAccess) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0 lg:pt-0 pt-14">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}