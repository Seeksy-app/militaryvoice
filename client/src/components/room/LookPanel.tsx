import { useRef, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BACKGROUNDS, LIMITS, backgroundShelf, newId, type Asset, type AssetKind, type RoomKit } from "./look";

/**
 * "Your look" (mockup v8): the logo and its corner, banners to show on air, and the
 * background. Every change shows on the stage at once and saves a moment later.
 */
const label = "mt-6 text-xs font-bold uppercase tracking-[0.06em] text-[#667085]";

export function LookPanel({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const bg = look.background;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-5" data-testid="look-panel">
      <p className="text-lg font-bold tracking-tight">Your look</p>
      <p className="mt-0.5 text-[13px] text-[#667085]">Changes show on the stage right away.</p>

      <p className={label}>Logo</p>
      <LogoSection kit={kit} />

      <p className={label}>Banners</p>
      <Banners kit={kit} />

      <p className={label}>Background</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {(["blue", "dark", "light"] as const).map((c) => (
          <Swatch key={c} on={bg.kind === "color" && bg.value === c} onClick={() => kit.change((l) => ({ ...l, background: { kind: "color", value: c } }))} label={c[0].toUpperCase() + c.slice(1)} className="h-11 w-16" style={{ background: BACKGROUNDS[c] }} />
        ))}
        {backgroundShelf(look).map((a) => (
          <Removable key={a.id} onRemove={() => { if (window.confirm("Delete this picture?")) void kit.removeAsset("background", a.id); }}>
            <Swatch on={bg.kind === "image" && bg.asset.id === a.id} onClick={() => kit.change((l) => ({ ...l, background: { kind: "image", asset: a } }))} label={`Use ${a.name || "this picture"}`} className="h-11 w-16" style={{ background: `center / cover url("${a.url}")` }} />
          </Removable>
        ))}
        {backgroundShelf(look).length < LIMITS.backgrounds && <AddFile kind="background" accept="image/png,image/jpeg,image/webp" kit={kit} label="Add a picture" className="h-11 w-11" />}
      </div>
    </div>
  );
}

/** The logo and its corner (Your look, and Media in v3). */
export function LogoSection({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  return (
    <>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Swatch on={!look.logo} onClick={() => kit.change((l) => ({ ...l, logo: null }))} label="No logo" className="bg-[#f5f6fa] text-xs font-semibold text-[#667085]">None</Swatch>
        {look.logos.map((a) => (
          <Removable key={a.id} onRemove={() => { if (window.confirm("Delete this logo?")) void kit.removeAsset("logo", a.id); }}>
            <Swatch on={look.logo?.asset.id === a.id} onClick={() => kit.change((l) => ({ ...l, logo: { asset: a, corner: l.logo?.corner ?? "tr" } }))} label={`Use ${a.name || "this logo"}`} className="bg-[#0b1f4a]">
              <img src={a.url} alt="" className="max-h-[42px] max-w-[60px] object-contain" />
            </Swatch>
          </Removable>
        ))}
        {look.logos.length < LIMITS.logos && <AddFile kind="logo" accept="image/png,image/svg+xml,image/jpeg,image/webp" kit={kit} label="Add a logo" className="h-14 w-14" />}
      </div>
      {look.logo && (
        <div className="mt-3 flex items-center gap-2.5 text-[13px] text-[#475467]">
          Corner
          {(["tl", "tr"] as const).map((c) => (
            <button key={c} type="button" aria-label={c === "tl" ? "Top left" : "Top right"} title={c === "tl" ? "Top left" : "Top right"} aria-pressed={look.logo?.corner === c} onClick={() => kit.change((l) => ({ ...l, logo: l.logo ? { ...l.logo, corner: c } : null }))} className={`relative h-7 w-[38px] rounded-[7px] ${look.logo?.corner === c ? "border-2 border-[#053877] bg-[#eef3fb]" : "border border-[#d0d5dd] bg-white"}`}>
              <span className={`absolute top-1 h-1.5 w-2.5 rounded-sm ${look.logo?.corner === c ? "bg-[#053877]" : "bg-[#98a2b3]"} ${c === "tl" ? "left-1" : "right-1"}`} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function Swatch({ on, onClick, label: l, className = "", style, children }: { on: boolean; onClick: () => void; label: string; className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={l} title={l} aria-pressed={on} style={style} className={`flex h-14 w-[72px] items-center justify-center rounded-[10px] ${on ? "border-2 border-[#053877] ring-2 ring-[#053877]/15" : "border border-[#e4e7ec]"} ${className}`}>{children}</button>
  );
}

export function Removable({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="group relative">
      {children}
      <button type="button" onClick={onRemove} aria-label="Delete" className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-[#475467] shadow ring-1 ring-[#e4e7ec] hover:text-[#b42318] group-hover:flex"><X className="h-3 w-3" /></button>
    </div>
  );
}

export function AddFile({ kind, accept, kit, label: l, className, onAdded }: { kind: AssetKind; accept: string; kit: RoomKit; label: string; className: string; onAdded?: (a: Asset) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const pick = async (f?: File) => {
    if (!f) return;
    setPct(0);
    try { const a = await kit.addAsset(kind, f, setPct); onAdded?.(a); }
    catch (e) { toast({ title: "Couldn't add that file", description: (e as Error).message, variant: "destructive" }); }
    finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} aria-label={l} title={l} className={`flex items-center justify-center rounded-[10px] border border-dashed border-[#98a2b3] bg-white text-[#667085] hover:bg-[#f9fafb] disabled:opacity-70 ${className}`} data-testid={`add-${kind}`}>
        {pct !== null ? <span className="flex flex-col items-center text-[10px] font-semibold"><Loader2 className="h-4 w-4 animate-spin" />{pct}%</span> : <Plus className="h-5 w-5" />}
      </button>
    </>
  );
}

const SECONDS = [6, 10, 15, 30, 60];
const secLabel = (s: number) => `Shows ${s} seconds`;

export function Banners({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(6);
  const save = () => {
    const t = text.trim();
    if (!t) return;
    kit.change((l) => ({ ...l, banners: [...l.banners, { id: newId(), text: t.slice(0, LIMITS.bannerText), seconds }] }));
    setText(""); setAdding(false);
  };
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {look.banners.map((b) => {
        const on = kit.live.showing?.bannerId === b.id;
        return (
          <div key={b.id} className={`group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${on ? "border-[#053877] bg-[#f5f8fd]" : "border-[#e4e7ec]"}`} data-testid="banner-row">
            <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-sm font-semibold">{b.text}</p><p className="text-xs text-[#667085]">{on ? "On screen now" : secLabel(b.seconds)}</p></div>
            <button type="button" onClick={() => { if (!window.confirm("Delete this banner?")) return; if (on) kit.showBanner(null); kit.change((l) => ({ ...l, banners: l.banners.filter((x) => x.id !== b.id) })); }} aria-label="Delete banner" className="text-[#98a2b3] opacity-0 hover:text-[#b42318] focus:opacity-100 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => kit.showBanner(on ? null : b.id)} className={`h-[34px] rounded-[9px] px-4 text-[13px] font-bold ${on ? "bg-[#053877] text-white" : "border border-[#053877] bg-white text-[#053877]"}`}>{on ? "Hide" : "Show"}</button>
          </div>
        );
      })}
      {adding ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value.slice(0, LIMITS.bannerText))} placeholder="e.g. Follow us everywhere: @yourshow" className="h-10 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm outline-none focus:border-[#053877]" aria-label="Banner text" />
          <div className="mt-2 flex items-center gap-2">
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="How long it shows" className="h-9 flex-1 rounded-lg border border-[#d0d5dd] bg-white px-2 text-[13px]">
              {SECONDS.map((s) => <option key={s} value={s}>{s === 60 ? "1 minute" : `${s} seconds`}</option>)}
            </select>
            <button type="submit" disabled={!text.trim()} className="h-9 rounded-lg bg-[#053877] px-3.5 text-[13px] font-bold text-white disabled:opacity-50">Add</button>
            <button type="button" onClick={() => setAdding(false)} className="h-9 px-2 text-[13px] font-semibold text-[#475467]">Cancel</button>
          </div>
          <p className="mt-1.5 text-right text-[11px] text-[#98a2b3]">{text.length}/{LIMITS.bannerText}</p>
        </form>
      ) : look.banners.length < LIMITS.banners && (
        <button type="button" onClick={() => setAdding(true)} className="h-10 rounded-xl border border-dashed border-[#98a2b3] bg-white text-[13px] font-semibold text-[#475467] hover:bg-[#f9fafb]" data-testid="banner-add">+ New banner</button>
      )}
    </div>
  );
}
