import { FONTS, STYLE_DEFAULT, type RoomKit, type Style } from "./look";
import { Select } from "./Select";

/**
 * Style (Studio phase 3, mockup approved 21 Nov): one style for the whole studio. A preset,
 * your brand colour, how name tags look, show names or not, text size and a font
 * (a short hosted list, OFL only). It shows on the stage, the recording and the live show.
 */
const label = "mt-6 text-xs font-bold uppercase tracking-[0.06em] text-[#667085]";

/** A preset sets the colour and the name tag in one press; both can be changed after. */
const PRESETS: { id: string; name: string; bg: string; brandColor: string; nameTag: Style["nameTag"] }[] = [
  { id: "classic", name: "Navy", bg: "linear-gradient(135deg,#0b1f4a,#3b6fd6)", brandColor: "#F0A71F", nameTag: "bar" },
  { id: "night", name: "Night", bg: "#101828", brandColor: "#7C9CFF", nameTag: "pill" },
  { id: "light", name: "Light", bg: "#e8eef7", brandColor: "#053877", nameTag: "block" },
  { id: "field", name: "Field", bg: "linear-gradient(135deg,#2f3b1f,#6b7d3a)", brandColor: "#D9C27A", nameTag: "plain" },
];
const COLORS = ["#F0A71F", "#D92D20", "#12B76A", "#2E90FA", "#7C9CFF", "#053877", "#FFFFFF"];
const TAGS: { id: Style["nameTag"]; name: string }[] = [{ id: "bar", name: "Bar" }, { id: "pill", name: "Pill" }, { id: "block", name: "Block" }, { id: "plain", name: "Plain" }];

export function StylePanel({ kit }: { kit: RoomKit }) {
  const style = { ...STYLE_DEFAULT, ...kit.look!.style };
  const set = (p: Partial<Style>) => kit.change((l) => ({ ...l, style: { ...STYLE_DEFAULT, ...l.style, ...p } }));
  const seg = (on: boolean) => `h-9 flex-1 rounded-lg text-[13px] font-semibold ${on ? "border-2 border-[#053877] bg-[#eef3fb] text-[#053877]" : "border border-[#e4e7ec] bg-white text-[#344054] hover:border-[#98a2b3]"}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-5" data-testid="style-panel">
      <p className="text-lg font-bold tracking-tight">Style</p>
      <p className="mt-0.5 text-[13px] text-[#667085]">One style for every scene, the recording and the live show.</p>

      <p className={label}>Start from</p>
      <div className="mt-2.5 grid grid-cols-4 gap-2">
        {PRESETS.map((p) => {
          const on = style.preset === p.id;
          return (
            <button key={p.id} type="button" onClick={() => set({ preset: p.id, brandColor: p.brandColor, nameTag: p.nameTag })} aria-pressed={on} className="text-center" data-testid={`style-preset-${p.id}`}>
              <span className={`relative block h-12 rounded-[10px] ${on ? "ring-2 ring-[#053877] ring-offset-2" : "border border-[#e4e7ec]"}`} style={{ background: p.bg }}>
                <span className="absolute bottom-1.5 left-1.5 h-2 w-8 rounded-sm" style={{ background: p.brandColor }} />
              </span>
              <span className={`mt-1 block text-[12px] ${on ? "font-bold text-[#053877]" : "font-semibold text-[#475467]"}`}>{p.name}</span>
            </button>
          );
        })}
      </div>

      <p className={label}>Brand colour</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="style-color">
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => set({ brandColor: c })} aria-label={`Colour ${c}`} aria-pressed={style.brandColor === c} className={`h-8 w-8 rounded-full ${style.brandColor === c ? "ring-2 ring-[#053877] ring-offset-2" : "ring-1 ring-[#d0d5dd]"}`} style={{ background: c }} />
        ))}
        <label className="flex h-8 items-center gap-1.5 rounded-lg border border-[#d0d5dd] bg-white pl-1 pr-2 text-[12px] font-semibold text-[#475467]">
          <input type="color" value={style.brandColor} onChange={(e) => set({ brandColor: e.target.value.toUpperCase() })} className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Pick any colour" />
          {style.brandColor}
        </label>
      </div>

      <p className={label}>Name tags</p>
      <div className="mt-2.5 grid grid-cols-4 gap-2" data-testid="style-nametag">
        {TAGS.map((t) => {
          const on = style.nameTag === t.id;
          return (
            <button key={t.id} type="button" onClick={() => set({ nameTag: t.id })} aria-pressed={on} className={`flex h-14 flex-col items-center justify-center gap-1 rounded-[10px] bg-[#16264a] ${on ? "ring-2 ring-[#053877] ring-offset-2" : ""}`}>
              <Tag kind={t.id} color={style.brandColor} />
              <span className="text-[11px] font-semibold text-white/85">{t.name}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-3 flex items-center justify-between text-[13px] font-semibold text-[#344054]">
        Show names on screen
        <button type="button" role="switch" aria-checked={style.showNames} onClick={() => set({ showNames: !style.showNames })} className={`relative h-6 w-11 rounded-full transition-colors ${style.showNames ? "bg-[#053877]" : "bg-[#d0d5dd]"}`} data-testid="style-shownames">
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${style.showNames ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </label>

      <p className={label}>Text size</p>
      <div className="mt-2.5 flex gap-2" role="radiogroup" aria-label="Text size">
        {(["s", "m", "l"] as const).map((z) => <button key={z} type="button" role="radio" aria-checked={style.textSize === z} onClick={() => set({ textSize: z })} className={seg(style.textSize === z)}>{z === "s" ? "Small" : z === "m" ? "Medium" : "Large"}</button>)}
      </div>

      <p className={label}>Font</p>
      <Select value={String(style.font) === "Roboto Slab" ? "Zilla Slab" : style.font} onChange={(e) => set({ font: e.target.value as Style["font"] })} aria-label="Font" wrap="mt-2.5" className="h-10 rounded-lg border border-[#d0d5dd] bg-white pl-3 text-sm" data-testid="style-font">
        {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
      </Select>
    </div>
  );
}

/** A tiny drawing of each name-tag style. */
function Tag({ kind, color }: { kind: Style["nameTag"]; color: string }) {
  if (kind === "bar") return <span className="flex h-3.5 w-14 overflow-hidden rounded-sm"><span className="w-1" style={{ background: color }} /><span className="flex-1 bg-white/90" /></span>;
  if (kind === "pill") return <span className="h-3.5 w-14 rounded-full bg-white/90" style={{ boxShadow: `inset 0 0 0 2px ${color}` }} />;
  if (kind === "block") return <span className="h-3.5 w-14 rounded-sm" style={{ background: color }} />;
  return <span className="h-1.5 w-12 rounded-sm bg-white/90" />;
}
