import { Switch, Route, Router } from "wouter";
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
              <AppRouter />
            </Router>
          </TooltipProvider>
        </AdminAuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
