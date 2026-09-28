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
export type BioLayout = "portrait" | "landscape" | "blend";
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
}

export type BioSection =
  | { id: string; type: "links"; visible: boolean; title: string; links: { id: string; label: string; url: string }[] }
  | { id: string; type: "video"; visible: boolean; title: string; url: string }
  | { id: string; type: "promo"; visible: boolean; title: string; code: string; url: string; note: string }
  | { id: string; type: "meeting"; visible: boolean; title: string; url: string; note: string }
  | { id: string; type: "text"; visible: boolean; title: string; body: string };
export type BioSectionType = BioSection["type"];

export interface BioSocial { platform: string; username: string; url: string; on: boolean }

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

export const DEFAULT_THEME: BioTheme = { template: "bold", color: "#F0A71F", shade: "dark", font: "sans", linkShape: "pill", linkStyle: "fill", layout: "blend", podcastStyle: "spotlight" };

export const SWATCHES = ["#F0A71F", "#053877", "#0A4A99", "#DC2626", "#991B1B", "#EA580C", "#CA8A04", "#16A34A", "#0D9488", "#7C3AED", "#DB2777", "#111827", "#6B7280", "#FFFFFF"];

export function parseTheme(raw: string | null | undefined): BioTheme {
  let v: Partial<BioTheme> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; }
  const t = { ...DEFAULT_THEME, ...v };
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
