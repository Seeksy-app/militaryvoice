import type { SocialAccount, SocialPlatform } from "./schema.js";

// Turning the links people actually typed into follow buttons.
//
// Only a handful of podcasters have connected accounts through Upload-Post.
// Everyone else pasted something into a free-text box during signup, and what
// they pasted is real and useful — "https://www.instagram.com/th3drillpad",
// "Instagram.com/ @formeractionguys", "www.oscarmikeradio.com". Until now the
// public cards read connected accounts only, so thirteen of eighteen shows had
// no follow buttons at all while their profile dialog showed the links plainly.
//
// This is deliberately forgiving about input and strict about output: it will
// accept a missing scheme, a stray space, tracking junk on the end and mixed
// case, but it only ever emits a link to a real profile on a platform we have
// an icon for. Anything it cannot place stays a plain website link, which the
// dialog already handles.

/** Hosts we can place, in the order we test them. */
const HOSTS: { match: RegExp; platform: SocialPlatform }[] = [
  { match: /(^|\.)instagram\.com$/i, platform: "instagram" },
  { match: /(^|\.)(youtube\.com|youtu\.be)$/i, platform: "youtube" },
  { match: /(^|\.)linkedin\.com$/i, platform: "linkedin" },
  { match: /(^|\.)tiktok\.com$/i, platform: "tiktok" },
  { match: /(^|\.)(twitter\.com|x\.com)$/i, platform: "x" },
  { match: /(^|\.)(facebook\.com|fb\.com)$/i, platform: "facebook" },
  { match: /(^|\.)threads\.(net|com)$/i, platform: "threads" },
];

/**
 * A YouTube URL that points at a channel rather than one video.
 *
 * "Follow the show" has to land somewhere you can subscribe. One host pasted a
 * /watch?v= link and another a /playlist — both are fine links and neither is
 * a channel, so they are not turned into a follow button.
 */
function youtubeChannel(u: URL): string | null {
  const path = u.pathname.replace(/\/+$/, "");
  if (/^\/(watch|playlist|shorts|embed)$/i.test(path) || path === "") return null;
  const m = path.match(/^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)$/i);
  return m ? m[1].replace(/^(channel|c|user)\//i, "") : null;
}

/** Best-effort URL parse for text a person typed rather than pasted cleanly. */
function toUrl(raw: string): URL | null {
  let t = raw.trim().replace(/[\s,;]+$/, "");
  if (!t) return null;
  // "Instagram.com/ @formeractionguys" — a space after the slash is a typo,
  // not a separator, and dropping it recovers a perfectly good handle.
  t = t.replace(/\/\s+/g, "/");
  if (!/^https?:\/\//i.test(t)) {
    if (!/^[\w-]+(\.[\w-]+)+\//.test(t) && !/^[\w-]+(\.[\w-]+)+$/.test(t)) return null;
    t = `https://${t}`;
  }
  try {
    return new URL(t);
  } catch {
    return null;
  }
}

export interface DerivedLink {
  platform: SocialPlatform;
  username: string;
  url: string;
}

/** Place one link on a platform, or return null if it's just a website. */
export function detectSocialLink(raw: string): DerivedLink | null {
  const u = toUrl(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./i, "");
  const entry = HOSTS.find((h) => h.match.test(host));
  if (!entry) return null;

  if (entry.platform === "youtube") {
    const handle = youtubeChannel(u);
    if (!handle) return null;
    return { platform: "youtube", username: handle.replace(/^@/, ""), url: `https://www.youtube.com/${handle.startsWith("@") ? handle : handle}` };
  }

  const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!first) return null;
  // LinkedIn keeps its /in/ or /company/ prefix; the rest are bare handles.
  if (entry.platform === "linkedin") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { platform: "linkedin", username: parts[1], url: `https://www.linkedin.com/${parts[0]}/${parts[1]}` };
  }
  const username = decodeURIComponent(first).replace(/^@/, "");
  if (!username || /^(p|reel|share|watch|posts?)$/i.test(username)) return null;

  const base: Record<Exclude<SocialPlatform, "linkedin" | "youtube">, string> = {
    instagram: `https://instagram.com/${username}`,
    tiktok: `https://www.tiktok.com/@${username}`,
    x: `https://x.com/${username}`,
    facebook: `https://www.facebook.com/${username}`,
    threads: `https://www.threads.net/@${username}`,
  };
  return { platform: entry.platform, username, url: base[entry.platform as keyof typeof base] };
}

/**
 * Every follow destination we can show for one show.
 *
 * Connected accounts win: they carry real follower counts and a verified
 * handle. A pasted link only fills a platform nothing is connected on, so
 * turning Upload-Post on later silently upgrades the card rather than
 * duplicating its buttons.
 */
export function deriveSocialAccounts(
  connected: SocialAccount[],
  socialLinks?: string | null,
  youtubeUrl?: string | null,
): SocialAccount[] {
  const out = [...connected];
  const have = new Set(out.map((a) => a.platform));

  // The free-text box holds one link for most people and several for some.
  const candidates = [
    ...String(socialLinks ?? "").split(/[\s,|]+/),
    ...String(youtubeUrl ?? "").split(/[\s,|]+/),
  ].filter(Boolean);

  for (const raw of candidates) {
    const found = detectSocialLink(raw);
    if (!found || have.has(found.platform)) continue;
    have.add(found.platform);
    out.push({
      platform: found.platform,
      username: found.username,
      displayName: found.username,
      url: found.url,
      image: "",
    });
  }
  return out;
}

/** True when a link is worth showing but isn't a platform we have an icon for. */
export function isPlainWebsite(raw: string): boolean {
  return Boolean(toUrl(raw)) && detectSocialLink(raw) === null;
}
