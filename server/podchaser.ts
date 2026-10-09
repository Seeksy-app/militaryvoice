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
import { isListenNotesConfigured, spendListenNotes, lnSearchShows, lnShowFull, lnSearchEpisodes, type LnEpisode } from "./listenNotes.js";
import { guestsIn, lnPersonId, lnPersonName, sameGuest, type Guest } from "./lnGuests.js";
import { podscanOn, podscanPeople, podscanPerson, podscanShow, PodscanError } from "./podscan.js";
import { logSearch } from "./discovery.js";

const BASE = "https://developers.podchaser.com/api/rest/v1";
const DAY = 86_400_000;
/** Requests kept back each month, so the last days of it still answer. */
const RESERVE = 40;
/** Fresh searches a visitor (no account) may cause a day, and a member. */
const VISITOR_FRESH = 2;
const MEMBER_FRESH = 40;

/**
 * Who gets Listen Notes for show search: every member ("*", the default since 30 Sep 2026,
 * while Podchaser's key is refused), or LISTEN_TESTERS as comma-separated emails.
 */
const listenNotesTester = (email: string) => {
  const list = (process.env.LISTEN_TESTERS || "*").toLowerCase().split(",").map((e) => e.trim()).filter(Boolean);
  return list.includes("*") || list.includes(email.trim().toLowerCase());
};

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
/** Hosts & guests opens to everyone on Oct 5 (midnight Eastern); admins can use it before. */
const PEOPLE_OPENS = Date.parse("2026-10-05T04:00:00Z");
const peopleOpen = (req: Request) => Boolean(getAdminEmail(req)) || Date.now() >= PEOPLE_OPENS;

/** Podchaser answering right now (its key has been refused since 30 Sep): people come from Listen Notes when it isn't. */
const podchaserWorks = () => (podchaserOn() ? monthUsage().then(() => true, () => false) : Promise.resolve(false));
/** A guest read off Listen Notes episodes, as a person card. */
function lnPersonCard(g: Guest, eps: LnEpisode[]): PodPerson {
  const on = g.episodes.map((i) => eps[i]).filter(Boolean);
  const shows = Array.from(new Set(on.map((e) => e.show.title).filter(Boolean)));
  return {
    kind: "person", pcid: lnPersonId(g.name, g.about), name: g.name,
    subtitle: g.about || (shows[0] ? `Guest on ${shows[0]}` : "Podcast guest"),
    bio: on.length ? `Guest on ${shows.slice(0, 3).join(", ")}${shows.length > 3 ? " and more" : ""}. ${on.map((e) => `"${e.title}"`).slice(0, 2).join(" · ")}` : "",
    image: "", web: "", location: "", followers: null, appearances: on.length, socials: [],
  };
}

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
      // Hosts & guests runs on Listen Notes whenever Podchaser can't answer.
      const lnPeople = (isListenNotesConfigured() || podscanOn()) && peopleOpen(req);
      if (!podchaserOn()) return isListenNotesConfigured() || podscanOn() ? { on: true, ok: true, people: lnPeople, locked: LOCKED, source: podscanOn() ? "podscan" : "listennotes" } : { on: false };
      try {
        const u = await monthUsage(true);
        return { on: true, ok: true, people: peopleOpen(req), locked: LOCKED, ...(getAdminEmail(req) ? { month: { tier: u.tier, used: u.used, left: u.remaining, quota: u.quota, resets: u.cycleEnd } } : {}) };
      } catch (err) {
        return { on: true, ok: false, why: (err as Error).message, people: lnPeople, locked: LOCKED };
      }
    }),
  );

  app.post("/api/discover/podcasts/search", (req, res) =>
    send(res, async () => {
      // Every first-page search is logged for Admin → Discovery (9 Oct).
      const out = await (async () => {
      const w = await who(req);
      const page = Math.max(0, Math.min(20, Number(req.body?.page) || 0));
      if (w.visitor && page > 0) throw new HttpError(403, "Create a free account to see more.");
      const kind = req.body?.kind === "people" ? "people" : "shows";
      if (kind === "people" && !peopleOpen(req)) throw new HttpError(403, "Hosts & guests opens Oct 5.");
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
      if (kind === "shows" && !w.visitor && listenNotesTester(w.id) && isListenNotesConfigured() && page < lnPages && (await spendListenNotes(w.id))) {
        const since = active ? Date.now() - 90 * DAY : undefined;
        const r = await lnSearchShows({ term, page, byDate: sort !== "relevance", activeSince: since });
        return { kind, term, page, pageSize: r.perPage, total: Math.min(r.total, lnPages * 10), results: r.results, preview: false, locked: LOCKED, source: "listennotes" };
      }

      // Hosts & guests, for a member: Podscan first (real host and guest records from transcripts).
      if (kind === "people" && !w.visitor && podscanOn()) {
        try {
          const r = await podscanPeople({ q: q || term, page, sort, who: w.id });
          if (r.results.length || page > 0) return { kind, term, page, pageSize: r.perPage, total: r.total, results: r.results, preview: false, locked: LOCKED, source: "podscan" };
        } catch (err) {
          // Out of today's allowance says so; anything else falls through to the next source.
          if (err instanceof PodscanError && err.status === 429 && /today/.test(err.message)) throw new HttpError(429, err.message);
          console.warn("Podscan people failed, falling back:", (err as Error).message);
        }
      }
      // Hosts & guests, for a member, while Podchaser can't answer: guests read off Listen Notes episodes.
      if (kind === "people" && !w.visitor && listenNotesTester(w.id) && isListenNotesConfigured() && !(await podchaserWorks())) {
        if (page >= lnPages) return { kind, term, page, pageSize: 10, total: 0, results: [], preview: false, locked: LOCKED, source: "listennotes" };
        const words = q || term;
        let at = page, guests: Guest[] = [], eps: LnEpisode[] = [], more = false;
        // A page of episodes with no named guests in it (a topic's solo shows): one more, on the first page only.
        for (let tries = 0; tries < (page === 0 ? 2 : 1) && guests.length < 2; tries++, at++) {
          if (!(await spendListenNotes(w.id))) { if (tries) break; throw new HttpError(429, "That's all the guest searches for today. Try again tomorrow."); }
          const r = await lnSearchEpisodes({ term: words, page: at, byDate: sort === "recent_episode" });
          const found = await guestsIn(r.episodes, words);
          const offset = eps.length;
          eps = [...eps, ...r.episodes];
          guests = [...guests, ...found.map((g) => ({ ...g, episodes: g.episodes.map((i) => i + offset) }))];
          more = r.total > (at + 1) * 10 && at + 1 < lnPages;
          if (!r.episodes.length) break;
        }
        const byName = new Map<string, Guest>();
        for (const g of guests) { const had = byName.get(g.name.toLowerCase()); if (had) had.episodes.push(...g.episodes); else byName.set(g.name.toLowerCase(), { ...g }); }
        const results = Array.from(byName.values()).sort((a, b) => b.episodes.length - a.episodes.length).map((g) => lnPersonCard(g, eps));
        // Paging follows the episodes, not the people; "Best matches" rather than a count that means nothing.
        return { kind, term, page: at - 1, pageSize: 10, total: more ? 99_999 : 0, results, preview: false, locked: LOCKED, source: "listennotes" };
      }

      let found = await readCache<{ total: number; perPage: number; results: (PodShow | PodPerson)[] }>(k, 7 * DAY);
      if (!found) {
        // With Podchaser refusing us, say something a person can act on rather than its error.
        if (kind === "shows" && !(await monthUsage().then(() => true, () => false))) {
          if (w.visitor) throw new HttpError(401, "Create a free account to search podcasts.");
          throw new HttpError(429, "That's all the podcast searches for today. Try again tomorrow, or reopen one you've run.");
        }
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
      })();
      if (!out.page) void logSearch(req, out.kind === "people" ? "people" : "shows", out.source ?? "", String(req.body?.q ?? "").trim(), "podcasts", Math.max(out.total || 0, out.results?.length || 0));
      return out;
    }),
  );

  /** One show: who hosts it and who's been on, how to reach them, its socials. A month in the cache. */
  app.get("/api/discover/podcasts/show", (req, res) =>
    send(res, async () => {
      const w = await who(req);
      if (w.visitor) throw new HttpError(401, "Create a free account to open a show.");
      // A Podscan show (opened from a Podscan person).
      const psShow = /^ps:([A-Za-z0-9_-]{3,40})$/.exec(String(req.query.id ?? ""))?.[1];
      if (psShow) {
        if (!podscanOn()) throw new HttpError(503, "That show isn't available right now.");
        try { return await podscanShow(psShow, w.id); } catch (err) { if (err instanceof PodscanError) throw new HttpError(err.status, err.message); throw err; }
      }
      // A Listen Notes show: asked fresh (their terms), from the month's allowance.
      const lnId = /^ln:([A-Za-z0-9]{8,40})$/.exec(String(req.query.id ?? ""))?.[1];
      if (lnId) {
        if (!listenNotesTester(w.id)) throw new HttpError(403, "That show isn't open to you yet.");
        if (!isListenNotesConfigured() || !(await spendListenNotes(w.id))) throw new HttpError(429, "That's all the show lookups for today. Try again tomorrow.");
        const { episodesFull, ...show } = await lnShowFull(lnId);
        // Who's been on, read off its latest episodes (no extra Listen Notes request).
        const people = (await guestsIn(episodesFull)).filter((g) => !show.host.toLowerCase().includes(g.name.toLowerCase()))
          .map((g) => ({ pcid: lnPersonId(g.name, g.about), name: g.name, image: "", role: g.about || "Guest", episodes: g.episodes.length }));
        return { ...show, people };
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
      if (!peopleOpen(req)) throw new HttpError(403, "Hosts & guests opens Oct 5.");
      // Someone found on Podscan: their shows and appearances.
      const psId = /^ps:([A-Za-z0-9_-]{3,60})$/.exec(String(req.query.pcid ?? ""))?.[1];
      if (psId) {
        if (!podscanOn()) throw new HttpError(503, "That profile isn't available right now.");
        try { return await podscanPerson(psId, w.id); } catch (err) { if (err instanceof PodscanError) throw new HttpError(err.status, err.message); throw err; }
      }
      // Someone found on Listen Notes: the episodes with their name in, newest first.
      const ln = lnPersonName(String(req.query.pcid ?? ""));
      if (ln) {
        const lnName = ln.name;
        if (!isListenNotesConfigured() || !(await spendListenNotes(w.id))) throw new HttpError(429, "That's all the profile lookups for today. Try again tomorrow.");
        const r = await lnSearchEpisodes({ term: `"${lnName}"`, page: 0, byDate: true });
        const named = r.episodes.filter((e) => `${e.title} ${e.about} ${e.show.host}`.toLowerCase().includes(lnName.toLowerCase()));
        // Two people can share a name: keep the episodes that are this one.
        const keep = new Set(await sameGuest(lnName, ln.about, named));
        const eps = named.filter((_, i) => keep.has(i));
        const role = (e: LnEpisode) => (e.show.host.toLowerCase().includes(lnName.toLowerCase()) ? "Host" : "Guest");
        const shows = new Map<string, { id: string; title: string; image: string; web: string; role: string; episodes: number }>();
        for (const e of eps) {
          if (!e.show.id) continue;
          const had = shows.get(e.show.id);
          if (had) had.episodes++;
          else shows.set(e.show.id, { id: e.show.id, title: e.show.title, image: e.show.image, web: "", role: role(e), episodes: 1 });
        }
        return {
          kind: "person", pcid: String(req.query.pcid), name: lnName,
          appearances: eps.length < named.length ? eps.length : Math.max(eps.length, Math.min(r.total, 999)),
          shows: Array.from(shows.values()).sort((a, b) => b.episodes - a.episodes),
          recent: eps.map((e) => ({ title: e.title, date: e.date, web: e.web, show: e.show.title, showId: e.show.id, image: e.show.image, role: role(e) })),
          source: "listennotes",
        };
      }
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
