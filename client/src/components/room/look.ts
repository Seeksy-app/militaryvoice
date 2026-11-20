import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, uploadToStorage } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";

/**
 * A room's look and scenes (Room phase 2, 20 Nov 2026). Podcasting owns the API and the
 * saved shape; this is the client side of it. GET /api/host/my-studio carries `look`,
 * saves go to PUT /look with the rev they started from, and the live state (which scene is
 * on stage, which banner shows) has its own small POSTs so it reaches the room at once.
 */
export type Layout = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";
export type Corner = "tl" | "tr";
export type AssetKind = "logo" | "background" | "intro" | "outro";
export type Asset = { assetId: string; url: string; name?: string; sec?: number };
export type Scene = { id: string; n: number; name: string; layout: Layout; stage: string[] };
export type Banner = { id: string; text: string; seconds: number };
export type Look = {
  rev: number;
  background: { color?: "blue" | "dark" | "light"; assetId?: string };
  backgrounds?: Asset[];
  logo: { assetId: string; corner: Corner } | null;
  logos: Asset[];
  banners: Banner[];
  showing: string | null;
  intro: Asset | null;
  outro: Asset | null;
  scenes: Scene[];
  onStage: string | null;
};

export const BACKGROUNDS: Record<"blue" | "dark" | "light", string> = {
  blue: "linear-gradient(135deg, #0b1f4a 0%, #0a3a8f 55%, #3b6fd6 100%)",
  dark: "#101828",
  light: "#e8eef7",
};

export const LIMITS = { logos: 6, banners: 10, bannerText: 80, sceneName: 30, scenes: 9 };

/** What a room starts with: scene 1 "Just us", scene 2 "Sharing a screen". */
export const freshLook = (): Look => ({
  rev: 0,
  background: { color: "blue" },
  backgrounds: [],
  logo: null,
  logos: [],
  banners: [],
  showing: null,
  intro: null,
  outro: null,
  scenes: [
    { id: "s1", n: 1, name: "Just us", layout: "side", stage: [] },
    { id: "s2", n: 2, name: "Sharing a screen", layout: "screen", stage: [] },
  ],
  onStage: "s1",
});

/** Fill any field the server left out, so the panels never trip on a missing list. */
export function normalize(l: Partial<Look> | null | undefined): Look | null {
  if (!l || typeof l !== "object") return null;
  const f = freshLook();
  return { ...f, ...l, background: l.background ?? f.background, logos: l.logos ?? [], backgrounds: l.backgrounds ?? [], banners: l.banners ?? [], scenes: l.scenes?.length ? l.scenes : f.scenes } as Look;
}

/** The look as the room's LiveKit metadata carries it (guests read it from there). */
export function lookFromMetadata(meta: string | undefined): Look | null {
  if (!meta) return null;
  try {
    const j = JSON.parse(meta) as { look?: Partial<Look> } & Partial<Look>;
    return normalize(j.look ?? (j.scenes ? j : null));
  } catch { return null; }
}

export const sceneOnStage = (l: Look | null | undefined) => l?.scenes.find((s) => s.id === l.onStage) ?? l?.scenes[0];
export const assetUrl = (l: Look, id?: string) => (id ? [...l.logos, ...(l.backgrounds ?? []), ...(l.intro ? [l.intro] : []), ...(l.outro ? [l.outro] : [])].find((a) => a.assetId === id)?.url : undefined);
export const newId = () => Math.random().toString(36).slice(2, 10);

const KEY = ["/api/host/my-studio"];
type WithLook = { look?: Look | null };
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

/**
 * Change the look: the screen changes at once, the save follows ~300 ms after the last
 * change. One save at a time; a stale rev (409) takes the fresh look the server sends back.
 */
export function useLookActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const timer = useRef<number>();
  const dirty = useRef(false);
  const flying = useRef(false);
  const get = () => normalize(qc.getQueryData<WithLook>(KEY)?.look);
  const put = (l: Look) => qc.setQueryData<WithLook>(KEY, (s) => (s ? { ...s, look: l } : s));

  const flush = useCallback(async () => {
    if (flying.current) { dirty.current = true; return; }
    const l = get();
    if (!l) return;
    dirty.current = false;
    flying.current = true;
    try {
      const r = await fetch("/api/host/my-studio/look", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ rev: l.rev, look: l }) });
      const j = (await r.json().catch(() => ({}))) as { look?: Look; message?: string };
      if (r.status === 409 && j.look) { put(normalize(j.look)!); dirty.current = false; toast({ title: "Your look was changed in another window", description: "We've loaded the latest. Make your change again if it's missing." }); return; }
      if (!r.ok) throw new Error(j.message || "Couldn't save your look.");
      // Keep anything changed while this was saving; take the server's new rev.
      const cur = get();
      if (j.look) put(dirty.current && cur ? { ...cur, rev: j.look.rev } : normalize(j.look)!);
    } catch (e) {
      toast({ title: "Couldn't save that", description: say(e), variant: "destructive" });
    } finally {
      flying.current = false;
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

  /** Live: put a scene on stage (the 1, 2 keys). */
  const toStage = useCallback(async (sceneId: string) => {
    const l = get();
    if (!l || l.onStage === sceneId) return;
    const was = l.onStage;
    put({ ...l, onStage: sceneId });
    try {
      const j = (await (await apiRequest("POST", "/api/host/my-studio/stage", { sceneId })).json().catch(() => ({}))) as { look?: Look };
      if (j.look) put(normalize(j.look)!);
    } catch (e) {
      const c = get();
      if (c) put({ ...c, onStage: was });
      toast({ title: "Couldn't switch scenes", description: say(e), variant: "destructive" });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Live: show a banner, or take it down (null). */
  const showBanner = useCallback(async (bannerId: string | null) => {
    const l = get();
    if (!l) return;
    const was = l.showing;
    put({ ...l, showing: bannerId });
    try {
      const j = (await (await apiRequest("POST", "/api/host/my-studio/banner", { bannerId })).json().catch(() => ({}))) as { look?: Look };
      if (j.look) put(normalize(j.look)!);
    } catch (e) {
      const c = get();
      if (c) put({ ...c, showing: was });
      toast({ title: bannerId ? "Couldn't show the banner" : "Couldn't take the banner down", description: say(e), variant: "destructive" });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Upload a logo, background, intro or outro, then use it. */
  const addAsset = useCallback(async (kind: AssetKind, file: File, onProgress: (pct: number) => void) => {
    const sec = kind === "intro" || kind === "outro" ? Math.round(await durationOf(file).catch(() => 0)) || undefined : undefined;
    const storageKey = await uploadToStorage(file, onProgress);
    const a = (await (await apiRequest("POST", "/api/host/my-studio/assets", { storageKey, kind, name: file.name, sec })).json()) as { assetId: string; url: string };
    const asset: Asset = { assetId: a.assetId, url: a.url, name: file.name, sec };
    change((l) => {
      if (kind === "logo") return { ...l, logos: [...l.logos.filter((x) => x.assetId !== asset.assetId), asset].slice(-LIMITS.logos), logo: { assetId: asset.assetId, corner: l.logo?.corner ?? "tr" } };
      if (kind === "background") return { ...l, backgrounds: [...(l.backgrounds ?? []).filter((x) => x.assetId !== asset.assetId), asset], background: { assetId: asset.assetId } };
      return { ...l, [kind]: asset };
    });
    return asset;
  }, [change]);

  const removeAsset = useCallback(async (kind: AssetKind, assetId: string) => {
    change((l) => {
      if (kind === "logo") return { ...l, logos: l.logos.filter((x) => x.assetId !== assetId), logo: l.logo?.assetId === assetId ? null : l.logo };
      if (kind === "background") return { ...l, backgrounds: (l.backgrounds ?? []).filter((x) => x.assetId !== assetId), background: l.background.assetId === assetId ? { color: "blue" } : l.background };
      return { ...l, [kind]: null };
    });
    await apiRequest("DELETE", `/api/host/my-studio/assets/${encodeURIComponent(assetId)}`).catch((e) => toast({ title: "Couldn't delete that file", description: say(e), variant: "destructive" }));
  }, [change]); // eslint-disable-line react-hooks/exhaustive-deps

  return { change, toStage, showBanner, addAsset, removeAsset };
}
