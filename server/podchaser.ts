// Podcasts in Discovery: shows, and the people who host them or have been on
// them, from Podchaser's REST API (one key in the x-api-key header).
//
// The Starter plan is a thousand requests a month, so every answer is kept
// and shared: a search page for a week, a show or a person for a month, and
// each show or person a search brings back is kept too, so opening it asks for
// less. Before any fresh request we check what's left this month (that check
// is free), and stop short of the end so the month never runs dry.
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";
import { getAdminEmail, getSessionEmail } from "./session.js";
import { isListenNotesConfigured, spendListenNotes, lnSearchShows, lnShowFull } from "./listenNotes.js";

const BASE = "https://developers.podchaser.com/api/rest/v1";
const DAY = 86_400_000;
/** Requests kept back each month, so the last days of it still answer. */
const RESERVE = 40;
/** Fresh searches a visitor (no account) may cause a day, and a member. */
const VISITOR_FRESH = 2;
const MEMBER_FRESH = 40;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readCache<T>(k: string, maxAgeMs: number): Promise<T | null> {
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, k));
  return row && Date.now() - Date.parse(row.createdAt) < maxAgeMs ? (JSON.parse(row.payload) as T) : null;
}
async function writeCache(k: string, v: unknown): Promise<void> {
  const payload = JSON.stringify(v);
  const createdAt = new Date().toISOString();
  await db.insert(discoveryCache).values({ key: k, payload, createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
}
async function cached<T>(k: string, maxAgeMs: number, make: () => Promise<T>): Promise<T> {
  const hit = await readCache<T>(k, maxAgeMs);
  if (hit) return hit;
  const fresh = await make();
  await writeCache(k, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// The API, and the month's allowance
// ---------------------------------------------------------------------------

const apiKey = () => (process.env.PODCHASER_API_KEY || process.env.PODCHASER_CLIENT_ID || process.env.PODCHASER_KEY || "").trim();
export const podchaserOn = () => Boolean(apiKey());

type Usage = { tier: string; used: number; remaining: number | null; quota: number | null; cycleEnd: string };
let usage: (Usage & { at: number }) | null = null;
/** What's left this month. Asking is free; kept for five minutes, counted down as we go. */
async function monthUsage(force = false): Promise<Usage> {
  if (!force && usage && Date.now() - usage.at < 5 * 60_000) return usage;
  const res = await fetch(`${BASE}/usage`, { headers: { "x-api-key": apiKey() }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401) throw new HttpError(503, "Podchaser didn't accept our API key.");
  if (!res.ok) throw new HttpError(502, `Couldn't reach Podchaser (${res.status}).`);
  const d = j?.data ?? j;
  // quota and remaining arrive as numbers or as small objects of numbers.
  const num = (v: unknown) => {
    if (typeof v === "number") return v;
    if (v && typeof v === "object") { const x = Object.values(v as Record<string, unknown>).find((y) => typeof y === "number"); return typeof x === "number" ? x : null; }
    return null;
  };
  usage = { at: Date.now(), tier: String(d?.tier ?? ""), used: Number(d?.used ?? 0), remaining: num(d?.remaining), quota: num(d?.quota), cycleEnd: String(d?.cycle_end ?? "") };
  return usage;
}

async function get(path: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<any> {
  if (!podchaserOn()) throw new HttpError(503, "Podcast search isn't connected yet.");
  const u = await monthUsage();
  if (u.remaining != null && u.remaining <= RESERVE) throw new HttpError(429, "Podcast search has used this month's lookups. Saved searches and profiles still open.");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  const q = qs.toString();
  const res = await fetch(`${BASE}${path}${q ? `?${q}` : ""}`, { headers: { "x-api-key": apiKey(), accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (usage && usage.remaining != null) usage.remaining -= 1;
  const text = await res.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (res.ok) return j;
  const code = String(j?.error?.code ?? j?.code ?? "");
  const msg = String(j?.error?.message ?? j?.message ?? text.slice(0, 200));
  console.warn("podchaser", res.status, path, code, msg.slice(0, 300));
  if (res.status === 401) throw new HttpError(503, "Podchaser didn't accept our API key.");
  if (res.status === 403) throw new HttpError(403, "That's not on our Podchaser plan.");
  if (res.status === 404) throw new HttpError(404, "That isn't in the podcast index any more.");
  if (res.status === 429) throw new HttpError(429, /quota|month/i.test(msg) ? "Podcast search has used this month's lookups." : "Podcast search is busy for a moment. Try again in a few seconds.");
  if (res.status === 400) throw new HttpError(400, "The podcast index couldn't read that search. Try other words.");
  throw new HttpError(502, `Couldn't reach the podcast index (${res.status}).`);
}
/** A part of a profile the plan may not include: missing, not fatal. */
async function maybe(path: string, params: Record<string, string | number> = {}): Promise<any> {
  try { return await get(path, params); } catch (err) { if (err instanceof HttpError && [400, 403, 404].includes(err.status)) return null; throw err; }
}

// ---------------------------------------------------------------------------
// Shapes: what the page shows
// ---------------------------------------------------------------------------

export type PodShow = {
  kind: "show"; id: string; title: string; about: string; image: string; web: string; site: string; rss: string;
  episodes: number | null; latest: string; since: string; categories: string[]; host: string;
  rating: number | null; ratings: number | null; language: string;
  audience: number | null; audienceRange: { from: number; to: number } | null; powerScore: number | null; hasGuests: boolean | null;
  socials: { platform: string; url: string }[]; apple: string; spotify: string; status: string; everyDays: number | null;
};
export type PodPerson = {
  kind: "person"; pcid: string; name: string; subtitle: string; bio: string; image: string; web: string; location: string;
  followers: number | null; appearances: number | null; socials: { platform: string; url: string }[];
};
type PodShowFull = PodShow & { contacts: { name: string; email: string; url: string; type: string }[]; email: string; people: { pcid: string; name: string; image: string; role: string; episodes: number | null }[]; locked: string[] };
type PodPersonFull = PodPerson & { shows: { id: string; title: string; image: string; web: string; role: string; episodes: number | null }[]; recent: { title: string; date: string; web: string; show: string; showId: string; image: string; role: string }[] };

const trim = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** "2026-05-14 08:00:00" (UTC, no zone) as an ISO time. */
const iso = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z") : ""; };
const socialsOf = (s: Record<string, unknown> | null | undefined) =>
  Object.entries(s ?? {}).filter(([, u]) => typeof u === "string" && /^https?:\/\//.test(u)).map(([platform, url]) => ({ platform, url: url as string }));
/** Lists come as `{ data: [...], pagination }`, single things as `{ data: {...} }`: read either. */
const list = (j: any): any[] => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : []);
const one = (j: any): any => (j && typeof j === "object" && !Array.isArray(j) && j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data : j);

function toShow(p: any, about = 220): PodShow {
  return {
    kind: "show", id: String(p.id), title: trim(p.title, 160), about: trim(p.description, about), image: p.imageUrl ?? "",
    web: p.id ? `https://www.podchaser.com/podcasts/${p.id}` : "", site: p.webUrl ?? "", rss: p.rssUrl ?? "",
    episodes: n(p.numberOfEpisodes), latest: iso(p.latestEpisodeDate), since: iso(p.startDate), categories: (p.categories ?? []).map((c: any) => c?.title).filter(Boolean).slice(0, 4),
    host: trim(p.author?.name, 120), rating: null, ratings: null, language: p.language ?? "",
    audience: null, audienceRange: null, powerScore: null, hasGuests: typeof p.hasGuests === "boolean" ? p.hasGuests : null,
    socials: [], apple: p.applePodcastsId ? `https://podcasts.apple.com/podcast/id${p.applePodcastsId}` : "", spotify: p.spotifyId ? `https://open.spotify.com/show/${p.spotifyId}` : "",
    status: String(p.status ?? ""), everyDays: n(p.episodeFrequency),
  };
}
function toPerson(c: any): PodPerson {
  return {
    kind: "person", pcid: String(c.pcid), name: trim(c.name, 120), subtitle: trim(c.subtitle, 160), bio: trim(c.bio, 600), image: c.imageUrl ?? "", web: c.url ?? "", location: trim(c.location, 80),
    followers: null, appearances: n(c.episodeAppearanceCount), socials: socialsOf(c.socialLinks),
  };
}

// ---------------------------------------------------------------------------
// The search words: theirs, kept to the military and veteran community
// ---------------------------------------------------------------------------

// Podchaser's plain search ranks by relevance across titles and descriptions; its boolean
// search matches far fewer (47 shows against 18,036 for the same words). So: plain words,
// with a branch, or "veteran" when they didn't say anything military themselves.
const BRANCH_WORDS: Record<string, string> = {
  Army: "army", Navy: "navy", "Air Force": "air force", "Marine Corps": "marine corps", "Coast Guard": "coast guard", "Space Force": "space force", "Military spouse": "military spouse",
};
export function searchTerm(q: string, branches: string[], community: boolean): string {
  const words = q.replace(/[()"*~:+|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const bs = branches.map((b) => BRANCH_WORDS[b]).filter(Boolean);
  const mentions = /\b(veteran|military|army|navy|marine|usmc|air force|coast guard|space force|milspouse|spouse|soldier|sailor|airman)\b/i.test(q);
  return [words, bs.join(" "), !mentions && community ? "veteran" : ""].filter(Boolean).join(" ").trim() || "veteran";
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function send(res: Response, fn: () => Promise<unknown>) {
  fn()
    .then((body) => res.json(body))
    .catch((err: any) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error("podcasts:", err);
      res.status(status).json({ message: err?.message ?? "Something went wrong." });
    });
}

const SHOW_SORTS: Record<string, string> = { best: "relevance", power: "power_score", newest: "date_of_first_episode" };
const PERSON_SORTS: Record<string, string> = { best: "relevance", appearances: "appearance_count", recent: "recent_episode" };
/** Starter leaves audience numbers out of search: the page hides what would always be empty. */
const LOCKED = ["audienceEstimate"];

/** A fresh request, counted against who caused it: a visitor by address, a member by email. */
async function spendOne(who: string, allowed: number, message: string): Promise<void> {
  const key = `pc:fresh:${who}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await readCache<number>(key, DAY)) ?? 0);
  if (used >= allowed) throw new HttpError(429, message);
  await writeCache(key, used + 1);
}

/**
 * `member(req)` is Discovery's own check (throws when they aren't one). A
 * visitor sees what's been searched before, and two new searches a day.
 */
export function registerPodcastRoutes(app: Express, member: (req: Request) => Promise<unknown>): void {
  const who = async (req: Request): Promise<{ visitor: boolean; id: string }> => {
    try {
      await member(req);
      return { visitor: false, id: ((getSessionEmail(req) ?? "") || (getAdminEmail(req) ?? "") || "admin").toLowerCase() };
    } catch {
      return { visitor: true, id: (String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "?").trim() };
    }
  };

  /** On, and working. Admins also see the month: used, left, when it resets. */
  app.get("/api/discover/podcasts/status", (req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "no-store");
      if (!podchaserOn()) return { on: false };
      try {
        const u = await monthUsage(true);
        return { on: true, ok: true, locked: LOCKED, ...(getAdminEmail(req) ? { month: { tier: u.tier, used: u.used, left: u.remaining, quota: u.quota, resets: u.cycleEnd } } : {}) };
      } catch (err) {
        return { on: true, ok: false, why: (err as Error).message };
      }
    }),
  );

  app.post("/api/discover/podcasts/search", (req, res) =>
    send(res, async () => {
      const w = await who(req);
      const page = Math.max(0, Math.min(20, Number(req.body?.page) || 0));
      if (w.visitor && page > 0) throw new HttpError(403, "Create a free account to see more.");
      const kind = req.body?.kind === "people" ? "people" : "shows";
      const q = String(req.body?.q ?? "").trim().slice(0, 200);
      const branches = String(req.body?.branch ?? "").split(",").map((b) => b.trim()).filter((b) => BRANCH_WORDS[b]).slice(0, 7);
      // A person is found by what they're known for: their own words, with "veteran" only when there are none.
      const term = searchTerm(q, branches, kind === "shows" ? req.body?.community !== false : !q);
      const sort = (kind === "shows" ? SHOW_SORTS : PERSON_SORTS)[String(req.body?.sort)] ?? "relevance";
      const guests = kind === "shows" && req.body?.hasGuests === true;
      const active = kind === "shows" && req.body?.active === true;
      const k = `pc2:search:${kind}:${JSON.stringify({ term, sort, page, guests, active })}`;
      // Shows, for a member: Listen Notes (3.8 million shows), fetched fresh each time as its terms
      // require, while the month's allowance lasts. Past it, or for visitors, Podchaser as before.
      const lnPages = process.env.LISTEN_PLAN === "pro" ? 30 : 3;
      if (kind === "shows" && !w.visitor && isListenNotesConfigured() && page < lnPages && (await spendListenNotes(w.id))) {
        const since = active ? Date.now() - 90 * DAY : undefined;
        const r = await lnSearchShows({ term, page, byDate: sort !== "relevance", activeSince: since });
        return { kind, term, page, pageSize: r.perPage, total: Math.min(r.total, lnPages * 10), results: r.results, preview: false, locked: LOCKED, source: "listennotes" };
      }

      let found = await readCache<{ total: number; perPage: number; results: (PodShow | PodPerson)[] }>(k, 7 * DAY);
      if (!found) {
        await spendOne(w.id, w.visitor ? VISITOR_FRESH : MEMBER_FRESH, w.visitor ? "Create a free account to keep searching podcasts." : "That's a lot of new podcast searches today. Try again tomorrow, or reopen one you've run.");
        const since = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
        const j = kind === "people"
          ? await get("/search/creators", { q: term, page: page + 1, sort, sort_direction: sort === "relevance" ? undefined : "desc" })
          : await get("/search/podcasts", { q: term, page: page + 1, sort, sort_direction: sort === "relevance" ? undefined : "desc", language: "en", has_guests: guests ? true : undefined, latest_episode_from: active ? since : undefined });
        const rows = list(j);
        const results = kind === "people" ? rows.map(toPerson) : rows.map((p) => toShow(p));
        found = { total: n(j?.pagination?.total_results) ?? rows.length, perPage: n(j?.pagination?.per_page) ?? (rows.length || 25), results };
        await writeCache(k, found);
        // Each one found is kept on its own too, so opening it asks for less.
        await Promise.all(rows.map((r) => writeCache(kind === "people" ? `pc2:person-base:${r.pcid}` : `pc2:show-base:${r.id}`, r))).catch(() => {});
      }
      return { kind, term, page, pageSize: found.perPage, total: found.total, results: found.results, preview: w.visitor, locked: LOCKED };
    }),
  );

  /** One show: who hosts it and who's been on, how to reach them, its socials. A month in the cache. */
  app.get("/api/discover/podcasts/show", (req, res) =>
    send(res, async () => {
      const w = await who(req);
      if (w.visitor) throw new HttpError(401, "Create a free account to open a show.");
      // A Listen Notes show: asked fresh (their terms), from the month's allowance.
      const lnId = /^ln:([A-Za-z0-9]{8,40})$/.exec(String(req.query.id ?? ""))?.[1];
      if (lnId) {
        if (!isListenNotesConfigured() || !(await spendListenNotes(w.id))) throw new HttpError(429, "That's all the show lookups for today. Try again tomorrow.");
        return lnShowFull(lnId);
      }
      const id = String(req.query.id ?? "").replace(/[^0-9]/g, "").slice(0, 20);
      if (!id) throw new HttpError(400, "Which show?");
      return cached(`pc2:show:${id}`, 30 * DAY, async () => {
        await spendOne(w.id, MEMBER_FRESH * 2, "That's a lot of new profiles today. Try again tomorrow.");
        const base = (await readCache<any>(`pc2:show-base:${id}`, 30 * DAY)) ?? one(await get(`/podcasts/${id}`));
        const [credits, contacts, socials, reach] = await Promise.all([
          maybe(`/podcasts/${id}/credits`),
          maybe(`/podcasts/${id}/contacts`),
          maybe(`/podcasts/${id}/socials`),
          maybe(`/podcasts/${id}/reach`),
        ]);
        const s = one(socials) ?? {};
        const r = one(reach) ?? {};
        const show = toShow(base, 1200);
        show.socials = socialsOf(s.socialLinks);
        show.powerScore = n(r.powerScore);
        const avg = r.avgEpisodeReach;
        show.audienceRange = avg?.from != null && avg?.to != null ? { from: Number(avg.from), to: Number(avg.to) } : null;
        show.audience = show.audienceRange ? Math.round((show.audienceRange.from + show.audienceRange.to) / 2) : null;
        const people = list(credits)
          .filter((c: any) => c?.creator?.pcid)
          .map((c: any) => ({ pcid: String(c.creator.pcid), name: trim(c.creator.name, 120), image: c.creator.imageUrl ?? "", role: c.role?.title ?? "", episodes: n(c.episodeCount) }));
        return {
          ...show,
          email: String(base?.author?.email ?? "").trim(),
          contacts: list(contacts)
            .map((c: any) => ({ name: trim(c.fullName, 120), email: String(c.email || c.rssEmail || ""), url: String(c.url ?? ""), type: [c.role, c.type].filter(Boolean).join(" · ") }))
            .filter((c: any) => c.email || c.url),
          people,
          locked: [...(credits ? [] : ["credits"]), ...(contacts ? [] : ["contacts"])],
        } satisfies PodShowFull;
      });
    }),
  );

  /** One person: the shows they host or guest on, the latest episodes they're in. */
  app.get("/api/discover/podcasts/person", (req, res) =>
    send(res, async () => {
      const w = await who(req);
      if (w.visitor) throw new HttpError(401, "Create a free account to open a profile.");
      const pcid = String(req.query.pcid ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 30);
      if (!pcid) throw new HttpError(400, "Who?");
      return cached(`pc2:person:${pcid}`, 30 * DAY, async () => {
        await spendOne(w.id, MEMBER_FRESH * 2, "That's a lot of new profiles today. Try again tomorrow.");
        const base = (await readCache<any>(`pc2:person-base:${pcid}`, 30 * DAY)) ?? one(await get(`/creators/${pcid}`));
        const [shows, episodes] = await Promise.all([maybe(`/creators/${pcid}/podcasts`), maybe(`/creators/${pcid}/episodes`, { per_page: 12 })]);
        return {
          ...toPerson(base),
          shows: list(shows)
            .filter((x: any) => x?.podcast?.id)
            .map((x: any) => ({ id: String(x.podcast.id), title: trim(x.podcast.title, 160), image: x.podcast.imageUrl ?? "", web: "", role: x.role?.title ?? "", episodes: n(x.episodeCount) })),
          recent: list(episodes)
            .filter((x: any) => x?.episode?.title)
            .slice(0, 12)
            .map((x: any) => ({ title: trim(x.episode.title, 160), date: iso(x.episode.airDate), web: "", show: trim(x.podcast?.title, 120), showId: String(x.podcast?.id ?? ""), image: x.podcast?.imageUrl ?? "", role: x.role?.title ?? "" })),
        } satisfies PodPersonFull;
      });
    }),
  );
}
