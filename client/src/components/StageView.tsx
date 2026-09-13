import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";

// The stage, as an audience sees it. Shared by two very different pages: the
// headless template LiveKit's recorder films, and the public watch page people
// open in a browser. Keeping one implementation means the broadcast and the
// website can't drift apart.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

export interface RoomMeta {
  eventName?: string;
  studioName?: string;
  status?: string;
  fallbackPlaying?: boolean;
  fallbackVideoUrl?: string;
  fallbackLabel?: string;
}

export interface StageTile {
  identity: string;
  name: string;
  video: RemoteTrack | null;
  audio: RemoteTrack | null;
  speaking: boolean;
}

/**
 * Joins a room read-only and reports whoever the producer has put on stage.
 * Green room participants are deliberately never returned: they are not on air.
 */
export function useStageRoom(url: string | null, token: string | null, muted: boolean) {
  const [tiles, setTiles] = useState<StageTile[]>([]);
  const [meta, setMeta] = useState<RoomMeta>({});
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!url || !token) return;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let cancelled = false;

    const readMeta = (raw?: string) => {
      if (!raw) return;
      try {
        setMeta(JSON.parse(raw) as RoomMeta);
      } catch {
        /* metadata is data, not something to trust */
      }
    };

    const snapshot = () => {
      const next: StageTile[] = [];
      room.remoteParticipants.forEach((p: RemoteParticipant) => {
        if ((p.attributes?.state ?? "") !== "On stage") return;
        let video: RemoteTrack | null = null;
        let audio: RemoteTrack | null = null;
        p.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (!pub.track) return;
          if (pub.kind === Track.Kind.Video) video = pub.track;
          if (pub.kind === Track.Kind.Audio) audio = pub.track;
        });
        next.push({ identity: p.identity, name: p.name || p.identity, video, audio, speaking: p.isSpeaking });
      });
      next.sort((a, b) => a.identity.localeCompare(b.identity));
      setTiles(next);
    };

    room
      .on(RoomEvent.ParticipantConnected, snapshot)
      .on(RoomEvent.ParticipantDisconnected, snapshot)
      .on(RoomEvent.TrackSubscribed, snapshot)
      .on(RoomEvent.TrackUnsubscribed, snapshot)
      .on(RoomEvent.ParticipantAttributesChanged, snapshot)
      .on(RoomEvent.ActiveSpeakersChanged, snapshot)
      .on(RoomEvent.RoomMetadataChanged, readMeta)
      .on(RoomEvent.Disconnected, () => !cancelled && setConnected(false));

    void room
      .connect(url, token)
      .then(() => {
        if (cancelled) return;
        readMeta(room.metadata);
        snapshot();
        setConnected(true);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      void room.disconnect();
      roomRef.current = null;
    };
  }, [url, token]);

  // A viewer arrives muted (browsers demand it) and unmutes with a tap.
  useEffect(() => {
    const room = roomRef.current;
    if (room && connected && !muted) void room.startAudio().catch(() => {});
  }, [muted, connected]);

  return { tiles, meta, connected, failed };
}

function gridFor(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n <= 4) return "grid-cols-2";
  return "grid-cols-3";
}

function Tile({ tile, muted }: { tile: StageTile; muted: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !tile.video) return;
    tile.video.attach(el);
    return () => {
      tile.video?.detach(el);
    };
  }, [tile.video]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !tile.audio) return;
    tile.audio.attach(el);
    return () => {
      tile.audio?.detach(el);
    };
  }, [tile.audio]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-[#04102b] ${
        tile.speaking ? "ring-4 ring-[#F0A71F]" : "ring-1 ring-white/10"
      }`}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      <audio ref={audioRef} autoPlay muted={muted} />

      {!tile.video && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#053877]">
          <span className="text-5xl font-bold text-white/80" style={HEADLINE_FONT}>
            {tile.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex items-center gap-2.5 rounded-lg bg-[#000741]/85 px-3.5 py-1.5 backdrop-blur-sm">
        <span className="h-5 w-1 rounded-full bg-[#F0A71F]" />
        <span className="whitespace-nowrap text-base font-semibold text-white" style={HEADLINE_FONT}>
          {tile.name}
        </span>
      </div>
    </div>
  );
}

/** The frame itself: standby clip, the stage, or a branded holding card. */
export function StageGrid({
  tiles,
  meta,
  muted = false,
  idleTitle,
}: {
  tiles: StageTile[];
  meta: RoomMeta;
  muted?: boolean;
  idleTitle?: string;
}) {
  const standby = meta.fallbackPlaying && meta.fallbackVideoUrl;

  if (standby) {
    return (
      <div className="absolute inset-0">
        <video src={meta.fallbackVideoUrl} autoPlay loop playsInline muted={muted} className="h-full w-full object-cover" />
        {meta.fallbackLabel && (
          <div
            className="absolute bottom-8 left-8 rounded-lg bg-[#000741]/85 px-5 py-3 text-xl font-semibold text-white backdrop-blur-sm"
            style={HEADLINE_FONT}
          >
            {meta.fallbackLabel}
          </div>
        )}
      </div>
    );
  }

  if (tiles.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
        <img src="/logo-wave.png" alt="" className="h-20 w-auto opacity-90" />
        <p className="text-2xl font-semibold text-white/85 sm:text-3xl" style={HEADLINE_FONT}>
          {idleTitle ?? meta.eventName ?? "Back shortly"}
        </p>
        <p className="text-base text-white/50">We'll be right back.</p>
      </div>
    );
  }

  return (
    <div className={`grid h-full w-full gap-3 p-3 ${gridFor(tiles.length)}`}>
      {tiles.map((t) => (
        <Tile key={t.identity} tile={t} muted={muted} />
      ))}
    </div>
  );
}
