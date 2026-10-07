// Find your show (7 Oct 2026): at sign-up a podcaster types their show's name
// and picks it, instead of hunting for an RSS link they may never have seen.
// Apple's public podcast directory: free, no key, and every result carries its
// feed. Cached a day per search.
import type { Express, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";

export type FoundShow = { title: string; host: string; rss: string; image: string; apple: string; episodes: number };

export async function findShows(term: string): Promise<FoundShow[]> {
  const q = term.trim().slice(0, 80);
  if (q.length < 2) return [];
  const key = `apple-shows:${q.toLowerCase()}`;
  const [hit] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, key));
  if (hit && Date.now() - Date.parse(hit.createdAt) < 24 * 3600_000) return JSON.parse(hit.payload) as FoundShow[];
  const res = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ media: "podcast", entity: "podcast", limit: "8", term: q, country: "US" })}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Apple Podcasts said ${res.status}`);
  const j = (await res.json()) as { results?: Record<string, unknown>[] };
  const out: FoundShow[] = (j.results ?? []).filter((r) => r.feedUrl).map((r) => ({
    title: String(r.collectionName ?? ""), host: String(r.artistName ?? ""), rss: String(r.feedUrl ?? ""),
    image: String(r.artworkUrl600 ?? r.artworkUrl100 ?? ""), apple: String(r.collectionViewUrl ?? "").replace(/\?uo=\d+$/, ""), episodes: Number(r.trackCount ?? 0),
  }));
  const now = new Date().toISOString();
  await db.insert(discoveryCache).values({ key, payload: JSON.stringify(out), createdAt: now }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload: JSON.stringify(out), createdAt: now } });
  return out;
}

const hits = new Map<string, number[]>();

export function registerShowFinder(app: Express, _requireHostSession: RequestHandler) {
  // Open (the sign-up tour uses it before anyone has an account), so a fair share per visitor.
  app.get("/api/host/find-show", async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const t = Date.now();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < 600_000);
    recent.push(t);
    hits.set(ip, recent);
    if (recent.length > 60) return res.status(429).json({ message: "Slow down a moment." });
    try { res.json(await findShows(String(req.query.q ?? ""))); }
    catch (e) { res.status(502).json({ message: (e as Error).message }); }
  });
}
