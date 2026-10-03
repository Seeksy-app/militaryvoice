import { useEffect, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import type { StageThanks } from "@shared/stageMeta";
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
  /** One of Restream's six — how the people on stage share the frame. */
  stageLayout?: string;
  /** The producer's arrangement, identities comma-separated; first is the big picture. */
  stageOrder?: string;
  /** The clip shares the frame with the people, who sit in a column beside it. */
  stageMediaPeople?: boolean;
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
  stageCardPhoto2?: string;
  stageCardSponsor?: string;
  stageCardSponsorLogo?: string;
  /** The desk hand-off slide: thanks to who just finished, with a QR code to their page. */
  stageThanks?: StageThanks | null;
  /** "We'll be right back": the studio host's emergency card. */
  brbOn?: boolean;
  /** The brand spot's clock: when the presenter starts speaking (epoch ms), and each scene's start in seconds after it. */
  spotT0?: number;
  spotBeats?: Record<string, number>;
  /** Film the spot's background alone: the presenter is recorded separately and laid over it in the edit. */
  spotHidePresenter?: boolean;
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
  /** Shown in their place while their camera is off. */
  photoUrl?: string;
  /** A host or co-host: placed after the guests. */
  host?: boolean;
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
          // A camera switched off still has a track; it just sends black.
          if (pub.kind === Track.Kind.Video && !pub.isMuted) video = pub.track;
          if (pub.kind === Track.Kind.Audio) audio = pub.track;
        });
        next.push({
          identity: p.identity,
          name: p.name || p.identity,
          displayTitle: p.attributes?.displayTitle || "",
          photoUrl: p.attributes?.photoUrl || "",
          host: p.attributes?.role === "studio-host",
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
      .on(RoomEvent.TrackMuted, snapshot)
      .on(RoomEvent.TrackUnmuted, snapshot)
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

function Tile({ tile, muted, namePos = "bottom", fit, contain = false, flat = false, cover = false, bare = false }: { tile: StageTile; muted: boolean; namePos?: "bottom" | "top" | "none"; fit?: string; contain?: boolean; flat?: boolean; cover?: boolean; bare?: boolean }) {
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
      // 640 wide always: the recorder's browser has no graphics card, and a
      // full-size key every frame made her picture trail her voice.
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
      className={bare ? "relative overflow-hidden" : `relative overflow-hidden bg-[#04102b] ${flat ? "" : "rounded-xl"} ${
        tile.speaking ? "ring-4 ring-inset ring-[#F0A71F]" : flat ? "" : "ring-1 ring-white/10"
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
        className={`h-full w-full ${cover ? "object-cover object-[50%_22%]" : portrait || contain ? "object-contain" : "object-cover object-[50%_30%]"} ${tile.keyed ? "invisible absolute" : ""}`}

      />
      {tile.keyed && <canvas ref={canvasRef} className={`h-full w-full ${bare ? "object-contain object-bottom" : cover ? "object-cover object-[50%_18%]" : "object-contain"}`} />}
      <audio ref={audioRef} autoPlay muted={muted} />

      {/* Camera off: their picture, large and centred, over a soft wash of
          itself — never a black box. Initials when there is no picture. */}
      {!tile.video && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#053877]" data-testid="stage-tile-placeholder">
          {tile.photoUrl ? (
            <>
              <img src={tile.photoUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
              <img src={tile.photoUrl} alt="" className="relative h-[46%] w-auto max-w-[70%] rounded-full object-cover shadow-2xl ring-4 ring-white/20" style={{ aspectRatio: "1 / 1" }} />
            </>
          ) : (
            <span className="text-5xl font-bold text-white/80" style={HEADLINE_FONT}>
              {tile.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
      )}

      {/* The one name on screen: each person's own, bottom left of their
          frame, as they typed it in the green room, with their title under
          it. Sized to the frame, so it reads the same big or small. */}
      <div
        className={`absolute bottom-0 left-0 max-w-[85%] ${namePos === "none" ? "hidden" : ""}`}
        style={{ padding: "0 0 clamp(5px, 3.5cqh, 22px) clamp(5px, 2.2cqw, 22px)", fontSize: "clamp(11px, 5cqh, 26px)" }}
      >
        <div className="flex items-stretch overflow-hidden rounded-md shadow-lg">
          <div className="w-[0.22em] shrink-0 bg-[#F0A71F]" />
          <div className="min-w-0 bg-[#000741]/90 px-[0.6em] py-[0.3em] backdrop-blur-sm">
            <p className="truncate whitespace-nowrap font-bold leading-tight text-white" style={HEADLINE_FONT}>
              {tile.name}
            </p>
            {tile.displayTitle && (
              <p className="truncate whitespace-nowrap text-[0.72em] leading-tight text-[#F0A71F]" style={HEADLINE_FONT}>
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

/**
 * How the people on stage share the frame — Restream's six. Guests first and
 * hosts last, so the guest is the main picture and the host sits on the
 * right or in the inset. Anyone a layout has no room for is still heard:
 * their tile renders out of sight for the sound.
 */
function StageLayout({
  tiles: raw,
  layout,
  muted,
  order,
  onReorder,
}: {
  tiles: StageTile[];
  layout?: string;
  fit?: string;
  muted: boolean;
  order?: string;
  onReorder?: (identities: string[]) => void;
}) {
  // The producer's arrangement first; anyone it doesn't mention falls in
  // after, guests before hosts.
  const pref = (order ?? "").split(",").filter(Boolean);
  const rank = (t: StageTile) => { const i = pref.indexOf(t.identity); return i < 0 ? 1e6 : i; };
  const tiles = [...raw].sort((a, b) => rank(a) - rank(b) || Number(!!a.host) - Number(!!b.host) || a.identity.localeCompare(b.identity));
  const n = tiles.length;
  const tag = "bottom" as const;
  const [main, ...rest] = tiles;
  // Drag one person onto another to swap them — the guest into the small
  // frame and the host into the big one, say. Console only.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dnd = (t: StageTile) =>
    onReorder
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/plain", t.identity); e.dataTransfer.effectAllowed = "move"; setDragging(t.identity); },
          onDragEnd: () => { setDragging(null); setOver(null); },
          onDragOver: (e: React.DragEvent) => { if (dragging && dragging !== t.identity) { e.preventDefault(); setOver(t.identity); } },
          onDragLeave: () => setOver((v) => (v === t.identity ? null : v)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const from = e.dataTransfer.getData("text/plain") || dragging;
            setDragging(null); setOver(null);
            if (!from || from === t.identity) return;
            const ids = tiles.map((x) => x.identity);
            const a = ids.indexOf(from), b = ids.indexOf(t.identity);
            if (a < 0 || b < 0) return;
            [ids[a], ids[b]] = [ids[b], ids[a]];
            onReorder(ids);
          },
          title: "Drag onto someone to swap places",
        }
      : {};
  const dragCls = (t: StageTile) =>
    onReorder ? `cursor-grab active:cursor-grabbing ${over === t.identity ? "outline outline-4 outline-offset-[-4px] outline-[#3B82F6] rounded-xl" : ""} ${dragging === t.identity ? "opacity-60" : ""}` : "";
  const box = (style: CSSProperties, t: StageTile, opts: { contain?: boolean; flat?: boolean; small?: boolean } = {}) => (
    <div key={t.identity} className={`absolute grid ${dragCls(t)}`} style={style} {...dnd(t)}>
      <Tile tile={t} muted={muted} namePos={tag} fit="full" contain={opts.contain} flat={opts.flat} />
    </div>
  );
  const column = (list: StageTile[], left: number, width: number, top: number, bottom: number, gap: number) => {
    const h = (100 - top - bottom - gap * (list.length - 1)) / Math.max(1, list.length);
    return list.map((t, i) => box({ left: `${left}%`, width: `${width}%`, top: `${top + i * (h + gap)}%`, height: `${h}%` }, t, { small: true }));
  };
  const L = layout || "contain";

  // One person: they fill the frame whatever the layout, as Restream does.
  if (n === 1) {
    const flat = L === "cover" || L === "pip";
    return <div className="relative h-full w-full">{box(flat ? { inset: 0 } : { left: "1.5%", right: "1.5%", top: "2.5%", bottom: "2.5%" }, main, { flat, contain: L === "contain" })}</div>;
  }

  if (L === "showtime") {
    // The guest large on the left; the next person overlapping from the right.
    const [second, ...others] = rest;
    return (
      <div className="relative h-full w-full">
        {box({ left: "1.2%", top: "2.2%", width: "62%", height: "95.6%" }, main)}
        {box({ left: "58%", top: "27%", width: "30%", height: "43%", zIndex: 1 }, second, { small: true })}
        {others.length > 0 && column(others, 90, 8.8, 20, 20, 2)}
      </div>
    );
  }
  if (L === "cover") {
    // Edge to edge: every camera fills its share of the frame, no gaps.
    return (
      <div className={`relative grid h-full w-full ${n <= 2 ? "grid-cols-2" : n <= 4 ? "grid-cols-2 grid-rows-2" : "grid-cols-3 grid-rows-2"}`}>
        {tiles.map((t) => <div key={t.identity} className={`relative grid min-h-0 ${dragCls(t)}`} {...dnd(t)}><Tile tile={t} muted={muted} namePos={tag} fit="full" flat /></div>)}
      </div>
    );
  }
  if (L === "sidebar") {
    // The guest across three quarters; everyone else stacked in a tall column.
    return (
      <div className="relative h-full w-full">
        {box({ left: "1.2%", top: "2.2%", width: "72%", height: "95.6%" }, main)}
        {column(rest, 74.5, 24.3, 2.2, 2.2, 1.5)}
      </div>
    );
  }
  if (L === "pip") {
    // The guest full frame; the others small in the bottom-right corner.
    const inset = rest.slice(0, 3);
    return (
      <div className="relative h-full w-full">
        {box({ inset: 0 }, main, { flat: true })}
        {inset.map((t, i) => box({ right: `${1.5 + i * 16}%`, bottom: "2.5%", width: "14.5%", aspectRatio: "4 / 3", zIndex: 1 }, t, { small: true }))}
        {rest.length > 3 && <div className="hidden">{rest.slice(3).map((t) => <Tile key={t.identity} tile={t} muted={muted} namePos="none" />)}</div>}
      </div>
    );
  }
  if (L === "thumbnails") {
    // The guest in a big 16:9 box; the others as thumbnails down the right.
    return (
      <div className="relative h-full w-full">
        {box({ left: "1.2%", top: "10.5%", width: "76%", height: "79%" }, main)}
        {column(rest, 79.5, 16, rest.length === 1 ? 41 : 25, rest.length === 1 ? 41 : 25, 2)}
      </div>
    );
  }
  // Contain: side by side, each camera whole inside a 16:9 box, the background around them.
  return (
    <div className={`relative grid h-full w-full gap-3 p-4 ${gridFor(n)}`}>
      {tiles.map((t) => <div key={t.identity} className={`relative grid min-h-0 min-w-0 ${dragCls(t)}`} {...dnd(t)}><Tile tile={t} muted={muted} namePos={tag} fit="wide" contain /></div>)}
    </div>
  );
}

/** Everyone on stage in a column down the right, beside a clip. */
function PeopleColumn({ tiles: raw, muted, order }: { tiles: StageTile[]; muted: boolean; order?: string }) {
  const pref = (order ?? "").split(",").filter(Boolean);
  const rank = (t: StageTile) => { const i = pref.indexOf(t.identity); return i < 0 ? 1e6 : i; };
  const tiles = [...raw].sort((a, b) => rank(a) - rank(b) || Number(!!a.host) - Number(!!b.host) || a.identity.localeCompare(b.identity));
  const shown = tiles.slice(0, 4);
  const gap = 1.8;
  const h = Math.min(26, (79 - gap * (shown.length - 1)) / shown.length);
  const top = 50 - (h * shown.length + gap * (shown.length - 1)) / 2;
  return (
    <>
      {shown.map((t, i) => (
        <div key={t.identity} className="absolute grid" style={{ left: "79%", width: "19.8%", top: `${top + i * (h + gap)}%`, height: `${h}%` }}>
          <Tile tile={t} muted={muted} namePos="bottom" fit="full" />
        </div>
      ))}
      {tiles.length > 4 && <div className="hidden">{tiles.slice(4).map((t) => <Tile key={t.identity} tile={t} muted={muted} namePos="none" />)}</div>}
    </>
  );
}

/**
 * YouTube's player, told to talk back. With enablejsapi=1 the embed posts its
 * state to the page once we say we're listening, so a YouTube clip can end a
 * scene the way a file's own "ended" does — before, the page never heard, and
 * the stage sat on YouTube's end screen until someone pressed the next scene.
 * (No script tag needed: this is the same message channel the IFrame API uses.)
 */
function YouTubeFrame({ id, title, muted, loop, onEnded }: { id: string; title: string; muted: boolean; loop: boolean; onEnded?: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  useEffect(() => {
    if (loop) return;
    let fired = false;
    const hello = () => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "https://www.youtube.com");
    // The player may not be ready on the first hello; say it a few times.
    const t = window.setInterval(hello, 1000);
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || !/(^|\.)youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      let d: { event?: string; info?: unknown } | null = null;
      try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      if (!d) return;
      window.clearInterval(t); // it heard us
      const state = d.event === "onStateChange" ? d.info : d.event === "infoDelivery" ? (d.info as { playerState?: number } | null)?.playerState : undefined;
      if (state === 0 && !fired) { fired = true; ended.current?.(); }
    };
    window.addEventListener("message", on);
    return () => { window.clearInterval(t); window.removeEventListener("message", on); };
  }, [id, loop]);
  const origin = typeof window !== "undefined" ? `&origin=${encodeURIComponent(window.location.origin)}` : "";
  return (
    <iframe
      ref={ref}
      title={title}
      src={`https://www.youtube.com/embed/${id}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&modestbranding=1&rel=0&playsinline=1&enablejsapi=1${origin}${loop ? `&loop=1&playlist=${id}` : ""}`}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className="h-full w-full border-0"
    />
  );
}

/** A clip, a slide or a sponsor card, filling the frame. */
/** A clip named as a loop ("We'll be right back (10s loop)") repeats on stage; everything else plays once. */
function stageLoops(label?: string): boolean {
  return /\([^()]*\bloop\)\s*$/i.test(label ?? "");
}

/** An audio-only episode (an MP3 a podcaster sent): played over their card, not a black frame. */
export function isAudioUrl(url: string): boolean {
  try {
    return /\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(new URL(url, "https://x").pathname);
  } catch {
    return false;
  }
}

function AudioFrame({ url, name, show, photo, muted, onEnded }: { url: string; name?: string; show?: string; photo?: string; muted?: boolean; onEnded?: () => void }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#000741] via-[#053877] to-[#06498f] text-white" style={{ containerType: "inline-size" }} data-testid="stage-audio">
      <audio src={url} autoPlay muted={muted} onEnded={onEnded} />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ gap: "2.2cqw", padding: "0 8cqw" }}>
        {photo ? (
          <img src={photo} alt="" className="rounded-full object-cover object-[50%_28%] ring-[0.45cqw] ring-[#F0A71F]/70" style={{ width: "20cqw", height: "20cqw" }} />
        ) : (
          <img src="/logo-wave.png?v=2" alt="" style={{ height: "8cqw" }} />
        )}
        {name && <p className="font-semibold leading-tight [text-wrap:balance]" style={{ ...HEADLINE_FONT, fontSize: "4.4cqw" }}>{name}</p>}
        {show && <p className="leading-snug text-white/75 [text-wrap:balance]" style={{ fontSize: "2.2cqw" }}>{show}</p>}
        <div className="flex items-end" style={{ gap: "0.5cqw", height: "4cqw" }} aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="block rounded-full bg-[#F0A71F] motion-safe:animate-pulse" style={{ width: "0.6cqw", height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FullFrameMedia({
  url,
  kind,
  label,
  muted,
  loop = false,
  onEnded,
}: {
  url: string;
  kind: string;
  label?: string;
  muted: boolean;
  /** Standby holds the frame for hours, so its clip runs on repeat. A show's
      own episode does not — it ends when it ends. */
  loop?: boolean;
  /** The clip reached its end — a file's own event, or YouTube's player saying so. */
  onEnded?: () => void;
}) {
  const yt = youtubeId(url);
  return (
    <div className="absolute inset-0 bg-black">
      {kind === "image" ? (
        <img src={url} alt={label ?? ""} className="h-full w-full object-contain" />
      ) : yt ? (
        <YouTubeFrame id={yt} title={label || "On stage"} muted={muted} loop={loop} onEnded={onEnded} />
      ) : (
        <video src={url} autoPlay playsInline loop={loop} muted={muted} onEnded={onEnded} className="h-full w-full object-contain" />
      )}
      {/* No caption over a clip or picture on air: viewers see the content, not our name for the file. */}
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

/** The 30-second MilitaryVoices brand spot plays when the stage media is this address. */
export function isSpotUrl(url?: string): boolean {
  return /\/promo\/spot\b/.test(url ?? "");
}

type SpotPerson = { name: string; photo: string };

/**
 * MilitaryVoices in 30 seconds, cinematic rather than a deck: full-bleed navy
 * with a gold glow and drifting light, one idea at a time in big sentence-case
 * type, nothing in a box. Scenes change on the beats of the read, measured
 * from the voice itself and sent in the room's metadata.
 */
function SpotFrame({ t0, beats }: { t0?: number; beats?: Record<string, number> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(id);
  }, []);
  const [people, setPeople] = useState<{ hosts: SpotPerson[]; faces: string[] }>({ hosts: [], faces: [] });
  useEffect(() => {
    void fetch("/api/signups").then((r) => r.json()).then((j) => {
      const rows = (Array.isArray(j) ? j : j.signups ?? []) as { hostName: string; photoUrl: string; slotIndex: number }[];
      const by = (re: RegExp) => rows.find((r) => re.test(r.hostName));
      setPeople({
        hosts: [
          { name: "Amy Forsythe", photo: by(/amy forsythe/i)?.photoUrl ?? "" },
          { name: "Enrique Acosta Gonzalez", photo: by(/enrique/i)?.photoUrl ?? "" },
        ],
        faces: rows.filter((r) => r.photoUrl && !/riccoh/i.test(r.hostName)).sort((x, y) => x.slotIndex - y.slotIndex).map((r) => r.photoUrl),
      });
    }).catch(() => {});
  }, []);
  const t = t0 ? (now - t0) / 1000 : -1;
  const b = { welcome: 0, day: 4, hosts: 11, shows: 17, miles: 21, grow: 24, watch: 28, end: 34, ...(beats ?? {}) };
  const order = ["welcome", "day", "hosts", "shows", "miles", "grow", "watch", "end"] as const;
  type Beat = (typeof order)[number];
  const scene: Beat = t < 0 ? "welcome" : [...order].reverse().find((k) => t >= b[k]) ?? "welcome";
  const on = (k: Beat) => scene === k;
  const since = (k: Beat) => Math.max(0, t - b[k]);
  // Text sits in the left 60%; the presenter is laid over the right in the edit.
  const shot = (k: Beat, wide = false) =>
    `absolute inset-y-0 left-0 flex flex-col justify-center pl-[6%] ${wide ? "pr-[6%] w-full" : "w-[62%] pr-[2%]"} transition-all duration-[900ms] ease-out ${on(k) ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-[1.5cqw]"}`;
  // Each scene has its own full-bleed photo, slowly pushing in, under a navy wash from the left.
  const bg = (k: Beat, src: string, pos = "center") => (
    <div key={k} className={`absolute inset-0 transition-opacity duration-[1100ms] ${on(k) ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
      <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: pos, transform: `scale(${1.04 + Math.min(0.08, since(k) * 0.012)})`, transition: "transform 120ms linear" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #04102b 0%, rgba(4,16,43,.94) 42%, rgba(4,16,43,.62) 68%, rgba(4,16,43,.45) 100%)" }} />
    </div>
  );
  const gold = "#F0A71F";
  const eyebrow = (text: string) => (
    <p className="font-bold uppercase" style={{ color: gold, fontSize: "1.5cqw", letterSpacing: "0.22em" }}>{text}</p>
  );
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#04102b] text-white" style={{ containerType: "inline-size", fontFamily: "'Inter', sans-serif" }} data-testid="stage-spot">
      <style>{`@keyframes spot-drift{from{transform:translateY(0)}to{transform:translateY(-120cqw)}}`}</style>
      {bg("welcome", "/hero-6.jpg", "60% 50%")}
      {bg("day", "/platform-hero.jpg", "50% 35%")}
      {bg("miles", "/platform-hero.jpg", "50% 60%")}
      {bg("grow", "/hero-6.jpg", "40% 50%")}
      {/* Gold dust, always drifting up over everything. */}
      <div className="absolute inset-0" aria-hidden="true">
        {Array.from({ length: 30 }, (_, i) => (
          <span key={i} className="absolute rounded-full" style={{ background: gold, left: `${(i * 37) % 100}%`, top: `${100 + ((i * 53) % 60)}%`, width: `${0.14 + (i % 4) * 0.07}cqw`, height: `${0.14 + (i % 4) * 0.07}cqw`, opacity: 0.2 + (i % 5) * 0.08, animation: `spot-drift ${22 + (i % 7) * 4}s linear ${-(i * 1.7)}s infinite` }} />
        ))}
      </div>

      <div className={shot("welcome")}>
        <img src="/logo-lockup-dark.png" alt="MilitaryVoices.AI" style={{ width: "22cqw" }} />
        <p className="mt-[3cqw] font-bold leading-[1.02] tracking-tight" style={{ ...HEADLINE_FONT, fontSize: "6.2cqw" }}>
          Welcome to<br />MilitaryVoices
        </p>
        <p className="mt-[1.4cqw] font-semibold leading-snug" style={{ ...HEADLINE_FONT, fontSize: "3cqw", color: gold }}>Home of military and veteran stories</p>
      </div>

      <div className={shot("day")}>
        <div className="flex items-center" style={{ gap: "3cqw" }}>
          <img src="/nmpd-logo.png" alt="" className="shrink-0 drop-shadow-[0_0_3cqw_rgba(240,167,31,0.5)]" style={{ width: "17cqw", height: "17cqw" }} />
          <div className="min-w-0">
            {eyebrow("Monday · October 5")}
            <p className="mt-[0.8cqw] font-bold leading-[1.0] tracking-tight [text-wrap:balance]" style={{ ...HEADLINE_FONT, fontSize: "5.4cqw" }}>National Military Podcast Day</p>
          </div>
        </div>
        <p className="mt-[2.4cqw] max-w-[90%] leading-snug text-white/85 [text-wrap:balance]" style={{ fontSize: "2.3cqw" }}>
          Honoring veterans and service members who share their stories, <span style={{ color: gold }}>in their own words.</span>
        </p>
      </div>

      <div className={shot("hosts")}>
        <div className="flex items-center" style={{ gap: "3cqw" }}>
          {/* Riccoh as he is on the site: the Emmy portrait, tilted on a gold plate. */}
          <div className="relative shrink-0" style={{ width: "19cqw", height: "24cqw" }}>
            <div className="absolute inset-0 rounded-[1.6cqw]" style={{ background: gold, transform: "rotate(-3deg) translate(-0.6cqw, 0.4cqw)" }} />
            <img src="/riccoh-player.jpg" alt="" className="absolute inset-0 h-full w-full rounded-[1.4cqw] object-cover object-[50%_20%] shadow-2xl" />
          </div>
          <div className="min-w-0">
            {eyebrow("Hosted by Emmy winner")}
            <p className="mt-[0.6cqw] font-bold leading-none tracking-tight" style={{ ...HEADLINE_FONT, fontSize: "5cqw" }}>Riccoh Player</p>
            <p className="mt-[0.4cqw] text-white/70" style={{ fontSize: "1.7cqw" }}>USMC, Retired</p>
            <div className="mt-[1.6cqw] flex" style={{ columnGap: "1.8cqw" }}>
              {[["33", "years in the Corps"], ["5", "combat tours"], ["1", "Emmy"]].map(([n, l], i) => (
                <p key={l} className="whitespace-nowrap transition-all duration-500" style={{ opacity: since("hosts") > 0.6 + i * 0.5 ? 1 : 0 }}>
                  <span className="font-bold" style={{ ...HEADLINE_FONT, fontSize: "2.6cqw", color: gold }}>{n}</span>{" "}
                  <span className="text-white/80" style={{ fontSize: "1.3cqw" }}>{l}</span>
                </p>
              ))}
            </div>
            <div className="mt-[2cqw] transition-opacity duration-700" style={{ opacity: since("hosts") > 2.6 ? 1 : 0 }}>
              <p className="font-bold uppercase" style={{ color: gold, fontSize: "1.2cqw", letterSpacing: "0.2em" }}>With co-hosts</p>
              <div className="mt-[0.8cqw] flex items-center" style={{ gap: "2.4cqw" }}>
                {people.hosts.map((h) => (
                  <div key={h.name} className="flex items-center" style={{ gap: "0.9cqw" }}>
                    {h.photo && <img src={h.photo} alt="" className="shrink-0 rounded-full object-cover object-[50%_28%]" style={{ width: "4.4cqw", height: "4.4cqw", boxShadow: `0 0 0 0.25cqw ${gold}` }} />}
                    <span className="whitespace-nowrap font-bold" style={{ ...HEADLINE_FONT, fontSize: "1.9cqw" }}>{h.name.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The lineup fills the left of the frame, every face, while the shows are named. */}
      <div className={`absolute inset-y-0 left-0 w-[62%] transition-opacity duration-[900ms] ${on("shows") ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
        <div className="absolute inset-0 grid grid-cols-6 content-center" style={{ gap: "0.9cqw", padding: "3cqw 2cqw 3cqw 4cqw" }}>
          {people.faces.slice(0, 30).map((src, i) => (
            <img key={i} src={src} alt="" className="aspect-square w-full rounded-full object-cover object-[50%_28%] transition-all duration-500" style={{ opacity: since("shows") > i * 0.05 ? 0.55 : 0, transform: `scale(${since("shows") > i * 0.05 ? 1 : 0.8})` }} />
          ))}
        </div>
        <div className="absolute inset-0" style={{ background: "radial-gradient(60% 55% at 45% 50%, rgba(4,16,43,.92) 0%, rgba(4,16,43,.55) 60%, rgba(4,16,43,.2) 100%)" }} />
      </div>
      <div className={shot("shows")}>
        <p className="font-bold leading-none tracking-tight" style={{ ...HEADLINE_FONT, fontSize: "10cqw" }}>30 shows</p>
        <p className="mt-[1.4cqw] font-semibold" style={{ ...HEADLINE_FONT, fontSize: "3cqw", color: gold }}>Live, 7 AM to 11 PM Eastern</p>
      </div>

      <div className={shot("miles")}>
        {/* Always 26.2, never a count that could be caught at 20.3. It lands with a small push instead. */}
        <p className="font-bold leading-none tabular-nums tracking-tight" style={{ ...HEADLINE_FONT, fontSize: "15cqw", color: gold, transform: `scale(${on("miles") ? 1 : 0.88})`, transformOrigin: "0% 50%", transition: "transform 900ms cubic-bezier(.2,.8,.2,1)" }}>26.2</p>
        <p className="mt-[1cqw] font-bold leading-tight" style={{ ...HEADLINE_FONT, fontSize: "4cqw" }}>miles of stories,<br />back to back</p>
      </div>

      <div className={shot("grow")}>
        <p className="font-semibold text-white/80" style={{ ...HEADLINE_FONT, fontSize: "2.6cqw" }}>MilitaryVoices is where military creators</p>
        {["Record.", "Share.", "Grow."].map((w, i) => (
          <p key={w} className="font-bold leading-[1.02] tracking-tight transition-all duration-500" style={{ ...HEADLINE_FONT, fontSize: "8cqw", opacity: since("grow") > 0.8 + i * 0.7 ? 1 : 0, transform: `translateX(${since("grow") > 0.8 + i * 0.7 ? 0 : -1.5}cqw)`, color: i === 2 ? gold : "white" }}>{w}</p>
        ))}
      </div>

      <div className={shot("watch")}>
        <img src="/nmpd-logo.png" alt="" className="drop-shadow-[0_0_3cqw_rgba(240,167,31,0.5)]" style={{ width: "15cqw", height: "15cqw" }} />
        <p className="mt-[2cqw] font-semibold text-white/80" style={{ ...HEADLINE_FONT, fontSize: "2.6cqw" }}>Watch free, all day Monday</p>
        <p className="whitespace-nowrap font-bold tracking-tight" style={{ ...HEADLINE_FONT, fontSize: "4.2cqw", color: gold }}>militaryvoices.ai/watch</p>
      </div>

      {/* The last word: who MilitaryVoices is. Full width; nobody is laid over it. */}
      <div className={`absolute inset-0 transition-opacity duration-[1100ms] ${on("end") ? "opacity-100" : "opacity-0"}`} aria-hidden={!on("end")}>
        <img src="/platform-hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_40%]" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #04102b 0%, rgba(4,16,43,.93) 48%, rgba(4,16,43,.55) 100%)" }} />
      </div>
      <div className={shot("end", true)}>
        <img src="/logo-lockup-dark.png" alt="MilitaryVoices.AI" style={{ width: "20cqw" }} />
        <p className="mt-[2.4cqw] font-bold uppercase" style={{ color: gold, fontSize: "1.5cqw", letterSpacing: "0.22em" }}>About MilitaryVoices</p>
        <p className="mt-[1cqw] max-w-[62%] font-bold leading-[1.05] tracking-tight [text-wrap:balance]" style={{ ...HEADLINE_FONT, fontSize: "4.6cqw" }}>
          The platform for military and veteran <span style={{ color: gold }}>voices.</span>
        </p>
        <p className="mt-[1.6cqw] max-w-[58%] leading-snug text-white/80 [text-wrap:pretty]" style={{ fontSize: "1.9cqw" }}>
          Live events, podcasts and the creators worth putting on stage, all in one place.
        </p>
        <p className="mt-[2.4cqw] font-bold" style={{ ...HEADLINE_FONT, fontSize: "2.8cqw" }}>militaryvoices.ai</p>
      </div>
    </div>
  );
}

/** The stage plays our animated promo instead of a file when its media is this address. */
export function isPromoUrl(url?: string): boolean {
  return /\/promo\/nmpd\b/.test(url ?? "");
}

/**
 * National Military Podcast Day, in 30 seconds: the badge, then the day's
 * numbers landing one by one, timed to Alex's read. The clock starts when the
 * presenter steps on stage, so the beats meet her lines whenever she arrives.
 */
function PromoFrame({ started }: { started: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!started) { setT(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setT((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [started]);
  const at = (s: number) => (started ? t >= s : s === 0);
  const pct = Math.round(Math.min(58, Math.max(0, (t - 19.5) * 40)));
  const beat = (on: boolean) => `transition-all duration-700 ease-out ${on ? "translate-y-0 opacity-100" : "translate-y-[1.5cqw] opacity-0"}`;
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#000741] via-[#053877] to-[#06498f] text-white" style={{ containerType: "inline-size" }} data-testid="stage-promo">
      <div className="absolute -right-[12%] -top-[30%] h-[80%] w-[50%] animate-pulse rounded-full bg-[#F0A71F]/[0.07]" aria-hidden="true" />
      <div className="absolute -bottom-[35%] -left-[10%] h-[70%] w-[45%] rounded-full bg-white/[0.04]" aria-hidden="true" />
      <div className="absolute inset-0 flex flex-col justify-center px-[7%]">
        <div className={`flex items-center ${beat(at(0))}`} style={{ gap: "2.4cqw" }}>
          <img src="/nmpd-logo.png" alt="" className={`shrink-0 transition-transform duration-1000 ${at(0.4) ? "rotate-0 scale-100" : "-rotate-12 scale-75"}`} style={{ width: "17cqw", height: "17cqw" }} />
          <div className="min-w-0">
            <p className="font-bold uppercase text-[#F0A71F]" style={{ fontSize: "1.7cqw", letterSpacing: "0.3em" }}>Monday · October 5</p>
            <p className="mt-[0.6cqw] font-black uppercase leading-[0.95] tracking-tight [text-wrap:balance]" style={{ ...HEADLINE_FONT, fontSize: "5.6cqw" }}>National Military Podcast Day</p>
          </div>
        </div>
        <div className="mt-[4cqw] grid grid-cols-3" style={{ gap: "2cqw" }}>
          {[
            { on: at(8), big: "26.2", small: "miles of stories" },
            { on: at(12), big: "30", small: "military & veteran shows, back to back" },
            { on: at(19), big: `${started ? pct : 58}%`, small: "of Americans listen to podcasts monthly" },
          ].map((x) => (
            <div key={x.small} className={`rounded-[1.4cqw] border border-white/15 bg-white/[0.07] px-[1.8cqw] py-[1.6cqw] ${beat(x.on)}`}>
              <p className="font-black tabular-nums text-[#F0A71F]" style={{ ...HEADLINE_FONT, fontSize: "5cqw", lineHeight: 1 }}>{x.big}</p>
              <p className="mt-[0.6cqw] text-white/80 [text-wrap:balance]" style={{ fontSize: "1.55cqw", lineHeight: 1.25 }}>{x.small}</p>
            </div>
          ))}
        </div>
        <div className={`mt-[3.4cqw] flex items-center ${beat(at(26))}`} style={{ gap: "1.6cqw" }}>
          <span className="rounded-full bg-[#F0A71F] px-[2cqw] py-[0.9cqw] font-black uppercase text-[#000741]" style={{ fontSize: "1.9cqw", letterSpacing: "0.08em" }}>Free · Watch live</span>
          <span className="font-bold" style={{ fontSize: "2.6cqw" }}>militaryvoices.ai/watch</span>
        </div>
      </div>
      <p className="absolute bottom-[3%] right-[4%] text-white/45" style={{ fontSize: "1.1cqw" }}>Source: Edison Research, The Infinite Dial 2026</p>
    </div>
  );
}

/**
 * "We'll be right back": what the audience sees while a studio host sorts out
 * a problem (the OH SH#T! button). Today's badge and a line about the day, so
 * the pause still says what this is. Covers the stage, so no microphone on it
 * reaches the broadcast.
 */
function BrbFrame() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#000741] via-[#053877] to-[#06498f] px-[6%] text-center text-white" style={{ containerType: "inline-size" }} data-testid="stage-brb">
      <div className="absolute -right-[10%] -top-[25%] h-[70%] w-[45%] rounded-full bg-white/[0.04]" aria-hidden="true" />
      <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="relative" style={{ width: "18cqw", height: "18cqw" }} />
      <p className="relative mt-[2.5cqw] font-black uppercase tracking-tight" style={{ ...HEADLINE_FONT, fontSize: "6.4cqw", lineHeight: 1 }}>We'll be right back</p>
      <p className="relative mt-[1.6cqw] font-bold uppercase text-[#F0A71F]" style={{ fontSize: "1.9cqw", letterSpacing: "0.28em" }}>Today is National Military Podcast Day</p>
      <p className="relative mt-[1.2cqw] max-w-[70%] text-white/75 [text-wrap:balance]" style={{ fontSize: "1.8cqw" }}>26.2 miles of military and veteran stories, back to back. Free to watch at militaryvoices.ai/watch</p>
    </div>
  );
}

/** A QR code drawn in the browser, so it works in the broadcast's headless page too. */
function StageQr({ url, size }: { url: string; size: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 600, color: { dark: "#000741", light: "#ffffff" } }).then(setSrc).catch(() => setSrc(""));
  }, [url]);
  return src ? <img src={src} alt="" className="block" style={{ width: size, height: size }} /> : <span className="block bg-white" style={{ width: size, height: size }} />;
}

const firstName = (n: string) => n.replace(/^(dr|mr|mrs|ms|sgt|sergeant major)\.?\s+(\(ret\.\)\s+)?/i, "").trim().split(/\s+/)[0] ?? n;

/**
 * Between two shows: thank you to the speaker who just finished, their face,
 * and a QR code to their page, so the audience can follow them before the
 * next show starts. The co-host at the desk and what's next along the bottom.
 * Sized in container units, so it reads the same in the console and on air.
 */
function ThanksSlide({ t, compact = false }: { t: StageThanks; compact?: boolean }) {
  // Sized against its own box (cqw), so beside a co-host it scales down with
  // the frame it has rather than overflowing it.
  const z = compact
    ? { eyebrow: "2.3cqw", photo: "21cqw", name: "6.2cqw", show: "2.9cqw", qr: "27cqw", follow: "2.5cqw", scan: "1.9cqw", label: "1.9cqw", line: "2.7cqw", face: "9cqw" }
    : { eyebrow: "1.7cqw", photo: "17cqw", name: "5.2cqw", show: "2.3cqw", qr: "19cqw", follow: "1.7cqw", scan: "1.25cqw", label: "1.15cqw", line: "1.9cqw", face: "6cqw" };
  // With the co-host on camera beside the slide, their name on it is said twice.
  const host = compact ? "" : t.deskName;
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#000741] via-[#053877] to-[#06498f] text-white" style={{ containerType: "inline-size" }} data-testid="stage-thanks">
      <div className="absolute -right-[10%] -top-[25%] h-[70%] w-[45%] rounded-full bg-white/[0.04]" aria-hidden="true" />
      <div className="absolute inset-x-0 top-[8%] bottom-[22%] flex items-center px-[7%]" style={{ gap: "5cqw" }}>
        <div className={`flex min-w-0 flex-1 ${compact ? "flex-col items-start" : "flex-col items-start"}`}>
          <p className="font-bold uppercase text-[#F0A71F]" style={{ fontSize: z.eyebrow, letterSpacing: "0.3em" }}>{t.kind === "upnext" ? "Coming up next" : "Thank you"}</p>
          <div className={`mt-[3%] flex ${compact ? "flex-col items-start" : "items-center"}`} style={{ gap: compact ? "2.4cqw" : "2.6cqw" }}>
            {t.photoUrl && (
              <span className="flex shrink-0">
                <img src={t.photoUrl} alt="" className="rounded-full object-cover object-[50%_28%] ring-[0.45cqw] ring-[#F0A71F]/70" style={{ width: z.photo, height: z.photo }} />
                {t.photo2Url && <img src={t.photo2Url} alt="" className="rounded-full object-cover object-[50%_28%] ring-[0.45cqw] ring-[#F0A71F]/70" style={{ width: z.photo, height: z.photo, marginLeft: "-4cqw" }} />}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-semibold leading-[1.05] [text-wrap:balance]" style={{ ...HEADLINE_FONT, fontSize: z.name }}>{t.name}</p>
              {t.show && <p className="mt-[0.5em] leading-snug text-white/75 [text-wrap:balance]" style={{ fontSize: z.show }}>{t.show}</p>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center bg-white text-center shadow-2xl" style={{ borderRadius: "1.6cqw", padding: "1.4cqw" }}>
          <StageQr url={t.qrUrl} size={z.qr} />
          <p className="mt-[0.6em] font-bold text-[#000741]" style={{ fontSize: z.follow }}>Follow {firstName(t.name)}</p>
          <p className="text-[#053877]/70" style={{ fontSize: z.scan }}>Scan with your phone</p>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-[18%] items-center justify-between border-t border-white/10 bg-black/25 px-[7%]" style={{ gap: "3cqw" }}>
        {host ? (
          <div className="flex min-w-0 items-center" style={{ gap: "1.4cqw" }}>
            {t.deskPhoto && <img src={t.deskPhoto} alt="" className="shrink-0 rounded-full object-cover object-[50%_28%] ring-[0.3cqw] ring-[#F0A71F]/70" style={{ width: z.face, height: z.face }} />}
            <div className="min-w-0">
              <p className="font-bold uppercase text-[#F0A71F]" style={{ fontSize: z.label, letterSpacing: "0.22em" }}>At the desk</p>
              <p className="truncate font-semibold" style={{ fontSize: z.line }}>{host}</p>
            </div>
          </div>
        ) : null}
        {t.next && (
          <div className={`min-w-0 ${host ? "text-right" : "flex-1 text-left"}`}>
            <p className="font-bold uppercase text-[#F0A71F]" style={{ fontSize: z.label, letterSpacing: "0.22em" }}>{t.nextLabel || "Up next"}</p>
            <p className="truncate text-white/85" style={{ fontSize: compact ? "2.3cqw" : "1.6cqw" }}>{t.next}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Whoever is on with the hand-off slide, stacked down the right. One co-host gets a big frame. */
function HandoffPeople({ tiles: raw, muted, order, cover = false }: { tiles: StageTile[]; muted: boolean; order?: string; cover?: boolean }) {
  const pref = (order ?? "").split(",").filter(Boolean);
  const rank = (t: StageTile) => { const i = pref.indexOf(t.identity); return i < 0 ? 1e6 : i; };
  const shown = [...raw].sort((a, b) => rank(a) - rank(b) || a.identity.localeCompare(b.identity)).slice(0, 3);
  const gap = 2;
  const h = (88 - gap * (shown.length - 1)) / shown.length;
  return (
    <>
      {shown.map((t, i) => (
        <div key={t.identity} className="absolute grid" style={{ left: "64.8%", width: "33.7%", top: `${6 + i * (h + gap)}%`, height: `${h}%` }}>
          <Tile tile={t} muted={muted} namePos="bottom" fit="full" cover={cover} />
        </div>
      ))}
    </>
  );
}

/** The frame itself: standby clip, break clock, played media, the stage, or a holding card. */
export function StageGrid({
  tiles,
  meta,
  muted = false,
  idleTitle,
  caption,
  onReorder,
  onMediaEnded,
}: {
  tiles: StageTile[];
  meta: RoomMeta;
  muted?: boolean;
  idleTitle?: string;
  caption?: { speaker: string; text: string } | null;
  /** Console only: drag people to swap places on stage. */
  onReorder?: (identities: string[]) => void;
  /** Console only: the stage clip finished, for scenes that move on by themselves. */
  onMediaEnded?: () => void;
}) {
  // Standby is the emergency, so it outranks anything chosen deliberately.
  // Before the event opens it plays the pre-event card instead, decided here
  // against the viewer's own clock — a server-side switch would have to be
  // pushed, and room metadata only changes when someone touches the studio.
  const standby = pickStandby(meta);
  const countdownEnds = meta.countdownEndsAtUtc ? Date.parse(meta.countdownEndsAtUtc) : NaN;
  // A name bar only names someone who is there. Over the empty holding card
  // it announced a person who was not on stage.
  // One name on screen per person, and it is theirs, on their own frame. The
  // scene's lower third is for moments with no cameras up — a sponsor clip,
  // a slide — so it only shows over media.
  const banner = tiles.length === 0 && meta.stageMediaPlaying && meta.stageMediaUrl ? (meta.bannerTitle ?? "").trim() : "";
  const ticker = (meta.tickerText ?? "").trim();

  const body =
    meta.fallbackPlaying && standby.url ? (
      <FullFrameMedia url={standby.url} kind="video" muted={muted} loop />
    ) : meta.brbOn ? (
      <BrbFrame />
    ) : Number.isFinite(countdownEnds) ? (
      <CountdownFrame endsAt={countdownEnds} label={meta.countdownLabel} />
    ) : meta.stageMediaPlaying && isSpotUrl(meta.stageMediaUrl) ? (
      // The brand spot: full-bleed, the presenter cut out and standing on it.
      <>
        <SpotFrame t0={meta.spotT0} beats={meta.spotBeats} />
        {tiles[0] && !meta.spotHidePresenter && (
          <div className="absolute bottom-0 right-[3%] grid" style={{ width: "40%", height: "96%", transform: "scale(1.55)", transformOrigin: "50% 100%" }}>
            <Tile tile={tiles[0]} muted={muted} namePos="none" fit="full" bare />
          </div>
        )}
      </>
    ) : meta.stageMediaPlaying && isPromoUrl(meta.stageMediaUrl) ? (
      // The National Military Podcast Day promo: animated, with whoever's
      // presenting it (Alex) in a big frame beside it.
      <>
        <BackgroundLayer url={meta.backgroundUrl ?? ""} />
        {tiles.length === 0 ? (
          <PromoFrame started={false} />
        ) : (
          <>
            <div className="absolute overflow-hidden rounded-xl" style={{ left: "1.5%", top: "6%", width: "62%", height: "88%" }}>
              <PromoFrame started />
            </div>
            {/* The presenter fills their frame: Alex's feed is portrait, and letterboxed she was a figure in a dark box. */}
            <HandoffPeople tiles={tiles} muted={muted} order={meta.stageOrder} cover />
          </>
        )}
      </>
    ) : meta.stageMediaPlaying && meta.stageMediaUrl && meta.stageMediaPeople && tiles.length > 0 ? (
      // The clip and the people together, as Restream does it: the clip in a
      // big frame on the left, everyone on stage stacked down the right —
      // a host talking over a sponsor reel, or a podcaster over their slides.
      <>
        <BackgroundLayer url={meta.backgroundUrl ?? ""} />
        <div className="absolute overflow-hidden rounded-xl bg-black" style={{ left: "1.2%", top: "10.5%", width: "76%", height: "79%" }}>
          <FullFrameMedia loop={stageLoops(meta.stageMediaLabel)} url={meta.stageMediaUrl} kind={meta.stageMediaKind ?? "video"} muted={muted} onEnded={onMediaEnded} />
        </div>
        <PeopleColumn tiles={tiles} muted={muted} order={meta.stageOrder} />
      </>
    ) : meta.stageMediaPlaying && meta.stageMediaUrl && isAudioUrl(meta.stageMediaUrl) ? (
      <AudioFrame url={meta.stageMediaUrl} name={meta.stageCardName} show={meta.stageCardShow} photo={meta.stageCardPhoto} muted={muted} onEnded={onMediaEnded} />
    ) : meta.stageMediaPlaying && meta.stageMediaUrl ? (
      <FullFrameMedia
        url={meta.stageMediaUrl}
        kind={meta.stageMediaKind ?? "video"}
        label={meta.stageMediaLabel}
        muted={muted}
        loop={stageLoops(meta.stageMediaLabel)}
        onEnded={onMediaEnded}
      />
    ) : meta.stageThanks ? (
      // The desk hand-off: the slide fills the frame until the co-host adds
      // themselves, then shares it with them, the slide left and they right.
      <>
        <BackgroundLayer url={meta.backgroundUrl ?? ""} />
        {tiles.length === 0 ? (
          <ThanksSlide t={meta.stageThanks} />
        ) : (
          <>
            <div className="absolute overflow-hidden rounded-xl" style={{ left: "1.5%", top: "6%", width: "62%", height: "88%" }}>
              <ThanksSlide t={meta.stageThanks} compact />
            </div>
            <HandoffPeople tiles={tiles} muted={muted} order={meta.stageOrder} />
          </>
        )}
      </>
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
              <span className="relative flex">
                <img src={meta.stageCardPhoto} alt="" className="h-36 w-36 rounded-full object-cover object-[50%_28%] ring-4 ring-[#F0A71F]/60 sm:h-44 sm:w-44" />
                {meta.stageCardPhoto2 && <img src={meta.stageCardPhoto2} alt="" className="-ml-6 h-36 w-36 rounded-full object-cover object-[50%_28%] ring-4 ring-[#F0A71F]/60 sm:-ml-8 sm:h-44 sm:w-44" />}
              </span>
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
        <StageLayout tiles={tiles} layout={meta.stageLayout} fit={meta.tileFit} muted={muted} order={meta.stageOrder} onReorder={onReorder} />
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
