import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, uploadToStorage } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";

/**
 * Room phase 2 (20 Nov 2026), the client side of the contract in room-phase2-contract.md:
 * - The SAVED look is Podcasting's: GET/PUT /api/host/room/look (with rev), files via
 *   /api/host/room/assets.
 * - What's ON AIR is Engineering's, in the LiveKit room metadata (activeScene, showing,
 *   playing, lookRev), changed with /api/host/my-studio/scene, /banner, /media, /backstage.
 * The owner's clicks show at once; the server's answer (or the room catching up) settles it.
 */
export type Layout = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";
export type Corner = "tl" | "tr";
export type AssetKind = "logo" | "background" | "intro" | "outro";
export type Asset = { id: string; kind: AssetKind; name: string; mime: string; sec: number; url: string };
export type Color = "blue" | "dark" | "light";
export type Background = { kind: "color"; value: Color } | { kind: "image"; asset: Asset };
export type Logo = { asset: Asset; corner: Corner } | null;
export type Scene = { id: string; n: number; name: string; layout: Layout; stage?: string[]; look?: { background?: Background; logo?: Logo; banner?: string } };
export type Banner = { id: string; text: string; seconds: number };
export type Look = {
  rev: number;
  background: Background;
  logo: Logo;
  logos: Asset[];
  /** Uploaded pictures to pick from (asked of Podcasting; until then only the one in use). */
  backgrounds?: Asset[];
  banners: Banner[];
  intro: Asset | null;
  outro: Asset | null;
  scenes: Scene[];
};
export type Slot = "intro" | "outro";
export type Live = { activeScene: string | null; showing: { bannerId: string; until: number } | null; playing: { slot: Slot; at: number } | null; lookRev: number | null };

export const BACKGROUNDS: Record<Color, string> = {
  blue: "linear-gradient(135deg, #0b1f4a 0%, #0a3a8f 55%, #3b6fd6 100%)",
  dark: "#101828",
  light: "#e8eef7",
};

export const LIMITS = { logos: 6, backgrounds: 6, banners: 10, bannerText: 80, sceneName: 30, scenes: 9 };

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
    return { activeScene: typeof j.activeScene === "string" ? j.activeScene : null, showing: j.showing?.bannerId ? j.showing : null, playing: j.playing?.slot ? j.playing : null, lookRev: typeof j.lookRev === "number" ? j.lookRev : null };
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

  /** Upload a logo, background, intro or outro, then use it. */
  const addAsset = useCallback(async (kind: AssetKind, file: File, onProgress: (pct: number) => void) => {
    const sec = kind === "intro" || kind === "outro" ? Math.round(await durationOf(file).catch(() => 0)) || undefined : undefined;
    const storageKey = await uploadToStorage(file, onProgress);
    const { asset } = await post<{ asset: Asset }>("/api/host/room/assets", { storageKey, kind, name: file.name, sec });
    change((l) => {
      if (kind === "logo") return { ...l, logos: [...l.logos.filter((x) => x.id !== asset.id), asset].slice(-LIMITS.logos), logo: { asset, corner: l.logo?.corner ?? "tr" } };
      if (kind === "background") return { ...l, backgrounds: [...backgroundShelf(l).filter((x) => x.id !== asset.id), asset].slice(-LIMITS.backgrounds), background: { kind: "image", asset } };
      return { ...l, [kind]: asset };
    });
    return asset;
  }, [change]);

  /** Delete a file. The server takes it out of the look too, so we load the look it saved. */
  const removeAsset = useCallback(async (kind: AssetKind, id: string) => {
    change((l) => {
      if (kind === "logo") return { ...l, logos: l.logos.filter((x) => x.id !== id), logo: l.logo?.asset.id === id ? null : l.logo };
      if (kind === "background") return { ...l, backgrounds: backgroundShelf(l).filter((x) => x.id !== id), background: l.background.kind === "image" && l.background.asset.id === id ? { kind: "color", value: "blue" } : l.background };
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
    void optimistic({ activeScene: sceneId }, async () => { await settle(); await post("/api/host/my-studio/scene", { sceneId }); }, "Couldn't switch scenes");
  };

  /** Show a banner for its own seconds, or take it down (null). */
  const showBanner = (bannerId: string | null) => {
    const b = look?.banners.find((x) => x.id === bannerId);
    void optimistic({ showing: b ? { bannerId: b.id, until: Date.now() + b.seconds * 1000 } : null }, async () => {
      await settle();
      const j = await post<{ showing?: Live["showing"] }>("/api/host/my-studio/banner", { bannerId });
      return j.showing !== undefined ? { showing: j.showing } : undefined;
    }, bannerId ? "Couldn't show the banner" : "Couldn't take the banner down");
  };

  /** Play the intro or outro full screen, or stop it (null; also when it ends). */
  const play = (slot: Slot | null) => {
    void optimistic({ playing: slot ? { slot, at: Date.now() } : null }, async () => { await post("/api/host/my-studio/media", { action: slot ?? "stop" }); }, slot ? `Couldn't play your ${slot}` : "Couldn't stop it");
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

  return { look, loading: owner && q.isLoading, live, change, addAsset, removeAsset, toScene, showBanner, play, backstage, isOnStage };
}

export type RoomKit = ReturnType<typeof useRoomKit>;
