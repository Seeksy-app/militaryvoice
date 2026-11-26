import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { LIMITS, newId, type Banner, type RoomKit } from "./look";
import { Select } from "./Select";

/**
 * Banners (Studio v2, Andrew, 26 Nov: "StreamYard has it right… you click on banners, that pops open, and then it has an
 * option of 'scroll across the ticker'"). One list: click a banner to put it on stage, click it again to take it off.
 * A ticker banner scrolls across the bottom through every scene (the old Scrolling banner card); the others sit still,
 * for their timer or until clicked off. One ticker runs at a time.
 */
const TIMERS = [0, 10, 30, 60];
const timerLabel = (s: number) => (s === 0 ? "Off" : s === 60 ? "1 min" : `${s} sec`);

export function BannersPanel({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const banners = look.banners;
  const tick = kit.live.ticker;
  const [text, setText] = useState("");
  const [scroll, setScroll] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const max = scroll ? LIMITS.tickerText : LIMITS.bannerText;

  // The scrolling line from before this panel (the old Scrolling banner card) joins the list as a ticker banner.
  const moved = useRef("");
  useEffect(() => {
    const t = tick?.text;
    if (!t || moved.current === t || banners.some((b) => b.ticker && b.text === t) || banners.length >= LIMITS.banners) return;
    moved.current = t;
    kit.change((l) => ({ ...l, banners: [...l.banners, { id: newId(), text: t.slice(0, LIMITS.tickerText), seconds: 0, ticker: true }] }));
  }, [tick?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const onStage = (b: Banner) => (b.ticker ? !!tick?.on && tick.text === b.text : kit.live.showing?.bannerId === b.id);
  const toggle = (b: Banner) => {
    if (b.ticker) kit.setTicker(b.text, !onStage(b));
    else kit.showBanner(onStage(b) ? null : b.id);
  };
  const remove = (b: Banner) => {
    if (!window.confirm("Delete this banner?")) return;
    if (onStage(b)) toggle(b);
    kit.change((l) => ({ ...l, banners: l.banners.filter((x) => x.id !== b.id) }));
  };
  const clean = text.replace(/\s+/g, " ").trim().slice(0, max);
  const add = () => {
    if (!clean) return;
    kit.change((l) => ({ ...l, banners: [...l.banners, { id: newId(), text: clean, seconds: scroll ? 0 : seconds, ...(scroll ? { ticker: true } : {}) }] }));
    setText(""); setScroll(false); setSeconds(0);
  };
  const cancel = () => { setText(""); setScroll(false); setSeconds(0); };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-5" data-testid="banners-panel">
      <p className="text-lg font-bold tracking-tight">Banners</p>
      <p className="mt-0.5 text-[13px] text-[#667085] [text-wrap:pretty]">Click one to show it on stage. Click it again to hide it.</p>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {banners.map((b) => {
          const on = onStage(b);
          return (
            <div key={b.id} className="group relative">
              <button type="button" onClick={() => toggle(b)} aria-pressed={on} title={b.text}
                className={`flex w-full items-start gap-2 rounded-[10px] text-left text-[13px] font-medium leading-snug ${on ? "border-2 border-[#053877] bg-[#f5f8fd] px-[9px] py-2" : "border border-[#e4e7ec] px-2.5 py-[9px] hover:border-[#98a2b3]"}`} data-testid="banner-row">
                <span className="line-clamp-2 min-w-0 flex-1 break-words">{b.text}</span>
                {on ? <span className="shrink-0 whitespace-nowrap rounded-full bg-[#053877] px-2 py-px text-[10.5px] font-bold text-white">On stage</span>
                  : b.ticker ? <span className="shrink-0 whitespace-nowrap rounded-full border border-[#e4e7ec] px-2 py-px text-[10.5px] font-bold text-[#667085]">Ticker</span>
                  : b.seconds ? <span className="shrink-0 whitespace-nowrap text-[11px] text-[#98a2b3]">{timerLabel(b.seconds)}</span> : null}
              </button>
              <button type="button" onClick={() => remove(b)} aria-label="Delete banner" className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-[#475467] shadow ring-1 ring-[#e4e7ec] hover:text-[#b42318] group-focus-within:flex group-hover:flex"><Trash2 className="h-3 w-3" /></button>
            </div>
          );
        })}
      </div>

      {banners.length < LIMITS.banners ? (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-3.5 rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3" data-testid="banner-form">
          <div className="relative">
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, max))} rows={3} placeholder="Enter a banner…" aria-label="Banner text"
              className="block w-full resize-none rounded-lg border border-[#d0d5dd] bg-white px-2.5 pb-5 pt-2 text-[13px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="banner-text" />
            <span className="pointer-events-none absolute bottom-1.5 right-2 text-[11px] tabular-nums text-[#98a2b3]">{text.length}/{max}</span>
          </div>
          <label className="mt-2.5 flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={scroll} onChange={(e) => setScroll(e.target.checked)} className="h-4 w-4 accent-[#053877]" data-testid="banner-ticker" />
            Scroll across (ticker)
          </label>
          {!scroll && (
            <div className="mt-2.5 flex items-center justify-between gap-2.5 text-[13px] font-medium">
              <span>Timer</span>
              <Select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Timer" wrap="shrink-0" className="h-8 rounded-lg border border-[#d0d5dd] bg-white pl-2.5 text-[12.5px] font-semibold" data-testid="banner-timer">
                {TIMERS.map((s) => <option key={s} value={s}>{timerLabel(s)}</option>)}
              </Select>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancel} className="h-[34px] rounded-lg border border-[#d0d5dd] bg-white px-3.5 text-[13px] font-bold text-[#344054] hover:bg-[#f9fafb]">Cancel</button>
            <button type="submit" disabled={!clean} className="h-[34px] rounded-lg bg-[#053877] px-3.5 text-[13px] font-bold text-white disabled:opacity-50" data-testid="banner-add">Add banner</button>
          </div>
        </form>
      ) : <p className="mt-3 text-xs text-[#667085]">You have {LIMITS.banners} banners. Delete one to add another.</p>}
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#667085] [text-wrap:pretty]">Timer hides the banner on its own after 10 seconds, 30 seconds or 1 minute.</p>
    </div>
  );
}
