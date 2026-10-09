// The keepsake magazine's numbers (9 Oct 2026): every picture is a link, and every picture click,
// link click, play and QR scan is counted, page by page, for Admin → Magazine.
//
// Counts live in site_settings as magstat:<eventId>:<pageKey>|<kind>|<label> (a number). The page
// list (what's on each page, in order) is sent by the magazine itself when an admin opens it, so the
// admin view can show every item, including the ones nobody has touched yet.
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { siteSettings } from "../shared/schema.js";
import { buildMagazine } from "./magazine.js";

const KINDS = new Set(["image", "link", "play", "qr", "share"]);
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[|\n\r]+/g, " ").trim().slice(0, n);

async function bump(eventId: number, page: string, kind: string, label: string): Promise<void> {
  const key = `magstat:${eventId}:${page}|${kind}|${label}`;
  await db.execute(sql`insert into site_settings (key, value) values (${key}, '1')
    on conflict (key) do update set value = ((case when site_settings.value ~ '^[0-9]+$' then site_settings.value::int else 0 end) + 1)::text`);
}

// Where a QR may send people: our own site, and the places the magazine itself links to.
const STATIC_HOSTS = ["militaryvoices.ai", "youtube.com", "youtu.be", "americanwarriors.com", "tradingview.com"];
let hosts: { at: number; eventId: number; set: Set<string> } | null = null;
async function allowed(eventId: number, url: URL): Promise<boolean> {
  const h = url.hostname.replace(/^www\./, "").toLowerCase();
  if (STATIC_HOSTS.some((x) => h === x || h.endsWith(`.${x}`))) return true;
  if (!hosts || hosts.eventId !== eventId || Date.now() - hosts.at > 10 * 60_000) {
    const m = await buildMagazine(eventId).catch(() => null);
    const found = new Set<string>();
    for (const u of JSON.stringify(m ?? {}).match(/https?:\/\/[^"\s\\]+/g) ?? []) {
      try { found.add(new URL(u).hostname.replace(/^www\./, "").toLowerCase()); } catch { /* not a link */ }
    }
    hosts = { at: Date.now(), eventId, set: found };
  }
  return hosts.set.has(h);
}

const seen = new Map<string, number[]>();
const tooMany = (ip: string) => {
  const recent = (seen.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
  seen.set(ip, [...recent, Date.now()]);
  return recent.length >= 300;
};

export function registerMagazineStats(app: Express, requireAdmin: RequestHandler) {
  /** A click or a play, from the magazine page (sendBeacon). */
  app.post("/api/magazine/track", async (req, res) => {
    res.status(204).end();
    try {
      await schemaIsReady();
      let b = req.body ?? {};
      if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
      const eventId = Number(b.e) || 0;
      const kind = clean(b.k, 10);
      const page = clean(b.p, 40);
      const label = clean(b.l, 90);
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
      if (!eventId || !KINDS.has(kind) || kind === "qr" || !page || !label || tooMany(ip)) return;
      await bump(eventId, page, kind, label);
    } catch (err) {
      console.warn("magazine track:", (err as Error).message);
    }
  });

  /** A QR code (or a tap on one): count it, then on to where it always went. */
  app.get("/go/m", async (req, res) => {
    const eventId = Number(req.query.e) || 0;
    let to: URL | null = null;
    try { to = new URL(String(req.query.u ?? "")); } catch { to = null; }
    if (!to || !/^https?:$/.test(to.protocol)) return res.redirect(302, "https://www.militaryvoices.ai/magazine");
    try {
      await schemaIsReady();
      if (!(await allowed(eventId, to))) return res.redirect(302, "https://www.militaryvoices.ai/magazine");
      const page = clean(req.query.p, 40);
      const label = clean(req.query.l, 90) || `${to.hostname.replace(/^www\./, "")}${to.pathname === "/" ? "" : to.pathname}`.slice(0, 90);
      if (eventId && page) await bump(eventId, page, "qr", label);
    } catch (err) {
      console.warn("magazine qr:", (err as Error).message);
    }
    res.redirect(302, to.toString());
  });

  /**
   * A podcaster's share link (9 Oct): militaryvoices.ai/m/<signupId>, in their share graphic and email.
   * Counted as a "share" visit on their page, then straight to their page in the magazine.
   */
  app.get("/m/:id", async (req, res) => {
    const id = Number(req.params.id) || 0;
    try {
      await schemaIsReady();
      const ev = await storage.getFeaturedEvent();
      if (id && ev?.id) await bump(ev.id, String(id), "share", "Share link");
    } catch (err) {
      console.warn("magazine share:", (err as Error).message);
    }
    res.redirect(302, id ? `https://www.militaryvoices.ai/magazine#show-${id}` : "https://www.militaryvoices.ai/magazine");
  });

  /** What's on each page, in order: sent by the magazine when an admin opens it. */
  app.post("/api/admin/magazine/:eventId/manifest", requireAdmin, async (req, res) => {
    const pages = Array.isArray(req.body?.pages) ? req.body.pages.slice(0, 120) : [];
    const tidy = pages.map((p: { p?: unknown; n?: unknown; label?: unknown; items?: unknown }) => ({
      p: clean(p.p, 40), n: Number(p.n) || 0, label: clean(p.label, 90),
      items: (Array.isArray(p.items) ? p.items.slice(0, 60) : []).map((i: { k?: unknown; l?: unknown }) => ({ k: clean(i.k, 10), l: clean(i.l, 90) })).filter((i: { k: string; l: string }) => KINDS.has(i.k) && i.l),
    })).filter((p: { p: string }) => p.p);
    await storage.setSetting(`magmanifest:${Number(req.params.eventId)}`, JSON.stringify({ at: new Date().toISOString(), pages: tidy }));
    res.json({ ok: true, pages: tidy.length });
  });

  /** The numbers, page by page. */
  app.get("/api/admin/magazine/:eventId/stats", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const eventId = Number(req.params.eventId);
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select().from(siteSettings).where(sql`${siteSettings.key} like ${`magstat:${eventId}:%`}`);
    const counts = rows.map((r) => {
      const [page, kind, ...rest] = r.key.slice(`magstat:${eventId}:`.length).split("|");
      return { p: page, k: kind, l: rest.join("|"), n: Number(r.value) || 0 };
    });
    let manifest: { at: string; pages: { p: string; n: number; label: string; items: { k: string; l: string }[] }[] } | null = null;
    try { manifest = JSON.parse((await storage.getSetting(`magmanifest:${eventId}`)) ?? "null"); } catch { manifest = null; }
    res.json({ manifest, counts });
  });
}
