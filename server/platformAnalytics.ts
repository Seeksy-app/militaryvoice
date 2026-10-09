// Admin → Growth → Analytics (9 Oct 2026): the platform's own numbers, not any one event's.
// Accounts, plans and revenue, Pōstify, SmartLinks, hosting, Discovery, the magazine and email,
// over a window (7, 30 or 90 days), with a day-by-day line for the main ones.
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { PLANS, ADDONS } from "../shared/tokens.js";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> => { const r: any = await db.execute(q); return (r.rows ?? r) as Row[]; };
const one = async (q: ReturnType<typeof sql>): Promise<number> => Number((await rows(q))[0]?.n ?? 0);

export function registerPlatformAnalytics(app: Express, requireAdmin: RequestHandler) {
  app.get("/api/admin/platform-analytics", requireAdmin, async (req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const sinceDay = since.slice(0, 10);
    const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch (e) { console.warn("analytics:", (e as Error).message); return fallback; } };

    const [accounts, accountsNew, subs, addons, recordingsNew, clipsNew, episodesClipped, pagesAll, pagesLive, bioKinds, shows, downloads, discMembers, discNew, searches, reveals, mag, mailOk, mailFailed] = await Promise.all([
      safe(() => one(sql`select count(*)::int n from podcaster_profiles`), 0),
      safe(() => one(sql`select count(*)::int n from podcaster_profiles where created_at >= ${since}`), 0),
      safe(() => rows(sql`select plan, interval, count(*)::int n from postify_subscriptions where status in ('active','trialing','past_due') group by plan, interval`), []),
      safe(() => rows(sql`select addon, count(*)::int n from addon_subscriptions where status in ('active','trialing','past_due') group by addon`), []),
      safe(() => one(sql`select count(*)::int n from recordings where started_at >= ${since}`), 0),
      safe(() => one(sql`select count(*)::int n from clips where created_at >= ${since}`), 0),
      safe(() => one(sql`select count(distinct recording_id)::int n from clips where created_at >= ${since}`), 0),
      safe(() => one(sql`select count(*)::int n from bio_pages`), 0),
      safe(() => one(sql`select count(*)::int n from bio_pages where published = true`), 0),
      safe(() => rows(sql`select kind, count(*)::int n from bio_events where day >= ${sinceDay} group by kind`), []),
      safe(() => one(sql`select count(*)::int n from hosted_shows`), 0),
      safe(() => one(sql`select count(*)::int n from hosted_downloads where day >= ${sinceDay}`), 0),
      safe(() => one(sql`select count(*)::int n from discovery_members`), 0),
      safe(() => one(sql`select count(*)::int n from discovery_members where created_at >= ${since}`), 0),
      safe(() => one(sql`select count(*)::int n from discovery_searches where created_at >= ${since}`), 0),
      safe(() => one(sql`select count(*)::int n from discovery_reveals where created_at >= ${since}`), 0),
      safe(() => rows(sql`select split_part(split_part(key, '|', 2), '|', 1) kind, sum(case when value ~ '^[0-9]+$' then value::int else 0 end)::int n from site_settings where key like 'magstat:%' group by 1`), []),
      safe(() => one(sql`select count(*)::int n from mail_log where sent_at >= ${since} and ok = true`), 0),
      safe(() => one(sql`select count(*)::int n from mail_log where sent_at >= ${since} and ok = false`), 0),
    ]);

    // Monthly recurring revenue: monthly plans at their price, yearly at a twelfth; add-ons monthly.
    let mrrCents = 0;
    const plans: { plan: string; name: string; interval: string; n: number }[] = [];
    for (const s of subs) {
      const p = PLANS[String(s.plan) as keyof typeof PLANS];
      const n = Number(s.n) || 0;
      if (!p) continue;
      plans.push({ plan: p.key, name: p.name, interval: String(s.interval || "month"), n });
      mrrCents += n * (s.interval === "year" ? Math.round(p.yearCents / 12) : p.cents);
    }
    for (const a of addons) {
      const ad = ADDONS[String(a.addon) as keyof typeof ADDONS];
      if (ad) mrrCents += (Number(a.n) || 0) * ad.cents;
    }

    // Day by day: new accounts, clips made, SmartLink views, episode downloads.
    const series = await safe(async () => {
      const [acc, clp, vw, dl] = await Promise.all([
        rows(sql`select left(created_at, 10) d, count(*)::int n from podcaster_profiles where created_at >= ${since} group by 1`),
        rows(sql`select left(created_at, 10) d, count(*)::int n from clips where created_at >= ${since} group by 1`),
        rows(sql`select day d, count(*)::int n from bio_events where day >= ${sinceDay} and kind = 'view' group by 1`),
        rows(sql`select day d, count(*)::int n from hosted_downloads where day >= ${sinceDay} group by 1`),
      ]);
      const at = (list: Row[], d: string) => Number(list.find((r) => r.d === d)?.n ?? 0);
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
        return { d, accounts: at(acc, d), clips: at(clp, d), views: at(vw, d), downloads: at(dl, d) };
      });
    }, [] as { d: string; accounts: number; clips: number; views: number; downloads: number }[]);

    const kind = (list: Row[], k: string) => Number(list.find((r) => r.kind === k)?.n ?? 0);
    res.json({
      days,
      accounts: { total: accounts, new: accountsNew },
      revenue: { mrrCents, plans, addons: addons.map((a) => ({ addon: String(a.addon), n: Number(a.n) || 0 })) },
      postify: { uploads: recordingsNew, clips: clipsNew, episodes: episodesClipped },
      smartlink: { pages: pagesAll, live: pagesLive, views: kind(bioKinds, "view"), clicks: bioKinds.filter((r) => r.kind !== "view").reduce((a, r) => a + (Number(r.n) || 0), 0) },
      hosting: { shows, downloads },
      discovery: { members: discMembers, new: discNew, searches, reveals },
      magazine: { plays: kind(mag, "play"), pictures: kind(mag, "image"), links: kind(mag, "link"), scans: kind(mag, "qr") },
      email: { sent: mailOk, failed: mailFailed },
      series,
    });
  });
}
