import { useEffect, useRef, useState } from "react";
import {
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

  useEffect(() => {
    if (!enabled || !stream) return;
    let cancelled = false;
    let room: Room | null = null;

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
        .on(RoomEvent.Disconnected, () => !cancelled && setStatus("idle"));

      try {
        await room.connect(cfg.url, cfg.token);
        // Publish the tracks the page already has, so the local preview and the
        // meter keep working off the same stream.
        for (const track of stream.getTracks()) {
          await room.localParticipant.publishTrack(track);
        }
        if (cancelled) return;
        setStatus("connected");
        snapshot(room);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
    // stream identity is what matters here, not its contents
  }, [enabled, clientKey, slug, studioId, stream]);

  return { status, peers };
}
