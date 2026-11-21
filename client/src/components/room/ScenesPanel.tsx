import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clapperboard, Loader2, Lock, MoreHorizontal, Pencil, Play, Plus, Square, Trash2, Users, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LIMITS, PEOPLE_DEFAULT, bgCss, newId, type Layout, type RoomKit, type Scene, type SceneType, type Slot } from "./look";

/** v3 scene types (Studio phase 3 mockup, 21 Nov). The layout follows the type, for players that only know layouts. */
export const TYPES: { id: SceneType; label: string; line: string; layout: Layout }[] = [
  { id: "single", label: "Single speaker", line: "One person, full frame", layout: "solo" },
  { id: "two", label: "Two people", line: "Side by side", layout: "side" },
  { id: "group", label: "Group", line: "Everyone on stage", layout: "grid" },
  { id: "media", label: "Video or picture", line: "A clip, picture or screen fills the scene", layout: "screen" },
  { id: "profile", label: "Profile", line: "A guest's photo, name and a line about them", layout: "solo" },
];
export const typeOf = (s: Scene): SceneType => s.type ?? (s.layout === "solo" || s.layout === "speaker" ? "single" : s.layout === "side" ? "two" : s.layout === "grid" ? "group" : "media");
export const peopleOf = (s: Scene) => s.people ?? PEOPLE_DEFAULT[typeOf(s)];
const typeLabel = (t: SceneType) => TYPES.find((x) => x.id === t)!.label;

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

export function ScenesPanel({ kit, v3 = false, sheet = false }: { kit: RoomKit; v3?: boolean; sheet?: boolean }) {
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

  const add = (type?: SceneType, people?: number) => {
    const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((x) => !look.scenes.some((s) => s.n === x));
    if (!n) return;
    const t = type && TYPES.find((x) => x.id === type)!;
    // v3: a new scene starts with the studio's starting background (look.background).
    const s: Scene = t
      ? { id: newId(), n, name: t.label, layout: t.layout, stage: [], type: t.id, people: people ?? PEOPLE_DEFAULT[t.id], look: { background: look.background }, ...(t.id === "profile" ? { profile: { photo: null, name: "", title: "", line: "", links: [] } } : {}) }
      : { id: newId(), n, name: `Scene ${n}`, layout: "grid", stage: [] };
    kit.change((l) => ({ ...l, scenes: [...l.scenes, s] }));
    setPicking(false);
    setEditing(s.id);
  };
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
      {!v3 && <VideoSlot slot="intro" kit={kit} />}
      {scenes.map((s) => (
        <div key={s.id}>
          <SceneCard s={s} kit={kit} v3={v3} on={onAir === s.id} next={kit.live.playing?.slot === "countdown" && kit.live.playing.next === s.id} onPick={() => kit.toScene(s.id)} onEdit={() => setEditing(editing === s.id ? null : s.id)} />
          {editing === s.id && <SceneEditor s={s} kit={kit} v3={v3} onDelete={look.scenes.length > 1 ? () => remove(s) : undefined} onClose={() => setEditing(null)} />}
        </div>
      ))}
      {look.scenes.length < LIMITS.scenes && (v3 && picking
        ? <TypePicker onPick={add} onClose={() => setPicking(false)} />
        : <button type="button" onClick={() => (v3 ? setPicking(true) : add())} className="h-[42px] shrink-0 rounded-xl border border-dashed border-[#98a2b3] bg-white text-sm font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="scene-add">+ New scene</button>)}
      {!v3 && <VideoSlot slot="outro" kit={kit} />}
    </aside>
  );
}

/** v3: what kind of scene, and for a group how many people. More types come with the add-on. */
function TypePicker({ onPick, onClose }: { onPick: (t: SceneType, people?: number) => void; onClose: () => void }) {
  const [group, setGroup] = useState(3);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest" }); }, []);
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

function SceneCard({ s, kit, v3, on, next, onPick, onEdit }: { s: Scene; kit: RoomKit; v3: boolean; on: boolean; next: boolean; onPick: () => void; onEdit: () => void }) {
  const look = kit.look!;
  const icon = LAYOUTS.find((l) => l.id === s.layout)?.icon;
  const logo = s.look && "logo" in s.look ? s.look.logo : look.logo;
  return (
    <div className={`group relative shrink-0 overflow-hidden rounded-[14px] ${on ? "border-2 border-[#053877] shadow-[0_6px_16px_rgba(5,56,119,0.16)]" : next ? "border-2 border-[#F0A71F] shadow-[0_0_0_4px_rgba(240,167,31,0.2)]" : "border border-[#e4e7ec]"}`} data-testid={`scene-${s.n}`}>
      <button type="button" onClick={onPick} className="block w-full text-left" aria-label={`Put ${s.name} on air (key ${s.n})`} aria-pressed={on}>
        <div className="relative flex h-[88px] items-center justify-center" style={{ background: bgCss(s.look?.background ?? look.background) }}>
          <svg width="88" height="64" viewBox="0 0 22 16" fill="rgba(28,44,82,0.92)" aria-hidden>{icon}</svg>
          {logo && <img src={logo.asset.url} alt="" className={`absolute top-1 h-4 w-auto rounded-sm ${logo.corner === "tl" ? "left-1.5" : "right-1.5"}`} />}
          {on && <span className="absolute left-2 top-2 rounded-full bg-[#12b76a] px-[7px] py-0.5 text-[10px] font-bold tracking-[0.02em] text-white">ON STAGE</span>}
          {!on && next && <span className="absolute left-2 top-2 rounded-full bg-[#F0A71F] px-[7px] py-0.5 text-[10px] font-bold tracking-[0.02em] text-[#101828]">TAKE ME NEXT</span>}
        </div>
        <div className="flex items-center justify-between gap-2 bg-white px-3 py-2">
          <span className="min-w-0"><span className="block truncate text-[13px] font-bold">{s.name}</span>{v3 && <span className="flex items-center gap-1 text-[11px] text-[#667085]">{typeLabel(typeOf(s))} · <Users className="h-3 w-3" aria-label="People on stage" />{peopleOf(s)}</span>}</span>
          <span className="rounded-md bg-[#f2f4f7] px-[7px] py-px text-xs font-semibold text-[#667085]">{s.n}</span>
        </div>
      </button>
      <button type="button" onClick={onEdit} aria-label={`Edit ${s.name}`} title="Edit scene" className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#344054] opacity-0 shadow transition-opacity focus:opacity-100 group-hover:opacity-100" data-testid={`scene-menu-${s.n}`}>{v3 ? <MoreHorizontal className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}</button>
    </div>
  );
}

function SceneEditor({ s, kit, v3, onDelete, onClose }: { s: Scene; kit: RoomKit; v3: boolean; onDelete?: () => void; onClose: () => void }) {
  const set = (p: Partial<Scene>) => kit.change((l) => ({ ...l, scenes: l.scenes.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));
  const type = typeOf(s);
  const people = peopleOf(s);
  const min = type === "media" ? 0 : 1;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (v3) box.current?.scrollIntoView({ block: "nearest" }); }, [v3]);
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
          <p className="mt-3 text-xs font-semibold text-[#475467]">People on stage</p>
          <div className="mt-1.5 flex items-center gap-2" data-testid="scene-people">
            <button type="button" onClick={() => set({ people: Math.max(min, people - 1) })} disabled={people <= min} aria-label="Fewer people" className="h-8 w-8 rounded-lg border border-[#d0d5dd] bg-white text-base font-bold disabled:opacity-40">−</button>
            <span className="w-6 text-center text-sm font-bold tabular-nums">{people}</span>
            <button type="button" onClick={() => set({ people: Math.min(9, people + 1) })} disabled={people >= 9} aria-label="More people" className="h-8 w-8 rounded-lg border border-[#d0d5dd] bg-white text-base font-bold disabled:opacity-40">+</button>
            <span className="text-[11px] leading-snug text-[#667085]">{type === "media" ? (people === 0 ? "The media fills the scene" : people === 1 ? "One person in a corner" : "People in a strip") : ""}</span>
          </div>
          {type === "profile" && <ProfileFields s={s} kit={kit} set={set} />}
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

const mmss = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

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
