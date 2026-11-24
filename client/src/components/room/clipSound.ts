import { useEffect, useRef, useSyncExternalStore } from "react";
import { AudioPresets, Room, Track, type LocalAudioTrack } from "livekit-client";
import { apiRequest } from "@/lib/queryClient";

/**
 * A video on stage, heard by everyone IN the studio (Andrew, 24 Nov: "If someone's going to play a
 * video clip during a recording in our studios, what's the best way to do that?").
 *
 * The recording and the live show already carry a presented video's sound: the filmed page plays its
 * own copy of the clip, in sync with the picture. The people in the room didn't hear it (the host's
 * preview is muted, guests see the plain grid). So the host's page plays the clip too, silently,
 * and publishes its sound into the room as "Studio sound" (player-<id>-clip, a second, publish-only
 * connection; the server's /api/host/my-studio/clip-token):
 * - everyone hears it as an ordinary remote track, the host included, so each browser's echo
 *   cancellation takes it back out of their mic and it never comes round twice;
 * - it's our own track, not a mic, so no noise suppression or auto gain touches it;
 * - it sits under voices (IN_ROOM_GAIN), since people talk over a clip;
 * - the filmed page ignores it (isClipSound), so the recording never has it twice.
 * The connection opens on the first clip and stays until the host leaves; between clips it publishes nothing.
 */
const IN_ROOM_GAIN = 0.5; // about -6 dB under the file: clearly heard, under a voice at speaking level

let conn: { room: Room; ready: Promise<Room> } | null = null;

/** The publish-only connection, opened once. Safe to call early (e.g. as the host picks a file) so the first clip isn't clipped. */
export function warmClipSound(): Promise<Room> {
  if (conn) return conn.ready;
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const ready = (async () => {
    const r = await apiRequest("POST", "/api/host/my-studio/clip-token");
    const { url, token } = (await r.json()) as { url: string; token: string };
    await room.connect(url, token, { autoSubscribe: false });
    return room;
  })();
  conn = { room, ready };
  ready.catch(() => { if (conn?.room === room) conn = null; });
  return ready;
}

/** The host leaves: close it. */
export async function closeClipSound(): Promise<void> {
  const c = conn;
  conn = null;
  if (c) await c.room.disconnect().catch(() => {});
}

export type StageClip = { key: string; url: string; loop: boolean; sec?: number };
/** The host's Pause / Play / From the start (RoomLive.clip). */
export type ClipControl = { scene: string; rev: number; pos: number; paused: boolean };

/** Bring a copy of the clip to the host's latest Pause / Play / From the start (once per press). */
export function applyClip(v: HTMLVideoElement, c: ClipControl) {
  const tag = `${c.scene}:${c.rev}`;
  if (v.dataset.clipRev === tag || v.dataset.clipWait === tag) return;
  const go = () => {
    v.dataset.clipRev = tag;
    try { v.currentTime = c.pos; } catch { /* not seekable yet */ }
    if (c.paused) v.pause(); else void v.play().catch(() => {});
  };
  if (v.readyState >= 1) go();
  else { v.dataset.clipWait = tag; v.addEventListener("loadedmetadata", go, { once: true }); }
}

/** The host's own copy of the clip on air, for the player bar's clock. */
let current: HTMLVideoElement | null = null;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
export function useStageClipElement(): HTMLVideoElement | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => null);
}

/**
 * Plays `clip` (hidden, not out loud) from the moment it's on stage, and publishes its sound while it
 * plays. A play-once clip calls `onEnded` when it finishes (a moment after, so the filmed copy, which
 * started a moment later, has finished too).
 */
export function useClipSound(clip: StageClip | null, onEnded?: () => void, control?: ClipControl | null) {
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const elRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!clip) return;
    let alive = true;
    let done = false;
    let track: MediaStreamTrack | null = null;
    let published: LocalAudioTrack | null = null;
    const el = document.createElement("video");
    el.crossOrigin = "anonymous"; // R2 sends CORS for the site's origins; without it Web Audio hears silence
    el.playsInline = true;
    el.preload = "auto";
    el.loop = clip.loop;
    el.src = clip.url;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = IN_ROOM_GAIN;
    const dest = ctx.createMediaStreamDestination();
    // Through Web Audio only (never to this page's speakers): the host hears it from the room like everyone else.
    ctx.createMediaElementSource(el).connect(gain).connect(dest);
    track = dest.stream.getAudioTracks()[0] ?? null;

    const finish = () => {
      if (done || clip.loop) return;
      done = true;
      window.setTimeout(() => { if (alive) ended.current?.(); }, 1500);
    };
    el.addEventListener("ended", finish);
    // A backstop when the file won't play here (it still ends on the filmed page): its length, if we know it.
    // Paused, it waits; playing again, it counts down what's left.
    let backstop = !clip.loop && clip.sec ? window.setTimeout(finish, (clip.sec + 1.5) * 1000) : 0;
    const held = () => { window.clearTimeout(backstop); backstop = 0; };
    const resumed = () => {
      window.clearTimeout(backstop);
      const len = el.duration || clip.sec || 0;
      backstop = !clip.loop && len ? window.setTimeout(finish, (Math.max(0, len - el.currentTime) + 1.5) * 1000) : 0;
    };
    el.addEventListener("pause", held);
    el.addEventListener("play", resumed);
    elRef.current = el;
    current = el;
    tell();

    void ctx.resume().catch(() => {});
    void el.play().catch(() => {});
    void (async () => {
      try {
        const room = await warmClipSound();
        if (!alive || !track) return;
        const pub = await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: "clip-sound", dtx: false, red: false, audioPreset: AudioPresets.music });
        published = (pub.track as LocalAudioTrack | undefined) ?? null;
        if (!alive && published) await room.localParticipant.unpublishTrack(published, false).catch(() => {});
      } catch (e) {
        console.warn("Clip sound for the room didn't start:", (e as Error).message);
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(backstop);
      el.removeEventListener("ended", finish);
      el.removeEventListener("pause", held);
      el.removeEventListener("play", resumed);
      elRef.current = null;
      if (current === el) { current = null; tell(); }
      el.pause();
      el.removeAttribute("src");
      el.load();
      const p = published;
      if (p && conn) void conn.ready.then((room) => room.localParticipant.unpublishTrack(p, false)).catch(() => {});
      track?.stop();
      void ctx.close().catch(() => {});
    };
  }, [clip?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // The host's Pause / Play / From the start reach this copy too.
  useEffect(() => { if (elRef.current && control) applyClip(elRef.current, control); }, [clip?.key, control?.rev]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Every copy of the clip drawn under `root` (the filmed page, the host's preview) follows the host's presses. */
export function useClipSync(root: { current: HTMLElement | null }, control: ClipControl | null | undefined, activeScene: string | null | undefined, playing: boolean) {
  useEffect(() => {
    if (!control || playing || control.scene !== activeScene) return;
    const run = () => root.current?.querySelectorAll<HTMLVideoElement>("video[src]").forEach((v) => applyClip(v, control));
    run();
    const t = window.setInterval(run, 500); // a copy drawn a moment later (a scene re-laid out) catches up too
    return () => window.clearInterval(t);
  }, [control?.rev, control?.scene, activeScene, playing]); // eslint-disable-line react-hooks/exhaustive-deps
}
