import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  eventEndAtUtc?: string;
  logoUrl?: string;
  logoCorner?: string;
  logoSize?: number;
  countdownEndsAtUtc?: string;
  countdownLabel?: string;
  currentSceneId?: number;
  /** Behind the cameras. Blank when it's switched off, so the player never decides. */
  backgroundUrl?: string;
  /** full · wide (16:9) · square — the shape each camera takes on stage. */
  tileFit?: string;
  /** The lower third that is on air. Blank when it's off. */
  bannerTitle?: string;
  bannerSubtitle?: string;
  /** The ticker crawling along the bottom. Blank when it's off. */
  tickerText?: string;
  stageMediaPlaying?: boolean;
  stageMediaUrl?: string;
  stageMediaKind?: string;
  stageMediaLabel?: string;
  /** The show the taken scene belongs to, for the card an empty stage holds. */
  stageCardName?: string;
  stageCardShow?: string;
  stageCardPhoto?: string;
  stageCardSponsor?: string;
  stageCardSponsorLogo?: string;
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
  /** An avatar, whose feed arrives on a chroma-key green background. */
  keyed?: boolean;
}

/**
 * Joins a room read-only and reports whoever the producer has put on stage.
 * Green room participants are deliberately never returned: they are not on air.
 */
export function useStageRoom(
  url: string | null,
  token: string | null,
  muted: boolean,
  seedMeta?: RoomMeta,
  /** The recorder's copy of the stage, rather than a viewer's. */
  forRecording = false,
) {
  const [tiles, setTiles] = useState<StageTile[]>([]);
  // Seeded from the record, then overwritten by the room's own metadata once
  // there is a room to read it from. Before the event there is not.
  const [meta, setMeta] = useState<RoomMeta>(seedMeta ?? {});
  // Captions arrive as data messages from a transcription agent sitting in the
  // room. Nothing here knows or cares which model produced them.
  const [caption, setCaption] = useState<{ speaker: string; text: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (seedMeta) setMeta((prev) => ({ ...seedMeta, ...prev }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(seedMeta ?? {})]);

  useEffect(() => {
    if (!url || !token) return;
    // Adaptive stream and dynacast are a viewer's economy: they ask for a
    // smaller layer when a tile is small, and stop a track the page is not
    // showing. The recorder has no such budget, and a six-way stage is exactly
    // the case that makes every tile small — so the more people are on, the
    // softer it would film them. It takes the full layer of every tile.
    const room = new Room({ adaptiveStream: !forRecording, dynacast: !forRecording });
    roomRef.current = room;
    let cancelled = false;

    const readMeta = (raw?: string) => {
      if (!raw || raw === "{}") return;   // an empty room must not clear the seed
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
        next.push({
          identity: p.identity,
          name: p.name || p.identity,
          displayTitle: p.attributes?.displayTitle || "",
          video, audio, speaking: p.isSpeaking,
          // The avatar renders on green — that is the right output for a
          // source meant to be composited, not a shortcoming. It gets keyed
          // here so she sits on our stage instead of a wall of green.
          keyed: p.attributes?.avatar === "1",
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

/** The box a camera sits in, sized off its cell (a size container). */
function fitBox(fit: string | undefined): CSSProperties {
  if (fit === "full") return { width: "100%", height: "100%" };
  if (fit === "square") return { width: "min(100%, 100cqh)", aspectRatio: "1 / 1" };
  return { width: "min(100%, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" };
}

function Tile({ tile, muted, namePos = "bottom", fit }: { tile: StageTile; muted: boolean; namePos?: "bottom" | "top" | "none"; fit?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !tile.video) return;
    tile.video.attach(el);
    return () => {
      tile.video?.detach(el);
    };
  }, [tile.video]);

  // Keying the avatar's green out, frame by frame.
  //
  // Done on a canvas rather than with a CSS blend, because a blend cannot
  // produce real transparency — it can only darken or lighten, which leaves a
  // green cast on her hair and a hard edge everywhere else. Comparing green
  // against the other two channels drops the background and keeps skin, which
  // is also green-ish in absolute terms and would vanish under a naive
  // threshold.
  useEffect(() => {
    if (!tile.keyed) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      // Half resolution: this runs every frame and she is one tile in a grid,
      // not the thing anyone is squinting at.
      const cw = Math.min(w, 640), ch = Math.round((cw / w) * h);
      if (canvas.width !== cw) { canvas.width = cw; canvas.height = ch; }
      ctx.drawImage(video, 0, 0, cw, ch);
      const frame = ctx.getImageData(0, 0, cw, ch);
      const d = frame.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // Green well ahead of both neighbours, and bright enough to be the
        // backdrop rather than a shadow on it.
        if (g > 90 && g > r * 1.35 && g > b * 1.35) {
          d[i + 3] = 0;
        } else if (g > r * 1.1 && g > b * 1.1) {
          // The spill fringe: keep the pixel, pull the green back toward its
          // neighbours so she has no lime halo.
          d[i + 1] = Math.max(r, b);
        }
      }
      ctx.putImageData(frame, 0, 0);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [tile.keyed, tile.video]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !tile.audio) return;
    tile.audio.attach(el);
    return () => {
      tile.audio?.detach(el);
    };
  }, [tile.audio]);

  return (
    // Every face gets the same box — filling the cell, 16:9 or square, as the
    // studio is set — so a laptop's 4:3 camera and a webcam's 16:9 sit side
    // by side at one size. The box sizes off the cell, not off the video.
    <div className="relative flex min-h-0 min-w-0 items-center justify-center [container-type:size]">
    <div
      className={`relative overflow-hidden rounded-2xl bg-[#04102b] ${
        tile.speaking ? "ring-4 ring-[#F0A71F]" : "ring-1 ring-white/10"
      }`}
      style={fitBox(fit)}
    >
      {/* Cover, weighted to the top third where the face is: a 4:3 camera
          loses a sliver of desk and ceiling, not the top of anyone's head.
          A phone held upright would lose half of itself that way, so a
          portrait feed is letterboxed instead. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={(e) => setPortrait(e.currentTarget.videoHeight > e.currentTarget.videoWidth)}
        onResize={(e) => setPortrait(e.currentTarget.videoHeight > e.currentTarget.videoWidth)}
        className={`h-full w-full ${portrait ? "object-contain" : "object-cover object-[50%_30%]"} ${tile.keyed ? "invisible absolute" : ""}`}
      />
      {tile.keyed && <canvas ref={canvasRef} className="h-full w-full object-contain" />}
      <audio ref={audioRef} autoPlay muted={muted} />

      {!tile.video && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#053877]">
          <span className="text-5xl font-bold text-white/80" style={HEADLINE_FONT}>
            {tile.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}

      {/* Each person's name, as they typed it in the green room. While a
          scene's lower third is up the tag moves to the top of the tile, so
          the two never stack in one corner; alone on stage under a lower
          third it steps aside, since the banner already names them. */}
      <div className={`absolute left-0 right-0 px-3 ${namePos === "top" ? "top-0 pt-3" : "bottom-0 pb-3"} ${namePos === "none" ? "hidden" : ""}`}>
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
    </div>
  );
}

/** A clip, a slide or a sponsor card, filling the frame. */
function FullFrameMedia({
  url,
  kind,
  label,
  muted,
  loop = false,
}: {
  url: string;
  kind: string;
  label?: string;
  muted: boolean;
  /** Standby holds the frame for hours, so its clip runs on repeat. A show's
      own episode does not — it ends when it ends. */
  loop?: boolean;
}) {
  const yt = youtubeId(url);
  return (
    <div className="absolute inset-0 bg-black">
      {kind === "image" ? (
        <img src={url} alt={label ?? ""} className="h-full w-full object-contain" />
      ) : yt ? (
        <iframe
          title={label || "On stage"}
          src={`https://www.youtube.com/embed/${yt}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&modestbranding=1&rel=0&playsinline=1${
            loop ? `&loop=1&playlist=${yt}` : ""
          }`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="h-full w-full border-0"
        />
      ) : (
        <video src={url} autoPlay playsInline loop={loop} muted={muted} className="h-full w-full object-contain" />
      )}
      {label && (
        <div
          // Small enough to sit under the artwork rather than across it. At
          // text-xl with that padding it reached the middle of the frame and
          // covered whichever podcaster's logo happened to be bottom-left —
          // the standby reel is a grid of faces, so something always lost.
          className="pointer-events-none absolute bottom-4 left-4 rounded-md bg-[#000741]/85 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm sm:bottom-5 sm:left-5 sm:text-base"
          style={HEADLINE_FONT}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** mm:ss, or h:mm:ss once there's an hour on the clock. */
export function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * A break clock, filling the frame.
 *
 * The metadata carries the instant it reaches zero, not a number of seconds
 * left, so every viewer counts down against their own clock: nobody has to be
 * sent a tick, a late arrival joins at the right number, and a reconnect
 * doesn't restart it. It holds at 00:00 rather than cutting away — a stuck
 * zero reads as "they're running late", which is true, where an empty stage
 * reads as a fault.
 */
function CountdownFrame({ endsAt, label }: { endsAt: number; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, (endsAt - now) / 1000);
  const done = left <= 0;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#04102b]"
      style={{ background: "radial-gradient(120% 90% at 50% 0%, #0d2451 0%, #04102b 62%)" }}
      data-testid="stage-countdown"
    >
      <img src="/logo-wave.png?v=2" alt="" className="h-12 w-auto opacity-80 sm:h-16" />
      {label && (
        <p className="px-6 text-center text-lg font-semibold uppercase tracking-[0.22em] text-[#F0A71F] sm:text-xl">
          {label}
        </p>
      )}
      <p
        className={`text-[19vw] font-bold leading-none tabular-nums sm:text-[15vw] ${done ? "text-white/45" : "text-white"}`}
        style={HEADLINE_FONT}
      >
        {clockText(left)}
      </p>
      <p className="text-sm uppercase tracking-[0.3em] text-white/40">{done ? "Starting shortly" : "Back in"}</p>
    </div>
  );
}

const CORNER_CLASS: Record<string, string> = {
  "top-left": "left-[3%] top-[4%]",
  "top-right": "right-[3%] top-[4%]",
  "bottom-left": "left-[3%] bottom-[4%]",
  "bottom-right": "right-[3%] bottom-[4%]",
};

/**
 * The station mark, above everything. Sized as a share of the frame rather
 * than in pixels: the same studio is composited at 1080p for the broadcast and
 * at whatever width the watch page happens to be, and a 96px logo that looks
 * right in the console would be a postage stamp on the stream.
 */
function LogoOverlay({ url, corner, size }: { url: string; corner?: string; size?: number }) {
  if (!url) return null;
  // 96px against a 1280-wide reference frame — the number the console shows.
  const pct = Math.min(40, Math.max(4, ((size ?? 96) / 1280) * 100));
  return (
    <div className={`pointer-events-none absolute z-20 ${CORNER_CLASS[corner ?? "top-right"] ?? CORNER_CLASS["top-right"]}`} style={{ width: `${pct}%` }}>
      <img src={url} alt="" className="h-auto w-full object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]" data-testid="stage-logo" />
    </div>
  );
}

/**
 * The manual lower third: the title of the segment, the name of a caller, the
 * thing a producer types thirty seconds before it is needed.
 *
 * Drawn in the same hand as the per-tile name bar — gold rule, navy slab — so
 * one show does not look like two. Sized as a share of the frame for the same
 * reason the logo is: this is composited at 1080p and drawn in a console panel
 * a few hundred pixels wide.
 */
function BannerOverlay({ title, subtitle, lifted }: { title: string; subtitle: string; lifted: boolean }) {
  if (!title) return null;
  return (
    <div
      className={`pointer-events-none absolute left-[3%] z-20 max-w-[62%] ${lifted ? "bottom-[13%]" : "bottom-[7%]"}`}
      data-testid="stage-banner"
    >
      <div className="flex items-stretch overflow-hidden rounded-md shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
        <div className="w-[6px] shrink-0 bg-[#F0A71F]" />
        <div className="min-w-0 bg-[#000741]/92 px-4 py-2 backdrop-blur-sm">
          <p className="truncate text-[clamp(0.95rem,2.1cqw,1.9rem)] font-bold leading-tight text-white" style={HEADLINE_FONT}>
            {title}
          </p>
          {subtitle && (
            <p className="truncate text-[clamp(0.7rem,1.35cqw,1.15rem)] leading-tight text-[#F0A71F]" style={HEADLINE_FONT}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The crawl along the bottom edge.
 *
 * Duration scales with the length of the text so a long line does not sprint
 * past unreadably and a short one does not crawl — roughly a constant reading
 * speed either way. It stops moving entirely under prefers-reduced-motion,
 * where it simply sits and is still readable.
 */
function TickerOverlay({ text }: { text: string }) {
  if (!text) return null;
  const seconds = Math.max(14, Math.round(text.length * 0.42));
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 overflow-hidden border-t border-[#F0A71F]/40 bg-[#000741]/92 py-[0.9%] backdrop-blur-sm"
      data-testid="stage-ticker"
    >
      {/* w-max, not a block: the element has to be as wide as its own text
          for translateX(-100%) to carry the whole line off the left edge.
          A block element is as wide as the frame, and the tail never leaves. */}
      <div
        className="w-max whitespace-nowrap text-[clamp(0.72rem,1.4cqw,1.25rem)] font-semibold tracking-wide text-white motion-reduce:!animate-none"
        style={{ animation: `stage-crawl ${seconds}s linear infinite`, willChange: "transform" }}
      >
        {/* The gap between passes, measured against the frame rather than the
            viewport — this is composited at 1080p and drawn again in a console
            panel a third that wide. */}
        <span className="px-[55cqw]">{text}</span>
      </div>
      <style>{`@keyframes stage-crawl{from{transform:translateX(0)}to{transform:translateX(-100%)}}`}</style>
    </div>
  );
}

/** The room the show appears to be in. Only ever visible where cameras aren't. */
function BackgroundLayer({ url }: { url: string }) {
  if (!url) return null;
  // A plain colour travels in the same field as #RRGGBB.
  if (/^#[0-9a-f]{6}$/i.test(url)) {
    return <div className="absolute inset-0" style={{ backgroundColor: url }} data-testid="stage-background" aria-hidden="true" />;
  }
  return (
    <div
      className="absolute inset-0 bg-cover bg-center"
      style={{ backgroundImage: `url(${JSON.stringify(url).slice(1, -1)})` }}
      data-testid="stage-background"
      aria-hidden="true"
    />
  );
}

/** The frame itself: standby clip, break clock, played media, the stage, or a holding card. */
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
  const countdownEnds = meta.countdownEndsAtUtc ? Date.parse(meta.countdownEndsAtUtc) : NaN;
  const banner = (meta.bannerTitle ?? "").trim();
  const ticker = (meta.tickerText ?? "").trim();

  const body =
    meta.fallbackPlaying && standby.url ? (
      <FullFrameMedia url={standby.url} kind="video" label={standby.label} muted={muted} loop />
    ) : Number.isFinite(countdownEnds) ? (
      <CountdownFrame endsAt={countdownEnds} label={meta.countdownLabel} />
    ) : meta.stageMediaPlaying && meta.stageMediaUrl ? (
      <FullFrameMedia
        url={meta.stageMediaUrl}
        kind={meta.stageMediaKind ?? "video"}
        label={meta.stageMediaLabel}
        muted={muted}
      />
    ) : tiles.length === 0 ? (
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
        {/* The holding card gets the background too. Without it, a producer
            setting one up in an empty studio — which is exactly when you set
            one up — sees no change at all. */}
        <BackgroundLayer url={meta.backgroundUrl ?? ""} />
        <div className={`absolute inset-0 ${/^#[0-9a-f]{6}$/i.test(meta.backgroundUrl ?? "") ? "bg-[#04102b]/25" : "bg-[#04102b]/70"}`} aria-hidden="true" />
        {meta.stageCardName ? (
          /* A scene for a show, with nobody on stage yet: the producer has
             cut to them and they are on their way. Their face and the show,
             so the room and the audience know who is next. */
          <>
            <p className="relative text-xs font-bold uppercase tracking-[0.3em] text-[#F0A71F]" data-testid="stage-coming-up">{meta.stageCardShow?.startsWith("Co-host") ? "At the desk" : "Coming up next"}</p>
            {meta.stageCardPhoto ? (
              <img src={meta.stageCardPhoto} alt="" className="relative h-36 w-36 rounded-full object-cover object-[50%_28%] ring-4 ring-[#F0A71F]/60 sm:h-44 sm:w-44" />
            ) : (
              <img src="/logo-wave.png?v=2" alt="" className="relative h-20 w-auto opacity-90" />
            )}
            <div className="relative">
              <p className="text-2xl font-semibold text-white sm:text-4xl" style={HEADLINE_FONT}>{meta.stageCardName}</p>
              {meta.stageCardShow && <p className="mt-1 text-base text-white/70 sm:text-lg">{meta.stageCardShow}</p>}
              {meta.stageCardSponsor && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/85" data-testid="stage-presented-by">
                  <span className="text-xs uppercase tracking-[0.2em] text-[#F0A71F]">Presented by</span>
                  {meta.stageCardSponsorLogo ? <img src={meta.stageCardSponsorLogo} alt={meta.stageCardSponsor} className="h-6 max-w-[8rem] object-contain" /> : <span className="font-semibold">{meta.stageCardSponsor}</span>}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <img src="/logo-wave.png?v=2" alt="" className="relative h-20 w-auto opacity-90" />
            <p className="relative text-2xl font-semibold text-white/85 sm:text-3xl" style={HEADLINE_FONT}>
              {idleTitle ?? meta.eventName ?? "Back shortly"}
            </p>
            <p className="relative text-base text-white/50">We'll be right back.</p>
          </>
        )}
      </div>
    ) : (
      <>
        {/* The background shows only between and behind the tiles, which is
            exactly where a set would be. Media and the break clock cover the
            frame, so they hide it without needing to be told to. */}
        <BackgroundLayer url={meta.backgroundUrl ?? ""} />
        <div className={`relative grid h-full w-full gap-3 p-3 ${gridFor(tiles.length)}`}>
          {tiles.map((t) => (
            <Tile key={t.identity} tile={t} muted={muted} namePos={!banner ? "bottom" : tiles.length > 1 ? "top" : "none"} fit={meta.tileFit} />
          ))}
        </div>
        <Captions caption={caption} lifted={Boolean(ticker)} />
      </>
    );

  // Graphics sit above whatever the stage is doing — that is the point of
  // them. The server only sends a value when the graphic is switched on, so
  // nothing here has to decide whether it should be drawn.
  //
  // The wrapper does two jobs: it is the positioning context for every overlay
  // below, and it is the container the overlays size their type against, so a
  // banner reads the same on a 1080p broadcast as in a 400px console panel.
  return (
    <div className="relative h-full w-full" style={{ containerType: "inline-size" }}>
      {body}
      <BannerOverlay
        title={banner}
        subtitle={meta.bannerSubtitle ?? ""}
        lifted={Boolean(ticker)}
      />
      <TickerOverlay text={ticker} />
      <LogoOverlay url={meta.logoUrl ?? ""} corner={meta.logoCorner} size={meta.logoSize} />
    </div>
  );
}

/** Burned into the frame, so they reach the recording and every destination. */
function Captions({ caption, lifted }: { caption?: { speaker: string; text: string } | null; lifted?: boolean }) {
  if (!caption?.text) return null;
  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 ${lifted ? "pb-[7%]" : "pb-6"}`}>
      <p className="max-w-4xl rounded-xl bg-black/75 px-5 py-2.5 text-center text-lg leading-snug text-white backdrop-blur-sm sm:text-xl">
        {caption.speaker && <span className="mr-2 font-semibold text-[#F0A71F]">{caption.speaker}:</span>}
        {caption.text}
      </p>
    </div>
  );
}
