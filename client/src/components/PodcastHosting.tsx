import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, uploadToStorage } from "@/lib/upload";
import type { HostedEpisodeRow, HostedShowRow, RecordingRow } from "@shared/schema";
import { AlertCircle, BarChart3, Check, Copy, ExternalLink, Film, ImagePlus, Loader2, Mic2, Pencil, Plus, Podcast, Radio, Send, Trash2, Upload } from "lucide-react";

/**
 * Podcast: the show hosted on MilitaryVoices. A feed Apple, Spotify and every
 * app read; episodes from an audio file or a clean episode in the Library;
 * downloads counted the way sponsors count them. The numbers flow into the
 * Dashboard, Your analytics and the profile sponsors see.
 */

type Ep = HostedEpisodeRow & { downloads: number; live: boolean };
type Hosted = { show: HostedShowRow; feedUrl: string; missing: string[]; ownerConfirmed: boolean; episodes: Ep[]; stats: { total: number; last30: number; series: { date: string; count: number }[]; apps: Record<string, number> } };
type Resp = { shows: Hosted[]; categories: Record<string, string[]> };

const KEY = ["/api/host/hosting"];
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function PodcastHosting() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json() });
  const refresh = () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ["/api/host/podcast-stats"] }); };
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/shows", {})).json(),
    onSuccess: () => { refresh(); setEditing(true); },
    onError: (e: Error) => toast({ title: "Couldn't set that up", description: e.message, variant: "destructive" }),
  });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editEp, setEditEp] = useState<Ep | null>(null);

  if (q.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const h = q.data?.shows[0];

  if (!h) {
    return (
      <section className="mt-2" data-testid="podcast-hosting">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Podcast className="h-7 w-7" /></span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Host your podcast on MilitaryVoices</h1>
          <p className="mx-auto mt-2 max-w-xl text-balance text-muted-foreground">Your show's feed for Apple Podcasts, Spotify and every other app, with your downloads counted the way sponsors count them, and shown on your profile.</p>
          <ul className="mx-auto mt-5 grid max-w-2xl gap-3 text-left text-sm sm:grid-cols-3">
            {[
              [Upload, "Publish from anywhere", "Upload the audio, or use a clean episode from your Library."],
              [Radio, "One feed, every app", "Submit it to Apple and Spotify once; new episodes go out on their own."],
              [BarChart3, "Downloads sponsors trust", "Counted once per listener a day, bots left out, by app and episode."],
            ].map(([I, t, d]) => {
              const Icon = I as typeof Upload;
              return (
                <li key={t as string} className="rounded-xl border border-border p-3">
                  <Icon className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" />
                  <p className="mt-1.5 font-semibold">{t as string}</p>
                  <p className="text-xs text-muted-foreground">{d as string}</p>
                </li>
              );
            })}
          </ul>
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="mt-6 h-11 gap-2 rounded-full bg-[#053877] px-6 text-white hover:bg-[#0a4a99]" data-testid="hosting-start">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Set up your show
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">Free while you're a MilitaryVoices podcaster.</p>
        </div>
        <ImportShow onDone={refresh} />
      </section>
    );
  }

  const s = h.show;
  const ready = h.missing.length === 0;
  const topApp = Object.entries(h.stats.apps).sort((a, b) => b[1] - a[1])[0];

  return (
    <section className="mt-2 space-y-4" data-testid="podcast-hosting">
      {/* The show: its art, its name, its feed, and what's left before Apple takes it. */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-5">
          <ArtworkButton show={s} onDone={refresh} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your podcast</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{s.title}</h1>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description || "No description yet."}</p>
            <OwnerEmail h={h} onDone={refresh} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FeedLink url={h.feedUrl} />
              <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full" onClick={() => setEditing(true)} data-testid="hosting-edit-show"><Pencil className="h-3.5 w-3.5" /> Show details</Button>
            </div>
          </div>
        </div>
        {!ready ? (
          <div className="mt-4 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/[0.07] p-3.5" data-testid="hosting-missing">
            <p className="flex items-center gap-2 text-sm font-semibold"><AlertCircle className="h-4 w-4 text-[#b36b00]" /> Before Apple and Spotify will list it</p>
            <ul className="mt-1.5 grid gap-1 pl-6 text-sm text-foreground/80 sm:grid-cols-2">
              {h.missing.map((m) => <li key={m} className="list-disc">{m}</li>)}
            </ul>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-3.5" data-testid="hosting-ready">
            <Check className="h-4 w-4 text-emerald-600" />
            {s.importedFrom ? (
              // A moved show is already in the apps: the redirect carries it, nothing to submit.
              <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">Ready.</span> Your show is already in Apple Podcasts and Spotify; forwarding your old feed moves them here, with nothing to submit again.</p>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">Ready for the apps.</span> Submit your feed once to each; new episodes reach them on their own.</p>
                <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full"><a href="https://podcastsconnect.apple.com/my-podcasts/new-feed" target="_blank" rel="noreferrer">Apple Podcasts <ExternalLink className="h-3 w-3" /></a></Button>
                <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full"><a href="https://creators.spotify.com/pod/dashboard/import" target="_blank" rel="noreferrer">Spotify <ExternalLink className="h-3 w-3" /></a></Button>
              </>
            )}
          </div>
        )}
      </div>

      {s.importedFrom && <MoveSubscribers h={h} onDone={refresh} />}
      {s.newFeedUrl && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/[0.05] p-4 text-sm" data-testid="hosting-leaving">
          <span className="font-semibold">This show is moving to another host.</span> The feed forwards apps to <span className="font-mono text-xs">{s.newFeedUrl}</span>. Clear it in Show details to stay.
        </div>
      )}

      {/* The numbers that matter. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Downloads, last 30 days", compact(h.stats.last30)],
          ["Downloads, all time", compact(h.stats.total)],
          ["Episodes published", String(h.episodes.filter((e) => e.live).length)],
          ["Top app", topApp ? topApp[0] : "—"],
        ].map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-2xl font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {/* The episodes. */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Mic2 className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" /> Episodes</h2>
          <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-new-episode"><Plus className="h-4 w-4" /> New episode</Button>
        </div>
        {h.episodes.length ? (
          <ul className="divide-y divide-border">
            {h.episodes.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5" data-testid={`hosting-episode-${e.id}`}>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.live ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : e.status === "published" ? "bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]" : "bg-muted text-muted-foreground"}`}>
                  {e.live ? "Live" : e.status === "published" ? "Scheduled" : "Draft"}
                </span>
                <button type="button" onClick={() => setEditEp(e)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{e.episodeNumber != null ? `${e.episodeNumber}. ` : ""}{e.title}</span>
                  <span className="block text-xs text-muted-foreground">{e.publishedAt ? dateOf(e.publishedAt) : "Not published"}{e.durationSec ? ` · ${hms(e.durationSec)}` : ""}</span>
                </button>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground"><b className="text-foreground">{compact(e.downloads)}</b> downloads</span>
                <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full" onClick={() => setEditEp(e)}>{e.status === "draft" ? "Publish" : "Edit"}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No episodes yet. Add your first: upload the audio, or use a clean episode from your Library.</p>
        )}
      </div>

      <ShowDialog open={editing} onClose={() => setEditing(false)} show={s} categories={q.data?.categories ?? {}} onSaved={refresh} />
      <NewEpisodeDialog open={adding} onClose={() => setAdding(false)} show={s} onCreated={(e) => { refresh(); setAdding(false); setEditEp({ ...e, downloads: 0, live: false }); }} />
      <EpisodeDialog ep={editEp} onClose={() => setEditEp(null)} onSaved={refresh} />
    </section>
  );
}

/** Move a show here from its old host: its feed brings every episode, with their IDs, so no app plays one twice. */
function ImportShow({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const go = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/import", { feedUrl: url.trim() })).json() as Promise<{ episodes: number }>,
    onSuccess: (r) => { toast({ title: "Your show is here", description: `${r.episodes} episode${r.episodes === 1 ? "" : "s"} moved over. Next: forward your old feed so your subscribers follow.` }); onDone(); },
    onError: (e: Error) => toast({ title: "Couldn't move that show", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="hosting-import">
      <p className="font-semibold">Already hosted somewhere else? Move your show here</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Paste your show's RSS feed. We bring every episode, its notes and its artwork. Your subscribers follow once your old host forwards the feed (we'll show you how).</p>
      <form onSubmit={(e) => { e.preventDefault(); go.mutate(); }} className="mt-3 flex flex-wrap gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://feeds.yourhost.com/your-show" className="h-10 min-w-0 flex-1" data-testid="hosting-import-url" />
        <Button type="submit" disabled={go.isPending || !/^https?:\/\//.test(url.trim())} className="h-10 gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]">{go.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Moving…</> : "Move my show"}</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">It's in your old host's settings, often under Distribution or RSS. Buzzsprout, Libsyn, Transistor, Podbean, RSS.com, Spotify for Creators and the rest all have one.</p>
    </div>
  );
}

/** After a move: forward the old feed (a 301) so Apple, Spotify and every app move the subscribers, then check it took. */
function MoveSubscribers({ h, onDone }: { h: Hosted; onDone: () => void }) {
  const { toast } = useToast();
  const s = h.show;
  const check = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/hosting/shows/${s.id}/redirect-check`, {})).json() as Promise<{ ok: boolean; tagged: boolean; hops: { url: string; status: number }[] }>,
    onSuccess: (r) => {
      onDone();
      toast(r.ok ? { title: "Forwarding works", description: "Your old feed sends apps here. Subscribers move over as each app checks in, usually within a few days." } : r.tagged ? { title: "Almost", description: "Your old feed names the new address, but doesn't forward yet. Turn on the redirect (301) at your old host too." } : { title: "Not forwarding yet", description: `Your old feed still answers itself (${r.hops.map((x) => x.status).join(" → ") || "no answer"}). Turn on the redirect at your old host, then check again.`, variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Couldn't check", description: e.message, variant: "destructive" }),
  });
  const { toast: t2 } = useToast();
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${s.redirectOk ? "border-emerald-500/40 bg-emerald-500/[0.05]" : "border-[#053877]/25 bg-card"}`} data-testid="hosting-move">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">{s.redirectOk ? <><Check className="h-4 w-4 text-emerald-600" /> Your subscribers are following</> : "Bring your subscribers with you"}</p>
          {s.redirectOk ? (
            <p className="mt-1 text-sm text-muted-foreground">Your old feed forwards here{s.redirectCheckedAt ? ` (checked ${dateOf(s.redirectCheckedAt)})` : ""}. Keep your old host's account open for four weeks while every app catches up, then you can close it.</p>
          ) : (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
              <li>At your old host, find <b>Redirect feed</b>, <b>301 redirect</b> or <b>Move to a new host</b> (usually in the show's settings, under RSS or Distribution).</li>
              <li>Paste your new feed address: <button type="button" onClick={() => navigator.clipboard.writeText(h.feedUrl).then(() => t2({ title: "Copied" }))} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70">{h.feedUrl.replace(/^https:\/\//, "")} <Copy className="h-3 w-3" /></button></li>
              <li>Save, then press <b>Check the redirect</b>. Keep the old account open for four weeks while the apps catch up.</li>
            </ol>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Old feed: <span className="font-mono">{s.importedFrom}</span></p>
        </div>
        <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending} className="h-9 gap-1.5 rounded-full" data-testid="hosting-redirect-check">{check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Check the redirect</Button>
      </div>
    </div>
  );
}

/** The owner email: Apple and Spotify send their confirmation there, so only a confirmed one goes in the feed. */
function OwnerEmail({ h, onDone }: { h: Hosted; onDone: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const s = h.show;
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/hosting/shows/${s.id}/owner-email/send`, {})).json(),
    onSuccess: () => { setSent(true); toast({ title: "Code sent", description: `Check ${s.ownerEmail}.` }); },
    onError: (e: Error) => toast({ title: "Couldn't send it", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const confirm = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/hosting/shows/${s.id}/owner-email/confirm`, { code })).json(),
    onSuccess: () => { setSent(false); setCode(""); toast({ title: "Email confirmed", description: "It's in your feed now." }); onDone(); },
    onError: (e: Error) => toast({ title: "Not confirmed", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  if (!s.ownerEmail) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="hosting-owner">
      <span className="text-muted-foreground">Owner email</span>
      <span className="font-medium">{s.ownerEmail}</span>
      {h.ownerConfirmed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> Confirmed</span>
      ) : sent ? (
        <form onSubmit={(e) => { e.preventDefault(); confirm.mutate(); }} className="flex items-center gap-1.5">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="h-7 w-28 text-xs" autoFocus />
          <Button type="submit" size="sm" disabled={code.length !== 6 || confirm.isPending} className="h-7 rounded-full px-3 text-xs">Confirm</Button>
          <button type="button" onClick={() => send.mutate()} className="text-muted-foreground underline">Resend</button>
        </form>
      ) : (
        <>
          <span className="rounded-full bg-[#F0A71F]/20 px-2 py-0.5 font-semibold text-[#8a5a00] dark:text-[#F0A71F]">Not confirmed</span>
          <button type="button" onClick={() => send.mutate()} disabled={send.isPending} className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]" data-testid="hosting-owner-send">{send.isPending ? "Sending…" : "Send me a code"}</button>
        </>
      )}
    </div>
  );
}

function FeedLink({ url }: { url: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => toast({ title: "Feed address copied", description: "Paste it into Apple Podcasts Connect or Spotify for Creators." }))} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium hover:bg-muted" title="Copy your RSS feed address" data-testid="hosting-feed">
      <Radio className="h-3.5 w-3.5 shrink-0 text-[#b36b00]" /> <span className="truncate">{url.replace(/^https:\/\//, "")}</span> <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ArtworkButton({ show, onDone }: { show: HostedShowRow; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/host/hosting/shows/${show.id}/artwork`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Couldn't use that image.");
      onDone();
    } catch (e) {
      toast({ title: "Cover art not changed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted" title="Cover art: square JPG or PNG, 1400 to 3000 pixels" data-testid="hosting-artwork">
        {show.artworkUrl ? <img src={show.artworkUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><ImagePlus className="h-6 w-6" /> Cover art</span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Change"}</span>
      </button>
    </>
  );
}

function ShowDialog({ open, onClose, show, categories, onSaved }: { open: boolean; onClose: () => void; show: HostedShowRow; categories: Record<string, string[]>; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Partial<HostedShowRow>>({});
  const v = { ...show, ...f };
  const set = (k: keyof HostedShowRow, val: unknown) => setF((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/host/hosting/shows/${show.id}`, f)).json(),
    onSuccess: () => { onSaved(); setF({}); onClose(); toast({ title: "Show details saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const label = "block text-xs font-semibold text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setF({}); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Show details</DialogTitle>
          <DialogDescription>What Apple, Spotify and every podcast app show about your podcast.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Show name<Input value={v.title} onChange={(e) => set("title", e.target.value)} className="mt-1" /></label>
          <label className={`${label} sm:col-span-2`}>Description<Textarea value={v.description} onChange={(e) => set("description", e.target.value)} rows={4} className="mt-1" placeholder="What the show is about, who it's for, and who hosts it." /></label>
          <label className={label}>Host or author<Input value={v.author} onChange={(e) => set("author", e.target.value)} className="mt-1" /></label>
          <label className={label}>Owner email<Input type="email" value={v.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} className="mt-1" /></label>
          <label className={label}>Category
            <select value={v.category} onChange={(e) => { set("category", e.target.value); set("subcategory", ""); }} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground">
              {Object.keys(categories).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Subcategory
            <select value={v.subcategory} onChange={(e) => set("subcategory", e.target.value)} disabled={!(categories[v.category] ?? []).length} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-50">
              <option value="">None</option>
              {(categories[v.category] ?? []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Website (optional)<Input value={v.website} onChange={(e) => set("website", e.target.value)} className="mt-1" placeholder="https://" /></label>
          <label className={label}>Copyright (optional)<Input value={v.copyright} onChange={(e) => set("copyright", e.target.value)} className="mt-1" placeholder={`© ${new Date().getFullYear()} ${v.author || v.title}`} /></label>
          <label className={`${label} sm:col-span-2`}>Moving to another host? (optional)<Input value={v.newFeedUrl} onChange={(e) => set("newFeedUrl", e.target.value)} className="mt-1" placeholder="Your new host's feed address. Leave empty to stay." /><span className="mt-1 block font-normal">Your feed then forwards every app there (a 301), and your subscribers follow.</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.explicit} onChange={(e) => set("explicit", e.target.checked)} /> Explicit language</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.showType === "serial"} onChange={(e) => set("showType", e.target.checked ? "serial" : "episodic")} /> Listen in order (a series)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setF({}); onClose(); }}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !Object.keys(f).length} className="bg-[#053877] text-white hover:bg-[#0a4a99]">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A new episode: the audio first (a file, or a clean episode from the Library), then its words. */
function NewEpisodeDialog({ open, onClose, show, onCreated }: { open: boolean; onClose: () => void; show: HostedShowRow; onCreated: (e: HostedEpisodeRow) => void }) {
  const { toast } = useToast();
  const [from, setFrom] = useState<"upload" | "library">("upload");
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const recs = useQuery<RecordingRow[]>({ queryKey: ["/api/host/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(), enabled: open });
  const cleanOnes = (recs.data ?? []).filter((r) => { try { const c = r.clean ? JSON.parse(r.clean) : null; return c?.status === "done" && c.audioKey; } catch { return false; } });
  const make = async (body: Record<string, unknown>) => {
    const e = (await (await apiRequest("POST", `/api/host/hosting/shows/${show.id}/episodes`, body)).json()) as HostedEpisodeRow;
    onCreated(e);
  };
  const upload = async (file: File) => {
    if (!/^audio\/|^video\/mp4/.test(file.type)) return toast({ title: "That isn't audio", description: "Choose an MP3 or M4A file.", variant: "destructive" });
    try {
      setPct(0);
      const dur = await durationOf(file).catch(() => 0);
      const key = await uploadToStorage(file, setPct);
      await make({ audioKey: key, mime: file.type === "audio/mp3" ? "audio/mpeg" : file.type, sizeBytes: file.size, durationSec: Math.round(dur), title: file.name.replace(/\.[a-z0-9]+$/i, "") });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  const pick = useMutation({ mutationFn: (id: number) => make({ recordingId: id }), onError: (e: Error) => toast({ title: "Couldn't use that", description: e.message, variant: "destructive" }) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && pct === null && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>Start with the audio. You'll add the title and notes next, and choose when it goes out.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-xl bg-muted/60 p-1" role="tablist">
          {([["upload", "Upload audio", Upload], ["library", "From your Library", Film]] as const).map(([k, l, I]) => (
            <button key={k} type="button" role="tab" aria-selected={from === k} onClick={() => setFrom(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${from === k ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><I className="h-4 w-4" /> {l}</button>
          ))}
        </div>
        {from === "upload" ? (
          <>
            <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm hover:border-[#053877]/50 hover:bg-[#053877]/[0.03]" data-testid="hosting-upload">
              {pct === null ? <><Upload className="h-6 w-6 text-[#053877]" /><span className="font-semibold">Choose the episode's audio</span><span className="text-xs text-muted-foreground">MP3 or M4A</span></> : <><Loader2 className="h-6 w-6 animate-spin text-[#053877]" /><span className="font-semibold tabular-nums">Uploading… {pct}%</span><span className="text-xs text-muted-foreground">Keep this page open until it finishes.</span></>}
            </button>
          </>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {recs.isLoading ? <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" /> : cleanOnes.length ? (
              <ul className="divide-y divide-border">
                {cleanOnes.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title || "Untitled"}</span>
                    <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={pick.isPending} onClick={() => pick.mutate(r.id)}>{pick.isPending && pick.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Use this"}</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="py-8 text-center text-sm text-muted-foreground">No clean episodes yet. Clean one in Pōstify, or upload the audio.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Uses the clean episode's audio: the ums, false starts and long pauses already taken out.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** An episode's words and when it goes out: publish now, schedule it, or keep it as a draft. */
function EpisodeDialog({ ep, onClose, onSaved }: { ep: Ep | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Record<string, unknown>>({});
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  if (!ep) return null;
  const v = { ...ep, ...f } as Ep;
  const set = (k: string, val: unknown) => setF((x) => ({ ...x, [k]: val }));
  const close = () => { setF({}); setWhen("now"); setAt(""); onClose(); };
  const save = async (status?: "published" | "draft") => {
    try {
      const body: Record<string, unknown> = { ...f };
      if (status) body.status = status;
      if (status === "published" && when === "later" && at) body.publishedAt = new Date(at).toISOString();
      if (status === "published" && ep.status !== "published" && when === "now") body.publishedAt = new Date().toISOString();
      await apiRequest("PATCH", `/api/host/hosting/episodes/${ep.id}`, body);
      onSaved();
      toast({ title: status === "published" ? (when === "later" && at ? "Scheduled" : "Published") : "Saved", description: status === "published" ? "It's in your feed. The apps pick it up within the hour." : undefined });
      close();
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${ep.title}"? It leaves your feed, and the apps drop it on their next check.`)) return;
    await apiRequest("DELETE", `/api/host/hosting/episodes/${ep.id}`);
    onSaved();
    close();
  };
  const label = "block text-xs font-semibold text-muted-foreground";
  return (
    <Dialog open={!!ep} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ep.status === "draft" ? "Publish an episode" : "Edit episode"}</DialogTitle>
          <DialogDescription>{ep.durationSec ? `${hms(ep.durationSec)} long. ` : ""}{ep.live ? `Live since ${dateOf(ep.publishedAt)} · ${compact(ep.downloads)} downloads.` : ep.status === "published" ? `Goes out ${dateOf(ep.publishedAt)}.` : "A draft: only you can see it."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
          <label className={label}>Title<Input value={v.title} onChange={(e) => set("title", e.target.value)} className="mt-1" data-testid="hosting-ep-title" /></label>
          <label className={label}>Episode<Input type="number" min={0} value={v.episodeNumber ?? ""} onChange={(e) => set("episodeNumber", e.target.value === "" ? null : Number(e.target.value))} className="mt-1" /></label>
          <label className={label}>Season<Input type="number" min={0} value={v.season ?? ""} onChange={(e) => set("season", e.target.value === "" ? null : Number(e.target.value))} className="mt-1" /></label>
          <label className={`${label} sm:col-span-3`}>Show notes<Textarea value={v.description} onChange={(e) => set("description", e.target.value)} rows={6} className="mt-1" placeholder="What it's about, who's on it, and any links you mentioned." /></label>
          <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-3">
            <label className="flex items-center gap-2">Type
              <select value={v.episodeType} onChange={(e) => set("episodeType", e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="full">Full episode</option><option value="trailer">Trailer</option><option value="bonus">Bonus</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.explicit} onChange={(e) => set("explicit", e.target.checked)} /> Explicit</label>
          </div>
          {ep.status === "draft" && (
            <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-3">
              <span className="text-xs font-semibold text-muted-foreground">Goes out</span>
              {(["now", "later"] as const).map((w) => (
                <button key={w} type="button" onClick={() => setWhen(w)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${when === w ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`}>{w === "now" ? "Now" : "Pick a time"}</button>
              ))}
              {when === "later" && <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-8 w-56" />}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => void remove()} className="gap-1.5 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /> Delete</Button>
          <div className="flex gap-2">
            {ep.status === "draft" ? (
              <>
                <Button variant="outline" onClick={() => void save()} disabled={!Object.keys(f).length}>Save draft</Button>
                <Button onClick={() => void save("published")} disabled={!v.title.trim() || (when === "later" && !at)} className="gap-1.5 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-publish"><Send className="h-4 w-4" /> {when === "later" ? "Schedule" : "Publish"}</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => void save("draft")}>Unpublish</Button>
                <Button onClick={() => void save()} disabled={!Object.keys(f).length} className="bg-[#053877] text-white hover:bg-[#0a4a99]">Save</Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
