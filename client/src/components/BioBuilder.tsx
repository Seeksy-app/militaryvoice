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
import { BioBrandsView } from "@/components/BioBrandsView";
import { podcastWorthFor } from "@/lib/worth";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { SWATCHES, TEMPLATES, DEFAULT_BRANDS, type BioBrands, type BioBrandsPublic, type BioPublic, type BioSection, type BioSectionType, type BioSocial, type BioTheme } from "@shared/bio";
import type { ListenerQuestionRow, SocialPlatform } from "@shared/schema";
import { Handshake, Droplet, Moon, Sun, Headphones, Sparkles, ArrowDown, ArrowUp, Calendar, Check, CheckCircle2, ChevronDown, Circle, Copy, ExternalLink, Eye, EyeOff, ImagePlus, Link2, Loader2, Mail, MessageCircle, Send, MessageSquare, Monitor, Palette, Play, Plus, Share2, Smartphone, Tablet, Tag, Trash2, Type, User, Video, Layers } from "lucide-react";

/**
 * Rally Point (was "My page"): the podcaster's bio page builder. Profile, Design, Content and
 * Share on the left; the page itself on the right, drawn by the very
 * component the public page uses. Everything saves as they go.
 */

type Page = { id: number; handle: string; displayName: string; bio: string; avatarUrl: string; heroUrl: string; theme: BioTheme; sections: BioSection[]; socials: BioSocial[]; rssUrl: string; askEnabled: boolean; welcome: string; aiEnabled: boolean; published: boolean; brands: BioBrands };
type Resp = { page: Page; url: string; preview: BioPublic; brandsPreview?: BioBrandsPublic | null; stats: Record<string, number>; questions: ListenerQuestionRow[]; knowledge?: { done: number; total: number } };
type Tab = "profile" | "design" | "content" | "share" | "brands" | "questions";

const KEY = ["/api/host/bio"];

/** Phones to preview on, at their screen size in CSS points (what a web page lays out to). */
const PHONES = [
  { id: "iphone-18-pro-max", name: "iPhone 18 Pro Max", w: 440, h: 956 },
  { id: "iphone-18-pro", name: "iPhone 18 Pro", w: 402, h: 874 },
  { id: "iphone-17-pro-max", name: "iPhone 17 Pro Max", w: 440, h: 956 },
  { id: "iphone-air", name: "iPhone Air", w: 420, h: 912 },
  { id: "iphone-17", name: "iPhone 17 / 17 Pro", w: 402, h: 874 },
  { id: "iphone-16-plus", name: "iPhone 16 Plus", w: 430, h: 932 },
  { id: "iphone-16e", name: "iPhone 16e", w: 390, h: 844 },
  { id: "galaxy-s25-ultra", name: "Galaxy S25 Ultra", w: 412, h: 891 },
  { id: "pixel-10-pro-xl", name: "Pixel 10 Pro XL", w: 412, h: 915 },
  { id: "small", name: "Small phone", w: 360, h: 780 },
] as const;
const newId = () => Math.random().toString(36).slice(2, 10);

export function BioBuilder() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/bio")).json() });
  const social = useQuery<{ accounts?: { platform: string; username?: string; url?: string }[] }>({ queryKey: ["/api/host/social"], queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(), staleTime: 5 * 60_000 });
  const [tab, setTab] = useState<Tab>(() => { try { return new URLSearchParams(window.location.search).get("tab") === "messages" ? "questions" : (localStorage.getItem("mv_bio_tab") as Tab) || "profile"; } catch { return "profile"; } });
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem("mv_bio_tab", t); } catch { /* fine */ } };
  const [device, setDevice] = useState<"mobile" | "tablet" | "desktop">("mobile");
  const [phone, setPhone] = useState<string>(() => { try { const v = localStorage.getItem("mv_bio_phone") ?? ""; return PHONES.some((p) => p.id === v) ? v : PHONES[0].id; } catch { return PHONES[0].id; } });
  const pickPhone = (id: string) => { setPhone(id); setDevice("mobile"); try { localStorage.setItem("mv_bio_phone", id); } catch { /* fine */ } };
  // The preview at the phone's real size (CSS points), shrunk only when the column is narrower.
  const stage = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 9999, h: 900 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
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
    theme: draft.theme, askEnabled: draft.askEnabled, welcome: draft.welcome?.trim() || preview.welcome, brandsOn: draft.brands?.on ?? true,
    ai: { enabled: draft.aiEnabled && (preview.ai?.episodes ?? 0) > 0, episodes: preview.ai?.episodes ?? 0 },
    socials: draft.socials.filter((s) => s.on && s.url), sections: draft.sections.filter((s) => s.visible),
  } : null, [draft, preview]);
  // The Brands view: the numbers from the server, what they write from the draft.
  const kitView: BioBrandsPublic | null = useMemo(() => draft && q.data?.brandsPreview ? {
    ...q.data.brandsPreview, displayName: draft.displayName, bio: draft.bio, avatarUrl: draft.avatarUrl, theme: draft.theme, kit: draft.brands ?? DEFAULT_BRANDS,
  } : null, [draft, q.data?.brandsPreview]);
  const page = (id?: string) => tab === "brands" && kitView ? <BioBrandsView data={kitView} preview listenUrl={url} /> : <BioPageView data={view!} preview shareBase={url} />;

  if (q.isLoading || !draft || !view) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const newQs = (q.data?.questions ?? []).filter((x) => x.status === "new").length;

  return (
    <section className="mt-2" data-testid="bio-builder">
      {/* The page's own band: the address to share, front and centre, and how it's doing. */}
      <div className="relative mb-5 overflow-hidden rounded-3xl bg-[#04102b] p-5 text-white shadow-md sm:p-6" data-testid="bio-hero">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/[0.07]" aria-hidden />
        <div className="pointer-events-none absolute -right-8 -top-8 h-72 w-72 rounded-full border border-white/[0.07]" aria-hidden />
        <div className="relative min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">Your Rally Point</p>
            <p className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">{url.replace(/^https?:\/\/(www\.)?/, "")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied", description: "Paste it in your bio, your show notes, anywhere." }))} className="gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="bio-copy"><Copy className="h-4 w-4" /> Copy link</Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"><a href={url} target="_blank" rel="noreferrer" data-testid="bio-open"><ExternalLink className="h-4 w-4" /> Open</a></Button>
              <span className="text-xs text-white/60">{saving ? "Saving…" : "Saved"}</span>
            </div>
        </div>
        <p className="relative mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">Last 30 days</p>
        <div className="relative mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="bio-stats">
          {([["view", "Views", Eye, "#8fb5e8"], ["click", "Link taps", Link2, "#c4b5fd"], ["play", "Plays", Play, "#6ee7b7"], ["share", "Shares", Share2, "#7dd3fc"], ["ask", "Messages", MessageCircle, "#F0A71F"]] as const).map(([k, l, I, c]) => (
            <div key={k} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10 transition-colors hover:bg-white/[0.09]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${c}26`, color: c }}><I className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block text-2xl font-bold leading-none tabular-nums">{q.data?.stats?.[k] ?? 0}</span><span className="mt-1 block text-[11px] text-white/65">{l}</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm" role="tablist">
        {([["profile", "Profile", User], ["design", "Design", Palette], ["content", "Content", Layers], ["share", "Share", Share2], ["brands", "Brands", Handshake], ["questions", "Messages", MessageCircle]] as const).map(([k, l, I]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === k ? "bg-[#053877] text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} data-testid={`bio-tab-${k}`}>
            <I className="h-4 w-4" /> {l}{k === "questions" && newQs > 0 && <span className="rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{newQs}</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "profile" && <ProfileTab d={draft} view={view} change={change} flush={flush} setPreview={setPreview} knowledge={q.data?.knowledge} />}
          {tab === "design" && <DesignTab d={draft} change={change} />}
          {tab === "content" && <ContentTab d={draft} change={change} />}
          {tab === "share" && <ShareTab url={url} />}
          {tab === "brands" && <BrandsTab d={draft} change={change} url={url} kit={kitView} />}
          {tab === "questions" && <QuestionsTab items={q.data?.questions ?? []} onChange={() => void qc.invalidateQueries({ queryKey: KEY })} />}
        </div>
        {/* The page, as listeners will see it. */}
        <div className="min-w-0 rounded-3xl bg-[radial-gradient(circle_at_20%_10%,rgba(240,167,31,0.18),transparent_45%),radial-gradient(circle_at_85%_80%,rgba(5,56,119,0.16),transparent_50%)] p-4 ring-1 ring-border lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3 flex justify-center">
            <div className="inline-flex gap-1 rounded-full border border-border bg-card p-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${device === "mobile" ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="bio-phone"><Smartphone className="h-3.5 w-3.5" /> {PHONES.find((p) => p.id === phone)?.name} <ChevronDown className="h-3 w-3 opacity-70" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {PHONES.map((p) => (
                    <DropdownMenuItem key={p.id} onSelect={() => pickPhone(p.id)} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">{phone === p.id ? <Check className="h-3.5 w-3.5 text-[#053877] dark:text-[#8fb5e8]" /> : <span className="w-3.5" />}{p.name}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{p.w} × {p.h}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {([["tablet", "Tablet", Tablet], ["desktop", "Desktop", Monitor]] as const).map(([k, l, I]) => (
                <button key={k} type="button" onClick={() => setDevice(k)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${device === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`}><I className="h-3.5 w-3.5" /> {l}</button>
              ))}
            </div>
          </div>
          <div ref={stage} className="flex justify-center">
            {(() => {
              const ph = PHONES.find((p) => p.id === phone) ?? PHONES[0];
              const size = device === "mobile" ? { w: ph.w, h: ph.h, edge: 10 } : device === "tablet" ? { w: 768, h: 1024, edge: 12 } : null;
              if (!size) return (
                <div className="w-full rounded-xl border border-border shadow-xl"><div className="h-[680px] overflow-y-auto overflow-x-hidden rounded-xl">{page()}</div></div>
              );
              const zoom = Math.min(1, room.w / (size.w + size.edge * 2));
              const tall = Math.min(size.h, Math.max(480, (room.h - 190) / zoom));
              return (
                <div style={{ zoom, width: size.w + size.edge * 2, borderWidth: size.edge }} className={`shrink-0 border-[#111] bg-[#111] shadow-xl ${device === "mobile" ? "rounded-[52px]" : "rounded-[28px]"}`} data-testid="bio-frame">
                  <div style={{ height: tall }} className={`overflow-y-auto overflow-x-hidden ${device === "mobile" ? "rounded-[42px]" : "rounded-[16px]"}`}>
                    {page()}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Profile -----------------------------------------------------------------------

function ProfileTab({ d, view, change, flush, setPreview, knowledge }: { d: Page; view: BioPublic; change: (p: Partial<Page>, now?: boolean) => void; flush: () => Promise<void>; setPreview: (p: BioPublic) => void; knowledge?: { done: number; total: number } }) {
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
  const { toast } = useToast();
  const [drafting, setDrafting] = useState(false);
  const draftBio = async () => {
    setDrafting(true);
    try {
      const r = (await (await apiRequest("POST", "/api/host/bio/draft-bio", {})).json()) as { bio: string };
      if (r.bio) change({ bio: r.bio });
    } catch (e) {
      toast({ title: "Couldn't write one", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };
  return (
    <div className="space-y-4">
      {done < steps.length && (
        <div className="rounded-2xl border border-[#F0A71F]/40 bg-gradient-to-br from-[#F0A71F]/[0.12] to-transparent p-4" data-testid="bio-checklist">
          <div className="flex items-center justify-between"><p className="text-sm font-bold">{steps.length - done === 1 ? "One step to go" : "Finish your page"}</p><span className="rounded-full bg-[#F0A71F] px-2 py-0.5 text-xs font-bold text-[#1a1200]">{done} of {steps.length}</span></div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#F0A71F]/20"><div className="h-full rounded-full bg-gradient-to-r from-[#F0A71F] to-[#e08a00] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ul className="mt-3 space-y-1.5">
            {steps.map((s) => <li key={s.label} className={`flex items-center gap-2 text-sm ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground/50" />} {s.label}</li>)}
          </ul>
        </div>
      )}
      <Card icon={ImagePlus} tone="gold" title="Photos">
      <div className="grid grid-cols-2 gap-3">
        <ImagePick label="Profile photo" kind="avatar" url={d.avatarUrl} round onDone={(u, p) => { change({ avatarUrl: u }); setPreview(p); }} onClear={() => change({ avatarUrl: "" }, true)} />
        <ImagePick label="Cover photo" kind="hero" url={d.heroUrl} note={d.theme.layout === "portrait" ? "Shown with the Banner or Cover layouts" : undefined} onDone={(u, p) => { change({ heroUrl: u }); setPreview(p); }} onClear={() => change({ heroUrl: "" }, true)} />
      </div>
      </Card>
      <Card icon={User} tone="blue" title="About you">
      <Field label="Name on the page"><Input value={d.displayName} onChange={(e) => change({ displayName: e.target.value })} maxLength={80} /></Field>
      <Field label="Your link" hint="3 to 30 letters or numbers. Changing it breaks links you've already shared.">
        <div className="flex items-center rounded-md border border-input bg-background pl-3 text-sm focus-within:ring-2 focus-within:ring-ring">
          <span className="text-muted-foreground">militaryvoices.ai/</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30))} onBlur={() => { if (handle !== d.handle) change({ handle }, true); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="h-9 min-w-0 flex-1 bg-transparent pr-3 outline-none" data-testid="bio-handle" />
        </div>
      </Field>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Bio</span>
          <button type="button" onClick={() => void draftBio()} disabled={drafting} className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#F0A71F] to-[#e08a00] px-2.5 py-1 text-xs font-bold text-[#1a1200] shadow-sm hover:opacity-90 disabled:opacity-60" data-testid="bio-draft">
            {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {d.bio.trim() ? "Rewrite it for me" : "Write it for me"}
          </button>
        </div>
        <Textarea value={d.bio} onChange={(e) => change({ bio: e.target.value })} maxLength={500} rows={3} placeholder="Who you are, what the show is about, who it's for." />
      </div>
      </Card>
      <Card icon={Headphones} tone="green" title="Your podcast and listeners">
      <Field label="Your podcast" hint={hosted ? "Hosted here on MilitaryVoices: new episodes appear on your page by themselves." : "Paste your show's RSS feed and your latest episodes appear, top and centre."}>
        {hosted ? <p className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-emerald-600" /> {view.podcast?.title}</p> : <Input value={d.rssUrl} onChange={(e) => change({ rssUrl: e.target.value })} placeholder="https://feeds.yourhost.com/your-show" />}
      </Field>
      <div className="flex items-center justify-between rounded-xl border border-border p-3">
        <div><p className="text-sm font-semibold">Let listeners message you</p><p className="text-xs text-muted-foreground">A chat button at the top of your page. You reply from Messages; they see it on your page, and by email if they left one.</p></div>
        <Switch checked={d.askEnabled} onCheckedChange={(v) => change({ askEnabled: v }, true)} />
      </div>
      {d.askEnabled && (
        <Field label="Your welcome message" hint="The first thing your chat says, from you.">
          <Input value={d.welcome ?? ""} onChange={(e) => change({ welcome: e.target.value })} maxLength={280} placeholder="Hi! Thanks for listening. What's on your mind?" data-testid="bio-welcome" />
        </Field>
      )}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3" data-testid="bio-ai">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-[#b36b00]" /> Ask my show (AI)</p>
          <p className="text-xs text-muted-foreground">
            {!view.podcast ? "Add your podcast first: it learns from your episodes." : !knowledge?.total ? "It starts learning your episodes as soon as your podcast is here." : knowledge.done < knowledge.total ? `Learning your episodes: ${knowledge.done} of ${knowledge.total} so far. It shows on your page once it knows one.` : `Knows all ${knowledge.done} of your episodes. Listeners ask; it answers from what you said, with the episode and minute.`}
          </p>
        </div>
        <Switch checked={d.aiEnabled} onCheckedChange={(v) => change({ aiEnabled: v }, true)} />
      </div>
      </Card>
      <Card icon={Share2} tone="violet" title="Social icons">
      <div>
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
      </Card>
    </div>
  );
}

const TONES = {
  gold: "bg-[#F0A71F]/15 text-[#b36b00] dark:text-[#F0A71F]",
  blue: "bg-[#053877]/10 text-[#053877] dark:bg-[#8fb5e8]/15 dark:text-[#8fb5e8]",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
} as const;

/** A group of settings in its own card, with a coloured mark. */
function Card({ icon: I, tone, title, children }: { icon: typeof User; tone: keyof typeof TONES; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-bold"><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONES[tone]}`}><I className="h-4 w-4" /></span> {title}</p>
      {children}
    </section>
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
  const c = t.color;
  const dark = t.shade === "dark";
  const ground = dark ? "#0b1020" : "#f5f6fa";
  const ink = dark ? "#ffffff" : "#0b1020";
  const r = (shape: string) => (shape === "pill" ? 999 : shape === "rounded" ? 5 : 1);
  const mini = (style: string, shape: string, w = "w-14") => (
    <span className={`block h-3 ${w}`} style={style === "fill" ? { background: c, borderRadius: r(shape) } : style === "outline" ? { border: `1.5px solid ${c}`, borderRadius: r(shape) } : { background: dark ? "rgba(255,255,255,0.14)" : "#fff", border: "1px solid rgba(11,16,32,0.12)", borderRadius: r(shape) }} />
  );
  return (
    <div className="space-y-4">
      <Card icon={Palette} tone="gold" title="Template">
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((k) => {
            const tp = TEMPLATES[k].theme;
            const tdark = tp.shade === "dark";
            const bg = k === "vibrant" ? `linear-gradient(180deg, ${c}, #0b1020 75%)` : tdark ? "#0b1020" : "#f5f6fa";
            return (
              <Tile key={k} on={t.template === k} onClick={() => set({ ...tp, template: k })} label={TEMPLATES[k].label} note={TEMPLATES[k].note} testid={`bio-template-${k}`}>
                {/* A tiny phone in that template: photo, name, the show, two buttons. */}
                <span className="mx-auto flex h-36 w-[5.5rem] flex-col items-center overflow-hidden rounded-[14px] border-[3px] border-[#111] pb-2" style={{ background: bg }}>
                  {tp.layout === "blend" ? (
                    <span className="h-12 w-full" style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : c, maskImage: "linear-gradient(to bottom, #000 55%, transparent)" }} />
                  ) : tp.layout === "landscape" ? (
                    <span className="relative mb-3 block h-6 w-full" style={{ background: `linear-gradient(135deg, ${c}, #000741)` }}><span className="absolute -bottom-3 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full ring-2" style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : "#888", boxShadow: `0 0 0 2px ${tdark ? "#0b1020" : "#f5f6fa"}` }} /></span>
                  ) : (
                    <span className="mt-2 h-8 w-8 rounded-full" style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : "#888", boxShadow: `0 0 0 2px ${c}` }} />
                  )}
                  <span className="mt-1.5 h-1.5 w-12 rounded" style={{ background: tdark ? "#fff" : "#0b1020" }} />
                  <span className="mt-2 h-6 w-16 rounded-md" style={{ background: tdark ? "rgba(255,255,255,0.1)" : "#fff", border: tdark ? "none" : "1px solid rgba(11,16,32,0.08)" }} />
                  <span className="mt-1.5 flex flex-col items-center gap-1">{mini(tp.linkStyle ?? "fill", tp.linkShape ?? "pill")}{mini(tp.linkStyle ?? "fill", tp.linkShape ?? "pill")}</span>
                </span>
              </Tile>
            );
          })}
        </div>
      </Card>

      <Card icon={Droplet} tone="blue" title="Your colour">
        <div className="flex flex-wrap gap-2.5">
          {SWATCHES.map((sw) => {
            const on = t.color.toLowerCase() === sw.toLowerCase();
            return (
              <button key={sw} type="button" onClick={() => set({ color: sw })} aria-label={sw} className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-transform hover:scale-110 ${on ? "ring-2 ring-[#053877] ring-offset-2 ring-offset-card" : "border-black/10"}`} style={{ background: sw }}>
                {on && <Check className="h-4 w-4" style={{ color: ["#FFFFFF", "#F0A71F", "#CA8A04"].includes(sw.toUpperCase()) ? "#0b1020" : "#ffffff" }} />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="relative h-10 w-10 cursor-pointer overflow-hidden rounded-full border border-border shadow-sm" style={{ background: c }} title="Any colour">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#F0A71F"} onChange={(e) => { setHex(e.target.value); set({ color: e.target.value }); }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
          <Input value={hex} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) set({ color: e.target.value }); }} className="w-28 font-mono" />
          <span className="text-xs text-muted-foreground">Or pick any colour</span>
        </div>
      </Card>

      <Card icon={Headphones} tone="blue" title="Your podcast">
        <div className="grid grid-cols-3 gap-3">
          {([["spotlight", "Spotlight", "The latest, big"], ["list", "List", "Episodes in rows"], ["carousel", "Cards", "Swipe through"]] as const).map(([v, l, n]) => {
            const art = (cls: string) => <span className={`block shrink-0 ${cls}`} style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : `linear-gradient(135deg, ${c}, #000741)` }} />;
            const line = (w: string) => <span className={`block h-1 ${w} rounded`} style={{ background: ink, opacity: 0.7 }} />;
            return (
              <Tile key={v} on={(t.podcastStyle ?? "spotlight") === v} onClick={() => set({ podcastStyle: v })} label={l} note={n} testid={`bio-podstyle-${v}`}>
                <span className="flex h-20 flex-col gap-1 overflow-hidden rounded-lg p-1.5" style={{ background: ground }}>
                  {v === "spotlight" ? <>{art("h-11 w-full rounded")}{line("w-3/4")}<span className="flex items-center gap-1">{art("h-3 w-3 rounded-sm")}{line("w-1/2")}</span></>
                    : v === "list" ? [0, 1, 2, 3].map((i) => <span key={i} className="flex items-center gap-1">{art("h-3.5 w-3.5 rounded-sm")}{line(i % 2 ? "w-2/3" : "w-3/4")}</span>)
                    : <span className="flex gap-1">{[0, 1].map((i) => <span key={i} className="flex w-[70%] shrink-0 flex-col gap-1">{art("h-12 w-full rounded")}{line("w-3/4")}</span>)}</span>}
                </span>
              </Tile>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([["full", "Edge to edge", "Fills the screen"], ["card", "In a card", "With a margin"]] as const).map(([v, l, n]) => (
            <Tile key={v} on={(t.podcastFrame ?? "full") === v} onClick={() => set({ podcastFrame: v })} label={l} note={n} testid={`bio-podframe-${v}`}>
              <span className="flex h-16 flex-col overflow-hidden rounded-lg" style={{ background: ground, padding: v === "card" ? 6 : 0 }}>
                <span className={`flex flex-1 flex-col gap-1 ${v === "card" ? "rounded-md p-1" : ""}`} style={v === "card" ? { background: dark ? "rgba(255,255,255,0.1)" : "#fff" } : {}}>
                  <span className={`block flex-1 ${v === "card" ? "rounded-sm" : ""}`} style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : `linear-gradient(135deg, ${c}, #000741)` }} />
                  <span className={`block h-1 w-2/3 rounded ${v === "full" ? "mx-1 mb-1" : ""}`} style={{ background: ink, opacity: 0.7 }} />
                </span>
              </span>
            </Tile>
          ))}
        </div>
      </Card>

      <Card icon={dark ? Moon : Sun} tone="violet" title="Page and photo">
        <p className="text-xs font-semibold text-muted-foreground">Page</p>
        <div className="grid grid-cols-2 gap-3">
          {([["dark", "Dark"], ["light", "Light"]] as const).map(([v, l]) => (
            <Tile key={v} on={t.shade === v} onClick={() => set({ shade: v })} label={l}>
              <span className="flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg" style={{ background: v === "dark" ? "#0b1020" : "#f5f6fa", border: v === "light" ? "1px solid rgba(11,16,32,0.08)" : "none" }}>
                <span className="h-1.5 w-14 rounded" style={{ background: v === "dark" ? "#fff" : "#0b1020" }} />
                <span className="h-3 w-16 rounded-full" style={{ background: c }} />
              </span>
            </Tile>
          ))}
        </div>
        <p className="pt-1 text-xs font-semibold text-muted-foreground">Top of the page</p>
        <div className="grid grid-cols-3 gap-3">
          {([["portrait", "Classic"], ["hero", "Hero"], ["blend", "Cover photo"], ["landscape", "Banner"], ["shape", "Shape"]] as const).map(([v, l]) => {
            const face = d.avatarUrl ? `center/cover url(${d.avatarUrl})` : "#888";
            return (
              <Tile key={v} on={t.layout === v} onClick={() => set({ layout: v })} label={l} testid={`bio-layout-${v}`}>
                <span className="relative flex h-16 flex-col items-center overflow-hidden rounded-lg" style={{ background: ground }}>
                  {v === "hero" ? <><span className="absolute inset-0" style={{ background: face }} /><span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" /><span className="absolute bottom-2 h-1.5 w-12 rounded bg-white" /></>
                    : v === "blend" ? <span className="h-11 w-full" style={{ background: d.avatarUrl ? face : c, maskImage: "linear-gradient(to bottom, #000 50%, transparent)" }} />
                    : v === "landscape" ? <><span className="h-6 w-full" style={{ background: `linear-gradient(135deg, ${c}, #000741)` }} /><span className="-mt-3 h-6 w-6 rounded-full" style={{ background: face, boxShadow: `0 0 0 2px ${ground}` }} /></>
                    : v === "shape" ? <span className="relative mt-2 h-9 w-9"><span className="absolute -inset-1 rotate-12" style={{ background: c, borderRadius: "58% 42% 38% 62% / 45% 55% 45% 55%" }} /><span className="absolute inset-0" style={{ background: face, borderRadius: "42% 58% 63% 37% / 52% 38% 62% 48%" }} /></span>
                    : <span className="mt-2.5 h-8 w-8 rounded-full" style={{ background: face, boxShadow: `0 0 0 2px ${c}` }} />}
                  {v !== "hero" && <span className="absolute bottom-1.5 h-1 w-10 rounded" style={{ background: ink, opacity: 0.8 }} />}
                </span>
              </Tile>
            );
          })}
        </div>
      </Card>

      <Card icon={Type} tone="green" title="Font and buttons">
        <div className="grid grid-cols-3 gap-3">
          {([["sans", "Modern", "var(--font-sans)"], ["serif", "Classic", "Georgia, serif"], ["mono", "Typewriter", "'JetBrains Mono', monospace"]] as const).map(([v, l, f]) => (
            <Tile key={v} on={t.font === v} onClick={() => set({ font: v })} label={l}>
              <span className="flex h-14 items-center justify-center rounded-lg bg-muted/60 text-3xl font-bold" style={{ fontFamily: f }}>Aa</span>
            </Tile>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {([["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"]] as const).map(([v, l]) => (
            <Tile key={v} on={t.linkShape === v} onClick={() => set({ linkShape: v })} label={l}>
              <span className="flex h-14 items-center justify-center rounded-lg bg-muted/60"><span className="h-6 w-16" style={{ background: c, borderRadius: r(v) }} /></span>
            </Tile>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {([["fill", "Filled"], ["outline", "Outline"], ["soft", "Card"]] as const).map(([v, l]) => (
            <Tile key={v} on={t.linkStyle === v} onClick={() => set({ linkStyle: v })} label={l}>
              <span className="flex h-14 items-center justify-center rounded-lg" style={{ background: ground }}>
                <span className="h-6 w-16" style={v === "fill" ? { background: c, borderRadius: r(t.linkShape) } : v === "outline" ? { border: `2px solid ${c}`, borderRadius: r(t.linkShape) } : { background: dark ? "rgba(255,255,255,0.14)" : "#fff", border: "1px solid rgba(11,16,32,0.12)", borderRadius: r(t.linkShape) }} />
              </span>
            </Tile>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** A visual choice: a little picture of the option, its name, a check when it's the one. */
function Tile({ on, onClick, label, note, testid, children }: { on: boolean; onClick: () => void; label: string; note?: string; testid?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`relative rounded-2xl border-2 p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${on ? "border-[#053877] bg-[#053877]/[0.05] shadow-sm dark:border-[#8fb5e8]" : "border-border bg-background hover:border-[#053877]/40"}`} data-testid={testid}>
      {on && <span className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#053877] text-white shadow"><Check className="h-3 w-3" /></span>}
      {children}
      <span className="mt-1.5 block text-center text-xs font-semibold">{label}</span>
      {note && <span className="block text-center text-[11px] leading-tight text-muted-foreground">{note}</span>}
    </button>
  );
}

// ---- Content -----------------------------------------------------------------------

const KINDS: { type: BioSectionType; label: string; hint: string; icon: typeof Link2; tone: string }[] = [
  { type: "links", label: "Links", hint: "Buttons to your site, store, anything", icon: Link2, tone: "bg-[#053877]/10 text-[#053877] dark:bg-[#8fb5e8]/15 dark:text-[#8fb5e8]" },
  { type: "video", label: "Video", hint: "A YouTube or Vimeo video", icon: Video, tone: "bg-red-500/12 text-red-600 dark:text-red-400" },
  { type: "promo", label: "Promo code", hint: "A sponsor's code, tap to copy", icon: Tag, tone: "bg-[#F0A71F]/15 text-[#b36b00] dark:text-[#F0A71F]" },
  { type: "meeting", label: "Book a meeting", hint: "Your Calendly or booking link", icon: Calendar, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  { type: "text", label: "Text", hint: "A few words of your own", icon: Type, tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
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
  const add = (type: BioSectionType) => { const s = blank(type); put([...d.sections, s]); setOpen(s.id); };
  return (
    <div className="space-y-4">
      <Card icon={Plus} tone="gold" title="Add to your page">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <button key={k.type} type="button" onClick={() => add(k.type)} className="group flex items-center gap-3 rounded-2xl border-2 border-border bg-background p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[#053877]/40 hover:shadow-md" data-testid={`bio-add-${k.type}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><k.icon className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0"><span className="block text-sm font-bold">{k.label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{k.hint}</span></span>
            </button>
          ))}
        </div>
      </Card>
      <Card icon={Layers} tone="blue" title="On your page, in this order">
        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#053877] to-[#0a4a99] p-3 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F0A71F] text-[#1a1200]"><Headphones className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-bold">Your podcast</span><span className="block text-[11px] text-white/70">Always first, under your name</span></span>
        </div>
        {d.sections.length === 0 && <p className="rounded-2xl border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing else yet. Pick something above and it goes here.</p>}
        {d.sections.map((s, i) => {
          const k = KINDS.find((x) => x.type === s.type)!;
          return (
            <div key={s.id} className={`rounded-2xl border-2 bg-background transition-colors ${open === s.id ? "border-[#053877]/50 shadow-sm dark:border-[#8fb5e8]/50" : "border-border"} ${s.visible ? "" : "opacity-60"}`} data-testid={`bio-section-${s.type}`}>
              <div className="flex items-center gap-2 p-2.5">
                <span className="flex flex-col"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Up"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(i, 1)} disabled={i === d.sections.length - 1} className="rounded text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Down"><ArrowDown className="h-3.5 w-3.5" /></button></span>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><k.icon className="h-[18px] w-[18px]" /></span>
                <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{s.title || k.label}</span><span className="block text-xs text-muted-foreground">{k.label}{s.visible ? "" : " · hidden"}</span></button>
                <button type="button" onClick={() => upd(s.id, { visible: !s.visible })} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label={s.visible ? "Hide" : "Show"}>{s.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
                <button type="button" onClick={() => put(d.sections.filter((x) => x.id !== s.id))} className="rounded-full p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label={open === s.id ? "Close" : "Edit"}><ChevronDown className={`h-4 w-4 transition-transform ${open === s.id ? "rotate-180" : ""}`} /></button>
              </div>
              {open === s.id && <div className="space-y-2 border-t border-border p-3"><SectionEditor s={s} upd={(p) => upd(s.id, p)} /></div>}
            </div>
          );
        })}
      </Card>
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

function ShareTab({ url }: { url: string }) {
  const { toast } = useToast();
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: "#000741", light: "#ffffff" } }).then(setQr).catch(() => setQr("")); }, [url]);
  const copy = () => navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied", description: "Paste it in your bio, your show notes, anywhere." }));
  const u = encodeURIComponent(url);
  const line = encodeURIComponent("My podcast, and everything else I do, in one place:");
  const places: { label: string; href: string; bg: string; icon?: typeof Mail; platform?: SocialPlatform }[] = [
    { label: "Text", href: `sms:?&body=${line}%20${u}`, bg: "#16a34a", icon: MessageSquare },
    { label: "Email", href: `mailto:?subject=${encodeURIComponent("My podcast")}&body=${line}%0A%0A${u}`, bg: "#053877", icon: Mail },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, bg: "#1877F2", platform: "facebook" },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, bg: "#0A66C2", platform: "linkedin" },
    { label: "X", href: `https://x.com/intent/post?text=${line}&url=${u}`, bg: "#000000", platform: "x" },
    { label: "Threads", href: `https://www.threads.net/intent/post?text=${line}%20${u}`, bg: "#000000", platform: "threads" },
  ];
  return (
    <div className="space-y-4">
      <Card icon={Share2} tone="gold" title="Send your page">
        <p className="-mt-1 text-xs text-muted-foreground">Or put your link in your Instagram and TikTok bio, your show notes and your email signature.</p>
        <div className="grid grid-cols-4 gap-2">
          {places.map((p) => (
            <a key={p.label} href={p.href} target={p.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 text-center transition-colors hover:bg-muted">
              <span className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm transition-transform group-hover:scale-110" style={{ background: p.bg }}>
                {p.platform ? <PlatformIcon platform={p.platform} className="h-5 w-5" /> : p.icon ? <p.icon className="h-5 w-5" /> : null}
              </span>
              <span className="text-[11px] font-semibold">{p.label}</span>
            </a>
          ))}
          <button type="button" onClick={() => { if (navigator.share) void navigator.share({ url }).catch(() => {}); else void copy(); }} className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 text-center transition-colors hover:bg-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#F0A71F] to-[#e08a00] text-[#1a1200] shadow-sm transition-transform group-hover:scale-110"><Share2 className="h-5 w-5" /></span>
            <span className="text-[11px] font-semibold">More</span>
          </button>
        </div>
      </Card>

      <Card icon={MessageCircle} tone="blue" title="Message me link">
        <p className="-mt-1 text-xs text-muted-foreground">Opens your page with the chat already open. Put it in a post or your show notes: "Questions? Message me."</p>
        <div className="flex gap-2">
          <Input readOnly value={`${url.replace(/^https?:\/\/(www\.)?/, "")}#message`} className="font-mono text-sm" />
          <Button onClick={() => void navigator.clipboard.writeText(`${url}#message`).then(() => toast({ title: "Message me link copied" }))} className="shrink-0 gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid="bio-message-link"><Copy className="h-4 w-4" /> Copy</Button>
        </div>
      </Card>

      {qr && (
        <Card icon={Smartphone} tone="violet" title="QR code">
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#F0A71F]/25 via-[#F0A71F]/10 to-[#053877]/15 p-4">
            <img src={qr} alt="QR code for your page" className="h-32 w-32 shrink-0 rounded-xl bg-white p-1.5 shadow-md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Point a phone camera at it and your page opens.</p>
              <p className="mt-1 text-xs text-muted-foreground">For show notes, slides, table cards and merch.</p>
              <Button asChild size="sm" className="mt-3 gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]"><a href={qr} download="my-page-qr.png"><ArrowDown className="h-4 w-4" /> Download</a></Button>
            </div>
          </div>
        </Card>
      )}

    </div>
  );
}

// ---- Brands (the media kit) --------------------------------------------------------

function BrandsTab({ d, change, url, kit }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; url: string; kit: BioBrandsPublic | null }) {
  const { toast } = useToast();
  const b = d.brands ?? DEFAULT_BRANDS;
  const set = (p: Partial<BioBrands>, now = false) => change({ brands: { ...b, ...p } }, now);
  const link = `${url}/brands`;
  const n = kit?.numbers;
  const rates = n?.perEpisode ? podcastWorthFor(n.perEpisode) : null;
  const fmt = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v));
  const rows: [string, string | null, string][] = [
    ["Downloads per episode", n?.perEpisode ? fmt(n.perEpisode) : null, "Host your show here, or connect your host in Integrations"],
    ["Downloads, last 30 days", n?.last30 ? fmt(n.last30) : null, "Comes with your downloads"],
    ["Social followers", n?.reach ? fmt(n.reach) : null, "Connect your social accounts in Integrations"],
    ["Page views, last 30 days", n?.pageViews30 ? fmt(n.pageViews30) : null, "Share your Rally Point link"],
  ];
  return (
    <div className="space-y-4">
      <Card icon={Handshake} tone="gold" title="Your media kit">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-[#000741] via-[#053877] to-[#0a4a99] p-4 text-white">
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{link.replace(/^https?:\/\/(www\.)?/, "")}</p>
            <p className="text-xs text-white/70">{b.on ? "Send it to any brand. They can ask to sponsor you right from it." : "Off: brands can't open it."}</p>
          </div>
          <Switch checked={b.on} onCheckedChange={(v) => set({ on: v }, true)} data-testid="brands-on" />
        </div>
        {b.on && (
          <div className="flex gap-2">
            <Button onClick={() => void navigator.clipboard.writeText(link).then(() => toast({ title: "Media kit link copied" }))} className="flex-1 gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="brands-copy"><Copy className="h-4 w-4" /> Copy link</Button>
            <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">When a brand asks to sponsor you, our partnerships team gets it and helps you close the deal.</p>
      </Card>

      <Card icon={Eye} tone="blue" title="Your numbers, measured by us">
        <div className="grid grid-cols-2 gap-2">
          {rows.map(([label, v, how]) => (
            <div key={label} className={`rounded-2xl border p-3 ${v ? "border-border bg-background" : "border-dashed border-border"}`}>
              <p className={`text-xl font-bold tabular-nums ${v ? "" : "text-muted-foreground"}`}>{v ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
              {!v && <p className="mt-1 text-[11px] leading-snug text-[#b36b00] dark:text-[#F0A71F]">{how}</p>}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Brands trust these because we measure them. Only the ones we have show on your kit.</p>
      </Card>

      <Card icon={Sparkles} tone="green" title="Your pitch">
        <Field label="Why brands work with you" hint="One or two lines. Leave it empty to use your bio.">
          <Textarea value={b.pitch} onChange={(e) => set({ pitch: e.target.value })} rows={3} maxLength={400} placeholder="I help officer candidates get through OCS. Brands reach them the month before they ship." data-testid="brands-pitch" />
        </Field>
        <Field label="Who listens">
          <Textarea value={b.audience} onChange={(e) => set({ audience: e.target.value })} rows={2} maxLength={400} placeholder="Officer candidates, their families and recent veterans, mostly 22–35, across the US." />
        </Field>
      </Card>

      <Card icon={Tag} tone="violet" title="Sponsorship rates">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">Show my rates</p><p className="text-xs text-muted-foreground">Worked out from your downloads per episode, like Know Your Worth.</p></div>
          <Switch checked={b.showRates} onCheckedChange={(v) => set({ showRates: v }, true)} disabled={!rates} data-testid="brands-rates" />
        </div>
        {rates ? (
          <div className="divide-y divide-border rounded-2xl border border-border">
            {rates.deliverables.map((x) => (
              <div key={x.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{x.label}</span><span className="font-semibold tabular-nums">{Math.round(x.low) === Math.round(x.high) ? `$${Math.round(x.mid).toLocaleString()}` : `$${Math.round(x.low).toLocaleString()}–$${Math.round(x.high).toLocaleString()}`}</span></div>
            ))}
          </div>
        ) : <p className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">Your rates appear here once we can see your downloads.</p>}
      </Card>

      <Card icon={Handshake} tone="gold" title="Brands you've worked with">
        {b.partners.map((p, i) => (
          <div key={p.id} className="flex gap-2">
            <Input value={p.name} onChange={(e) => set({ partners: b.partners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Brand" className="w-2/5" />
            <Input value={p.url} onChange={(e) => set({ partners: b.partners.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https:// (optional)" className="flex-1" />
            <button type="button" onClick={() => set({ partners: b.partners.filter((_, j) => j !== i) }, true)} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => set({ partners: [...b.partners, { id: newId(), name: "", url: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]" data-testid="brands-add-partner"><Plus className="h-3.5 w-3.5" /> Add a brand</button>
      </Card>
    </div>
  );
}

// ---- Questions ---------------------------------------------------------------------

function QuestionsTab({ items, onChange }: { items: ListenerQuestionRow[]; onChange: () => void }) {
  const mark = async (id: number, status: string) => { await apiRequest("PATCH", `/api/host/bio/questions/${id}`, { status }); onChange(); };
  const list = items.filter((x) => x.status !== "archived");
  if (!list.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No messages yet. When a listener taps the chat button on your page, their message lands here and in your email.</p>;
  return (
    <ul className="space-y-3">
      {list.map((x) => <Message key={x.id} x={x} onChange={onChange} archive={() => void mark(x.id, "archived")} />)}
    </ul>
  );
}

/** One listener's message, and the podcaster's reply (it shows in their chat on the page). */
function Message({ x, onChange, archive }: { x: ListenerQuestionRow; onChange: () => void; archive: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = (await (await apiRequest("POST", `/api/host/bio/questions/${x.id}/reply`, { reply: text })).json()) as { emailed: boolean };
      toast({ title: "Reply sent", description: r.emailed ? "They'll see it on your page and in their email." : "They'll see it on your page." });
      setText("");
      onChange();
    } catch (err) {
      toast({ title: "Couldn't send that", description: (err as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <li className={`rounded-2xl border p-4 ${x.status === "new" ? "border-[#F0A71F]/50 bg-[#F0A71F]/[0.05]" : "border-border bg-card"}`} data-testid={`bio-question-${x.id}`}>
      <p className="text-xs text-muted-foreground">{x.name || "A listener"}{x.fromEmail ? ` · ${x.fromEmail}` : ""} · {new Date(x.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{x.episode ? ` · about "${x.episode}"` : ""}</p>
      <p className="mt-1 whitespace-pre-line text-sm">{x.question}</p>
      {x.reply ? (
        <div className="mt-3 rounded-2xl rounded-tl-sm bg-[#053877] px-3 py-2 text-sm text-white">
          <p className="whitespace-pre-line">{x.reply}</p>
          <p className="mt-1 text-[11px] text-white/60">You replied {new Date(x.repliedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
        </div>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} rows={2} maxLength={3000} placeholder={x.fromEmail ? "Write a reply. They'll see it on your page and by email." : "Write a reply. They'll see it on your page."} className="min-h-[2.75rem] flex-1 resize-none" data-testid={`bio-reply-${x.id}`} />
          <Button size="sm" onClick={() => void send()} disabled={!text.trim() || busy} className="h-10 gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Reply</Button>
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs text-muted-foreground" onClick={archive}>Archive</Button>
      </div>
    </li>
  );
}
