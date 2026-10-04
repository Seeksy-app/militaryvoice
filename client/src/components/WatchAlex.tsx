import { useEffect, useState } from "react";
import { ThumbsUp, Send } from "lucide-react";

/** What Alex says now and then, popping up beside the show. */
const NUDGES = [
  "Hope you're enjoying the show! Give us a thumbs up 👍",
  "Today is National Military Podcast Day. Thank you for being here.",
  "Got a question about today's lineup? Ask me right here.",
  "Know someone who'd love this? Share militaryvoices.ai/watch",
  "Every show today is a veteran, a service member or a military family, in their own words.",
];

/**
 * Alex beside the stage on the watch page: her face, a line now and then
 * (a nudge pops up every few minutes), a thumbs up with the day's count, and
 * a box that opens her chat with the question already typed.
 */
export function WatchAlex() {
  const [i, setI] = useState(0);
  const [pop, setPop] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    void fetch("/api/public/thumbs").then((r) => r.json()).then((j) => setCount(j.count)).catch(() => {});
    const poll = setInterval(() => void fetch("/api/public/thumbs").then((r) => r.json()).then((j) => setCount(j.count)).catch(() => {}), 60_000);
    // The first line 20 seconds in, then a new one every four minutes, each bobbing up.
    const first = setTimeout(() => setPop(true), 20_000);
    const cycle = setInterval(() => { setI((n) => (n + 1) % NUDGES.length); setPop(true); }, 240_000);
    return () => { clearInterval(poll); clearTimeout(first); clearInterval(cycle); };
  }, []);
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(false), 1200);
    return () => clearTimeout(t);
  }, [pop, i]);

  const thumbsUp = async () => {
    setLiked(true);
    const r = await fetch("/api/public/thumbs", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.count != null) setCount(r.count);
    setTimeout(() => setLiked(false), 1500);
  };
  const ask = () => {
    window.dispatchEvent(new CustomEvent("mv:ask-alex", { detail: { question: q.trim() } }));
    setQ("");
  };

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-white/12 bg-white/[0.04] p-4 text-white" data-testid="watch-alex">
      <div className="flex items-center gap-3">
        <img src="/alex.jpg" alt="" className="h-14 w-14 shrink-0 rounded-full object-cover object-[50%_25%] ring-2 ring-[#F0A71F]" />
        <div className="min-w-0 leading-tight">
          <p className="font-semibold">Alex</p>
          <p className="text-xs text-white/60">Your co-host today</p>
        </div>
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
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Alex anything" maxLength={300} className="h-10 min-w-0 flex-1 rounded-full bg-black/30 px-4 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#F0A71F]/50" data-testid="watch-alex-input" />
        <button type="submit" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#000741]" aria-label="Ask Alex"><Send className="h-4 w-4" /></button>
      </form>
    </aside>
  );
}
