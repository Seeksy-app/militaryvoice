// Discovery: find military and veteran creators, guests and speakers.
//
// Three kinds of people come here for the same thing asked three ways: a
// brand looking for creators to sponsor, a podcaster looking for guests, an
// event looking for speakers. One engine answers all three: our own lineup
// first (verified, free, the people we know), then Influencers Club's index
// of creators across the networks.
//
// Influencers Club charges per answer, so every paid answer is cached and
// shared: a search page for a day (their picture links expire after a day),
// a creator's analytics for a month, a contact for good. Revealing a contact
// is the expensive, personal step, so each member gets an allowance a month.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { getAdminEmail, getSessionEmail, requireHostSession } from "./session.js";
import {
  discoveryMembers,
  discoveryCache,
  discoveryLists,
  discoveryListItems,
  discoveryReveals,
  podcasterProfiles,
} from "../shared/schema.js";

const BASE = "https://api-dashboard.influencers.club/public/v1";
export const PLATFORMS = ["instagram", "youtube", "tiktok", "twitter", "twitch"] as const;
type Platform = (typeof PLATFORMS)[number];
const FREE_REVEALS_PER_MONTH = 10;
const PAGE_SIZE = 24;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Influencers Club
// ---------------------------------------------------------------------------

function key(): string {
  const k = (process.env.INFLUENCER_CLUB_API_KEY || "").trim();
  if (!k) throw new HttpError(503, "Discovery isn't connected yet.");
  return k;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function ic(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = json?.detail || json?.message || json?.error || text.slice(0, 200);
    // Out of credits, or a brief it couldn't read: both are the user's to know.
    if (res.status === 402) throw new HttpError(402, "Discovery is out of search credits for the moment.");
    if (res.status === 400) {
      console.warn("discovery 400:", path, text.slice(0, 500));
      throw new HttpError(400, typeof msg === "string" ? msg : `That search couldn't be run. ${JSON.stringify(json).slice(0, 240)}`);
    }
    throw new HttpError(502, `Couldn't reach the creator index (${res.status}).`);
  }
  return json;
}

/** Admin-only: a raw call, to read real response shapes. */
export async function probeIc(path: string, body: unknown): Promise<unknown> {
  if (!["/discovery/", "/creators/enrich/handle/analytics/", "/discovery/creators/similar/"].includes(path)) throw new HttpError(400, "Not a probe path.");
  return ic(path, body);
}

/** Read the first present value from a list of dotted paths. */
function pick(obj: any, ...paths: string[]): any {
  for (const p of paths) {
    let cur = obj;
    for (const k of p.split(".")) {
      if (cur == null) break;
      cur = cur[k];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}
const num = (v: any): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

async function cached<T>(k: string, maxAgeMs: number, make: () => Promise<T>): Promise<T> {
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, k));
  if (row && Date.now() - Date.parse(row.createdAt) < maxAgeMs) return JSON.parse(row.payload) as T;
  const fresh = await make();
  const payload = JSON.stringify(fresh);
  const createdAt = new Date().toISOString();
  await db
    .insert(discoveryCache)
    .values({ key: k, payload, createdAt })
    .onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
  return fresh;
}
const hash = (v: unknown) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 20);

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface CreatorCard {
  platform: string;
  handle: string;
  name: string;
  picture: string;
  followers: number | null;
  engagement: number | null;
  branch: string;
  /** On our lineup: verified by us, with their show. */
  verified?: { show: string; host: string; serviceStatus: string; slotLabel: string } | null;
}

const BRANCHES: [string, RegExp][] = [
  ["Marine Corps", /\b(usmc|marine corps|marines?|semper fi|devil ?dog)\b/i],
  ["Army", /\b(army|soldier|airborne|ranger|green beret|hooah)\b/i],
  ["Navy", /\b(navy|usn|sailor|seal|corpsman)\b/i],
  ["Air Force", /\b(air force|usaf|airman)\b/i],
  ["Coast Guard", /\b(coast guard|uscg)\b/i],
  ["Space Force", /\b(space force|ussf|guardian)\b/i],
  ["Military spouse", /\b(mil ?spouse|military (wife|spouse|husband)|milso)\b/i],
];
function branchOf(text: string): string {
  for (const [b, re] of BRANCHES) if (re.test(text)) return b;
  return "";
}

/** Their picture links expire; ours go through a proxy that the browser caches. */
const img = (u: string) => (u ? `/api/discover/img?u=${encodeURIComponent(u)}` : "");

function toCard(platform: string, a: any): CreatorCard {
  const p = a?.profile ?? a ?? {};
  const name = String(pick(p, "full_name", "fullname", "name") ?? "");
  const handle = String(pick(p, "username", "handle", "custom_url") ?? a?.user_id ?? "").replace(/^@/, "");
  const bio = String(pick(p, "biography", "bio", "description") ?? "");
  let eng = num(pick(p, "engagement_percent", "engagement_rate"));
  if (eng != null && eng > 0 && eng < 1 && !pick(p, "engagement_percent")) eng = eng * 100;
  return {
    platform,
    handle,
    name: name || handle,
    picture: img(String(pick(p, "picture", "profile_picture", "avatar") ?? "")),
    followers: num(pick(p, "followers", "subscribers", "number_of_followers")),
    engagement: eng,
    branch: branchOf(`${name} ${handle} ${bio}`),
  };
}

// ---------------------------------------------------------------------------
// Our own creators: verified, free, first
// ---------------------------------------------------------------------------

async function verifiedCreators(): Promise<(CreatorCard & { match: string })[]> {
  const ev = await storage.getFeaturedEvent();
  const signups = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled" && s.email !== "hello@militaryvoice.ai" && s.email !== "andrew@smartloads.io");
  const emails = signups.map((s) => s.email.trim().toLowerCase());
  const profiles = emails.length ? await db.select().from(podcasterProfiles).where(inArray(podcasterProfiles.email, emails)) : [];
  const when = (slot: number) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(Date.parse(ev.startAtUtc) + slot * ev.slotMinutes * 60_000)) + " ET";
  return signups
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((s) => {
      const prof = profiles.find((p) => p.email.trim().toLowerCase() === s.email.trim().toLowerCase());
      let accounts: { platform: string; username: string; followers?: number; url?: string }[] = [];
      try {
        accounts = JSON.parse(s.socialAccounts || prof?.socialAccounts || "[]");
      } catch {
        /* none */
      }
      const best = [...accounts].sort((x, y) => (y.followers ?? 0) - (x.followers ?? 0))[0];
      const total = accounts.reduce((n, a) => n + (a.followers ?? 0), 0);
      const branch = prof?.branch && prof.branch !== "None" ? prof.branch : "";
      return {
        platform: best?.platform ?? "",
        handle: best?.username ?? "",
        name: s.hostName.trim(),
        picture: s.photoUrl,
        followers: total || null,
        engagement: null,
        branch,
        verified: { show: s.podcastName.trim(), host: s.hostName.trim(), serviceStatus: prof?.serviceStatus ?? "", slotLabel: when(s.slotIndex) },
        match: `${s.podcastName} ${s.hostName} ${branch} ${prof?.serviceStatus ?? ""} podcast podcaster guest speaker veteran military`.toLowerCase(),
      };
    });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function memberFor(email: string) {
  const [m] = await db.select().from(discoveryMembers).where(eq(discoveryMembers.email, email));
  return m;
}
async function requireMember(req: Request): Promise<{ email: string; member: NonNullable<Awaited<ReturnType<typeof memberFor>>> }> {
  // Admins always have Discovery: by their admin session, or the admin key.
  const adminEmail = getAdminEmail(req);
  const adminKey = String(req.get("x-admin-password") ?? "");
  if (adminEmail || (adminKey && adminKey === (await storage.getFeaturedEvent()).adminPassword)) {
    const e = (adminEmail || "admin@militaryvoice.ai").toLowerCase();
    return { email: e, member: (await memberFor(e)) ?? { id: 0, email: e, role: "admin", orgName: "MilitaryVoice", createdAt: "" } };
  }
  const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
  if (!email) throw new HttpError(401, "Create your free account to search.");
  const member = await memberFor(email);
  if (!member) throw new HttpError(403, "Add Discovery to your account to search.");
  return { email, member };
}
async function revealsThisMonth(email: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: discoveryReveals.id })
    .from(discoveryReveals)
    .where(and(eq(discoveryReveals.email, email), gte(discoveryReveals.createdAt, start.toISOString())));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function send(res: Response, fn: () => Promise<unknown>) {
  fn()
    .then((body) => res.json(body))
    .catch((err: any) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error("discovery:", err);
      res.status(status).json({ message: err?.message ?? "Something went wrong." });
    });
}
const asPlatform = (v: unknown): Platform => (PLATFORMS.includes(String(v) as Platform) ? (String(v) as Platform) : "instagram");

export function registerDiscoveryRoutes(app: Express): void {
  /** Who's asking: signed in or not, and whether Discovery is on their account. */
  app.get("/api/discover/me", (req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "no-store");
      const adminEmail = (getAdminEmail(req) ?? "").toLowerCase();
      const email = ((getSessionEmail(req) ?? "") || adminEmail).trim().toLowerCase();
      if (!email) return { signedIn: false };
      const member = (await memberFor(email)) ?? (adminEmail ? { role: "admin", orgName: "MilitaryVoice", createdAt: "" } : undefined);
      const profile = await storage.getProfileByEmail(email);
      return {
        signedIn: true,
        email,
        isPodcaster: !!profile,
        member: member ? { role: member.role, orgName: member.orgName, since: member.createdAt } : null,
        reveals: member ? { used: await revealsThisMonth(email), allowance: FREE_REVEALS_PER_MONTH } : null,
      };
    }),
  );

  /** Add Discovery to the signed-in account. Free. */
  app.post("/api/discover/join", requireHostSession, (req, res) =>
    send(res, async () => {
      const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
      const role = ["brand", "podcaster", "event", "agency", "other"].includes(String(req.body?.role)) ? String(req.body.role) : "other";
      const orgName = String(req.body?.orgName ?? "").trim().slice(0, 120);
      await db
        .insert(discoveryMembers)
        .values({ email, role, orgName, createdAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: discoveryMembers.email, set: { role, orgName } });
      return { ok: true };
    }),
  );

  /** Our own lineup: verified MilitaryVoice creators. Public and free. */
  app.get("/api/discover/verified", (_req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "public, max-age=300");
      return (await verifiedCreators()).map(({ match: _m, ...c }) => c);
    }),
  );

  /** The search: our verified creators that match, then the index. */
  app.post("/api/discover/search", (req, res) =>
    send(res, async () => {
      await requireMember(req);
      const platform = asPlatform(req.body?.platform);
      const q = String(req.body?.q ?? "").trim().slice(0, 200);
      const branch = String(req.body?.branch ?? "").trim().slice(0, 40);
      const page = Math.max(0, Math.min(40, Number(req.body?.page) || 0));
      const minF = num(req.body?.minFollowers);
      const maxF = num(req.body?.maxFollowers);
      const sortBy = ["relevancy", "engagement_rate", "number_of_followers", "growth_rate"].includes(String(req.body?.sort)) ? String(req.body.sort) : "relevancy";

      // The brief, in plain English. The community is always part of it:
      // this is a military and veteran index, not a general one.
      const military = /\b(military|veteran|vet|army|navy|marine|usmc|air force|coast guard|space force|spouse|milspouse|service ?member|soldier|sailor|airman)\b/i.test(`${q} ${branch}`);
      const brief = [
        branch === "Military spouse" ? "military spouse" : branch ? `${branch} veteran` : "",
        q,
        military ? "" : "in the US military and veteran community",
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "US military veterans and military spouses";
      const filters: Record<string, unknown> = {};
      if (minF != null || maxF != null) filters.number_of_followers = { ...(minF != null ? { min: minF } : {}), ...(maxF != null ? { max: maxF } : {}) };
      const body = { platform, nlp_search: brief, paging: { limit: PAGE_SIZE, page }, sort: { sort_by: sortBy, sort_order: "desc" }, filters };

      const found = await cached(`search:${hash(body)}`, DAY - 3_600_000, async () => {
        const r = await ic("/discovery/", body);
        return { total: num(r?.total) ?? 0, accounts: (r?.accounts ?? []).map((a: any) => toCard(platform, a)), understood: r?.nlp_search ?? null, applied: r?.applied_filters ?? null };
      });

      // Ours first, on the first page, when the words match.
      let verified: CreatorCard[] = [];
      if (page === 0) {
        const words = `${q} ${branch}`.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "with", "for", "who", "creators", "followers"].includes(w));
        verified = (await verifiedCreators())
          .filter((c) => (!branch || c.branch.toLowerCase() === branch.toLowerCase()) && (words.length === 0 || words.some((w) => c.match.includes(w))))
          .slice(0, 8)
          .map(({ match: _m, ...c }) => c);
      }
      return { brief, platform, page, pageSize: PAGE_SIZE, total: found.total, results: found.accounts, verified, understood: found.understood };
    }),
  );

  /** A creator's analytics: growth, engagement, income, hashtags, past sponsors. */
  app.get("/api/discover/creator", (req, res) =>
    send(res, async () => {
      await requireMember(req);
      const platform = asPlatform(req.query.platform);
      const handle = String(req.query.handle ?? "").replace(/^@/, "").trim().slice(0, 100);
      if (!handle) throw new HttpError(400, "Which creator?");
      const full = await cached(`analytics:${platform}:${handle.toLowerCase()}`, 30 * DAY, async () => {
        const r = await ic("/creators/enrich/handle/analytics/", { handle, platform, include_lookalikes: false });
        return normalizeAnalytics(platform, handle, r);
      });
      // The raw answer stays in the cache for correcting the readers; admins can see it.
      const { raw, ...rest } = full;
      return req.query.raw === "1" && (await storage.isAdminEmail(String(getSessionEmail(req) ?? ""))) ? full : rest;
    }),
  );

  /** Creators like this one. */
  app.get("/api/discover/similar", (req, res) =>
    send(res, async () => {
      await requireMember(req);
      const platform = asPlatform(req.query.platform);
      const handle = String(req.query.handle ?? "").replace(/^@/, "").trim().slice(0, 100);
      if (!handle) throw new HttpError(400, "Which creator?");
      return cached(`similar:${platform}:${handle.toLowerCase()}`, 7 * DAY, async () => {
        const r = await ic("/discovery/creators/similar/", { platform, filter_key: "username", filter_value: handle, paging: { limit: 12, page: 0 } });
        return (r?.accounts ?? []).map((a: any) => toCard(platform, a));
      });
    }),
  );

  /** A creator's email and phone. Counted against the member's monthly allowance. */
  app.post("/api/discover/reveal", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const platform = asPlatform(req.body?.platform);
      const handle = String(req.body?.handle ?? "").replace(/^@/, "").trim().slice(0, 100);
      if (!handle) throw new HttpError(400, "Which creator?");
      // Already revealed by this member: free to see again.
      const [again] = await db
        .select({ id: discoveryReveals.id })
        .from(discoveryReveals)
        .where(and(eq(discoveryReveals.email, email), eq(discoveryReveals.platform, platform), eq(discoveryReveals.handle, handle.toLowerCase())));
      if (!again) {
        const used = await revealsThisMonth(email);
        if (used >= FREE_REVEALS_PER_MONTH) throw new HttpError(429, `You've used your ${FREE_REVEALS_PER_MONTH} free contacts this month. They reset on the 1st.`);
      }
      const contact = await cached(`contact:${platform}:${handle.toLowerCase()}`, 3650 * DAY, async () => {
        const r = await ic("/creators/enrich/handle/profile/", { handle, platform, email_required: "preferred" });
        const res0 = r?.result ?? r ?? {};
        return {
          email: pick(res0, "email", "emails.0", `${platform}.email`) ?? null,
          phone: pick(res0, "contact_phone_number", `${platform}.contact_phone_number`) ?? null,
          location: pick(res0, "location", "country") ?? null,
          website: pick(res0, "website", `${platform}.external_url`, `${platform}.website`) ?? null,
        };
      });
      if (!again) await db.insert(discoveryReveals).values({ email, platform, handle: handle.toLowerCase(), createdAt: new Date().toISOString() });
      return { ...contact, reveals: { used: await revealsThisMonth(email), allowance: FREE_REVEALS_PER_MONTH } };
    }),
  );

  // ---- Saved lists ---------------------------------------------------------
  app.get("/api/discover/lists", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const lists = await db.select().from(discoveryLists).where(eq(discoveryLists.email, email)).orderBy(desc(discoveryLists.createdAt));
      const items = lists.length ? await db.select().from(discoveryListItems).where(inArray(discoveryListItems.listId, lists.map((l) => l.id))) : [];
      return lists.map((l) => ({
        ...l,
        items: items.filter((i) => i.listId === l.id).map((i) => ({ ...i, snapshot: JSON.parse(i.snapshot || "{}") })),
      }));
    }),
  );
  app.post("/api/discover/lists", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const name = String(req.body?.name ?? "").trim().slice(0, 80) || "My list";
      const [row] = await db.insert(discoveryLists).values({ email, name, createdAt: new Date().toISOString() }).returning();
      return row;
    }),
  );
  app.delete("/api/discover/lists/:id", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const id = Number(req.params.id);
      const [l] = await db.select().from(discoveryLists).where(and(eq(discoveryLists.id, id), eq(discoveryLists.email, email)));
      if (!l) throw new HttpError(404, "No such list.");
      await db.delete(discoveryListItems).where(eq(discoveryListItems.listId, id));
      await db.delete(discoveryLists).where(eq(discoveryLists.id, id));
      return { ok: true };
    }),
  );
  app.post("/api/discover/lists/:id/items", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const id = Number(req.params.id);
      const [l] = await db.select().from(discoveryLists).where(and(eq(discoveryLists.id, id), eq(discoveryLists.email, email)));
      if (!l) throw new HttpError(404, "No such list.");
      const card = req.body?.card as CreatorCard | undefined;
      if (!card?.handle) throw new HttpError(400, "Which creator?");
      const platform = String(card.platform || "instagram");
      const handle = String(card.handle).toLowerCase();
      const existing = await db.select().from(discoveryListItems).where(and(eq(discoveryListItems.listId, id), eq(discoveryListItems.platform, platform), eq(discoveryListItems.handle, handle)));
      if (existing.length) return existing[0];
      const [row] = await db
        .insert(discoveryListItems)
        .values({ listId: id, platform, handle, snapshot: JSON.stringify(card).slice(0, 4000), note: "", createdAt: new Date().toISOString() })
        .returning();
      return row;
    }),
  );
  app.delete("/api/discover/lists/:id/items/:itemId", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const [l] = await db.select().from(discoveryLists).where(and(eq(discoveryLists.id, Number(req.params.id)), eq(discoveryLists.email, email)));
      if (!l) throw new HttpError(404, "No such list.");
      await db.delete(discoveryListItems).where(and(eq(discoveryListItems.id, Number(req.params.itemId)), eq(discoveryListItems.listId, l.id)));
      return { ok: true };
    }),
  );

  /**
   * Creator pictures, through us: their links expire in a day and some CDNs
   * refuse to be shown on another site. Only image hosts we expect.
   */
  app.get("/api/discover/img", async (req, res) => {
    const u = String(req.query.u ?? "");
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return res.status(400).end();
    }
    const okHost = /(^|\.)(cdninstagram\.com|fbcdn\.net|ytimg\.com|ggpht\.com|googleusercontent\.com|tiktokcdn(-us)?\.com|tiktokcdn\.com|ibyteimg\.com|twimg\.com|jtvnw\.net|influencers\.club|amazonaws\.com|cloudfront\.net|imgix\.net|influencersclub\.workers\.dev)$/i.test(url.hostname);
    if (url.protocol !== "https:" || !okHost) return res.status(404).end();
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) return res.status(404).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3_000_000) return res.status(413).end();
      res.set("Content-Type", type);
      res.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
      res.send(buf);
    } catch {
      res.status(404).end();
    }
  });
}

// ---------------------------------------------------------------------------
// Analytics, read defensively: the per-platform shapes are only partly
// documented, so each figure is read from its likely keys and the raw
// answer is kept in the cache for correcting the readers later.
// ---------------------------------------------------------------------------

function normalizeAnalytics(platform: string, handle: string, r: any) {
  const res0 = r?.result ?? r ?? {};
  const p = res0[platform] ?? res0;
  const weighted = (arr: any, n: number, nameKey = "name") =>
    (Array.isArray(arr) ? arr : [])
      .map((x: any) => ({ name: String(x?.[nameKey] ?? x?.code ?? ""), pct: Math.round((num(x?.weight) ?? 0) * 1000) / 10 }))
      .filter((x: { name: string; pct: number }) => x.name && x.pct > 0)
      .slice(0, n);
  // Follower growth: "12_months_ago: -3.4" and so on, oldest first.
  const g = pick(p, "creator_follower_growth") ?? {};
  const growth = Object.entries(g)
    .map(([k, v]) => ({ monthsAgo: Number(String(k).match(/\d+/)?.[0] ?? 0), pct: num(v) }))
    .filter((x) => x.monthsAgo && x.pct != null)
    .sort((a, b) => b.monthsAgo - a.monthsAgo) as { monthsAgo: number; pct: number }[];
  const aud = pick(p, "audience.audience_followers.data") ?? {};
  const types = Object.fromEntries((Array.isArray(aud.audience_types) ? aud.audience_types : []).map((t: any) => [String(t?.code), Math.round((num(t?.weight) ?? 0) * 1000) / 10]));
  const genders = Object.fromEntries((Array.isArray(aud.audience_genders) ? aud.audience_genders : []).map((t: any) => [String(t?.code).toLowerCase(), Math.round((num(t?.weight) ?? 0) * 1000) / 10]));
  const hashtags = (Array.isArray(p.hashtags_count) ? p.hashtags_count.map((h: any) => String(h?.name ?? "")) : Array.isArray(p.hashtags) ? p.hashtags.map(String) : [])
    .filter((h: string) => h && h.length > 1)
    .slice(0, 16);
  const unique = (xs: any[]) => Array.from(new Set(xs.map((x) => String(x)).filter(Boolean)));
  return {
    platform,
    handle,
    incomeMin: num(pick(p, "income.min")),
    incomeMax: num(pick(p, "income.max")),
    likesMedian: num(pick(p, "likes_median")),
    commentsMedian: num(pick(p, "comments_median")),
    reelsPercent: num(pick(p, "reels_percentage_last_12_posts")),
    reelsMedianViews: num(pick(p, "reels.median_view_count", "reels.avg_view_count")),
    growth,
    hashtags,
    brandsMentioned: unique(Array.isArray(p.brands_found) ? p.brands_found : []).slice(0, 12),
    collaborators: unique((Array.isArray(p.tagged) ? p.tagged : []).map((t: any) => t?.username).filter((u: string) => u && u.toLowerCase() !== handle.toLowerCase())).slice(0, 10),
    pastSponsors: (Array.isArray(p.past_sponsors) ? p.past_sponsors : []).map((s: any) => ({ brand: String(s?.brand_handle ?? s?.brand ?? s?.username ?? ""), posts: num(s?.post_count ?? s?.posts), lastSeen: String(s?.last_seen ?? "") })).filter((s: any) => s.brand).slice(0, 12),
    promotesAffiliates: pick(p, "promotes_affiliate_links") ?? null,
    hasMerch: pick(p, "has_merch") ?? null,
    audience: {
      credibility: num(aud.audience_credibility) != null ? Math.round((num(aud.audience_credibility) as number) * 100) : null,
      credibilityClass: String(aud.credibility_class ?? ""),
      realPct: types.real ?? null,
      suspiciousPct: types.suspicious ?? null,
      massFollowersPct: types.mass_followers ?? null,
      influencersPct: types.influencers ?? null,
      femalePct: genders.female ?? null,
      malePct: genders.male ?? null,
      ages: weighted(aud.audience_ages, 6, "code"),
      countries: weighted(aud.audience_geo?.countries, 5),
      states: weighted(aud.audience_geo?.states, 5),
      cities: weighted(aud.audience_geo?.cities, 5),
      languages: weighted(aud.audience_languages, 3),
      interests: weighted(aud.audience_interests, 8),
      brandAffinity: weighted(aud.audience_brand_affinity, 10),
    },
    fetchedAt: new Date().toISOString(),
    raw: res0,
  };
}
