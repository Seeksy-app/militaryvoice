// The MilitaryVoices browser extension (19 Nov 2026): what it can ask of the signed-in podcaster's account.
//   /api/ext/me       who is signed in (the extension shows "sign in" when it isn't)
//   /api/ext/capture  "Add to my show": a person found on any page, saved to Invite a guest
//   /api/ext/import   "Send to my Library": a direct video link, brought in like an import-link recording
//   /api/ext/prep     "Prep me for this guest": Alex's one-page briefing from the page the person is on
// The extension sends the session cookie (it has permission for this site), so these use the same sign-in as the dashboard.
import crypto from "node:crypto";
import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import type { NextFunction, Request, Response } from "express";
import { getAdminEmail, getSessionEmail, requireHostSession } from "./session.js";
import { boothBookings } from "./guestInvites.js";
import { myDiscoveryPeek } from "./discovery.js";
import { hostedAsStats } from "./hosting.js";
import { parseSocialAccounts } from "./uploadPost.js";
import type { PodcastStatsData } from "../shared/schema.js";

const SITE = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const DAY = 86_400_000;
const rowsOf = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Their next show: a Radio slot they booked (or co-host), or an interview time they set when inviting a guest. */
async function nextShow(email: string, show: string) {
  type Next = { kind: "radio" | "studio" | "zoom" | "other"; title: string; where: string; guest: string; startAt: string; endAt: string; go: string };
  const out: Next[] = [];
  for (const b of await boothBookings(email).catch(() => [])) {
    out.push({ kind: "radio", title: b.show || show || "Your Radio show", where: "MilitaryVoices Radio", guest: "", startAt: new Date(b.startMs).toISOString(), endAt: new Date(b.endMs).toISOString(), go: `${SITE}/booth/${b.id}` });
  }
  const invites = rowsOf(await db.execute(sql`select guest_name, when_iso, zoom_link, link_later from guest_invites where owner_email=${email} and when_iso <> '' and status <> 'cancelled' order by when_iso limit 50`).catch(() => []));
  for (const r of invites) {
    const start = Date.parse(String(r.when_iso));
    if (!Number.isFinite(start)) continue;
    const link = String(r.zoom_link ?? "");
    const guest = String(r.guest_name ?? "");
    const atRadio = out.find((x) => x.kind === "radio" && Math.abs(Date.parse(x.startAt) - start) < 30 * 60_000);
    // A guest invited into a Radio booth: that slot gains the guest's name rather than becoming a second show.
    if (atRadio || /\/booth\//.test(link)) { if (atRadio && !atRadio.guest) atRadio.guest = guest; continue; }
    const studio = /\/my-studio\b/.test(link);
    const zoom = /^https:\/\/([a-z0-9-]+\.)?zoom\.(us|com)\//i.test(link);
    out.push({
      kind: studio ? "studio" : zoom ? "zoom" : "other",
      title: show || "Your show", where: studio ? "Your Studio" : zoom ? "Zoom" : "Interview", guest,
      startAt: new Date(start).toISOString(), endAt: new Date(start + 60 * 60_000).toISOString(),
      go: studio ? `${SITE}/my-studio` : zoom ? link : `${SITE}/host/dashboard/podcast`,
    });
  }
  return out.filter((x) => Date.parse(x.endAt) > Date.now()).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0] ?? null;
}

/** Downloads per day across every source we hold (hosted here, and the saved copy of a connected host; never a fresh fetch). */
async function downloads(email: string) {
  const sources: PodcastStatsData[] = [];
  for (const h of await hostedAsStats(email).catch(() => [])) sources.push(h.data);
  for (const r of await storage.listPodcastStats(email).catch(() => [])) {
    try { const d = r.data ? (JSON.parse(r.data) as PodcastStatsData) : null; if (d && r.status === "ok") sources.push(d); } catch { /* unreadable */ }
  }
  const counted = sources.filter((d) => d.unit === "downloads" && d.series?.some((p) => p.date.length === 10));
  if (!counted.length) return null;
  const perDay = new Map<string, number>();
  for (const d of counted) for (const p of d.series ?? []) if (p.date.length === 10) perDay.set(p.date, (perDay.get(p.date) ?? 0) + (Number(p.count) || 0));
  const today = Date.now();
  const days = Array.from({ length: 14 }, (_, i) => dayKey(today - (13 - i) * DAY));
  const vals = days.map((k) => perDay.get(k) ?? 0);
  const week = vals.slice(7).reduce((a, b) => a + b, 0);
  const prev = vals.slice(0, 7).reduce((a, b) => a + b, 0);
  return { week, prev, trend: vals.slice(7), days: days.slice(7) };
}

/**
 * Followers across their connected accounts (the totals saved when they last synced). The platforms give a running total,
 * not a history, so one number a day is kept here to say how many are new this week.
 */
async function followers(email: string, socialJson: string | null | undefined) {
  const accounts = parseSocialAccounts(socialJson).filter((a) => typeof a.followers === "number");
  if (!accounts.length) return null;
  const total = accounts.reduce((n, a) => n + (a.followers ?? 0), 0);
  const key = `ext-followers:${email}`;
  let hist: Record<string, number> = {};
  try { hist = JSON.parse((await storage.getSetting(key)) ?? "{}") || {}; } catch { hist = {}; }
  const today = dayKey(Date.now());
  if (hist[today] !== total) {
    hist[today] = total;
    const keep = Object.keys(hist).sort().slice(-30);
    await storage.setSetting(key, JSON.stringify(Object.fromEntries(keep.map((k) => [k, hist[k]])))).catch(() => {});
  }
  const weekAgo = dayKey(Date.now() - 7 * DAY);
  const base = Object.keys(hist).sort().filter((k) => k <= weekAgo).pop();
  return { total, accounts: accounts.length, newThisWeek: base ? total - hist[base] : null };
}

/** What's happened in the last week that wants them: finished clips, a published episode, a guest asking to come on, a question to answer. */
async function whatsNew(email: string) {
  type Item = { kind: "clips" | "episode" | "guest" | "question" | "answered"; title: string; sub: string; at: string; url: string };
  const since = Date.now() - 7 * DAY;
  const items: Item[] = [];
  const recent = (iso: unknown) => { const t = Date.parse(String(iso ?? "")); return Number.isFinite(t) && t >= since; };
  for (const r of rowsOf(await db.execute(sql`select id, title, clip_progress from recordings where lower(email)=${email} and clip_status='done' and clip_progress <> '' order by id desc limit 20`).catch(() => []))) {
    let p: { at?: string; finished?: number } = {};
    try { p = JSON.parse(String(r.clip_progress)); } catch { continue; }
    if (!recent(p.at)) continue;
    const n = Number(p.finished) || 0;
    items.push({ kind: "clips", title: n ? `${n} clips are ready` : "Your clips are ready", sub: `From ${String(r.title || "your episode")}`, at: String(p.at), url: `${SITE}/host/dashboard/postify?rec=${r.id}` });
  }
  for (const r of rowsOf(await db.execute(sql`select e.title, e.published_at, s.title as show from hosted_episodes e join hosted_shows s on s.id = e.show_id where lower(s.email)=${email} and e.status='published' and e.published_at <> '' order by e.published_at desc limit 5`).catch(() => []))) {
    if (!recent(r.published_at) || Date.parse(String(r.published_at)) > Date.now()) continue;
    items.push({ kind: "episode", title: `Published: ${String(r.title || "a new episode")}`, sub: String(r.show || "Your show"), at: String(r.published_at), url: `${SITE}/host/dashboard/podcast` });
  }
  for (const r of rowsOf(await db.execute(sql`select name, question, episode, created_at from listener_questions where lower(email)=${email} and status='new' order by id desc limit 10`).catch(() => []))) {
    if (!recent(r.created_at)) continue;
    const guest = String(r.episode) === "Be a guest";
    const who = String(r.name || "").trim();
    items.push({
      kind: guest ? "guest" : "question",
      title: guest ? `New guest request${who ? `: ${who}` : ""}` : `A question to answer${who ? ` from ${who}` : ""}`,
      sub: String(r.question || "").replace(/\s+/g, " ").slice(0, 90),
      at: String(r.created_at), url: `${SITE}/host/dashboard/page`,
    });
  }
  for (const r of rowsOf(await db.execute(sql`select guest_name, answered_at from guest_invites where owner_email=${email} and status='answered' and answered_at <> '' order by answered_at desc limit 5`).catch(() => []))) {
    if (!recent(r.answered_at)) continue;
    items.push({ kind: "answered", title: `${String(r.guest_name || "Your guest")} answered your questions`, sub: "Their bio, topics and photo are in", at: String(r.answered_at), url: `${SITE}/host/dashboard/podcast` });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4);
}

type Capture = { id: string; name: string; title: string; org: string; photoUrl: string; bio: string; url: string; savedAt: string };

const str = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const httpsUrl = (v: unknown) => {
  const s = String(v ?? "").trim();
  try { const u = new URL(s); return u.protocol === "https:" ? u.toString().slice(0, 600) : ""; } catch { return ""; }
};
const key = (email: string) => `ext-captures:${email}`;

async function readCaptures(email: string): Promise<Capture[]> {
  try { const v = JSON.parse((await storage.getSetting(key(email))) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Pages a podcaster can't download from here: the file isn't ours to fetch, and the worker needs a direct video file. */
const NOT_A_FILE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|twitter\.com|x\.com|linkedin\.com)$/i;

const BRIEF_SYSTEM =
  "You prepare a podcast host to interview a guest. You are given the text of a web page about the guest (a profile, bio or article). " +
  "Use only what the page says; if something isn't there, leave it out and never guess. Plain, warm, specific; no hype, no emoji. " +
  "Return JSON only, with these keys: name (string), headline (string, who they are in one line), summary (string, two or three sentences), " +
  "talkingPoints (array of 4 to 6 short strings, the interesting things worth asking about), questions (array of 5 open questions for a military and veteran audience), " +
  "pronounce (string: how to say their name if it is unusual, else empty), careful (string: anything the host should handle with care, such as a loss or a sensitive subject, else empty).";


/**
 * The extension acts only on the signed-in person's own account. A podcaster sign-in is what it normally uses; a team member who is
 * signed in to the admin (and listed as an admin) can use it as themselves too, so they needn't sign in twice. It grants nothing
 * beyond their own address: no admin power comes from a podcaster sign-in, and none is used here.
 */
async function extSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  let email = (getSessionEmail(req) ?? "").trim().toLowerCase();
  if (!email) {
    const admin = (getAdminEmail(req) ?? "").trim().toLowerCase();
    if (admin && (await storage.isAdminEmail(admin))) email = admin;
  }
  if (!email) { res.status(401).json({ message: "Please sign in again." }); return; }
  (req as any).extEmail = email;
  next();
}
const who = (req: Request) => String((req as any).extEmail ?? "");

export function registerExtensionApi(app: Express): void {
  app.get("/api/ext/me", extSession, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const email = who(req);
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    res.json({ email, show: profile?.podcastName ?? "", name: profile?.hostName ?? "", saved: (await readCaptures(email)).length });
  });

  /**
   * The popup (Andrew, 23 Nov, mockup approved): Today, Your numbers, What's new, in one read. It never calls a third party:
   * Discovery is the saved 30-day row (no Influencers Club read), followers are the totals saved at their last sync, and
   * downloads are our own counts plus the saved copy of a connected host.
   */
  app.get("/api/ext/home", extSession, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const email = who(req);
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    const show = profile?.podcastName ?? "";
    const [today, dl, fol, disc, news] = await Promise.all([
      nextShow(email, show).catch(() => null),
      downloads(email).catch(() => null),
      followers(email, profile?.socialAccounts).catch(() => null),
      myDiscoveryPeek(email).catch(() => ({ none: true as const })),
      whatsNew(email).catch(() => []),
    ]);
    res.json({
      email, show, name: profile?.hostName ?? "", photo: profile?.photoUrl ?? "",
      today,
      numbers: { downloads: dl, followers: fol, discovery: "cached" in disc && disc.cached ? { score: disc.credibility } : null },
      news,
    });
  });

  app.post("/api/ext/capture", extSession, async (req, res) => {
    const email = who(req);
    const name = str(req.body?.name, 120);
    if (!name) return res.status(400).json({ message: "I couldn't find a person's name on this page. Open their profile or bio page and try again." });
    const list = await readCaptures(email);
    const url = httpsUrl(req.body?.url);
    const dupe = list.find((c) => (url && c.url === url) || c.name.toLowerCase() === name.toLowerCase());
    if (dupe) return res.json({ ok: true, already: true, capture: dupe, total: list.length });
    const capture: Capture = {
      id: crypto.randomBytes(6).toString("hex"),
      name, title: str(req.body?.title, 160), org: str(req.body?.org, 120), photoUrl: httpsUrl(req.body?.photoUrl),
      bio: str(req.body?.bio, 600), url, savedAt: new Date().toISOString(),
    };
    const next = [capture, ...list].slice(0, 200);
    await storage.setSetting(key(email), JSON.stringify(next));
    res.status(201).json({ ok: true, capture, total: next.length });
  });

  app.get("/api/host/captures", requireHostSession, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await readCaptures((getSessionEmail(req) ?? "").trim().toLowerCase()));
  });

  app.delete("/api/host/captures/:id", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
    await storage.setSetting(key(email), JSON.stringify((await readCaptures(email)).filter((c) => c.id !== req.params.id)));
    res.json({ ok: true });
  });

  app.post("/api/ext/import", extSession, async (req, res) => {
    const email = who(req);
    const url = httpsUrl(req.body?.url);
    if (!url) return res.status(400).json({ message: "That isn't a web address I can bring in." });
    const host = new URL(url).hostname.toLowerCase();
    if (NOT_A_FILE.test(host)) return res.status(400).json({ message: "That is a page on a video site, not a video file, so I can't bring it in from here. Send us the file, or use a link that downloads the video itself (Dropbox, Google Drive, your recording tool)." });
    if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".internal") || host.endsWith(".local")) return res.status(400).json({ message: "That address can't be fetched." });
    if ((await storage.pendingImports(email)) >= 10) return res.status(429).json({ message: "Ten are already coming in. Try again when they've finished." });
    const title = str(req.body?.title, 160) || "Imported recording";
    const row = await storage.queueImport({
      email, title,
      egressId: `LINK_${crypto.createHash("sha256").update(url.split("?")[0]).digest("hex").slice(0, 24)}`,
      startedAt: new Date().toISOString(), durationSec: 0, sizeBytes: 0,
      source: JSON.stringify({ provider: "link", url, auto: true }),
    });
    res.status(row ? 201 : 200).json(row ? { ok: true, id: row.id, message: "It's coming into your Library. We'll email you when it's in." } : { ok: true, already: true, message: "That one is already in your Library." });
  });

  app.post("/api/ext/prep", extSession, async (req, res) => {
    const email = who(req);
    const text = String(req.body?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 14_000);
    if (text.length < 200) return res.status(400).json({ message: "There isn't enough on this page to prepare from. Open the guest's profile or bio and try again." });
    // A day's worth, so one stuck button can't run up the bill.
    const day = new Date().toISOString().slice(0, 10);
    const used = Number((await storage.getSetting(`ext-prep:${email}:${day}`)) ?? "0") || 0;
    if (used >= 25) return res.status(429).json({ message: "That's 25 briefings today. Try again tomorrow." });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ message: "Briefings are off for the moment." });
    try {
      const client = new Anthropic();
      const out = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: BRIEF_SYSTEM,
        messages: [{ role: "user", content: `Page: ${str(req.body?.title, 200)}\nAddress: ${httpsUrl(req.body?.url)}\n\n${text}` }],
      });
      const raw = out.content.map((c) => ("text" in c ? c.text : "")).join("").trim();
      const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const brief = JSON.parse(json);
      await storage.setSetting(`ext-prep:${email}:${day}`, String(used + 1));
      const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, n) : []);
      res.json({
        name: str(brief.name, 120), headline: str(brief.headline, 200), summary: str(brief.summary, 700),
        talkingPoints: list(brief.talkingPoints, 6), questions: list(brief.questions, 6),
        pronounce: str(brief.pronounce, 200), careful: str(brief.careful, 300),
      });
    } catch (err) {
      console.error("Extension briefing failed:", (err as Error).message);
      res.status(502).json({ message: "I couldn't write that briefing just now. Try again in a moment." });
    }
  });
}
