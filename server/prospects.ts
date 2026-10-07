// Brand prospects (7 Oct 2026): who already advertises to the military
// community. We search the public ad libraries (Meta's and LinkedIn's) through
// SearchApi for words like "veteran discount" or "VA loan", group the ads by
// advertiser, and save the ones worth a call to a sales list. Those brands have
// a budget for this audience already; we show them a better way to spend it.
import type { Express, RequestHandler } from "express";
import { desc, eq } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { brandProspects, discoveryCache } from "../shared/schema.js";

const now = () => new Date().toISOString();
// Trimmed, and any quotes a copy-paste brought along taken off.
const key = () => (process.env.SEARCHAPI_API_KEY || process.env.SEARCH_API_KEY || process.env.SEARCHAPI_KEY || "").trim().replace(/^["']|["']$/g, "");
const DAY = 24 * 3600_000;

export type Advertiser = { name: string; source: "meta" | "linkedin"; ads: number; sample: string; link: string; website: string; active: boolean };

const domainOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

async function searchApi(params: Record<string, string>): Promise<Record<string, unknown>> {
  const k = key();
  if (!k) throw Object.assign(new Error("Add SEARCHAPI_API_KEY in Vercel to search the ad libraries."), { status: 503 });
  const url = `https://www.searchapi.io/api/v1/search?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(45_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(String((body as { error?: string }).error ?? `SearchApi said ${res.status}`)), { status: 502 });
  return body;
}

/** Ads for a phrase, grouped by who's paying for them. Cached a day: the libraries don't move faster. */
export async function findAdvertisers(source: "meta" | "linkedin", q: string, country = "US"): Promise<Advertiser[]> {
  const cacheKey = `searchapi:${source}:${country}:${q.toLowerCase()}`;
  const [hit] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, cacheKey));
  if (hit && Date.now() - Date.parse(hit.createdAt) < DAY) return JSON.parse(hit.payload) as Advertiser[];

  const by = new Map<string, Advertiser>();
  if (source === "meta") {
    const r = await searchApi({ engine: "meta_ad_library", q, country, active_status: "active", ad_type: "all", sort_by: "impressions_high_to_low" });
    for (const ad of (r.ads as Record<string, any>[] | undefined) ?? []) {
      const name = String(ad.page_name || ad.snapshot?.page_name || "").trim();
      if (!name) continue;
      const a = by.get(name) ?? { name, source, ads: 0, sample: "", link: ad.page_id ? `https://www.facebook.com/ads/library/?view_all_page_id=${ad.page_id}` : "", website: "", active: false };
      a.ads++;
      a.active = a.active || !!ad.is_active;
      if (!a.sample) a.sample = String(ad.snapshot?.body?.text ?? ad.snapshot?.cards?.[0]?.body ?? "").slice(0, 300);
      if (!a.website) a.website = domainOf(String(ad.snapshot?.link_url ?? ad.snapshot?.cards?.[0]?.link_url ?? ""));
      by.set(name, a);
    }
  } else {
    const r = await searchApi({ engine: "linkedin_ad_library", q, country, time_period: "last_30_days" });
    for (const ad of (r.ads as Record<string, any>[] | undefined) ?? []) {
      const name = String(ad.advertiser?.name ?? "").trim();
      if (!name) continue;
      const a = by.get(name) ?? { name, source, ads: 0, sample: "", link: String(ad.link ?? ""), website: "", active: true };
      a.ads++;
      if (!a.sample) a.sample = String(ad.content?.headline ?? "").slice(0, 300);
      by.set(name, a);
    }
  }
  const out = Array.from(by.values()).sort((a, b) => b.ads - a.ads);
  await db.insert(discoveryCache).values({ key: cacheKey, payload: JSON.stringify(out), createdAt: now() })
    .onConflictDoUpdate({ target: discoveryCache.key, set: { payload: JSON.stringify(out), createdAt: now() } });
  return out;
}

/** Phrases that find brands talking to this audience. */
export const PROSPECT_PHRASES = ["veteran discount", "military discount", "VA loan", "veteran owned", "military spouse", "for veterans", "military families", "GI Bill"];

export function registerProspects(app: Express, requireAdmin: RequestHandler) {
  const platformOnly: RequestHandler = (req, res, next) =>
    (req as { studioHost?: unknown; eventAdmin?: unknown }).studioHost || (req as { eventAdmin?: unknown }).eventAdmin ? res.status(403).json({ message: "Admins only." }) : next();

  app.get("/api/admin/prospects", requireAdmin, platformOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    res.json({ ready: !!key(), phrases: PROSPECT_PHRASES, saved: await db.select().from(brandProspects).orderBy(desc(brandProspects.id)) });
  });

  app.post("/api/admin/prospects/search", requireAdmin, platformOnly, async (req, res) => {
    const source = req.body?.source === "linkedin" ? "linkedin" : "meta";
    const q = String(req.body?.q ?? "").trim().slice(0, 80);
    if (!q) return res.status(400).json({ message: "What should we search for?" });
    try {
      const found = await findAdvertisers(source, q);
      const saved = new Set((await db.select({ name: brandProspects.name }).from(brandProspects)).map((r) => r.name.toLowerCase()));
      res.json(found.map((a) => ({ ...a, saved: saved.has(a.name.toLowerCase()) })));
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ message: (e as Error).message });
    }
  });

  /** Save one to the list (or update it if it's there). */
  app.post("/api/admin/prospects", requireAdmin, platformOnly, async (req, res) => {
    await schemaIsReady();
    const name = String(req.body?.name ?? "").trim().slice(0, 160);
    if (!name) return res.status(400).json({ message: "Which company?" });
    const row = {
      name,
      source: ["meta", "linkedin"].includes(req.body?.source) ? req.body.source : "manual",
      query: String(req.body?.query ?? "").slice(0, 80),
      website: String(req.body?.website ?? "").slice(0, 200),
      link: String(req.body?.link ?? "").slice(0, 400),
      adCount: Math.max(0, Math.round(Number(req.body?.ads) || 0)),
      sample: String(req.body?.sample ?? "").slice(0, 400),
      createdAt: now(), updatedAt: now(),
    };
    const [saved] = await db.insert(brandProspects).values(row)
      .onConflictDoUpdate({ target: brandProspects.name, set: { adCount: row.adCount, sample: row.sample, website: row.website, link: row.link, updatedAt: now() } }).returning();
    res.status(201).json(saved);
  });

  app.put("/api/admin/prospects/:id", requireAdmin, platformOnly, async (req, res) => {
    const patch: Partial<typeof brandProspects.$inferInsert> = { updatedAt: now() };
    if (["new", "contacted", "signed_up", "passed"].includes(req.body?.status)) patch.status = req.body.status;
    if (typeof req.body?.notes === "string") patch.notes = req.body.notes.slice(0, 2000);
    if (typeof req.body?.website === "string") patch.website = req.body.website.slice(0, 200);
    const [row] = await db.update(brandProspects).set(patch).where(eq(brandProspects.id, Number(req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Not on the list." });
    res.json(row);
  });

  app.delete("/api/admin/prospects/:id", requireAdmin, platformOnly, async (req, res) => {
    await db.delete(brandProspects).where(eq(brandProspects.id, Number(req.params.id)));
    res.json({ ok: true });
  });
}
