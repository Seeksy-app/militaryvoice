import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Copy, ExternalLink, FileText, Film, Image as ImageIcon, Link2, Loader2, Plus, Rocket, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import type { SocialAccount, SocialPlatform } from "@shared/schema";

// Admin → Growth → Go-to-market (13 Oct 2026): our promotional materials in one place, and a
// composer that posts them to Riccoh's own accounts or MilitaryVoices' brand accounts.

type Asset = { id: string; title: string; kind: "image" | "video" | "pdf" | "link"; url: string; notes: string; tags: string[]; createdAt: string };
type Acct = { name: string; ready: boolean; accounts: SocialAccount[] };
type Post = { id: number; account: "riccoh" | "mv"; title: string; platforms: string; status: string; scheduledAt: string; createdAt: string; error: string };
type Data = { configured: boolean; assets: Asset[]; accounts: { riccoh: Acct; mv: Acct }; posts: Post[] };

const KIND_ICON = { image: ImageIcon, video: Film, pdf: FileText, link: Link2 } as const;
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await adminSend(method, path, body);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { message?: string }).message || "That didn't work. Try again.");
  return j as T;
}

export function GtmPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<Data>({ queryKey: ["/api/admin/gtm"], queryFn: () => adminGet("/api/admin/gtm") });
  const [adding, setAdding] = useState(false);
  const [posting, setPosting] = useState<Asset | null>(null);
  const [filter, setFilter] = useState("");
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/gtm"] });
  if (!d) return <p className="text-sm text-muted-foreground">{q.isError ? "Couldn't load Go-to-market." : "Loading…"}</p>;
  const tags = Array.from(new Set(d.assets.flatMap((a) => a.tags)));
  const shown = filter ? d.assets.filter((a) => a.tags.includes(filter)) : d.assets;

  return (
    <section className="flex flex-col gap-6" data-testid="gtm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight"><Rocket className="h-5 w-5 text-[#053877]" /> Go-to-market</h2>
          <p className="mt-1 text-sm text-muted-foreground">Our promo materials, ready to share, and posts to Riccoh's or MilitaryVoices' accounts.</p>
        </div>
        <Button onClick={() => setAdding(true)} className="gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid="gtm-add"><Plus className="h-4 w-4" /> Add material</Button>
      </div>

      {/* Who we post as */}
      <div className="grid gap-3 md:grid-cols-2">
        {(["riccoh", "mv"] as const).map((k) => <AccountCard key={k} k={k} a={d.accounts[k]} onChange={refresh} />)}
      </div>

      {/* The library */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-2 text-sm font-bold uppercase tracking-[0.14em] text-[#053877]">Materials</h3>
          {tags.length > 0 && ["", ...tags].map((t) => (
            <button key={t || "all"} type="button" onClick={() => setFilter(t)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === t ? "bg-[#053877] text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{t || "All"}</button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing here yet. Add a graphic, a video, a PDF or a link.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((a) => <AssetCard key={a.id} a={a} onPost={() => setPosting(a)} onDelete={async () => { if (!confirm(`Remove "${a.title}" from the library?`)) return; await send("DELETE", `/api/admin/gtm/assets/${a.id}`); refresh(); }} onCopy={() => void navigator.clipboard.writeText(a.url).then(() => toast({ title: "Link copied" }))} />)}
          </div>
        )}
      </div>

      {/* What we've posted */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-[#053877]">Posts</h3>
        {d.posts.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No posts yet. Press Post on any picture or video above.</p> : (
          <ul className="mt-3 divide-y rounded-2xl border border-border bg-card">
            {d.posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${p.account === "riccoh" ? "bg-[#F0A71F]/20 text-[#7a4f00]" : "bg-[#053877]/10 text-[#053877]"}`}>{p.account === "riccoh" ? "Riccoh" : "MilitaryVoices"}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
                <span className="flex items-center gap-1 text-muted-foreground">{p.platforms.split(",").filter(Boolean).map((x) => <PlatformIcon key={x} platform={x as SocialPlatform} className="h-3.5 w-3.5" />)}</span>
                <span className={`text-xs font-semibold ${p.status === "failed" ? "text-red-600" : "text-muted-foreground"}`} title={p.error || undefined}>{p.status === "scheduled" ? `Scheduled ${when(p.scheduledAt)}` : p.status === "sent" ? `Posted ${when(p.createdAt)}` : p.status === "failed" ? "Didn't post" : "Sending…"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} />}
      {posting && <Composer a={posting} d={d} onClose={() => setPosting(null)} onPosted={() => { setPosting(null); refresh(); }} />}
    </section>
  );
}

function AccountCard({ k, a, onChange }: { k: "riccoh" | "mv"; a: Acct; onChange: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold">{k === "riccoh" ? "Riccoh's accounts" : "MilitaryVoices' accounts"}</p>
        {k === "mv" && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={async () => { setBusy(true); try { const r = await send<{ url: string }>("POST", "/api/admin/gtm/connect"); window.open(r.url, "_blank", "noopener"); } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); } finally { setBusy(false); } }} data-testid="gtm-connect">{a.accounts.length ? "Add or change" : "Connect accounts"}</Button>
            {a.accounts.length === 0 && <Button size="sm" variant="ghost" className="rounded-full" onClick={async () => { await send("POST", "/api/admin/gtm/refresh"); onChange(); }}>I've connected them</Button>}
          </div>
        )}
      </div>
      {a.accounts.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.accounts.map((s) => (
            <span key={`${s.platform}-${s.username}`} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
              <PlatformIcon platform={s.platform} className="h-3.5 w-3.5" /> {s.displayName || s.username}{s.followers ? <span className="text-muted-foreground"> · {s.followers.toLocaleString()}</span> : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{k === "mv" ? "Connect MilitaryVoices' own Instagram, Facebook, LinkedIn, X or TikTok to post as the brand." : "Riccoh connects his accounts from his dashboard: Integrations."}</p>
      )}
    </div>
  );
}

function AssetCard({ a, onPost, onDelete, onCopy }: { a: Asset; onPost: () => void; onDelete: () => void; onCopy: () => void }) {
  const Icon = KIND_ICON[a.kind];
  const postable = a.kind === "image" || a.kind === "video";
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-[#05060f]">
        {a.kind === "image" ? <img src={a.url} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy" />
          : a.kind === "video" ? <video src={`${a.url}#t=2`} className="absolute inset-0 h-full w-full object-contain" preload="metadata" muted playsInline controls />
          : <div className="absolute inset-0 flex items-center justify-center text-white/70"><Icon className="h-10 w-10" /></div>}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold capitalize text-white"><Icon className="h-3 w-3" /> {a.kind}</span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="text-balance text-sm font-bold leading-snug">{a.title}</p>
        {a.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.notes}</p>}
        <div className="mt-auto flex items-center gap-1.5 pt-3">
          {postable && <Button size="sm" onClick={onPost} className="gap-1 rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid={`gtm-post-${a.id}`}><Send className="h-3.5 w-3.5" /> Post</Button>}
          <Button size="sm" variant="outline" className="gap-1 rounded-full" asChild><a href={a.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open</a></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={onCopy} aria-label="Copy link" title="Copy link"><Copy className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="ml-auto h-8 w-8 rounded-full opacity-0 group-hover:opacity-100" onClick={onDelete} aria-label="Remove" title="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-3xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const file = useRef<HTMLInputElement | null>(null);
  const [f, setF] = useState({ title: "", url: "", notes: "", tags: "" });
  const [kind, setKind] = useState<Asset["kind"]>("link");
  const [busy, setBusy] = useState("");
  const upload = async (x: File) => {
    setBusy("Uploading…");
    try {
      const { uploadUrl, publicUrl } = await send<{ uploadUrl: string; publicUrl: string }>("POST", "/api/admin/gtm/upload-url", { fileName: x.name });
      const r = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": x.type || "application/octet-stream" }, body: x });
      if (!r.ok) throw new Error("The upload didn't finish. Try again.");
      setKind(x.type.startsWith("image/") ? "image" : x.type.startsWith("video/") ? "video" : x.type === "application/pdf" ? "pdf" : "link");
      setF((v) => ({ ...v, url: publicUrl, title: v.title || x.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") }));
    } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); } finally { setBusy(""); }
  };
  return (
    <Shell title="Add material" onClose={onClose}>
      <div className="mt-4 space-y-3">
        <input ref={file} type="file" accept="image/*,video/*,application/pdf" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); }} />
        <Button type="button" variant="outline" className="w-full gap-2 rounded-xl py-6" onClick={() => file.current?.click()} disabled={Boolean(busy)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : f.url && kind !== "link" ? <Check className="h-4 w-4 text-green-600" /> : <Upload className="h-4 w-4" />}
          {busy || (f.url && kind !== "link" ? "Uploaded. Pick another to replace it" : "Upload a picture, video or PDF")}
        </Button>
        {kind === "link" && <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="…or paste a link (a page, a press release)" />}
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" />
        <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} placeholder="Notes: the facts a caption can use (who, what, when, the link)" />
        <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="Tags, comma separated (Marathon, Creators, Brands)" />
        <Button className="w-full rounded-full bg-[#053877] hover:bg-[#0a4a99]" disabled={!f.url || Boolean(busy)} onClick={async () => {
          try { await send("POST", "/api/admin/gtm/assets", { ...f, kind, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) }); onAdded(); }
          catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
        }} data-testid="gtm-save">Add to materials</Button>
      </div>
    </Shell>
  );
}

function Composer({ a, d, onClose, onPosted }: { a: Asset; d: Data; onClose: () => void; onPosted: () => void }) {
  const { toast } = useToast();
  const [account, setAccount] = useState<"riccoh" | "mv">(d.accounts.riccoh.accounts.length ? "riccoh" : "mv");
  const acct = d.accounts[account];
  const options = acct.accounts.filter((s) => a.kind === "video" || s.platform !== "youtube");
  const [picked, setPicked] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [brief, setBrief] = useState("");
  const [later, setLater] = useState("");
  const [busy, setBusy] = useState("");
  const chosen = picked.filter((p) => options.some((o) => o.platform === p));
  return (
    <Shell title={`Post: ${a.title}`} onClose={onClose}>
      <div className="mt-4 grid gap-5 sm:grid-cols-[180px_1fr]">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#05060f]">
          {a.kind === "image" ? <img src={a.url} alt="" className="absolute inset-0 h-full w-full object-contain" /> : <video src={`${a.url}#t=2`} className="absolute inset-0 h-full w-full object-contain" preload="metadata" muted playsInline />}
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Post as</p>
            <div className="mt-2 inline-flex rounded-full border border-border p-1 text-sm font-semibold">
              {(["riccoh", "mv"] as const).map((k) => (
                <button key={k} type="button" onClick={() => { setAccount(k); setPicked([]); }} className={`rounded-full px-3.5 py-1.5 ${account === k ? "bg-[#053877] text-white" : "text-muted-foreground"}`}>{k === "riccoh" ? "Riccoh" : "MilitaryVoices"}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">To</p>
            {options.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{account === "mv" ? "Connect MilitaryVoices' accounts first (top of the page)." : "No accounts connected for this."}</p> : (
              <div className="mt-2 flex flex-wrap gap-2">
                {options.map((s) => {
                  const on = chosen.includes(s.platform);
                  return (
                    <button key={s.platform} type="button" onClick={() => setPicked(on ? chosen.filter((x) => x !== s.platform) : [...chosen, s.platform])} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border"}`} data-testid={`gtm-to-${s.platform}`}>
                      <PlatformIcon platform={s.platform} className="h-4 w-4" /> {platformLabel(s.platform)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <div className="flex gap-2">
          <Input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What should it say? (optional)" />
          <Button type="button" variant="outline" className="shrink-0 gap-1.5 rounded-full" disabled={Boolean(busy)} onClick={async () => {
            setBusy("Writing…");
            try { setCaption((await send<{ caption: string }>("POST", "/api/admin/gtm/caption", { account, assetId: a.id, platforms: chosen, brief })).caption); }
            catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); } finally { setBusy(""); }
          }} data-testid="gtm-write">{busy === "Writing…" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write it for me</Button>
        </div>
        <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={7} placeholder="The caption" data-testid="gtm-caption" />
        <p className="text-right text-xs text-muted-foreground">{caption.length} characters</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <CalendarClock className="h-4 w-4" /> Later:
          <input type="datetime-local" value={later} onChange={(e) => setLater(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-sm" />
          {later && <button type="button" onClick={() => setLater("")} className="text-xs underline">clear</button>}
        </label>
        <Button className="gap-1.5 rounded-full bg-[#053877] px-6 hover:bg-[#0a4a99]" disabled={!chosen.length || !caption.trim() || Boolean(busy)} onClick={async () => {
          setBusy("Posting…");
          try {
            const r = await send<{ scheduled: boolean }>("POST", "/api/admin/gtm/post", { account, assetId: a.id, platforms: chosen, caption, scheduledAt: later ? new Date(later).toISOString() : "" });
            toast({ title: r.scheduled ? "Scheduled" : "Posted", description: `To ${chosen.map((p) => platformLabel(p as SocialPlatform)).join(", ")} as ${account === "riccoh" ? "Riccoh" : "MilitaryVoices"}.` });
            onPosted();
          } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); } finally { setBusy(""); }
        }} data-testid="gtm-send">{busy === "Posting…" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {later ? "Schedule" : "Post now"}</Button>
      </div>
    </Shell>
  );
}
