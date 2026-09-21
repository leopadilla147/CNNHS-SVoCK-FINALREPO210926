import { Navigate } from "react-router";
import { useApp } from "../../context/AppContext";
import ChiefDashboard from "./dashboards/ChiefDashboard";
import ScreeningDashboard from "./dashboards/ScreeningDashboard";
import ElectoralDashboard from "./dashboards/ElectoralDashboard";
import GrievanceDashboard from "./dashboards/GrievanceDashboard";
import SslgAdviserDashboard from "./dashboards/SslgAdviserDashboard";

export default function AdminDashboard() {
  const { currentUser } = useApp();
  const role = currentUser?.commissionerRole;
  const isSslgAdviser = currentUser?.role === "sslg_adviser";

  if (isSslgAdviser) return <SslgAdviserDashboard />;

  if (!role) return <Navigate to="/login" replace />;

  switch (role) {
    case "chief":
      return <ChiefDashboard />;
    case "screening_validation":
      return <ScreeningDashboard />;
    case "electoral_board":
      return <ElectoralDashboard />;
    case "grievance":
      return <GrievanceDashboard />;
    default:
      return <ChiefDashboard />;
  }
}
