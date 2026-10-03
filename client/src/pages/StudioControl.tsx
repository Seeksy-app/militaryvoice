import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, MonitorPlay } from "lucide-react";
import { StudioConsole } from "@/components/StudioConsole";
import { LoginCard } from "@/pages/HostDashboard";
import { IconTile } from "@/components/ui/icon-tile";
import { adminGet, adminSend } from "@/lib/adminApi";

type Access = { access: boolean; signedIn?: boolean; role?: "admin" | "studio-host"; email?: string; hostEmail?: string; eventId?: number; displayName?: string };

/**
 * The studio console on its own page, for studio hosts (Amy, Enrique): the
 * same console the admins run, with every studio control, reached by one link
 * and their own sign-in. The server lets them into the studio and nothing else
 * in admin, so nothing here has to hide anything.
 */
export default function StudioControl() {
  const [, navigate] = useLocation();
  useEffect(() => {
    document.title = "Studio — MilitaryVoices.ai";
  }, []);
  // Under /api/host so signing in on this page refetches it.
  const access = useQuery<Access>({
    queryKey: ["/api/host/studio-access"],
    queryFn: async () => (await fetch("/api/host/studio-access", { credentials: "include" })).json(),
  });
  if (access.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04102b] text-white/70">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!access.data?.access) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-md px-4 pt-12 text-center">
          <div className="mx-auto w-fit"><IconTile icon={MonitorPlay} /></div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight [text-wrap:balance]">The MilitaryVoices studio</h1>
          <p className="mt-2 text-sm text-muted-foreground [text-wrap:pretty]">
            {access.data?.signedIn
              ? `You're signed in as ${access.data.email}, which isn't a studio host. Ask the event's organiser to add you, or sign in with the address he added.`
              : "Sign in with your email to run the studio."}
          </p>
        </div>
        {!access.data?.signedIn && <LoginCard pending={null} />}
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#04102b]">
      <StudioConsole adminGet={adminGet} adminSend={adminSend} view="live" eventId={access.data.eventId} kind="event" simple viewerEmail={access.data.hostEmail || access.data.email} onLeave={() => navigate("/host/dashboard")} />
    </div>
  );
}
