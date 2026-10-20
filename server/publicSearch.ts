// Podcast search for visitors (7 Oct 2026): the /podcasts landing page. A wall
// of real military and veteran podcast covers, and one free search — guests
// (Podscan) or podcasts (Apple's directory) — before signing up. Members search
// as much as they like (the full thing is Discovery).
import type { Express, Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";
import { getAdminEmail, getSessionEmail } from "./session.js";
import { findShows } from "./showFinder.js";
import { podscanOn, podscanPeople } from "./podscan.js";

const DAY = 86_400_000;
const COOKIE = "mv_free_search";
/** Visitor searches a day, everyone together: a ceiling on what strangers can spend. */
const PUBLIC_DAILY = 60;

async function read(k: string): Promise<{ payload: string; createdAt: string } | null> {
  const [r] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, k));
  return r ?? null;
}
async function write(k: string, payload: string): Promise<void> {
  const createdAt = new Date().toISOString();
  await db.insert(discoveryCache).values({ key: k, payload, createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
}
const ipOf = (req: Request) => (String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "?").trim();
/** An address that searched in the last 30 days (shared office addresses get another go after that). */
const ipUsed = async (ip: string) => { const r = await read(`public:ip:${ip}`); return Boolean(r && Date.now() - Date.parse(r.createdAt) < 30 * DAY); };
const usedCookie = (req: Request) => /(?:^|;\s*)mv_free_search=1/.test(String(req.headers.cookie ?? ""));

/** Covers for the collage: Apple's directory, a day at a time. */
const WALL_TERMS = ["military", "veteran", "army", "navy", "marine corps", "air force", "special forces", "military spouse", "military history", "combat veteran"];
async function wall(): Promise<{ title: string; image: string }[]> {
  const k = "public:wall:v1";
  const hit = await read(k);
  if (hit && Date.now() - Date.parse(hit.createdAt) < DAY) return JSON.parse(hit.payload);
  const seen = new Set<string>();
  const out: { title: string; image: string }[] = [];
  const lists = await Promise.all(WALL_TERMS.map(async (term) => {
    try {
      const r = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ media: "podcast", entity: "podcast", limit: "25", term, country: "US" })}`, { signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as { results?: Record<string, unknown>[] };
      return j.results ?? [];
    } catch { return []; }
  }));
  // Interleave the searches so the wall mixes branches rather than running in blocks.
  for (let i = 0; i < 25; i++) for (const l of lists) {
    const r = l[i];
    const image = String(r?.artworkUrl600 ?? "");
    const title = String(r?.collectionName ?? "");
    if (!image || !title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ title, image });
  }
  if (out.length) await write(k, JSON.stringify(out.slice(0, 120)));
  return out.slice(0, 120);
}

export function registerPublicSearch(app: Express) {
  app.get("/api/public/podcast-wall", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=21600");
    res.json(await wall().catch(() => []));
  });

  /** Has this visitor had their free search? */
  app.get("/api/public/podcast-search", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const member = Boolean(getSessionEmail(req) || getAdminEmail(req));
    const used = !member && (usedCookie(req) || (await ipUsed(ipOf(req))));
    res.json({ member, left: member ? null : used ? 0 : 1, guests: podscanOn() });
  });

  app.post("/api/public/podcast-search", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const q = String(req.body?.q ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const kind = req.body?.kind === "shows" ? "shows" : "people";
    if (q.length < 2) return res.status(400).json({ message: "Type a topic or a name." });
    const member = getSessionEmail(req) || getAdminEmail(req) || "";
    const ip = ipOf(req);
    if (!member) {
      if (usedCookie(req) || (await ipUsed(ip))) {
        return res.status(402).json({ message: "That was your free search. Sign up free for unlimited searches.", left: 0 });
      }
      const dayKey = `public:day:${new Date().toISOString().slice(0, 10)}`;
      const today = Number((await read(dayKey))?.payload) || 0;
      if (today >= PUBLIC_DAILY) return res.status(429).json({ message: "Free searches are busy today. Sign up free to keep searching.", left: 0 });
      await write(dayKey, String(today + 1));
    }
    try {
      let results: unknown[];
      if (kind === "people" && podscanOn()) {
        const r = await podscanPeople({ q, page: 0, sort: "appearances", who: member ? member.toLowerCase() : "public-visitors" });
        results = r.results.slice(0, 12).map((p) => ({ kind: "person", name: p.name, subtitle: p.subtitle, appearances: p.appearances }));
      } else {
        results = (await findShows(q)).map((s) => ({ kind: "show", title: s.title, host: s.host, image: s.image, episodes: s.episodes }));
      }
      if (!member) {
        // Spent only when it answered: the visitor and their address, for good.
        await write(`public:ip:${ip}`, "1");
        res.setHeader("Set-Cookie", `${COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax; Secure`);
      }
      res.json({ kind: kind === "people" && podscanOn() ? "people" : "shows", q, results, left: member ? null : 0, member: Boolean(member) });
    } catch (err) {
      console.warn("Public podcast search failed:", (err as Error).message);
      res.status(502).json({ message: "The search didn't answer. Try again in a moment." });
    }
  });
}
