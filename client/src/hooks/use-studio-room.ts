import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { apiRequest } from "@/lib/queryClient";

// Connects a speaker to the LiveKit room behind their studio and publishes the
// camera and mic they already granted us. Everyone in the room publishes, green
// room included, so the producer can check them before they're on air; who
// actually reaches the broadcast is decided by the composite, not here.

export interface RoomPeer {
  identity: string;
  name: string;
  /** "Green room" or "On stage", mirrored from our own database by the server. */
  state: string;
  videoTrack: RemoteTrack | null;
  audioTrack: RemoteTrack | null;
}

interface Args {
  /** Only connect once they've joined and we actually have tracks to send. */
  enabled: boolean;
  clientKey: string;
  slug?: string;
  studioId?: number;
  stream: MediaStream | null;
}

type Status = "idle" | "connecting" | "connected" | "unavailable" | "error";

export function useStudioRoom({ enabled, clientKey, slug, studioId, stream }: Args) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  // Bumping this re-runs the connection. Phones drop the socket the moment the
  // tab goes to the background; without this the page sat there "connected"
  // in name only, heartbeating, while the producer saw an empty tile.
  const [attempt, setAttempt] = useState(0);
  const dropsRef = useRef(0);
  const reconnect = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!enabled || !stream) return;
    let cancelled = false;
    let room: Room | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const again = (delayMs: number) => {
      if (cancelled || retry) return;
      retry = setTimeout(() => {
        retry = null;
        if (!cancelled) setAttempt((a) => a + 1);
      }, delayMs);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      if (!room || room.state === ConnectionState.Disconnected) again(300);
    };
    document.addEventListener("visibilitychange", onVisible);

    const snapshot = (r: Room) => {
      const next: RoomPeer[] = [];
      r.remoteParticipants.forEach((p: RemoteParticipant) => {
        let video: RemoteTrack | null = null;
        let audio: RemoteTrack | null = null;
        p.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (!pub.track) return;
          if (pub.kind === Track.Kind.Video) video = pub.track;
          if (pub.kind === Track.Kind.Audio) audio = pub.track;
        });
        next.push({
          identity: p.identity,
          name: p.name || p.identity,
          state: p.attributes?.state ?? "Green room",
          videoTrack: video,
          audioTrack: audio,
        });
      });
      setPeers(next);
    };

    (async () => {
      setStatus("connecting");
      let cfg: { configured: boolean; url?: string; token?: string };
      try {
        const res = await apiRequest("POST", "/api/studio/token", { clientKey, slug, studioId });
        cfg = await res.json();
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (!cfg.configured || !cfg.url || !cfg.token) {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      if (cancelled) return;

      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      const refresh = () => room && snapshot(room);
      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, refresh)
        .on(RoomEvent.TrackUnsubscribed, refresh)
        .on(RoomEvent.ParticipantAttributesChanged, refresh)
        .on(RoomEvent.Disconnected, () => {
          if (cancelled) return;
          setStatus("idle");
          // Back off a little more each time, never more than half a minute.
          dropsRef.current += 1;
          again(Math.min(30_000, 2_000 * 2 ** Math.min(dropsRef.current - 1, 4)));
        });

      try {
        await room.connect(cfg.url, cfg.token);
        // Publish the tracks the page already has, so the local preview and the
        // meter keep working off the same stream.
        for (const track of stream.getTracks()) {
          if (track.readyState === "ended") continue;
          await room.localParticipant.publishTrack(track);
        }
        if (cancelled) return;
        dropsRef.current = 0;
        setStatus("connected");
        snapshot(room);
      } catch {
        if (!cancelled) {
          setStatus("error");
          again(8_000);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
    // stream identity is what matters here, not its contents
  }, [enabled, clientKey, slug, studioId, stream, attempt]);

  /**
   * Connection health, read from the transport rather than guessed.
   *
   * LiveKit publishes a ConnectionQuality per participant, which is the same
   * signal the server uses to decide whether to drop someone's layer — so it
   * is the honest answer to "will I hold up", and it costs nothing to read.
   */
  const [quality, setQuality] = useState<{ label: string; detail: string; tone: "good" | "fair" | "poor" } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setQuality(null);
      return;
    }
    const read = () => {
      const q = roomRef.current?.localParticipant?.connectionQuality;
      if (!q) return;
      if (q === ConnectionQuality.Excellent) {
        setQuality({ label: "Strong", detail: "Plenty of headroom for full quality video.", tone: "good" });
      } else if (q === ConnectionQuality.Good) {
        setQuality({ label: "Good", detail: "Steady. You'll go out clean.", tone: "good" });
      } else if (q === ConnectionQuality.Poor) {
        setQuality({ label: "Struggling", detail: "Your picture will soften and may stutter. Worth fixing before you're on.", tone: "poor" });
      } else {
        setQuality({ label: "Checking…", detail: "Measuring your connection.", tone: "fair" });
      }
    };
    read();
    const id = setInterval(read, 3000);
    return () => clearInterval(id);
  }, [enabled, status]);

  return { status, peers, reconnect, quality };
}
