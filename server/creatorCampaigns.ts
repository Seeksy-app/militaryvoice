// Creators email their fans: the people who signed up on their SmartLink (Stay in touch).
// The same block editor as the team's campaigns; sent from "<Show> via MilitaryVoices.ai",
// replies to the creator, an unsubscribe from their list only. Sending works through the list
// a batch a minute (a cron), so a big list can't flood the mail service or our reputation.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { renderCreatorEmail, sendCreatorEmail } from "./email.js";
import { uploadShowAsset } from "./photoStorage.js";
import { bioPages, bioSubscribers, broadcastEvents, creatorCampaigns, creatorCampaignSends, type CreatorCampaignRow } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
/** A fair ceiling while it's new: a list this size is a creator, not a spammer. */
const MAX_LIST = 5000;
/** Per minute, per campaign. */
const BATCH = 60;
/** One send a day each: their fans hear from them, not at them. */
const DAY = 24 * 3600_000;

const token = (id: number) => crypto.createHmac("sha256", process.env.SESSION_SECRET || "mv-fans").update(`fan:${id}`).digest("hex").slice(0, 24);
const unsubscribeUrl = (subscriberId: number) => `${ORIGIN}/api/fans/unsubscribe?s=${subscriberId}&t=${token(subscriberId)}`;

async function pageOf(email: string) {
  const [p] = await db.select().from(bioPages).where(eq(bioPages.email, email)).limit(1);
  return p ?? null;
}
async function sender(email: string) {
  const page = await pageOf(email);
  const profile = await storage.getProfileByEmail(email).catch(() => undefined);
  return {
    page,
    showName: (profile?.podcastName?.trim() || page?.displayName?.trim() || profile?.hostName?.trim() || "Your show").slice(0, 60),
    banner: page?.heroUrl || "",
    pageUrl: page?.handle ? `${ORIGIN}/${page.handle}` : "",
  };
}
async function fans(pageId: number) {
  return db.select({ id: bioSubscribers.id, email: bioSubscribers.email, name: bioSubscribers.name }).from(bioSubscribers)
    .where(and(eq(bioSubscribers.pageId, pageId), eq(bioSubscribers.unsubscribedAt, ""))).orderBy(asc(bioSubscribers.id));
}
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? "";

/** Opens and clicks for a sent campaign, from the mail service's events. */
async function stats(id: number) {
  const sends = await db.select({ resendId: creatorCampaignSends.resendId }).from(creatorCampaignSends).where(eq(creatorCampaignSends.campaignId, id));
  const ids = sends.map((s) => s.resendId).filter(Boolean);
  if (!ids.length) return { opened: 0, clicked: 0 };
  const ev = await db.select({ r: broadcastEvents.resendId, t: broadcastEvents.eventType }).from(broadcastEvents).where(inArray(broadcastEvents.resendId, ids));
  return { opened: new Set(ev.filter((e) => e.t === "opened" || e.t === "clicked").map((e) => e.r)).size, clicked: new Set(ev.filter((e) => e.t === "clicked").map((e) => e.r)).size };
}

/** One batch of one campaign: the next people not yet sent to. */
async function sendBatch(c: CreatorCampaignRow, fresh = false): Promise<number> {
  // Claimed first: a batch touched in the last 55 seconds is another run's, and two runs at once would send twice.
  if (!fresh) {
    const [claim] = await db.update(creatorCampaigns).set({ updatedAt: now() })
      .where(and(eq(creatorCampaigns.id, c.id), eq(creatorCampaigns.status, "sending"), lte(creatorCampaigns.updatedAt, new Date(Date.now() - 55_000).toISOString()))).returning({ id: creatorCampaigns.id });
    if (!claim) return 0;
  }
  const s = await sender(c.ownerEmail);
  if (!s.page) return 0;
  const done = new Set((await db.select({ id: creatorCampaignSends.subscriberId }).from(creatorCampaignSends).where(eq(creatorCampaignSends.campaignId, c.id))).map((r) => r.id));
  const todo = (await fans(s.page.id)).filter((f) => !done.has(f.id)).slice(0, BATCH);
  let n = 0;
  for (const f of todo) {
    const resendId = await sendCreatorEmail({ to: f.email, replyTo: c.ownerEmail, campaignId: c.id, showName: s.showName, banner: s.banner, pageUrl: s.pageUrl, firstName: firstName(f.name), subject: c.subject, preheader: c.preheader, bodyText: c.bodyText, unsubscribeUrl: unsubscribeUrl(f.id) }).catch(() => null);
    // Recorded either way, so a refused address isn't retried every minute.
    await db.insert(creatorCampaignSends).values({ campaignId: c.id, subscriberId: f.id, email: f.email, resendId: resendId ?? "", sentAt: now() });
    if (resendId) n++;
  }
  const left = (await fans(s.page.id)).filter((f) => !done.has(f.id) && !todo.some((t) => t.id === f.id)).length;
  await db.update(creatorCampaigns).set({ sentCount: sql`${creatorCampaigns.sentCount} + ${n}`, ...(left === 0 ? { status: "sent" } : {}), updatedAt: now() }).where(eq(creatorCampaigns.id, c.id));
  return n;
}

export function registerCreatorCampaigns(app: Express, requireHostSession: RequestHandler) {
  const view = async (c: CreatorCampaignRow) => ({ ...c, ...(c.status === "sent" || c.status === "sending" ? await stats(c.id) : {}) });

  app.get("/api/host/campaigns", requireHostSession, async (req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const email = me(req);
    const s = await sender(email);
    const list = await db.select().from(creatorCampaigns).where(eq(creatorCampaigns.ownerEmail, email)).orderBy(desc(creatorCampaigns.id)).limit(50);
    const audience = s.page ? await fans(s.page.id) : [];
    res.json({ showName: s.showName, hasPage: !!s.page, audience: audience.length, sample: audience.slice(0, 20).map((f) => ({ email: f.email, name: f.name })), campaigns: await Promise.all(list.map(view)) });
  });

  app.post("/api/host/campaigns/preview", requireHostSession, async (req, res) => {
    const s = await sender(me(req));
    const b = req.body ?? {};
    const r = renderCreatorEmail({ showName: s.showName, banner: s.banner, pageUrl: s.pageUrl, firstName: "Sam", subject: String(b.subject ?? ""), preheader: String(b.preheader ?? ""), bodyText: String(b.bodyText ?? " "), unsubscribeUrl: "#" });
    res.type("html").send(r.html);
  });

  const clean = (b: any) => ({
    subject: String(b?.subject ?? "").trim().slice(0, 150),
    preheader: String(b?.preheader ?? "").trim().slice(0, 200),
    bodyText: String(b?.bodyText ?? "").slice(0, 50000),
  });

  app.post("/api/host/campaigns", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const v = clean(req.body);
    if (!v.subject || !v.bodyText.trim()) return res.status(400).json({ message: "Add a subject and some words first." });
    const [c] = await db.insert(creatorCampaigns).values({ ...v, ownerEmail: me(req), createdAt: now(), updatedAt: now() }).returning();
    res.json(c);
  });

  const mine = async (req: Request) => {
    const [c] = await db.select().from(creatorCampaigns).where(and(eq(creatorCampaigns.id, Number(req.params.id)), eq(creatorCampaigns.ownerEmail, me(req))));
    return c ?? null;
  };

  app.put("/api/host/campaigns/:id", requireHostSession, async (req, res) => {
    const c = await mine(req);
    if (!c) return res.status(404).json({ message: "No such email." });
    if (c.status === "sending" || c.status === "sent") return res.status(409).json({ message: "It's already gone out." });
    const v = clean(req.body);
    const when = typeof req.body?.scheduledFor === "string" && Date.parse(req.body.scheduledFor) > Date.now() ? new Date(req.body.scheduledFor).toISOString() : "";
    const [out] = await db.update(creatorCampaigns).set({ ...v, scheduledFor: when, status: when ? "scheduled" : "draft", updatedAt: now() }).where(eq(creatorCampaigns.id, c.id)).returning();
    res.json(out);
  });

  app.delete("/api/host/campaigns/:id", requireHostSession, async (req, res) => {
    const c = await mine(req);
    if (!c) return res.status(404).json({ message: "No such email." });
    if (c.status === "sending" || c.status === "sent") return res.status(409).json({ message: "It's already gone out." });
    await db.delete(creatorCampaigns).where(eq(creatorCampaigns.id, c.id));
    res.json({ ok: true });
  });

  /** To the creator themselves, as their fans will get it. */
  app.post("/api/host/campaigns/:id/test", requireHostSession, async (req, res) => {
    const c = await mine(req);
    if (!c) return res.status(404).json({ message: "No such email." });
    const email = me(req);
    const s = await sender(email);
    const id = await sendCreatorEmail({ to: email, replyTo: email, campaignId: c.id, showName: s.showName, banner: s.banner, pageUrl: s.pageUrl, firstName: "Sam", subject: `[TEST] ${c.subject}`, preheader: c.preheader, bodyText: c.bodyText, unsubscribeUrl: `${ORIGIN}/unsubscribe?test=1` });
    res.json({ ok: !!id, to: email });
  });

  /** Send now: it starts going out within a minute, a batch at a time. */
  app.post("/api/host/campaigns/:id/send", requireHostSession, async (req, res) => {
    const c = await mine(req);
    if (!c) return res.status(404).json({ message: "No such email." });
    if (c.status === "sending" || c.status === "sent") return res.status(409).json({ message: "It's already gone out." });
    const email = me(req);
    const s = await sender(email);
    if (!s.page) return res.status(400).json({ message: "Make your SmartLink first: your fans sign up there." });
    const list = await fans(s.page.id);
    if (!list.length) return res.status(400).json({ message: "Nobody has signed up yet. Add a Stay in touch block to your SmartLink." });
    if (list.length > MAX_LIST) return res.status(400).json({ message: `Your list is over ${MAX_LIST.toLocaleString()}. Write to us and we'll raise your limit.` });
    const [last] = await db.select({ at: creatorCampaigns.sentAt }).from(creatorCampaigns).where(and(eq(creatorCampaigns.ownerEmail, email), inArray(creatorCampaigns.status, ["sending", "sent"]))).orderBy(desc(creatorCampaigns.sentAt)).limit(1);
    const lastAt = Date.parse(last?.at || "") || 0;
    if (Date.now() - lastAt < DAY) return res.status(429).json({ message: "One email a day to your fans: they hear from you, not at you. Schedule this one for tomorrow." });
    const [out] = await db.update(creatorCampaigns).set({ status: "sending", recipientCount: list.length, sentAt: now(), scheduledFor: "", updatedAt: now() }).where(eq(creatorCampaigns.id, c.id)).returning();
    await sendBatch(out, true).catch((err) => console.error("Creator campaign first batch failed:", err));
    res.json((await db.select().from(creatorCampaigns).where(eq(creatorCampaigns.id, c.id)))[0]);
  });

  /** Have SI write it: a first draft in the creator's voice, theirs to edit. Ten a day. */
  const drafts = new Map<string, number[]>();
  app.post("/api/host/campaigns/draft", requireHostSession, async (req, res) => {
    const email = me(req);
    const prompt = String(req.body?.prompt ?? "").trim().slice(0, 1500);
    if (!prompt) return res.status(400).json({ message: "Say what the email is about." });
    const hits = (drafts.get(email) ?? []).filter((t) => Date.now() - t < DAY);
    if (hits.length >= 10) return res.status(429).json({ message: "That's ten drafts today. Try again tomorrow." });
    drafts.set(email, [...hits, Date.now()]);
    const s = await sender(email);
    try {
      const out = await new Anthropic().messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: `You write short emails from a military or veteran podcaster, ${s.showName}, to the fans who signed up on their page. Warm, direct, first person, in their voice. Return JSON only: {"subject": "...", "body": "..."}. The body is plain text with blank lines between paragraphs, starts with "Hi {{First_Name}},", 3 to 5 short paragraphs. You may put a button on its own line as [[Button words]](https://link) and a heading as "## Heading". No unsubscribe line and no signature: those are added. Never invent facts, dates or links they didn't give.`,
        messages: [{ role: "user", content: prompt }],
      });
      const text = out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
      const m = text.match(/\{[\s\S]*\}/);
      const j = m ? (JSON.parse(m[0]) as { subject?: string; body?: string }) : {};
      if (!j.body) throw new Error("no draft");
      res.json({ subject: String(j.subject ?? "").slice(0, 150), body: String(j.body).slice(0, 20000) });
    } catch (err) {
      console.error("Creator draft failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't write one just now. Try again in a moment." });
    }
  });

  /** A picture for a Picture block: public, so every mail app can show it. */
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
  app.post("/api/host/campaigns/image", requireHostSession, upload.single("file"), async (req, res) => {
    const f = (req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file;
    if (!f || !/^image\/(png|jpe?g|gif|webp)$/.test(f.mimetype)) return res.status(400).json({ message: "A PNG, JPG, GIF or WebP picture, up to 8 MB." });
    const ext = f.mimetype.split("/")[1].replace("jpeg", "jpg");
    const url = await uploadShowAsset(`campaigns/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`, f.buffer, f.mimetype);
    res.json({ url });
  });

  /** From the email's link (or the mail app's one-click unsubscribe): off this creator's list. */
  const unsubscribe: RequestHandler = async (req, res) => {
    await schemaIsReady();
    const id = Number(req.query.s);
    if (!id || String(req.query.t ?? "") !== token(id)) return res.status(400).send("This unsubscribe link isn't right.");
    const [row] = await db.update(bioSubscribers).set({ unsubscribedAt: now() }).where(eq(bioSubscribers.id, id)).returning({ pageId: bioSubscribers.pageId });
    const [page] = row ? await db.select({ name: bioPages.displayName }).from(bioPages).where(eq(bioPages.id, row.pageId)) : [];
    if (req.method === "POST") return res.status(200).end();
    res.type("html").send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px"><h2>You're unsubscribed.</h2><p>You won't get any more emails from ${(page?.name || "this show").replace(/[<>&"]/g, "")}.</p></body></html>`);
  };
  app.get("/api/fans/unsubscribe", unsubscribe);
  app.post("/api/fans/unsubscribe", unsubscribe);

  /** Every minute: scheduled ones whose time has come start; sending ones send their next batch. */
  app.get("/api/cron/creator-campaigns", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    await schemaIsReady();
    const due = await db.select().from(creatorCampaigns).where(and(eq(creatorCampaigns.status, "scheduled"), lte(creatorCampaigns.scheduledFor, now())));
    for (const c of due) {
      const s = await sender(c.ownerEmail);
      const n = s.page ? (await fans(s.page.id)).length : 0;
      // Started with an old updatedAt, so this run's batch below can claim it straight away.
      await db.update(creatorCampaigns).set({ status: n ? "sending" : "sent", recipientCount: n, sentAt: now(), updatedAt: "" }).where(eq(creatorCampaigns.id, c.id));
    }
    const sending = await db.select().from(creatorCampaigns).where(eq(creatorCampaigns.status, "sending")).limit(10);
    let sent = 0;
    for (const c of sending) sent += await sendBatch(c).catch((err) => { console.error("Creator campaign batch failed:", err); return 0; });
    res.json({ started: due.length, sent });
  });
}
