import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Upload, Loader2, Download, Bookmark, X, Sparkles, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// Enrich: bring your own names. A brand arrives with a spreadsheet of handles
// from last year's campaign, a podcaster with a guest list of emails; paste it
// or drop the file, and every row comes back as a creator we can open, save
// and export. Ten at a time with a progress bar, so a long sheet is a wait you
// can watch, stop and resume, not one request that times out at row 400.

export type EnrichCard = {
  platform: string; handle: string; name: string; picture: string; followers: number | null; engagement: number | null; branch: string;
  verified?: { show: string; host: string; serviceStatus: string; slotLabel: string } | null; signupId?: number;
};
type Row = {
  input: string; kind?: "handle" | "email"; status: "found" | "not_found" | "invalid" | "error" | "limit" | "pending"; message?: string; free?: boolean;
  card?: EnrichCard;
  extra?: { bio: string; posts: number | null; lastPostAt: string | null; postsPerWeek: number | null; verifiedAccount: boolean; category: string; country: string };
};

const PLATFORMS = [
  { v: "instagram", label: "Instagram" },
  { v: "youtube", label: "YouTube" },
  { v: "tiktok", label: "TikTok" },
  { v: "twitter", label: "X" },
  { v: "twitch", label: "Twitch" },
];
const BATCH = 10;
const MAX_ROWS = 1000;
const KEEP = "mv_enrich_rows";

const compact = (n: number | null | undefined) =>
  n == null ? "–" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(Math.round(n));
const since = (s: string | null | undefined) => {
  if (!s || !Number.isFinite(Date.parse(s))) return "–";
  const d = Math.round((Date.now() - Date.parse(s)) / 86_400_000);
  return d <= 0 ? "today" : d < 14 ? `${d}d ago` : d < 60 ? `${Math.round(d / 7)}w ago` : `${Math.round(d / 30)}mo ago`;
};
const label = (p: string) => PLATFORMS.find((x) => x.v === p)?.label ?? p;
const profileUrl = (c: Pick<EnrichCard, "platform" | "handle">) =>
  c.platform === "youtube" ? `https://youtube.com/@${c.handle}` : c.platform === "tiktok" ? `https://tiktok.com/@${c.handle}` : c.platform === "twitter" ? `https://x.com/${c.handle}` : c.platform === "twitch" ? `https://twitch.tv/${c.handle}` : `https://instagram.com/${c.handle}`;

/** One line of a CSV/TSV into cells, honouring quotes ("Zaccari, Frank" is one cell). */
function cellsOf(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\t" || ch === ";")) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const looksLike = (c: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c) || /^(https?:\/\/)?(www\.|m\.)?(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|x\.com|twitter\.com|twitch\.tv)\//i.test(c) || /^@[A-Za-z0-9._-]+$/.test(c);
const bareHandle = (c: string) => /^[A-Za-z0-9._-]{2,60}$/.test(c);

/**
 * Pull the lookups out of a pasted block or a spreadsheet: a named column if
 * there is one, else the cell on each row that looks like a handle, link or
 * email — so a sheet with names in column A still works.
 */
export function readLookups(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  let found: string[];
  const head = cellsOf(lines[0]).map((h) => h.toLowerCase());
  const col = head.findIndex((h) => /^(handle|handles|username|user ?name|instagram|youtube|tiktok|twitter|x|twitch|email|e-mail|email address|url|link|profile|profile url|social|account)$/.test(h));
  if (col >= 0) {
    found = lines.slice(1).map((l) => cellsOf(l)[col] ?? "");
  } else if (lines.length === 1) {
    // One line: a pasted run of handles, split on anything between them.
    found = lines[0].split(/[\s,;]+/);
  } else {
    found = lines.map((l) => {
      const c = cellsOf(l).filter(Boolean);
      return c.find(looksLike) ?? c.find(bareHandle) ?? "";
    });
  }
  return Array.from(new Set(found.map((x) => x.trim()).filter((x) => x && x.length < 200))).slice(0, MAX_ROWS);
}

function Face({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  if (!src || broken) return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-xs font-bold text-[#053877]">{initials}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-9 w-9 shrink-0 rounded-full object-cover" />;
}

export function DiscoverEnrich({ isMember, onJoin, onOpen, onSaveAll, lookups, onUsed }: {
  isMember: boolean;
  onJoin: () => void;
  onOpen: (c: EnrichCard) => void;
  onSaveAll: (cards: EnrichCard[]) => Promise<void>;
  lookups: { used: number; allowance: number } | null | undefined;
  onUsed: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [rows, setRows] = useState<Row[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEEP) ?? "[]");
    } catch {
      return [];
    }
  });
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const stop = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => readLookups(text), [text]);

  useEffect(() => {
    try {
      if (!running) sessionStorage.setItem(KEEP, JSON.stringify(rows.slice(0, MAX_ROWS)));
    } catch {
      /* private window: the table just won't survive a reload */
    }
  }, [rows, running]);

  const run = async () => {
    if (!isMember) return onJoin();
    if (!items.length) return;
    stop.current = false;
    setRunning(true);
    const start: Row[] = items.map((input) => ({ input, status: "pending" }));
    setRows(start);
    for (let i = 0; i < items.length && !stop.current; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/discover/enrich", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: chunk, platform }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.message ?? "Couldn't look these up.");
        setRows((prev) => {
          const next = [...prev];
          (j.rows as Row[]).forEach((r, k) => { next[i + k] = r ?? { input: chunk[k], status: "error", message: "No answer." }; });
          return next;
        });
        if ((j.rows as Row[]).some((r) => r?.status === "limit")) { stop.current = true; toast({ title: "Monthly look-ups used", description: "Creators we already know are still free. More next month." }); }
      } catch (e) {
        setRows((prev) => {
          const next = [...prev];
          chunk.forEach((input, k) => { next[i + k] = { input, status: "error", message: (e as Error).message }; });
          return next;
        });
      }
    }
    setRows((prev) => prev.filter((r) => r.status !== "pending" || !stop.current));
    setRunning(false);
    onUsed();
  };

  const done = rows.filter((r) => r.status !== "pending").length;
  const found = rows.filter((r) => r.status === "found" && r.card);
  const missing = rows.filter((r) => ["not_found", "invalid", "error", "limit"].includes(r.status));
  const free = found.filter((r) => r.free).length;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) return toast({ title: "That file is over 5 MB", description: "Export just the handle or email column and try again.", variant: "destructive" });
    const t = await f.text();
    const got = readLookups(t);
    setText(got.join("\n"));
    toast({ title: `${got.length} to look up`, description: `Read from ${f.name}.` });
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["input", "status", "platform", "handle", "name", "followers", "engagement_pct", "last_post", "posts_per_week", "category", "country", "on_militaryvoices", "profile_url", "bio"];
    const lines = rows.filter((r) => r.status !== "pending").map((r) => {
      const c = r.card;
      return [r.input, r.status === "found" ? "found" : r.message ?? r.status, c?.platform, c?.handle, c?.name, c?.followers, c?.engagement, r.extra?.lastPostAt?.slice(0, 10), r.extra?.postsPerWeek, r.extra?.category, r.extra?.country, c?.verified ? c.verified.show : "", c ? profileUrl(c) : "", r.extra?.bio].map(esc).join(",");
    });
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `enriched-creators-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await onSaveAll(found.map((r) => r.card!));
      toast({ title: `Saved ${found.length} creators`, description: "They're in your Saved list." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#b36b00]"><Sparkles className="h-3.5 w-3.5" /> Enrich</div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Bring your own list</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Handles, profile links or emails, one per line, or a spreadsheet. Each comes back with followers, engagement and how recently they post, and anyone on our lineup is marked.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              placeholder={"@frankzaccari\nhttps://www.instagram.com/courtneylwitucki\nhttps://youtube.com/@sgtmajmariopfields\nhost@theirshow.com"}
              className="mt-4 w-full resize-y rounded-2xl border border-border bg-background p-3 font-mono text-sm outline-none focus:border-[#053877]/50 focus:ring-2 focus:ring-[#053877]/15"
              data-testid="enrich-input"
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-border bg-muted/30 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bare handles are on</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" data-testid="enrich-platform">
                {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">Links and emails find their own platform.</span>
            </label>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => fileRef.current?.click()} data-testid="enrich-upload"><Upload className="h-4 w-4" /> Upload a CSV</Button>
            <div className="mt-auto">
              <div className="mb-2 text-sm"><span className="font-semibold tabular-nums">{items.length}</span> <span className="text-muted-foreground">to look up{items.length >= MAX_ROWS ? ` (first ${MAX_ROWS})` : ""}</span></div>
              {running ? (
                <Button variant="outline" className="w-full gap-2 rounded-xl" onClick={() => { stop.current = true; }} data-testid="enrich-stop"><X className="h-4 w-4" /> Stop</Button>
              ) : (
                <Button className="w-full rounded-xl bg-[#053877] font-semibold text-white hover:bg-[#0a4a99]" disabled={!items.length} onClick={() => void run()} data-testid="enrich-run">
                  {isMember ? "Enrich" : "Create a free account to enrich"}
                </Button>
              )}
              {lookups && <p className="mt-2 text-xs text-muted-foreground">{Math.max(0, lookups.allowance - lookups.used)} of {lookups.allowance} look-ups left this month. Creators we already know are free.</p>}
            </div>
          </div>
        </div>
        {(running || done > 0) && rows.length > 0 && (
          <div className="border-t border-border px-5 py-3 sm:px-6">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2">{running && <Loader2 className="h-4 w-4 animate-spin" />}{running ? `Looking up ${done} of ${rows.length}…` : `${found.length} found · ${missing.length} not found${free ? ` · ${free} already known, free` : ""}`}</span>
              <span className="tabular-nums text-muted-foreground">{Math.round((done / rows.length) * 100)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#F0A71F] transition-all" style={{ width: `${(done / rows.length) * 100}%` }} /></div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <h3 className="mr-auto font-semibold">Results</h3>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-full" disabled={running || !found.length || saving} onClick={() => void saveAll()} data-testid="enrich-save-all">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />} Save all {found.length || ""}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-full" disabled={running || !done} onClick={exportCsv} data-testid="enrich-export"><Download className="h-4 w-4" /> Export CSV</Button>
            <Button size="sm" variant="ghost" className="rounded-full" disabled={running} onClick={() => setRows([])}>Clear</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Creator</th>
                  <th className="px-3 py-2 text-right font-medium">Followers</th>
                  <th className="px-3 py-2 text-right font-medium">Engagement</th>
                  <th className="px-3 py-2 font-medium">Last post</th>
                  <th className="px-3 py-2 text-right font-medium">Posts / wk</th>
                  <th className="px-5 py-2 font-medium">Looked up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={`${r.input}-${i}`} className={r.card ? "cursor-pointer hover:bg-muted/40" : ""} onClick={() => r.card && onOpen(r.card)} data-testid={`enrich-row-${i}`}>
                    <td className="px-5 py-2.5">
                      {r.card ? (
                        <span className="flex items-center gap-3">
                          <Face src={r.card.picture} name={r.card.name} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="truncate">{r.card.name}</span>
                              {r.card.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#F0A71F]" aria-label="On our lineup" />}
                              {r.extra?.verifiedAccount && !r.card.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-500" aria-label="Verified account" />}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">@{r.card.handle} · {label(r.card.platform)}{r.card.verified ? ` · ${r.card.verified.show}` : r.extra?.category ? ` · ${r.extra.category}` : ""}</span>
                          </span>
                        </span>
                      ) : r.status === "pending" ? (
                        <span className="flex items-center gap-3 text-muted-foreground"><span className="h-9 w-9 animate-pulse rounded-full bg-muted" />{r.input}</span>
                      ) : (
                        <span className="flex items-center gap-3 text-muted-foreground"><CircleAlert className="h-5 w-5 shrink-0" /><span className="min-w-0"><span className="block truncate text-foreground">{r.input}</span><span className="block text-xs">{r.message}</span></span></span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.card ? compact(r.card.followers) : ""}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.card?.engagement != null ? `${r.card.engagement.toFixed(2)}%` : r.card ? "–" : ""}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.card ? since(r.extra?.lastPostAt) : ""}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.extra?.postsPerWeek ?? (r.card ? "–" : "")}</td>
                    <td className="max-w-[14rem] truncate px-5 py-2.5 text-xs text-muted-foreground" title={r.input}>{r.kind === "email" ? `from ${r.input}` : r.input}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
