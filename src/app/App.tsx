import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppProvider } from "./context/AppContext";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
      {/* sonner host — toast.error/success calls across pages (e.g. the
          masterlist upload handler) had no mounted Toaster to render in. */}
      <Toaster position="top-right" richColors />
    </AppProvider>
  );
}
