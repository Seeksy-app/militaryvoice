/**
 * A podcaster's bio page (militaryvoices.ai/<handle>): the shape the builder
 * edits and the public page renders, one and the same, so what they see in
 * the preview is what a listener gets.
 */

export type BioTemplate = "classic" | "bold" | "minimal" | "vibrant";
export type BioShade = "light" | "dark";
export type BioFont = "sans" | "serif" | "mono";
export type BioLinkShape = "pill" | "rounded" | "square";
export type BioLinkStyle = "fill" | "outline" | "soft";
export type BioLayout = "portrait" | "landscape" | "blend" | "hero" | "shape";
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
  | { id: string; type: "promo"; visible: boolean; title: string; code: string; url: string; note: string }
  | { id: string; type: "meeting"; visible: boolean; title: string; url: string; note: string }
  | { id: string; type: "text"; visible: boolean; title: string; body: string };
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
}
export const DEFAULT_BRANDS: BioBrands = { on: true, pitch: "", audience: "", showRates: false, partners: [], photo: "" };
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
  /** A note to their family, at the top. */
  note: string;
  /** Their story, in their words. */
  story: string;
  /** Moments that matter: enlisting, deployments, the first episode… */
  milestones: { id: string; when: string; title: string; note: string }[];
  photos: { id: string; url: string; caption: string }[];
  /** Episode ids to start with. */
  favorites: string[];
  /** A photo just for family ("" = their cover or profile photo). */
  photo: string;
}
export const DEFAULT_FAMILY: BioFamily = { on: true, key: "", note: "", story: "", milestones: [], photos: [], favorites: [], photo: "" };
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
};

export const DEFAULT_THEME: BioTheme = { template: "bold", color: "#F0A71F", shade: "dark", font: "sans", linkShape: "pill", linkStyle: "fill", layout: "blend", podcastStyle: "spotlight", podcastFrame: "full", podcast: DEFAULT_PODCAST };

export const SWATCHES = ["#F0A71F", "#053877", "#0A4A99", "#DC2626", "#991B1B", "#EA580C", "#CA8A04", "#16A34A", "#0D9488", "#7C3AED", "#DB2777", "#111827", "#6B7280", "#FFFFFF"];

export function parseTheme(raw: string | null | undefined): BioTheme {
  let v: Partial<BioTheme> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; }
  const t = { ...DEFAULT_THEME, ...v, podcast: { ...DEFAULT_PODCAST, ...(v.podcast ?? {}) } };
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
