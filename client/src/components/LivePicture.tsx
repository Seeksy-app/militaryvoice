import { useEffect, useRef, useState } from "react";
import { RoomPicture } from "@/components/RoomStage";

/**
 * What a watch page plays (the watch page for everyone, 25 Nov 2026). A studio's Go live and a stream sent in through
 * LiveKit are a hidden viewer seat in the room; a stream sent in to our own box is its watch relay, played as HLS.
 */
export type LiveNow =
  | { kind: "studio"; since: string; url: string; token: string; lookKey: string; studioId: number }
  | { kind: "stream"; since: string; url: string; token: string }
  | { kind: "hls"; since: string; src: string };

export function LivePicture({ seat, name, muted }: { seat: LiveNow; name: string; muted: boolean }) {
  if (seat.kind === "hls") return <HlsPicture key={seat.src} src={seat.src} muted={muted} />;
  return (
    <RoomPicture
      key={`${seat.kind}:${seat.since}`}
      url={seat.url}
      token={seat.token}
      studioId={seat.kind === "studio" ? seat.studioId : null}
      lookKey={seat.kind === "studio" ? seat.lookKey : null}
      name={name}
      muted={muted}
    />
  );
}

/**
 * HLS from our box. Safari plays it natively; elsewhere hls.js, loaded only when a box stream is on screen. The box
 * starts packaging when the first viewer asks, so the first seconds can 404: it keeps trying until the picture comes.
 */
function HlsPicture({ src, muted }: { src: string; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let stopped = false;
    let hls: { destroy(): void } | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const play = () => void video.play().catch(() => {});
    const onPlaying = () => setWaiting(false);
    video.addEventListener("playing", onPlaying);

    const start = async () => {
      if (stopped) return;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        play();
        return;
      }
      const Hls = (await import("hls.js")).default;
      if (stopped || !Hls.isSupported()) return;
      const h = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 1000 });
      hls = h;
      h.on(Hls.Events.MANIFEST_PARSED, play);
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { h.recoverMediaError(); return; }
        // A network error that hls.js gave up on: start over in a few seconds.
        h.destroy();
        if (hls === h) hls = null;
        setWaiting(true);
        retry = setTimeout(() => void start(), 4000);
      });
      h.loadSource(src);
      h.attachMedia(video);
    };
    void start();
    return () => {
      stopped = true;
      clearTimeout(retry);
      video.removeEventListener("playing", onPlaying);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);
  // Sound on/off after the start: set the element's own flag (the muted prop alone isn't reliable once mounted).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted;
    if (!muted) void video.play().catch(() => {});
  }, [muted]);
  return (
    <div className="relative h-full w-full bg-black">
      <video ref={ref} className="h-full w-full object-contain" autoPlay playsInline muted={muted} data-testid="live-hls" />
      {waiting && <p className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/70">Starting the picture…</p>}
    </div>
  );
}
