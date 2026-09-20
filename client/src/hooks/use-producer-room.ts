import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type TrackPublication } from "livekit-client";

// The control room's view of the LiveKit room: subscribe to everyone, publish
// nothing. This is what puts a live thumbnail next to each name in the green
// room, so the producer can see someone's camera before bringing them on.

export interface ProducerFeed {
  identity: string;
  name: string;
  /** Mirrored from our database onto the LiveKit participant by the server. */
  state: string;
  displayTitle: string;
  speaking: boolean;
  /** Remote tracks for everyone else; the producer's own local tracks when on camera. */
  video: Track | null;
  audio: Track | null;
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
  // How loud you actually are, 0..1.
  //
  // Without this the only way to know your microphone works is to turn on
  // Listen, which plays the stage back at you — and when you are the stage,
  // that is you, half a second late. Every person who tried it read the echo
  // as a fault in the studio. A meter answers the question the echo was being
  // used to answer, and answers it silently.
  const [level, setLevel] = useState(0);
  /** The raw published mic track, so the deck can play it back locally. */
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
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
      const add = (p: Participant) => {
        let video: Track | null = null;
        let audio: Track | null = null;
        p.trackPublications.forEach((pub: TrackPublication) => {
          if (!pub.track) return;
          if (pub.kind === Track.Kind.Video) video = pub.track;
          if (pub.kind === Track.Kind.Audio) audio = pub.track;
        });
        next.set(p.identity, {
          identity: p.identity,
          name: p.name || p.identity,
          state: p.attributes?.state ?? "Green room",
          displayTitle: p.attributes?.displayTitle ?? "",
          speaking: p.isSpeaking,
          video,
          audio,
        });
      };
      r.remoteParticipants.forEach(add);
      // The producer on camera is a participant too. Leaving them out is why
      // the Host tile showed initials and the host could never be put on stage.
      if (publish && r.localParticipant.trackPublications.size > 0) add(r.localParticipant);
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
      // Your own camera and mic state has to come off the room, not off the
      // buttons that change it. setCamOn only ever ran inside toggleCam, so
      // anything else that enabled the camera — going on stage does exactly
      // that — left the deck reading "Camera off" over a live picture. The
      // events that already fire on publish and mute now carry it.
      const syncSelf = () => {
        if (!room) return;
        setCamOn(room.localParticipant.isCameraEnabled);
        setMicOn(room.localParticipant.isMicrophoneEnabled);
      };
      const refresh = () => {
        if (!room) return;
        snapshot(room);
        syncSelf();
      };
      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, refresh)
        .on(RoomEvent.TrackUnsubscribed, refresh)
        .on(RoomEvent.ParticipantAttributesChanged, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
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

  useEffect(() => {
    const room = roomRef.current;
    const track = room?.localParticipant?.getTrackPublication(Track.Source.Microphone)?.track;
    const mst = (track as any)?.mediaStreamTrack as MediaStreamTrack | undefined;
    setMicTrack(mst ?? null);
    if (!mst || !micOn) { setLevel(0); return; }

    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(new MediaStream([mst]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        setLevel(Math.min(1, peak / 64));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* no audio context (autoplay policy, no device) — the meter just stays flat */
    }
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => {});
      setLevel(0);
    };
  }, [micOn, status]);

  return { status, feeds, camOn, micOn, toggleCam, toggleMic, selfKey, level, micTrack };
}
