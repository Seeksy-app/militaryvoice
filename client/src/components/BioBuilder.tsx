import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BioPageView } from "@/components/BioPageView";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { SWATCHES, TEMPLATES, type BioPublic, type BioSection, type BioSectionType, type BioSocial, type BioTheme } from "@shared/bio";
import type { ListenerQuestionRow, SocialPlatform } from "@shared/schema";
import { ArrowDown, ArrowUp, Calendar, Check, CheckCircle2, ChevronDown, Circle, Copy, ExternalLink, Eye, EyeOff, ImagePlus, Link2, Loader2, Mail, MessageCircleQuestion, MessageSquare, Monitor, Palette, Play, Plus, Share2, Smartphone, Tablet, Tag, Trash2, Type, User, Video, Layers } from "lucide-react";

/**
 * My page: the podcaster's bio page builder. Profile, Design, Content and
 * Share on the left; the page itself on the right, drawn by the very
 * component the public page uses. Everything saves as they go.
 */

type Page = { id: number; handle: string; displayName: string; bio: string; avatarUrl: string; heroUrl: string; theme: BioTheme; sections: BioSection[]; socials: BioSocial[]; rssUrl: string; askEnabled: boolean; published: boolean };
type Resp = { page: Page; url: string; preview: BioPublic; stats: Record<string, number>; questions: ListenerQuestionRow[] };
type Tab = "profile" | "design" | "content" | "share" | "questions";

const KEY = ["/api/host/bio"];
const newId = () => Math.random().toString(36).slice(2, 10);

export function BioBuilder() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/bio")).json() });
  const social = useQuery<{ accounts?: { platform: string; username?: string; url?: string }[] }>({ queryKey: ["/api/host/social"], queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(), staleTime: 5 * 60_000 });
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("mv_bio_tab") as Tab) || "profile"; } catch { return "profile"; } });
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem("mv_bio_tab", t); } catch { /* fine */ } };
  const [device, setDevice] = useState<"mobile" | "tablet" | "desktop">("mobile");
  const [draft, setDraft] = useState<Page | null>(null);
  const [preview, setPreview] = useState<BioPublic | null>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef<Partial<Page>>({});
  const timer = useRef<number>();

  useEffect(() => { if (q.data && !draft) { setDraft(q.data.page); setPreview(q.data.preview); setUrl(q.data.url); } }, [q.data, draft]);

  // Their connected accounts join the social icons (on, in the order they come), once each.
  useEffect(() => {
    if (!draft || !social.data?.accounts) return;
    const have = new Set(draft.socials.map((s) => s.platform));
    const add = social.data.accounts.filter((a) => a.url && !have.has(a.platform)).map((a) => ({ platform: a.platform, username: a.username ?? "", url: a.url!, on: true }));
    if (add.length) change({ socials: [...draft.socials, ...add] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [social.data, draft?.id]);

  const flush = async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSaving(true);
    try {
      const r = (await (await apiRequest("PATCH", "/api/host/bio", body)).json()) as Omit<Resp, "stats" | "questions">;
      setPreview(r.preview);
      setUrl(r.url);
      if (body.handle) setDraft((d) => (d ? { ...d, handle: r.page.handle } : d));
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
      if (body.handle) setDraft((d) => (d && q.data ? { ...d, handle: q.data.page.handle } : d));
    } finally {
      setSaving(false);
    }
  };
  /** Change the page and save a moment later (a handle saves when they leave the box). */
  const change = (patch: Partial<Page>, now = false) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), now ? 0 : 700);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const view: BioPublic | null = useMemo(() => draft && preview ? {
    ...preview, handle: draft.handle, displayName: draft.displayName, bio: draft.bio, avatarUrl: draft.avatarUrl, heroUrl: draft.heroUrl,
    theme: draft.theme, askEnabled: draft.askEnabled,
    socials: draft.socials.filter((s) => s.on && s.url), sections: draft.sections.filter((s) => s.visible),
  } : null, [draft, preview]);

  if (q.isLoading || !draft || !view) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const newQs = (q.data?.questions ?? []).filter((x) => x.status === "new").length;

  return (
    <section className="mt-2" data-testid="bio-builder">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-xl font-bold">My page</h1>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium hover:bg-muted" data-testid="bio-open">
          {url.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
        <span className="text-xs text-muted-foreground">{saving ? "Saving…" : "Saved"}</span>
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {([["profile", "Profile", User], ["design", "Design", Palette], ["content", "Content", Layers], ["share", "Share", Share2], ["questions", "Questions", MessageCircleQuestion]] as const).map(([k, l, I]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-[#F0A71F] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`bio-tab-${k}`}>
            <I className="h-4 w-4" /> {l}{k === "questions" && newQs > 0 && <span className="rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{newQs}</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "profile" && <ProfileTab d={draft} view={view} change={change} flush={flush} setPreview={setPreview} />}
          {tab === "design" && <DesignTab d={draft} change={change} />}
          {tab === "content" && <ContentTab d={draft} change={change} />}
          {tab === "share" && <ShareTab url={url} stats={q.data?.stats ?? {}} />}
          {tab === "questions" && <QuestionsTab items={q.data?.questions ?? []} onChange={() => void qc.invalidateQueries({ queryKey: KEY })} />}
        </div>
        {/* The page, as listeners will see it. */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-3 flex justify-center">
            <div className="inline-flex gap-1 rounded-full border border-border bg-card p-1">
              {([["mobile", "Mobile", Smartphone], ["tablet", "Tablet", Tablet], ["desktop", "Desktop", Monitor]] as const).map(([k, l, I]) => (
                <button key={k} type="button" onClick={() => setDevice(k)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${device === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`}><I className="h-3.5 w-3.5" /> {l}</button>
              ))}
            </div>
          </div>
          <div className="flex justify-center">
            <div className={device === "mobile" ? "w-[360px] rounded-[42px] border-[10px] border-[#111] bg-[#111] shadow-xl" : device === "tablet" ? "w-[560px] rounded-[28px] border-[12px] border-[#111] bg-[#111] shadow-xl" : "w-full rounded-xl border border-border shadow-xl"}>
              <div className={`overflow-y-auto overflow-x-hidden ${device === "desktop" ? "h-[680px] rounded-xl" : device === "tablet" ? "h-[720px] rounded-[16px]" : "h-[700px] rounded-[32px]"}`}>
                <BioPageView data={view} preview shareBase={url} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Profile -----------------------------------------------------------------------

function ProfileTab({ d, view, change, flush, setPreview }: { d: Page; view: BioPublic; change: (p: Partial<Page>, now?: boolean) => void; flush: () => Promise<void>; setPreview: (p: BioPublic) => void }) {
  const [handle, setHandle] = useState(d.handle);
  useEffect(() => setHandle(d.handle), [d.handle]);
  const steps = [
    { label: "Add your name", done: !!d.displayName.trim() },
    { label: "Claim your link", done: !!d.handle },
    { label: "Add a profile photo", done: !!d.avatarUrl },
    { label: "Write a short bio", done: d.bio.trim().length >= 10 },
    { label: "Show your podcast or add a link", done: !!view.podcast || d.sections.length > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  const move = (i: number, dir: -1 | 1) => { const s = [...d.socials]; const j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; change({ socials: s }); };
  const hosted = /\/feed\//.test(view.podcast?.feedUrl ?? "");
  return (
    <div className="space-y-5">
      {done < steps.length && (
        <div className="rounded-2xl border border-[#053877]/20 bg-[#053877]/[0.03] p-4" data-testid="bio-checklist">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Finish your page</p><span className="text-xs text-muted-foreground">{done} of {steps.length}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#053877] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ul className="mt-3 space-y-1.5">
            {steps.map((s) => <li key={s.label} className={`flex items-center gap-2 text-sm ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground/50" />} {s.label}</li>)}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <ImagePick label="Profile photo" kind="avatar" url={d.avatarUrl} round onDone={(u, p) => { change({ avatarUrl: u }); setPreview(p); }} onClear={() => change({ avatarUrl: "" }, true)} />
        <ImagePick label="Cover photo" kind="hero" url={d.heroUrl} note={d.theme.layout === "portrait" ? "Shown with the Banner or Cover layouts" : undefined} onDone={(u, p) => { change({ heroUrl: u }); setPreview(p); }} onClear={() => change({ heroUrl: "" }, true)} />
      </div>
      <Field label="Name on the page"><Input value={d.displayName} onChange={(e) => change({ displayName: e.target.value })} maxLength={80} /></Field>
      <Field label="Your link" hint="3 to 30 letters or numbers. Changing it breaks links you've already shared.">
        <div className="flex items-center rounded-md border border-input bg-background pl-3 text-sm focus-within:ring-2 focus-within:ring-ring">
          <span className="text-muted-foreground">militaryvoices.ai/</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30))} onBlur={() => { if (handle !== d.handle) change({ handle }, true); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="h-9 min-w-0 flex-1 bg-transparent pr-3 outline-none" data-testid="bio-handle" />
        </div>
      </Field>
      <Field label="Bio"><Textarea value={d.bio} onChange={(e) => change({ bio: e.target.value })} maxLength={500} rows={3} placeholder="Who you are, what the show is about, who it's for." /></Field>
      <Field label="Your podcast" hint={hosted ? "Hosted here on MilitaryVoices: new episodes appear on your page by themselves." : "Paste your show's RSS feed and your latest episodes appear, top and centre."}>
        {hosted ? <p className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-emerald-600" /> {view.podcast?.title}</p> : <Input value={d.rssUrl} onChange={(e) => change({ rssUrl: e.target.value })} placeholder="https://feeds.yourhost.com/your-show" />}
      </Field>
      <div className="flex items-center justify-between rounded-xl border border-border p-3">
        <div><p className="text-sm font-semibold">Let listeners ask you questions</p><p className="text-xs text-muted-foreground">They land in your inbox, and your reply goes straight back.</p></div>
        <Switch checked={d.askEnabled} onCheckedChange={(v) => change({ askEnabled: v }, true)} />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Social icons</p>
        {d.socials.length ? (
          <ul className="space-y-2">
            {d.socials.map((s, i) => (
              <li key={s.platform} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
                <span className="flex flex-col"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground disabled:opacity-30" aria-label="Up"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(i, 1)} disabled={i === d.socials.length - 1} className="text-muted-foreground disabled:opacity-30" aria-label="Down"><ArrowDown className="h-3.5 w-3.5" /></button></span>
                <PlatformIcon platform={s.platform as SocialPlatform} className="h-5 w-5" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{platformLabel(s.platform as SocialPlatform)}</span><span className="block truncate text-xs text-muted-foreground">{s.username ? `@${s.username.replace(/^@/, "")}` : s.url}</span></span>
                <Switch checked={s.on} onCheckedChange={(v) => change({ socials: d.socials.map((x, j) => (j === i ? { ...x, on: v } : x)) })} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Connect your accounts in Integrations and they appear here.</p>}
        <a href="/host/dashboard/integrations" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]"><Link2 className="h-3.5 w-3.5" /> Manage connections</a>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-semibold">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}</label>;
}

function ImagePick({ label, kind, url, round, note, onDone, onClear }: { label: string; kind: "avatar" | "hero"; url: string; round?: boolean; note?: string; onDone: (url: string, preview: BioPublic) => void; onClear: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`/api/host/bio/image/${kind}`, { method: "POST", body: fd, credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't use that image.");
      onDone(j.url, j.preview);
    } catch (e) {
      toast({ title: "Image not changed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{label}</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} className={`group relative flex h-28 w-full items-center justify-center overflow-hidden border-2 border-dashed border-border bg-muted/40 ${round ? "rounded-2xl" : "rounded-2xl"}`}>
        {url ? <img src={url} alt="" className={round ? "h-24 w-24 rounded-full object-cover" : "h-full w-full object-cover"} /> : <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><ImagePlus className="h-5 w-5" /> Add</span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-semibold text-white ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Change"}</span>
      </button>
      {url && <button type="button" onClick={onClear} className="mt-1 text-xs text-muted-foreground hover:text-foreground">Remove</button>}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

// ---- Design ------------------------------------------------------------------------

function DesignTab({ d, change }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void }) {
  const t = d.theme;
  const set = (p: Partial<BioTheme>) => change({ theme: { ...t, ...p } });
  const [hex, setHex] = useState(t.color);
  useEffect(() => setHex(t.color), [t.color]);
  const pill = (on: boolean) => `rounded-full border px-3.5 py-1.5 text-sm font-semibold ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`;
  const group = <T extends string>(label: string, value: T, opts: [T, string][], on: (v: T) => void) => (
    <div><p className="mb-2 text-sm font-semibold">{label}</p><div className="flex flex-wrap gap-2">{opts.map(([v, l]) => <button key={v} type="button" onClick={() => on(v)} className={pill(value === v)}>{l}</button>)}</div></div>
  );
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-semibold">Template</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((k) => {
            const tp = TEMPLATES[k];
            const dark = tp.theme.shade === "dark";
            return (
              <button key={k} type="button" onClick={() => set({ ...tp.theme, template: k })} className={`rounded-2xl border-2 p-3 text-left ${t.template === k ? "border-[#053877]" : "border-border hover:border-[#053877]/40"}`} data-testid={`bio-template-${k}`}>
                <span className="mb-2 flex h-14 items-end justify-center gap-1 rounded-lg p-2" style={{ background: k === "vibrant" ? `linear-gradient(180deg, ${t.color}, #0b1020)` : dark ? "#0b1020" : "#f5f6fa" }}>
                  {[0, 1, 2].map((i) => <span key={i} className="h-2 w-8" style={{ background: tp.theme.linkStyle === "outline" ? "transparent" : t.color, border: `1.5px solid ${t.color}`, borderRadius: tp.theme.linkShape === "pill" ? 999 : tp.theme.linkShape === "rounded" ? 4 : 1 }} />)}
                </span>
                <span className="block text-sm font-semibold">{tp.label}</span>
                <span className="block text-xs text-muted-foreground">{tp.note}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Colour</p>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c} className={`h-8 w-8 rounded-full border ${t.color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-[#053877] ring-offset-2" : "border-border"}`} style={{ background: c }} />)}
        </div>
        <Input value={hex} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) set({ color: e.target.value }); }} className="mt-2 w-32 font-mono" />
      </div>
      {group("Page", t.shade, [["dark", "Dark"], ["light", "Light"]], (v) => set({ shade: v }))}
      {group("Top of the page", t.layout, [["blend", "Cover photo"], ["landscape", "Banner"], ["portrait", "Round photo"]], (v) => set({ layout: v }))}
      {group("Font", t.font, [["sans", "Modern"], ["serif", "Classic"], ["mono", "Typewriter"]], (v) => set({ font: v }))}
      {group("Button shape", t.linkShape, [["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"]], (v) => set({ linkShape: v }))}
      {group("Button style", t.linkStyle, [["fill", "Filled"], ["outline", "Outline"], ["soft", "Card"]], (v) => set({ linkStyle: v }))}
    </div>
  );
}

// ---- Content -----------------------------------------------------------------------

const KINDS: { type: BioSectionType; label: string; hint: string; icon: typeof Link2 }[] = [
  { type: "links", label: "Links", hint: "Buttons to your site, store, anything", icon: Link2 },
  { type: "video", label: "Video", hint: "A YouTube or Vimeo video", icon: Video },
  { type: "promo", label: "Promo code", hint: "A sponsor's code, with a tap to copy", icon: Tag },
  { type: "meeting", label: "Book a meeting", hint: "Your Calendly or booking link", icon: Calendar },
  { type: "text", label: "Text", hint: "A few words of your own", icon: Type },
];
function blank(type: BioSectionType): BioSection {
  const base = { id: newId(), visible: true, title: "" };
  switch (type) {
    case "links": return { ...base, type, links: [{ id: newId(), label: "", url: "" }] };
    case "video": return { ...base, type, url: "" };
    case "promo": return { ...base, type, title: "Save with my code", code: "", url: "", note: "" };
    case "meeting": return { ...base, type, title: "Book a time with me", url: "", note: "" };
    default: return { ...base, type: "text", body: "" };
  }
}

function ContentTab({ d, change }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const put = (s: BioSection[]) => change({ sections: s });
  const upd = (id: string, patch: Partial<BioSection>) => put(d.sections.map((x) => (x.id === id ? ({ ...x, ...patch } as BioSection) : x)));
  const move = (i: number, dir: -1 | 1) => { const s = [...d.sections]; const j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; put(s); };
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">Your podcast always sits first, under your name. What you add here goes below it, in this order.</p>
      {d.sections.map((s, i) => {
        const k = KINDS.find((x) => x.type === s.type)!;
        return (
          <div key={s.id} className="rounded-2xl border border-border bg-card" data-testid={`bio-section-${s.type}`}>
            <div className="flex items-center gap-2 p-3">
              <span className="flex flex-col"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground disabled:opacity-30" aria-label="Up"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(i, 1)} disabled={i === d.sections.length - 1} className="text-muted-foreground disabled:opacity-30" aria-label="Down"><ArrowDown className="h-3.5 w-3.5" /></button></span>
              <k.icon className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" />
              <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{s.title || k.label}</span><span className="block text-xs text-muted-foreground">{k.label}</span></button>
              <button type="button" onClick={() => upd(s.id, { visible: !s.visible })} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label={s.visible ? "Hide" : "Show"}>{s.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
              <button type="button" onClick={() => put(d.sections.filter((x) => x.id !== s.id))} className="rounded-full p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open === s.id ? "rotate-180" : ""}`} />
            </div>
            {open === s.id && <div className="space-y-2 border-t border-border p-3"><SectionEditor s={s} upd={(p) => upd(s.id, p)} /></div>}
          </div>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button className="w-full gap-1.5 rounded-xl bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="bio-add"><Plus className="h-4 w-4" /> Add to your page</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {KINDS.map((k) => (
            <DropdownMenuItem key={k.type} onSelect={() => { const s = blank(k.type); put([...d.sections, s]); setOpen(s.id); }} className="gap-3 py-2">
              <k.icon className="h-4 w-4" /><span><span className="block text-sm font-medium">{k.label}</span><span className="block text-xs text-muted-foreground">{k.hint}</span></span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SectionEditor({ s, upd }: { s: BioSection; upd: (p: Partial<BioSection>) => void }) {
  const title = <Input value={s.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Heading (optional)" maxLength={80} />;
  if (s.type === "links") return (
    <>
      {title}
      {s.links.map((l, i) => (
        <div key={l.id} className="flex gap-2">
          <Input value={l.label} onChange={(e) => upd({ links: s.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Button text" className="w-2/5" />
          <Input value={l.url} onChange={(e) => upd({ links: s.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://" className="flex-1" />
          <button type="button" onClick={() => upd({ links: s.links.filter((_, j) => j !== i) })} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove link"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => upd({ links: [...s.links, { id: newId(), label: "", url: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]"><Plus className="h-3.5 w-3.5" /> Another link</button>
    </>
  );
  if (s.type === "video") return <>{title}<Input value={s.url} onChange={(e) => upd({ url: e.target.value })} placeholder="https://youtube.com/watch?v=…" /></>;
  if (s.type === "promo") return <>{title}<Input value={s.code} onChange={(e) => upd({ code: e.target.value.toUpperCase() })} placeholder="CODE" className="font-mono" /><Input value={s.url} onChange={(e) => upd({ url: e.target.value })} placeholder="The sponsor's link (https://)" /><Input value={s.note} onChange={(e) => upd({ note: e.target.value })} placeholder="e.g. 20% off your first order" /></>;
  if (s.type === "meeting") return <>{title}<Input value={s.url} onChange={(e) => upd({ url: e.target.value })} placeholder="https://calendly.com/…" /><Input value={s.note} onChange={(e) => upd({ note: e.target.value })} placeholder="e.g. Guests, sponsors and fellow veterans welcome" /></>;
  if (s.type === "text") return <>{title}<Textarea value={s.body} onChange={(e) => upd({ body: e.target.value })} rows={4} maxLength={2000} /></>;
  return null;
}

// ---- Share -------------------------------------------------------------------------

function ShareTab({ url, stats }: { url: string; stats: Record<string, number> }) {
  const { toast } = useToast();
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: "#000741", light: "#ffffff" } }).then(setQr).catch(() => setQr("")); }, [url]);
  const copy = () => navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied" }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([["view", "Views", Eye], ["click", "Link taps", Link2], ["play", "Plays", Play], ["share", "Shares", Share2], ["ask", "Questions", MessageCircleQuestion]] as const).map(([k, l, I]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-3"><p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><I className="h-3 w-3" /> {l}</p><p className="mt-0.5 text-xl font-bold tabular-nums">{stats[k] ?? 0}</p></div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Last 30 days.</p>
      <div className="flex gap-2"><Input readOnly value={url} className="font-mono text-sm" /><Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Copy"><Copy className="h-4 w-4" /></Button></div>
      <Button onClick={() => void copy()} className="w-full gap-2 bg-[#053877] text-white hover:bg-[#0a4a99]"><Copy className="h-4 w-4" /> Copy my page link</Button>
      <Button variant="outline" className="w-full gap-2" onClick={() => { if (navigator.share) void navigator.share({ url }).catch(() => {}); else void copy(); }}><Share2 className="h-4 w-4" /> Share via…</Button>
      <Button asChild variant="outline" className="w-full gap-2"><a href={`sms:?&body=${encodeURIComponent(url)}`}><MessageSquare className="h-4 w-4" /> Share by text message</a></Button>
      <Button asChild variant="outline" className="w-full gap-2"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open my page</a></Button>
      {qr && (
        <div className="rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-sm font-semibold">QR code</p>
          <img src={qr} alt="QR code for your page" className="mx-auto mt-2 h-44 w-44" />
          <a href={qr} download="my-page-qr.png" className="mt-2 inline-block text-xs font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Download it</a>
          <p className="mt-1 text-xs text-muted-foreground">For your show notes, slides, table cards and merch.</p>
        </div>
      )}
    </div>
  );
}

// ---- Questions ---------------------------------------------------------------------

function QuestionsTab({ items, onChange }: { items: ListenerQuestionRow[]; onChange: () => void }) {
  const mark = async (id: number, status: string) => { await apiRequest("PATCH", `/api/host/bio/questions/${id}`, { status }); onChange(); };
  const list = items.filter((x) => x.status !== "archived");
  if (!list.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No questions yet. When a listener uses the Ask box on your page, it lands here and in your email.</p>;
  return (
    <ul className="space-y-3">
      {list.map((x) => (
        <li key={x.id} className={`rounded-2xl border p-4 ${x.status === "new" ? "border-[#F0A71F]/50 bg-[#F0A71F]/[0.05]" : "border-border bg-card"}`} data-testid={`bio-question-${x.id}`}>
          <p className="text-xs text-muted-foreground">{x.name || "A listener"}{x.fromEmail ? ` · ${x.fromEmail}` : ""} · {new Date(x.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{x.episode ? ` · about "${x.episode}"` : ""}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{x.question}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {x.fromEmail && <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full"><a href={`mailto:${x.fromEmail}?subject=${encodeURIComponent("Re: your question")}&body=${encodeURIComponent(`\n\n> ${x.question}`)}`}><Mail className="h-3.5 w-3.5" /> Reply</a></Button>}
            {x.status === "new" && <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => void mark(x.id, "answered")}>Mark answered</Button>}
            <Button size="sm" variant="ghost" className="h-8 rounded-full text-muted-foreground" onClick={() => void mark(x.id, "archived")}>Archive</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
