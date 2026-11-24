import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

/**
 * "A new version is ready" (Andrew via PM, 24 Nov: his studio tab was still on the old code). Every
 * 5 minutes, and when the tab comes back into view, this reads which bundle the site serves now; when
 * it isn't the one this page loaded, a quiet bar offers Reload. It never reloads by itself. While
 * `busy` (recording or live) it only says to reload after the show, with no button to press by mistake.
 *
 * Never mount this on a filmed page (RoomComposite, the broadcast composite): viewers would see it.
 */
const EVERY = 5 * 60_000;
const BUNDLE = /\/assets\/index-[\w-]+\.js/;

function loaded(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? (s.src.match(BUNDLE)?.[0] ?? null) : null;
}

export function NewVersionBar({ busy = false, afterLine = "Reload after your show." }: { busy?: boolean; afterLine?: string }) {
  const [fresh, setFresh] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const mine = loaded();
    if (!mine) return; // dev server: no bundle to compare
    let last = 0;
    let stop = false;
    const check = async () => {
      if (stop || Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const html = await (await fetch("/", { cache: "no-store", credentials: "same-origin" })).text();
        const now = html.match(BUNDLE)?.[0];
        if (!stop && now && now !== mine) setFresh(true);
      } catch { /* offline: try next time */ }
    };
    const t = window.setInterval(() => void check(), EVERY);
    const seen = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", seen);
    return () => { stop = true; window.clearInterval(t); document.removeEventListener("visibilitychange", seen); };
  }, []);
  if (!fresh || hidden) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[80] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-[#d0d5dd] bg-white py-2 pl-4 pr-2 text-[13px] text-[#344054] shadow-[0_8px_24px_rgba(16,24,40,0.14)]" data-testid="new-version-bar">
      <span><span className="font-semibold text-[#101828]">A new version is ready.</span>{busy && <> {afterLine}</>}</span>
      {!busy && <button type="button" onClick={() => window.location.reload()} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#053877] px-3 text-[12px] font-bold text-white" data-testid="new-version-reload"><RefreshCw className="h-3.5 w-3.5" /> Reload</button>}
      <button type="button" onClick={() => setHidden(true)} aria-label="Not now" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#667085] hover:bg-[#f2f4f7]"><X className="h-4 w-4" /></button>
    </div>
  );
}
