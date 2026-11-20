import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clapperboard, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BACKGROUNDS, LIMITS, assetUrl, newId, type AssetKind, type Layout, type Look, type Scene, type useLookActions } from "./look";

/**
 * The left column of the studio (mockup v8): numbered scene cards, the one on air marked
 * ON STAGE, and the keys 1 to 9 to switch. Each scene is a layout and who's in it.
 * Intro and outro videos sit above and below; playing them is Engineering's (phase 2).
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
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Layouts">
      {LAYOUTS.map((l) => {
        const on = l.id === value;
        return (
          <button key={l.id} type="button" role="radio" aria-checked={on} aria-label={l.label} title={l.label} onClick={() => onPick(l.id)} className={`flex items-center justify-center rounded-[10px] ${sm ? "h-8 w-10" : "h-10 w-[54px]"} ${on ? "border-2 border-[#053877] bg-[#eef3fb]" : "border border-[#e4e7ec] bg-white hover:border-[#98a2b3]"}`} data-testid={`layout-${l.id}`}>
            <svg width="22" height="16" viewBox="0 0 22 16" fill={on ? "#053877" : "#98a2b3"} aria-hidden>{l.icon}</svg>
          </button>
        );
      })}
    </div>
  );
}

type People = { identity: string; name: string }[];
type Actions = ReturnType<typeof useLookActions>;

export function ScenesPanel({ look, people, actions }: { look: Look; people: People; actions: Actions }) {
  const [editing, setEditing] = useState<string | null>(null);
  const scenes = [...look.scenes].sort((a, b) => a.n - b.n);
  const last = scenes[scenes.length - 1]?.n ?? 0;

  // 1 to 9 put that scene on stage, unless they're typing.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const n = Number(e.key);
      if (!n) return;
      const s = look.scenes.find((x) => x.n === n);
      if (s) { e.preventDefault(); void actions.toStage(s.id); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [look.scenes, actions]);

  const add = () => {
    const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((x) => !look.scenes.some((s) => s.n === x));
    if (!n) return;
    const s: Scene = { id: newId(), n, name: `Scene ${n}`, layout: "grid", stage: [] };
    actions.change((l) => ({ ...l, scenes: [...l.scenes, s] }));
    setEditing(s.id);
  };

  return (
    <aside className="hidden w-[208px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[#e4e7ec] bg-white px-3.5 pb-4 pt-[18px] lg:flex 2xl:w-[232px]" data-testid="scenes-panel">
      <div><p className="text-[15px] font-bold">Scenes</p>{last > 1 && <p className="text-xs text-[#667085]">Press 1–{last} to switch</p>}</div>
      <VideoSlot kind="intro" look={look} actions={actions} />
      {scenes.map((s) => (
        <div key={s.id}>
          <SceneCard s={s} look={look} on={look.onStage === s.id} onPick={() => void actions.toStage(s.id)} onEdit={() => setEditing(editing === s.id ? null : s.id)} />
          {editing === s.id && <SceneEditor s={s} people={people} canDelete={look.scenes.length > 1} actions={actions} onClose={() => setEditing(null)} />}
        </div>
      ))}
      {look.scenes.length < LIMITS.scenes && <button type="button" onClick={add} className="h-[42px] shrink-0 rounded-xl border border-dashed border-[#98a2b3] bg-white text-sm font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="scene-add">+ New scene</button>}
      <VideoSlot kind="outro" look={look} actions={actions} />
    </aside>
  );
}

function SceneCard({ s, look, on, onPick, onEdit }: { s: Scene; look: Look; on: boolean; onPick: () => void; onEdit: () => void }) {
  const icon = LAYOUTS.find((l) => l.id === s.layout)?.icon;
  const bg = look.background.assetId ? `center / cover url("${assetUrl(look, look.background.assetId)}")` : BACKGROUNDS[look.background.color ?? "blue"];
  const logo = look.logo ? assetUrl(look, look.logo.assetId) : undefined;
  return (
    <div className={`group relative shrink-0 overflow-hidden rounded-[14px] ${on ? "border-2 border-[#053877] shadow-[0_6px_16px_rgba(5,56,119,0.16)]" : "border border-[#e4e7ec]"}`} data-testid={`scene-${s.n}`}>
      <button type="button" onClick={onPick} className="block w-full text-left" aria-label={`Put ${s.name} on stage (key ${s.n})`} aria-pressed={on}>
        <div className="relative flex h-[88px] items-center justify-center" style={{ background: bg }}>
          <svg width="88" height="64" viewBox="0 0 22 16" fill="rgba(28,44,82,0.92)" aria-hidden>{icon}</svg>
          {logo && <img src={logo} alt="" className={`absolute top-1 h-4 w-auto rounded-sm ${look.logo?.corner === "tl" ? "left-1.5" : "right-1.5"}`} />}
          {on && <span className="absolute left-2 top-2 rounded-full bg-[#12b76a] px-[7px] py-0.5 text-[10px] font-bold tracking-[0.02em] text-white">ON STAGE</span>}
        </div>
        <div className="flex items-center justify-between gap-2 bg-white px-3 py-2">
          <span className="truncate text-[13px] font-bold">{s.name}</span>
          <span className="rounded-md bg-[#f2f4f7] px-[7px] py-px text-xs font-semibold text-[#667085]">{s.n}</span>
        </div>
      </button>
      <button type="button" onClick={onEdit} aria-label={`Edit ${s.name}`} title="Edit scene" className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#344054] opacity-0 shadow transition-opacity focus:opacity-100 group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function SceneEditor({ s, people, canDelete, actions, onClose }: { s: Scene; people: People; canDelete: boolean; actions: Actions; onClose: () => void }) {
  const set = (p: Partial<Scene>) => actions.change((l) => ({ ...l, scenes: l.scenes.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));
  const everyone = s.stage.length === 0;
  const has = (id: string) => everyone || s.stage.includes(id);
  const toggle = (id: string) => {
    const now = everyone ? people.map((p) => p.identity) : s.stage;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    set({ stage: next.length >= people.length && people.every((p) => next.includes(p.identity)) ? [] : next });
  };
  return (
    <div className="mt-2 rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3" data-testid="scene-editor">
      <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">Scene {s.n}</span><button type="button" onClick={onClose} aria-label="Done editing" className="text-[#667085] hover:text-[#101828]"><X className="h-4 w-4" /></button></div>
      <input value={s.name} onChange={(e) => set({ name: e.target.value.slice(0, LIMITS.sceneName) })} aria-label="Scene name" className="mt-2 h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2.5 text-sm outline-none focus:border-[#053877]" />
      <p className="mt-3 text-xs font-semibold text-[#475467]">Layout</p>
      <div className="mt-1.5"><LayoutPicker value={s.layout} onPick={(layout) => set({ layout })} size="sm" /></div>
      <p className="mt-3 text-xs font-semibold text-[#475467]">On stage in this scene</p>
      <ul className="mt-1.5 space-y-1">
        {people.map((p) => (
          <li key={p.identity}><label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={has(p.identity)} onChange={() => toggle(p.identity)} className="h-4 w-4 accent-[#053877]" /><span className="truncate">{p.name}</span></label></li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-[#98a2b3]">Guests who join later come on stage too.</p>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onClose} className="h-8 rounded-lg bg-[#053877] px-3 text-xs font-bold text-white">Done</button>
        {canDelete && <button type="button" onClick={() => { if (!window.confirm(`Delete ${s.name}?`)) return; actions.change((l) => ({ ...l, scenes: l.scenes.filter((x) => x.id !== s.id), onStage: l.onStage === s.id ? l.scenes.find((x) => x.id !== s.id)?.id ?? null : l.onStage })); onClose(); }} className="flex items-center gap-1 text-xs font-semibold text-[#667085] hover:text-[#b42318]"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
      </div>
    </div>
  );
}

const mmss = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

/** Intro or outro video: add one, see it, remove it. */
export function VideoSlot({ kind, look, actions }: { kind: Extract<AssetKind, "intro" | "outro">; look: Look; actions: Actions }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const a = look[kind];
  const label = kind === "intro" ? "Intro video" : "Outro video";
  const pick = async (f?: File) => {
    if (!f) return;
    setPct(0);
    try { await actions.addAsset(kind, f, setPct); toast({ title: `${label} added` }); }
    catch (e) { toast({ title: `Couldn't add the ${label.toLowerCase()}`, description: (e as Error).message, variant: "destructive" }); }
    finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {a ? (
        <div className="group flex shrink-0 items-center gap-2.5 rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] px-2.5 py-2" data-testid={`slot-${kind}`}>
          <div className="flex h-[38px] w-11 shrink-0 items-center justify-center rounded-[7px] bg-[#101828] text-white"><Clapperboard className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{label}</p><p className="text-xs text-[#667085]">{mmss(a.sec) || a.name}</p></div>
          <button type="button" onClick={() => { if (window.confirm(`Remove the ${label.toLowerCase()}?`)) void actions.removeAsset(kind, a.assetId); }} aria-label={`Remove the ${label.toLowerCase()}`} className="text-[#98a2b3] opacity-0 hover:text-[#b42318] focus:opacity-100 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} className="flex h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d0d5dd] bg-white text-[13px] font-semibold text-[#667085] hover:bg-[#f9fafb] disabled:opacity-70" data-testid={`slot-${kind}`}>
          {pct !== null ? <><Loader2 className="h-4 w-4 animate-spin" /> {pct}%</> : <><Plus className="h-4 w-4" /> {label}</>}
        </button>
      )}
    </>
  );
}
