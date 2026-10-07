import { useEffect, useState } from "react";
import { Check, Loader2, Search, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

// At sign-up (7 Oct): "Is your podcast out yet?" Yes: type its name and pick
// it from Apple Podcasts' directory, which fills in the show and its feed. Not
// yet: give it a working title, and free hosting is the next step. Nobody has
// to know what an RSS link is.

type Found = { title: string; host: string; rss: string; image: string; apple: string; episodes: number };

export function ShowFinder({ onPick, onStarting }: {
  onPick: (s: Found | null) => void;
  onStarting: (starting: boolean) => void;
}) {
  const [mode, setMode] = useState<"" | "out" | "starting">("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Found | null>(null);

  // Search as they type, once they pause.
  useEffect(() => {
    if (mode !== "out" || picked || q.trim().length < 3) { setResults(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try { setResults((await (await apiRequest("GET", `/api/host/find-show?q=${encodeURIComponent(q.trim())}`)).json()) as Found[]); }
      catch { setResults([]); }
      setBusy(false);
    }, 450);
    return () => clearTimeout(t);
  }, [q, mode, picked]);

  const choose = (m: "out" | "starting") => {
    setMode(m);
    onStarting(m === "starting");
    if (m === "starting") { setPicked(null); onPick(null); }
  };

  return (
    <div className="space-y-3" data-testid="show-finder">
      <p className="text-sm font-medium">Is your podcast out yet?</p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Is your podcast out yet">
        {([["out", "Yes, it's out", "Find it by name"], ["starting", "Not yet", "I'm starting one"]] as const).map(([k, l, sub]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => choose(k)}
            className={`rounded-xl border-2 px-3.5 py-2.5 text-left text-sm transition ${mode === k ? "border-[#053877] bg-[#053877]/[0.06] font-semibold" : "border-border hover:border-[#053877]/40"}`} data-testid={`show-${k}`}>
            {l}<span className="block text-xs font-normal text-muted-foreground">{sub}</span>
          </button>
        ))}
      </div>

      {mode === "out" && !picked && (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your show's name" className="h-11 pl-9" data-testid="show-search" />
            {busy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {results && (
            <ul className="mt-2 max-h-72 divide-y divide-border overflow-auto rounded-xl border border-border bg-card">
              {results.map((r) => (
                <li key={r.rss}>
                  <button type="button" onClick={() => { setPicked(r); onPick(r); }} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted" data-testid="show-result">
                    {r.image ? <img src={r.image} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-md bg-muted" />}
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.title}</span><span className="block truncate text-xs text-muted-foreground">{r.host}{r.episodes ? ` · ${r.episodes} episodes` : ""}</span></span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">Not finding it? Just type its name below.</li>}
            </ul>
          )}
        </div>
      )}

      {mode === "out" && picked && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-600/30 bg-emerald-50 p-3 dark:bg-emerald-500/10" data-testid="show-picked">
          {picked.image && <img src={picked.image} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />}
          <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm font-semibold"><Check className="h-4 w-4 text-emerald-600" /> {picked.title}</span><span className="block truncate text-xs text-muted-foreground">{picked.host}{picked.episodes ? ` · ${picked.episodes} episodes` : ""} · its episodes go on your card</span></span>
          <button type="button" onClick={() => { setPicked(null); onPick(null); }} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Pick a different show"><X className="h-4 w-4" /></button>
        </div>
      )}

      {mode === "starting" && (
        <p className="flex items-start gap-2 rounded-xl bg-[#F0A71F]/10 p-3 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#8a5a00] dark:text-[#F0A71F]" /> Good. Give it a working title below. Next, we'll set up free hosting so it's on Apple, Spotify and every other app.</p>
      )}
    </div>
  );
}
