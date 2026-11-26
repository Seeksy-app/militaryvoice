import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, uploadToStorage } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";
import type { RoomBox } from "@shared/roomLook";

/**
 * Room phase 2 (20 Nov 2026), the client side of the contract in room-phase2-contract.md:
 * - The SAVED look is Podcasting's: GET/PUT /api/host/room/look (with rev), files via
 *   /api/host/room/assets.
 * - What's ON AIR is Engineering's, in the LiveKit room metadata (activeScene, showing,
 *   playing, lookRev), changed with /api/host/my-studio/scene, /banner, /media, /backstage.
 * The owner's clicks show at once; the server's answer (or the room catching up) settles it.
 */
export type Layout = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";
/** Bottom left / Bottom right are the choices in Media since 24 Nov; tl and tr stay for older looks. */
export type Corner = "tl" | "tr" | "bl" | "br";
export type AssetKind = "logo" | "background" | "intro" | "outro" | "video" | "sound" | "music" | "photo";
export type Asset = { id: string; kind: AssetKind; name: string; mime: string; sec: number; url: string };
export type Color = "blue" | "dark" | "light";
export type Background = { kind: "color"; value: Color } | { kind: "image"; asset: Asset };
export type Logo = { asset: Asset; corner: Corner } | null;
/** v3 (Studio phase 3, contract in server/roomKit.ts): every scene has a type and a people count. */
export type SceneType = "single" | "two" | "group" | "media" | "profile";
export const PEOPLE_DEFAULT: Record<SceneType, number> = { single: 1, two: 2, group: 3, media: 0, profile: 1 };
export type Profile = { who?: string; photo: Asset | null; name: string; title: string; line: string; links: string[] };
/** A box in a scene's own layout (the layout editor); the shape and rules are in shared/roomLook.ts. */
export type Box = RoomBox;
export type Scene = {
  id: string; n: number; name: string; layout: Layout; stage?: string[];
  type?: SceneType; people?: number; profile?: Profile; media?: Asset | null;
  /** v3: the scene's own layout; absent or empty = the type's layout. */
  boxes?: Box[];
  look?: { background?: Background; logo?: Logo; banner?: string };
  /** A media scene's video repeats (absent = yes). false = it plays once and the stage goes back to `back`. */
  loop?: boolean;
  /** The scene a play-once clip goes back to (the one on air before it). */
  back?: string;
};
/** The scene StreamYard calls the media slot: one "Presenting" scene, reused for each file shown. */
export const PRESENT_NAME = "Presenting";
export const isPresenting = (s?: Scene | null) => !!s && s.type === "media" && s.name === PRESENT_NAME;
export const FONTS = ["Inter", "Montserrat", "Oswald", "Bebas Neue", "Source Sans 3", "Merriweather", "Playfair Display", "Zilla Slab"] as const;
export type Style = { preset: string; brandColor: string; nameTag: "bar" | "pill" | "block" | "plain"; showNames: boolean; textSize: "s" | "m" | "l"; font: (typeof FONTS)[number] };
export const STYLE_DEFAULT: Style = { preset: "classic", brandColor: "#F0A71F", nameTag: "bar", showNames: true, textSize: "m", font: "Inter" };
export type VideoClip = { asset: Asset; role: "" | "intro" | "outro"; loop: boolean };
/** Where a library item comes from; it's only listed when every part is on file (CC0 / public domain only). */
export type LibrarySource = { site: string; title: string; artist: string; page: string; licence: string; checked: string; credit?: string };
/** A pad (played once) or a music bed. id is "lib-<slug>" for our library, the asset id for their own upload. */
export type SoundItem = { id: string; name: string; asset: Asset; source?: LibrarySource };
export type MusicItem = SoundItem;
/** GET /api/host/room/library. */
export type LibraryItem = { id: string; kind: "sound" | "music"; name: string; sec: number; asset: Asset; source: LibrarySource };
/** seconds 0 = Timer Off (stays until clicked off); ticker = scrolls across the bottom (Studio v2, 26 Nov). */
export type Banner = { id: string; text: string; seconds: number; ticker?: boolean };
export type Look = {
  rev: number;
  background: Background;
  logo: Logo;
  /** Their show's icon in the bottom-left when no logo is picked (absent = on). Media > Logo > None turns it off. */
  showIcon?: boolean;
  /** Where that icon sits (Media > Logo > Where it shows); absent = bottom left. */
  iconCorner?: "tl" | "tr" | "bl" | "br";
  logos: Asset[];
  /** Uploaded pictures to pick from (asked of Podcasting; until then only the one in use). */
  backgrounds?: Asset[];
  banners: Banner[];
  intro: Asset | null;
  outro: Asset | null;
  scenes: Scene[];
  style?: Style;
  videos?: VideoClip[];
  sounds?: SoundItem[];
  music?: MusicItem[];
  /** 0–1, one for all sounds and one for music (defaults 0.8 and 0.25). */
  soundVolume?: number;
  musicVolume?: number;
  musicLoop?: boolean;
};
export type Slot = "intro" | "outro";
/** What can play full screen: a tagged video, or one of our live cards (Engineering's slots). */
export type PlaySlot = Slot | "brb" | "soon" | "thanks" | "countdown";
export type Playing = { slot: PlaySlot; at: number; minutes?: number; next?: string };
export type Live = {
  activeScene: string | null; showing: { bannerId: string; until: number } | null; playing: Playing | null; lookRev: number | null;
  sound?: { id: string; at: number } | null; music?: { id: string; at: number } | null;
  /** The host's Pause / Play / From the start on the clip on air (shared/roomLook.ts RoomLive.clip). */
  clip?: { scene: string; rev: number; pos: number; paused: boolean } | null;
  /** The scrolling banner (shared/roomLook.ts RoomLive.ticker). */
  ticker?: { text: string; on: boolean } | null;
};
/** A scene whose video plays when it's on air (a picture or a shared screen doesn't). */
export const isClipScene = (s?: Scene | null) => !!s?.media?.url && !(s.media.mime ?? "").startsWith("image") && (s.type === "media" || !!s.boxes?.some((b) => b.kind === "media"));

export const BACKGROUNDS: Record<Color, string> = {
  blue: "linear-gradient(135deg, #0b1f4a 0%, #0a3a8f 55%, #3b6fd6 100%)",
  dark: "#101828",
  light: "#e8eef7",
};

export const LIMITS = { logos: 6, backgrounds: 6, banners: 10, bannerText: 80, tickerText: 200, sceneName: 30, scenes: 9 };

/** Fill any field the server left out, so the panels never trip on a missing list. */
export function normalize(l: Partial<Look> | null | undefined): Look | null {
  if (!l || typeof l !== "object" || !Array.isArray(l.scenes) || !l.scenes.length) return null;
  return { rev: 0, background: { kind: "color", value: "blue" }, logo: null, intro: null, outro: null, ...l, logos: l.logos ?? [], banners: l.banners ?? [], scenes: l.scenes } as Look;
}

/** The pictures to pick a background from: the list if the server keeps one, else the one in use. */
export const backgroundShelf = (l: Look) => l.backgrounds ?? (l.background.kind === "image" ? [l.background.asset] : []);
export const bgCss = (b: Background) => (b.kind === "image" ? `center / cover no-repeat url("${b.asset.url}")` : BACKGROUNDS[b.value] ?? BACKGROUNDS.blue);
export const sceneLive = (l: Look | null | undefined, live: Live) => l?.scenes.find((s) => s.id === live.activeScene) ?? [...(l?.scenes ?? [])].sort((a, b) => a.n - b.n)[0];
export const newId = () => Math.random().toString(36).slice(2, 10);

/** The live state from the room's metadata (Engineering writes it; we only read). */
export function parseLive(meta: string | undefined): Live {
  const none: Live = { activeScene: null, showing: null, playing: null, lookRev: null };
  if (!meta) return none;
  try {
    const j = JSON.parse(meta) as Partial<Live>;
    return {
      activeScene: typeof j.activeScene === "string" ? j.activeScene : null, showing: j.showing?.bannerId ? j.showing : null, playing: j.playing?.slot ? j.playing : null, lookRev: typeof j.lookRev === "number" ? j.lookRev : null,
      sound: j.sound?.id ? j.sound : null, music: j.music?.id ? j.music : null,
      clip: j.clip?.scene && typeof j.clip.rev === "number" ? j.clip : null,
      ticker: typeof j.ticker?.text === "string" && j.ticker.text ? { text: j.ticker.text, on: j.ticker.on === true } : null,
    };
  } catch { return none; }
}

const KEY = ["/api/host/room/look"];
type WithLook = { look?: Look | null };
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";
const post = async <T,>(url: string, body: unknown) => (await (await apiRequest("POST", url, body)).json().catch(() => ({}))) as T;

/**
 * Everything the room's controls do. `look` is null until the server has one for this room
 * (or for guests, who don't edit it), and then the room works as in phase 1.
 */
export function useRoomKit(owner: boolean, meta: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery<WithLook>({ queryKey: KEY, enabled: owner, retry: false, staleTime: Infinity, queryFn: async () => (await apiRequest("GET", "/api/host/room/look")).json() });
  const look = owner ? normalize(q.data?.look) : null;

  /* ── The saved look: shows at once, saves ~300 ms after the last change, one save at a time. ── */
  const timer = useRef<number>();
  const dirty = useRef(false);
  const flying = useRef<Promise<void> | null>(null);
  const get = () => normalize(qc.getQueryData<WithLook>(KEY)?.look);
  const put = (l: Look) => qc.setQueryData<WithLook>(KEY, { look: l });

  const flush = useCallback(async (): Promise<void> => {
    if (flying.current) { dirty.current = true; return flying.current; }
    const l = get();
    if (!l) return;
    dirty.current = false;
    flying.current = (async () => {
      try {
        const r = await fetch("/api/host/room/look", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ rev: l.rev, look: l }) });
        const j = (await r.json().catch(() => ({}))) as { look?: Look; message?: string };
        if (r.status === 409 && j.look) { put(normalize(j.look)!); dirty.current = false; toast({ title: "Your look was changed in another window", description: "We've loaded the latest. Make your change again if it's missing." }); return; }
        if (!r.ok) throw new Error(j.message || "Couldn't save your look.");
        // Keep anything changed while this was saving; take the server's new rev.
        const cur = get();
        if (j.look) put(dirty.current && cur ? { ...cur, rev: j.look.rev } : normalize(j.look)!);
      } catch (e) {
        toast({ title: "Couldn't save that", description: say(e), variant: "destructive" });
      }
    })();
    try { await flying.current; } finally {
      flying.current = null;
      if (dirty.current) void flush();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); void flush(); } }, [flush]);

  const change = useCallback((fn: (l: Look) => Look) => {
    const l = get();
    if (!l) return;
    put(fn(l));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = undefined; void flush(); }, 300);
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Save now (before a call that changes the look on the server too). */
  const settle = async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = undefined; await flush(); }
    else if (flying.current) await flying.current;
  };

  /** Upload a file, then use it. Their own clips, sounds and music need `rights` (the "I have the rights" tick). */
  const addAsset = useCallback(async (kind: AssetKind, file: File, onProgress: (pct: number) => void, rights?: boolean) => {
    const timed = kind === "intro" || kind === "outro" || kind === "video" || kind === "sound" || kind === "music";
    const sec = timed ? Math.round(await durationOf(file).catch(() => 0)) || undefined : undefined;
    const storageKey = await uploadToStorage(file, onProgress);
    const { asset } = await post<{ asset: Asset }>("/api/host/room/assets", { storageKey, kind, name: file.name, sec, ...(rights ? { rights: true } : {}) });
    change((l) => {
      if (kind === "logo") return { ...l, logos: [...l.logos.filter((x) => x.id !== asset.id), asset].slice(-LIMITS.logos), logo: { asset, corner: l.logo?.corner ?? "bl" } };
      if (kind === "background") return { ...l, backgrounds: [...backgroundShelf(l).filter((x) => x.id !== asset.id), asset].slice(-LIMITS.backgrounds), background: { kind: "image", asset } };
      if (kind === "video") return { ...l, videos: [...(l.videos ?? []), { asset, role: "", loop: false }] };
      if (kind === "sound" || kind === "music") {
        const item = { id: asset.id, name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60), asset };
        return kind === "sound" ? { ...l, sounds: [...(l.sounds ?? []), item] } : { ...l, music: [...(l.music ?? []), item] };
      }
      if (kind === "photo") return l;
      return { ...l, [kind]: asset };
    });
    return asset;
  }, [change]);

  /** Delete a file. The server takes it out of the look too, so we load the look it saved. */
  const removeAsset = useCallback(async (kind: AssetKind, id: string) => {
    change((l) => {
      if (kind === "logo") return { ...l, logos: l.logos.filter((x) => x.id !== id), logo: l.logo?.asset.id === id ? null : l.logo };
      if (kind === "background") return { ...l, backgrounds: backgroundShelf(l).filter((x) => x.id !== id), background: l.background.kind === "image" && l.background.asset.id === id ? { kind: "color", value: "blue" } : l.background };
      if (kind === "video" || kind === "intro" || kind === "outro") return { ...l, videos: (l.videos ?? []).filter((v) => v.asset.id !== id), ...(l.intro?.id === id ? { intro: null } : {}), ...(l.outro?.id === id ? { outro: null } : {}) };
      if (kind === "sound") return { ...l, sounds: (l.sounds ?? []).filter((v) => v.asset.id !== id) };
      if (kind === "music") return { ...l, music: (l.music ?? []).filter((v) => v.asset.id !== id) };
      if (kind === "photo") return { ...l, scenes: l.scenes.map((s) => (s.media?.id === id ? { ...s, media: null } : s)) };
      return { ...l, [kind]: null };
    });
    await settle();
    try { await apiRequest("DELETE", `/api/host/room/assets/${encodeURIComponent(id)}`); }
    catch (e) { toast({ title: "Couldn't delete that file", description: say(e), variant: "destructive" }); }
    await qc.refetchQueries({ queryKey: KEY });
  }, [change]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── On air: what the room's metadata says, with the owner's click showing until it catches up. ── */
  const fromRoom = useMemo(() => parseLive(meta), [meta]);
  const [over, setOver] = useState<Partial<Live>>({});
  useEffect(() => {
    // Drop each override the room now agrees with; drop them all after a few seconds regardless.
    setOver((o) => { const n: Partial<Live> = {}; for (const k of Object.keys(o) as (keyof Live)[]) if (JSON.stringify(o[k]) !== JSON.stringify(fromRoom[k])) (n as Record<string, unknown>)[k] = o[k]; return n; });
  }, [fromRoom]);
  useEffect(() => { if (!Object.keys(over).length) return; const t = window.setTimeout(() => setOver({}), 6000); return () => window.clearTimeout(t); }, [over]);
  const merged: Live = { ...fromRoom, ...over };
  // A banner's time runs out on its own; re-render when it does.
  const [, tick] = useState(0);
  useEffect(() => { const u = merged.showing?.until; if (!u) return; const t = window.setTimeout(() => tick((x) => x + 1), Math.max(0, u - Date.now()) + 50); return () => window.clearTimeout(t); }, [merged.showing?.until]);
  const live: Live = { ...merged, showing: merged.showing && merged.showing.until > Date.now() ? merged.showing : null };

  // A save from another window bumps lookRev: load the look again (unless ours is newer or unsaved).
  useEffect(() => {
    const l = get();
    if (owner && l && fromRoom.lookRev != null && fromRoom.lookRev > l.rev && !timer.current && !flying.current) void qc.refetchQueries({ queryKey: KEY });
  }, [fromRoom.lookRev]); // eslint-disable-line react-hooks/exhaustive-deps

  const optimistic = async (patch: Partial<Live>, call: () => Promise<Partial<Live> | void>, fail: string) => {
    setOver((o) => ({ ...o, ...patch }));
    try { const got = await call(); if (got) setOver((o) => ({ ...o, ...got })); }
    catch (e) {
      setOver((o) => { const n = { ...o }; for (const k of Object.keys(patch) as (keyof Live)[]) delete n[k]; return n; });
      toast({ title: fail, description: say(e), variant: "destructive" });
    }
  };

  /** Put a scene on air (the cards, the 1–9 keys). `force` re-sends it, e.g. right after joining. */
  const toScene = (sceneId: string, force = false) => {
    if (!force && live.activeScene === sceneId) return;
    void optimistic({ activeScene: sceneId, clip: null }, async () => { await settle(); await post("/api/host/my-studio/scene", { sceneId }); }, "Couldn't switch scenes");
  };

  /** Show a banner for its own seconds, or take it down (null). */
  const showBanner = (bannerId: string | null) => {
    const b = look?.banners.find((x) => x.id === bannerId);
    void optimistic({ showing: b ? { bannerId: b.id, until: Date.now() + (b.seconds || 12 * 3600) * 1000 } : null }, async () => {
      await settle();
      const j = await post<{ showing?: Live["showing"] }>("/api/host/my-studio/banner", { bannerId });
      return j.showing !== undefined ? { showing: j.showing } : undefined;
    }, bannerId ? "Couldn't show the banner" : "Couldn't take the banner down");
  };

  /** The scrolling banner: start or update it with its words, or stop it (the words stay for next time). */
  const setTicker = (text: string, on: boolean) => {
    const t = text.replace(/\s+/g, " ").trim().slice(0, 200);
    void optimistic({ ticker: t ? { text: t, on } : null }, async () => {
      const j = await post<{ ticker?: Live["ticker"] }>("/api/host/my-studio/ticker", { text: t, on });
      return j.ticker !== undefined ? { ticker: j.ticker } : undefined;
    }, on ? "Couldn't start the scrolling banner" : "Couldn't stop the scrolling banner");
  };

  /** Play the intro, outro or a ready-made card full screen, or stop it (null; also when it ends). */
  const play = (slot: PlaySlot | null, extra?: { minutes?: number; next?: string }) => {
    void optimistic({ playing: slot ? { slot, at: Date.now(), ...extra } : null }, async () => { await post("/api/host/my-studio/media", { action: slot ?? "stop", ...extra }); }, slot ? "Couldn't play that" : "Couldn't stop it");
  };

  /** v3: a sound plays once for everyone; music plays (or stops, null) under the show. */
  const playSound = (id: string) => {
    void optimistic({ sound: { id, at: Date.now() } }, async () => { await post("/api/host/my-studio/sound", { id }); }, "Couldn't play that sound");
  };
  const playMusic = (id: string | null) => {
    void optimistic({ music: id ? { id, at: Date.now() } : null }, async () => { await post("/api/host/my-studio/music", { id }); }, id ? "Couldn't start the music" : "Couldn't stop the music");
  };

  /**
   * Put a picture, slide or video on the one Presenting scene and that scene on air. A video plays
   * once unless `loop` (Andrew, 24 Nov), then the host's page goes back to the scene that was on
   * before (stopPresenting). False when there's no room for the scene.
   */
  const present = (asset: Asset, loop = false): boolean => {
    const l = get();
    if (!l) return false;
    const reuse = l.scenes.find((x) => isPresenting(x));
    if (!reuse && l.scenes.length >= LIMITS.scenes) { toast({ title: `You have ${LIMITS.scenes} scenes`, description: "Delete one, then present your file.", variant: "destructive" }); return false; }
    const id = reuse?.id ?? newId();
    const onAir = sceneLive(l, live);
    const back = onAir && onAir.id !== id ? onAir.id : reuse?.back;
    change((x) => reuse
      ? { ...x, scenes: x.scenes.map((s) => (s.id === id ? { ...s, media: asset, loop, back } : s)) }
      : { ...x, scenes: [...x.scenes, { id, n: Math.max(0, ...x.scenes.map((s) => s.n)) + 1, name: PRESENT_NAME, layout: "screen", stage: [], type: "media", people: 0, media: asset, loop, back, look: { background: x.background } }] });
    toScene(id);
    return true;
  };
  // The scenes on air before this one, newest last: a clip goes back to the last of them that isn't a clip.
  const trail = useRef<string[]>([]);
  const lastOn = useRef<string | null>(null);
  useEffect(() => {
    const now = live.activeScene;
    if (lastOn.current && lastOn.current !== now) trail.current = [...trail.current.filter((x) => x !== lastOn.current), lastOn.current].slice(-12);
    lastOn.current = now;
  }, [live.activeScene]);
  /** Where a clip goes when it ends or the host presses Stop: the scene they were on before it (Andrew, 24 Nov: "then he puts it back on"). */
  const backOf = (sceneId: string | null | undefined): Scene | undefined => {
    const l = get();
    if (!l) return undefined;
    const ok = (x?: Scene): x is Scene => !!x && x.id !== sceneId && !isClipScene(x) && !isPresenting(x);
    const own = l.scenes.find((x) => x.id === l.scenes.find((y) => y.id === sceneId)?.back);
    if (ok(own)) return own;
    for (let i = trail.current.length - 1; i >= 0; i--) { const x = l.scenes.find((y) => y.id === trail.current[i]); if (ok(x)) return x; }
    return [...l.scenes].sort((a, b) => a.n - b.n).find(ok);
  };
  /** A clip is done (or Stop): back to the scene before it. Defaults to the Presenting scene's. */
  const stopPresenting = (fromId?: string) => {
    const l = get();
    if (!l) return;
    const from = fromId ?? l.scenes.find((x) => isPresenting(x))?.id ?? live.activeScene;
    const back = backOf(from);
    if (back) toScene(back.id);
  };
  /** The player bar: pause or play the clip on air at `pos` seconds, or start it again. */
  const clipAct = async (action: "pause" | "play" | "restart", pos: number) => {
    const scene = live.activeScene ?? sceneLive(get(), live)?.id;
    if (!scene) return;
    try { await post("/api/host/my-studio/clip", { scene, action, pos }); }
    catch (e) { toast({ title: "Couldn't do that", description: say(e), variant: "destructive" }); }
  };

  /** Bring a guest on stage, or send them backstage. */
  const [stageOver, setStageOver] = useState<Record<string, boolean>>({});
  const backstage = async (identity: string, on: boolean) => {
    setStageOver((s) => ({ ...s, [identity]: on }));
    try { await post("/api/host/my-studio/backstage", { identity, on }); }
    catch (e) { toast({ title: on ? "Couldn't bring them on stage" : "Couldn't send them backstage", description: say(e), variant: "destructive" }); }
    finally { window.setTimeout(() => setStageOver((s) => { const n = { ...s }; delete n[identity]; return n; }), 4000); }
  };
  /** On stage? The host always is; guests by their stage attribute (or the click that's on its way). */
  const isOnStage = (identity: string, attr?: string) => (identity in stageOver ? stageOver[identity] : attr !== "off");

  return { look, loading: owner && q.isLoading, live, change, addAsset, removeAsset, toScene, showBanner, setTicker, play, playSound, playMusic, present, stopPresenting, backOf, clipAct, backstage, isOnStage };
}

export type RoomKit = ReturnType<typeof useRoomKit>;
