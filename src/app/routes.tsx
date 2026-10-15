import { createBrowserRouter } from "react-router";
import { PublicLayout } from "./components/layout/PublicLayout";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import HomePage from "./pages/HomePage";
import CurrentElectionPage from "./pages/CurrentElectionPage";
import PastElectionsPage from "./pages/PastElectionsPage";
import PastElectionDetailPage from "./pages/PastElectionDetailPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import StudentDashboard from "./pages/student/StudentDashboard";
import StudentCandidates from "./pages/student/StudentCandidates";
import StudentApplyCandidacy from "./pages/student/StudentApplyCandidacy";
import StudentProfile from "./pages/student/StudentProfile";
import StudentComplaints from "./pages/student/StudentComplaints";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminStudents from "./pages/admin/AdminStudents";
import AdminCandidates from "./pages/admin/AdminCandidates";
import AdminReports from "./pages/admin/AdminReports";
import AdminLogs from "./pages/admin/AdminLogs";
import AdminLiveResults from "./pages/admin/AdminLiveResults";
import AdminHelpDesk from "./pages/admin/AdminHelpDesk";
import AdminArchive from "./pages/admin/AdminArchive";
import AdminProfile from "./pages/admin/AdminProfile";
import AdminComplaints from "./pages/admin/AdminComplaints";
import AdminElectionSetup from "./pages/admin/AdminElectionSetup";
import ChiefAppointments from "./pages/admin/ChiefAppointments";

function StudentLayout() { return <DashboardLayout requiredRole="student" />; }
function AdminLayout() { return <DashboardLayout requiredRole="admin" />; }

export const router = createBrowserRouter([
  {
    path: "/",
    Component: PublicLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "current-election", Component: CurrentElectionPage },
      { path: "past-elections", Component: PastElectionsPage },
      { path: "past-elections/:electionId", Component: PastElectionDetailPage },
      { path: "login", Component: LoginPage },
      { path: "register", Component: RegisterPage },
    ],
  },
  {
    // D-04: the forced-change screen renders OUTSIDE both layouts (it is
    // the one destination a flagged account may reach); it bounces to
    // /login when the flag is not set.
    path: "/change-password",
    Component: ChangePasswordPage,
  },
  {
    path: "/student",
    Component: StudentLayout,
    children: [
      { path: "dashboard", Component: StudentDashboard },
      { path: "candidates", Component: StudentCandidates },
      { path: "apply", Component: StudentApplyCandidacy },
      { path: "complaints", Component: StudentComplaints },
      { path: "profile", Component: StudentProfile },
    ],
  },
  {
    path: "/admin",
    Component: AdminLayout,
    children: [
      { path: "dashboard", Component: AdminDashboard },
      { path: "students", Component: AdminStudents },
      { path: "candidates", Component: AdminCandidates },
      { path: "reports", Component: AdminReports },
      { path: "logs", Component: AdminLogs },
      { path: "election", Component: AdminElectionSetup },
      // D-01: the Chief's appointment surface replaces the removed
      // /admin/commissioners route (the old commissioners page is deleted).
      { path: "officers", Component: ChiefAppointments },
      { path: "live-results", Component: AdminLiveResults },
      { path: "help-desk", Component: AdminHelpDesk },
      { path: "archive", Component: AdminArchive },
      { path: "profile", Component: AdminProfile },
      { path: "complaints", Component: AdminComplaints },
    ],
  },
]);