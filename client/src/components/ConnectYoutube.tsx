import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PlatformIcon } from "@/components/SocialIcons";
import { Check, LogOut, HelpCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Link } from "wouter";

// Connecting a podcaster's own channel, so their slot goes out to their
// audience as well as ours. One button instead of them digging a stream key
// out of YouTube Studio and emailing us a credential.

interface Status {
  configured: boolean;
  connected: boolean;
  channelTitle: string;
  scope: "segment" | "show";
}

export function ConnectYoutube({ locked = false, lockedReason = "" }: { locked?: boolean; lockedReason?: string } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<Status>({
    queryKey: ["/api/host/youtube"],
    queryFn: async () => (await apiRequest("GET", "/api/host/youtube")).json(),
  });

  // Google sends them back here with the outcome on the URL.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("youtube");
    if (!result) return;
    if (result === "connected") toast({ title: "YouTube connected" });
    if (result === "failed") {
      toast({ title: "That didn't connect", description: "Try again, and make sure you allow the permissions.", variant: "destructive" });
    }
    if (result === "noChannel") {
      toast({
        title: "That Google account has no YouTube channel",
        description: "Connect again and, when Google asks which account, pick the one that owns your channel — often a second choice under your name, called a brand account.",
        variant: "destructive",
        duration: 15000,
      });
    }
    if (result === "noRefresh") {
      toast({
        title: "Nearly — try once more",
        description: "Google didn't hand back a lasting permission. Disconnect it in your Google account settings, then connect again.",
        variant: "destructive",
      });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/host/youtube"] });
    window.history.replaceState({}, "", window.location.pathname);
  }, [queryClient, toast]);

  const disconnect = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/host/youtube"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/host/youtube"] }),
  });

  // The one question, asked the moment they connect: their slot, or the day.
  const setScope = useMutation({
    mutationFn: async (scope: "segment" | "show") => {
      const r = await apiRequest("PATCH", "/api/host/youtube", { scope });
      return (await r.json()) as { scope: string };
    },
    onSuccess: (_d, scope) => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/youtube"] });
      toast({
        title: scope === "show" ? "The whole show goes to your channel" : "Just your segment",
        description: scope === "show"
          ? "A broadcast is scheduled on your YouTube for 5 October. It starts when we do."
          : "We open a broadcast on your channel when your slot comes up.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't set that", description: e.message, variant: "destructive" }),
  });

  if (!data?.configured) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: "#FF0000" }}
        >
          <PlatformIcon platform="youtube" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-card-foreground">
            {data.connected ? `Connected — ${data.channelTitle}` : "Send your slot to your own YouTube"}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.connected
              ? data.scope === "show"
                ? "The whole day goes out on your channel as well as ours. It starts when we do."
                : "We'll open a broadcast on your channel when your slot starts. Your audience watches you there."
              : "Connect once and your segment — or the whole show — goes out to your channel as well as ours. No stream key to find."}
          </p>
          {/* Say why there is only one button here. Without this it reads as a
              half-finished list and people go looking for the others. */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            YouTube is the only channel we can send to directly. Facebook, LinkedIn and X don't allow it without a
            third-party tool — ask us and we'll set one up with you.
          </p>
          {/* What Google will show them, before they press the button and
              meet it cold. The full walkthrough is a page; this is the
              three presses, where they are about to need them. */}
          {!data.connected && (
            <HoverCard openDelay={120}>
              <HoverCardTrigger asChild>
                <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid="youtube-what-youll-see">
                  <HelpCircle className="h-3.5 w-3.5" /> What you'll see when you connect
                </button>
              </HoverCardTrigger>
              <HoverCardContent align="start" className="w-96 text-sm">
                <p className="font-semibold">Google will say it hasn't verified this app.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  That's us — our verification with Google is in review. The permission only lets us open a live broadcast on
                  your channel at your booked time.
                </p>
                <ol className="mt-3 space-y-2 text-xs">
                  {[
                    ["Press Advanced.", "/email/google-1.png"],
                    ["Press Go to Military Voice (unsafe) — it isn't; that's Google's default wording until the review is done.", "/email/google-2.png"],
                    ["Press Continue.", "/email/google-3.png"],
                  ].map(([t, src], i) => (
                    <li key={src} className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[10px] font-bold text-[#1a1200]">{i + 1}</span>
                      <span className="min-w-0 flex-1">{t}</span>
                      <img src={src} alt="" className="h-12 w-20 shrink-0 rounded border border-border object-cover object-left-top" />
                    </li>
                  ))}
                </ol>
                <Link href="/help/youtube" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
                  Full walkthrough with pictures →
                </Link>
              </HoverCardContent>
            </HoverCard>
          )}
        </div>
        {data.connected ? (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
            data-testid="button-youtube-disconnect"
          >
            <LogOut className="h-3.5 w-3.5" /> Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={locked}
            title={locked ? lockedReason : undefined}
            className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"
            onClick={() => {
              window.location.href = "/api/host/youtube/start";
            }}
            data-testid="button-youtube-connect"
          >
            <Check className="h-3.5 w-3.5" /> Connect YouTube
          </Button>
        )}
      </div>
      {/* YouTube's API terms ask for these two links wherever the connection
          is made, not only in the policy. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Connecting uses YouTube API Services. By connecting you agree to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">YouTube Terms of Service</a>
        {" "}and acknowledge the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Google Privacy Policy</a>.
        You can revoke our access any time from your{" "}
        <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Google security settings</a>.
      </p>

      {/* The one question, asked the moment they connect and answerable any
          time after: their slot, or the day. */}
      {data.connected && (
        <div className="mt-4 border-t border-border pt-4" data-testid="youtube-scope">
          <p className="text-sm font-semibold text-card-foreground">What goes to your channel?</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              ["segment", "Just my segment", "Your slot, opened on your channel when it comes up."],
              ["show", "The entire show", "All sixteen hours, first show to last, on your channel too."],
            ] as const).map(([value, title, body]) => {
              const on = data.scope === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  disabled={setScope.isPending}
                  onClick={() => !on && setScope.mutate(value)}
                  className={`rounded-xl border p-3 text-left transition-colors ${on ? "border-[#053877] bg-[#053877]/[0.06]" : "border-border hover:border-foreground/30"}`}
                  data-testid={`youtube-scope-${value}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                    {on && <Check className="h-3.5 w-3.5 text-[#053877]" />} {title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
