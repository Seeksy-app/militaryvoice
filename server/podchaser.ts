// Podcasts in Discovery: shows, and the people who host them or have been on
// them, from Podchaser's index.
//
// Podchaser charges in points per answer (a page of ten shows is about a
// hundred), so like the creator index every answer is cached and shared: a
// search page for a week, a show or a person for a month. Some fields are only
// on some plans (audience, contacts, credits, Power Score); a field the plan
// won't give is learned from the first refusal, remembered, and left out of
// every query after, so a search never fails over one column.
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";
import { getAdminEmail } from "./session.js";

const API = "https://api.podchaser.com/graphql";
const DAY = 86_400_000;
const PAGE = 10;

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
// The API: a year-long token, points, and the fields this plan can't see
// ---------------------------------------------------------------------------

export const podchaserOn = () => Boolean(process.env.PODCHASER_CLIENT_ID?.trim() && process.env.PODCHASER_CLIENT_SECRET?.trim());

let token: { value: string; exp: number } | null = null;
async function accessToken(fresh = false): Promise<string> {
  if (!podchaserOn()) throw new HttpError(503, "Podcast search isn't connected yet.");
  if (!fresh && token && token.exp > Date.now()) return token.value;
  if (!fresh) {
    const kept = await readCache<{ value: string; exp: number }>("podchaser:token", 360 * DAY);
    if (kept && kept.exp > Date.now()) return (token = kept).value;
  }
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      query: "mutation Token($id: String!, $secret: String!) { requestAccessToken(input: { grant_type: CLIENT_CREDENTIALS, client_id: $id, client_secret: $secret }) { access_token expires_in } }",
      variables: { id: process.env.PODCHASER_CLIENT_ID!.trim(), secret: process.env.PODCHASER_CLIENT_SECRET!.trim() },
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { requestAccessToken?: { access_token?: string; expires_in?: number } }; errors?: { message: string }[] };
  const t = j.data?.requestAccessToken;
  if (!t?.access_token) {
    console.error("podchaser token:", res.status, JSON.stringify(j.errors ?? j).slice(0, 300));
    throw new HttpError(503, "Podcast search couldn't sign in to Podchaser.");
  }
  // A day short of what they give, so it's never used on its last day.
  token = { value: t.access_token, exp: Date.now() + Math.max(DAY, ((t.expires_in ?? 31_536_000) - 86_400) * 1000) };
  await writeCache("podchaser:token", token);
  return token.value;
}

let points: number | null = null;
let denied: Set<string> | null = null;
async function deniedFields(): Promise<Set<string>> {
  if (!denied) denied = new Set(await readCache<string[]>("podchaser:denied", 30 * DAY) ?? []);
  return denied;
}

type Gql = { data?: any; errors?: { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> }[] };
async function post(query: string, variables: Record<string, unknown>): Promise<Gql> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken(attempt > 0)}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ query, variables }),
    });
    const left = Number(res.headers.get("x-podchaser-points-remaining"));
    if (Number.isFinite(left) && res.headers.get("x-podchaser-points-remaining") !== null) points = left;
    if (res.status === 401 && attempt === 0) { token = null; continue; }
    if (res.status === 429) throw new HttpError(429, "Podcast search is busy for a moment. Try again in a few seconds.");
    const j = (await res.json().catch(() => ({}))) as Gql;
    // A token they no longer take comes back as a 200 with this: sign in again, once.
    if (attempt === 0 && (j.errors ?? []).some((e) => /invalid authorization|unauthenticated/i.test(e.message))) { token = null; continue; }
    if (!res.ok && !j.data) {
      console.error("podchaser:", res.status, JSON.stringify(j).slice(0, 400));
      if (/points|quota|limit/i.test(JSON.stringify(j.errors ?? ""))) throw new HttpError(402, "Podcast search is out of searches for this month.");
      throw new HttpError(502, `Couldn't reach the podcast index (${res.status}).`);
    }
    return j;
  }
  throw new HttpError(502, "Couldn't sign in to the podcast index.");
}

/**
 * A query with some fields the plan may not allow. `build(allowed)` writes the
 * query from the optional fields still allowed; a refusal naming one drops it
 * and asks again (and it stays dropped).
 */
async function ask(build: (allowed: (name: string) => boolean) => string, variables: Record<string, unknown>, optional: string[]): Promise<any> {
  const no = await deniedFields();
  for (let round = 0; round < 4; round++) {
    const j = await post(build((n) => !no.has(n)), variables);
    const errs = j.errors ?? [];
    if (!errs.length) return j.data;
    // Which optional field did it refuse? By its path, or by name in the message.
    const refused = new Set<string>();
    for (const e of errs) {
      const where = [...(e.path ?? []).map(String), e.message];
      for (const f of optional) if (!no.has(f) && where.some((w) => w === f || new RegExp(`\\b${f}\\b`).test(w))) refused.add(f);
    }
    const permission = errs.some((e) => /permission|not authori[sz]ed|unauthori[sz]ed|access|plan/i.test(e.message));
    if (!refused.size && permission) for (const f of optional) if (!no.has(f)) refused.add(f);
    if (!refused.size) {
      // Partial answers are still answers.
      if (j.data && Object.values(j.data).some((v) => v)) return j.data;
      console.error("podchaser query:", JSON.stringify(errs).slice(0, 500));
      if (/points|quota/i.test(JSON.stringify(errs))) throw new HttpError(402, "Podcast search is out of searches for this month.");
      throw new HttpError(502, "The podcast index couldn't answer that one. Try other words.");
    }
    refused.forEach((f) => no.add(f));
    console.warn("podchaser: plan leaves out", Array.from(refused).join(", "));
    await writeCache("podchaser:denied", Array.from(no));
  }
  throw new HttpError(502, "The podcast index couldn't answer that one.");
}

// ---------------------------------------------------------------------------
// Shapes: what the page shows
// ---------------------------------------------------------------------------

export type PodShow = {
  kind: "show"; id: string; title: string; about: string; image: string; web: string; site: string; rss: string;
  episodes: number | null; latest: string; since: string; categories: string[]; host: string;
  rating: number | null; ratings: number | null; language: string;
  audience: number | null; audienceRange: { from: number; to: number } | null; powerScore: number | null; hasGuests: boolean | null;
  socials: { platform: string; url: string }[]; apple: string; spotify: string;
};
export type PodPerson = {
  kind: "person"; pcid: string; name: string; subtitle: string; bio: string; image: string; web: string; location: string;
  followers: number | null; appearances: number | null; socials: { platform: string; url: string }[];
};
export type PodCredit = { id: string; title: string; image: string; web: string; role: string; episodes: number | null };
export type PodShowFull = PodShow & { contacts: { name: string; email: string; url: string; type: string }[]; email: string; people: (Pick<PodPerson, "pcid" | "name" | "image"> & { role: string; episodes: number | null })[]; locked: string[] };
export type PodPersonFull = PodPerson & { shows: PodCredit[]; recent: { title: string; date: string; web: string; show: string; showId: string; image: string; role: string }[] };

const trim = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const socialsOf = (s: Record<string, string | null> | null | undefined) =>
  Object.entries(s ?? {}).filter(([, u]) => typeof u === "string" && /^https?:\/\//.test(u)).map(([platform, url]) => ({ platform, url: url as string }));

function toShow(p: any, about = 220): PodShow {
  return {
    kind: "show", id: String(p.id), title: trim(p.title, 160), about: trim(p.description, about), image: p.imageUrl ?? "", web: p.webUrl ?? "", site: p.url ?? "", rss: p.rssUrl ?? "",
    episodes: n(p.numberOfEpisodes), latest: p.latestEpisodeDate ?? "", since: p.startDate ?? "", categories: (p.categories ?? []).map((c: any) => c?.title).filter(Boolean).slice(0, 4),
    host: trim(p.author?.name, 120), rating: n(p.ratingAverage), ratings: n(p.ratingCount), language: p.language ?? "",
    audience: n(p.audienceEstimate), audienceRange: p.audienceEstimateRange?.from != null ? { from: Number(p.audienceEstimateRange.from), to: Number(p.audienceEstimateRange.to) } : null,
    powerScore: n(p.powerScore), hasGuests: typeof p.hasGuests === "boolean" ? p.hasGuests : null,
    socials: socialsOf(p.socialLinks), apple: p.applePodcastsId ? `https://podcasts.apple.com/podcast/id${p.applePodcastsId}` : "", spotify: p.spotifyId ? `https://open.spotify.com/show/${p.spotifyId}` : "",
  };
}
function toPerson(c: any): PodPerson {
  return {
    kind: "person", pcid: String(c.pcid), name: trim(c.name, 120), subtitle: trim(c.subtitle, 160), bio: trim(c.bio, 600), image: c.imageUrl ?? "", web: c.url ?? "", location: trim(c.location, 80),
    followers: n(c.followerCount), appearances: n(c.episodeAppearanceCount), socials: socialsOf(c.socialLinks),
  };
}

const SHOW_FIELDS = "id title description imageUrl webUrl url rssUrl numberOfEpisodes latestEpisodeDate startDate language ratingAverage ratingCount categories { title } author { name } socialLinks { twitter facebook instagram youtube linkedin tiktok patreon twitch } applePodcastsId spotifyId";
const SHOW_OPTIONAL = ["powerScore", "audienceEstimate", "hasGuests"];
const PERSON_FIELDS = "pcid name subtitle bio imageUrl url location followerCount episodeAppearanceCount socialLinks { twitter wikipedia }";

// ---------------------------------------------------------------------------
// The search words: theirs, kept to the military and veteran community
// ---------------------------------------------------------------------------

const COMMUNITY = "(veteran | veterans | military | army | navy | marine | marines | \"air force\" | \"coast guard\" | \"space force\" | milspouse | \"military spouse\")";
const BRANCH_WORDS: Record<string, string> = {
  Army: "army", Navy: "navy", "Air Force": "\"air force\"", "Marine Corps": "(marine | marines | usmc)", "Coast Guard": "\"coast guard\"", "Space Force": "\"space force\"", "Military spouse": "(\"military spouse\" | milspouse)",
};
/** Their words as a boolean search: every word, plus a branch (any of them) or the community. */
export function searchTerm(q: string, branches: string[], community: boolean): string {
  const words = q.replace(/[+|\-()"*~]/g, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 1).slice(0, 8);
  const parts = words.length ? [words.join(" + ")] : [];
  const bs = branches.map((b) => BRANCH_WORDS[b]).filter(Boolean);
  const mentions = /\b(veteran|military|army|navy|marine|usmc|air force|coast guard|space force|milspouse|spouse)\b/i.test(q);
  if (bs.length) parts.push(bs.length > 1 ? `(${bs.join(" | ")})` : bs[0]);
  else if (community && !mentions) parts.push(COMMUNITY);
  return parts.join(" + ") || COMMUNITY;
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

const SHOW_SORTS: Record<string, string> = { best: "RELEVANCE", audience: "AUDIENCE_ESTIMATE", power: "POWER_SCORE", recent: "LATEST_EPISODE", episodes: "EPISODE_COUNT" };
const PERSON_SORTS: Record<string, string> = { best: "RELEVANCE", appearances: "APPEARANCE_COUNT", followers: "FOLLOWER_COUNT", recent: "RECENT_EPISODE" };

/**
 * `member(req)` is Discovery's own check (throws when they aren't one): a
 * visitor gets the first page and five fresh searches a day, as with creators.
 */
export function registerPodcastRoutes(app: Express, member: (req: Request) => Promise<unknown>): void {
  /** On, and what this plan can see. Admins also get the points left this month. */
  app.get("/api/discover/podcasts/status", (req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "no-store");
      if (!podchaserOn()) return { on: false };
      await accessToken();
      const no = await deniedFields();
      return { on: true, ok: true, locked: Array.from(no), ...(getAdminEmail(req) ? { points } : {}) };
    }),
  );

  app.post("/api/discover/podcasts/search", (req, res) =>
    send(res, async () => {
      let preview = false;
      try { await member(req); } catch { preview = true; }
      const page = Math.max(0, Math.min(20, Number(req.body?.page) || 0));
      if (preview && page > 0) throw new HttpError(403, "Create a free account to see more.");
      const kind = req.body?.kind === "people" ? "people" : "shows";
      const q = String(req.body?.q ?? "").trim().slice(0, 200);
      const branches = String(req.body?.branch ?? "").split(",").map((b) => b.trim()).filter((b) => BRANCH_WORDS[b]).slice(0, 7);
      const community = req.body?.community !== false;
      const term = searchTerm(q, branches, community);
      const sorts = kind === "shows" ? SHOW_SORTS : PERSON_SORTS;
      // Sorting by a number this plan can't see would be a sort by nothing: best match instead.
      const asked = sorts[String(req.body?.sort)] ?? "RELEVANCE";
      const needs = asked === "AUDIENCE_ESTIMATE" ? "audienceEstimate" : asked === "POWER_SCORE" ? "powerScore" : "";
      const sort = needs && (await deniedFields()).has(needs) ? "RELEVANCE" : asked;
      const guests = kind === "shows" && req.body?.hasGuests === true;
      const minAudience = kind === "shows" ? n(req.body?.minAudience) : null;
      const k = `pc:search:${kind}:${JSON.stringify({ term, sort, page, guests, minAudience })}`;

      if (preview && !(await readCache(k, 7 * DAY))) {
        const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "?").trim();
        const key = `pc:preview:${ip}:${new Date().toISOString().slice(0, 10)}`;
        const used = Number((await readCache<number>(key, DAY)) ?? 0);
        if (used >= 5) throw new HttpError(403, "Create a free account to keep searching.");
        await writeCache(key, used + 1);
      }

      const found = await cached(k, 7 * DAY, async () => {
        if (kind === "people") {
          const d = await ask(
            () => `query People($term: String, $page: Int, $sort: CreatorSortType!) { creators(searchTerm: $term, first: ${PAGE}, page: $page, sort: { sortBy: $sort, direction: DESCENDING }) { paginatorInfo { total } data { ${PERSON_FIELDS} } } }`,
            // People search is plain words, and a person is found by what they're known for:
            // their words and a branch, never the whole community list.
            { term: [q.replace(/[+|\-()"*~]/g, " "), ...branches.map((b) => BRANCH_WORDS[b].replace(/[()"|]/g, " ").trim().split(/\s+/)[0])].join(" ").replace(/\s+/g, " ").trim() || "veteran", page: page + 1, sort },
            [],
          );
          return { total: n(d?.creators?.paginatorInfo?.total) ?? 0, results: (d?.creators?.data ?? []).map(toPerson) as (PodShow | PodPerson)[] };
        }
        const d = await ask(
          (allowed) => {
            const opt = SHOW_OPTIONAL.filter(allowed).join(" ");
            const filters = [guests && allowed("hasGuests") ? "hasGuests: true" : "", minAudience != null && allowed("audienceEstimate") ? `audienceEstimate: { from: ${Math.round(minAudience)} }` : "", "language: \"en\""].filter(Boolean).join(", ");
            return `query Shows($term: String, $page: Int, $sort: PodcastSortType!) { podcasts(searchTerm: $term, options: { boolSearch: true }, filters: { ${filters} }, first: ${PAGE}, page: $page, sort: { sortBy: $sort, direction: DESCENDING }) { paginatorInfo { total } data { ${SHOW_FIELDS} ${opt} } } }`;
          },
          { term, page: page + 1, sort },
          SHOW_OPTIONAL,
        );
        return { total: n(d?.podcasts?.paginatorInfo?.total) ?? 0, results: (d?.podcasts?.data ?? []).map((p: any) => toShow(p)) as (PodShow | PodPerson)[] };
      });
      const locked = Array.from(await deniedFields());
      return { kind, term, page, pageSize: PAGE, total: found.total, results: found.results, preview, locked };
    }),
  );

  /** One show: all we can see, hosts and guests, and how to reach them. A month in the cache. */
  app.get("/api/discover/podcasts/show", (req, res) =>
    send(res, async () => {
      await member(req);
      const id = String(req.query.id ?? "").replace(/[^0-9]/g, "").slice(0, 20);
      if (!id) throw new HttpError(400, "Which show?");
      return cached(`pc:show:${id}`, 30 * DAY, async () => {
        const optional = [...SHOW_OPTIONAL, "audienceEstimateRange", "contacts", "credits", "authorContact"];
        const d = await ask(
          (allowed) => `query Show($id: String!) { podcast(identifier: { id: $id, type: PODCHASER }) { ${SHOW_FIELDS} ${SHOW_OPTIONAL.filter(allowed).join(" ")}
            ${allowed("audienceEstimateRange") ? "audienceEstimateRange { from to }" : ""}
            ${allowed("authorContact") ? "authorContact: author { email }" : ""}
            ${allowed("contacts") ? "contacts { email url fullName type }" : ""}
            ${allowed("credits") ? "credits(first: 20) { data { creator { pcid name imageUrl } role { code title } episodeCount } }" : ""} } }`,
          { id },
          optional,
        );
        const p = d?.podcast;
        if (!p) throw new HttpError(404, "That show isn't in the index any more.");
        const no = await deniedFields();
        const people = (p.credits?.data ?? [])
          .filter((c: any) => c?.creator?.pcid)
          .map((c: any) => ({ pcid: String(c.creator.pcid), name: trim(c.creator.name, 120), image: c.creator.imageUrl ?? "", role: c.role?.title ?? "", episodes: n(c.episodeCount) }));
        return {
          ...toShow(p, 1200),
          email: String(p.authorContact?.email ?? "").trim(),
          contacts: (p.contacts ?? []).map((c: any) => ({ name: trim(c.fullName, 120), email: String(c.email ?? ""), url: String(c.url ?? ""), type: String(c.type ?? "") })).filter((c: any) => c.email || c.url),
          people,
          locked: optional.filter((f) => no.has(f)),
        } satisfies PodShowFull;
      });
    }),
  );

  /** One person: the shows they host, the episodes they've been a guest on. */
  app.get("/api/discover/podcasts/person", (req, res) =>
    send(res, async () => {
      await member(req);
      const pcid = String(req.query.pcid ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 30);
      if (!pcid) throw new HttpError(400, "Who?");
      return cached(`pc:person:${pcid}`, 30 * DAY, async () => {
        const d = await ask(
          (allowed) => `query Person($id: String!) { creator(identifier: { id: $id, type: PCID }) { ${PERSON_FIELDS}
            ${allowed("creatorCredits") ? "credits(first: 20) { data { podcast { id title imageUrl webUrl } role { code title } episodeCount } }" : ""}
            ${allowed("episodeCredits") ? "episodeCredits(first: 12) { data { episode { title airDate webUrl podcast { id title imageUrl } } role { code title } } }" : ""} } }`,
          { id: pcid },
          ["creatorCredits", "episodeCredits"],
        );
        const c = d?.creator;
        if (!c) throw new HttpError(404, "That person isn't in the index any more.");
        const shows: PodCredit[] = (c.credits?.data ?? [])
          .filter((x: any) => x?.podcast?.id)
          .map((x: any) => ({ id: String(x.podcast.id), title: trim(x.podcast.title, 160), image: x.podcast.imageUrl ?? "", web: x.podcast.webUrl ?? "", role: x.role?.title ?? "", episodes: n(x.episodeCount) }));
        const recent = (c.episodeCredits?.data ?? [])
          .filter((x: any) => x?.episode?.title)
          .map((x: any) => ({ title: trim(x.episode.title, 160), date: x.episode.airDate ?? "", web: x.episode.webUrl ?? "", show: trim(x.episode.podcast?.title, 120), showId: String(x.episode.podcast?.id ?? ""), image: x.episode.podcast?.imageUrl ?? "", role: x.role?.title ?? "" }));
        return { ...toPerson(c), shows, recent } satisfies PodPersonFull;
      });
    }),
  );
}
