import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Clapperboard, Copy, Image as ImageIcon, LayoutDashboard, Loader2, Lock, MonitorUp, MoreHorizontal, Pencil, Play, Plus, Square, Trash2, Users, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RoomBoxKind, RoomBoxShape } from "@shared/roomLook";
import { LIMITS, PEOPLE_DEFAULT, bgCss, newId, type Asset, type Layout, type RoomKit, type Scene, type SceneType, type Slot } from "./look";
import { isVideo, mmss, useThumb } from "./thumbs";

/**
 * What a media scene shows, as a small picture (Andrew, 24 Nov: "we need to be able to see the video
 * thumbnail in the scene"): the clip's frame or the picture; ▶ and the length on a video; a screen
 * icon for a shared screen. A picture that won't load shows a plain clapperboard or picture icon.
 */
function MediaTile({ a, className = "" }: { a: Asset | null | undefined; className?: string }) {
  const t = useThumb(a);
  const vid = isVideo(a);
  const len = mmss(a?.sec || t?.sec);
  return (
    <span className={`relative block overflow-hidden rounded-[4px] bg-[#101828] ${className}`} data-testid="media-tile">
      {!a ? <span className="flex h-full w-full items-center justify-center text-white/90"><MonitorUp className="h-4 w-4" aria-label="A shared screen" /></span>
        : t ? <img src={t.src} alt="" className="h-full w-full object-cover" draggable={false} />
        : <span className="flex h-full w-full items-center justify-center text-white/70">{vid ? <Clapperboard className="h-4 w-4" aria-hidden /> : <ImageIcon className="h-4 w-4" aria-hidden />}</span>}
      {vid && <span className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 rounded-[3px] bg-black/75 px-1 text-[9px] font-bold leading-[13px] text-white tabular-nums"><Play className="h-2 w-2 fill-current" aria-label="Video" />{len}</span>}
    </span>
  );
}

/** A media scene's card drawing: its media filling the media box, the people boxes as drawn beside it. */
function MediaFace({ s, light }: { s: Scene; light: boolean }) {
  const people = peopleOf(s);
  return (
    <span className="flex h-[60px] w-[106px] gap-[3px]" data-testid="scene-thumb">
      <MediaTile a={s.media} className={`h-full ring-1 ${light ? "ring-[rgba(5,56,119,0.25)]" : "ring-white/40"} ${people ? "w-[76%]" : "w-full"}`} />
      {people > 0 && <span className="flex flex-1 flex-col gap-[3px]">{Array.from({ length: Math.min(people, 3) }, (_, i) => <span key={i} className={`flex-1 rounded-[3px] ${light ? "bg-[rgba(5,56,119,0.85)]" : "bg-white/90"}`} />)}</span>}
    </span>
  );
}

/** Scroll the rail (only the rail, never the page) so a just-opened editor or picker is in view. */
function reveal(el: HTMLElement | null) {
  let p = el?.parentElement ?? null;
  while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
  if (!el || !p) return;
  const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
  if (r.bottom > pr.bottom) p.scrollTop += Math.min(r.bottom - pr.bottom + 8, r.top - pr.top - 8);
}

/** v3 scene types (Studio phase 3 mockup, 21 Nov). The layout follows the type, for players that only know layouts. */
export const TYPES: { id: SceneType; label: string; line: string; layout: Layout }[] = [
  // Names after StreamYard's own picker (Andrew, 21 Nov: "mirror the features"), in our words.
  { id: "single", label: "Speaker view", line: "One person, full frame", layout: "solo" },
  { id: "two", label: "Two people", line: "Side by side", layout: "side" },
  { id: "group", label: "Group discussion", line: "Everyone on stage", layout: "grid" },
  { id: "media", label: "Media presentation", line: "A clip, picture or screen fills the scene", layout: "screen" },
  { id: "profile", label: "Profile", line: "A guest's photo, name and a line about them", layout: "solo" },
];
export const typeOf = (s: Scene): SceneType => s.type ?? (s.layout === "solo" || s.layout === "speaker" ? "single" : s.layout === "side" ? "two" : s.layout === "grid" ? "group" : "media");
export const peopleOf = (s: Scene) => s.people ?? PEOPLE_DEFAULT[typeOf(s)];
const typeLabel = (t: SceneType) => TYPES.find((x) => x.id === t)!.label;
/**
 * Who's on a scene, in plain words, on its card (Andrew, 24 Nov: "How are both of them kind of
 * choreographed together?"): a scene is what viewers see; this says which of the people in the room it shows.
 */
export function whoOn(s: Scene): string {
  if (typeOf(s) === "media") { const n = peopleOf(s); return n === 0 ? "Media only" : `Media + ${n} ${n === 1 ? "person" : "people"}`; }
  if (s.stage?.length) { const n = s.stage.length + 1; return `${n} people`; }
  return "Everyone on stage";
}

/**
 * The left column of the studio (mockup v8): numbered scene cards, the one on air marked
 * ON STAGE, and the keys 1 to 9 to switch. Each scene has a name and a layout. The intro
 * and outro videos sit above and below, each with Play.
 */
export const LAYOUTS: { id: Layout; label: string; icon: ReactNode }[] = [
  { id: "solo", label: "Solo", icon: <rect x="5" y="1" width="12" height="14" rx="2" /> },
  { id: "side", label: "Side by side", icon: <><rect x="1" y="2" width="9" height="12" rx="2" /><rect x="12" y="2" width="9" height="12" rx="2" /></> },
  { id: "grid", label: "Grid", icon: <><rect x="1" y="1" width="9" height="6" rx="1.5" /><rect x="12" y="1" width="9" height="6" rx="1.5" /><rect x="1" y="9" width="9" height="6" rx="1.5" /><rect x="12" y="9" width="9" height="6" rx="1.5" /></> },
  { id: "speaker", label: "Speaker and strip", icon: <><rect x="1" y="1" width="20" height="10" rx="1.5" /><rect x="1" y="12.5" width="6" height="3" rx="1" /><rect x="8" y="12.5" width="6" height="3" rx="1" /></> },
  { id: "screen", label: "Screen share", icon: <><rect x="1" y="1" width="15" height="14" rx="1.5" /><rect x="17" y="1" width="4" height="6" rx="1" /></> },
  { id: "pip", label: "Picture in picture", icon: <><rect x="1" y="1" width="20" height="14" rx="1.5" /><rect x="13" y="8" width="7" height="6" rx="1" opacity="0.55" /></> },
];

export function LayoutPicker({ value, onPick, size = "md" }: { value: Layout; onPick: (l: Layout) => void; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2" role="radiogroup" aria-label="Layouts">
      {LAYOUTS.map((l) => {
        const on = l.id === value;
        return (
          <button key={l.id} type="button" role="radio" aria-checked={on} aria-label={l.label} title={l.label} onClick={() => onPick(l.id)} className={`flex items-center justify-center rounded-[10px] ${sm ? "h-8 w-10" : "h-10 w-[46px] sm:w-[54px]"} ${on ? "border-2 border-[#053877] bg-[#eef3fb]" : "border border-[#e4e7ec] bg-white hover:border-[#98a2b3]"}`} data-testid={`layout-${l.id}`}>
            <svg width="22" height="16" viewBox="0 0 22 16" fill={on ? "#053877" : "#98a2b3"} aria-hidden>{l.icon}</svg>
          </button>
        );
      })}
    </div>
  );
}

/** A small drawing of a layout (the ready-made buttons, and a scene card with its own layout). */
export function BoxThumb({ boxes, light = false, className = "" }: { boxes: { kind: RoomBoxKind; x: number; y: number; w: number; h: number; shape?: RoomBoxShape }[]; light?: boolean; className?: string }) {
  const ink = light ? "#053877" : "#ffffff";
  return (
    <svg viewBox="0 0 160 90" className={`block w-full rounded-md bg-[#0a3a8f] ${className}`} aria-hidden>
      {boxes.map((b, i) => (
        <rect key={i} x={b.x * 160 + 1} y={b.y * 90 + 1} width={Math.max(2, b.w * 160 - 2)} height={Math.max(2, b.h * 90 - 2)} rx={b.shape === "circle" ? Math.min(b.w * 160, b.h * 90) / 2 : b.shape === "square" ? 0 : 4}
          fill={ink} fillOpacity={b.kind === "media" ? 0.95 : b.kind === "grid" ? 0.3 : 0.75} stroke={b.kind === "grid" ? ink : light ? "none" : "rgba(16,24,40,0.22)"} strokeWidth={b.kind === "grid" ? 1 : 0.6} strokeDasharray={b.kind === "grid" ? "4 3" : undefined} />
      ))}
    </svg>
  );
}

export function ScenesPanel({ kit, v3 = false, sheet = false, onEditLayout }: { kit: RoomKit; v3?: boolean; sheet?: boolean; onEditLayout?: (sceneId: string) => void }) {
  const look = kit.look!;
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const scenes = [...look.scenes].sort((a, b) => a.n - b.n);
  const last = scenes[scenes.length - 1]?.n ?? 0;
  const onAir = kit.live.activeScene ?? scenes[0]?.id;

  // 1 to 9 put that scene on air, unless they're typing.
  useEffect(() => {
    if (sheet) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const n = Number(e.key);
      if (!n) return;
      const s = look.scenes.find((x) => x.n === n);
      if (s) { e.preventDefault(); kit.toScene(s.id); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [look.scenes, kit, sheet]);

  // A new scene goes last, or right below one (`below`), moving the later ones (and their keys) down one.
  const [below, setBelow] = useState<number | null>(null);
  const place = (l: typeof look, s: Scene, after: number | null) => {
    if (after === null) return { ...l, scenes: [...l.scenes, s] };
    return { ...l, scenes: [...l.scenes.map((x) => (x.n > after ? { ...x, n: x.n + 1 } : x)), { ...s, n: after + 1 }] };
  };
  const add = (type?: SceneType, people?: number) => {
    const n = below !== null ? below + 1 : [1, 2, 3, 4, 5, 6, 7, 8, 9].find((x) => !look.scenes.some((s) => s.n === x));
    if (!n || look.scenes.length >= LIMITS.scenes) return;
    const t = type && TYPES.find((x) => x.id === type)!;
    // v3: a new scene starts with the studio's starting background (look.background).
    const s: Scene = t
      ? { id: newId(), n, name: t.label, layout: t.layout, stage: [], type: t.id, people: people ?? PEOPLE_DEFAULT[t.id], look: { background: look.background }, ...(t.id === "profile" ? { profile: { photo: null, name: "", title: "", line: "", links: [] } } : {}) }
      : { id: newId(), n, name: `Scene ${n}`, layout: "grid", stage: [] };
    const after = below;
    kit.change((l) => place(l, s, after));
    setPicking(false);
    setBelow(null);
    setEditing(s.id);
  };
  const duplicate = (s: Scene) => {
    if (look.scenes.length >= LIMITS.scenes) return;
    const copy: Scene = { ...JSON.parse(JSON.stringify(s)) as Scene, id: newId(), name: `${s.name} copy`.slice(0, LIMITS.sceneName) };
    kit.change((l) => place(l, copy, s.n));
  };
  const addBelow = (s: Scene) => { setBelow(s.n); setPicking(true); };
  const remove = (s: Scene) => {
    if (!window.confirm(`Delete ${s.name}?`)) return;
    const next = scenes.find((x) => x.id !== s.id);
    kit.change((l) => ({ ...l, scenes: l.scenes.filter((x) => x.id !== s.id) }));
    if (onAir === s.id && next) kit.toScene(next.id, true);
    setEditing(null);
  };

  return (
    <aside className={sheet ? "flex flex-col gap-3 px-4 pb-6 pt-2" : "hidden w-[208px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[#e4e7ec] bg-white px-3.5 pb-4 pt-[18px] lg:flex 2xl:w-[232px]"} data-testid={sheet ? "scenes-sheet" : "scenes-panel"}>
      {!sheet && <div><p className="text-[15px] font-bold">Scenes</p>{last > 1 && <p className="text-xs text-[#667085]">Press 1–{last} to switch</p>}</div>}
      {/* Scenes vs People (Andrew, 24 Nov). */}
      <p className="rounded-lg bg-[#f5f8fd] px-2.5 py-2 text-[11.5px] leading-snug text-[#344054]" data-testid="scenes-vs-people">Scenes = what viewers see. People = who's in the room.</p>
      {!v3 && <VideoSlot slot="intro" kit={kit} />}
      {scenes.map((s) => (
        <div key={s.id}>
          <SceneCard s={s} kit={kit} v3={v3} on={onAir === s.id} next={kit.live.playing?.slot === "countdown" && kit.live.playing.next === s.id} onPick={() => kit.toScene(s.id)}
            full={look.scenes.length >= LIMITS.scenes}
            onRename={() => setEditing(editing === s.id ? null : s.id)} onEditLayout={onEditLayout ? () => { setEditing(null); onEditLayout(s.id); } : undefined} onDuplicate={() => duplicate(s)} onAddBelow={() => addBelow(s)} onDelete={look.scenes.length > 1 ? () => remove(s) : undefined} />
          {editing === s.id && <SceneEditor s={s} kit={kit} v3={v3} onDelete={look.scenes.length > 1 ? () => remove(s) : undefined} onClose={() => setEditing(null)} />}
          {picking && below === s.n && <div className="mt-3"><TypePicker onPick={add} onClose={() => { setPicking(false); setBelow(null); }} /></div>}
        </div>
      ))}
      {look.scenes.length < LIMITS.scenes && (picking && below === null
        ? <TypePicker onPick={add} onClose={() => setPicking(false)} />
        : <button type="button" onClick={() => { setBelow(null); setPicking(true); }} className="h-[42px] shrink-0 rounded-xl border border-dashed border-[#98a2b3] bg-white text-sm font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="scene-add">+ New scene</button>)}
      {!v3 && <VideoSlot slot="outro" kit={kit} />}
    </aside>
  );
}

/** v3: what kind of scene, and for a group how many people. More types come with the add-on. */
function TypePicker({ onPick, onClose }: { onPick: (t: SceneType, people?: number) => void; onClose: () => void }) {
  const [group, setGroup] = useState(3);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { reveal(box.current); }, []);
  return (
    <div ref={box} className="shrink-0 rounded-xl border border-[#e4e7ec] bg-white p-2 shadow-[0_12px_32px_rgba(16,24,40,0.14)]" data-testid="scene-type-picker">
      <div className="flex items-center justify-between px-1.5 pb-1"><span className="text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">New scene</span><button type="button" onClick={onClose} aria-label="Close" className="text-[#667085] hover:text-[#101828]"><X className="h-4 w-4" /></button></div>
      {TYPES.map((t) => (
        <div key={t.id} className="rounded-lg hover:bg-[#f5f8fd]">
          <button type="button" onClick={() => onPick(t.id, t.id === "group" ? group : undefined)} className="block w-full px-2 py-1.5 text-left" data-testid={`scene-type-${t.id}`}>
            <span className="block text-[13px] font-bold">{t.label}</span><span className="block text-[11px] leading-snug text-[#667085]">{t.line}</span>
          </button>
          {t.id === "group" && (
            <div className="flex gap-1 px-2 pb-2" role="radiogroup" aria-label="People in the group">
              {[2, 3, 4, 5, 6].map((n) => <button key={n} type="button" role="radio" aria-checked={group === n} onClick={() => setGroup(n)} className={`h-6 flex-1 rounded-md text-[11px] font-bold ${group === n ? "bg-[#053877] text-white" : "bg-[#f2f4f7] text-[#344054]"}`}>{n === 6 ? "6+" : n}</button>)}
            </div>
          )}
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[#98a2b3]" title="Screen and speaker, picture in picture and a panel with a topic bar come with an add-on">
        <Lock className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold">More scene types</span><span className="block text-[11px]">With the add-on</span></span>
      </div>
    </div>
  );
}

function SceneCard({ s, kit, v3, on, next, full, onPick, onRename, onEditLayout, onDuplicate, onAddBelow, onDelete }: { s: Scene; kit: RoomKit; v3: boolean; on: boolean; next: boolean; full: boolean; onPick: () => void; onRename: () => void; onEditLayout?: () => void; onDuplicate: () => void; onAddBelow: () => void; onDelete?: () => void }) {
  const look = kit.look!;
  const [menu, setMenu] = useState(false);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-[#101828] hover:bg-[#f2f4f7] disabled:opacity-40 disabled:hover:bg-transparent";
  const pick = (fn: () => void) => () => { setMenu(false); fn(); };
  const icon = LAYOUTS.find((l) => l.id === s.layout)?.icon;
  const logo = s.look && "logo" in s.look ? s.look.logo : look.logo;
  // The layout drawing is white so it shows clearly on the dark, blue and picture backgrounds;
  // navy on the light one.
  const cardBg = s.look?.background ?? look.background;
  const lightBg = cardBg.kind === "color" && cardBg.value === "light";
  return (
    <div className={`group relative shrink-0 rounded-[14px] ${on ? "border-2 border-[#053877] shadow-[0_6px_16px_rgba(5,56,119,0.16)]" : next ? "border-2 border-[#F0A71F] shadow-[0_0_0_4px_rgba(240,167,31,0.2)]" : "border border-[#e4e7ec]"}`} data-testid={`scene-${s.n}`}>
      {/* The clip is on the button, not the card, so the ⋯ menu isn't cut off. */}
      <button type="button" onClick={onPick} className="block w-full overflow-hidden rounded-[12px] text-left" aria-label={`Put ${s.name} on air (key ${s.n})`} aria-pressed={on}>
        <div className="relative flex h-[88px] items-center justify-center" style={{ background: bgCss(cardBg) }}>
          {v3 && s.boxes?.length ? <BoxThumb boxes={s.boxes} light={lightBg} className="!w-[104px] !bg-transparent" /> : typeOf(s) === "media" && (s.type === "media" || s.media) ? <MediaFace s={s} light={lightBg} /> : <svg width="88" height="64" viewBox="0 0 22 16" fill={lightBg ? "rgba(5,56,119,0.85)" : "rgba(255,255,255,0.92)"} stroke={lightBg ? "none" : "rgba(16,24,40,0.22)"} strokeWidth="0.3" aria-hidden data-testid="scene-thumb">{icon}</svg>}
          {logo && <img src={logo.asset.url} alt="" className={`absolute top-1 h-4 w-auto rounded-sm ${logo.corner === "tl" ? "left-1.5" : "right-1.5"}`} />}
          {on && <span className="absolute left-2 top-2 rounded-full bg-[#12b76a] px-[7px] py-0.5 text-[10px] font-bold tracking-[0.02em] text-white">ON STAGE</span>}
          {!on && next && <span className="absolute left-2 top-2 rounded-full bg-[#F0A71F] px-[7px] py-0.5 text-[10px] font-bold tracking-[0.02em] text-[#101828]">TAKE ME NEXT</span>}
        </div>
        <div className="flex items-center justify-between gap-2 bg-white px-3 py-2">
          <span className="min-w-0"><span className="block truncate text-[13px] font-bold">{s.name}</span>{v3 ? (s.boxes?.length ? <span className="block text-[11px] text-[#667085]">Your own layout</span> : <span className="flex items-center gap-1 text-[11px] text-[#667085]">{typeLabel(typeOf(s))} · <Users className="h-3 w-3" aria-label="People on stage" />{peopleOf(s)}</span>)
            : <span className="flex items-center gap-1 text-[11px] text-[#667085]" data-testid="scene-who"><Users className="h-3 w-3 shrink-0" aria-hidden />{whoOn(s)}</span>}</span>
          <span className="rounded-md bg-[#f2f4f7] px-[7px] py-px text-xs font-semibold text-[#667085]">{s.n}</span>
        </div>
      </button>
      <button type="button" onClick={() => setMenu(!menu)} aria-label={`${s.name}: more`} aria-expanded={menu} title="Scene options" className={`absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#344054] shadow transition-opacity focus:opacity-100 group-hover:opacity-100 ${menu ? "opacity-100" : "opacity-0"}`} data-testid={`scene-menu-${s.n}`}><MoreHorizontal className="h-4 w-4" /></button>
      {menu && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
          {/* Scene ⋯ (StreamYard's own set, Andrew 21 Nov). Nothing here puts a scene on air. */}
          <div className="absolute inset-x-1.5 top-10 z-20 rounded-xl border border-[#e4e7ec] bg-white p-1 shadow-[0_12px_32px_rgba(16,24,40,0.18)]" data-testid={`scene-menu-list-${s.n}`}>
            <button type="button" onClick={pick(onRename)} className={item} data-testid="scene-rename"><Pencil className="h-4 w-4" /> {v3 ? "Rename and edit" : "Rename"}</button>
            {onEditLayout && <button type="button" onClick={pick(onEditLayout)} className={item} data-testid="scene-edit-layout"><LayoutDashboard className="h-4 w-4" /> Edit layout</button>}
            <button type="button" onClick={pick(onDuplicate)} disabled={full} title={full ? "9 scenes is the most" : undefined} className={item} data-testid="scene-duplicate"><Copy className="h-4 w-4" /> Duplicate</button>
            <button type="button" onClick={pick(onAddBelow)} disabled={full} title={full ? "9 scenes is the most" : undefined} className={item} data-testid="scene-add-below"><Plus className="h-4 w-4" /> Add scene below</button>
            {onDelete && <><div className="my-1 h-px bg-[#eaecf0]" /><button type="button" onClick={pick(onDelete)} className={`${item} text-[#b42318]`} data-testid="scene-delete"><Trash2 className="h-4 w-4" /> Delete scene</button></>}
          </div>
        </>
      )}
    </div>
  );
}

function SceneEditor({ s, kit, v3, onDelete, onClose }: { s: Scene; kit: RoomKit; v3: boolean; onDelete?: () => void; onClose: () => void }) {
  const set = (p: Partial<Scene>) => kit.change((l) => ({ ...l, scenes: l.scenes.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));
  const type = typeOf(s);
  const people = peopleOf(s);
  const min = type === "media" ? 0 : 1;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (v3) reveal(box.current); }, [v3]);
  return (
    <div ref={box} className="mt-2 rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3" data-testid="scene-editor">
      <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">Scene {s.n}</span><button type="button" onClick={onClose} aria-label="Done editing" className="text-[#667085] hover:text-[#101828]"><X className="h-4 w-4" /></button></div>
      <input value={s.name} onChange={(e) => set({ name: e.target.value.slice(0, LIMITS.sceneName) })} aria-label="Scene name" className="mt-2 h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2.5 text-sm outline-none focus:border-[#053877]" />
      {v3 ? (
        <>
          <label className="mt-3 block text-xs font-semibold text-[#475467]" htmlFor={`type-${s.id}`}>Scene type</label>
          <select id={`type-${s.id}`} value={type} onChange={(e) => { const t = TYPES.find((x) => x.id === e.target.value)!; set({ type: t.id, layout: t.layout, people: PEOPLE_DEFAULT[t.id], ...(t.id === "profile" && !s.profile ? { profile: { photo: null, name: "", title: "", line: "", links: [] } } : {}) }); }} className="mt-1.5 h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-sm" data-testid="scene-type">
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {s.boxes?.length ? <p className="mt-3 rounded-lg bg-[#eef3fb] px-2.5 py-2 text-[11px] leading-snug text-[#344054]" data-testid="scene-own-layout">This scene has its own layout. Use ⋯ → Edit layout to change who shows and where.</p> : <>
          <p className="mt-3 text-xs font-semibold text-[#475467]">People on stage</p>
          <div className="mt-1.5 flex items-center gap-2" data-testid="scene-people">
            <button type="button" onClick={() => set({ people: Math.max(min, people - 1) })} disabled={people <= min} aria-label="Fewer people" className="h-8 w-8 rounded-lg border border-[#d0d5dd] bg-white text-base font-bold disabled:opacity-40">−</button>
            <span className="w-6 text-center text-sm font-bold tabular-nums">{people}</span>
            <button type="button" onClick={() => set({ people: Math.min(9, people + 1) })} disabled={people >= 9} aria-label="More people" className="h-8 w-8 rounded-lg border border-[#d0d5dd] bg-white text-base font-bold disabled:opacity-40">+</button>
            <span className="text-[11px] leading-snug text-[#667085]">{type === "media" ? (people === 0 ? "The media fills the scene" : people === 1 ? "One person in a corner" : "People in a strip") : ""}</span>
          </div></>}
          {type === "media" && <MediaPick s={s} kit={kit} set={set} />}
          {type === "profile" && <ProfileFields s={s} kit={kit} set={set} />}
        </>
      ) : type === "media" && s.type === "media" ? (
        // v2 (Andrew, 24 Nov: "It just drops down to scene 2 and then asks for a layout"): a Media presentation
        // asks what it shows, and how many people sit with it; the layout icons wait under More layouts.
        <>
          <MediaPick s={s} kit={kit} set={set} upload />
          <p className="mt-3 text-xs font-semibold text-[#475467]">People on stage</p>
          <div className="mt-1.5 flex items-center gap-2" data-testid="scene-people">
            <button type="button" onClick={() => set({ people: Math.max(0, people - 1) })} disabled={people <= 0} aria-label="Fewer people" className="h-8 w-8 rounded-lg border border-[#d0d5dd] bg-white text-base font-bold disabled:opacity-40">−</button>
            <span className="w-6 text-center text-sm font-bold tabular-nums">{people}</span>
            <button type="button" onClick={() => set({ people: Math.min(9, people + 1) })} disabled={people >= 9} aria-label="More people" className="h-8 w-8 rounded-lg border border-[#d0d5dd] bg-white text-base font-bold disabled:opacity-40">+</button>
            <span className="text-[11px] leading-snug text-[#667085]">{people === 0 ? "The media fills the scene" : people === 1 ? "One person in a corner" : "People in a strip"}</span>
          </div>
          <details className="mt-3" data-testid="scene-more-layouts">
            <summary className="cursor-pointer text-xs font-semibold text-[#053877]">More layouts</summary>
            <div className="mt-1.5"><LayoutPicker value={s.layout} onPick={(layout) => set({ layout, type: undefined, people: undefined, media: undefined })} size="sm" /></div>
          </details>
        </>
      ) : (
        <>
          <p className="mt-3 text-xs font-semibold text-[#475467]">Layout</p>
          <div className="mt-1.5"><LayoutPicker value={s.layout} onPick={(layout) => set({ layout })} size="sm" /></div>
        </>
      )}
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onClose} className="h-8 rounded-lg bg-[#053877] px-3 text-xs font-bold text-white">Done</button>
        {onDelete && <button type="button" onClick={onDelete} className="flex items-center gap-1 text-xs font-semibold text-[#667085] hover:text-[#b42318]"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
      </div>
    </div>
  );
}

/**
 * A media scene shows one clip or picture from Media (or a shared screen when it has none). `upload`
 * (the v2 editor, where there's no Media tab): "What does this scene show?" with Upload one beside the list.
 */
function MediaPick({ s, kit, set, upload = false }: { s: Scene; kit: RoomKit; set: (p: Partial<Scene>) => void; upload?: boolean }) {
  const look = kit.look!;
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [rights, setRights] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const all = [...(look.videos ?? []).map((v) => v.asset), ...(look.backgrounds ?? []), ...look.logos, ...(s.media ? [s.media] : [])].filter((a, i, xs) => xs.findIndex((b) => b.id === a.id) === i);
  const pick = async (f?: File) => {
    if (!f) return;
    const video = f.type.startsWith("video/");
    setPct(0);
    try { set({ media: await kit.addAsset(video ? "video" : "photo", f, setPct, video ? true : undefined) }); setAdding(false); }
    catch (e) { toast({ title: "Couldn't add that file", description: (e as Error).message, variant: "destructive" }); }
    finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <p className="mt-3 block text-xs font-semibold text-[#475467]" id={`media-${s.id}`}>{upload ? "What does this scene show?" : "Shows"}</p>
      <div role="radiogroup" aria-labelledby={`media-${s.id}`} className="mt-1.5 max-h-[232px] space-y-1 overflow-y-auto" data-testid="scene-media">
        {[null, ...all].map((a) => {
          const on = (s.media?.id ?? null) === (a?.id ?? null);
          const name = !a ? "A shared screen" : a.name || (isVideo(a) ? "Video" : "Picture");
          return (
            <button key={a?.id ?? "screen"} type="button" role="radio" aria-checked={on} onClick={() => set({ media: a })} title={name}
              className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left ${on ? "border-[#053877] bg-[#eef3fb]" : "border-[#e4e7ec] bg-white hover:bg-[#f9fafb]"}`} data-testid={`scene-media-${a?.id ?? "screen"}`}>
              <MediaTile a={a} className="h-[34px] w-[60px] shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#101828]">{name}</span>
              {on && <Check className="mr-1 h-4 w-4 shrink-0 text-[#053877]" aria-hidden />}
            </button>
          );
        })}
      </div>
      {!upload && !all.length && <p className="mt-1 text-[11px] text-[#98a2b3]">Add clips or pictures in Media to show one here.</p>}
      {upload && (pct !== null ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#667085]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading {pct}%</p>
      ) : !adding ? (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#98a2b3] bg-white text-[12px] font-semibold text-[#475467] hover:bg-[#f9fafb]" data-testid="scene-media-upload"><Plus className="h-3.5 w-3.5" /> Upload a video or picture</button>
      ) : (
        <div className="mt-2 rounded-lg border border-[#e4e7ec] bg-white p-2.5">
          <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <label className="flex items-start gap-2 text-[12px] font-semibold text-[#344054]"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" data-testid="scene-media-rights" /> I have the rights to use this</label>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={!rights} onClick={() => input.current?.click()} className="h-8 rounded-lg bg-[#053877] px-3 text-[12px] font-bold text-white disabled:opacity-40">Choose a file</button>
            <button type="button" onClick={() => setAdding(false)} className="h-8 px-1.5 text-[12px] font-semibold text-[#475467]">Cancel</button>
          </div>
        </div>
      ))}
      {upload && !s.media && <p className="mt-1.5 text-[11px] leading-snug text-[#667085]">A shared screen: press Present or invite, then Share screen.</p>}
    </>
  );
}

/** The profile scene: photo, name, title, one line and up to 3 links (shown, not clickable). */
function ProfileFields({ s, kit, set }: { s: Scene; kit: RoomKit; set: (p: Partial<Scene>) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const p = s.profile ?? { photo: null, name: "", title: "", line: "", links: [] };
  const put = (q: Partial<typeof p>) => set({ profile: { ...p, ...q } });
  const field = "mt-1 h-8 w-full rounded-lg border border-[#d0d5dd] bg-white px-2 text-[13px] outline-none focus:border-[#053877]";
  const pick = async (f?: File) => {
    if (!f) return;
    setPct(0);
    try { const a = await kit.addAsset("photo", f, setPct); kit.change((l) => ({ ...l, scenes: l.scenes.map((x) => (x.id === s.id ? { ...x, profile: { ...(x.profile ?? p), photo: a } } : x)) })); }
    catch (e) { toast({ title: "Couldn't add the photo", description: (e as Error).message, variant: "destructive" }); }
    finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  return (
    <div className="mt-3 border-t border-[#eaecf0] pt-3" data-testid="profile-fields">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} aria-label="Add a photo" className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-[#98a2b3] bg-white text-[#667085]">
          {pct !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : p.photo ? <img src={p.photo.url} alt="" className="h-full w-full object-cover" /> : <Plus className="h-4 w-4" />}
        </button>
        <span className="text-[11px] text-[#667085]">{p.photo ? "Press to change the photo" : "Add their photo"}</span>
      </div>
      <input value={p.name} onChange={(e) => put({ name: e.target.value.slice(0, 60) })} placeholder="Name" aria-label="Name" className={`${field} mt-2`} />
      <input value={p.title} onChange={(e) => put({ title: e.target.value.slice(0, 80) })} placeholder="Title, e.g. Army veteran, author" aria-label="Title" className={field} />
      <input value={p.line} onChange={(e) => put({ line: e.target.value.slice(0, 140) })} placeholder="One line about them" aria-label="One line about them" className={field} />
      {[0, 1, 2].map((i) => <input key={i} value={p.links[i] ?? ""} onChange={(e) => put({ links: [0, 1, 2].map((j) => (j === i ? e.target.value.slice(0, 200) : p.links[j] ?? "")) })} placeholder="https://…" aria-label={`Link ${i + 1}`} className={field} />)}
      <p className="mt-1 text-[11px] text-[#98a2b3]">Links show on screen as text. Start each with https://</p>
    </div>
  );
}


/** Intro or outro video: add one, play it full screen, remove it. */
export function VideoSlot({ slot, kit }: { slot: Slot; kit: RoomKit }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const a = kit.look![slot];
  const label = slot === "intro" ? "Intro video" : "Outro video";
  const playing = kit.live.playing?.slot === slot;
  const pick = async (f?: File) => {
    if (!f) return;
    setPct(0);
    try { await kit.addAsset(slot, f, setPct); toast({ title: `${label} added` }); }
    catch (e) { toast({ title: `Couldn't add the ${label.toLowerCase()}`, description: (e as Error).message, variant: "destructive" }); }
    finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <input ref={input} type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {a ? (
        <div className={`group flex shrink-0 items-center gap-2 rounded-xl border px-2 py-2 ${playing ? "border-[#053877] bg-[#f5f8fd]" : "border-[#e4e7ec] bg-[#fcfcfd]"}`} data-testid={`slot-${slot}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#101828] text-white"><Clapperboard className="h-3.5 w-3.5" /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{label}</p><p className="text-xs text-[#667085]">{playing ? "Playing now" : mmss(a.sec) || a.name}</p></div>
          {!playing && <button type="button" onClick={() => { if (window.confirm(`Remove the ${label.toLowerCase()}?`)) void kit.removeAsset(slot, a.id); }} aria-label={`Remove the ${label.toLowerCase()}`} className="hidden shrink-0 text-[#98a2b3] hover:text-[#b42318] group-focus-within:block group-hover:block"><Trash2 className="h-4 w-4" /></button>}
          <button type="button" onClick={() => kit.play(playing ? null : slot)} aria-label={playing ? `Stop the ${label.toLowerCase()}` : `Play the ${label.toLowerCase()}`} title={playing ? "Stop" : "Play"} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${playing ? "bg-[#053877] text-white" : "border border-[#053877] text-[#053877] hover:bg-[#eef3fb]"}`} data-testid={`play-${slot}`}>
            {playing ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} className="flex h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d0d5dd] bg-white text-[13px] font-semibold text-[#667085] hover:bg-[#f9fafb] disabled:opacity-70" data-testid={`slot-${slot}`}>
          {pct !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> {pct}%</> : <><Plus className="h-4 w-4" /> {label}</>}
        </button>
      )}
    </>
  );
}
