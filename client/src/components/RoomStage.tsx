import { useEffect, useMemo, useRef, useState } from "react";
import { HiddenVoices, NameTagContext, StageGrid, useStageRoom, type NameTagStyle, type RoomMeta, type StageTile } from "@/components/StageView";
import { apiRequest } from "@/lib/queryClient";
import {
  CARD_TITLE, castOf, countdownText, isPlayer, musicCreditOf, roomStageMeta, sceneOf, shownOnStage, studioIdFromRoom,
  type RoomCardSlot, type RoomLive, type RoomLook, type RoomProfile,
} from "@shared/roomLook";

/** The room name inside a LiveKit token ("my-12"), without verifying anything: the page only needs to know which look to read. */
function roomOfToken(token: string | null): string {
  try {
    const part = (token ?? "").split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { video?: { room?: string } };
    return json.video?.room ?? "";
  } catch {
    return "";
  }
}

/**
 * The Room's picture: the same thing the recorder films, drawn from the same two sources.
 * People come from the LiveKit room (only those not sent backstage (stage = "off") are shown or heard);
 * the look (scenes, background, logo, banners, intro, outro) comes from Podcasting's look
 * endpoint; which scene is on, which banner is showing and which clip is playing come from the
 * room's metadata, which is ours. Nothing here decides any of it.
 */
export function RoomPicture({
  url,
  token,
  studioId,
  lookKey,
  name,
  muted = false,
  forRecording = false,
  onMediaEnded,
  onState,
}: {
  url: string | null;
  token: string | null;
  /** From the token when not given (the recorder's page has only the token). */
  studioId?: number | null;
  lookKey: string | null;
  name?: string;
  muted?: boolean;
  forRecording?: boolean;
  onMediaEnded?: () => void;
  onState?: (s: { connected: boolean; failed: boolean }) => void;
}) {
  const id = studioId ?? studioIdFromRoom(roomOfToken(token));
  const [look, setLook] = useState<RoomLook | null>(null);
  const lookRef = useRef<RoomLook | null>(null);
  const liveRef = useRef<RoomLive>({});
  // Who is shown depends on the scene on air, so the stage is read again when that changes.
  const [pickKey, setPickKey] = useState("");
  const { tiles, meta: raw, connected, failed, caption } = useStageRoom(
    url, token, muted, undefined, forRecording,
    (a) => shownOnStage(a, lookRef.current, liveRef.current),
    pickKey,
  );
  const live = raw as unknown as RoomLive;
  liveRef.current = live;
  lookRef.current = look;
  const sceneKey = `${live.activeScene ?? ""}:${look?.rev ?? 0}`;
  useEffect(() => { setPickKey(sceneKey); }, [sceneKey]);

  useEffect(() => { onState?.({ connected, failed }); }, [connected, failed, onState]);

  // The look, again whenever Podcasting saves (lookRev changes on the room).
  useEffect(() => {
    if (!id || !lookKey) return;
    let alive = true;
    void fetch(`/api/room/${id}/look?k=${encodeURIComponent(lookKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { look?: RoomLook } | null) => { if (alive && j?.look) setLook(j.look); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, lookKey, live.lookRev]);

  // A banner shows for its own seconds, so re-read the clock when it is due to go.
  const [now, setNow] = useState(() => Date.now());
  const until = live.showing?.until ?? 0;
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const t = window.setTimeout(() => setNow(Date.now()), until - Date.now() + 50);
    return () => window.clearTimeout(t);
  }, [until]);

  const { meta, banner } = useMemo(
    () => roomStageMeta(look, live, name || (raw as RoomMeta).studioName || "", window.location.origin, now),
    [look, live.activeScene, live.showing, live.playing, name, now], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // v3: the player bot is heard, never drawn; the scene type decides who is drawn and how.
  const players = tiles.filter((t) => isPlayer(t.identity));
  const people = tiles.filter((t) => !isPlayer(t.identity));
  // Studio v3 drawing only when the server says it's on; otherwise the v2 stage, exactly as before.
  const v3 = live.v3 === true;
  const scene = v3 ? sceneOf(look, live) : undefined;
  const cast = castOf(people.map((t) => ({ identity: t.identity, host: /^owner-/.test(t.identity) && !/-cam-/.test(t.identity), who: t.identity })), scene);
  const drawn = scene?.type ? cast.drawn.map((id) => people.find((t) => t.identity === id)!).filter(Boolean) : people;
  const heard = scene?.type ? people.filter((t) => !cast.drawn.includes(t.identity)) : [];
  const media = !live.playing && scene?.type === "media" && scene.media?.url ? scene.media : null;
  const stageMeta = media && drawn.length
    // Media with people: the clip or picture big, the people stacked beside it (looping).
    ? { ...meta, stageMediaPlaying: true, stageMediaUrl: media.url, stageMediaKind: (media.mime ?? "").startsWith("image") ? "image" : "video", stageMediaPeople: true, stageMediaLabel: "Scene (loop)", stageOrder: cast.drawn.join(",") }
    : scene?.type && cast.layout ? { ...meta, stageLayout: cast.layout, stageOrder: cast.drawn.join(",") } : meta;
  const card = v3 && live.playing && live.playing.slot !== "intro" && live.playing.slot !== "outro" ? live.playing : null;
  const style = v3 && look?.style ? { ...look.style, font: roomFontName(look.style.font) } : undefined;
  const credit = v3 ? musicCreditOf(look, live) : "";
  useRoomFont(style?.font);
  const tag: NameTagStyle | null = style ? { style: style.nameTag, show: style.showNames, size: style.textSize, font: style.font, color: style.brandColor } : null;
  const bg = String((meta as { backgroundUrl?: string }).backgroundUrl ?? "");
  const logo = String((meta as { logoUrl?: string }).logoUrl ?? "");

  // Countdown: re-read the clock every second while it runs.
  useEffect(() => {
    if (card?.slot !== "countdown") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [card?.slot, card?.at]);

  const full = card ? (
    <RoomCard slot={card.slot as RoomCardSlot} text={card.slot === "countdown" ? countdownText(card, now) : ""} name={name || (raw as RoomMeta).studioName || ""} bg={bg} logo={logo} color={style?.brandColor} font={style?.font} />
  ) : media && !drawn.length ? (
    <SceneMedia url={media.url} image={(media.mime ?? "").startsWith("image")} muted={muted} />
  ) : !live.playing && scene?.type === "profile" ? (
    <ProfileCard p={scene.profile ?? {}} people={people} bg={bg} logo={logo} color={style?.brandColor} font={style?.font} />
  ) : null;

  return (
    <div className="relative h-full w-full" style={{ containerType: "inline-size" }}>
      {players.map((t) => <PlayerAudio key={t.identity} tile={t} muted={muted} />)}
      {full ? (
        <>
          {full}
          <HiddenVoices tiles={people} muted={muted} />
        </>
      ) : (
        <NameTagContext.Provider value={tag}>
          <StageGrid tiles={drawn} meta={stageMeta as unknown as RoomMeta} muted={muted} caption={caption} idleTitle={name || "Starting soon"} onMediaEnded={onMediaEnded} />
          <HiddenVoices tiles={heard} muted={muted} />
        </NameTagContext.Provider>
      )}
      {credit && (
        // CC BY music: the credit is on the picture while the track plays, opposite the logo's corner.
        <div className="pointer-events-none absolute z-40" style={{ bottom: "2.2%", ...(String((stageMeta as { logoCorner?: string }).logoCorner ?? "").endsWith("right") && String((stageMeta as { logoCorner?: string }).logoCorner).startsWith("bottom") ? { left: "2.2%" } : { right: "2.2%" }) }} data-testid="room-music-credit">
          <p className="rounded-[0.6cqw] text-white/90" style={{ ...fontOf(style?.font), background: "rgba(4,16,43,0.55)", padding: "0.35cqw 0.9cqw", fontSize: "1.25cqw", fontWeight: 500, lineHeight: 1.2, borderLeft: `0.3cqw solid ${style?.brandColor || "#F0A71F"}` }}>{credit}</p>
        </div>
      )}
      {banner && (
        <div className="pointer-events-none absolute z-30" style={{ left: "4%", right: "4%", bottom: "9%" }} data-testid="room-banner">
          <div className="text-white shadow-lg" style={{ background: "rgba(5,56,119,0.96)", borderLeft: "0.7cqw solid #F0A71F", borderRadius: "1cqw", padding: "1.1cqw 2cqw", fontSize: "2.6cqw", fontWeight: 600, lineHeight: 1.25 }}>
            {banner}
          </div>
        </div>
      )}
    </div>
  );
}

/** The player bot's sounds and music, straight to the speakers (not through the voice leveler, so its own volume holds). */
function PlayerAudio({ tile, muted }: { tile: StageTile; muted: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    // Muted (the host's preview): not attached, since attach() unmutes the element. The host
    // already hears the player bot through the studio's own room.
    if (!el || !tile.audio || muted) return;
    tile.audio.attach(el);
    return () => { tile.audio?.detach(el); };
  }, [tile.audio, muted]);
  return <audio ref={ref} autoPlay muted={muted} data-testid="room-player-audio" />;
}

/**
 * The Style fonts, self-hosted from client/public/fonts (OFL only, licences in its README; no font
 * CDN on the filmed page). Loaded from /fonts/<slug>.woff2 when the look names one, and Inter, the
 * fallback, always. Anything else is Inter. Zilla Slab replaced Roboto Slab (Apache 2.0) on 21 Nov;
 * an old look that still names Roboto Slab gets Zilla Slab.
 */
const ROOM_FONTS = ["Inter", "Montserrat", "Oswald", "Bebas Neue", "Source Sans 3", "Merriweather", "Playfair Display", "Zilla Slab"];
/** Fonts that come in fixed weights, one file each; the rest are variable (100-900) in one file. */
const FIXED_WEIGHTS: Record<string, string[]> = { "Bebas Neue": ["400"], "Zilla Slab": ["400", "600", "700"] };
export const roomFontName = (font?: string) => (font === "Roboto Slab" ? "Zilla Slab" : font);
function loadRoomFont(font: string) {
  if (typeof FontFace === "undefined" || !ROOM_FONTS.includes(font)) return;
  if (Array.from(document.fonts as unknown as Iterable<FontFace>).some((f) => f.family.replace(/["']/g, "") === font)) return;
  const slug = font.toLowerCase().replace(/\s+/g, "-");
  const weights = FIXED_WEIGHTS[font];
  const files = !weights ? [{ url: `/fonts/${slug}.woff2`, weight: "100 900" }] : weights.length === 1 ? [{ url: `/fonts/${slug}.woff2`, weight: weights[0] }] : weights.map((w) => ({ url: `/fonts/${slug}-${w}.woff2`, weight: w }));
  for (const f of files) {
    const face = new FontFace(font, `url(${f.url}) format("woff2")`, { weight: f.weight, display: "swap" });
    document.fonts.add(face);
    void face.load().catch(() => { document.fonts.delete(face); });
  }
}
function useRoomFont(font?: string) {
  useEffect(() => {
    loadRoomFont("Inter");
    if (font) loadRoomFont(font);
  }, [font]);
}

const fontOf = (font?: string) => ({ fontFamily: font ? `'${font}', 'Inter', sans-serif` : "'General Sans', 'Inter', sans-serif" });
const colorOf = (c?: string) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? (c as string) : "#F0A71F");

function Backdrop({ bg }: { bg: string }) {
  if (/^#[0-9a-f]{6}$/i.test(bg)) return <div className="absolute inset-0" style={{ background: bg }} aria-hidden="true" />;
  if (bg) return <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(bg).slice(1, -1)})` }} aria-hidden="true" />;
  return <div className="absolute inset-0 bg-gradient-to-br from-[#0a3a8f] to-[#04102b]" aria-hidden="true" />;
}

/** Be right back, Starting soon, Thank you and the Countdown: drawn live in the owner's look, no video file. */
function RoomCard({ slot, text, name, bg, logo, color, font }: { slot: RoomCardSlot; text: string; name: string; bg: string; logo: string; color?: string; font?: string }) {
  const accent = colorOf(color);
  const done = slot === "countdown" && text === "We're starting";
  return (
    <div className="absolute inset-0 overflow-hidden text-white" data-testid={`room-card-${slot}`}>
      <Backdrop bg={bg} />
      <div className="absolute inset-0 bg-[#04102b]/45" aria-hidden="true" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-[2.4cqw] px-[6cqw] text-center" style={fontOf(font)}>
        {logo && <img src={logo} alt="" className="h-[9cqw] w-auto max-w-[40cqw] object-contain" />}
        <p className="font-bold uppercase tracking-[0.3em]" style={{ color: accent, fontSize: "1.7cqw" }}>{name}</p>
        <p className="font-semibold leading-tight [text-wrap:balance]" style={{ fontSize: slot === "countdown" && !done ? "3.2cqw" : "6cqw" }}>{done ? text : CARD_TITLE[slot]}</p>
        {slot === "countdown" && !done && <p className="font-bold tabular-nums leading-none" style={{ fontSize: "13cqw" }} data-testid="room-countdown">{text}</p>}
        <div className="h-[0.5cqw] w-[12cqw] rounded-full" style={{ background: accent }} aria-hidden="true" />
      </div>
    </div>
  );
}

/** A Video or picture scene: the clip (looping, with its sound) or the picture fills the frame. */
function SceneMedia({ url, image, muted }: { url: string; image: boolean; muted: boolean }) {
  return (
    <div className="absolute inset-0 bg-black" data-testid="room-scene-media">
      {image ? <img src={url} alt="" className="h-full w-full object-contain" /> : <video key={url} src={url} autoPlay playsInline loop muted={muted} className="h-full w-full object-contain" />}
    </div>
  );
}

/** A Profile scene: the guest's card, full frame. The photo is theirs, or their camera picture when they joined with one. */
function ProfileCard({ p, people, bg, logo, color, font }: { p: RoomProfile; people: StageTile[]; bg: string; logo: string; color?: string; font?: string }) {
  const accent = colorOf(color);
  const person = p.who ? people.find((t) => t.identity === p.who) : undefined;
  const name = p.name || person?.name || "";
  const title = p.title || person?.displayTitle || "";
  const photo = p.photo?.url || person?.photoUrl || "";
  return (
    <div className="absolute inset-0 overflow-hidden text-white" data-testid="room-profile">
      <Backdrop bg={bg} />
      <div className="absolute inset-0 bg-[#04102b]/35" aria-hidden="true" />
      {logo && <img src={logo} alt="" className="absolute right-[3cqw] top-[3cqw] h-[6cqw] w-auto object-contain" />}
      <div className="relative flex h-full w-full items-center gap-[5cqw] px-[8cqw]" style={fontOf(font)}>
        <div className="aspect-square w-[30cqw] shrink-0 overflow-hidden rounded-full ring-[0.6cqw]" style={{ ["--tw-ring-color" as string]: accent }}>
          {photo ? <img src={photo} alt="" className="h-full w-full object-cover object-[50%_28%]" /> : <div className="flex h-full w-full items-center justify-center bg-[#053877] font-bold" style={{ fontSize: "9cqw" }}>{name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>}
        </div>
        <div className="min-w-0 space-y-[1.2cqw]">
          <p className="font-bold leading-tight [text-wrap:balance]" style={{ fontSize: "5.2cqw" }}>{name}</p>
          {title && <p className="font-semibold" style={{ fontSize: "2.6cqw", color: accent }}>{title}</p>}
          {p.line && <p className="leading-snug text-white/90 [text-wrap:pretty]" style={{ fontSize: "2.2cqw" }}>{p.line}</p>}
          {(p.links ?? []).slice(0, 3).filter(Boolean).map((l) => <p key={l} className="truncate text-white/80" style={{ fontSize: "1.8cqw" }}>{l.replace(/^https?:\/\//, "").replace(/\/$/, "")}</p>)}
        </div>
      </div>
    </div>
  );
}

/**
 * The room UI's own view of the stage: exactly what the recording and the stream draw.
 * Standalone: put it where the stage goes. It listens through its own hidden connection (never
 * the host's), so it can't knock anyone out of the room.
 *
 * `onMediaEnded` fires when the intro or outro finishes; answer it with
 * POST /api/host/my-studio/media {action: "stop"} so the stage returns to the people.
 */
export function RoomStage({ muted = true, onMediaEnded, className = "" }: { muted?: boolean; onMediaEnded?: () => void; className?: string }) {
  const [conn, setConn] = useState<{ url: string; token: string; studioId: number; name: string; lookKey: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void apiRequest("POST", "/api/host/my-studio/preview-token")
      .then((r) => r.json())
      .then((c) => { if (alive) setConn(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-[#04102b] ${className}`} data-testid="room-stage">
      <RoomPicture url={conn?.url ?? null} token={conn?.token ?? null} studioId={conn?.studioId} lookKey={conn?.lookKey ?? null} name={conn?.name} muted={muted} onMediaEnded={onMediaEnded} />
    </div>
  );
}
