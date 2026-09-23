import { useEffect } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AdminAuthProvider } from "@/lib/admin-auth";
import { HelpChat } from "@/components/HelpChat";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Agenda from "@/pages/Agenda";
import Events from "@/pages/Events";
import Admin from "@/pages/Admin";
import HostDashboard from "@/pages/HostDashboard";
import Landing from "@/pages/Landing";
import Faq from "@/pages/Faq";
import HelpYoutube from "@/pages/HelpYoutube";
import HelpIndex from "@/pages/HelpIndex";
import Discover from "@/pages/Discover";
import Prepare from "@/pages/Prepare";
import Platform from "@/pages/Platform";
import Headshot from "@/pages/Headshot";
import Watchfloor from "@/pages/Watchfloor";
import EventAbout from "@/pages/EventAbout";
import Studio from "@/pages/Studio";
import StudioComposite from "@/pages/StudioComposite";
import Watch from "@/pages/Watch";
import { PrivacyPolicy, TermsOfService } from "@/pages/Legal";
import NationalMilitaryPodcastDay from "@/pages/NationalMilitaryPodcastDay";
import SponsorVFW from "@/pages/SponsorVFW";
import Sponsor from "@/pages/Sponsor";

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
      <Route path="/help">{() => <HelpIndex />}</Route>
      <Route path="/discover">{() => <Discover />}</Route>
      {/* The address read on air: short to say, and counted as on-air when it lands. */}
      <Route path="/find">{() => { if (typeof window !== "undefined") window.location.replace("/discover?src=on-air"); return null; }}</Route>
      <Route path="/help/youtube">{() => <HelpYoutube />}</Route>
      {/* Registered on the Google OAuth consent screen — these URLs are
          load-bearing for verification, so don't rename them. */}
      <Route path="/policy">{() => <PrivacyPolicy />}</Route>
      <Route path="/privacy">{() => <PrivacyPolicy />}</Route>
      <Route path="/terms">{() => <TermsOfService />}</Route>
      <Route path="/prepare">{() => <Prepare />}</Route>
      <Route path="/platform">{() => <Platform />}</Route>
      <Route path="/headshot/:token">{(p) => <Headshot token={p.token} />}</Route>
      <Route path="/watchfloor">{() => <Watchfloor />}</Route>
      <Route path="/studio-platform">{() => <Watchfloor />}</Route>
      <Route path="/about">{() => <EventAbout />}</Route>
      <Route path="/event/:slug/about">{(params) => <EventAbout slug={params.slug} />}</Route>
      <Route path="/studio/composite">{() => <StudioComposite />}</Route>
      <Route path="/watch">{() => <Watch />}</Route>
      <Route path="/event/:slug/watch">{(params) => <Watch slug={params.slug} />}</Route>
      <Route path="/studio">{() => <Studio />}</Route>
      <Route path="/event/:slug/studio">{(params) => <Studio slug={params.slug} />}</Route>
      <Route path="/admin">{() => <Admin />}</Route>
      <Route path="/admin/:tab">{(p) => <Admin tab={p.tab} />}</Route>
      <Route path="/national-military-podcast-day">{() => <NationalMilitaryPodcastDay />}</Route>
      {/* Unlisted: a sponsorship proposal delivered by URL, not linked in nav. */}
      <Route path="/sponsor">{() => <Sponsor />}</Route>
      <Route path="/vfw">{() => <SponsorVFW />}</Route>
      {/* Each screen has its own address, so a tab can be linked, bookmarked
          and reached with the back button. /host/dashboard stays the home
          screen and every old link to it still lands. */}
      <Route path="/host/dashboard">{() => <HostDashboard />}</Route>
      <Route path="/host/dashboard/:tab">{(p) => <HostDashboard tab={p.tab} />}</Route>
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
                <HelpChat />
              </Router>
          </TooltipProvider>
        </AdminAuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
