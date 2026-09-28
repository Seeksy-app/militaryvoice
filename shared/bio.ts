/**
 * A podcaster's bio page (militaryvoices.ai/<handle>): the shape the builder
 * edits and the public page renders, one and the same, so what they see in
 * the preview is what a listener gets.
 */

export type BioTemplate = "classic" | "bold" | "minimal" | "vibrant" | "portrait";
/** The page's tone: plain white, a hint of grey, light grey, a tint of their colour, or dark. */
export type BioShade = "none" | "minimal" | "light" | "tint" | "dark";
export type BioFont = "sans" | "serif" | "mono" | "playfair" | "montserrat" | "poppins";
export type BioLinkShape = "pill" | "rounded" | "square" | "squircle";
/** soft = a white card with a soft shadow; hard = a card with a solid offset shadow in the link colour. */
export type BioLinkStyle = "fill" | "outline" | "soft" | "hard";
export interface BioBackground { mode: "solid" | "gradient" | "image"; /** "" = the shade's own */ color: string; image: string }
export type BioLayout = "portrait" | "landscape" | "blend" | "hero" | "shape" | "cutout" | "popout" | "sticker" | "magazine";
/** The tops that stand their cut-out photo on the page. */
export const CUTOUT_LAYOUTS: BioLayout[] = ["cutout", "popout", "sticker", "magazine"];
/** The podcast edge to edge (full) or in a card with a margin (card). */
export type BioPodcastFrame = "full" | "card";
/** How the podcast shows: the latest big (spotlight), a list, or cards to swipe. */
export type BioPodcastStyle = "spotlight" | "list" | "carousel";

export interface BioTheme {
  template: BioTemplate;
  /** Accent: buttons, the play button, headings. */
  color: string;
  shade: BioShade;
  font: BioFont;
  linkShape: BioLinkShape;
  linkStyle: BioLinkStyle;
  layout: BioLayout;
  podcastStyle: BioPodcastStyle;
  podcastFrame: BioPodcastFrame;
  /** The podcast section's own options. */
  podcast: BioPodcastOptions;
  /** The link buttons' colour ("" = the theme colour). */
  linkColor: string;
  background: BioBackground;
  /** Where the cover, hero or banner photo is cropped, top (0) to bottom (100). */
  imageY: number;
  /** The round (or shaped) photo's size. */
  avatarSize: "s" | "m" | "l";
  /** "Made with MilitaryVoices.ai" at the foot. */
  branding: boolean;
  /** Their name left off the top (a logo or a photo that says it already). */
  hideName: boolean;
  /** How much of their colour washes into the background, 0–100. */
  bgTint: number;
  /** The background darker (−100) or lighter (+100). */
  bgBrightness: number;
  /** How strong the wash over a photo background is, 0–100 (so the words read). */
  bgWash: number;
  /** The cut-out photo moved up (−) or down (+), in points, and its size in percent. */
  cutoutY: number;
  cutoutSize: number;
}

export interface BioPodcastOptions {
  on: boolean;
  /** "" = the show's title. */
  heading: string;
  /** Episodes shown: 3, 5 or 10. */
  count: number;
  apple: boolean;
  spotify: boolean;
  all: boolean;
  rss: boolean;
}
export const DEFAULT_PODCAST: BioPodcastOptions = { on: true, heading: "", count: 5, apple: true, spotify: true, all: true, rss: true };

export type BioSection =
  | { id: string; type: "links"; visible: boolean; title: string; links: { id: string; label: string; url: string }[] }
  | { id: string; type: "video"; visible: boolean; title: string; url: string }
  /** Promo codes: a list of sponsors' codes (code/url/note are the one code from before the list, read as the first). */
  | { id: string; type: "promo"; visible: boolean; title: string; codes?: BioPromoCode[]; code: string; url: string; note: string }
  | { id: string; type: "meeting"; visible: boolean; title: string; url: string; note: string }
  /** Text: **bold**, *italic* and __underline__ in the body, aligned left, centre or right. */
  | { id: string; type: "text"; visible: boolean; title: string; body: string; align?: BioAlign }
  /** Music: songs, albums or playlists from Spotify, Apple Music, SoundCloud or YouTube, each a player. */
  | { id: string; type: "music"; visible: boolean; title: string; tracks: { id: string; url: string }[] };
export type BioAlign = "left" | "center" | "right";
export type BioPromoCode = { id: string; brand: string; code: string; note: string; url: string };
/** A promo section's codes, the old single code included. */
export const promoCodes = (s: { codes?: BioPromoCode[]; code: string; url: string; note: string; id: string }): BioPromoCode[] =>
  s.codes?.length ? s.codes : s.code || s.url || s.note ? [{ id: `${s.id}-0`, brand: "", code: s.code, note: s.note, url: s.url }] : [];

/** A music link as an embedded player: its address and height, or null when we can't play it here. */
export function musicEmbed(u: string): { src: string; h: number } | null {
  const url = u.trim();
  const sp = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/);
  if (sp) return { src: `https://open.spotify.com/embed/${sp[1]}/${sp[2]}`, h: sp[1] === "track" || sp[1] === "episode" ? 152 : 352 };
  if (/^https:\/\/music\.apple\.com\//.test(url)) return { src: url.replace("https://music.apple.com/", "https://embed.music.apple.com/"), h: /[?&]i=|\/song\//.test(url) ? 175 : 450 };
  if (/^https:\/\/(www\.|m\.)?soundcloud\.com\//.test(url)) return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&visual=false&show_comments=false`, h: /\/sets\//.test(url) ? 300 : 166 };
  const yt = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  if (yt) return { src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, h: 0 };
  return null;
}
export type BioSectionType = BioSection["type"];

export interface BioSocial { platform: string; username: string; url: string; on: boolean }

/** The Brands view (a media kit at /<handle>/brands): what the podcaster writes for it. */
export interface BioBrands {
  on: boolean;
  /** One or two lines: why brands work with them. */
  pitch: string;
  /** Who listens, in their words ("Officer candidates and their families, 22–35"). */
  audience: string;
  /** Show the rate card worked out from their downloads (Know Your Worth). */
  showRates: boolean;
  /** Brands they've worked with. */
  partners: { id: string; name: string; url: string }[];
  /** A photo just for brands ("" = their profile photo). */
  photo: string;
  /** The name brands see ("" = the page's name). */
  name: string;
  /** The Sponsor this show button (Work with me, without a podcast), and the form under it. */
  sponsorOn: boolean;
  /** A reel or video: a YouTube, Vimeo, Instagram or TikTok link, or one they uploaded ("r2:<key>"). */
  video: string;
  /** A sample to hear: one of their episodes ("ep:<id>"), an audio link, or a feed (its latest episode). */
  sample: string;
  /** The sample link as read when it was saved (the server's, never typed in). */
  sampleInfo?: { title: string; audio: string; artworkUrl: string };
}
export const DEFAULT_BRANDS: BioBrands = { on: true, pitch: "", audience: "", showRates: false, partners: [], photo: "", name: "", sponsorOn: true, video: "", sample: "" };

/** A video link as a player: an embed (wide or tall), a file to play, or null. */
export function videoEmbed(u: string): { kind: "frame" | "file"; src: string; tall: boolean } | null {
  const url = u.trim();
  if (!/^https:\/\//.test(url)) return null;
  const yt = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  if (yt) return { kind: "frame", src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, tall: /shorts\//.test(url) };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: "frame", src: `https://player.vimeo.com/video/${vm[1]}`, tall: false };
  const ig = url.match(/instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([\w-]+)/);
  if (ig) return { kind: "frame", src: `https://www.instagram.com/${ig[1] === "p" ? "p" : "reel"}/${ig[2]}/embed/`, tall: true };
  const tt = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
  if (tt) return { kind: "frame", src: `https://www.tiktok.com/embed/v2/${tt[1]}`, tall: true };
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return { kind: "file", src: url, tall: false };
  return null;
}
/** Media resolved on the server for a view: an uploaded video's address, a sample episode's audio. */
export interface BioViewMedia {
  video: { from: string; url: string } | null;
  /** The Family view's voice message. */
  audio?: { from: string; url: string } | null;
  sample: { from: string; title: string; audio: string; artworkUrl: string } | null;
}
export function parseBrands(raw: string | null | undefined): BioBrands {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_BRANDS, ...v, partners: Array.isArray(v?.partners) ? v.partners.filter((x: { name?: unknown }) => typeof x?.name === "string") : [] };
  } catch { return { ...DEFAULT_BRANDS }; }
}

/** The Family view: a private page at /<handle>/family/<key>, for the people closest to them. */
export interface BioFamily {
  on: boolean;
  /** The private part of the link. New key = the old link stops working. */
  key: string;
  /** A note to their family, at the top (**bold**, *italic*, __underline__, and emoji). */
  note: string;
  noteAlign?: BioAlign;
  /** Their story, in their words. */
  story: string;
  /** Moments that matter: enlisting, deployments, the first episode… */
  milestones: { id: string; when: string; title: string; note: string }[];
  photos: { id: string; url: string; caption: string }[];
  /** Episode ids to start with. */
  favorites: string[];
  /** A photo just for family ("" = their cover or profile photo). */
  photo: string;
  /** The name family sees ("" = the page's name). */
  name: string;
  /** A video for them: a link, or one they uploaded ("r2:<key>"). */
  video: string;
  /** A voice message they recorded in the app ("r2:<key>"). */
  audio: string;
}
export const DEFAULT_FAMILY: BioFamily = { on: true, key: "", note: "", story: "", milestones: [], photos: [], favorites: [], photo: "", name: "", video: "", audio: "" };
export function parseFamily(raw: string | null | undefined): BioFamily {
  try {
    const v = raw ? JSON.parse(raw) : {};
    const arr = (x: unknown) => (Array.isArray(x) ? x : []);
    return { ...DEFAULT_FAMILY, ...v, milestones: arr(v?.milestones), photos: arr(v?.photos), favorites: arr(v?.favorites).filter((x: unknown) => typeof x === "string") };
  } catch { return { ...DEFAULT_FAMILY }; }
}

/** What the Family view gets (never the key, never sponsor talk). */
export interface BioFamilyPublic {
  handle: string;
  displayName: string;
  avatarUrl: string;
  heroUrl: string;
  branch: string;
  theme: BioTheme;
  family: Omit<BioFamily, "key">;
  podcast: null | { title: string; artworkUrl: string; episodeCount: number; episodes: { id: string; title: string; publishedAt: string; durationSec: number; audio: string; artworkUrl: string }[] };
  /** Proud numbers, in plain words. */
  numbers: { episodes: number; listens: number; followers: number };
  /** They take messages (the family's notes go to the same Messages). */
  askEnabled: boolean;
  /** Their own first name (the page's name is often the show's). */
  firstName: string;
  media?: BioViewMedia;
}

/** Independent audience data for the media kit: the podcaster's biggest account, as the index measured it. */
export interface BioAudience {
  platform: string;
  handle: string;
  /** When it was measured. */
  asOf: string;
  followers: number | null;
  engagementRate: number | null;
  realPct: number | null;
  medianViews: number | null;
  femalePct: number | null;
  malePct: number | null;
  ages: { name: string; pct: number }[];
  countries: { name: string; pct: number }[];
  states: { name: string; pct: number }[];
  interests: string[];
  /** Brands their audience follows. */
  affinity: string[];
  /** Brands seen in their sponsored posts. */
  pastSponsors: string[];
}

/** What the public Brands view gets: the kit, and the numbers behind it (ours, never typed in). */
export interface BioBrandsPublic {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  branch: string;
  theme: BioTheme;
  kit: BioBrands;
  podcast: null | { title: string; artworkUrl: string; pageUrl: string; episodeCount: number; latest: { title: string; publishedAt: string; artworkUrl: string }[] };
  numbers: {
    /** Downloads for a typical recent episode (the median of the last ten). */
    perEpisode: number | null;
    last30: number | null;
    total: number | null;
    unit: "downloads" | "streams";
    /** Where the downloads come from ("MilitaryVoices hosting", "Buzzsprout"…). */
    source: string;
    followers: { platform: string; username: string; followers: number }[];
    reach: number;
    pageViews30: number;
    plays30: number;
  };
  /** From our Discovery index (cached, never bought for a visitor). */
  audience: BioAudience | null;
  media?: BioViewMedia;
}

/** What the public page gets. */
export interface BioPublic {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  heroUrl: string;
  branch: string;
  theme: BioTheme;
  socials: BioSocial[];
  sections: BioSection[];
  /** The show, top and centre: hosted here, or read from its feed. */
  podcast: null | {
    title: string;
    artworkUrl: string;
    feedUrl: string;
    pageUrl: string;
    appleUrl: string;
    spotifyUrl: string;
    episodeCount: number;
    /** artworkUrl: the episode's own art, else the show's. */
    episodes: { id: string; title: string; publishedAt: string; durationSec: number; audio: string; notes: string; artworkUrl: string }[];
  };
  /** The first thing the chat says, from them. */
  welcome: string;
  /** Their media kit is on (a "For brands" link at the foot of the page). */
  brandsOn?: boolean;
  /** Their photo with the background taken out, for the Cutout top ("" until made). */
  cutoutUrl?: string;
  /** Listeners can send a question (it goes to the podcaster's inbox). */
  askEnabled: boolean;
  /** Ask my show: the AI answers from the episodes it has learned (how many). */
  ai: { enabled: boolean; episodes: number };
}

export const TEMPLATES: Record<BioTemplate, { label: string; note: string; theme: Partial<BioTheme> }> = {
  classic: { label: "Classic", note: "Light and clean", theme: { shade: "light", font: "sans", linkShape: "rounded", linkStyle: "fill", layout: "portrait" } },
  bold: { label: "Bold", note: "Dark, your photo across the top", theme: { shade: "dark", font: "sans", linkShape: "pill", linkStyle: "fill", layout: "blend" } },
  minimal: { label: "Minimal", note: "White, outlines, no fuss", theme: { shade: "light", font: "sans", linkShape: "square", linkStyle: "outline", layout: "portrait" } },
  vibrant: { label: "Vibrant", note: "Your colour behind everything", theme: { shade: "dark", font: "sans", linkShape: "pill", linkStyle: "soft", layout: "landscape" } },
  portrait: { label: "Portrait", note: "Your photo, full screen", theme: { shade: "dark", font: "sans", linkShape: "pill", linkStyle: "soft", layout: "hero" } },
};

export const DEFAULT_THEME: BioTheme = { template: "bold", color: "#F0A71F", shade: "dark", font: "sans", linkShape: "pill", linkStyle: "fill", layout: "blend", podcastStyle: "spotlight", podcastFrame: "full", podcast: DEFAULT_PODCAST, linkColor: "", background: { mode: "solid", color: "", image: "" }, imageY: 50, avatarSize: "m", branding: true, hideName: false, bgTint: 0, bgBrightness: 0, bgWash: 65, cutoutY: 0, cutoutSize: 100 };

/** MilCrunch's fourteen (white, the greys, black, the reds, orange, gold, pink, purple, navy, teal, green) and our gold and navy. */
export const SWATCHES = [
  "#FFFFFF", "#D1D5DB", "#9CA3AF", "#6B7280", "#000000", "#991B1B", "#DC2626", "#EA580C",
  "#CA8A04", "#F0A71F", "#DB2777", "#7C3AED", "#1E3A8A", "#053877", "#0D9488", "#16A34A",
];

/** The typefaces, as CSS, and the Google Fonts family to load (none for the site's own). */
export const FONTS: Record<BioFont, { label: string; css: string; google?: string }> = {
  sans: { label: "Inter", css: "var(--font-sans)" },
  serif: { label: "Merriweather", css: "'Merriweather', Georgia, serif", google: "Merriweather:wght@400;700;900" },
  mono: { label: "IBM Plex Mono", css: "'IBM Plex Mono', ui-monospace, monospace", google: "IBM+Plex+Mono:wght@400;600;700" },
  playfair: { label: "Playfair Display", css: "'Playfair Display', Georgia, serif", google: "Playfair+Display:wght@400;700;900" },
  montserrat: { label: "Montserrat", css: "'Montserrat', sans-serif", google: "Montserrat:wght@400;600;800" },
  poppins: { label: "Poppins", css: "'Poppins', sans-serif", google: "Poppins:wght@400;600;800" },
};

export const LINK_RADIUS: Record<BioLinkShape, number> = { pill: 9999, rounded: 14, square: 3, squircle: 20 };

// ---- Colour -------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
export function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function onColor(hex: string): string {
  return lum(hex) > 0.45 ? "#0b1020" : "#ffffff";
}
/** Their colour, unless it would vanish into the page behind it (navy on a dark page): then white, or navy on a light one. */
export function standOut(color: string, page: string, dark: boolean): string {
  const [a, b] = [lum(color), lum(page)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 2.4 ? color : dark ? "#ffffff" : "#053877";
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t);
  const r = ch((pa >> 16) & 255, (pb >> 16) & 255), g = ch((pa >> 8) & 255, (pb >> 8) & 255), bl = ch(pa & 255, pb & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * Everything the page is painted with, from the theme: the page colour and
 * what sits behind it (a solid, a gradient from their colour, or a photo under
 * a scrim), whether it reads dark, the ink, and the colours that must show on it.
 */
export function bioPalette(t: BioTheme) {
  const theirs = HEX.test(t.color) ? t.color : "#F0A71F";
  const shade = (t.shade as string) ?? "light";
  const base = shade === "none" ? "#ffffff" : shade === "minimal" ? "#f9fafb" : shade === "tint" ? mix("#ffffff", theirs, 0.1) : shade === "dark" ? "#0b1020" : "#f5f6fa";
  const bg = t.background ?? { mode: "solid", color: "", image: "" };
  const chosen = HEX.test(bg.color) ? bg.color : "";
  // The sliders: a tint of their colour, then darker or lighter.
  const tint = Math.max(0, Math.min(100, t.bgTint ?? 0)) / 100;
  const bright = Math.max(-100, Math.min(100, t.bgBrightness ?? 0)) / 100;
  let paper = bg.mode !== "image" && chosen ? chosen : base;
  if (tint > 0) paper = mix(paper, theirs, tint * 0.7);
  if (bright > 0) paper = mix(paper, "#ffffff", bright * 0.85);
  else if (bright < 0) paper = mix(paper, "#000000", -bright * 0.85);
  const dark = bg.mode === "image" ? shade === "dark" : lum(paper) < 0.3;
  let background = paper;
  // A soft wash of their colour at the top, as MilCrunch does, so the words stay readable on it.
  if (bg.mode === "gradient") background = `linear-gradient(180deg, ${mix(paper, theirs, Math.min(0.9, (dark ? 0.45 : 0.3) + tint * 0.4))} 0%, ${paper} 65%)`;
  else if (bg.mode === "image" && /^https?:\/\//.test(bg.image)) {
    const a = Math.max(0, Math.min(100, t.bgWash ?? 65)) / 100;
    const wash = dark ? `rgba(11,16,32,${a})` : `rgba(255,255,255,${a})`;
    background = `linear-gradient(${wash}, ${wash}), center/cover no-repeat url(${bg.image})`;
  }
  else if (t.template === "vibrant" && !chosen) background = `linear-gradient(180deg, ${theirs} 0%, ${dark ? "#0b1020" : "#f7f8fb"} 70%)`;
  const ink = dark ? "#ffffff" : "#0b1020";
  const accent = standOut(theirs === "#ffffff" && !dark ? "#053877" : theirs, paper, dark);
  const link = HEX.test(t.linkColor ?? "") ? standOut(t.linkColor, paper, dark) : accent;
  return {
    theirs, paper, background, dark, ink, accent, link,
    sub: dark ? "rgba(255,255,255,0.68)" : "rgba(11,16,32,0.62)",
    card: dark ? "rgba(255,255,255,0.07)" : "#ffffff",
    line: dark ? "rgba(255,255,255,0.12)" : "rgba(11,16,32,0.10)",
    font: (FONTS[t.font] ?? FONTS.sans).css,
    radius: LINK_RADIUS[t.linkShape] ?? 14,
  };
}

export function parseTheme(raw: string | null | undefined): BioTheme {
  let v: Partial<BioTheme> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; }
  const t = { ...DEFAULT_THEME, ...v, podcast: { ...DEFAULT_PODCAST, ...(v.podcast ?? {}) }, background: { ...DEFAULT_THEME.background, ...(v.background ?? {}) } };
  if (!/^#[0-9a-f]{6}$/i.test(t.color)) t.color = DEFAULT_THEME.color;
  return t;
}

export function parseSections(raw: string | null | undefined): BioSection[] {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.type === "string") : []; } catch { return []; }
}

export function parseSocials(raw: string | null | undefined): BioSocial[] {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((s) => s && typeof s.platform === "string") : []; } catch { return []; }
}

/** Top-level addresses the site already uses: never a handle. */
export const RESERVED_HANDLES = new Set([
  "about", "admin", "agenda", "api", "assets", "directory", "discover", "e", "event", "events", "faq", "feed", "find", "go", "green-room", "greenroom",
  "headshot", "help", "host", "icons", "login", "logout", "national-military-podcast-day", "og", "platform", "podcast", "podcast-one-pitch", "podcasts",
  "policy", "prepare", "pricing", "privacy", "promo", "review", "s", "schedule", "settings", "signup", "sponsor", "sponsors", "studio", "studio-platform",
  "terms", "vfw", "watch", "watchfloor", "militaryvoices", "support", "contact", "blog", "app", "www", "static", "robots.txt", "sitemap.xml", "manifest.json",
]);

export const handleOk = (h: string) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(h) && !RESERVED_HANDLES.has(h);
