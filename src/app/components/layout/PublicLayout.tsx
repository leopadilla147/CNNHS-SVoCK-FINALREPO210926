import { Outlet, Navigate, useLocation } from "react-router";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { useApp } from "../../context/AppContext";

export function PublicLayout() {
  const { currentUser } = useApp();
  const location = useLocation();

  // D-04 flag gate: an authenticated flagged account must not be able to
  // browse the public surfaces either — every entry point routes to the
  // forced-change screen (unless already there).
  if (
    currentUser?.mustChangePassword &&
    location.pathname !== "/change-password" &&
    location.pathname !== "/login"
  ) {
    return <Navigate to="/change-password" replace />;
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}