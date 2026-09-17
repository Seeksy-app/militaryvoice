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
  preVideoUrl?: string;
  preLabel?: string;
  eventStartAtUtc?: string;
  stageMediaPlaying?: boolean;
  stageMediaUrl?: string;
  stageMediaKind?: string;
  stageMediaLabel?: string;
}

/**
 * Which standby to play. Before the event's start the pre-event card wins, so
 * a viewer arriving early is told when to come back rather than being shown
 * "we'll be right back", which reads as a show already in progress. Falls
 * through to the main standby whenever no pre-event card is set.
 */
function pickStandby(meta: RoomMeta): { url: string; label?: string } {
  const start = meta.eventStartAtUtc ? Date.parse(meta.eventStartAtUtc) : NaN;
  const beforeEvent = Number.isFinite(start) && Date.now() < start;
  if (beforeEvent && meta.preVideoUrl) return { url: meta.preVideoUrl, label: meta.preLabel };
  return { url: meta.fallbackVideoUrl ?? "", label: meta.fallbackLabel };
}

export interface StageTile {
  identity: string;
  name: string;
  /** e.g. "Host · Army Ranger" shown in the lower third */
  displayTitle?: string;
  /** A remote participant's track, or the producer's own local one when they're on camera. */
  video: Track | null;
  audio: Track | null;
  speaking: boolean;
}

/**
 * Joins a room read-only and reports whoever the producer has put on stage.
 * Green room participants are deliberately never returned: they are not on air.
 */
export function useStageRoom(url: string | null, token: string | null, muted: boolean) {
  const [tiles, setTiles] = useState<StageTile[]>([]);
  const [meta, setMeta] = useState<RoomMeta>({});
  // Captions arrive as data messages from a transcription agent sitting in the
  // room. Nothing here knows or cares which model produced them.
  const [caption, setCaption] = useState<{ speaker: string; text: string } | null>(null);
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
        next.push({ identity: p.identity, name: p.name || p.identity, displayTitle: p.attributes?.displayTitle || "", video, audio, speaking: p.isSpeaking });
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
      .on(RoomEvent.DataReceived, (payload: Uint8Array, _p, _k, topic?: string) => {
        if (topic && topic !== "captions") return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as {
            type?: string;
            speaker?: string;
            text?: string;
            final?: boolean;
          };
          if (msg.type !== "caption") return;
          const text = (msg.text ?? "").trim();
          setCaption(text ? { speaker: msg.speaker ?? "", text } : null);
        } catch {
          /* anything unparseable on this topic isn't ours */
        }
      })
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

  return { tiles, meta, connected, failed, caption };
}

/**
 * A YouTube link is what people actually have, so play it rather than refusing
 * it. Autoplay with sound is at the browser's discretion, which is why an
 * uploaded file is still the safer choice for a real emergency.
 */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
  return m ? m[1] : null;
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
      {/* contain, not cover: a camera that isn't exactly 16:9 gets letterboxed
          rather than cropped. Losing the top of someone's head on air is worse
          than a black bar. */}
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
      <audio ref={audioRef} autoPlay muted={muted} />

      {!tile.video && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#053877]">
          <span className="text-5xl font-bold text-white/80" style={HEADLINE_FONT}>
            {tile.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}

      {/* Lower third — broadcast-style name bar */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pb-3">
        <div className="flex items-stretch overflow-hidden rounded-md shadow-lg" style={{ maxWidth: "calc(100% - 0px)" }}>
          {/* Accent stripe */}
          <div className="w-1 shrink-0 bg-[#F0A71F]" />
          <div className="bg-[#000741]/90 backdrop-blur-sm px-3 py-1.5 min-w-0">
            <p className="whitespace-nowrap text-sm font-bold leading-tight text-white truncate" style={HEADLINE_FONT}>
              {tile.name}
            </p>
            {tile.displayTitle && (
              <p className="whitespace-nowrap text-xs leading-tight text-[#F0A71F]/90 truncate" style={HEADLINE_FONT}>
                {tile.displayTitle}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A clip, a slide or a sponsor card, filling the frame. */
function FullFrameMedia({
  url,
  kind,
  label,
  muted,
}: {
  url: string;
  kind: string;
  label?: string;
  muted: boolean;
}) {
  const yt = youtubeId(url);
  return (
    <div className="absolute inset-0 bg-black">
      {kind === "image" ? (
        <img src={url} alt={label ?? ""} className="h-full w-full object-contain" />
      ) : yt ? (
        <iframe
          title={label || "On stage"}
          src={`https://www.youtube.com/embed/${yt}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&modestbranding=1&rel=0&playsinline=1`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="h-full w-full border-0"
        />
      ) : (
        <video src={url} autoPlay playsInline muted={muted} className="h-full w-full object-contain" />
      )}
      {label && (
        <div
          className="pointer-events-none absolute bottom-8 left-8 rounded-lg bg-[#000741]/85 px-5 py-3 text-xl font-semibold text-white backdrop-blur-sm"
          style={HEADLINE_FONT}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** The frame itself: standby clip, played media, the stage, or a holding card. */
export function StageGrid({
  tiles,
  meta,
  muted = false,
  idleTitle,
  caption,
}: {
  tiles: StageTile[];
  meta: RoomMeta;
  muted?: boolean;
  idleTitle?: string;
  caption?: { speaker: string; text: string } | null;
}) {
  // Standby is the emergency, so it outranks anything chosen deliberately.
  // Before the event opens it plays the pre-event card instead, decided here
  // against the viewer's own clock — a server-side switch would have to be
  // pushed, and room metadata only changes when someone touches the studio.
  const standby = pickStandby(meta);
  if (meta.fallbackPlaying && standby.url) {
    return <FullFrameMedia url={standby.url} kind="video" label={standby.label} muted={muted} />;
  }

  if (meta.stageMediaPlaying && meta.stageMediaUrl) {
    return (
      <FullFrameMedia
        url={meta.stageMediaUrl}
        kind={meta.stageMediaKind ?? "video"}
        label={meta.stageMediaLabel}
        muted={muted}
      />
    );
  }

  if (tiles.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
        <img src="/logo-wave.png?v=2" alt="" className="h-20 w-auto opacity-90" />
        <p className="text-2xl font-semibold text-white/85 sm:text-3xl" style={HEADLINE_FONT}>
          {idleTitle ?? meta.eventName ?? "Back shortly"}
        </p>
        <p className="text-base text-white/50">We'll be right back.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`grid h-full w-full gap-3 p-3 ${gridFor(tiles.length)}`}>
        {tiles.map((t) => (
          <Tile key={t.identity} tile={t} muted={muted} />
        ))}
      </div>
      <Captions caption={caption} />
    </>
  );
}

/** Burned into the frame, so they reach the recording and every destination. */
function Captions({ caption }: { caption?: { speaker: string; text: string } | null }) {
  if (!caption?.text) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 pb-6">
      <p className="max-w-4xl rounded-xl bg-black/75 px-5 py-2.5 text-center text-lg leading-snug text-white backdrop-blur-sm sm:text-xl">
        {caption.speaker && <span className="mr-2 font-semibold text-[#F0A71F]">{caption.speaker}:</span>}
        {caption.text}
      </p>
    </div>
  );
}
