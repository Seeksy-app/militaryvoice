// Upload-Post integration (https://docs.upload-post.com). We use it only for
// its hosted "connect your social accounts" flow: each podcaster gets an
// Upload-Post *user profile*, we send them to a short-lived connect URL, and
// when they come back we read which accounts they linked and show those on
// their public cards. Nothing is ever posted on their behalf from here.
//
// Requires UPLOAD_POST_API_KEY. When it's unset every call reports
// "not configured" and the UI hides the feature instead of erroring.

const API_KEY = process.env.UPLOAD_POST_API_KEY;
const BASE = "https://api.upload-post.com/api";

export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "facebook",
  "threads",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialAccount {
  platform: SocialPlatform;
  username: string; // handle without @ when we can tell
  displayName: string;
  url: string; // best-effort public profile URL ("" if we can't build one)
  image: string; // avatar URL from the platform, if provided
}

export function isUploadPostConfigured(): boolean {
  return !!API_KEY;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_KEY) throw new Error("Upload-Post is not configured (UPLOAD_POST_API_KEY missing).");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Apikey ${API_KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || res.statusText;
    const err = new Error(`Upload-Post ${method} ${path} failed (${res.status}): ${msg}`);
    (err as any).status = res.status;
    throw err;
  }
  return json as T;
}

/** Create the Upload-Post profile if it doesn't exist yet. Idempotent. */
export async function ensureUploadPostProfile(username: string): Promise<void> {
  try {
    await call("POST", "/uploadposts/users", { username });
  } catch (err: any) {
    // Already exists → fine. Upload-Post answers 400/409 with a message
    // mentioning the duplicate; anything else is a real failure.
    const status = err?.status;
    const msg = String(err?.message || "").toLowerCase();
    if ((status === 400 || status === 409) && (msg.includes("exist") || msg.includes("already"))) return;
    // Fall back to a lookup so a differently-worded duplicate error doesn't block.
    try {
      await call("GET", `/uploadposts/users/${encodeURIComponent(username)}`);
      return;
    } catch {
      throw err;
    }
  }
}

export async function createConnectUrl(input: {
  username: string;
  redirectUrl: string;
  logoUrl: string;
}): Promise<string> {
  const res = await call<{ success: boolean; access_url: string }>("POST", "/uploadposts/users/generate-jwt", {
    username: input.username,
    redirect_url: input.redirectUrl,
    logo_image: input.logoUrl,
    redirect_button_text: "Back to MilitaryVoice.ai",
    connect_title: "Connect your show's social accounts",
    connect_description:
      "Link the accounts where listeners can follow your podcast. They'll appear on your card in the marathon lineup.",
    platforms: [...SOCIAL_PLATFORMS],
    show_calendar: false,
    language: "en",
  });
  if (!res?.access_url) throw new Error("Upload-Post did not return a connect URL.");
  return res.access_url;
}

/** Fetch the profile and normalize whatever Upload-Post reports as connected. */
export async function fetchConnectedAccounts(username: string): Promise<SocialAccount[]> {
  const res = await call<{ success: boolean; profile?: { social_accounts?: Record<string, unknown> } }>(
    "GET",
    `/uploadposts/users/${encodeURIComponent(username)}`,
  );
  return normalizeSocialAccounts(res?.profile?.social_accounts ?? {});
}

function cleanHandle(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@/, "") : "";
}

function profileUrlFor(platform: SocialPlatform, handle: string): string {
  if (!handle) return "";
  // Some platforms hand back a full URL as the "username"; keep it if so.
  if (/^https?:\/\//i.test(handle)) return handle;
  switch (platform) {
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "youtube":
      // Channel IDs look like "UC" + 22 chars; everything else is a handle.
      return /^UC[\w-]{22}$/.test(handle) ? `https://www.youtube.com/channel/${handle}` : `https://www.youtube.com/@${handle}`;
    case "x":
      return `https://x.com/${handle}`;
    case "threads":
      return `https://www.threads.net/@${handle}`;
    case "linkedin":
      // Upload-Post returns an id for personal profiles more often than a
      // vanity slug; only link when it looks like a slug.
      return /^[a-z0-9-]{3,100}$/i.test(handle) && !/^\d+$/.test(handle) ? `https://www.linkedin.com/in/${handle}` : "";
    case "facebook":
      // Works for both numeric page ids and vanity names.
      return `https://www.facebook.com/${handle}`;
    default:
      return "";
  }
}

export function normalizeSocialAccounts(raw: Record<string, unknown>): SocialAccount[] {
  const out: SocialAccount[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const entry = raw[platform];
    if (!entry) continue; // null / "" / missing → not connected
    let username = "";
    let displayName = "";
    let image = "";
    if (typeof entry === "string") {
      username = cleanHandle(entry);
    } else if (typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      username = cleanHandle(e.handle) || cleanHandle(e.username);
      displayName = typeof e.display_name === "string" ? e.display_name.trim() : "";
      image = typeof e.social_images === "string" ? e.social_images : "";
      if (!username && !displayName) continue;
    } else {
      continue;
    }
    out.push({
      platform,
      username,
      displayName: displayName || username,
      url: profileUrlFor(platform, username),
      image,
    });
  }
  return out;
}

/** Parse the JSON we store on profiles/signups; tolerate old empty strings. */
export function parseSocialAccounts(json: string | null | undefined): SocialAccount[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as SocialAccount[]) : [];
  } catch {
    return [];
  }
}
