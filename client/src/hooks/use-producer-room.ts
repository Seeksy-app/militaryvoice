import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";

// The control room's view of the LiveKit room: subscribe to everyone, publish
// nothing. This is what puts a live thumbnail next to each name in the green
// room, so the producer can see someone's camera before bringing them on.

export interface ProducerFeed {
  identity: string;
  name: string;
  /** Mirrored from our database onto the LiveKit participant by the server. */
  state: string;
  speaking: boolean;
  video: RemoteTrack | null;
  audio: RemoteTrack | null;
}

type Status = "idle" | "connecting" | "connected" | "unavailable" | "error";

interface Args {
  enabled: boolean;
  /** The console's authenticated POST, so we don't duplicate admin auth here. */
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
}

export function useProducerRoom({ enabled, adminSend }: Args) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [feeds, setFeeds] = useState<Map<string, ProducerFeed>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let room: Room | null = null;

    const snapshot = (r: Room) => {
      const next = new Map<string, ProducerFeed>();
      r.remoteParticipants.forEach((p: RemoteParticipant) => {
        let video: RemoteTrack | null = null;
        let audio: RemoteTrack | null = null;
        p.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (!pub.track) return;
          if (pub.kind === Track.Kind.Video) video = pub.track;
          if (pub.kind === Track.Kind.Audio) audio = pub.track;
        });
        next.set(p.identity, {
          identity: p.identity,
          name: p.name || p.identity,
          state: p.attributes?.state ?? "Green room",
          speaking: p.isSpeaking,
          video,
          audio,
        });
      });
      setFeeds(next);
    };

    (async () => {
      setStatus("connecting");
      let cfg: { configured: boolean; url?: string; token?: string };
      try {
        const res = await adminSend("POST", "/api/admin/studio/token");
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

      room = new Room({ adaptiveStream: true });
      roomRef.current = room;
      const refresh = () => room && snapshot(room);
      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, refresh)
        .on(RoomEvent.TrackUnsubscribed, refresh)
        .on(RoomEvent.ParticipantAttributesChanged, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.Disconnected, () => !cancelled && setStatus("idle"));

      try {
        await room.connect(cfg.url, cfg.token);
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
    // adminSend is stable for the life of the console
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, feeds };
}
