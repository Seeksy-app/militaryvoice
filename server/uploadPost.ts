// Upload-Post integration (https://docs.upload-post.com). Two things happen
// here. First, the hosted "connect your social accounts" flow: each podcaster
// gets an Upload-Post *user profile*, we send them to a short-lived connect
// URL, and when they come back we read which accounts they linked and show
// those on their public cards. Second, publishing a finished session to those
// accounts — only ever when the podcaster themselves presses the button.
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
  followers?: number; // from /analytics when the platform reports it
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
    redirect_button_text: "Back to MilitaryVoices.ai",
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
  return typeof v === "string" ? v.trim().replace(/^@+/, "") : "";
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
      displayName = typeof e.display_name === "string" ? e.display_name.trim() : "";
      if (platform === "facebook") {
        // Facebook: `username` is the numeric account/Page id (needed for the
        // Page URL and analytics); the human name lives in handle/display_name.
        const id = cleanHandle(e.username);
        username = /^\d+$/.test(id) ? id : cleanHandle(e.handle) || id;
        displayName = displayName || cleanHandle(e.handle);
      } else {
        username = cleanHandle(e.handle) || cleanHandle(e.username);
      }
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

// ---------------------------------------------------------------------------
// Follower counts. GET /analytics/{username}?platforms=... returns per-platform
// metrics including `followers`. Facebook needs a Page id; Upload-Post links a
// personal account first, so when it complains we read the manageable Page out
// of the error, pin it, and retry — which also gives us the Page's real name.
// ---------------------------------------------------------------------------
type AnalyticsResponse = Record<string, { followers?: number; success?: boolean; error?: string } | undefined>;

async function analytics(username: string, platforms: string[], pageId?: string): Promise<AnalyticsResponse> {
  const q = new URLSearchParams({ platforms: platforms.join(",") });
  if (pageId) q.set("page_id", pageId);
  return call<AnalyticsResponse>("GET", `/analytics/${encodeURIComponent(username)}?${q.toString()}`);
}

async function pinFacebookPage(username: string, pageId: string): Promise<void> {
  try {
    await call("POST", "/uploadposts/users/facebook-page", { profile_username: username, facebook_page_id: pageId, page_id: pageId });
  } catch (err) {
    console.warn("Upload-Post: pin facebook page failed (non-fatal):", (err as Error).message);
  }
}

/**
 * The untouched analytics payload for a set of platforms.
 *
 * `enrichWithFollowers` below reads one field out of this. The audience
 * snapshot needs the rest of it — reach, impressions, engagement — and needs
 * to see the failure blocks too, so it can tell "this account reports nothing"
 * apart from "this account wasn't asked".
 */
export async function rawAnalytics(username: string, platforms: string[], pageId?: string): Promise<Record<string, unknown>> {
  return (await analytics(username, platforms, pageId)) as unknown as Record<string, unknown>;
}

/** Adds `followers` to each account where the platform reports it. Never throws. */
export async function enrichWithFollowers(username: string, accounts: SocialAccount[]): Promise<SocialAccount[]> {
  if (accounts.length === 0) return accounts;
  const out = accounts.map((a) => ({ ...a }));
  const byPlatform = new Map(out.map((a) => [a.platform, a]));
  try {
    const fb = byPlatform.get("facebook");
    const pageId = fb && /^\d+$/.test(fb.username) ? fb.username : undefined;
    let res = await analytics(username, out.map((a) => a.platform), pageId);

    // Facebook: personal account id was linked, not a Page. Pull the Page out
    // of the error text ("Use one of: OCS Blog (233012933525655)") and retry.
    const fbErr = res.facebook && res.facebook.success === false ? String(res.facebook.error || "") : "";
    const m = fbErr.match(/([^:,]+?)\s*\((\d{6,})\)/);
    if (fb && m) {
      const [, pageName, newPageId] = m;
      fb.username = newPageId;
      fb.displayName = pageName.trim();
      fb.url = `https://www.facebook.com/${newPageId}`;
      await pinFacebookPage(username, newPageId);
      try {
        const retry = await analytics(username, ["facebook"], newPageId);
        res = { ...res, facebook: retry.facebook };
      } catch {
        /* keep going without facebook followers */
      }
    }

    for (const a of out) {
      const r = res[a.platform];
      if (r && typeof r.followers === "number" && Number.isFinite(r.followers)) a.followers = Math.max(0, Math.round(r.followers));
    }
  } catch (err) {
    console.warn("Upload-Post analytics failed (followers omitted):", (err as Error).message);
  }
  return out;
}

export interface PublishResult {
  ok: boolean;
  raw: unknown;
}

/**
 * Publishes one video to the podcaster's own connected accounts.
 *
 * `videoUrl` is a signed link to the recording rather than the file itself:
 * Upload-Post accepts a public URL in the same field as a binary upload, and
 * that keeps a multi-gigabyte MP4 from being pulled through our server.
 */
export async function publishVideo(input: {
  username: string;
  platforms: string[];
  videoUrl: string;
  title: string;
  description?: string;
}): Promise<PublishResult> {
  if (!API_KEY) throw new Error("Upload-Post is not configured (UPLOAD_POST_API_KEY missing).");
  if (input.platforms.length === 0) throw new Error("Pick at least one account to post to.");

  const form = new FormData();
  form.set("user", input.username);
  for (const p of input.platforms) form.append("platform[]", p);
  form.set("video", input.videoUrl);
  form.set("title", input.title.slice(0, 300));
  if (input.description) form.set("description", input.description.slice(0, 4000));
  // A full session can take a while to fetch and transcode; don't hold the
  // request open waiting for it.
  form.set("async_upload", "true");

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { Authorization: `Apikey ${API_KEY}` },
    body: form,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = (json as any)?.message || (json as any)?.error || text || res.statusText;
    throw new Error(`Upload-Post couldn't post that (${res.status}): ${msg}`);
  }
  return { ok: true, raw: json };
}

/**
 * Post an image to the networks they've connected. Same shape as publishVideo
 * but hits /upload_photos, which takes photos[] instead of video.
 */
export async function publishPhoto(input: {
  username: string;
  platforms: string[];
  photoUrl: string;
  title: string;
  description?: string;
  /** Post later: an ISO date, read in `timezone` (default UTC). Returns 202 and a job. */
  scheduledDate?: string;
  timezone?: string;
}): Promise<PublishResult> {
  if (!API_KEY) throw new Error("Upload-Post is not configured (UPLOAD_POST_API_KEY missing).");
  if (input.platforms.length === 0) throw new Error("Pick at least one account to post to.");

  const form = new FormData();
  form.set("user", input.username);
  for (const p of input.platforms) form.append("platform[]", p);
  form.append("photos[]", input.photoUrl);
  // Several networks use the title as the caption, so it carries the post.
  form.set("title", input.title.slice(0, 300));
  if (input.description) form.set("description", input.description.slice(0, 4000));
  if (input.scheduledDate) {
    form.set("scheduled_date", input.scheduledDate);
    if (input.timezone) form.set("timezone", input.timezone);
  }

  const res = await fetch(`${BASE}/upload_photos`, {
    method: "POST",
    headers: { Authorization: `Apikey ${API_KEY}` },
    body: form,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = (json as any)?.message || (json as any)?.error || text || res.statusText;
    throw new Error(String(msg));
  }
  return (json ?? { success: true }) as PublishResult;
}

/** The posts waiting to go out, optionally for one profile. */
export async function listScheduledPosts(username?: string): Promise<Array<{ job_id: string; scheduled_date: string; post_type: string; profile_username: string; title: string }>> {
  if (!API_KEY) throw new Error("Upload-Post is not configured (UPLOAD_POST_API_KEY missing).");
  const q = username ? `?profile_username=${encodeURIComponent(username)}` : "";
  const res = await fetch(`${BASE}/uploadposts/schedule${q}`, { headers: { Authorization: `Apikey ${API_KEY}` } });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { scheduled_posts?: Array<{ job_id: string; scheduled_date: string; post_type: string; profile_username: string; title: string }> };
  return json.scheduled_posts ?? [];
}

/** Take a scheduled post back before it goes out. */
export async function cancelScheduledPost(jobId: string): Promise<void> {
  if (!API_KEY) throw new Error("Upload-Post is not configured (UPLOAD_POST_API_KEY missing).");
  const res = await fetch(`${BASE}/uploadposts/schedule/${encodeURIComponent(jobId)}`, { method: "DELETE", headers: { Authorization: `Apikey ${API_KEY}` } });
  if (!res.ok) throw new Error(await res.text());
}
