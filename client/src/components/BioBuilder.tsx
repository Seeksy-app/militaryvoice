import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { uploadToStorage } from "@/lib/upload";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBioFont } from "@/lib/bioFont";
import { PlatformIcon, platformLabel, platformBackground } from "@/components/SocialIcons";
import { ratesFor } from "@/components/BioBrandsView";
import { BRANDS_SECTIONS, FAMILY_SECTIONS, arrange, type BioLayout, type BrandsSectionId, type FamilySectionId, CUTOUT_LAYOUTS, SWATCHES, TEMPLATES, FONTS, bioPalette, musicEmbed, videoEmbed, onColor, promoCodes, type BioAlign, type BioPromoCode, type BioBackground, type BioFont, type BioTemplate, DEFAULT_PODCAST, type BioPodcastOptions, DEFAULT_BRANDS, DEFAULT_FAMILY, type BioBrands, type BioBrandsPublic, type BioFamily, type BioFamilyPublic, type BioPublic, type BioSection, type BioSectionType, type BioSocial, type BioTheme } from "@shared/bio";
import type { ListenerQuestionRow, SocialPlatform } from "@shared/schema";
import { LayoutTemplate, Contrast, Shapes, Paintbrush, Droplets, QrCode, ChevronLeft, ChevronRight, AtSign, X, Users, Heart, Lock, RefreshCw, Handshake, Droplet, Moon, Sun, Headphones, Sparkles, ArrowDown, ArrowUp, Calendar, Check, CheckCircle2, ChevronDown, Circle, Copy, ExternalLink, Eye, EyeOff, ImagePlus, Link2, Loader2, Mail, MessageCircle, Send, MessageSquare, Monitor, Palette, Play, Plus, Share2, Smartphone, Tablet, Tag, Trash2, Type, User, Video, Layers, Mic, Square, Smile, GripVertical, AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, Music } from "lucide-react";

/**
 * SmartLink (was "My page", then "Rally Point"): the podcaster's bio page builder. Profile, Design, Content and
 * Share on the left; the page itself on the right, drawn by the very
 * component the public page uses. Everything saves as they go.
 */

type Page = { id: number; handle: string; displayName: string; bio: string; avatarUrl: string; heroUrl: string; theme: BioTheme; sections: BioSection[]; socials: BioSocial[]; rssUrl: string; askEnabled: boolean; welcome: string; aiEnabled: boolean; published: boolean; brands: BioBrands; family: BioFamily; cutoutUrl: string; cutoutFrom: string };
type Resp = { page: Page; url: string; preview: BioPublic; brandsPreview?: BioBrandsPublic | null; familyPreview?: BioFamilyPublic | null; stats: Record<string, number>; questions: ListenerQuestionRow[]; knowledge?: { done: number; total: number } };
type Tab = "profile" | "design" | "content" | "social" | "share" | "brands" | "family" | "questions";
/** Tabs shown greyed out, "Coming soon" on hover, until they launch. */
const SOON: Tab[] = ["brands", "family"];

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
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab") === "messages" ? "questions" : (localStorage.getItem("mv_bio_tab") as Tab) || "profile";
      return SOON.includes(t) ? "profile" : t;
    } catch { return "profile"; }
  });
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
  // The Brands and Family previews as the server last made them (their uploaded video, their sample).
  const [kitSrv, setKitSrv] = useState<BioBrandsPublic | null>(null);
  const [famSrv, setFamSrv] = useState<BioFamilyPublic | null>(null);
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
      if (r.brandsPreview) setKitSrv(r.brandsPreview);
      if (r.familyPreview) setFamSrv(r.familyPreview);
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
  const [cutError, setCutError] = useState("");
  const cutFailed = useRef("");
  useEffect(() => {
    // Wanted when the page, or Brands or Family on the page's photo, has a cut-out top.
    const wants = CUTOUT_LAYOUTS.includes(draft?.theme.layout as BioLayout)
      || (CUTOUT_LAYOUTS.includes(draft?.brands?.layout as BioLayout) && !draft?.brands?.photo)
      || (CUTOUT_LAYOUTS.includes(draft?.family?.layout as BioLayout) && !draft?.family?.photo);
    if (!draft || !wants || !draft.avatarUrl || draft.cutoutFrom === draft.avatarUrl || cutting || cutFailed.current === draft.avatarUrl) return;
    setCutting(true);
    void (async () => {
      try {
        const r = await again(() => apiRequest("POST", "/api/host/bio/cutout", {}));
        const j = (await r.json()) as { cutoutUrl: string; preview: BioPublic };
        setDraft((d) => (d ? { ...d, cutoutUrl: j.cutoutUrl, cutoutFrom: d.avatarUrl } : d));
        setCutError("");
        setPreview(j.preview);
      } catch (e) {
        cutFailed.current = draft.avatarUrl;
        const msg = (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
        setCutError(/switched on/i.test(msg) ? "Cutout isn't switched on yet on the server, so your page shows your round photo for now." : `Couldn't cut out your photo: ${msg} Try a clearer photo of just you.`);
        toast({ title: "Couldn't make your cutout", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
      } finally { setCutting(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.theme.layout, draft?.brands?.layout, draft?.family?.layout, draft?.avatarUrl, draft?.cutoutFrom]);

  // The living photo: made on fal (a few minutes), checked here whatever tab or top they're on,
  // so it finishes even when they go on working; switched on for them when it's ready.
  const [living, setLiving] = useState<LivingState>({ status: "loading" });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const checkLiving = useCallback(async () => {
    try {
      const j = (await (await apiRequest("GET", "/api/host/bio/living")).json()) as { status: LivingState["status"]; livingUrl?: string; message?: string; preview?: BioPublic };
      if (j.preview) setPreview(j.preview);
      setLiving({ status: j.status, url: j.livingUrl, message: j.message });
      return j;
    } catch { return null; }
  }, []);
  useEffect(() => { if (draft?.id) void checkLiving(); }, [draft?.id, draft?.heroUrl, draft?.avatarUrl, checkLiving]);
  useEffect(() => {
    if (living.status !== "running") return;
    const t = setInterval(async () => {
      const j = await checkLiving();
      if (j?.status === "done") {
        const d0 = draftRef.current;
        if (d0) change({ theme: { ...d0.theme, living: true } }, true);
        toast({ title: "Your photo is alive", description: "It plays on the Hero, Cover photo and Classic tops." });
      }
      if (j?.status === "failed") toast({ title: "Couldn't bring it to life", description: j.message, variant: "destructive" });
    }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [living.status]);
  const startLiving = async (again = false) => {
    setLiving({ status: "running" });
    try {
      const r = await apiRequest("POST", "/api/host/bio/living", { again });
      const j = (await r.json()) as { status: string; livingUrl?: string };
      if (j.status === "done") setLiving({ status: "done", url: j.livingUrl });
      else toast({ title: "Bringing your photo to life", description: "About three minutes. Keep working; we'll tell you when it's ready." });
    } catch (e) {
      setLiving({ status: "none" });
      toast({ title: "Couldn't start it", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    }
  };

  // The talking intro, watched the same way (a few minutes on fal), switched on for them when it's ready.
  const [intro, startIntro, resetIntro] = useFalJob("/api/host/bio/intro", setPreview, () => { const d0 = draftRef.current; if (d0) change({ theme: { ...d0.theme, intro: true } }, true); }, { title: "Your talking intro is ready", description: "It's on your page: tap the bubble to hear it." });

  // The Brands view: the numbers from the server, what they write from the draft.
  const kitView: BioBrandsPublic | null = useMemo(() => draft && (kitSrv ?? q.data?.brandsPreview) ? {
    ...(kitSrv ?? q.data!.brandsPreview!), displayName: draft.displayName, bio: draft.bio, avatarUrl: draft.avatarUrl, heroUrl: draft.heroUrl, theme: draft.theme, kit: { ...DEFAULT_BRANDS, ...(draft.brands ?? {}) },
    socials: draft.socials.filter((s) => s.on && s.url), cutoutUrl: draft.cutoutFrom && draft.cutoutFrom === draft.avatarUrl ? draft.cutoutUrl : "",
  } : null, [draft, q.data?.brandsPreview, kitSrv]);
  const famView: BioFamilyPublic | null = useMemo(() => {
    const srv = famSrv ?? q.data?.familyPreview;
    if (!draft || !srv) return null;
    const { key: _k, ...family } = draft.family ?? DEFAULT_FAMILY;
    return { ...srv, displayName: draft.displayName, avatarUrl: draft.avatarUrl, heroUrl: draft.heroUrl, theme: draft.theme, askEnabled: draft.askEnabled, family: { ...DEFAULT_FAMILY, ...family },
      socials: draft.socials.filter((s) => s.on && s.url), cutoutUrl: draft.cutoutFrom && draft.cutoutFrom === draft.avatarUrl ? draft.cutoutUrl : "" };
  }, [draft, q.data?.familyPreview, famSrv]);
  const page = () => tab === "brands" && kitView ? <BioBrandsView data={kitView} preview listenUrl={url} />
    : tab === "family" && famView ? <BioFamilyView data={famView} preview />
    : <BioPageView data={view!} preview shareBase={url} />;

  if (q.isLoading || !draft || !view) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const newQs = (q.data?.questions ?? []).filter((x) => x.status === "new").length;

  return (
    <section className="mt-2" data-testid="bio-builder">
      {/* The page's own band: the address to share, front and centre, and how it's doing. */}
      {/* One slim bar: the link, copy and open, and the last 30 days as small chips. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm" data-testid="bio-hero">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b36b00] dark:text-[#F0A71F]">Your SmartLink</p>
          <p className="truncate text-base font-bold tracking-tight">{url.replace(/^https?:\/\/(www\.)?/, "")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied", description: "Paste it in your bio, your show notes, anywhere." }))} className="h-8 gap-1.5 rounded-full bg-[#F0A71F] px-3 font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="bio-copy"><Copy className="h-3.5 w-3.5" /> Copy link</Button>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full px-3"><a href={url} target="_blank" rel="noreferrer" data-testid="bio-open"><ExternalLink className="h-3.5 w-3.5" /> Open</a></Button>
          <span className="pl-1 text-[11px] text-muted-foreground">{saving ? "Saving…" : "Saved"}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5" data-testid="bio-stats" title="Last 30 days">
          {([["view", "Views", Eye, "#053877"], ["click", "Link taps", Link2, "#7c3aed"], ["play", "Plays", Play, "#059669"], ["share", "Shares", Share2, "#0284c7"], ["ask", "Messages", MessageCircle, "#b36b00"]] as const).map(([k, l, I, c]) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-1 pr-2.5 text-xs">
              <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `${c}14`, color: c }}><I className="h-3.5 w-3.5" /></span>
              <b className="tabular-nums">{q.data?.stats?.[k] ?? 0}</b><span className="text-muted-foreground">{l}</span>
            </span>
          ))}
          <span className="pl-1 text-[10px] uppercase tracking-wider text-muted-foreground">30 days</span>
        </div>
      </div>
      <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm" role="tablist">
        {([["profile", "Profile", User], ["design", "Design", Palette], ["content", "Content", Layers], ["social", "Social", AtSign], ["share", "Share", Share2], ["brands", "Brands", Handshake], ["family", "Family", Heart], ["questions", "Messages", MessageCircle]] as const).map(([k, l, I]) => SOON.includes(k) ? (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <span role="tab" aria-disabled="true" aria-selected={false} tabIndex={0} className="inline-flex shrink-0 cursor-not-allowed select-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground/45" data-testid={`bio-tab-${k}`}>
                <I className="h-4 w-4" /> {l}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="font-semibold">Coming soon</TooltipContent>
          </Tooltip>
        ) : (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === k ? "bg-[#053877] text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} data-testid={`bio-tab-${k}`}>
            <I className="h-4 w-4" /> {l}{k === "questions" && newQs > 0 && <span className="rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{newQs}</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "profile" && <ProfileTab d={draft} view={view} change={change} flush={flush} setPreview={setPreview} knowledge={q.data?.knowledge} intro={<IntroCard d={draft} st={intro} start={(b) => void startIntro(b)} reset={resetIntro} on={draft.theme.intro ?? false} setOn={(v) => change({ theme: { ...draft.theme, intro: v } }, true)} />} />}
          {tab === "design" && <DesignTab d={draft} change={change} view={view} cutting={cutting} cutError={cutError} living={living} startLiving={startLiving} />}
          {tab === "content" && <ContentTab d={draft} change={change} />}
          {tab === "social" && <SocialTab d={draft} change={change} />}
          {tab === "share" && <ShareTab url={url} />}
          {tab === "brands" && <BrandsTab d={draft} change={change} url={url} kit={kitView} episodes={q.data?.familyPreview?.podcast?.episodes ?? []} />}
          {tab === "family" && <FamilyTab d={draft} change={change} flush={flush} url={url} famPreview={famView} />}
          {tab === "questions" && <QuestionsTab items={q.data?.questions ?? []} onChange={() => void qc.invalidateQueries({ queryKey: KEY })} />}
        </div>
        {/* The page, as listeners will see it. */}
        <div className="min-w-0 rounded-3xl bg-white p-4 dark:bg-card ring-1 ring-border lg:sticky lg:top-20 lg:self-start">
          {intro.status === "running" && <p className="mb-2 flex items-center justify-center gap-2 rounded-full bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-800 dark:text-violet-300" data-testid="bio-intro-pill"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Making your talking intro. Keep working; it's ready in a few minutes.</p>}
          {living.status === "running" && <p className="mb-2 flex items-center justify-center gap-2 rounded-full bg-[#F0A71F]/15 px-3 py-1.5 text-xs font-semibold text-[#8a5300] dark:text-[#F0A71F]" data-testid="bio-living-pill"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Bringing your photo to life. Keep working; it's ready in about three minutes.</p>}
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

function ProfileTab({ d, view, change, flush, setPreview, knowledge, intro }: { d: Page; view: BioPublic; change: (p: Partial<Page>, now?: boolean) => void; flush: () => Promise<void>; setPreview: (p: BioPublic) => void; knowledge?: { done: number; total: number }; intro?: React.ReactNode }) {
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
        <ImagePick label="Profile photo" kind="avatar" url={d.avatarUrl} round onDone={(u, p) => { change({ avatarUrl: u }); setPreview(p); }} onClear={() => change({ avatarUrl: "" }, true)} onFixed={(u) => change({ avatarUrl: u }, true)} />
        <ImagePick label="Cover photo" kind="hero" url={d.heroUrl} note="Used by the Hero, Cover photo and Banner tops. Without one, they use your profile photo." onDone={(u, p) => { change({ heroUrl: u }); setPreview(p); }} onClear={() => change({ heroUrl: "" }, true)} onFixed={(u) => change({ heroUrl: u }, true)} />
      </div>
      </Card>
      {intro}
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
        <TextEditor body={d.bio} onBody={(bio) => change({ bio })} maxLength={500} rows={3} placeholder="Who you are, what the show is about, who it's for." testid="bio-bio" />
      </div>
      </Card>
      <Card icon={Headphones} tone="green" title="Your podcast and listeners">
      <Field label="Your podcast" hint={hosted ? "Hosted here on MilitaryVoices: new episodes appear on your page by themselves." : "Paste your show's RSS feed and your latest episodes appear, top and centre."}>
        {hosted ? <p className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-emerald-600" /> {view.podcast?.title}</p> : <Input value={d.rssUrl} onChange={(e) => change({ rssUrl: e.target.value })} placeholder="https://feeds.yourhost.com/your-show" />}
      </Field>
      <div className="flex items-center justify-between rounded-xl border border-border p-3">
        <div><p className="text-sm font-semibold">Let listeners message you</p><p className="text-xs text-muted-foreground">A chat button on your page. You reply from Messages; they see it on your page, and by email if they left one.</p></div>
        <Switch checked={d.askEnabled} onCheckedChange={(v) => change({ askEnabled: v }, true)} />
      </div>
      {d.askEnabled && (
        <div>
          <p className="mb-1.5 text-sm font-semibold">Where the chat button goes</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Where the chat button goes">
            {([["top-left", "Top left"], ["top-right", "Top right"], ["socials", "With my icons"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]] as const).map(([v, l]) => {
              const on = (d.theme.chatAt ?? "top-right") === v;
              return (
                <button key={v} type="button" role="radio" aria-checked={on} onClick={() => change({ theme: { ...d.theme, chatAt: v } }, true)} className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-[11px] font-semibold transition-colors ${on ? "border-[#053877] bg-[#053877]/[0.05] dark:border-[#8fb5e8]" : "border-border text-muted-foreground hover:border-[#053877]/40"}`} data-testid={`bio-chat-at-${v}`}>
                  {/* A little page, with the button where it goes. */}
                  <span className="relative block h-10 w-8 rounded-md border border-border bg-muted/50">
                    {v === "socials"
                      ? <span className="absolute inset-x-0 top-4 flex justify-center gap-0.5">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />)}<span className="h-1.5 w-1.5 rounded-full bg-[#F0A71F]" /></span>
                      : <span className={`absolute h-2.5 w-2.5 rounded-full bg-[#F0A71F] ${v.startsWith("top") ? "top-1" : "bottom-1"} ${v.endsWith("left") ? "left-1" : "right-1"}`} />}
                  </span>
                  {l}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
    </div>
  );
}

// ---- Social (the icons under their name) ----------------------------------------------

function SocialTab({ d, change }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void }) {
  const move = (i: number, dir: -1 | 1) => { const s = [...d.socials]; const j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; change({ socials: s }, true); };
  const shown = d.socials.filter((s) => s.on).length;
  return (
    <div className="space-y-4">
      <Card icon={Share2} tone="violet" title="Your social icons">
        <p className="-mt-1 text-xs text-muted-foreground">{shown ? `${shown} showing. ` : ""}Move them into the order you like; switch off any you'd rather not show.</p>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Where they go</p>
          <div className="flex gap-1 rounded-full border border-border p-1" role="radiogroup" aria-label="Where your icons go">
            {([[true, "Above your bio"], [false, "Below your bio"]] as const).map(([v, l]) => {
              const on = (d.theme.socialsFirst ?? false) === v;
              return <button key={l} type="button" role="radio" aria-checked={on} onClick={() => change({ theme: { ...d.theme, socialsFirst: v } }, true)} className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`bio-socials-${v ? "above" : "below"}`}>{l}</button>;
            })}
          </div>
        </div>
        {d.socials.length ? (
          <ul className="space-y-2">
            {d.socials.map((s, i) => (
              <li key={s.platform} className={`flex items-center gap-3 rounded-2xl border-2 bg-background p-2.5 transition-opacity ${s.on ? "border-border" : "border-dashed border-border opacity-60"}`} data-testid={`bio-social-${s.platform}`}>
                <span className="flex flex-col"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Up"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(i, 1)} disabled={i === d.socials.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Down"><ArrowDown className="h-3.5 w-3.5" /></button></span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: platformBackground(s.platform as SocialPlatform) }}><PlatformIcon platform={s.platform as SocialPlatform} className="h-[18px] w-[18px]" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{platformLabel(s.platform as SocialPlatform)}</span><span className="block truncate text-xs text-muted-foreground">{s.username ? `@${s.username.replace(/^@/, "")}` : s.url}</span></span>
                <Switch checked={s.on} onCheckedChange={(v) => change({ socials: d.socials.map((x, j) => (j === i ? { ...x, on: v } : x)) }, true)} />
              </li>
            ))}
          </ul>
        ) : <p className="rounded-2xl border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">Connect your accounts and they appear here, and on your page.</p>}
        <Button asChild variant="outline" className="w-full gap-1.5 rounded-full"><a href="/host/dashboard/integrations"><Link2 className="h-4 w-4" /> {d.socials.length ? "Connect more accounts" : "Connect your accounts"}</a></Button>
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
/**
 * The tops of the page as tiles, each drawn in their colours and photo. The
 * Brands and Family views add their own look first (own), picked as "".
 */
function LayoutTiles({ d, value, onPick, cutting = false, own, photo }: { d: Page; value: BioLayout | ""; onPick: (v: BioLayout | "") => void; cutting?: boolean; own?: { label: string; art: React.ReactNode }; photo?: string }) {
  const t = d.theme;
  const pal = bioPalette(t);
  const c = t.color;
  // The cut-out tops draw in their own background colour when they've picked one.
  const cb = t.stickerColor || c;
  const ground = pal.paper;
  const ink = pal.ink;
  const avatar = photo || d.avatarUrl;
  // A cutout is of the page's own photo.
  const cut = !photo || photo === d.avatarUrl ? d.cutoutUrl && d.cutoutFrom === d.avatarUrl : false;
  return (
        <div className="grid grid-cols-3 gap-3">
          {own && <Tile on={value === ""} onClick={() => onPick("")} label={own.label} testid="bio-layout-own">{own.art}</Tile>}
          {([["portrait", "Classic"], ["hero", "Hero"], ["cutout", "Cutout"], ["popout", "Pop-out"], ["sticker", "Sticker"], ["magazine", "Magazine"], ["blend", "Cover photo"], ["landscape", "Banner"], ["shape", "Shape"]] as const).map(([v, l]) => {
            const face = avatar ? `center/cover url(${d.avatarUrl})` : "#888";
            return (
              <Tile key={v} on={value === v} onClick={() => onPick(v)} label={l} note={CUTOUT_LAYOUTS.includes(v) && cutting && value === v ? "Cutting you out…" : undefined} testid={`bio-layout-${v}`}>
                <span className="relative flex h-16 flex-col items-center overflow-hidden rounded-lg" style={{ background: ground }}>
                  {v === "popout" ? <><span className="absolute bottom-0 left-1/2 h-11 w-11 -translate-x-1/2 translate-y-1/3 rounded-full" style={{ background: cb }} />{cut ? <img src={d.cutoutUrl} alt="" className="absolute bottom-0 left-1/2 h-[52px] -translate-x-1/2 object-contain" /> : <span className="absolute bottom-0 left-1/2 h-10 w-9 -translate-x-1/2 rounded-t-full" style={{ background: face }} />}</>
                    : v === "sticker" ? <><span className="absolute inset-0" style={{ background: `repeating-linear-gradient(135deg, ${cb} 0 6px, ${cb}cc 6px 12px)` }} /><span className="absolute left-1/2 top-1.5 -translate-x-1/2 -rotate-6 text-[12px] font-black uppercase leading-none" style={{ color: onColor(cb) }}>{(d.displayName || "Name").split(" ")[0].slice(0, 7)}</span><span className="absolute inset-0" style={{ filter: "drop-shadow(1.5px 0 0 #fff) drop-shadow(-1.5px 0 0 #fff) drop-shadow(0 1.5px 0 #fff) drop-shadow(0 -1.5px 0 #fff)" }}>{cut ? <img src={d.cutoutUrl} alt="" className="absolute bottom-0 left-1/2 h-[52px] -translate-x-1/2 object-contain" /> : <span className="absolute bottom-0 left-1/2 h-10 w-9 -translate-x-1/2 rounded-t-full" style={{ background: face }} />}</span></>
                    : v === "magazine" ? <><span className="absolute inset-0" style={{ background: cb }} /><span className="absolute left-1/2 top-1 -translate-x-1/2 text-[14px] font-black uppercase leading-none" style={{ color: onColor(cb), fontFamily: "Georgia, serif" }}>{(d.displayName || "Name").split(" ")[0].slice(0, 6)}</span>{cut ? <img src={d.cutoutUrl} alt="" className="absolute bottom-0 left-1/2 h-[52px] -translate-x-1/2 object-contain" /> : <span className="absolute bottom-0 left-1/2 h-10 w-9 -translate-x-1/2 rounded-t-full" style={{ background: face }} />}<span className="absolute bottom-1 left-1 h-1 w-6 rounded bg-white/90" /></>
                    : v === "cutout" ? <><span className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 35%, ${cb}, ${ground})` }} /><span className="absolute left-1/2 top-2 -translate-x-1/2 text-[13px] font-black uppercase leading-none" style={{ color: ink, opacity: 0.8 }}>{(d.displayName || "Name").split(" ")[0].slice(0, 7)}</span>{cut ? <img src={d.cutoutUrl} alt="" className="absolute bottom-0 left-1/2 h-[52px] -translate-x-1/2 object-contain" /> : <span className="absolute bottom-0 left-1/2 h-10 w-9 -translate-x-1/2 rounded-t-full" style={{ background: face }} />}</>
                    : v === "hero" ? <><span className="absolute inset-0" style={{ background: face }} /><span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" /><span className="absolute bottom-2 h-1.5 w-12 rounded bg-white" /></>
                    : v === "blend" ? <span className="h-11 w-full" style={{ background: avatar ? face : c, maskImage: "linear-gradient(to bottom, #000 50%, transparent)" }} />
                    : v === "landscape" ? <><span className="h-6 w-full" style={{ background: `linear-gradient(135deg, ${c}, #000741)` }} /><span className="-mt-3 h-6 w-6 rounded-full" style={{ background: face, boxShadow: `0 0 0 2px ${ground}` }} /></>
                    : v === "shape" ? (cut
                      ? <><span className="absolute bottom-0 left-1/2 h-9 w-14 -translate-x-1/2 -rotate-3" style={{ background: cb, borderRadius: "58% 42% 38% 62% / 45% 55% 45% 55%" }} /><img src={d.cutoutUrl} alt="" className="absolute bottom-0 left-1/2 h-[52px] -translate-x-1/2 object-contain" /></>
                      : <span className="relative mt-2 h-9 w-9"><span className="absolute -inset-1 rotate-12" style={{ background: cb, borderRadius: "58% 42% 38% 62% / 45% 55% 45% 55%" }} /><span className="absolute inset-0" style={{ background: face, borderRadius: "42% 58% 63% 37% / 52% 38% 62% 48%" }} /></span>)
                    : <span className="mt-2.5 h-8 w-8 rounded-full" style={{ background: face, boxShadow: `0 0 0 2px ${c}` }} />}
                  {v !== "hero" && !CUTOUT_LAYOUTS.includes(v) && <span className="absolute bottom-1.5 h-1 w-10 rounded" style={{ background: ink, opacity: 0.8 }} />}
                </span>
              </Tile>
            );
          })}
        </div>
  );
}

/**
 * A card of the builder. It can fold (the title or the arrow), carry a switch
 * for its section right in its header (on), and a handle to drag it (grip).
 */
function Card({ icon: I, tone, title, action, fold, on, grip, testid, children }: { icon: typeof User; tone: keyof typeof TONES; title: string; action?: React.ReactNode; fold?: { open: boolean; toggle: () => void }; on?: { checked: boolean; set: (v: boolean) => void }; grip?: React.ReactNode; testid?: string; children: React.ReactNode }) {
  const open = fold ? fold.open : true;
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${open ? "space-y-3" : ""} ${on && !on.checked ? "opacity-70" : ""}`} data-testid={testid}>
      <div className="flex items-center gap-2">
        {grip}
        <button type="button" onClick={fold?.toggle} disabled={!fold} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-bold disabled:cursor-default" aria-expanded={fold ? open : undefined}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}><I className="h-4 w-4" /></span> <span className="truncate">{title}</span></button>
        {action}
        {on && <Switch checked={on.checked} onCheckedChange={on.set} aria-label={`${title} ${on.checked ? "on" : "off"}`} />}
        {fold && <button type="button" onClick={fold.toggle} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={open ? `Fold ${title}` : `Open ${title}`}><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>}
      </div>
      {open && children}
    </section>
  );
}

/**
 * Which of a tab's cards are open, kept in this browser. Cards start open, or
 * closed (openAtFirst false: the ones opened are what's kept).
 */
function useFold(tab: string, openAtFirst = true) {
  const key = `mv_bio_folded_${tab}`;
  const [marked, setMarked] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) || "[]") as string[]; } catch { return []; } });
  const save = (x: string[]) => { setMarked(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* this visit only */ } };
  const isOpen = (id: string) => (openAtFirst ? !marked.includes(id) : marked.includes(id));
  const set = (id: string, open: boolean) => save(open === openAtFirst ? marked.filter((x) => x !== id) : Array.from(new Set([...marked, id])));
  return {
    of: (id: string) => ({ open: isOpen(id), toggle: () => set(id, !isOpen(id)) }),
    set,
    all: (ids: string[], open: boolean) => save(open === openAtFirst ? [] : ids),
  };
}

/** Fold all or open all, at the top of a tab. */
function FoldAll({ onAll }: { onAll: (open: boolean) => void }) {
  return (
    <div className="flex justify-end gap-3 text-xs font-semibold text-muted-foreground">
      <button type="button" onClick={() => onAll(false)} className="hover:text-foreground" data-testid="fold-all">Collapse all</button>
      <button type="button" onClick={() => onAll(true)} className="hover:text-foreground" data-testid="open-all">Expand all</button>
    </div>
  );
}

/**
 * Cards to put in order by dragging their handle (mouse or finger), or with
 * the arrow keys on it. The card follows the pointer and the others make room;
 * the new order is saved when it's let go. render gets the handle for the card's header.
 */
function Sortable<T extends string>({ ids, onMove, render }: { ids: T[]; onMove: (ids: T[]) => void; render: (id: T, grip: React.ReactNode) => React.ReactNode }) {
  const [live, setLive] = useState<T[] | null>(null);
  const [drag, setDrag] = useState<{ id: T; offY: number; dy: number } | null>(null);
  const els = useRef(new Map<T, HTMLDivElement>());
  const list = live ?? ids;
  const start = (id: T, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const r = els.current.get(id)!.getBoundingClientRect();
    setLive(ids);
    setDrag({ id, offY: e.clientY - r.top, dy: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || !live) return;
    const el = els.current.get(drag.id)!;
    const natural = el.getBoundingClientRect().top - drag.dy;
    // Where the pointer is among the other cards: before the first whose middle is below it.
    const others = live.filter((x) => x !== drag.id);
    let at = others.length;
    for (let k = 0; k < others.length; k++) { const r = els.current.get(others[k])!.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { at = k; break; } }
    const next = [...others.slice(0, at), drag.id, ...others.slice(at)];
    if (next.join() !== live.join()) setLive(next);
    setDrag({ ...drag, dy: e.clientY - drag.offY - natural });
  };
  const end = () => {
    if (live && live.join() !== ids.join()) onMove(live);
    setLive(null);
    setDrag(null);
  };
  const step = (id: T, dir: -1 | 1) => { const i = ids.indexOf(id); const j = i + dir; if (j < 0 || j >= ids.length) return; const x = [...ids]; [x[i], x[j]] = [x[j], x[i]]; onMove(x); };
  return (
    <>
      {list.map((id) => {
        const on = drag?.id === id;
        return (
          <div key={id} ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }}
            className={`relative rounded-2xl ${on ? "z-20 shadow-2xl ring-2 ring-[#053877]/40" : "transition-transform"}`}
            style={on ? { transform: `translateY(${drag!.dy}px)` } : undefined} data-testid={`sortable-${id}`}>
            {render(id, (
              <button type="button" onPointerDown={(e) => start(id, e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); step(id, -1); } if (e.key === "ArrowDown") { e.preventDefault(); step(id, 1); } }}
                className="-ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing" aria-label="Drag to move (or use the arrow keys)" title="Drag to move" data-testid={`grip-${id}`}>
                <GripVertical className="h-4 w-4" />
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-semibold">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}</label>;
}

/** On or off, readable on a dark card: the word, and a gold switch when it's on. */
function OnOff({ on, onChange, testid }: { on: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-3 pr-1 text-xs font-bold transition-colors ${on ? "bg-[#F0A71F] text-[#1a1200]" : "bg-white/15 text-white ring-1 ring-white/30"}`} data-testid={testid}>
      {on ? "On" : "Off"}
      <span className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${on ? "bg-[#1a1200]/20" : "bg-black/30"}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} /></span>
    </button>
  );
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

function ImagePick({ label, kind, url, round, note, onDone, onClear, onFixed }: { label: string; kind: "avatar" | "hero"; url: string; round?: boolean; note?: string; onDone: (url: string, preview: BioPublic) => void; onClear: () => void; onFixed: (url: string) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Fix-up: a sharper, cleaner copy made on fal, shown next to theirs to choose.
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState("");
  const [styling, setStyling] = useState(false);
  // Their own photo, kept in this browser when they pick a style, so styles always start from it and they can go back.
  const origKey = `mv_bio_orig_${kind}`;
  const original = (() => { try { return localStorage.getItem(origKey) || ""; } catch { return ""; } })();
  const styled = /-styled-/.test(url);
  const fixUp = async () => {
    setFixing(true);
    try {
      const r = await again(() => apiRequest("POST", "/api/host/bio/fixup", { kind }));
      setFixed(((await r.json()) as { url: string }).url);
    } catch (e) {
      toast({ title: "Couldn't fix it up", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally { setFixing(false); }
  };
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
      {url && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/-fixed-/.test(url) ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Fixed up</span>
              : !styled && <button type="button" onClick={() => void fixUp()} disabled={fixing} className="inline-flex items-center gap-1 text-xs font-semibold text-[#b36b00] hover:underline disabled:opacity-70 dark:text-[#F0A71F]" data-testid={`bio-fixup-${kind}`}>{fixing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sharpening…</> : <><Sparkles className="h-3.5 w-3.5" /> Fix up</>}</button>}
            <button type="button" onClick={() => setStyling(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#6d28d9] hover:underline dark:text-violet-300" data-testid={`bio-styles-${kind}`}><Palette className="h-3.5 w-3.5" /> Styles</button>
            {styled && original && <button type="button" onClick={() => { onFixed(original); try { localStorage.removeItem(origKey); } catch { /* fine */ } }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Back to my original</button>}
          </span>
          <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">Remove</button>
        </div>
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      {styling && <StylePicker kind={kind} src={styled && original ? original : url} round={round} onClose={() => setStyling(false)} onUse={(u) => { try { if (!styled) localStorage.setItem(origKey, url); } catch { /* fine */ } onFixed(u); setStyling(false); }} />}
      {fixed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setFixed("")} role="dialog" aria-label="Your photo, fixed up" data-testid="bio-fixup-compare">
          <div className="w-full max-w-2xl rounded-3xl bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg font-bold">Your photo, fixed up</p>
            <p className="text-sm text-muted-foreground">Sharper, cleaner, with the face brought out. Which do you want on your page?</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {([["Before", url], ["After", fixed]] as const).map(([l, u]) => (
                <figure key={l} className="overflow-hidden rounded-2xl border border-border">
                  <img src={u} alt={l} className={`w-full object-cover ${round ? "aspect-square" : "aspect-[4/3]"}`} />
                  <figcaption className={`px-3 py-1.5 text-center text-xs font-bold ${l === "After" ? "bg-[#F0A71F]/15 text-[#8a5300] dark:text-[#F0A71F]" : "text-muted-foreground"}`}>{l === "After" ? "✨ After" : "Before"}</figcaption>
                </figure>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => { onFixed(fixed); setFixed(""); toast({ title: "Sharper photo in", description: "It's on your page now." }); }} className="flex-1 gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="bio-fixup-use"><Check className="h-4 w-4" /> Use the sharper one</Button>
              <Button variant="outline" onClick={() => setFixed("")} className="rounded-full">Keep mine</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Styles: their photo redrawn in a look they pick (comic, oil, 3D cartoon…),
 * each made the first time it's tapped (about 7 seconds) and shown beside the
 * original; theirs only when they choose it.
 */
const STYLE_PICKS = [["comic", "Comic book", "💥"], ["oil", "Oil painting", "🖼️"], ["cartoon", "3D cartoon", "🧸"], ["watercolor", "Watercolour", "🎨"], ["sketch", "Pencil sketch", "✏️"], ["popart", "Pop art", "🟡"], ["anime", "Anime", "✨"], ["neon", "Neon", "🌆"]] as const;
function StylePicker({ kind, src, round, onClose, onUse }: { kind: "avatar" | "hero"; src: string; round?: boolean; onClose: () => void; onUse: (url: string) => void }) {
  const { toast } = useToast();
  const [made, setMade] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const make = async (k: string) => {
    if (made[k]) { setPick(k); return; }
    setBusy(k);
    try {
      const r = await again(() => apiRequest("POST", "/api/host/bio/style", { kind, style: k, from: src }));
      const u = ((await r.json()) as { url: string }).url;
      setMade((m) => ({ ...m, [k]: u }));
      setPick(k);
    } catch (e) {
      toast({ title: "No style this time", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally { setBusy(null); }
  };
  const shown = pick && made[pick] ? made[pick] : src;
  const label = STYLE_PICKS.find(([k]) => k === pick)?.[1];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-label="Styles" data-testid="bio-styles">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-lg font-bold">Styles</p><p className="text-sm text-muted-foreground">Your photo, redrawn. Tap a look; it takes a few seconds.</p></div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.1fr]">
          <figure className="relative overflow-hidden rounded-2xl border border-border bg-muted/40">
            <img src={shown} alt="" className={`w-full object-cover ${round ? "aspect-square" : "aspect-[4/3]"} ${busy ? "opacity-50" : ""}`} />
            {busy && <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-semibold"><Loader2 className="h-6 w-6 animate-spin" /> Redrawing you…</span>}
            <figcaption className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white">{label ?? "Your photo"}</figcaption>
          </figure>
          <div>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_PICKS.map(([k, l, e]) => {
                const on = pick === k;
                return (
                  <button key={k} type="button" onClick={() => void make(k)} disabled={busy != null} className={`relative flex h-14 items-center gap-2 overflow-hidden rounded-xl border-2 px-2.5 text-left text-xs font-semibold transition-all disabled:opacity-60 ${on ? "border-[#6d28d9] ring-2 ring-[#6d28d9]/20" : "border-border hover:border-[#6d28d9]/40"}`} data-testid={`bio-style-${k}`}>
                    {made[k] ? <img src={made[k]} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">{busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : e}</span>}
                    <span className="min-w-0 flex-1 leading-tight">{l}</span>
                    {on && <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#6d28d9] text-white"><Check className="h-3 w-3" /></span>}
                  </button>
                );
              })}
            </div>
            {pick && <button type="button" onClick={() => setPick(null)} className="mt-2 text-xs font-semibold text-muted-foreground hover:text-foreground">See my photo again</button>}
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Button onClick={() => pick && made[pick] && onUse(made[pick])} disabled={!pick || !made[pick]} className="flex-1 gap-1.5 rounded-full bg-[#6d28d9] font-semibold text-white hover:bg-[#5b21b6]" data-testid="bio-style-use"><Check className="h-4 w-4" /> {label ? `Use ${label}` : "Pick a style"}</Button>
          <Button variant="outline" onClick={onClose} className="rounded-full">Keep mine</Button>
        </div>
      </div>
    </div>
  );
}

// ---- Design ------------------------------------------------------------------------

const DESIGN_RAIL = [
  { id: "layout", label: "Layout", icon: LayoutTemplate },
  { id: "font", label: "Font", icon: Type },
  { id: "color", label: "Colours", icon: Palette },
  { id: "shape", label: "Shape", icon: Shapes },
  { id: "style", label: "Style", icon: Paintbrush },
  { id: "brand", label: "Brand", icon: QrCode },
] as const;

/**
 * Design, as MilCrunch lays it out: a rail of sections on the left (it follows
 * you as you scroll, and jumps when clicked) and every setting in one column.
 */
function DesignTab({ d, change, view, cutting = false, cutError = "", living, startLiving }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; view: BioPublic; cutting?: boolean; cutError?: string; living: LivingState; startLiving: (again?: boolean) => void }) {
  const t = d.theme;
  const set = (p: Partial<BioTheme>) => change({ theme: { ...t, ...p } });
  const c = t.color;
  const pal = bioPalette(t);
  const dark = pal.dark;
  const ground = pal.paper;
  const ink = pal.ink;
  const bgv = t.background ?? { mode: "solid" as const, color: "", image: "" };
  const setBg = (p: Partial<BioBackground>) => set({ background: { ...bgv, ...p } });
  const r = (shape: string) => (shape === "pill" ? 999 : shape === "rounded" ? 7 : shape === "squircle" ? 10 : 2);
  const bgIn = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const { toast } = useToast();
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [here, setHere] = useState<string>("layout");
  useEffect(() => {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setHere((e.target as HTMLElement).dataset.section ?? "layout"); }, { rootMargin: "-25% 0px -65% 0px" });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const jump = (id: string) => { setHere(id); refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }); };
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
  const hasPhoto = Boolean(d.avatarUrl || d.heroUrl);
  return (
    <div className="flex rounded-2xl border border-border bg-card shadow-sm" data-testid="design-panel">
      {/* The rail: every section, the one you're in lit. */}
      <nav className="w-[76px] shrink-0 border-r border-border bg-muted/30 py-2" aria-label="Design sections">
        <div className="sticky top-20 flex flex-col items-center gap-0.5">
          {DESIGN_RAIL.map((it) => {
            const on = here === it.id;
            return (
              <button key={it.id} type="button" onClick={() => jump(it.id)} className={`flex h-[64px] w-[68px] flex-col items-center justify-center gap-1 rounded-xl transition-colors ${on ? "text-[#053877] dark:text-[#8fb5e8]" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} data-testid={`design-rail-${it.id}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${on ? "bg-[#053877]/15" : ""}`}><it.icon className="h-[15px] w-[15px]" /></span>
                <span className="text-[11px] font-medium leading-none">{it.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <DesignSection bind={refs} id="layout" title="Layout">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Choose a template</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setBrowsing(true)} className="h-9 gap-1.5 rounded-full border-[#053877]/40 text-[#053877] dark:text-[#8fb5e8]" data-testid="design-browse"><Palette className="h-4 w-4" /> Browse templates</Button>
            <span className="text-xs text-muted-foreground">Current: <b className="font-semibold text-foreground">{TEMPLATES[t.template]?.label ?? "Custom"}</b></span>
          </div>
          <p className="mb-1.5 mt-5 text-xs font-medium text-muted-foreground">Top of the page</p>
        <LayoutTiles d={d} value={t.layout} onPick={(v) => v && set({ layout: v })} cutting={cutting} />
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div><p className="text-sm font-semibold">Show my name</p><p className="text-xs text-muted-foreground">Turn it off when your photo or logo already says it.</p></div>
            <Switch checked={!(t.hideName ?? false)} onCheckedChange={(v) => set({ hideName: !v })} data-testid="bio-show-name" />
          </div>
          {/* Sizes: their name, and their cut-out photo's place and size. */}
          {(!t.hideName || (CUTOUT_LAYOUTS.includes(t.layout) && d.cutoutUrl && d.cutoutFrom === d.avatarUrl)) && (
            <div className="mt-3 space-y-3 rounded-xl bg-muted/40 p-3" data-testid="bio-cutout-adjust">
              {!t.hideName && <RangeRow label="Name size" hint="Smaller or bigger" value={t.nameSize ?? 100} min={60} max={150} onChange={(v) => set({ nameSize: v })} unit="%" testid="bio-name-size" />}
              {CUTOUT_LAYOUTS.includes(t.layout) && d.cutoutUrl && d.cutoutFrom === d.avatarUrl && <>
                <RangeRow label="Photo position" hint="Up or down" value={t.cutoutY ?? 0} min={-160} max={160} onChange={(v) => set({ cutoutY: v })} testid="bio-cutout-y" />
                <RangeRow label="Photo size" hint="Smaller or bigger" value={t.cutoutSize ?? 100} min={60} max={150} onChange={(v) => set({ cutoutSize: v })} unit="%" testid="bio-cutout-size" />
              </>}
              {((t.nameSize ?? 100) !== 100 || (t.cutoutY ?? 0) !== 0 || (t.cutoutSize ?? 100) !== 100) && <button type="button" onClick={() => set({ nameSize: 100, cutoutY: 0, cutoutSize: 100 })} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Reset</button>}
            </div>
          )}
          {CUTOUT_LAYOUTS.includes(t.layout) && t.layout !== "sticker" && d.cutoutUrl && d.cutoutFrom === d.avatarUrl && <ScenePicker scene={t.scene ?? ""} onPick={(scene) => set({ scene })} />}
          {(t.layout === "hero" || t.layout === "blend" || (t.layout === "portrait" && !d.heroUrl)) && hasPhoto && <LivingPhoto on={t.living ?? false} setOn={(v) => set({ living: v })} st={living} start={startLiving} />}
          {cutError && CUTOUT_LAYOUTS.includes(t.layout) && <p className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{cutError}</p>}
          {hasPhoto && !CUTOUT_LAYOUTS.includes(t.layout) && (
            <div className="mt-5">
              <p className="text-xs font-medium text-muted-foreground">Image position</p>
              <p className="text-[11px] text-muted-foreground/80">Shift the crop if the photo cuts off a head or an important detail.</p>
              <input type="range" min={0} max={100} step={1} value={t.imageY ?? 50} onChange={(e) => set({ imageY: Number(e.target.value) })} className="mv-range mt-3" style={{ background: rangeFill(t.imageY ?? 50, 0, 100) }} data-testid="bio-image-y" />
            </div>
          )}
          {(t.layout === "portrait" || (t.layout === "shape" && !(d.cutoutUrl && d.cutoutFrom === d.avatarUrl))) && (
            <div className="mt-5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Profile image size</p>
              <div className="flex gap-1 rounded-full border border-border p-1">
                {(["s", "m", "l"] as const).map((v) => <button key={v} type="button" onClick={() => set({ avatarSize: v })} className={seg((t.avatarSize ?? "m") === v)} data-testid={`bio-avatar-${v}`}>{v.toUpperCase()}</button>)}
              </div>
            </div>
          )}
        </DesignSection>

        <DesignSection bind={refs} id="font" title="Font" sub="Choose a typeface for your page.">
          <CardSelect testid="bio-font" value={t.font} onPick={(v) => set({ font: v as BioFont })} options={(Object.keys(FONTS) as BioFont[]).map((f) => ({ value: f, node: <FontFace font={f} /> }))} />
        </DesignSection>

        <DesignSection bind={refs} id="color" title="Colours" sub="From the whole page down to your buttons.">
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-semibold">Shade <span className="font-normal text-muted-foreground">how light or dark the page is</span></p>
              <CardSelect testid="bio-shade" value={t.shade as string} onPick={(v) => set({ shade: v as BioTheme["shade"], ...(bgv.mode === "solid" && bgv.color ? { background: { ...bgv, color: "" } } : {}) })}
                options={([["none", "None", "#ffffff", "#111827"], ["minimal", "Minimal", "#f9fafb", "#111827"], ["light", "Light", "#f3f4f6", "#111827"], ["tint", "Colour tint", `${c}26`, "#111827"], ["dark", "Dark", "#0b1020", "#ffffff"]] as const).map(([v, l, bgc, tx]) => ({
                  value: v,
                  node: <span className="flex items-center gap-3"><span className="flex h-10 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-black/5" style={{ background: bgc }}><span className="h-1 w-7 rounded-full" style={{ background: tx, opacity: 0.7 }} /><span className="h-1 w-4 rounded-full" style={{ background: tx, opacity: 0.4 }} /></span><span className="text-sm font-medium">{l}</span></span>,
                }))} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold">Background</p>
              <div className="mb-3 flex gap-1 rounded-full border border-border p-1">
                {(["solid", "gradient", "image"] as const).map((m) => <button key={m} type="button" onClick={() => setBg({ mode: m })} className={`${seg(bgv.mode === m)} capitalize`} data-testid={`bio-bg-${m}`}>{m}</button>)}
              </div>
              {bgv.mode === "solid" && (
                <>
                  <ColourPick value={bgv.color || pal.paper} onPick={(v) => setBg({ color: v })} testid="bio-bg-colour" />
                  {bgv.color && <button type="button" onClick={() => setBg({ color: "" })} className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">Use the shade's colour</button>}
                </>
              )}
              {bgv.mode === "gradient" && (
                <>
                  <div className="h-16 w-full rounded-xl border border-border" style={{ background: pal.background }} />
                  <p className="my-2 text-[11px] text-muted-foreground">From your theme colour at the top, down to:</p>
                  <ColourPick value={bgv.color || pal.paper} onPick={(v) => setBg({ color: v })} testid="bio-bg-gradient" />
                </>
              )}
              {bgv.mode === "image" && (
                <>
                  <input ref={bgIn} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadBg(e.target.files[0])} />
                  <button type="button" onClick={() => bgIn.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-4 transition-colors hover:border-[#053877]" data-testid="bio-bg-upload">
                    {bgv.image ? <img src={bgv.image} alt="" className="h-24 w-full rounded-lg object-cover" /> : bgBusy ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /> : <ImagePlus className="h-7 w-7 text-muted-foreground" />}
                    <span className="text-xs font-semibold text-muted-foreground">{bgv.image ? "Change image" : "Upload an image"}</span>
                    <span className="text-[10px] text-muted-foreground/70">PNG or JPG, up to 12MB</span>
                  </button>
                  {bgv.image && <button type="button" onClick={() => setBg({ image: "", mode: "solid" })} className="mt-2 text-xs font-semibold text-destructive">Remove image</button>}
                </>
              )}
              {/* Fine-tuning: how much of their colour, how light or dark, and how strong the wash over a photo is. */}
              <div className="mt-4 space-y-3 rounded-xl bg-muted/40 p-3">
                <RangeRow label="Tint" hint="How much of your colour" value={t.bgTint ?? 0} min={0} max={100} onChange={(v) => set({ bgTint: v })} unit="%" testid="bio-bg-tint" track={`linear-gradient(90deg, ${pal.paper}, ${c})`} />
                <RangeRow label="Brightness" hint="Darker or lighter" value={t.bgBrightness ?? 0} min={-100} max={100} onChange={(v) => set({ bgBrightness: v })} testid="bio-bg-brightness" track="linear-gradient(90deg, #000000, #ffffff)" />
                {bgv.mode === "image" && <RangeRow label="Wash" hint="Over your photo, so the words read" value={t.bgWash ?? 65} min={0} max={100} onChange={(v) => set({ bgWash: v })} unit="%" testid="bio-bg-wash" />}
                {((t.bgTint ?? 0) !== 0 || (t.bgBrightness ?? 0) !== 0) && <button type="button" onClick={() => set({ bgTint: 0, bgBrightness: 0 })} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Reset</button>}
              </div>
            </div>
            {CUTOUT_LAYOUTS.includes(t.layout) && (
              <div data-testid="bio-sticker-colour">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{t.layout === "sticker" ? "Stripes behind your photo" : t.layout === "popout" ? "Circle behind your photo" : t.layout === "shape" ? "Shape behind your photo" : t.layout === "magazine" ? "Cover behind your photo" : "Behind your photo"} <span className="font-normal text-muted-foreground">{t.scene && t.layout !== "sticker" ? "when there's no scene" : ""}</span></p>
                  {t.stickerColor && <button type="button" onClick={() => set({ stickerColor: "" })} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Same as the theme colour</button>}
                </div>
                <ColourPick value={t.stickerColor || t.color} onPick={(v) => set({ stickerColor: v })} testid="bio-sticker-colour" />
              </div>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold">Theme colour <span className="font-normal text-muted-foreground">for headings, badges and buttons</span></p>
              <ColourPick value={t.color} onPick={(v) => set({ color: v })} testid="bio-colour" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">Link colour <span className="font-normal text-muted-foreground">for your link buttons</span></p>
                {t.linkColor && <button type="button" onClick={() => set({ linkColor: "" })} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Same as the theme colour</button>}
              </div>
              <ColourPick value={t.linkColor || t.color} onPick={(v) => set({ linkColor: v })} testid="bio-link-colour" />
            </div>
          </div>
        </DesignSection>

        <DesignSection bind={refs} id="shape" title="Link shape" sub="Corner style for your link buttons.">
          <div className="grid grid-cols-2 gap-2">
            {([["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"], ["squircle", "Squircle"]] as const).map(([v, l]) => (
              <Tile key={v} on={t.linkShape === v} onClick={() => set({ linkShape: v })} label={l} testid={`bio-shape-${v}`}>
                <span className="flex h-12 items-center justify-center rounded-lg bg-muted/40 px-3"><span className="h-7 w-full bg-[#e2e5ea] dark:bg-white/15" style={{ borderRadius: r(v) }} /></span>
              </Tile>
            ))}
          </div>
        </DesignSection>

        <DesignSection bind={refs} id="style" title="Link style" sub="How your link buttons are styled.">
          <div className="grid grid-cols-2 gap-2">
            {([["fill", "Fill"], ["outline", "Outline"], ["soft", "Soft shadow"], ["hard", "Hard shadow"]] as const).map(([v, l]) => {
              const lc = t.linkColor || c;
              return (
                <Tile key={v} on={t.linkStyle === v} onClick={() => set({ linkStyle: v })} label={l} testid={`bio-style-${v}`}>
                  <span className="flex h-14 items-center justify-center rounded-lg px-3" style={{ background: ground }}>
                    <span className="flex h-8 w-full items-center justify-center text-[11px] font-semibold" style={v === "fill" ? { background: lc, color: onColor(lc), borderRadius: r(t.linkShape) } : v === "outline" ? { border: `2px solid ${lc}`, color: ink, borderRadius: r(t.linkShape) } : v === "hard" ? { background: dark ? "#141a2c" : "#fff", border: `2px solid ${dark ? "#fff" : "#0b1020"}`, boxShadow: `3px 3px 0 ${lc}`, color: ink, borderRadius: r(t.linkShape) } : { background: dark ? "rgba(255,255,255,0.1)" : "#fff", boxShadow: "0 4px 12px rgba(11,16,32,0.14)", color: ink, borderRadius: r(t.linkShape) }}>Sample</span>
                  </span>
                </Tile>
              );
            })}
          </div>
        </DesignSection>

        <DesignSection bind={refs} id="brand" title="Branding" sub="Control visible branding on your page.">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div><p className="text-sm font-semibold">Show "Made with MilitaryVoices.ai"</p><p className="text-xs text-muted-foreground">A small line at the foot of your page.</p></div>
            <Switch checked={t.branding ?? true} onCheckedChange={(v) => set({ branding: v })} data-testid="bio-branding" />
          </div>
        </DesignSection>
      </div>
      {browsing && <TemplatePicker view={view} theme={t} onClose={() => setBrowsing(false)} onApply={(p) => { set(p); setBrowsing(false); toast({ title: `${TEMPLATES[p.template as BioTemplate]?.label ?? "Template"} applied` }); }} />}
    </div>
  );
}

/** One section of Design: its title, what it's for, and a place the rail can jump to. */
function DesignSection({ id, title, sub, bind, children }: { id: string; title: string; sub?: string; bind: React.MutableRefObject<Record<string, HTMLElement | null>>; children: React.ReactNode }) {
  return (
    <section ref={(el) => { bind.current[id] = el; }} data-section={id} className="scroll-mt-24 border-b border-border px-5 py-5 last:border-b-0" data-testid={`design-${id}`}>
      <h3 className="text-sm font-bold">{title}</h3>
      {sub && <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/** A slider with its label and value. */
/**
 * A scene behind their cut-out: the colour, one of ours (made for them the
 * first time they pick it), one they describe, or a photo of their own.
 */
const SCENE_PICKS = [["flag", "Flag", "🇺🇸"], ["base", "Airfield", "✈️"], ["studio", "Studio", "🎙️"], ["sea", "At sea", "⚓"], ["mountains", "Mountains", "🏔️"], ["city", "City night", "🌃"], ["beach", "Beach", "🏖️"], ["camo", "Camo", "🪖"]] as const;
function ScenePicker({ scene, onPick }: { scene: string; onPick: (url: string) => void }) {
  const { toast } = useToast();
  const [made, setMade] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const fileIn = useRef<HTMLInputElement>(null);
  const make = async (key: string, body: { preset?: string; prompt?: string }) => {
    if (made[key]) { onPick(made[key]); return; }
    setBusy(key);
    try {
      const r = await again(() => apiRequest("POST", "/api/host/bio/scene", body));
      const j = (await r.json()) as { url: string };
      setMade((m) => ({ ...m, [key]: j.url }));
      onPick(j.url);
    } catch (e) {
      toast({ title: "No scene this time", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally { setBusy(null); }
  };
  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await again(() => fetch("/api/host/bio/image/bg", { method: "POST", body: fd, credentials: "include" }));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't use that image.");
      onPick(j.url);
    } catch (e) {
      toast({ title: "Photo not used", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); if (fileIn.current) fileIn.current.value = ""; }
  };
  const chip = (on: boolean) => `relative flex h-16 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border-2 text-[11px] font-semibold transition-all ${on ? "border-[#053877] ring-2 ring-[#053877]/20" : "border-border hover:border-[#053877]/40"}`;
  return (
    <div className="mt-4 space-y-2 rounded-xl bg-muted/40 p-3" data-testid="bio-scene">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Scene behind you</p>
        {scene && <button type="button" onClick={() => onPick("")} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Back to the colour</button>}
      </div>
      <p className="text-[11px] text-muted-foreground">Made for you by AI in a few seconds. Pick one, describe your own, or use a photo.</p>
      <div className="grid grid-cols-4 gap-2">
        {SCENE_PICKS.map(([k, l, e]) => {
          // Only the one in use shows its picture and a tick; the others look like the rest (made ones come back instantly).
          const on = !!made[k] && scene === made[k];
          return (
            <button key={k} type="button" onClick={() => void make(k, { preset: k })} disabled={busy != null} className={chip(on)} style={on ? { background: `center/cover url(${made[k]})` } : undefined} aria-pressed={on} data-testid={`bio-scene-${k}`}>
              {busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : on
                ? <><span className="rounded bg-black/55 px-1.5 py-0.5 text-white">{l}</span><span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#053877] text-white"><Check className="h-3 w-3" /></span></>
                : <span><span className="block text-lg leading-none">{e}</span>{l}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && own.trim().length > 2) void make(`own:${own.trim()}`, { prompt: own.trim() }); }} maxLength={300} placeholder="Or describe one: a hangar at dawn, Fenway Park…" className="h-9 flex-1 text-xs" data-testid="bio-scene-own" />
        <Button type="button" onClick={() => void make(`own:${own.trim()}`, { prompt: own.trim() })} disabled={busy != null || own.trim().length < 3} className="h-9 rounded-full bg-[#053877] px-3 text-xs hover:bg-[#0a4a99]">{busy?.startsWith("own:") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Make it"}</Button>
      </div>
      <input ref={fileIn} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <button type="button" onClick={() => fileIn.current?.click()} disabled={busy != null} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">{busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Use a photo of my own</button>
    </div>
  );
}

/**
 * The living photo: their top photo moving for a few seconds (a blink, a
 * breath, a smile), looping. Made once (about a minute), then on or off.
 */
type LivingState = { status: "none" | "running" | "done" | "failed" | "loading"; url?: string; message?: string };
function LivingPhoto({ on, setOn, st, start }: { on: boolean; setOn: (v: boolean) => void; st: LivingState; start: (again?: boolean) => void }) {
  return (
    <div className="mt-4 space-y-2 rounded-xl border-2 border-[#F0A71F]/40 bg-[#F0A71F]/5 p-3" data-testid="bio-living-card">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#b36b00] dark:text-[#F0A71F]" />
        <p className="flex-1 text-sm font-semibold">Living photo</p>
        {st.status === "done" && <Switch checked={on} onCheckedChange={setOn} aria-label="Show my living photo" data-testid="bio-living-on" />}
      </div>
      {st.status === "done" && st.url ? (
        <div className="flex items-center gap-3">
          <video src={st.url} autoPlay muted loop playsInline className="h-16 w-16 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{on ? "Your photo moves on your page: a blink, a breath, a smile." : "Made. Switch it on to show it on your page."}</p>
            <button type="button" onClick={() => void start(true)} className="mt-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">Make a new one</button>
          </div>
        </div>
      ) : st.status === "running" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="bio-living-running"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Bringing your photo to life. About three minutes; keep working, even on another tab.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Your photo, moving for a few seconds on a loop: a blink, a breath, a smile. Made by AI in about three minutes.</p>
          <Button type="button" onClick={() => void start()} disabled={st.status === "loading"} className="w-full gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="bio-living-make"><Sparkles className="h-4 w-4" /> Bring my photo to life</Button>
        </>
      )}
    </div>
  );
}

/** A slider's track: grey, with navy filled up to the handle (from the middle when it runs either side of zero). */
function rangeFill(value: number, min: number, max: number): string {
  const pct = ((value - min) / (max - min)) * 100;
  const from = min < 0 && max > 0 ? ((0 - min) / (max - min)) * 100 : 0;
  const [a, b] = pct < from ? [pct, from] : [from, pct];
  return `linear-gradient(to right, #d5dbe7 ${a}%, #053877 ${a}%, #053877 ${b}%, #d5dbe7 ${b}%)`;
}

function RangeRow({ label, hint, value, min, max, onChange, unit = "", track, testid }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string; track?: string; testid?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between"><span className="text-xs font-semibold">{label} <span className="font-normal text-muted-foreground">{hint}</span></span><span className="text-[11px] tabular-nums text-muted-foreground">{value > 0 && min < 0 ? "+" : ""}{value}{unit}</span></div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mv-range mt-2" style={{ background: track ?? rangeFill(value, min, max) }} data-testid={testid} />
    </div>
  );
}

/**
 * Browse templates: a carousel of phones, each your own page in that template,
 * with the colours and font to try on it before applying.
 */
function TemplatePicker({ view, theme, onClose, onApply }: { view: BioPublic; theme: BioTheme; onClose: () => void; onApply: (p: Partial<BioTheme>) => void }) {
  const keys = Object.keys(TEMPLATES) as BioTemplate[];
  const [i, setI] = useState(() => Math.max(0, keys.indexOf(theme.template)));
  const [accent, setAccent] = useState<string | null>(null);
  const [bgc, setBgc] = useState<string | null>(null);
  const [font, setFont] = useState<BioFont | null>(null);
  const n = keys.length;
  const shift = (dir: -1 | 1) => setI((x) => (x + dir + n) % n);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") shift(-1); else if (e.key === "ArrowRight") shift(1); else if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const themed = (k: BioTemplate, centre: boolean): BioTheme => ({
    ...theme, ...TEMPLATES[k].theme, template: k,
    color: centre && accent ? accent : theme.color,
    font: centre && font ? font : (TEMPLATES[k].theme.font ?? theme.font),
    background: centre && bgc ? { mode: "solid", color: bgc, image: "" } : { mode: "solid", color: "", image: "" },
    bgTint: 0, bgBrightness: 0,
  });
  const cur = keys[i];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose} role="dialog" aria-label="Choose a template">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative mx-4 flex h-[88vh] w-full max-w-6xl flex-col rounded-2xl bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Choose a template</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4">
          <button type="button" onClick={() => shift(-1)} className="absolute left-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-lg ring-1 ring-border hover:bg-muted" aria-label="Previous"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={() => shift(1)} className="absolute right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-lg ring-1 ring-border hover:bg-muted" aria-label="Next"><ChevronRight className="h-5 w-5" /></button>
          <div className="relative h-[560px] w-full">
            {keys.map((k, j) => {
              const dist = ((j - i + n + Math.floor(n / 2)) % n) - Math.floor(n / 2);
              const ad = Math.abs(dist);
              const W = 280, H = 560;
              const scale = ad === 0 ? 1 : ad === 1 ? 0.8 : 0.62;
              const screenW = W - 18;
              const k2 = screenW / 402;
              return (
                <button key={k} type="button" onClick={() => setI(j)} className="absolute top-0 cursor-pointer text-left" style={{ width: W, height: H, left: "50%", marginLeft: -W / 2, transform: `translateX(${dist * 230}px) scale(${scale})`, opacity: ad === 0 ? 1 : ad === 1 ? 0.72 : 0.45, zIndex: 10 - ad, transition: "all 0.45s cubic-bezier(0.4,0,0.2,1)" }} aria-label={TEMPLATES[k].label} data-testid={`template-card-${k}`}>
                  <div className="relative h-full w-full rounded-[40px] bg-[#0a0a0c] p-[9px] shadow-2xl ring-1 ring-[#4a4a52]">
                    <span className="absolute left-1/2 top-[16px] z-10 h-[18px] w-[76px] -translate-x-1/2 rounded-full bg-black" />
                    <div className="h-full w-full overflow-hidden rounded-[32px]" style={{ background: bioPalette(themed(k, ad === 0)).paper }}>
                      <div style={{ width: 402, transform: `scale(${k2})`, transformOrigin: "top left", pointerEvents: "none" }}>
                        <BioPageView data={{ ...view, theme: themed(k, ad === 0) }} preview shareBase="" />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => shift(-1)} className="text-muted-foreground hover:text-foreground" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[140px] text-center"><span className="block text-sm font-bold">{TEMPLATES[cur].label}</span><span className="block text-[11px] text-muted-foreground">{TEMPLATES[cur].note}</span></span>
            <button type="button" onClick={() => shift(1)} className="text-muted-foreground hover:text-foreground" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Colours:</span>
            <label className="relative cursor-pointer" title="Background">
              <span className="block h-8 w-8 rounded-lg border border-border" style={{ background: bgc ?? bioPalette(themed(cur, false)).paper }} />
              <input type="color" value={bgc ?? "#0b1020"} onChange={(e) => setBgc(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <label className="relative cursor-pointer" title="Accent">
              <span className="block h-8 w-8 rounded-lg border border-border" style={{ background: accent ?? theme.color }} />
              <input type="color" value={accent ?? theme.color} onChange={(e) => setAccent(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Font:</span>
            <select value={font ?? (TEMPLATES[cur].theme.font ?? theme.font)} onChange={(e) => setFont(e.target.value as BioFont)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              {(Object.keys(FONTS) as BioFont[]).map((f) => <option key={f} value={f}>{FONTS[f].label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} className="rounded-full">Cancel</Button>
            <Button onClick={() => { const th = themed(cur, true); onApply({ ...TEMPLATES[cur].theme, template: cur, color: th.color, font: th.font, background: th.background, bgTint: 0, bgBrightness: 0 }); }} className="rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid="template-apply">Apply template</Button>
          </div>
        </div>
      </div>
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
/** A font's name in itself, with a big Aa. */
function FontFace({ font }: { font: BioFont }) {
  useBioFont(font);
  const f = FONTS[font];
  return <span className="flex w-full items-center justify-between gap-3" style={{ fontFamily: f.css }}><span className="text-[15px]">{f.label}</span><span className="text-2xl font-bold">Aa</span></span>;
}

/**
 * One card showing what's chosen; open it and every choice is a card
 * underneath, the chosen one ticked. For Shade and Font.
 */
function CardSelect({ value, options, onPick, testid }: { value: string; options: { value: string; node: React.ReactNode }[]; onPick: (v: string) => void; testid?: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-3 rounded-xl border-2 border-[#053877] bg-card p-2.5 text-left ring-2 ring-[#053877]/10 transition-colors hover:bg-muted/30 dark:border-[#8fb5e8]" data-testid={testid}>
          <span className="min-w-0 flex-1">{current.node}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="max-h-[420px] w-[var(--radix-dropdown-menu-trigger-width)] space-y-1 overflow-y-auto p-1.5">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onPick(o.value)} className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 p-2.5 ${o.value === value ? "border-[#053877] bg-[#053877]/[0.05] dark:border-[#8fb5e8]" : "border-transparent"}`} data-testid={`${testid}-${o.value}`}>
            <span className="min-w-0 flex-1">{o.node}</span>
            {o.value === value && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#053877] text-white"><Check className="h-3 w-3" /></span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  { type: "promo", label: "Promo codes", hint: "Sponsors' codes, tap to copy", icon: Tag, tone: "bg-[#F0A71F]/15 text-[#b36b00] dark:text-[#F0A71F]" },
  { type: "meeting", label: "Book a meeting", hint: "Your Calendly or booking link", icon: Calendar, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  { type: "text", label: "Text", hint: "A few words of your own", icon: Type, tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { type: "music", label: "Music", hint: "Spotify, Apple Music, SoundCloud", icon: Music, tone: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
];
function blank(type: BioSectionType): BioSection {
  const base = { id: newId(), visible: true, title: "" };
  switch (type) {
    case "links": return { ...base, type, links: [{ id: newId(), label: "", url: "" }] };
    case "video": return { ...base, type, url: "" };
    case "promo": return { ...base, type, title: "Promo codes", codes: [{ id: newId(), brand: "", code: "", note: "", url: "" }], code: "", url: "", note: "" };
    case "music": return { ...base, type, title: "Music", tracks: [{ id: newId(), url: "" }] };
    case "meeting": return { ...base, type, title: "Book a time with me", url: "", note: "" };
    default: return { ...base, type: "text", body: "" };
  }
}

function ContentTab({ d, change }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void }) {
  // The two cards start open; each block's editor starts closed.
  const fold = useFold("content");
  const items = useFold("content-items", false);
  const put = (s: BioSection[], now = false) => change({ sections: s }, now);
  const upd = (id: string, patch: Partial<BioSection>, now = false) => put(d.sections.map((x) => (x.id === id ? ({ ...x, ...patch } as BioSection) : x)), now);
  const add = (type: BioSectionType) => { const s = blank(type); put([...d.sections, s], true); items.set(s.id, true); fold.set("list", true); };
  const all = (open: boolean) => { fold.all(["add", "list"], open); items.all(["podcast", ...d.sections.map((x) => x.id)], open); };
  return (
    <div className="space-y-4">
      <FoldAll onAll={all} />
      <Card icon={Plus} tone="gold" title="Add to your page" fold={fold.of("add")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <button key={k.type} type="button" onClick={() => add(k.type)} className="group flex items-center gap-3 rounded-2xl border-2 border-border bg-background p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[#053877]/40 hover:shadow-md" data-testid={`bio-add-${k.type}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><k.icon className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0"><span className="block text-sm font-bold">{k.label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{k.hint}</span></span>
            </button>
          ))}
        </div>
      </Card>
      <Card icon={Layers} tone="blue" title="On your page · drag to reorder" fold={fold.of("list")}>
        <PodcastBlock d={d} change={change} open={items.of("podcast").open} toggle={items.of("podcast").toggle} />
        {d.sections.length === 0 && <p className="rounded-2xl border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing else yet. Pick something above and it goes here.</p>}
        <Sortable ids={d.sections.map((x) => x.id)} onMove={(ids) => put(ids.map((id) => d.sections.find((x) => x.id === id)!), true)} render={(id, grip) => {
          const s = d.sections.find((x) => x.id === id)!;
          const k = KINDS.find((x) => x.type === s.type)!;
          const f = items.of(s.id);
          return (
            <div className={`rounded-2xl border-2 bg-background transition-colors ${f.open ? "border-[#053877]/50 shadow-sm dark:border-[#8fb5e8]/50" : "border-border"} ${s.visible ? "" : "opacity-60"}`} data-testid={`bio-section-${s.type}`}>
              <div className="flex items-center gap-2 p-2.5">
                {grip}
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><k.icon className="h-[18px] w-[18px]" /></span>
                <button type="button" onClick={f.toggle} className="min-w-0 flex-1 text-left" aria-expanded={f.open}><span className="block truncate text-sm font-semibold">{s.title || k.label}</span><span className="block text-xs text-muted-foreground">{k.label}{s.visible ? "" : " · hidden"}</span></button>
                <Switch checked={s.visible} onCheckedChange={(v) => upd(s.id, { visible: v }, true)} aria-label={`${s.title || k.label} ${s.visible ? "on" : "off"}`} />
                <button type="button" onClick={() => put(d.sections.filter((x) => x.id !== s.id), true)} className="rounded-full p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                <button type="button" onClick={f.toggle} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label={f.open ? "Close" : "Edit"}><ChevronDown className={`h-4 w-4 transition-transform ${f.open ? "rotate-180" : ""}`} /></button>
              </div>
              {f.open && <div className="space-y-2 border-t border-border p-3"><SectionEditor s={s} upd={(p) => upd(s.id, p)} /></div>}
            </div>
          );
        }} />
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
          <Field label="Heading" hint="Optional: a small line over your episodes. Leave it empty to keep it tight.">
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
  if (s.type === "promo") {
    // The list of codes (an old single code becomes the first of it).
    const codes = promoCodes(s);
    const put = (c: BioPromoCode[]) => upd({ codes: c, code: "", url: "", note: "" });
    const edit = (i: number, p: Partial<BioPromoCode>) => put(codes.map((x, j) => (j === i ? { ...x, ...p } : x)));
    return (
      <>
        {title}
        {codes.map((c, i) => (
          <div key={c.id} className="space-y-2 rounded-xl border border-dashed border-[#F0A71F]/60 bg-[#F0A71F]/5 p-2.5" data-testid="bio-promo-code">
            <div className="flex gap-2">
              <Input value={c.brand} onChange={(e) => edit(i, { brand: e.target.value })} placeholder="Brand (e.g. Grunt Style)" maxLength={60} className="flex-1" />
              <Input value={c.code} onChange={(e) => edit(i, { code: e.target.value.toUpperCase().replace(/\s+/g, "") })} placeholder="CODE" maxLength={40} className="w-32 font-mono" />
              <button type="button" onClick={() => put(codes.filter((_, j) => j !== i))} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove code"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Input value={c.note} onChange={(e) => edit(i, { note: e.target.value })} placeholder="What it saves (e.g. 20% off your first order)" maxLength={200} />
            <Input value={c.url} onChange={(e) => edit(i, { url: e.target.value })} placeholder="Their shop link (https://)" />
          </div>
        ))}
        <button type="button" onClick={() => put([...codes, { id: newId(), brand: "", code: "", note: "", url: "" }])} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]" data-testid="bio-promo-add"><Plus className="h-3.5 w-3.5" /> Another code</button>
      </>
    );
  }
  if (s.type === "music") return (
    <>
      {title}
      {s.tracks.map((x, i) => {
        const ok = !x.url.trim() || musicEmbed(x.url);
        return (
          <div key={x.id}>
            <div className="flex gap-2">
              <Input value={x.url} onChange={(e) => upd({ tracks: s.tracks.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)) })} placeholder="Paste a Spotify, Apple Music or SoundCloud link" className="flex-1" data-testid="bio-music-url" />
              <button type="button" onClick={() => upd({ tracks: s.tracks.filter((_, j) => j !== i) })} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
            {!ok && <p className="mt-1 text-[11px] text-muted-foreground">We'll show this as a Listen button. Spotify, Apple Music, SoundCloud and YouTube links play right on your page.</p>}
          </div>
        );
      })}
      <button type="button" onClick={() => upd({ tracks: [...s.tracks, { id: newId(), url: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]"><Plus className="h-3.5 w-3.5" /> Another song or playlist</button>
      <p className="text-[11px] text-muted-foreground">A song, an album, a playlist or an artist. Each one plays right on your page.</p>
    </>
  );
  if (s.type === "meeting") return <>{title}<Input value={s.url} onChange={(e) => upd({ url: e.target.value })} placeholder="https://calendly.com/…" /><Input value={s.note} onChange={(e) => upd({ note: e.target.value })} placeholder="e.g. Guests, sponsors and fellow veterans welcome" /></>;
  if (s.type === "text") return <>{title}<TextEditor body={s.body} align={s.align ?? "left"} onBody={(body) => upd({ body })} onAlign={(align) => upd({ align })} /></>;
  return null;
}

/**
 * The text block's box with its tools over it: align left, centre or right,
 * and bold, italic and underline around what's selected (or where the cursor is).
 */
const EMOJIS = ["❤️", "🥰", "😊", "😂", "🥹", "😍", "🙏", "👏", "💪", "🎉", "🎂", "🎁", "🏠", "👨‍👩‍👧‍👦", "👪", "🤗", "😢", "✨", "⭐", "🌟", "🇺🇸", "🦅", "🎖️", "🪖", "⚓", "✈️", "🫡", "💙", "💛", "🧡", "💚", "💜", "🌻", "🌹", "☀️", "🙌", "👍", "🎙️", "🎧", "📸"];

function TextEditor({ body, align = "left", onBody, onAlign, rows = 5, maxLength = 2000, placeholder = "Write something. Select words, then B, I or U.", emoji = true, testid = "bio-text-body" }: { body: string; align?: BioAlign; onBody: (v: string) => void; onAlign?: (v: BioAlign) => void; rows?: number; maxLength?: number; placeholder?: string; emoji?: boolean; testid?: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [emojis, setEmojis] = useState(false);
  const insert = (text: string) => {
    const el = box.current;
    const a = el?.selectionStart ?? body.length, b = el?.selectionEnd ?? body.length;
    onBody((body.slice(0, a) + text + body.slice(b)).slice(0, maxLength));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + text.length, a + text.length); });
  };
  const wrap = (mark: string) => {
    const el = box.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const picked = body.slice(a, b);
    // Already wrapped: take the marks off again.
    const on = picked.startsWith(mark) && picked.endsWith(mark) && picked.length >= mark.length * 2;
    const inner = on ? picked.slice(mark.length, -mark.length) : picked;
    const next = on ? inner : `${mark}${inner}${mark}`;
    onBody(body.slice(0, a) + next + body.slice(b));
    requestAnimationFrame(() => { el.focus(); const start = on ? a : a + mark.length; el.setSelectionRange(start, start + inner.length); });
  };
  const tool = (on: boolean) => `flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${on ? "bg-[#053877] text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
  return (
    <div className="overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1" role="toolbar" aria-label="Text tools">
        {onAlign && <>
          {([["left", AlignLeft, "Align left"], ["center", AlignCenter, "Centre"], ["right", AlignRight, "Align right"]] as const).map(([v, Icon, l]) => (
            <button key={v} type="button" onClick={() => onAlign(v)} className={tool(align === v)} aria-label={l} title={l} aria-pressed={align === v} data-testid={`bio-text-${v}`}><Icon className="h-4 w-4" /></button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
        </>}
        {([["**", Bold, "Bold"], ["*", Italic, "Italic"], ["__", Underline, "Underline"]] as const).map(([m, Icon, l]) => (
          <button key={l} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(m)} className={tool(false)} aria-label={l} title={l} data-testid={`bio-text-${l.toLowerCase()}`}><Icon className="h-4 w-4" /></button>
        ))}
        {emoji && (
          <>
            <span className="mx-1 h-5 w-px bg-border" />
            <div className="relative">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setEmojis(!emojis)} className={tool(emojis)} aria-label="Emoji" title="Emoji" aria-expanded={emojis} data-testid="bio-text-emoji"><Smile className="h-4 w-4" /></button>
              {emojis && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setEmojis(false)} aria-hidden />
                  <div className="absolute left-0 top-9 z-50 grid w-[272px] grid-cols-8 gap-0.5 rounded-xl border border-border bg-popover p-1.5 shadow-lg" role="listbox" aria-label="Emoji">
                    {EMOJIS.map((x) => <button key={x} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(x)} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-muted">{x}</button>)}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <textarea ref={box} value={body} onChange={(e) => onBody(e.target.value)} rows={rows} maxLength={maxLength} placeholder={placeholder} className="block w-full resize-y bg-transparent px-3 py-2 text-sm outline-none" style={{ textAlign: align }} data-testid={testid} />
    </div>
  );
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

/**
 * A voice message recorded right here (up to three minutes): record, hear it
 * back, keep it or try again. Kept on our storage, played on their page.
 */
/** A fal job the builder watches (made on fal's queue, a few minutes): its state, and a way to start one. */
type JobState = { status: "none" | "running" | "done" | "failed" | "loading"; url?: string; message?: string };
function useFalJob(path: string, setPreview: (p: BioPublic) => void, onDone: () => void, doneNote: { title: string; description: string }) {
  const { toast } = useToast();
  const [st, setSt] = useState<JobState>({ status: "loading" });
  const done = useRef(onDone);
  done.current = onDone;
  const check = useCallback(async () => {
    try {
      const j = (await (await apiRequest("GET", path)).json()) as { status: JobState["status"]; livingUrl?: string; message?: string; preview?: BioPublic };
      if (j.preview) setPreview(j.preview);
      setSt({ status: j.status, url: j.livingUrl, message: j.message });
      return j;
    } catch { return null; }
  }, [path, setPreview]);
  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    if (st.status !== "running") return;
    const t = setInterval(async () => {
      const j = await check();
      if (j?.status === "done") { done.current(); toast(doneNote); }
      if (j?.status === "failed") toast({ title: "That didn't work", description: j.message, variant: "destructive" });
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.status]);
  const start = async (body: Record<string, unknown>) => {
    setSt({ status: "running" });
    try {
      const r = await apiRequest("POST", path, body);
      const j = (await r.json()) as { status: string; livingUrl?: string };
      if (j.status === "done") setSt({ status: "done", url: j.livingUrl });
    } catch (e) {
      setSt({ status: "none" });
      toast({ title: "Couldn't start it", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    }
  };
  return [st, start, () => setSt({ status: "none" })] as const;
}

/**
 * The talking intro: their profile photo saying hello. Record it in their own
 * voice, or type it and pick an AI voice; made in a few minutes, then on or off.
 */
const INTRO_VOICES = [["Brian", "Brian", "deep, steady"], ["George", "George", "warm, British"], ["Chris", "Chris", "easy-going"], ["Eric", "Eric", "friendly"], ["Sarah", "Sarah", "soft, calm"], ["Jessica", "Jessica", "bright"], ["Laura", "Laura", "upbeat"], ["Alice", "Alice", "clear, British"]] as const;
function IntroCard({ d, st, start, reset, on, setOn }: { d: Page; st: JobState; start: (b: Record<string, unknown>) => void; reset: () => void; on: boolean; setOn: (v: boolean) => void }) {
  const [mode, setMode] = useState<"voice" | "ai">("voice");
  const [voiceKey, setVoiceKey] = useState("");
  const first = (d.displayName || "").split(/\s+/)[0];
  const [script, setScript] = useState(`Hey, welcome in! I'm ${first || "the host"}. Press play on an episode, and if you've got a question, send me a message. Thanks for stopping by.`);
  const [voice, setVoice] = useState("Brian");
  const seg = (x: boolean) => `flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${x ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`;
  const make = () => start(mode === "voice" ? { mode, audioKey: voiceKey } : { mode, script, voice });
  return (
    <Card icon={Video} tone="violet" title="Your talking intro" action={st.status === "done" ? <Switch checked={on} onCheckedChange={setOn} aria-label="Show my talking intro" data-testid="bio-intro-on" /> : undefined}>
      {st.status === "done" && st.url ? (
        <div className="flex items-center gap-3">
          <video src={st.url} controls playsInline className="h-28 w-28 shrink-0 rounded-2xl bg-black object-cover" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted-foreground">{on ? "On your page: a bubble with you in it. Tap it and you say hello." : "Made. Switch it on to put it on your page."}</p>
            <button type="button" onClick={() => { setVoiceKey(""); reset(); }} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground" data-testid="bio-intro-again">Make a new one</button>
          </div>
        </div>
      ) : st.status === "running" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="bio-intro-running"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Making your photo talk. A few minutes; keep working, even on another tab.</p>
      ) : (
        <>
          <p className="-mt-1 text-xs text-muted-foreground">Your profile photo, saying hello to everyone who opens your page. Up to 45 seconds.</p>
          {!d.avatarUrl && <p className="rounded-xl bg-[#F0A71F]/10 px-3 py-2 text-xs text-[#8a5300] dark:text-[#F0A71F]">Add a profile photo first (above): a clear one of your face, looking at the camera.</p>}
          <div className="flex gap-1 rounded-full border border-border p-1">
            <button type="button" onClick={() => setMode("voice")} className={seg(mode === "voice")} data-testid="bio-intro-mode-voice">In my voice</button>
            <button type="button" onClick={() => setMode("ai")} className={seg(mode === "ai")} data-testid="bio-intro-mode-ai">Type it, pick a voice</button>
          </div>
          {mode === "voice" ? (
            <>
              <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"><b className="text-foreground">Something to say:</b> {script}</p>
              <VoiceRecorder value={voiceKey} preview="" onChange={setVoiceKey} wav max={45} saved="Got it" savedNote="Now make your talking intro." recordLabel="Record my hello" />
            </>
          ) : (
            <>
              <TextEditor body={script} onBody={setScript} rows={3} maxLength={600} emoji={false} placeholder="What you'd like to say" testid="bio-intro-script" />
              <select value={voice} onChange={(e) => setVoice(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="bio-intro-voice">
                {INTRO_VOICES.map(([v, l, n]) => <option key={v} value={v}>{l}: {n}</option>)}
              </select>
            </>
          )}
          <Button onClick={make} disabled={!d.avatarUrl || st.status === "loading" || (mode === "voice" ? !voiceKey : script.trim().length < 10)} className="w-full gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="bio-intro-make"><Sparkles className="h-4 w-4" /> Make my talking intro</Button>
        </>
      )}
    </Card>
  );
}

/** A recording as a plain WAV (mono, 24 kHz): every service takes it, whatever the browser recorded. */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const src = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const rate = 24000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(src.duration * rate)), rate);
  const node = off.createBufferSource();
  node.buffer = src;
  node.connect(off.destination);
  node.start();
  const data = (await off.startRendering()).getChannelData(0);
  const v = new DataView(new ArrayBuffer(44 + data.length * 2));
  const tag = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) { const x = Math.max(-1, Math.min(1, data[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([v], { type: "audio/wav" });
}

function VoiceRecorder({ value, preview, onChange, wav = false, max = 180, saved = "Voice message saved", savedNote = "It's on your family page.", recordLabel = "Record a message" }: { value: string; preview: string; onChange: (v: string) => void; wav?: boolean; max?: number; saved?: string; savedNote?: string; recordLabel?: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "recording" | "review" | "saving">("idle");
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string } | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const tick = useRef<number>();
  const MAX = max;
  useEffect(() => () => { window.clearInterval(tick.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(tick.current);
        const blob = new Blob(parts, { type: r.mimeType || type || "audio/webm" });
        setTake({ blob, url: URL.createObjectURL(blob) });
        setState("review");
      };
      rec.current = r;
      r.start(1000);
      setSecs(0);
      setState("recording");
      const t0 = Date.now();
      tick.current = window.setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setSecs(s); if (s >= MAX) r.stop(); }, 250);
    } catch {
      toast({ title: "Couldn't use your microphone", description: "Allow the microphone for this site in your browser, then try again.", variant: "destructive" });
    }
  };
  const keep = async () => {
    if (!take) return;
    setState("saving");
    try {
      const ext = take.blob.type.includes("mp4") ? "m4a" : "webm";
      const file = wav ? new File([await toWav(take.blob)], "voice.wav", { type: "audio/wav" }) : new File([take.blob], `voice-message.${ext}`, { type: take.blob.type.split(";")[0] });
      const key = await uploadToStorage(file, () => {});
      onChange(`r2:${key}`);
      URL.revokeObjectURL(take.url);
      setTake(null);
      setState("idle");
      toast({ title: saved, description: savedNote });
    } catch (e) {
      setState("review");
      toast({ title: "Couldn't save it", description: (e as Error).message, variant: "destructive" });
    }
  };
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  if (state === "recording") return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-red-500/40 bg-red-500/5 p-3">
      <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" /></span>
      <span className="flex-1 text-sm font-semibold tabular-nums">Recording {mmss(secs)} <span className="font-normal text-muted-foreground">/ {mmss(MAX)}</span></span>
      <Button onClick={() => rec.current?.stop()} className="gap-1.5 rounded-full bg-red-600 hover:bg-red-700" data-testid="voice-stop"><Square className="h-3.5 w-3.5 fill-current" /> Stop</Button>
    </div>
  );
  if ((state === "review" || state === "saving") && take) return (
    <div className="space-y-2 rounded-2xl border border-border p-3">
      <audio src={take.url} controls className="w-full" />
      <div className="flex gap-2">
        <Button onClick={() => void keep()} disabled={state === "saving"} className="flex-1 gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="voice-keep">{state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this one</Button>
        <Button variant="outline" onClick={() => { URL.revokeObjectURL(take.url); setTake(null); void start(); }} disabled={state === "saving"} className="gap-1.5 rounded-full"><RefreshCw className="h-4 w-4" /> Record again</Button>
      </div>
    </div>
  );
  return (
    <div className="space-y-2">
      {value && (
        <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3">
          <p className="flex items-center justify-between text-sm font-semibold">Your message <button type="button" onClick={() => onChange("")} className="text-xs font-semibold text-muted-foreground hover:text-destructive">Remove</button></p>
          {preview ? <audio src={preview} controls preload="none" className="w-full" /> : <p className="text-xs text-muted-foreground">Saved.</p>}
        </div>
      )}
      <Button onClick={() => void start()} className="w-full gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid="voice-record"><Mic className="h-4 w-4" /> {value ? "Record again" : recordLabel}</Button>
    </div>
  );
}

/** A video: paste a link (YouTube, Vimeo, Instagram, TikTok), or upload one from the computer or phone. */
function VideoPick({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [link, setLink] = useState(value.startsWith("r2:") ? "" : value);
  useEffect(() => { if (!value.startsWith("r2:")) setLink(value); }, [value]);
  const upload = async (file: File) => {
    if (file.size > 500 * 1024 * 1024) { toast({ title: "That video is too big", description: "Up to 500 MB. A reel or a short clip works best.", variant: "destructive" }); return; }
    setPct(0);
    try {
      const key = await uploadToStorage(file, setPct);
      onChange(`r2:${key}`);
      toast({ title: "Video added" });
    } catch (e) {
      toast({ title: "The video didn't upload", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  const bad = link.trim() && !videoEmbed(link);
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      {value.startsWith("r2:") ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2.5 text-sm">
          <Video className="h-4 w-4 text-muted-foreground" /><span className="flex-1 font-semibold">Your uploaded video</span>
          <button type="button" onClick={() => onChange("")} className="text-xs font-semibold text-muted-foreground hover:text-destructive">Remove</button>
        </div>
      ) : (
        <>
          <Input value={link} onChange={(e) => setLink(e.target.value)} onBlur={() => link.trim() !== value && onChange(link.trim())} placeholder="Paste a YouTube, Instagram, TikTok or Vimeo link" data-testid={`${testid}-url`} />
          {bad && <p className="text-[11px] text-destructive">That link won't play here. Try a YouTube, Instagram reel, TikTok or Vimeo link.</p>}
        </>
      )}
      <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={pct != null} className="w-full gap-1.5 rounded-xl border-dashed" data-testid={`${testid}-upload`}>
        {pct != null ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading {pct}%</> : <><Video className="h-4 w-4" /> {value.startsWith("r2:") ? "Upload a different video" : "Or upload a video"}</>}
      </Button>
    </div>
  );
}

function BrandsTab({ d, change, url, kit, episodes }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; url: string; kit: BioBrandsPublic | null; episodes: { id: string; title: string }[] }) {
  const { toast } = useToast();
  const b = d.brands ?? DEFAULT_BRANDS;
  const set = (p: Partial<BioBrands>, now = false) => change({ brands: { ...b, ...p } }, now);
  const link = `${url}/brands`;
  const n = kit?.numbers;
  const rates = kit ? ratesFor(kit) : [];
  const b2 = { ...DEFAULT_BRANDS, ...b };
  const fmt = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v));
  const rows: [string, string | null, string][] = [
    ["Downloads per episode", n?.perEpisode ? fmt(n.perEpisode) : null, "Host your show here, or connect your host in Integrations"],
    ["Downloads, last 30 days", n?.last30 ? fmt(n.last30) : null, "Comes with your downloads"],
    ["Social followers", n?.reach ? fmt(n.reach) : null, "Connect your social accounts in Integrations"],
    ["Page views, last 30 days", n?.pageViews30 ? fmt(n.pageViews30) : null, "Share your SmartLink"],
  ];
  const fold = useFold("brands");
  // A section's switch: most just show or hide; rates and the sponsor form have their own switch too.
  const shown = (id: BrandsSectionId) => !b2.hidden.includes(id) && (id === "rates" ? b2.showRates : id === "sponsor" ? b2.sponsorOn : true);
  const show = (id: BrandsSectionId, v: boolean) => set({ hidden: v ? b2.hidden.filter((x) => x !== id) : [...b2.hidden, id], ...(id === "rates" ? { showRates: v } : id === "sponsor" ? { sponsorOn: v } : {}) }, true);
  const order = arrange(BRANDS_SECTIONS, b2.order);
  const card = (id: BrandsSectionId, grip: React.ReactNode, icon: typeof User, tone: keyof typeof TONES, title: string, body: React.ReactNode) => (
    <Card icon={icon} tone={tone} title={title} fold={fold.of(id)} on={{ checked: shown(id), set: (v) => show(id, v) }} grip={grip} testid={`brands-card-${id}`}>{body}</Card>
  );
  const sections: Record<BrandsSectionId, (grip: React.ReactNode) => React.ReactNode> = {
    video: (g) => card("video", g, Video, "violet", "Your reel", <>
      <p className="-mt-1 text-xs text-muted-foreground">A video brands can watch right on your kit: your best reel, a past sponsored spot, or a short intro.</p>
      <VideoPick value={b2.video} onChange={(v) => set({ video: v }, true)} testid="brands-video" />
    </>),
    sample: (g) => card("sample", g, Headphones, "gold", "A sample to hear", <>
        <p className="-mt-1 text-xs text-muted-foreground">An episode brands can press play on. Pick one of yours, or paste a link to an episode (or a feed, for its latest).</p>
        {episodes.length > 0 && (
          <select value={b2.sample.startsWith("ep:") ? b2.sample : ""} onChange={(e) => set({ sample: e.target.value }, true)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="brands-sample-ep">
            <option value="">No episode picked</option>
            {episodes.slice(0, 50).map((e) => <option key={e.id} value={`ep:${e.id}`}>{e.title}</option>)}
          </select>
        )}
        <Input key={b2.sample.startsWith("ep:") ? "ep" : `u-${b2.sample}`} defaultValue={b2.sample.startsWith("ep:") ? "" : b2.sample} onBlur={(e) => { const v = e.target.value.trim(); if (v !== b2.sample && (v || !b2.sample.startsWith("ep:"))) set({ sample: v }, true); }} placeholder={episodes.length ? "Or paste a link (https://…mp3, or an RSS feed)" : "Paste a link (https://…mp3, or an RSS feed)"} data-testid="brands-sample-url" />
        {b2.sample && !b2.sample.startsWith("ep:") && kit?.media?.sample?.from !== b2.sample && <p className="text-[11px] text-muted-foreground">We read the link when it saves. If nothing shows on your kit, check it's an audio file or a podcast feed.</p>}
    </>),
    stats: (g) => card("stats", g, Eye, "blue", "Your numbers, measured by us", <>
        {rows.some(([, v]) => v) && (
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border">
            {rows.filter(([, v]) => v).map(([label, v], i) => (
              <div key={label} className="px-3 py-2.5" style={{ borderTop: i > 1 ? "1px solid hsl(var(--border))" : undefined, borderLeft: i % 2 ? "1px solid hsl(var(--border))" : undefined }}>
                <p className="text-xl font-bold tabular-nums">{v}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}
        {rows.some(([, v]) => !v) && <p className="text-xs text-muted-foreground">More to show: {Array.from(new Set(rows.filter(([, v]) => !v).map(([, , how]) => how))).join(" · ")}.</p>}
    </>),
    reach: (g) => card("reach", g, AtSign, "violet", "Social reach", n?.followers.length ? (
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {n.followers.map((x) => <div key={x.platform} className="flex items-center justify-between px-3 py-2 text-sm"><span>{platformLabel(x.platform as SocialPlatform)}{x.username && !/^\d+$/.test(x.username) ? <span className="text-muted-foreground"> @{x.username.replace(/^@/, "")}</span> : null}</span><span className="font-semibold tabular-nums">{fmt(x.followers)}</span></div>)}
      </div>
    ) : <p className="text-xs text-muted-foreground">Connect your social accounts in Integrations and your followers show here.</p>),
    audience: (g) => card("audience", g, Users, "violet", "Who listens", <>
      <TextEditor body={b2.audience} onBody={(audience) => set({ audience })} rows={3} maxLength={400} placeholder="Officer candidates, their families and recent veterans, mostly 22–35, across the US." testid="brands-audience" />
      <AudienceData kit={kit} />
    </>),
    rates: (g) => card("rates", g, Tag, "violet", "Sponsorship rates", <>
      <p className="-mt-1 text-xs text-muted-foreground">Worked out from your social following and, if you have a show, its downloads, like Know Your Worth.</p>
        {rates.length ? rates.map((g) => (
          <div key={g.key}>
            <p className="mb-1 text-xs font-bold">{g.title}</p>
            <div className="divide-y divide-border rounded-2xl border border-border">
              {g.items.map((x) => (
                <div key={x.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{x.label}</span><span className="font-semibold tabular-nums">{Math.round(x.low) === Math.round(x.high) ? `$${Math.round(x.mid).toLocaleString()}` : `$${Math.round(x.low).toLocaleString()}–$${Math.round(x.high).toLocaleString()}`}</span></div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{g.note}</p>
          </div>
        )) : <p className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">Your rates appear here once you connect a social account in Integrations, or we can see your show's downloads.</p>}
    </>),
    partners: (g) => card("partners", g, Handshake, "gold", "Brands you've worked with", <>
        <p className="-mt-1 text-xs text-muted-foreground">Add their home page and we'll put their logo on your kit. Or just type the name.</p>
        {b.partners.map((p, i) => {
          const edit = (x: Partial<BioBrands["partners"][number]>, now = false) => set({ partners: b.partners.map((y, j) => (j === i ? { ...y, ...x } : y)) }, now);
          const findLogo = async (url: string) => {
            const u = url.trim();
            if (!u) { edit({ logo: "" }, true); return; }
            const site = /^https?:\/\//i.test(u) ? u : `https://${u}`;
            try {
              const r = await apiRequest("GET", `/api/host/bio/logo?url=${encodeURIComponent(site)}`);
              const j = (await r.json()) as { logo?: string };
              edit({ url: site, logo: j.logo ?? "", name: p.name || new URL(site).hostname.replace(/^www\./, "").split(".")[0].replace(/^./, (c) => c.toUpperCase()) }, true);
            } catch { edit({ url: site }, true); }
          };
          return (
            <div key={p.id} className="flex items-center gap-2" data-testid="brands-partner">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-1">{p.logo ? <img src={p.logo} alt="" className="max-h-full max-w-full object-contain" /> : <Handshake className="h-4 w-4 text-muted-foreground" />}</span>
              <Input value={p.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Brand name" className="w-[38%]" />
              <Input defaultValue={p.url} onBlur={(e) => e.target.value.trim() !== p.url && void findLogo(e.target.value)} placeholder="Their website (for the logo)" className="flex-1" data-testid="brands-partner-url" />
              <button type="button" onClick={() => set({ partners: b.partners.filter((_, j) => j !== i) }, true)} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => set({ partners: [...b.partners, { id: newId(), name: "", url: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]" data-testid="brands-add-partner"><Plus className="h-3.5 w-3.5" /> Add a brand</button>
    </>),
    episodes: (g) => card("episodes", g, Headphones, "blue", "Latest episodes", <p className="-mt-1 text-xs text-muted-foreground">{kit?.podcast ? `Your latest three from ${kit.podcast.title}, with a link to listen.` : "Shows once you have a podcast here or connected."}</p>),
    sponsor: (g) => card("sponsor", g, Handshake, "gold", kit?.podcast ? "Sponsor this show" : "Work with me", <p className="-mt-1 text-xs text-muted-foreground">The button at the top and a form at the end. Brands ask to sponsor you, and our partnerships team helps you close the deal.</p>),
  };
  return (
    <div className="space-y-4">
      <FoldAll onAll={(v) => fold.all(["kit", "top", "about", ...order], v)} />
      <Card icon={Handshake} tone="gold" title="Your media kit" fold={fold.of("kit")} on={{ checked: b.on, set: (v) => set({ on: v }, true) }} testid="brands-card-kit">
        {b.on ? <p className="-mt-1 truncate text-xs text-muted-foreground">{link.replace(/^https?:\/\/(www\.)?/, "")} · send it to any brand</p> : <p className="-mt-1 text-xs text-muted-foreground">Off: brands can't open it.</p>}
        {b.on && (
          <div className="flex gap-2">
            <Button onClick={() => void navigator.clipboard.writeText(link).then(() => toast({ title: "Media kit link copied" }))} className="flex-1 gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="brands-copy"><Copy className="h-4 w-4" /> Copy link</Button>
            <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
          </div>
        )}
      </Card>

      <Card icon={LayoutTemplate} tone="violet" title="Top of your kit" fold={fold.of("top")}>
        <LayoutTiles d={d} value={b2.layout} onPick={(v) => set({ layout: v }, true)} photo={b2.photo || d.avatarUrl} own={{ label: "Media kit", art: <span className="relative flex h-16 flex-col items-center overflow-hidden rounded-lg" style={{ background: `linear-gradient(145deg, ${d.theme.color}, #000741)` }}><span className="mt-2 h-7 w-7 rounded-full ring-2 ring-white/40" style={{ background: (b2.photo || d.avatarUrl) ? `center/cover url(${b2.photo || d.avatarUrl})` : "#888" }} /><span className="mt-1.5 h-1 w-10 rounded bg-white/90" /><span className="mt-1 h-1.5 w-8 rounded-full bg-[#F0A71F]" /></span> }} />
      </Card>

      <Card icon={User} tone="blue" title="About you, for brands" fold={fold.of("about")}>
        <ViewPhoto kind="brands" url={b.photo ?? ""} fallback={d.avatarUrl} note="A professional headshot works best for brands." onChange={(u) => set({ photo: u }, true)} />
        <Field label="Name brands see" hint="Your own name usually works best here, even if your page uses the show's.">
          <Input value={b2.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder={d.displayName || "Your name"} data-testid="brands-name" />
        </Field>
        <div>
          <div className="mb-1 flex items-end justify-between gap-2">
            <span className="text-sm font-semibold">Bio for brands</span>
            {d.bio && !b2.pitch && <button type="button" onClick={() => set({ pitch: d.bio.slice(0, 400) })} className="text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Start from my page's bio</button>}
          </div>
          <TextEditor body={b2.pitch} onBody={(pitch) => set({ pitch })} rows={4} maxLength={400} placeholder="Marine veteran and host of Marine OCS Blog. I help officer candidates get through OCS, and brands reach them the month before they ship." testid="brands-pitch" />
          <p className="mt-1 text-xs text-muted-foreground">Written for brands: who you are, who you reach, why it works. Only this shows on your kit.</p>
        </div>
      </Card>

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">On your kit · drag to reorder</p>
      <Sortable ids={order} onMove={(x) => set({ order: x }, true)} render={(id, grip) => sections[id](grip)} />
    </div>
  );
}

/** The audience data behind the kit (inside Who listens): read from Discovery (once a month at most), shown to brands from our copy. */
function AudienceData({ kit }: { kit: BioBrandsPublic | null }) {
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
    <div className="space-y-3 rounded-xl bg-muted/40 p-3">
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
    </div>
  );
}

// ---- Family (a private page) --------------------------------------------------------

function FamilyTab({ d, change, flush, url, famPreview }: { d: Page; change: (p: Partial<Page>, now?: boolean) => void; flush: () => Promise<void>; url: string; famPreview: BioFamilyPublic | null }) {
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
  const fold = useFold("family");
  const hidden = f.hidden ?? [];
  const order = arrange(FAMILY_SECTIONS, f.order);
  const card = (id: FamilySectionId, grip: React.ReactNode, icon: typeof User, tone: keyof typeof TONES, title: string, body: React.ReactNode) => (
    <Card icon={icon} tone={tone} title={title} fold={fold.of(id)} on={{ checked: !hidden.includes(id), set: (v) => set({ hidden: v ? hidden.filter((x) => x !== id) : [...hidden, id] }, true) }} grip={grip} testid={`family-card-${id}`}>{body}</Card>
  );
  const sections: Record<FamilySectionId, (grip: React.ReactNode) => React.ReactNode> = {
    note: (g) => card("note", g, Sparkles, "green", "A note to your family", <>
      <TextEditor body={f.note} align={f.noteAlign ?? "left"} onBody={(note) => set({ note })} onAlign={(noteAlign) => set({ noteAlign }, true)} rows={4} maxLength={1000} placeholder="Mom, Dad: this is what I've been working on. Thank you for always being in my corner." testid="family-note-input" />
      <p className="text-xs text-muted-foreground">Like a letter, signed with your name.</p>
    </>),
    voice: (g) => card("voice", g, Mic, "gold", "A voice message", <>
        <p className="-mt-1 text-xs text-muted-foreground">Record a message in your own voice. It plays near the top of their page.</p>
        <VoiceRecorder value={f.audio ?? ""} preview={famPreview?.media?.audio?.from === f.audio ? famPreview.media.audio.url : ""} onChange={(v) => set({ audio: v }, true)} />
    </>),
    video: (g) => card("video", g, Video, "violet", "A video for them", <>
        <p className="-mt-1 text-xs text-muted-foreground">A message from you, a homecoming, a moment from the show. It plays near the top.</p>
        <VideoPick value={f.video ?? ""} onChange={(v) => set({ video: v }, true)} testid="family-video" />
    </>),
    milestones: (g) => card("milestones", g, Calendar, "blue", "Along the way", <>
        {f.milestones.map((m, i) => (
          <div key={m.id} className="space-y-2 rounded-2xl border border-border p-3">
            <div className="flex gap-2">
              <Input value={m.when} onChange={(e) => set({ milestones: f.milestones.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })} placeholder="When (2014)" className="w-1/3" />
              <Input value={m.title} onChange={(e) => set({ milestones: f.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder="What happened" className="flex-1" />
              <button type="button" onClick={() => set({ milestones: f.milestones.filter((_, j) => j !== i) }, true)} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
            <TextEditor body={m.note} onBody={(note) => set({ milestones: f.milestones.map((x, j) => (j === i ? { ...x, note } : x)) })} rows={2} maxLength={400} placeholder="A line about it (optional)" testid="family-moment-note" />
          </div>
        ))}
        <button type="button" onClick={() => set({ milestones: [...f.milestones, { id: newId(), when: "", title: "", note: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]" data-testid="family-add-milestone"><Plus className="h-3.5 w-3.5" /> Add a moment</button>
        {!f.milestones.length && <p className="text-xs text-muted-foreground">Enlisting, graduating OCS, a deployment, coming home, your first episode.</p>}
    </>),
    photos: (g) => card("photos", g, ImagePlus, "violet", "Photos", <>
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
    </>),
  };
  return (
    <div className="space-y-4">
      <FoldAll onAll={(v) => fold.all(["page", "top", ...order], v)} />
      <Card icon={Heart} tone="gold" title="Your family private page" fold={fold.of("page")} on={{ checked: f.on, set: (v) => set({ on: v }, true) }} testid="family-card-page">
        {!f.on && <p className="-mt-1 text-xs text-muted-foreground">Off: the link doesn't open.</p>}
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
        <Field label="Your name, for family" hint="What they call you. It's at the top and signs your note.">
          <Input value={f.name ?? ""} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder={d.displayName || "Your name"} data-testid="family-name" />
        </Field>
        <ViewPhoto kind="family" url={f.photo ?? ""} fallback={d.heroUrl || d.avatarUrl} note="The big photo at the top. One with family, or in uniform." onChange={(u) => set({ photo: u }, true)} />
      </Card>

      <Card icon={LayoutTemplate} tone="violet" title="Top of the page" fold={fold.of("top")}>
        <LayoutTiles d={d} value={f.layout ?? ""} onPick={(v) => set({ layout: v }, true)} photo={f.photo || d.avatarUrl} own={{ label: "Family", art: <span className="relative flex h-16 flex-col items-center justify-end overflow-hidden rounded-lg" style={{ background: (f.photo || d.heroUrl || d.avatarUrl) ? `center 25%/cover url(${f.photo || d.heroUrl || d.avatarUrl})` : `linear-gradient(145deg, ${d.theme.color}, #000741)` }}><span className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" /><span className="relative mb-2 h-1.5 w-10 rounded bg-white" /></span> }} />
      </Card>

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">On the page · drag to reorder</p>
      <Sortable ids={order} onMove={(x) => set({ order: x }, true)} render={(id, grip) => sections[id](grip)} />
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
