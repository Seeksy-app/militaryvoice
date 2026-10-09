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
  const memo = new Map<number, { at: number; body: unknown }>();
  app.get("/api/admin/platform-analytics", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    // Kept five minutes, and never longer than 15 seconds to work out.
    const hit = memo.get(days);
    if (hit && Date.now() - hit.at < 5 * 60_000) return res.json(hit.body);
    const timer = new Promise<"late">((r) => setTimeout(() => r("late"), 15_000));
    const body = await Promise.race([build(days), timer]).catch((e) => { console.warn("analytics:", (e as Error).message); return null; });
    if (body === "late" || !body) return res.status(503).json({ message: "The numbers are taking too long. Try again in a minute." });
    memo.set(days, { at: Date.now(), body });
    res.json(body);
  });

  async function build(days: number) {
    await schemaIsReady();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const sinceDay = since.slice(0, 10);
    const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch (e) { console.warn("analytics:", (e as Error).message); return fallback; } };

    // One query at a time (9 Oct): an instance has 4 connections shared by every request it serves,
    // and nineteen at once held them all.
    const accounts = await safe(() => one(sql`select count(*)::int n from podcaster_profiles`), 0);
    const accountsNew = await safe(() => one(sql`select count(*)::int n from podcaster_profiles where created_at >= ${since}`), 0);
    const subs = await safe(() => rows(sql`select plan, interval, (subscription_id like 'sub_%') paid, count(*)::int n from postify_subscriptions where status in ('active','trialing','past_due') group by 1, 2, 3`), []);
    const addons = await safe(() => rows(sql`select addon, count(*)::int n from addon_subscriptions where status in ('active','trialing','past_due') and subscription_id like 'sub_%' group by addon`), []);
    const recordingsNew = await safe(() => one(sql`select count(*)::int n from recordings where started_at >= ${since}`), 0);
    const clipsNew = await safe(() => one(sql`select count(*)::int n from clips where created_at >= ${since}`), 0);
    const episodesClipped = await safe(() => one(sql`select count(distinct recording_id)::int n from clips where created_at >= ${since}`), 0);
    const pagesAll = await safe(() => one(sql`select count(*)::int n from bio_pages`), 0);
    const pagesLive = await safe(() => one(sql`select count(*)::int n from bio_pages where published = true`), 0);
    const bioKinds = await safe(() => rows(sql`select kind, count(*)::int n from bio_events where day >= ${sinceDay} group by kind`), []);
    const shows = await safe(() => one(sql`select count(*)::int n from hosted_shows`), 0);
    const downloads = await safe(() => one(sql`select count(*)::int n from hosted_downloads where day >= ${sinceDay}`), 0);
    const discMembers = await safe(() => one(sql`select count(*)::int n from discovery_members`), 0);
    const discNew = await safe(() => one(sql`select count(*)::int n from discovery_members where created_at >= ${since}`), 0);
    const searches = await safe(() => one(sql`select count(*)::int n from discovery_searches where created_at >= ${since}`), 0);
    const reveals = await safe(() => one(sql`select count(*)::int n from discovery_reveals where created_at >= ${since}`), 0);
    const mag = await safe(() => rows(sql`select split_part(split_part(key, '|', 2), '|', 1) kind, sum(case when value ~ '^[0-9]+$' then value::int else 0 end)::int n from site_settings where key like 'magstat:%' group by 1`), []);
    const mailOk = await safe(() => one(sql`select count(*)::int n from mail_log where sent_at >= ${since} and ok = true`), 0);
    const mailFailed = await safe(() => one(sql`select count(*)::int n from mail_log where sent_at >= ${since} and ok = false`), 0);


    // Monthly recurring revenue: monthly plans at their price, yearly at a twelfth; add-ons monthly.
    let mrrCents = 0;
    // Only plans Stripe bills count as revenue; comped plans (a thank-you, a tester) are listed apart.
    const plans: { plan: string; name: string; interval: string; n: number; comped?: boolean }[] = [];
    for (const s of subs) {
      const p = PLANS[String(s.plan) as keyof typeof PLANS];
      const n = Number(s.n) || 0;
      if (!p) continue;
      const paid = s.paid === true || s.paid === "t";
      plans.push({ plan: p.key, name: p.name, interval: String(s.interval || "month"), n, ...(paid ? {} : { comped: true }) });
      if (paid) mrrCents += n * (s.interval === "year" ? Math.round(p.yearCents / 12) : p.cents);
    }
    for (const a of addons) {
      const ad = ADDONS[String(a.addon) as keyof typeof ADDONS];
      if (ad) mrrCents += (Number(a.n) || 0) * ad.cents;
    }

    // Day by day: new accounts, clips made, SmartLink views, episode downloads.
    const series = await safe(async () => {
      const acc = await rows(sql`select left(created_at, 10) d, count(*)::int n from podcaster_profiles where created_at >= ${since} group by 1`);
      const clp = await rows(sql`select left(created_at, 10) d, count(*)::int n from clips where created_at >= ${since} group by 1`);
      const vw = await rows(sql`select day d, count(*)::int n from bio_events where day >= ${sinceDay} and kind = 'view' group by 1`);
      const dl = await rows(sql`select day d, count(*)::int n from hosted_downloads where day >= ${sinceDay} group by 1`);
      const at = (list: Row[], d: string) => Number(list.find((r) => r.d === d)?.n ?? 0);
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
        return { d, accounts: at(acc, d), clips: at(clp, d), views: at(vw, d), downloads: at(dl, d) };
      });
    }, [] as { d: string; accounts: number; clips: number; views: number; downloads: number }[]);

    const kind = (list: Row[], k: string) => Number(list.find((r) => r.kind === k)?.n ?? 0);
    return {
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
    };
  }
}
