import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Volume2, VolumeX } from "lucide-react";
import NotFound from "@/pages/not-found";
import { LivePicture, type LiveNow } from "@/components/LivePicture";

/**
 * militaryvoices.ai/<handle>/live (Andrew, 22 Nov 2026: "Going live on their MilitaryVoices web page"). Whatever the
 * podcaster has live right now: their studio's show, or a stream they send in from StreamYard, Restream or OBS. Viewers
 * watch from a hidden, watch-only seat, so nothing they do reaches the show. Checked every 20 seconds, so the page
 * goes live by itself when they do.
 */
type LiveData = {
  handle: string; name: string; photo: string; on: boolean; live: LiveNow | null;
  /** Their SmartLink's handle when it's on (else ""): the name links back to it. */
  smartLink?: string;
  /** Their podcast, for the card under the player. */
  podcast?: { title: string; artworkUrl: string; url: string; latest: string } | null;
  /** An old watch address: their page is now under this handle. */
  moved?: string;
};

const NAVY = "#053877";

export default function LivePage({ handle }: { handle: string }) {
  const q = useQuery<LiveData | null>({
    queryKey: ["/api/live", handle],
    queryFn: async () => {
      const r = await fetch(`/api/live/${encodeURIComponent(handle)}`, { cache: "no-store" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Couldn't load the page.");
      return (await r.json()) as LiveData;
    },
    refetchInterval: 20_000,
  });
  // Keep the seat we joined with while the same show stays live: a fresh token every poll would reconnect the player.
  const [seat, setSeat] = useState<LiveNow | null>(null);
  const live = q.data?.live ?? null;
  useEffect(() => {
    if (!live) { setSeat(null); return; }
    setSeat((cur) => (cur && cur.kind === live.kind && cur.since === live.since ? cur : live));
  }, [live?.kind, live?.since]); // eslint-disable-line react-hooks/exhaustive-deps
  const [muted, setMuted] = useState(true);

  useEffect(() => { if (q.data?.name) document.title = `${q.data.name} · Live on MilitaryVoices.ai`; }, [q.data?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  // A page with no SmartLink behind it stays out of search (the plan Andrew OK'd, 25 Nov).
  useEffect(() => {
    if (!q.data || q.data.smartLink) return;
    const m = document.createElement("meta");
    m.name = "robots"; m.content = "noindex";
    document.head.appendChild(m);
    return () => m.remove();
  }, [!!q.data, !!q.data?.smartLink]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q.data?.moved) window.location.replace(`/${q.data.moved}/live`); }, [q.data?.moved]);
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(`${window.location.origin}/${handle}/live`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});

  if (q.isLoading || q.data?.moved) return <div className="min-h-screen bg-[#04102b]" />;
  if (q.data === null) return <NotFound />;
  const d = q.data;
  if (!d) return <div className="flex min-h-screen items-center justify-center bg-[#04102b] p-6 text-white/80">Couldn't load the page. Try again in a moment.</div>;
  const first = d.name.split(/\s+/)[0] || d.name;

  return (
    <div className="min-h-screen bg-[#04102b] text-white">
      <header className="mx-auto flex max-w-[1100px] items-center gap-3 px-4 py-4 sm:px-6">
        {(() => {
          const face = (
            <>
              {d.photo
                ? <img src={d.photo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white/20" />
                : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold" style={{ background: NAVY }}>{d.name.slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 truncate text-[17px] font-bold">{d.name}</span>
            </>
          );
          return d.smartLink
            ? <a href={`/${d.smartLink}`} className="flex min-w-0 items-center gap-3" data-testid="live-page-profile">{face}</a>
            : <div className="flex min-w-0 items-center gap-3" data-testid="live-page-profile">{face}</div>;
        })()}
        {seat && <span className="ml-1 shrink-0 rounded-md bg-[#d92d20] px-2 py-0.5 text-[12px] font-extrabold tracking-wide" data-testid="live-page-badge">LIVE</span>}
        <button type="button" onClick={copy} className="ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-white px-3.5 text-[13px] font-bold text-[#053877] hover:bg-white/90" data-testid="live-page-copy">
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy link"}
        </button>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 pb-10 sm:px-6">
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_24px_48px_rgba(0,0,0,0.4)]" data-testid="live-page-player">
          {seat ? (
            <>
              <LivePicture seat={seat} name={d.name} muted={muted} />
              <button type="button" onClick={() => setMuted((m) => !m)} className="absolute bottom-3 left-3 z-30 flex items-center gap-2 rounded-full bg-black/65 px-3.5 py-2 text-sm font-semibold backdrop-blur hover:bg-black/80" data-testid="live-page-sound">
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} {muted ? "Turn sound on" : "Sound on"}
              </button>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center" data-testid="live-page-offline">
              {d.on ? (
                <>
                  <p className="text-balance text-xl font-bold sm:text-2xl">{first} isn't live right now</p>
                  <p className="text-balance text-sm text-white/70">This page starts playing by itself the moment {first} goes live. Keep it open, or come back later.</p>
                </>
              ) : (
                <p className="text-balance text-xl font-bold sm:text-2xl">This page is off</p>
              )}
              {d.smartLink && <a href={`/${d.smartLink}`} className="mt-3 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#053877] hover:bg-white/90">Go to their page</a>}
            </div>
          )}
        </div>
        {d.podcast && (
          <a href={d.podcast.url || undefined} className="mt-4 flex items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 hover:bg-white/[0.09]" data-testid="live-page-podcast">
            {d.podcast.artworkUrl
              ? <img src={d.podcast.artworkUrl} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
              : <span className="h-14 w-14 shrink-0 rounded-[10px] bg-[#F0A71F]" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-bold tracking-[0.06em] text-white/60">THEIR PODCAST</span>
              <span className="block truncate text-base font-bold">{d.podcast.title}</span>
              {d.podcast.latest && <span className="block truncate text-[13px] text-white/70">Latest: {d.podcast.latest}</span>}
            </span>
            {d.podcast.url && <span className="flex h-[38px] shrink-0 items-center rounded-full bg-white px-4 text-sm font-bold text-[#053877]">Listen</span>}
          </a>
        )}
      </main>
    </div>
  );
}
