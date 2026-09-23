import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Track } from "livekit-client";
import type { StageTile } from "@/components/StageView";

// Real footage for the About page: short Pexels clips (see
// client/public/platform/video/CREDITS.txt), muted, looped, and paused
// whenever they are off screen so a page full of them stays light.

const V = "/platform/video";

export const CLIPS = {
  mainStage: { src: `${V}/main-stage.mp4`, poster: `${V}/main-stage.jpg` },
  stage2: { src: `${V}/stage-2.mp4`, poster: `${V}/stage-2.jpg` },
  expo: { src: `${V}/expo-floor.mp4`, poster: `${V}/expo-floor.jpg` },
  camera: { src: `${V}/camera-2.mp4`, poster: `${V}/camera-2.jpg` },
  control: { src: `${V}/control-room.mp4`, poster: `${V}/control-room.jpg` },
} as const;

/** People in the clips. The names are fictional. */
export const VCAST = {
  jordan: { name: "Jordan Blake", title: "Army veteran · Ruck Talk", src: `${V}/guest-jordan.mp4`, poster: `${V}/guest-jordan.jpg`, face: `${V}/face-jordan.jpg` },
  daniel: { name: "Daniel Cho", title: "Navy veteran · Deckplate Radio", src: `${V}/guest-daniel.mp4`, poster: `${V}/guest-daniel.jpg`, face: `${V}/face-daniel.jpg` },
  ray: { name: "Ray Castillo", title: "Marine veteran · Two Tours", src: `${V}/guest-ray.mp4`, poster: `${V}/guest-ray.jpg`, face: `${V}/face-ray.jpg` },
  lena: { name: "Lena Park", title: "Air Force spouse · Home Base", src: `${V}/guest-lena.mp4`, poster: `${V}/guest-lena.jpg`, face: `${V}/face-lena.jpg` },
} as const;
export type VCastKey = keyof typeof VCAST;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Plays while at least a sliver is on screen; pauses otherwise. Returns the cleanup. */
function playWhileVisible(el: HTMLVideoElement): () => void {
  if (reducedMotion()) return () => {};
  if (typeof IntersectionObserver === "undefined") {
    void el.play().catch(() => {});
    return () => el.pause();
  }
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting) void el.play().catch(() => {});
      else el.pause();
    },
    { rootMargin: "120px" },
  );
  io.observe(el);
  return () => {
    io.disconnect();
    el.pause();
  };
}

function prime(el: HTMLVideoElement, src: string, poster: string) {
  el.muted = true;
  el.loop = true;
  el.playsInline = true;
  el.preload = "metadata";
  el.poster = poster;
  if (el.getAttribute("src") !== src) el.src = src;
}

/** A clip in a box: muted, looped, inline, paused off screen. */
export function LoopVideo({ src, poster, className, style }: { src: string; poster: string; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return playWhileVisible(el);
  }, [src]);
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" aria-hidden="true" className={className} style={style} />;
}

/**
 * A clip dressed as a camera track, so the real stage component can show it.
 * The stage calls attach() with its own <video>; the clip plays there.
 */
export function useClipTrack(src: string, poster: string): Track {
  return useMemo(() => {
    const stops = new WeakMap<HTMLMediaElement, () => void>();
    const fake = {
      attach(el: HTMLMediaElement) {
        const v = el as HTMLVideoElement;
        prime(v, src, poster);
        stops.set(el, playWhileVisible(v));
        return el;
      },
      detach(el: HTMLMediaElement) {
        stops.get(el)?.();
        stops.delete(el);
        return el;
      },
    };
    return fake as unknown as Track;
  }, [src, poster]);
}

export function vcastTile(key: VCastKey, video: Track, speaking: boolean, host = false): StageTile {
  const p = VCAST[key];
  return { identity: key, name: p.name, displayTitle: p.title, video, audio: null, speaking, photoUrl: p.face, host };
}

/** A tiny "Coming soon" pill for anything on the roadmap. */
export function SoonPill({ className = "", tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase leading-4 tracking-[0.08em] ${
        tone === "dark" ? "bg-white/10 text-white/70 ring-1 ring-white/15" : "bg-muted text-muted-foreground ring-1 ring-border"
      } ${className}`}
    >
      Coming soon
    </span>
  );
}
