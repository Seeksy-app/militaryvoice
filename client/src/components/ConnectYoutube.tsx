import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PlatformIcon } from "@/components/SocialIcons";
import { Check, LogOut } from "lucide-react";

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
