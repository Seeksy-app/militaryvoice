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
}

export function ConnectYoutube() {
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
            ? "We'll open a broadcast on your channel when your slot starts. Your audience watches you there."
            : "Connect once and your segment goes out to your channel as well as ours. No stream key to find."}
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
    </section>
  );
}
