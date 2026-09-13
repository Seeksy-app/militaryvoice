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
  /** Which studio we're watching — changing it reconnects. */
  studioId: number | null;
  /** Go on camera: reconnects as a real participant who can publish. */
  publish: boolean;
  displayName?: string;
}

export function useProducerRoom({ enabled, adminSend, studioId, publish, displayName }: Args) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [feeds, setFeeds] = useState<Map<string, ProducerFeed>>(new Map());
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [selfKey, setSelfKey] = useState<string | null>(null);

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
      let cfg: { configured: boolean; url?: string; token?: string; clientKey?: string };
      try {
        const res = await adminSend("POST", "/api/admin/studio/token", {
          studioId,
          publish,
          displayName,
        });
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
        setSelfKey(cfg.clientKey ?? null);
        if (publish) {
          // Camera and mic come up together; the deck turns each off again.
          await room.localParticipant.enableCameraAndMicrophone().catch(() => {});
          if (!cancelled) {
            setCamOn(room.localParticipant.isCameraEnabled);
            setMicOn(room.localParticipant.isMicrophoneEnabled);
          }
        }
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
  }, [enabled, studioId, publish]);

  async function toggleCam() {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(next).catch(() => {});
    setCamOn(room.localParticipant.isCameraEnabled);
  }

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(next).catch(() => {});
    setMicOn(room.localParticipant.isMicrophoneEnabled);
  }

  return { status, feeds, camOn, micOn, toggleCam, toggleMic, selfKey };
}
