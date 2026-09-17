import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { StageGrid, useStageRoom } from "@/components/StageView";
import { apiRequest } from "@/lib/queryClient";
import { Volume2, VolumeX, Radio, Users } from "lucide-react";

// Where the audience watches, on our own site.
//
// No egress involved: viewers subscribe to the room straight over WebRTC, so
// it's near-instant and costs nothing per extra RTMP destination. Every other
// destination — YouTube, X, Twitch — is in addition to this, never instead.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface WatchToken {
  configured: boolean;
  meta?: Record<string, unknown>;
  url?: string;
  token?: string;
  eventName?: string;
  studioName?: string;
  status?: string;
}

export default function Watch({ slug }: { slug?: string }) {
  // Browsers refuse to autoplay audio, so everyone arrives muted and taps in.
  const [muted, setMuted] = useState(true);

  const [studioId] = useState<number | undefined>(() => {
    const v = Number(new URLSearchParams(window.location.search).get("studioId"));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  });

  const embed = new URLSearchParams(window.location.search).get("embed") === "1";

  const { data } = useQuery<WatchToken>({
    queryKey: ["/api/watch/token", slug ?? "featured", studioId ?? 0],
    queryFn: async () => {
      const q = new URLSearchParams({
        ...(slug ? { slug } : {}),
        ...(studioId ? { studioId: String(studioId) } : {}),
      });
      return (await apiRequest("GET", `/api/watch/token?${q}`)).json();
    },
    // A viewer who opens the page early should be let in when the room starts.
    refetchInterval: (q) => (q.state.data?.configured ? false : 20_000),
  });

  const { tiles, meta, connected, caption } = useStageRoom(data?.url ?? null, data?.token ?? null, muted, data?.meta);
  const live = (meta.status ?? data?.status) === "Live";
  const onAir = tiles.length > 0 || meta.fallbackPlaying;

  useEffect(() => {
    document.title = `Watch — ${data?.eventName ?? "MilitaryVoice.ai"}`;
  }, [data?.eventName]);

  return (
    <div className={embed ? "bg-[#04102b] text-white overflow-hidden" : "min-h-screen bg-[#04102b] text-white"}>
      {!embed && <NavBar />}

      <div className={embed ? "p-0" : "mx-auto max-w-6xl px-4 py-8 sm:px-6"}>
        {!embed && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
                {data?.eventName ?? "Live"}
              </h1>
              <p className="mt-1 text-sm text-white/55">
                {data?.studioName ?? "Main studio"}
                {connected ? "" : " · connecting…"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {live ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-[#ED1C24] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
                  <Radio className="h-3 w-3" /> Off air
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => setMuted((v) => !v)}
                data-testid="button-watch-sound"
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {muted ? "Sound off" : "Sound on"}
              </Button>
            </div>
          </div>
        )}

        <div className={`relative w-full overflow-hidden bg-[#000741] ${embed ? "h-full aspect-video" : "mt-5 aspect-video rounded-2xl border border-white/12 shadow-2xl"}`}>
          {data && !data.configured ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
              <img src="/logo-wave.png?v=2" alt="" className="h-16 w-auto opacity-80" />
              <p className="text-xl font-semibold text-white/85" style={HEADLINE_FONT}>
                Nothing on air right now
              </p>
              <p className="max-w-md text-sm text-white/50">
                This page comes to life when the studio opens. Leave it up — it'll start on its own.
              </p>
            </div>
          ) : (
            <StageGrid tiles={tiles} meta={meta} muted={muted} idleTitle={data?.eventName} caption={caption} />
          )}

          {muted && onAir && (
            <button
              type="button"
              onClick={() => setMuted(false)}
              className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px] transition-colors hover:bg-black/35"
              data-testid="button-watch-unmute"
            >
              <span className="flex items-center gap-2.5 rounded-full bg-[#F0A71F] px-6 py-3 text-base font-semibold text-[#1a1200] shadow-xl">
                <Volume2 className="h-5 w-5" /> Tap for sound
              </span>
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/55">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-4 w-4 text-[#F0A71F]" /> {tiles.length} on stage
          </span>
          <span>Also going out to our channels — follow along wherever you prefer.</span>
        </div>
      </div>
    </div>
  );
}
