import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Volume2, VolumeX } from "lucide-react";
import { LivePicture, type LiveNow } from "@/components/LivePicture";

/**
 * The LIVE card on a SmartLink (Andrew, 25 Nov 2026: "Yes, build it", the watch page for everyone; option 1: nothing to
 * add). While they're live it sits first on their page and plays right there, muted until tapped, with Watch full
 * screen to /<handle>/live. When they stop it goes away. The player only joins while the card is on screen, so a
 * visitor who never scrolls to it costs nothing.
 */
type LiveData = { handle: string; name: string; on: boolean; live: LiveNow | null };

const at = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export function SmartLinkLive({ handle }: { handle: string }) {
  const q = useQuery<LiveData | null>({
    queryKey: ["/api/live", handle],
    queryFn: async () => {
      const r = await fetch(`/api/live/${encodeURIComponent(handle)}`, { cache: "no-store" });
      return r.ok ? ((await r.json()) as LiveData) : null;
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const live = q.data?.on ? q.data.live : null;
  // Keep the seat we joined with while the same show stays live: a fresh token every poll would reconnect the player.
  const [seat, setSeat] = useState<LiveNow | null>(null);
  useEffect(() => {
    if (!live) { setSeat(null); return; }
    setSeat((cur) => (cur && cur.kind === live.kind && cur.since === live.since ? cur : live));
  }, [live?.kind, live?.since]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [!!seat]); // eslint-disable-line react-hooks/exhaustive-deps
  const [muted, setMuted] = useState(true);
  if (!seat || !q.data) return null;
  const since = at(seat.since);
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-[#d92d20] bg-black text-white shadow-[0_0_0_4px_rgba(217,45,32,0.18)]" data-testid="bio-live">
      <div className="flex items-center gap-2 bg-[#1a0d10] px-3 py-2.5">
        <span className="rounded-md bg-[#d92d20] px-2 py-0.5 text-[12px] font-extrabold tracking-wide">LIVE</span>
        <span className="text-sm font-bold">Live now</span>
        {since && <span className="ml-auto text-xs text-white/60">since {since}</span>}
      </div>
      <div ref={box} className="relative aspect-video w-full bg-[#0b1630]">
        {seen && (
          <LivePicture seat={seat} name={q.data.name} muted={muted} />
        )}
        <button type="button" onClick={() => setMuted((m) => !m)} className="absolute bottom-2.5 left-2.5 z-30 flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-[13px] font-semibold backdrop-blur hover:bg-black/80" data-testid="bio-live-sound">
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}{muted ? "Tap for sound" : "Sound on"}
        </button>
      </div>
      <a href={`/${handle}/live`} className="block bg-[#1a0d10] px-3 py-2.5 text-center text-sm font-bold text-white hover:bg-[#2a1418]" data-testid="bio-live-full">Watch full screen</a>
    </div>
  );
}
