import { useEffect } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AdminAuthProvider } from "@/lib/admin-auth";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Agenda from "@/pages/Agenda";
import Events from "@/pages/Events";
import Admin from "@/pages/Admin";
import HostDashboard from "@/pages/HostDashboard";
import Landing from "@/pages/Landing";
import Faq from "@/pages/Faq";

/**
 * Client-side navigation keeps the old scroll position by default. Every
 * route change goes to the top of the new page, or to the element named in
 * the URL hash (retrying briefly so data-driven sections can render first).
 */
function ScrollManager() {
  const [location] = useLocation();
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || hash.startsWith("/")) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }
    let cancelled = false;
    const tryScroll = (attempt: number) => {
      if (cancelled) return;
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attempt < 8) setTimeout(() => tryScroll(attempt + 1), 120 * (attempt + 1));
    };
    tryScroll(0);
    return () => {
      cancelled = true;
    };
  }, [location]);
  return null;
}

function AppRouter() {
  return (
    <Switch>
      {/* "/" is the featured event's landing page while there's one event;
          it becomes the events hub once there are several. */}
      <Route path="/">{() => <Landing />}</Route>
      <Route path="/event/:slug/agenda">{(params) => <Agenda slug={params.slug} />}</Route>
      <Route path="/event/:slug/schedule">{(params) => <Home slug={params.slug} />}</Route>
      <Route path="/event/:slug">{(params) => <Landing slug={params.slug} />}</Route>
      <Route path="/events">{() => <Events />}</Route>
      <Route path="/schedule">{() => <Home />}</Route>
      <Route path="/agenda">{() => <Agenda />}</Route>
      <Route path="/faq">{() => <Faq />}</Route>
      <Route path="/admin">{() => <Admin />}</Route>
      <Route path="/host/dashboard">{() => <HostDashboard />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AdminAuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router>
              <ScrollManager />
              <AppRouter />
            </Router>
          </TooltipProvider>
        </AdminAuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
