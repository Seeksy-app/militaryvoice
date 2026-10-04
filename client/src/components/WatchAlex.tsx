import { useEffect, useRef, useState } from "react";
import { ThumbsUp, Send, X, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/** What Alex says now and then, popping up beside the show. */
const NUDGES = [
  "Hope you're enjoying the show! Give us a thumbs up 👍",
  "Today is National Military Podcast Day. Thank you for being here.",
  "Got a question about today's lineup? Ask me right here.",
  "Know someone who'd love this? Share militaryvoices.ai/watch",
  "Every show today is a veteran, a service member or a military family, in their own words.",
];

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Alex beside the stage on the watch page. Open: her face, a line now and
 * then, a thumbs up with the day's count, and her chat right in the panel.
 * Closed: just her face in the corner, so the show gets the whole width, and
 * her line still pops up beside it every few minutes.
 */
export function WatchAlex({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [pop, setPop] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = () => void fetch("/api/public/thumbs").then((r) => r.json()).then((j) => setCount(j.count)).catch(() => {});
    load();
    const poll = setInterval(load, 60_000);
    // The first line 20 seconds in, then a new one every four minutes.
    const first = setTimeout(() => setPop(true), 20_000);
    const cycle = setInterval(() => { setI((n) => (n + 1) % NUDGES.length); setPop(true); }, 240_000);
    return () => { clearInterval(poll); clearTimeout(first); clearInterval(cycle); };
  }, []);
  // Open: a little bob. Closed: the line shows beside her face for 12 seconds.
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(false), open ? 1200 : 12_000);
    return () => clearTimeout(t);
  }, [pop, i, open]);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, busy]);

  const thumbsUp = async () => {
    setLiked(true);
    const r = await fetch("/api/public/thumbs", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.count != null) setCount(r.count);
    setTimeout(() => setLiked(false), 1500);
  };
  const ask = async () => {
    const text = q.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setQ("");
    setBusy(true);
    try {
      const r = (await (await apiRequest("POST", "/api/help/chat", { messages: next, page: "/watch" })).json()) as { text: string };
      setMsgs((m) => [...m, { role: "assistant", content: r.text }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "I couldn't answer that just now. Try again in a moment." }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="fixed bottom-5 right-5 z-50 flex items-end gap-2" data-testid="watch-alex-closed">
        {pop && (
          <button type="button" onClick={onOpen} className="mb-2 max-w-[16rem] rounded-2xl rounded-br-sm bg-white px-3.5 py-2.5 text-left text-sm leading-snug text-[#0b1630] shadow-xl animate-in fade-in slide-in-from-bottom-2" data-testid="watch-alex-pop">
            {NUDGES[i]}
          </button>
        )}
        <button type="button" onClick={onOpen} className="relative h-14 w-14 shrink-0 rounded-full shadow-xl ring-2 ring-[#F0A71F] transition-transform hover:scale-105" aria-label="Open Alex" data-testid="watch-alex-open">
          <img src="/alex.jpg" alt="" className="h-full w-full rounded-full object-cover object-[50%_25%]" />
        </button>
      </div>
    );
  }

  return (
    <aside className="flex max-h-[min(80vh,46rem)] flex-col gap-3 rounded-2xl border border-white/12 bg-white/[0.04] p-4 text-white" data-testid="watch-alex">
      <div className="flex items-center gap-3">
        <img src="/alex.jpg" alt="" className="h-14 w-14 shrink-0 rounded-full object-cover object-[50%_25%] ring-2 ring-[#F0A71F]" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-semibold">Alex</p>
          <p className="text-xs text-white/60">Your co-host today</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close Alex (bigger picture)" title="Close for a bigger picture" data-testid="watch-alex-close"><X className="h-4 w-4" /></button>
      </div>
      <div className={`relative rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-snug text-[#0b1630] shadow-lg transition-transform duration-300 ${pop ? "-translate-y-1 scale-[1.03]" : ""}`} aria-live="polite" data-testid="watch-alex-line">
        {NUDGES[i]}
      </div>
      <button
        type="button"
        onClick={() => void thumbsUp()}
        className={`flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${liked ? "bg-[#F0A71F] text-[#1a1200]" : "bg-white/10 hover:bg-white/15"}`}
        data-testid="watch-thumbs"
      >
        <ThumbsUp className={`h-4 w-4 ${liked ? "fill-current" : ""}`} /> Thumbs up{count != null && count > 0 ? ` · ${count.toLocaleString("en-US")}` : ""}
      </button>
      {(msgs.length > 0 || busy) && (
        <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-sm leading-snug" data-testid="watch-alex-chat">
          {msgs.map((m, k) => (
            <p key={k} className={m.role === "user" ? "ml-6 rounded-2xl rounded-br-sm bg-[#053877] px-3 py-2" : "mr-4 whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white/10 px-3 py-2 text-white/90"}>{m.content}</p>
          ))}
          {busy && <p className="mr-4 flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-white/70"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Alex is typing…</p>}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="flex items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Alex anything" maxLength={500} className="h-10 min-w-0 flex-1 rounded-full bg-black/30 px-4 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#F0A71F]/50" data-testid="watch-alex-input" />
        <button type="submit" disabled={busy || !q.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#000741] disabled:opacity-50" aria-label="Ask Alex"><Send className="h-4 w-4" /></button>
      </form>
    </aside>
  );
}
