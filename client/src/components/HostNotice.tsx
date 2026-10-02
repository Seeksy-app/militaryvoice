import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { Coins } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";

type Notice = { kind: "bonus"; title: string; body: string; credits?: number; at: string };

/**
 * A one-time celebration waiting for this podcaster (bonus credits, for now): a pop-up with
 * confetti the next time they open the dashboard, then never again.
 */
export function HostNotice() {
  const qc = useQueryClient();
  const q = useQuery<{ notice: Notice | null; balance?: number }>({
    queryKey: ["/api/host/notice"],
    queryFn: async () => (await fetch("/api/host/notice", { credentials: "include" })).json(),
    // Every 30 seconds, so one sent while they're working (in Pōstify, say) pops up without a reload.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const n = q.data?.notice ?? null;
  const fired = useRef(false);

  useEffect(() => {
    if (!n || fired.current) return;
    fired.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Brand colours, two bursts from the sides and one from the middle.
    const colors = ["#F0A71F", "#053877", "#ffffff", "#8ab4f8"];
    const shot = (o: confetti.Options) => void confetti({ colors, zIndex: 2000, disableForReducedMotion: true, ...o });
    shot({ particleCount: 90, spread: 70, origin: { x: 0.5, y: 0.45 } });
    setTimeout(() => { shot({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.6 } }); shot({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.6 } }); }, 250);
  }, [n]);

  const close = async () => {
    qc.setQueryData(["/api/host/notice"], { notice: null });
    await fetch("/api/host/notice/seen", { method: "POST", credentials: "include" }).catch(() => {});
  };

  if (!n) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) void close(); }}>
      <DialogContent className="text-center sm:max-w-sm" data-testid="host-notice">
        <div className="mx-auto"><IconTile icon={Coins} /></div>
        <DialogHeader className="items-center">
          <DialogTitle className="text-balance text-2xl font-bold tracking-tight">{n.title}</DialogTitle>
          <DialogDescription className="text-pretty">{n.body}</DialogDescription>
        </DialogHeader>
        {typeof q.data?.balance === "number" && (
          <p className="text-sm">Your balance: <span className="font-bold tabular-nums text-[#053877] dark:text-white">{q.data.balance} credits</span></p>
        )}
        <Button onClick={() => void close()} className="mt-1 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="host-notice-ok">Let's go</Button>
      </DialogContent>
    </Dialog>
  );
}
