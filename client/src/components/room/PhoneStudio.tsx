import { useState, type ReactNode } from "react";
import { Clapperboard, Layers, Palette, X } from "lucide-react";
import { sceneLive, type RoomKit } from "./look";
import { ScenesPanel } from "./ScenesPanel";
import { MediaPanel } from "./MediaPanel";
import { StylePanel } from "./StylePanel";

/**
 * Studio phase 3 on a phone (mockup p1/p2): the scenes as chips under the stage, one tap to
 * take one, and a sheet with Scenes, Media and Style. Below lg only; the desktop has the rails.
 */
type Sheet = "scenes" | "media" | "style";

export function PhoneStudio({ kit, onEditLayout, menu }: { kit: RoomKit; onEditLayout?: (sceneId: string) => void; menu?: ReactNode }) {
  const look = kit.look!;
  const [open, setOpen] = useState<Sheet | null>(null);
  const scenes = [...look.scenes].sort((a, b) => a.n - b.n);
  const onAir = sceneLive(look, kit.live)?.id;
  const next = kit.live.playing?.slot === "countdown" ? kit.live.playing.next : undefined;
  const tabs: { id: Sheet; label: string; icon: JSX.Element }[] = [
    { id: "scenes", label: "Scenes", icon: <Layers className="h-4 w-4" /> },
    { id: "media", label: "Media", icon: <Clapperboard className="h-4 w-4" /> },
    { id: "style", label: "Style", icon: <Palette className="h-4 w-4" /> },
  ];
  return (
    <div className="mt-3 w-full max-w-[768px] shrink-0 lg:hidden" data-testid="phone-studio">
      <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Scenes">
        {scenes.map((s) => {
          const on = s.id === onAir;
          return (
            <button key={s.id} type="button" role="listitem" onClick={() => kit.toScene(s.id)} aria-pressed={on} className={`flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-bold ${on ? "bg-[#053877] text-white" : s.id === next ? "border-2 border-[#F0A71F] bg-white text-[#101828]" : "border border-[#d0d5dd] bg-white text-[#344054]"}`} data-testid={`scene-chip-${s.n}`}>
              <span className={`text-[11px] ${on ? "text-white/70" : "text-[#98a2b3]"}`}>{s.n}</span>{s.name}
            </button>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {tabs.map((t) => <button key={t.id} type="button" onClick={() => setOpen(t.id)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#d0d5dd] bg-white text-[13px] font-semibold text-[#344054]" data-testid={`phone-open-${t.id}`}>{t.icon}{t.label}</button>)}
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setOpen(null)}>
          <div className="flex max-h-[82dvh] flex-col rounded-t-2xl bg-white shadow-[0_-12px_32px_rgba(16,24,40,0.2)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tabs.find((t) => t.id === open)!.label} data-testid="phone-sheet">
            <div className="flex items-center gap-1 border-b border-[#eaecf0] px-3 py-2">
              {tabs.map((t) => <button key={t.id} type="button" onClick={() => setOpen(t.id)} aria-current={open === t.id ? "page" : undefined} className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] ${open === t.id ? "bg-[#eef3fb] font-bold text-[#053877]" : "font-semibold text-[#667085]"}`}>{t.icon}{t.label}</button>)}
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-[#667085]"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {open === "scenes" && <ScenesPanel kit={kit} v3 sheet menu={menu} onEditLayout={onEditLayout ? (id) => { setOpen(null); onEditLayout(id); } : undefined} />}
              {open === "media" && <MediaPanel kit={kit} />}
              {open === "style" && <StylePanel kit={kit} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
