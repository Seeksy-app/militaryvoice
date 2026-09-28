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
import { BioFamilyView } from "@/components/BioFamilyView";
import { podcastWorthFor } from "@/lib/worth";
import { useBioFont } from "@/lib/bioFont";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { SWATCHES, TEMPLATES, FONTS, bioPalette, onColor, type BioBackground, type BioFont, DEFAULT_PODCAST, type BioPodcastOptions, DEFAULT_BRANDS, DEFAULT_FAMILY, type BioBrands, type BioBrandsPublic, type BioFamily, type BioFamilyPublic, type BioPublic, type BioSection, type BioSectionType, type BioSocial, type BioTheme } from "@shared/bio";
import type { ListenerQuestionRow, SocialPlatform } from "@shared/schema";
import { X, Users, Heart, Lock, RefreshCw, Handshake, Droplet, Moon, Sun, Headphones, Sparkles, ArrowDown, ArrowUp, Calendar, Check, CheckCircle2, ChevronDown, Circle, Copy, ExternalLink, Eye, EyeOff, ImagePlus, Link2, Loader2, Mail, MessageCircle, Send, MessageSquare, Monitor, Palette, Play, Plus, Share2, Smartphone, Tablet, Tag, Trash2, Type, User, Video, Layers } from "lucide-react";

/**
 * Rally Point (was "My page"): the podcaster's bio page builder. Profile, Design, Content and
 * Share on the left; the page itself on the right, drawn by the very
 * component the public page uses. Everything saves as they go.
 */

type Page = { id: number; handle: string; displayName: string; bio: string; avatarUrl: string; heroUrl: string; theme: BioTheme; sections: BioSection[]; socials: BioSocial[]; rssUrl: string; askEnabled: boolean; welcome: string; aiEnabled: boolean; published: boolean; brands: BioBrands; family: BioFamily; cutoutUrl: string; cutoutFrom: string };
type Resp = { page: Page; url: string; preview: BioPublic; brandsPreview?: BioBrandsPublic | null; familyPreview?: BioFamilyPublic | null; stats: Record<string, number>; questions: ListenerQuestionRow[]; knowledge?: { done: number; total: number } };
type Tab = "profile" | "design" | "content" | "share" | "brands" | "family" | "questions";

const KEY = ["/api/host/bio"];

/** Phones to preview on, at their screen size in CSS points (what a web page lays out to). */
// Screens in CSS points (the 3x panels are 1320 × 2868 and so on); status is the top safe area.
const PHONES = [
  { id: "iphone-18-pro-max", name: "iPhone 18 Pro Max", w: 440, h: 956, cam: "island", r: 62, status: 62, maker: "apple", control: true },
  { id: "iphone-18-pro", name: "iPhone 18 Pro", w: 402, h: 874, cam: "island", r: 62, status: 62, maker: "apple", control: true },
  { id: "iphone-17-pro-max", name: "iPhone 17 Pro Max", w: 440, h: 956, cam: "island", r: 62, status: 62, maker: "apple", control: true },
  { id: "iphone-air", name: "iPhone Air", w: 420, h: 912, cam: "island", r: 62, status: 62, maker: "apple", control: true },
  { id: "iphone-17", name: "iPhone 17 / 17 Pro", w: 402, h: 874, cam: "island", r: 62, status: 62, maker: "apple", control: true },
  { id: "iphone-16-plus", name: "iPhone 16 Plus", w: 430, h: 932, cam: "island", r: 55, status: 59, maker: "apple", control: true },
  { id: "iphone-16e", name: "iPhone 16e", w: 390, h: 844, cam: "notch", r: 47, status: 47, maker: "apple", control: false },
  { id: "galaxy-s25-ultra", name: "Galaxy S25 Ultra", w: 412, h: 891, cam: "hole", r: 26, status: 34, maker: "android", control: false },
  { id: "pixel-10-pro-xl", name: "Pixel 10 Pro XL", w: 412, h: 915, cam: "hole", r: 44, status: 34, maker: "android", control: false },
  { id: "small", name: "Small phone", w: 360, h: 780, cam: "hole", r: 36, status: 34, maker: "android", control: false },
] as const;
type Phone = (typeof PHONES)[number];

/**
 * A phone as it really is: its screen at its size in points (what the page
 * lays out to), its bezel and corners, the Dynamic Island (or notch, or
 * hole-punch camera), the side buttons, the status bar and Safari's address
 * bar. The whole device is scaled to fit, never cropped, so it keeps its shape.
 */
function PhoneFrame({ ph, scale, dark, url, children }: { ph: Phone; scale: number; dark: boolean; url: string; children: React.ReactNode }) {
  // From Apple's iPhone 17 Pro Max drawing: a 72.86 × 158.31 mm active area is the 440 × 956 pt screen,
  // so 6.04 pt a millimetre; the housing is 2.56 mm past it all round (77.98 × 163.43 mm), buttons stand 0.45 mm proud.
  const MM = 440 / 72.86;
  const bezel = ph.maker === "apple" ? 2.56 * MM : 11;
  const W = ph.w + bezel * 2, H = ph.h + bezel * 2;
  const k = H / (163.43 * MM); // the Pro Max's button spots, for the others in proportion
  const statusH = ph.status;
  const barH = ph.maker === "apple" ? 84 : 56;
  const paper = dark ? "#0b1020" : "#f5f6fa";
  const ink = dark ? "#ffffff" : "#0b1020";
  // A button by its centre and length in millimetres from the top of the phone.
  const btn = (side: "l" | "r", centre: number, len: number) => (
    <span key={`${side}${centre}`} className="absolute w-[4px] rounded-[2px]" style={{ [side === "l" ? "left" : "right"]: -0.45 * MM, top: (centre - len / 2) * MM * k, height: len * MM * k, background: "linear-gradient(90deg,#3b3b40,#6b6b72,#3b3b40)" }} />
  );
  const buttons = ph.maker === "apple"
    ? [btn("l", 34.28, 6.9), btn("l", 48.43, 11.2), btn("l", 62.63, 11.2), btn("r", 55.53, 17.7), ...(ph.control ? [btn("r", 111.82, 17.1)] : [])]
    : [btn("r", 38, 18), btn("r", 62, 10)];
  return (
    <div style={{ width: W * scale, height: H * scale }} className="relative shrink-0" data-testid="bio-frame">
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left" }} className="relative">
        {buttons}
        <div className="absolute inset-0" style={{ borderRadius: ph.r + bezel, padding: bezel, background: "#0a0a0c", boxShadow: "0 0 0 1.5px #4a4a52, 0 0 0 3px #1d1d22, 0 40px 80px -30px rgba(11,16,32,0.55)" }}>
          <div className="relative h-full w-full overflow-hidden" style={{ borderRadius: ph.r, background: paper }}>
            {/* Status bar: the time, and signal, wifi and battery, over the page's own colour (as Safari tints it). */}
            <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-between px-8 text-[15px] font-semibold" style={{ height: statusH, background: paper, color: ink, paddingTop: ph.cam === "hole" ? 0 : 6 }}>
              <span className={ph.cam === "hole" ? "text-[13px]" : ""}>9:41</span>
              <span className="flex items-center gap-1.5">
                <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor" aria-hidden><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="6" rx="1" /><rect x="10" y="2.5" width="3" height="8.5" rx="1" /><rect x="15" y="0" width="3" height="11" rx="1" /></svg>
                <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.3 10.3 0 0 0 8 .4C5.2.4 2.7 1.5.8 3.3L2 4.6a8.5 8.5 0 0 1 6-2.4Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.3A7 7 0 0 0 8 3.8a7 7 0 0 0-4.8 1.9L4.4 7c1-.9 2.2-1.4 3.6-1.4Zm0 3.3c.6 0 1.1.2 1.5.6L8 11 6.5 9.5c.4-.4.9-.6 1.5-.6Z" /></svg>
                <span className="relative flex h-[12px] w-[25px] items-center rounded-[4px] border border-current p-[1.5px] opacity-90"><span className="h-full w-[75%] rounded-[2px] bg-current" /><span className="absolute -right-[3px] h-[4px] w-[1.5px] rounded-r bg-current" /></span>
              </span>
            </div>
            {ph.cam === "island" && <span className="absolute left-1/2 z-50 -translate-x-1/2 rounded-full bg-black" style={{ top: 14, height: 37, width: 20.76 * MM }} />}
            {ph.cam === "notch" && <span className="absolute left-1/2 top-0 z-50 h-[32px] w-[160px] -translate-x-1/2 rounded-b-[20px] bg-black" />}
            {ph.cam === "hole" && <span className="absolute left-1/2 top-[10px] z-50 h-[14px] w-[14px] -translate-x-1/2 rounded-full bg-black ring-2 ring-[#1a1a1a]" />}
            <div className="absolute inset-x-0 overflow-y-auto overflow-x-hidden" style={{ top: statusH, bottom: barH }}>{children}</div>
            {/* The browser's address bar, at the foot as on iPhone Safari (and Chrome on Android). */}
            <div className="absolute inset-x-0 bottom-0 z-40 flex flex-col items-center justify-start px-4 pt-2 backdrop-blur-md" style={{ height: barH, background: dark ? "rgba(22,26,40,0.92)" : "rgba(246,246,248,0.92)", borderTop: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }}>
              <div className="flex h-[38px] w-full items-center justify-center gap-1.5 rounded-xl text-[14px]" style={{ background: dark ? "rgba(255,255,255,0.12)" : "#ffffff", color: ink, boxShadow: dark ? "none" : "0 1px 2px rgba(0,0,0,0.08)" }}>
                <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" className="opacity-60" aria-hidden><path d="M2 5V3.5a3 3 0 1 1 6 0V5h.5A1.5 1.5 0 0 1 10 6.5v4A1.5 1.5 0 0 1 8.5 12h-7A1.5 1.5 0 0 1 0 10.5v-4A1.5 1.5 0 0 1 1.5 5H2Zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0V5Z" /></svg>
                <span className="truncate">{url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</span>
              </div>
              {ph.maker === "apple" && <span className="mt-auto mb-2 h-[5px] w-[134px] rounded-full" style={{ background: ink, opacity: 0.85 }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
const newId = () => Math.random().toString(36).slice(2, 10);
/** Once more after a moment when the network drops the request (a deploy switching over, a blip): "Failed to fetch". */
async function again<T>(go: () => Promise<T>): Promise<T> {
  try { return await go(); } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    await new Promise((ok) => setTimeout(ok, 1500));
    return go();
  }
}

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
    cutoutUrl: draft.cutoutFrom && draft.cutoutFrom === draft.avatarUrl ? draft.cutoutUrl : "",
    ai: { enabled: draft.aiEnabled && (preview.ai?.episodes ?? 0) > 0, episodes: preview.ai?.episodes ?? 0 },
    socials: draft.socials.filter((s) => s.on && s.url), sections: draft.sections.filter((s) => s.visible),
  } : null, [draft, preview]);
  // Cutout: made from their profile photo when they pick it, and again when the photo changes.
  const [cutting, setCutting] = useState(false);
  const cutFailed = useRef("");
  useEffect(() => {
    if (!draft || draft.theme.layout !== "cutout" || !draft.avatarUrl || draft.cutoutFrom === draft.avatarUrl || cutting || cutFailed.current === draft.avatarUrl) return;
    setCutting(true);
    void (async () => {
      try {
        const r = await again(() => apiRequest("POST", "/api/host/bio/cutout", {}));
        const j = (await r.json()) as { cutoutUrl: string; preview: BioPublic };
        setDraft((d) => (d ? { ...d, cutoutUrl: j.cutoutUrl, cutoutFrom: d.avatarUrl } : d));
        setPreview(j.preview);
      } catch (e) {
        cutFailed.current = draft.avatarUrl;
        toast({ title: "Couldn't make your cutout", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
      } finally { setCutting(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.theme.layout, draft?.avatarUrl, draft?.cutoutFrom]);

  // The Brands view: the numbers from the server, what they write from the draft.
  const kitView: BioBrandsPublic | null = useMemo(() => draft && q.data?.brandsPreview ? {
    ...q.data.brandsPreview, displayName: draft.displayName, bio: draft.bio, avatarUrl: draft.avatarUrl, theme: draft.theme, kit: draft.brands ?? DEFAULT_BRANDS,
  } : null, [draft, q.data?.brandsPreview]);
  const famView: BioFamilyPublic | null = useMemo(() => {
    if (!draft || !q.data?.familyPreview) return null;
    const { key: _k, ...family } = draft.family ?? DEFAULT_FAMILY;
    return { ...q.data.familyPreview, displayName: draft.displayName, avatarUrl: draft.avatarUrl, heroUrl: draft.heroUrl, theme: draft.theme, askEnabled: draft.askEnabled, family };
  }, [draft, q.data?.familyPreview]);
  const page = () => tab === "brands" && kitView ? <BioBrandsView data={kitView} preview listenUrl={url} />
    : tab === "family" && famView ? <BioFamilyView data={famView} preview />
    : <BioPageView data={view!} preview shareBase={url} />;

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
          {([["view", "Views", Eye, "#053877"], ["click", "Link taps", Link2, "#7c3aed"], ["play", "Plays", Play, "#059669"], ["share", "Shares", Share2, "#0284c7"], ["ask", "Messages", MessageCircle, "#b36b00"]] as const).map(([k, l, I, c]) => (
            <div key={k} className="flex items-center gap-3 rounded-2xl border border-[#d9e0ea] bg-white p-3 text-[#0b1020] shadow-sm transition-shadow hover:shadow-md">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${c}14`, color: c }}><I className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block text-2xl font-bold leading-none tabular-nums">{q.data?.stats?.[k] ?? 0}</span><span className="mt-1 block text-[11px] text-[#0b1020]/60">{l}</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm" role="tablist">
        {([["profile", "Profile", User], ["design", "Design", Palette], ["content", "Content", Layers], ["share", "Share", Share2], ["brands", "Brands", Handshake], ["family", "Family", Heart], ["questions", "Messages", MessageCircle]] as const).map(([k, l, I]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === k ? "bg-[#053877] text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} data-testid={`bio-tab-${k}`}>
            <I className="h-4 w-4" /> {l}{k === "questions" && newQs > 0 && <span className="rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{newQs}</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "profile" && <ProfileTab d={draft} view={view} change={change} flush={flush} setPreview={setPreview} knowledge={q.data?.knowledge} />}
          {tab === "design" && <DesignTab d={draft} change={change} cutting={cutting} />}
          {tab === "content" && <ContentTab d={draft} change={change} />}
          {tab === "share" && <ShareTab url={url} />}
          {tab === "brands" && <BrandsTab d={draft} change={change} url={url} kit={kitView} />}
          {tab === "family" && <FamilyTab d={draft} change={change} flush={flush} url={url} episodes={q.data?.familyPreview?.podcast?.episodes ?? []} />}
          {tab === "questions" && <QuestionsTab items={q.data?.questions ?? []} onChange={() => void qc.invalidateQueries({ queryKey: KEY })} />}
        </div>
        {/* The page, as listeners will see it. */}
        <div className="min-w-0 rounded-3xl bg-white p-4 dark:bg-card ring-1 ring-border lg:sticky lg:top-20 lg:self-start">
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
              const avail = { w: room.w - 16, h: Math.max(520, room.h - 170) };
              if (device === "desktop") return (
                <div className="w-full rounded-xl border border-border shadow-xl"><div className="h-[680px] overflow-y-auto overflow-x-hidden rounded-xl">{page()}</div></div>
              );
              if (device === "tablet") {
                const W = 768 + 28, H = 1024 + 28;
                const sc = Math.min(1, avail.w / W, avail.h / H);
                return (
                  <div style={{ width: W * sc, height: H * sc }} className="shrink-0" data-testid="bio-frame">
                    <div style={{ width: W, height: H, transform: `scale(${sc})`, transformOrigin: "top left" }} className="rounded-[36px] bg-[#0a0a0c] p-[14px] shadow-xl ring-1 ring-[#4a4a52]">
                      <div className="h-full overflow-y-auto overflow-x-hidden rounded-[22px]">{page()}</div>
                    </div>
                  </div>
                );
              }
              const bezel = ph.maker === "apple" ? 2.56 * (440 / 72.86) : 11;
              const sc = Math.min(1, avail.w / (ph.w + bezel * 2 + 8), avail.h / (ph.h + bezel * 2));
              return <PhoneFrame ph={ph} scale={sc} dark={(draft.theme.shade ?? "dark") === "dark"} url={url}>{page()}</PhoneFrame>;
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
  const [hideSteps, setHideSteps] = useState(() => { try { return localStorage.getItem("mv_bio_steps_hidden") === "1"; } catch { return false; } });
  const dismissSteps = () => { setHideSteps(true); try { localStorage.setItem("mv_bio_steps_hidden", "1"); } catch { /* this visit */ } };
  const move = (i: number, dir: -1 | 1) => { const s = [...d.socials]; const j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; change({ socials: s }); };
  const hosted = /\/feed\//.test(view.podcast?.feedUrl ?? "");
  const { toast } = useToast();
  const [drafting, setDrafting] = useState(false);
  const draftBio = async () => {
    setDrafting(true);
    try {
      const r = (await (await again(() => apiRequest("POST", "/api/host/bio/draft-bio", {}))).json()) as { bio: string };
      if (r.bio) change({ bio: r.bio });
    } catch (e) {
      toast({ title: "Couldn't write one", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };
  return (
    <div className="space-y-4">
      {done < steps.length && !hideSteps && (
        <div className="rounded-2xl border border-[#F0A71F]/50 bg-[#FFF6E0] p-4 dark:bg-[#F0A71F]/10" data-testid="bio-checklist">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">{steps.length - done === 1 ? "One step to go" : "Finish your page"}</p>
            <span className="ml-auto rounded-full bg-[#F0A71F] px-2 py-0.5 text-xs font-bold text-[#1a1200]">{done} of {steps.length}</span>
            <button type="button" onClick={dismissSteps} aria-label="Hide this" title="Hide this" className="flex h-7 w-7 items-center justify-center rounded-full text-[#8a5a00] hover:bg-[#F0A71F]/20 dark:text-[#F0A71F]" data-testid="bio-checklist-close"><X className="h-4 w-4" /></button>
          </div>
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

/** A photo for one view only (Brands, Family): uploaded, then saved on that view. */
function ViewPhoto({ kind, url, fallback, note, onChange }: { kind: "brands" | "family"; url: string; fallback: string; note: string; onChange: (url: string) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await again(() => fetch(`/api/host/bio/image/${kind}`, { method: "POST", body: fd, credentials: "include" }));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't use that photo.");
      onChange(j.url);
    } catch (e) {
      toast({ title: "Photo not changed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const shown = url || fallback;
  return (
    <div className="flex items-center gap-4">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-dashed border-border bg-muted/40" data-testid={`${kind}-photo`}>
        {shown ? <img src={shown} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="m-auto h-5 w-5 text-muted-foreground" />}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-semibold text-white ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change"}</span>
      </button>
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{url ? "Its own photo" : "Your profile photo"}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
        <div className="mt-1 flex gap-3 text-xs font-semibold">
          <button type="button" onClick={() => input.current?.click()} className="text-[#053877] dark:text-[#8fb5e8]">{url ? "Change" : "Use a different photo"}</button>
          {url && <button type="button" onClick={() => onChange("")} className="text-muted-foreground hover:text-foreground">Use my profile photo</button>}
        </div>
      </div>
    </div>
  );
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
      const r = await again(() => fetch(`/api/host/bio/image/${kind}`, { method: "POST", body: fd, credentials: "include" }));
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

function DesignTab({ d, change, cutting = false }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; cutting?: boolean }) {
  const t = d.theme;
  const set = (p: Partial<BioTheme>) => change({ theme: { ...t, ...p } });
  const c = t.color;
  const pal = bioPalette(t);
  const dark = pal.dark;
  const ground = pal.paper;
  const ink = pal.ink;
  const bgv = t.background ?? { mode: "solid" as const, color: "", image: "" };
  const setBg = (p: Partial<BioBackground>) => set({ background: { ...bgv, ...p } });
  const r = (shape: string) => (shape === "pill" ? 999 : shape === "rounded" ? 5 : shape === "squircle" ? 7 : 1);
  const mini = (style: string, shape: string, w = "w-14") => (
    <span className={`block h-3 ${w}`} style={style === "fill" ? { background: c, borderRadius: r(shape) } : style === "outline" ? { border: `1.5px solid ${c}`, borderRadius: r(shape) } : { background: dark ? "rgba(255,255,255,0.14)" : "#fff", border: "1px solid rgba(11,16,32,0.12)", borderRadius: r(shape) }} />
  );
  const bgIn = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const { toast } = useToast();
  const uploadBg = async (f: File) => {
    setBgBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await again(() => fetch("/api/host/bio/image/bg", { method: "POST", body: fd, credentials: "include" }));
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || "Couldn't use that image.");
      setBg({ mode: "image", image: j.url });
    } catch (e) {
      toast({ title: "Background not changed", description: (e as Error).message, variant: "destructive" });
    } finally { setBgBusy(false); if (bgIn.current) bgIn.current.value = ""; }
  };
  const seg = (on: boolean) => `flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`;
  const label = (text: string, hint?: string) => <div><p className="text-sm font-semibold">{text}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
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

      <Card icon={ImagePlus} tone="violet" title="Top of the page">
        <div className="grid grid-cols-3 gap-3">
          {([["portrait", "Classic"], ["hero", "Hero"], ["cutout", "Cutout"], ["blend", "Cover photo"], ["landscape", "Banner"], ["shape", "Shape"]] as const).map(([v, l]) => {
            const face = d.avatarUrl ? `center/cover url(${d.avatarUrl})` : "#888";
            return (
              <Tile key={v} on={t.layout === v} onClick={() => set({ layout: v })} label={l} note={v === "cutout" && cutting ? "Cutting you out…" : undefined} testid={`bio-layout-${v}`}>
                <span className="relative flex h-16 flex-col items-center overflow-hidden rounded-lg" style={{ background: ground }}>
                  {v === "cutout" ? <><span className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 35%, ${c}, ${ground})` }} /><span className="absolute left-1/2 top-2 -translate-x-1/2 text-[13px] font-black uppercase leading-none" style={{ color: ink, opacity: 0.8 }}>{(d.displayName || "Name").split(" ")[0].slice(0, 7)}</span>{d.cutoutUrl && d.cutoutFrom === d.avatarUrl ? <img src={d.cutoutUrl} alt="" className="absolute bottom-0 left-1/2 h-[52px] -translate-x-1/2 object-contain" /> : <span className="absolute bottom-0 left-1/2 h-10 w-9 -translate-x-1/2 rounded-t-full" style={{ background: face }} />}</>
                    : v === "hero" ? <><span className="absolute inset-0" style={{ background: face }} /><span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" /><span className="absolute bottom-2 h-1.5 w-12 rounded bg-white" /></>
                    : v === "blend" ? <span className="h-11 w-full" style={{ background: d.avatarUrl ? face : c, maskImage: "linear-gradient(to bottom, #000 50%, transparent)" }} />
                    : v === "landscape" ? <><span className="h-6 w-full" style={{ background: `linear-gradient(135deg, ${c}, #000741)` }} /><span className="-mt-3 h-6 w-6 rounded-full" style={{ background: face, boxShadow: `0 0 0 2px ${ground}` }} /></>
                    : v === "shape" ? <span className="relative mt-2 h-9 w-9"><span className="absolute -inset-1 rotate-12" style={{ background: c, borderRadius: "58% 42% 38% 62% / 45% 55% 45% 55%" }} /><span className="absolute inset-0" style={{ background: face, borderRadius: "42% 58% 63% 37% / 52% 38% 62% 48%" }} /></span>
                    : <span className="mt-2.5 h-8 w-8 rounded-full" style={{ background: face, boxShadow: `0 0 0 2px ${c}` }} />}
                  {v !== "hero" && v !== "cutout" && <span className="absolute bottom-1.5 h-1 w-10 rounded" style={{ background: ink, opacity: 0.8 }} />}
                </span>
              </Tile>
            );
          })}
        </div>
        {(t.layout === "blend" || t.layout === "hero" || t.layout === "landscape") && (
          <div>
            {label("Image position", "Move the crop up or down if it cuts off a head.")}
            <div className="mt-2 flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground">Top</span>
              <input type="range" min={0} max={100} step={1} value={t.imageY ?? 50} onChange={(e) => set({ imageY: Number(e.target.value) })} className="h-2 flex-1 cursor-pointer accent-[#053877]" data-testid="bio-image-y" />
              <span className="text-[11px] text-muted-foreground">Bottom</span>
            </div>
          </div>
        )}
        {(t.layout === "portrait" || t.layout === "shape") && (
          <div>
            {label("Photo size")}
            <div className="mt-2 flex gap-1 rounded-full border border-border p-1">
              {([["s", "Small"], ["m", "Medium"], ["l", "Large"]] as const).map(([v, l]) => <button key={v} type="button" onClick={() => set({ avatarSize: v })} className={seg((t.avatarSize ?? "m") === v)} data-testid={`bio-avatar-${v}`}>{l}</button>)}
            </div>
          </div>
        )}
      </Card>

      <Card icon={Droplet} tone="blue" title="Colours">
        {label("Theme colour", "Headings, badges and buttons.")}
        <ColourPick value={t.color} onPick={(v) => set({ color: v })} testid="bio-colour" />
        <div className="border-t border-border pt-3">
          {label("Link colour", "Your link buttons.")}
        </div>
        <ColourPick value={t.linkColor || t.color} onPick={(v) => set({ linkColor: v })} testid="bio-link-colour" />
        {t.linkColor && <button type="button" onClick={() => set({ linkColor: "" })} className="w-fit rounded-full border border-[#053877]/40 px-3 py-1.5 text-xs font-semibold text-[#053877] hover:bg-[#053877]/5 dark:text-[#8fb5e8]">Reset to theme colour</button>}
      </Card>

      <Card icon={dark ? Moon : Sun} tone="gold" title="Page">
        {label("Shade", "How light or dark the page is.")}
        <div className="grid grid-cols-5 gap-2">
          {([["none", "None", "#ffffff"], ["minimal", "Minimal", "#f9fafb"], ["light", "Light", "#f3f4f6"], ["tint", "Tint", `${c}22`], ["dark", "Dark", "#0b1020"]] as const).map(([v, l, bgc]) => (
            <Tile key={v} on={(t.shade as string) === v} onClick={() => set({ shade: v, ...(bgv.mode === "solid" && bgv.color ? { background: { ...bgv, color: "" } } : {}) })} label={l} testid={`bio-shade-${v}`}>
              <span className="flex h-10 flex-col items-center justify-center gap-1 rounded-lg border border-black/5" style={{ background: bgc }}>
                <span className="h-1 w-7 rounded" style={{ background: v === "dark" ? "#fff" : "#0b1020", opacity: 0.7 }} />
                <span className="h-1 w-5 rounded" style={{ background: v === "dark" ? "#fff" : "#0b1020", opacity: 0.4 }} />
              </span>
            </Tile>
          ))}
        </div>
        <div className="border-t border-border pt-3">{label("Background")}</div>
        <div className="flex gap-1 rounded-full border border-border p-1">
          {(["solid", "gradient", "image"] as const).map((m) => <button key={m} type="button" onClick={() => setBg({ mode: m })} className={`${seg(bgv.mode === m)} capitalize`} data-testid={`bio-bg-${m}`}>{m}</button>)}
        </div>
        {bgv.mode === "solid" && (
          <>
            <ColourPick value={bgv.color || pal.paper} onPick={(v) => setBg({ color: v })} testid="bio-bg-colour" />
            {bgv.color && <button type="button" onClick={() => setBg({ color: "" })} className="w-fit rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">Use the shade's colour</button>}
          </>
        )}
        {bgv.mode === "gradient" && (
          <>
            <div className="h-16 w-full rounded-xl border border-border" style={{ background: pal.background }} />
            <p className="text-[11px] text-muted-foreground">From your theme colour at the top, down to:</p>
            <ColourPick value={bgv.color || pal.paper} onPick={(v) => setBg({ color: v })} testid="bio-bg-gradient" />
          </>
        )}
        {bgv.mode === "image" && (
          <>
            <input ref={bgIn} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadBg(e.target.files[0])} />
            <button type="button" onClick={() => bgIn.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-4 transition-colors hover:border-[#053877]" data-testid="bio-bg-upload">
              {bgv.image ? <img src={bgv.image} alt="" className="h-24 w-full rounded-lg object-cover" /> : bgBusy ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /> : <ImagePlus className="h-7 w-7 text-muted-foreground" />}
              <span className="text-xs font-semibold text-muted-foreground">{bgv.image ? "Change image" : "Upload an image"}</span>
            </button>
            <p className="text-[11px] text-muted-foreground">Dark shade puts a dark wash over it; the others, a light one, so your words stay readable.</p>
            {bgv.image && <button type="button" onClick={() => setBg({ image: "", mode: "solid" })} className="w-fit text-xs font-semibold text-destructive">Remove image</button>}
          </>
        )}
      </Card>

      <Card icon={Type} tone="green" title="Font">
        <div className="space-y-2">
          {(Object.keys(FONTS) as BioFont[]).map((f) => (
            <FontRow key={f} font={f} on={t.font === f} onPick={() => set({ font: f })} />
          ))}
        </div>
      </Card>

      <Card icon={Layers} tone="blue" title="Buttons">
        {label("Shape")}
        <div className="grid grid-cols-4 gap-2">
          {([["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"], ["squircle", "Squircle"]] as const).map(([v, l]) => (
            <Tile key={v} on={t.linkShape === v} onClick={() => set({ linkShape: v })} label={l} testid={`bio-shape-${v}`}>
              <span className="flex h-12 items-center justify-center rounded-lg bg-muted/60"><span className="h-6 w-14" style={{ background: t.linkColor || c, borderRadius: r(v) }} /></span>
            </Tile>
          ))}
        </div>
        {label("Style")}
        <div className="grid grid-cols-2 gap-2">
          {([["fill", "Fill"], ["outline", "Outline"], ["soft", "Soft shadow"], ["hard", "Hard shadow"]] as const).map(([v, l]) => {
            const lc = t.linkColor || c;
            return (
              <Tile key={v} on={t.linkStyle === v} onClick={() => set({ linkStyle: v })} label={l} testid={`bio-style-${v}`}>
                <span className="flex h-14 items-center justify-center rounded-lg" style={{ background: ground }}>
                  <span className="flex h-8 w-28 items-center justify-center text-[11px] font-semibold" style={v === "fill" ? { background: lc, color: onColor(lc), borderRadius: r(t.linkShape) } : v === "outline" ? { border: `2px solid ${lc}`, color: ink, borderRadius: r(t.linkShape) } : v === "hard" ? { background: dark ? "#141a2c" : "#fff", border: `2px solid ${dark ? "#fff" : "#0b1020"}`, boxShadow: `3px 3px 0 ${lc}`, color: ink, borderRadius: r(t.linkShape) } : { background: dark ? "rgba(255,255,255,0.1)" : "#fff", boxShadow: "0 4px 12px rgba(11,16,32,0.14)", color: ink, borderRadius: r(t.linkShape) }}>Sample</span>
                </span>
              </Tile>
            );
          })}
        </div>
      </Card>

      <Card icon={Sparkles} tone="violet" title="Branding">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <div><p className="text-sm font-semibold">Show "Made with MilitaryVoices.ai"</p><p className="text-xs text-muted-foreground">A small line at the foot of your page.</p></div>
          <Switch checked={t.branding ?? true} onCheckedChange={(v) => set({ branding: v })} data-testid="bio-branding" />
        </div>
      </Card>
    </div>
  );
}

/** A colour: the swatches, and any colour by picker or hex. */
function ColourPick({ value, onPick, testid }: { value: string; onPick: (v: string) => void; testid?: string }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="space-y-2.5" data-testid={testid}>
      <div className="grid grid-cols-8 gap-2">
        {SWATCHES.map((sw) => {
          const on = value.toLowerCase() === sw.toLowerCase();
          return (
            <button key={sw} type="button" onClick={() => onPick(sw)} aria-label={sw} className={`flex aspect-square w-full items-center justify-center rounded-full border shadow-sm transition-transform hover:scale-110 ${on ? "ring-2 ring-[#053877] ring-offset-2 ring-offset-card" : "border-black/10"}`} style={{ background: sw }}>
              {on && <Check className="h-4 w-4" style={{ color: onColor(sw) }} />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border shadow-sm" style={{ background: /^#[0-9a-f]{6}$/i.test(hex) ? hex : value }} title="Any colour">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#F0A71F"} onChange={(e) => { setHex(e.target.value); onPick(e.target.value); }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <Input value={hex} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onPick(e.target.value); }} className="h-9 flex-1 font-mono uppercase" maxLength={7} />
      </div>
    </div>
  );
}

/** A typeface, shown in itself. */
function FontRow({ font, on, onPick }: { font: BioFont; on: boolean; onPick: () => void }) {
  useBioFont(font);
  const f = FONTS[font];
  return (
    <button type="button" onClick={onPick} className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition-all ${on ? "border-[#053877] bg-[#053877]/[0.05] dark:border-[#8fb5e8]" : "border-border hover:border-[#053877]/40"}`} style={{ fontFamily: f.css }} data-testid={`bio-font-${font}`}>
      <span className="text-[15px]">{f.label}</span>
      <span className="flex items-center gap-2"><span className="text-2xl font-bold">Aa</span>{on && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#053877] text-white"><Check className="h-3 w-3" /></span>}</span>
    </button>
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
        <PodcastBlock d={d} change={change} open={open === "podcast"} toggle={() => setOpen(open === "podcast" ? null : "podcast")} />
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

/** Your podcast, always first: open it to design it (its look, frame, heading, episodes and buttons). */
function PodcastBlock({ d, change, open, toggle }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; open: boolean; toggle: () => void }) {
  const o = { ...DEFAULT_PODCAST, ...(d.theme.podcast ?? {}) };
  const set = (p: Partial<BioPodcastOptions>, now = false) => change({ theme: { ...d.theme, podcast: { ...o, ...p } } }, now);
  const setTheme = (p: Partial<BioTheme>) => change({ theme: { ...d.theme, ...p } }, true);
  const pal = bioPalette(d.theme);
  const pill = (on: boolean) => `rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border text-muted-foreground hover:border-[#053877]/40"}`;
  return (
    <div className={`overflow-hidden rounded-2xl ${o.on ? "" : "opacity-70"}`} data-testid="bio-podcast-block">
      <div className="flex items-center gap-3 bg-gradient-to-r from-[#053877] to-[#0a4a99] p-3 text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F0A71F] text-[#1a1200]"><Headphones className="h-[18px] w-[18px]" /></span>
        <button type="button" onClick={toggle} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-bold">{o.heading.trim() || "Your podcast"}</span><span className="block text-[11px] text-white/70">{o.on ? `First, under your name · ${o.count} episodes` : "Hidden"}</span></button>
        <button type="button" onClick={() => set({ on: !o.on }, true)} className="rounded-full p-1.5 text-white/80 hover:bg-white/10" aria-label={o.on ? "Hide" : "Show"}>{o.on ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
        <button type="button" onClick={toggle} className="rounded-full p-1.5 text-white/80 hover:bg-white/10" aria-label={open ? "Close" : "Options"} data-testid="bio-podcast-options"><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
      </div>
      {open && (
        <div className="space-y-3 border-2 border-t-0 border-[#053877]/30 bg-background p-3">
          <Field label="Heading" hint="Leave it empty to use your show's name.">
            <Input value={o.heading} onChange={(e) => set({ heading: e.target.value })} maxLength={80} placeholder="Latest from the show" />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Episodes to show</p>
            <div className="flex gap-2">{[3, 5, 10].map((n) => <button key={n} type="button" onClick={() => set({ count: n }, true)} className={pill(o.count === n)}>{n}</button>)}</div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Buttons under it</p>
            <div className="flex flex-wrap gap-2">
              {([["apple", "Apple Podcasts"], ["spotify", "Spotify"], ["all", "All episodes"], ["rss", "RSS"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => set({ [k]: !o[k] } as Partial<BioPodcastOptions>, true)} className={pill(o[k])}>{o[k] && <Check className="mr-1 inline h-3 w-3" />}{l}</button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Apple and Spotify show once you add your show's links on the Podcast screen.</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Look</p>
            <div className="grid grid-cols-3 gap-2">
              {([["spotlight", "Spotlight", "The latest, big"], ["list", "List", "Episodes in rows"], ["carousel", "Cards", "Swipe through"]] as const).map(([v, l, n]) => {
                const art = (cls: string) => <span className={`block shrink-0 ${cls}`} style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : `linear-gradient(135deg, ${d.theme.color}, #000741)` }} />;
                const ln = (w: string) => <span className={`block h-1 ${w} rounded`} style={{ background: pal.ink, opacity: 0.7 }} />;
                return (
                  <Tile key={v} on={(d.theme.podcastStyle ?? "spotlight") === v} onClick={() => setTheme({ podcastStyle: v })} label={l} note={n} testid={`bio-podstyle-${v}`}>
                    <span className="flex h-20 flex-col gap-1 overflow-hidden rounded-lg p-1.5" style={{ background: pal.paper }}>
                      {v === "spotlight" ? <>{art("h-11 w-full rounded")}{ln("w-3/4")}<span className="flex items-center gap-1">{art("h-3 w-3 rounded-sm")}{ln("w-1/2")}</span></>
                        : v === "list" ? [0, 1, 2, 3].map((i) => <span key={i} className="flex items-center gap-1">{art("h-3.5 w-3.5 rounded-sm")}{ln(i % 2 ? "w-2/3" : "w-3/4")}</span>)
                        : <span className="flex gap-1">{[0, 1].map((i) => <span key={i} className="flex w-[70%] shrink-0 flex-col gap-1">{art("h-12 w-full rounded")}{ln("w-3/4")}</span>)}</span>}
                    </span>
                  </Tile>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([["full", "Edge to edge", "Fills the screen"], ["card", "In a card", "With a margin"]] as const).map(([v, l, n]) => (
              <Tile key={v} on={(d.theme.podcastFrame ?? "full") === v} onClick={() => setTheme({ podcastFrame: v })} label={l} note={n} testid={`bio-podframe-${v}`}>
                <span className="flex h-14 flex-col overflow-hidden rounded-lg" style={{ background: pal.paper, padding: v === "card" ? 6 : 0 }}>
                  <span className={`flex flex-1 flex-col gap-1 ${v === "card" ? "rounded-md p-1" : ""}`} style={v === "card" ? { background: pal.dark ? "rgba(255,255,255,0.1)" : "#fff" } : {}}>
                    <span className={`block flex-1 ${v === "card" ? "rounded-sm" : ""}`} style={{ background: d.avatarUrl ? `center/cover url(${d.avatarUrl})` : `linear-gradient(135deg, ${d.theme.color}, #000741)` }} />
                    <span className={`block h-1 w-2/3 rounded ${v === "full" ? "mx-1 mb-1" : ""}`} style={{ background: pal.ink, opacity: 0.7 }} />
                  </span>
                </span>
              </Tile>
            ))}
          </div>
        </div>
      )}
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
        <ViewPhoto kind="brands" url={b.photo ?? ""} fallback={d.avatarUrl} note="A professional headshot works best for brands." onChange={(u) => set({ photo: u }, true)} />
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

      <AudienceCard kit={kit} />

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

/** The audience data behind the kit: read from Discovery (once a month at most), shown to brands from our copy. */
function AudienceCard({ kit }: { kit: BioBrandsPublic | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const a = kit?.audience;
  const load = async () => {
    setBusy(true);
    try {
      const r = await apiRequest("GET", "/api/host/my-analytics");
      const j = (await r.json()) as { none?: boolean };
      if (j.none) throw new Error("Connect Instagram, YouTube or TikTok in Integrations first.");
      await qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Audience data added", description: "It's on your media kit now." });
    } catch (e) {
      toast({ title: "Couldn't load your audience", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <Card icon={Users} tone="violet" title="Your audience">
      {a ? (
        <>
          <p className="text-sm">From <b>@{a.handle}</b> on {platformLabel(a.platform as SocialPlatform)}{a.asOf ? `, measured ${new Date(a.asOf).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}.</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Engagement", a.engagementRate != null ? `${a.engagementRate.toFixed(1)}%` : "—"], ["Real followers", a.realPct != null ? `${Math.round(a.realPct)}%` : "—"], ["Men / women", a.malePct != null ? `${Math.round(a.malePct)} / ${Math.round(a.femalePct ?? 0)}` : "—"]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-border p-2"><p className="text-base font-bold tabular-nums">{v}</p><p className="text-[10px] text-muted-foreground">{l}</p></div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Ages, countries, interests and the brands your audience follows show on your kit. It refreshes each month when you open My analytics.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Add who your audience really is: ages, men and women, countries, interests and the brands they follow. Brands decide on this.</p>
          <Button onClick={() => void load()} disabled={busy} className="w-full gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid="brands-load-audience">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Add my audience data</Button>
        </>
      )}
    </Card>
  );
}

// ---- Family (a private page) --------------------------------------------------------

function FamilyTab({ d, change, flush, url, episodes }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; flush: () => Promise<void>; url: string; episodes: { id: string; title: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const f = d.family ?? DEFAULT_FAMILY;
  const set = (p: Partial<BioFamily>, now = false) => change({ family: { ...f, ...p } }, now);
  const link = `${url}/family/${f.key}`;
  const photoIn = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const addPhotos = async (files: FileList) => {
    const list = Array.from(files).slice(0, Math.max(0, 24 - f.photos.length));
    setUploading(list.length);
    const added: BioFamily["photos"] = [];
    for (const file of list) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await again(() => fetch("/api/host/bio/image/family", { method: "POST", body: fd, credentials: "include" }));
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Couldn't use that photo.");
        added.push({ id: newId(), url: j.url, caption: "" });
      } catch (e) {
        toast({ title: "A photo didn't upload", description: (e as Error).message, variant: "destructive" });
      }
      setUploading((n) => n - 1);
    }
    if (added.length) set({ photos: [...f.photos, ...added] }, true);
    if (photoIn.current) photoIn.current.value = "";
  };
  const newLink = async () => {
    if (!window.confirm("Make a new family link? The old one stops working, so you'll need to send the new one to your family.")) return;
    await flush();
    await apiRequest("PATCH", "/api/host/bio", { family: { resetKey: true } });
    await qc.invalidateQueries({ queryKey: KEY });
    const r = (await (await apiRequest("GET", "/api/host/bio")).json()) as Resp;
    change({ family: { ...f, key: r.page.family.key } });
    toast({ title: "New family link made", description: "The old link no longer works." });
  };
  return (
    <div className="space-y-4">
      <Card icon={Heart} tone="gold" title="Your family page">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-[#7a2e0e] via-[#b35a1f] to-[#F0A71F] p-4 text-white">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Lock className="h-3.5 w-3.5" /> Private link</p>
            <p className="text-xs text-white/80">{f.on ? "Only people you send it to can open it. It isn't listed or searchable." : "Off: the link doesn't open."}</p>
          </div>
          <Switch checked={f.on} onCheckedChange={(v) => set({ on: v }, true)} data-testid="family-on" />
        </div>
        {f.on && f.key && (
          <>
            <div className="flex gap-2">
              <Button onClick={() => void navigator.clipboard.writeText(link).then(() => toast({ title: "Family link copied", description: "Send it by text or email to the people you love." }))} className="flex-1 gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="family-copy"><Copy className="h-4 w-4" /> Copy link</Button>
              <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
              <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={`sms:?&body=${encodeURIComponent(`I made a page for you: ${link}`)}`}><MessageSquare className="h-4 w-4" /> Text</a></Button>
            </div>
            <button type="button" onClick={() => void newLink()} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="family-reset"><RefreshCw className="h-3 w-3" /> Make a new link (the old one stops working)</button>
          </>
        )}
        <ViewPhoto kind="family" url={f.photo ?? ""} fallback={d.heroUrl || d.avatarUrl} note="The big photo at the top. One with family, or in uniform." onChange={(u) => set({ photo: u }, true)} />
      </Card>

      <Card icon={Sparkles} tone="green" title="In your words">
        <Field label="A note to your family" hint="It sits at the top, like a letter.">
          <Textarea value={f.note} onChange={(e) => set({ note: e.target.value })} rows={4} maxLength={1000} placeholder="Mom, Dad: this is what I've been working on. Thank you for always being in my corner." data-testid="family-note-input" />
        </Field>
        <Field label="Your story">
          <Textarea value={f.story} onChange={(e) => set({ story: e.target.value })} rows={5} maxLength={4000} placeholder="Why you served, what it taught you, and why you started the show." />
        </Field>
      </Card>

      <Card icon={Calendar} tone="blue" title="Along the way">
        {f.milestones.map((m, i) => (
          <div key={m.id} className="space-y-2 rounded-2xl border border-border p-3">
            <div className="flex gap-2">
              <Input value={m.when} onChange={(e) => set({ milestones: f.milestones.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })} placeholder="When (2014)" className="w-1/3" />
              <Input value={m.title} onChange={(e) => set({ milestones: f.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder="What happened" className="flex-1" />
              <button type="button" onClick={() => set({ milestones: f.milestones.filter((_, j) => j !== i) }, true)} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Input value={m.note} onChange={(e) => set({ milestones: f.milestones.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} placeholder="A line about it (optional)" />
          </div>
        ))}
        <button type="button" onClick={() => set({ milestones: [...f.milestones, { id: newId(), when: "", title: "", note: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]" data-testid="family-add-milestone"><Plus className="h-3.5 w-3.5" /> Add a moment</button>
        {!f.milestones.length && <p className="text-xs text-muted-foreground">Enlisting, graduating OCS, a deployment, coming home, your first episode.</p>}
      </Card>

      <Card icon={ImagePlus} tone="violet" title="Photos">
        <input ref={photoIn} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => e.target.files?.length && void addPhotos(e.target.files)} />
        {f.photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {f.photos.map((p, i) => (
              <div key={p.id} className="space-y-1">
                <div className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => set({ photos: f.photos.filter((_, j) => j !== i) }, true)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100" aria-label="Remove photo"><Trash2 className="h-3 w-3" /></button>
                </div>
                <input value={p.caption} onChange={(e) => set({ photos: f.photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })} placeholder="Caption" maxLength={160} className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" onClick={() => photoIn.current?.click()} disabled={uploading > 0 || f.photos.length >= 24} className="w-full gap-1.5 rounded-xl border-dashed" data-testid="family-add-photos">
          {uploading > 0 ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading {uploading}…</> : <><ImagePlus className="h-4 w-4" /> Add photos</>}
        </Button>
      </Card>

      {episodes.length > 0 && (
        <Card icon={Headphones} tone="gold" title="Episodes to start with">
          <p className="-mt-1 text-xs text-muted-foreground">Pick up to three for your family. If you pick none, they see your latest.</p>
          <div className="space-y-1.5">
            {episodes.slice(0, 12).map((e) => {
              const on = f.favorites.includes(e.id);
              return (
                <button key={e.id} type="button" onClick={() => set({ favorites: on ? f.favorites.filter((x) => x !== e.id) : [...f.favorites, e.id].slice(-3) }, true)} className={`flex w-full items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors ${on ? "border-[#053877] bg-[#053877]/[0.05] dark:border-[#8fb5e8]" : "border-border hover:border-[#053877]/40"}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? "bg-[#053877] text-white" : "border border-border"}`}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
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
