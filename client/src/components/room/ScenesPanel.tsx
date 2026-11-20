import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clapperboard, Loader2, Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LIMITS, bgCss, newId, type Layout, type RoomKit, type Scene, type Slot } from "./look";

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

export function ScenesPanel({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const [editing, setEditing] = useState<string | null>(null);
  const scenes = [...look.scenes].sort((a, b) => a.n - b.n);
  const last = scenes[scenes.length - 1]?.n ?? 0;
  const onAir = kit.live.activeScene ?? scenes[0]?.id;

  // 1 to 9 put that scene on air, unless they're typing.
  useEffect(() => {
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
  }, [look.scenes, kit]);

  const add = () => {
    const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((x) => !look.scenes.some((s) => s.n === x));
    if (!n) return;
    const s: Scene = { id: newId(), n, name: `Scene ${n}`, layout: "grid", stage: [] };
    kit.change((l) => ({ ...l, scenes: [...l.scenes, s] }));
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
    <aside className="hidden w-[208px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[#e4e7ec] bg-white px-3.5 pb-4 pt-[18px] lg:flex 2xl:w-[232px]" data-testid="scenes-panel">
      <div><p className="text-[15px] font-bold">Scenes</p>{last > 1 && <p className="text-xs text-[#667085]">Press 1–{last} to switch</p>}</div>
      <VideoSlot slot="intro" kit={kit} />
      {scenes.map((s) => (
        <div key={s.id}>
          <SceneCard s={s} kit={kit} on={onAir === s.id} onPick={() => kit.toScene(s.id)} onEdit={() => setEditing(editing === s.id ? null : s.id)} />
          {editing === s.id && <SceneEditor s={s} kit={kit} onDelete={look.scenes.length > 1 ? () => remove(s) : undefined} onClose={() => setEditing(null)} />}
        </div>
      ))}
      {look.scenes.length < LIMITS.scenes && <button type="button" onClick={add} className="h-[42px] shrink-0 rounded-xl border border-dashed border-[#98a2b3] bg-white text-sm font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="scene-add">+ New scene</button>}
      <VideoSlot slot="outro" kit={kit} />
    </aside>
  );
}

function SceneCard({ s, kit, on, onPick, onEdit }: { s: Scene; kit: RoomKit; on: boolean; onPick: () => void; onEdit: () => void }) {
  const look = kit.look!;
  const icon = LAYOUTS.find((l) => l.id === s.layout)?.icon;
  const logo = s.look && "logo" in s.look ? s.look.logo : look.logo;
  return (
    <div className={`group relative shrink-0 overflow-hidden rounded-[14px] ${on ? "border-2 border-[#053877] shadow-[0_6px_16px_rgba(5,56,119,0.16)]" : "border border-[#e4e7ec]"}`} data-testid={`scene-${s.n}`}>
      <button type="button" onClick={onPick} className="block w-full text-left" aria-label={`Put ${s.name} on air (key ${s.n})`} aria-pressed={on}>
        <div className="relative flex h-[88px] items-center justify-center" style={{ background: bgCss(s.look?.background ?? look.background) }}>
          <svg width="88" height="64" viewBox="0 0 22 16" fill="rgba(28,44,82,0.92)" aria-hidden>{icon}</svg>
          {logo && <img src={logo.asset.url} alt="" className={`absolute top-1 h-4 w-auto rounded-sm ${logo.corner === "tl" ? "left-1.5" : "right-1.5"}`} />}
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

function SceneEditor({ s, kit, onDelete, onClose }: { s: Scene; kit: RoomKit; onDelete?: () => void; onClose: () => void }) {
  const set = (p: Partial<Scene>) => kit.change((l) => ({ ...l, scenes: l.scenes.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));
  return (
    <div className="mt-2 rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3" data-testid="scene-editor">
      <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">Scene {s.n}</span><button type="button" onClick={onClose} aria-label="Done editing" className="text-[#667085] hover:text-[#101828]"><X className="h-4 w-4" /></button></div>
      <input value={s.name} onChange={(e) => set({ name: e.target.value.slice(0, LIMITS.sceneName) })} aria-label="Scene name" className="mt-2 h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2.5 text-sm outline-none focus:border-[#053877]" />
      <p className="mt-3 text-xs font-semibold text-[#475467]">Layout</p>
      <div className="mt-1.5"><LayoutPicker value={s.layout} onPick={(layout) => set({ layout })} size="sm" /></div>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onClose} className="h-8 rounded-lg bg-[#053877] px-3 text-xs font-bold text-white">Done</button>
        {onDelete && <button type="button" onClick={onDelete} className="flex items-center gap-1 text-xs font-semibold text-[#667085] hover:text-[#b42318]"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
      </div>
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
