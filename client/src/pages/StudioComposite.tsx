import { useEffect, useMemo, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";

// The broadcast itself.
//
// LiveKit's egress loads this page in a headless browser and records what it
// sees, so this is literally what the audience watches. It joins as a hidden
// recorder, shows only the people the producer has put on stage, and cuts to
// the standby clip when the control room rolls it.
//
// Contract with the recorder: log START_RECORDING once we're ready to be
// filmed, and END_RECORDING when the show is over. Nothing is captured before
// the first, and the file isn't finalised until the second.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface RoomMeta {
  eventName?: string;
  studioName?: string;
  status?: string;
  fallbackPlaying?: boolean;
  fallbackVideoUrl?: string;
  fallbackLabel?: string;
}

interface Tile {
  identity: string;
  name: string;
  video: RemoteTrack | null;
  audio: RemoteTrack | null;
  speaking: boolean;
}

/** Fills the frame with as few wasted pixels as possible for 1–6 people. */
function gridFor(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n <= 4) return "grid-cols-2";
  return "grid-cols-3";
}

function Stage({ tile, solo }: { tile: Tile; solo: boolean }) {
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
      <audio ref={audioRef} autoPlay />

      {!tile.video && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#053877]">
          <span className="text-6xl font-bold text-white/80" style={HEADLINE_FONT}>
            {tile.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}

      {/* lower third */}
      <div className="absolute bottom-0 left-0 flex items-center">
        <div className="h-1.5 w-full" />
        <div
          className={`m-4 flex items-center gap-3 rounded-lg bg-[#000741]/85 px-4 py-2 backdrop-blur-sm ${
            solo ? "" : "scale-90 origin-bottom-left"
          }`}
        >
          <span className="h-6 w-1 rounded-full bg-[#F0A71F]" />
          <span className="whitespace-nowrap text-xl font-semibold text-white" style={HEADLINE_FONT}>
            {tile.name}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function StudioComposite() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [meta, setMeta] = useState<RoomMeta>({});
  const startedRef = useRef(false);

  useEffect(() => {
    const url = params.get("url");
    const token = params.get("token");
    if (!url || !token) return;

    const room = new Room({ adaptiveStream: false, dynacast: false });
    let ended = false;

    const readMeta = (raw?: string) => {
      if (!raw) return;
      try {
        setMeta(JSON.parse(raw) as RoomMeta);
      } catch {
        /* metadata isn't ours to trust — ignore anything unparseable */
      }
    };

    const snapshot = () => {
      const next: Tile[] = [];
      room.remoteParticipants.forEach((p: RemoteParticipant) => {
        // Only the people the producer has actually put on stage. Everyone
        // else is in the green room and must never reach the audience.
        if ((p.attributes?.state ?? "") !== "On stage") return;
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
          video,
          audio,
          speaking: p.isSpeaking,
        });
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
      .on(RoomEvent.Disconnected, () => {
        if (ended) return;
        ended = true;
        console.log("END_RECORDING");
      });

    void room
      .connect(url, token)
      .then(() => {
        readMeta(room.metadata);
        snapshot();
        if (!startedRef.current) {
          startedRef.current = true;
          // Everything below this line is on air.
          console.log("START_RECORDING");
        }
      })
      .catch(() => {
        // Nothing to film. Say so rather than leaving the recorder hanging.
        console.log("START_RECORDING");
        console.log("END_RECORDING");
      });

    return () => {
      void room.disconnect();
    };
  }, [params]);

  const standby = meta.fallbackPlaying && meta.fallbackVideoUrl;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#000741]">
      {standby ? (
        <div className="absolute inset-0">
          <video
            src={meta.fallbackVideoUrl}
            autoPlay
            loop
            playsInline
            className="h-full w-full object-cover"
          />
          {meta.fallbackLabel && (
            <div className="absolute bottom-8 left-8 rounded-lg bg-[#000741]/85 px-5 py-3 text-2xl font-semibold text-white backdrop-blur-sm" style={HEADLINE_FONT}>
              {meta.fallbackLabel}
            </div>
          )}
        </div>
      ) : tiles.length === 0 ? (
        // Between segments. Never a blank screen on air.
        <div className="flex h-full w-full flex-col items-center justify-center gap-6">
          <img src="/logo-wave.png" alt="" className="h-24 w-auto opacity-90" />
          <p className="text-3xl font-semibold text-white/85" style={HEADLINE_FONT}>
            {meta.eventName || "Back shortly"}
          </p>
          <p className="text-lg text-white/50">We'll be right back.</p>
        </div>
      ) : (
        <div className={`grid h-full w-full gap-3 p-3 ${gridFor(tiles.length)}`}>
          {tiles.map((t) => (
            <Stage key={t.identity} tile={t} solo={tiles.length === 1} />
          ))}
        </div>
      )}

      {/* brand furniture, over everything */}
      <img
        src="/logo-wave.png"
        alt=""
        className="pointer-events-none absolute right-6 top-5 h-10 w-auto opacity-90 drop-shadow-lg"
      />
      {meta.status === "Live" && !standby && (
        <div className="pointer-events-none absolute left-6 top-5 flex items-center gap-2 rounded-full bg-[#ED1C24] px-4 py-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
          <span className="text-sm font-bold uppercase tracking-[0.14em] text-white">Live</span>
        </div>
      )}
    </div>
  );
}
