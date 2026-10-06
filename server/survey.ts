// After the Marathon: a one-minute survey for everyone who took part, each
// person's own thank-you (what they, specifically, were given), and the
// outbox that sends mail and gives credits at a set time.
//
// The survey is a private link per person, so there's nothing to sign in to:
// one question a screen, tap to answer. Admin → Survey shows who answered,
// who hasn't, and the totals.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, asc, eq, like, lte } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { emailShell, EMAIL_BANNERS, sendOneOffEmail, bccFor } from "./email.js";
import { outboxMail, postifySubscriptions, scheduledGrants, surveyInvites } from "../shared/schema.js";
import { SURVEY_QUESTIONS } from "../shared/survey.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const SURVEY = "marathon-2026";
const now = () => new Date().toISOString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (name: string) => name.trim().replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?|sergeant major \(ret\.\))\s+/i, "").split(/\s+/)[0] || "there";

/** Answers as sent, kept only where they match a question and one of its choices. */
function cleanAnswers(raw: unknown): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const q of SURVEY_QUESTIONS) {
    const v = a[q.key];
    if (q.kind === "text") {
      const t = String(v ?? "").trim().slice(0, 2000);
      if (t) out[q.key] = t;
    } else if (q.kind === "many") {
      const list = (Array.isArray(v) ? v : []).map(String).filter((x) => q.choices.some((c) => c.key === x));
      if (list.length) out[q.key] = Array.from(new Set(list)).slice(0, q.max ?? q.choices.length);
    } else if (q.choices.some((c) => c.key === String(v))) {
      out[q.key] = String(v);
    }
  }
  return out;
}

async function inviteFor(email: string, name: string, role: string) {
  const e = email.trim().toLowerCase();
  const [have] = await db.select().from(surveyInvites).where(and(eq(surveyInvites.survey, SURVEY), eq(surveyInvites.email, e)));
  if (have) return have;
  const [row] = await db.insert(surveyInvites).values({ survey: SURVEY, token: crypto.randomBytes(12).toString("base64url"), email: e, name: name.trim(), role, createdAt: now() }).returning();
  return row;
}

/** What one person was given, in their own lines: never a list of everyone's to pick from. */
export type ThanksPerson = {
  email: string;
  name: string;
  /** How to greet them, when it isn't their first name ("Mr. Whiskey"). */
  greet?: string;
  /** The show they brought (hosts), or whose show they were on (interviewees). */
  show?: string;
  host?: boolean;
  /** Their first 50 credits already went in with their clips email. */
  hostFirstGiven?: boolean;
  cohost?: boolean;
  interviewee?: boolean;
  award?: boolean;
};

export function giftLines(p: ThanksPerson): { html: string[]; text: string[] } {
  const html: string[] = [];
  const text: string[] = [];
  const add = (h: string, t: string) => { html.push(h); text.push(t); };
  if (p.award) {
    add(
      `<strong>The 2026 National Military Podcast Day award for Excellence in Storytelling.</strong> Out of every show on the day, yours is the one we're honoring. Your plaque is below.`,
      "The 2026 National Military Podcast Day award for Excellence in Storytelling. Out of every show on the day, yours is the one we're honoring.",
    );
  }
  if (p.host) {
    add(
      `<strong>150 Pōstify credits over the next 90 days.</strong> ${p.hostFirstGiven ? "The first 50 are already in your account" : "The first 50 are in your account now"}, and 50 more arrive on November 1 and again on December 1. Use them on clips, clean episodes and edits.`,
      `150 Pōstify credits over the next 90 days. ${p.hostFirstGiven ? "The first 50 are already in your account" : "The first 50 are in your account now"}, and 50 more arrive on November 1 and again on December 1.`,
    );
  }
  if (p.cohost) {
    add(
      `<strong>The Pōstify Pro plan, free for the rest of 2026.</strong> Six clips from every episode instead of four, and 90 credits every month. It's on your account now.`,
      "The Pōstify Pro plan, free for the rest of 2026: six clips from every episode instead of four, and 90 credits every month. It's on your account now.",
    );
  }
  if (p.interviewee) {
    add(
      `<strong>25 Pōstify credits</strong>, in your account now. Sign in at militaryvoices.ai with this email address and turn your own episodes into clips.`,
      "25 Pōstify credits, in your account now. Sign in at militaryvoices.ai with this email address and turn your own episodes into clips.",
    );
  }
  return { html, text };
}

const PLAQUE = `${ORIGIN}/email/award-storytelling-2026.jpg`;

/** Riccoh's thank-you to one person: their own gift, and the survey. */
export function thanksEmail(p: ThanksPerson, surveyUrl: string): { subject: string; html: string; text: string } {
  const name = p.greet?.trim() || firstName(p.name);
  const gifts = giftLines(p);
  const what = p.interviewee && !p.host && !p.cohost
    ? `Thank you for joining us on National Military Podcast Day${p.show ? ` as a guest on ${esc(p.show)}` : ""}. Sharing your story, live, in front of everyone takes courage, and you did it with heart.`
    : `Thank you for being part of National Military Podcast Day${p.show ? ` with ${esc(p.show)}` : ""}. Sixteen hours, back to back, and every one of them was carried by people like you, telling the truth about service in your own words.`;
  const giftIntro = gifts.html.length > 1 ? "As a thank-you, here's what we've given you:" : "As a thank-you, here's what we've given you:";
  const giftHtml = gifts.html.length > 1
    ? `<ul style="margin:0 0 16px;padding-left:20px;">${gifts.html.map((g) => `<li style="margin:0 0 10px;">${g}</li>`).join("")}</ul>`
    : `<p style="margin:0 0 16px;">${gifts.html[0] ?? ""}</p>`;
  const plaque = p.award
    ? `<p style="margin:0 0 16px;"><img src="${PLAQUE}" width="560" alt="Excellence in Storytelling, National Military Podcast Day 2026" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:12px;"></p>
<p style="margin:0 0 16px;">I'll be following up with you personally about the award.</p>`
    : "";
  const body = `<p style="margin:0 0 16px;">Hi ${esc(name)},</p>
<p style="margin:0 0 16px;">${what}</p>
<p style="margin:0 0 10px;">${giftIntro}</p>
${giftHtml}${plaque}
<p style="margin:0 0 16px;">One favor: tell us how it went. It's six quick taps and one minute, and it decides what we build next for you.</p>`;
  const html = emailShell({
    banner: EMAIL_BANNERS.podcasters,
    bannerAlt: "National Military Podcast Day",
    eyebrow: "National Military Podcast Day · thank you",
    heading: p.award ? `${name}, you've won Excellence in Storytelling` : `Thank you, ${name}`,
    body,
    cta: { href: surveyUrl, label: "Take the 1-minute survey" },
    secondary: `<p style="margin:16px 0 0;">Semper Fi,<br>Riccoh Player<br>Host, National Military Podcast Day</p>`,
    preheader: p.award ? "You've won the 2026 award for Excellence in Storytelling." : "Here's what we've given you, and one quick favor.",
  });
  const text = [
    `Hi ${name},`,
    "",
    what.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&"),
    "",
    "As a thank-you, here's what we've given you:",
    ...gifts.text.map((t) => `- ${t}`),
    ...(p.award ? ["", "I'll be following up with you personally about the award."] : []),
    "",
    "One favor: tell us how it went. It's six quick taps and one minute:",
    surveyUrl,
    "",
    "Semper Fi,",
    "Riccoh Player",
    "Host, National Military Podcast Day",
  ].join("\n");
  const subject = p.award ? "You've won Excellence in Storytelling" : "Thank you, and here's what we've given you";
  return { subject, html, text };
}

export function registerSurvey(app: Express, requireAdmin: RequestHandler): void {
  /** Their survey: who it's for (to greet them), and whether it's done. */
  app.get("/api/survey/:token", async (req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const [row] = await db.select().from(surveyInvites).where(eq(surveyInvites.token, String(req.params.token)));
    if (!row) return res.status(404).json({ message: "That survey link isn't right. Check the email it came in." });
    if (!row.openedAt) await db.update(surveyInvites).set({ openedAt: now() }).where(eq(surveyInvites.id, row.id));
    // "Mr. Whiskey" is a name in itself; anyone else is greeted by their first name.
    res.json({ name: /^mr\.?\s+\S+$/i.test(row.name.trim()) ? row.name.trim() : firstName(row.name), done: Boolean(row.completedAt) });
  });

  app.post("/api/survey/:token", async (req, res) => {
    await schemaIsReady();
    const [row] = await db.select().from(surveyInvites).where(eq(surveyInvites.token, String(req.params.token)));
    if (!row) return res.status(404).json({ message: "That survey link isn't right. Check the email it came in." });
    const answers = cleanAnswers(req.body?.answers);
    if (!Object.keys(answers).length) return res.status(400).json({ message: "Pick an answer first." });
    await db.update(surveyInvites).set({ answers: JSON.stringify(answers), completedAt: now() }).where(eq(surveyInvites.id, row.id));
    res.json({ ok: true });
  });

  /** Admin → Survey: everyone invited, who answered, and the totals per question. */
  app.get("/api/admin/survey", requireAdmin, async (_req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select().from(surveyInvites).where(eq(surveyInvites.survey, SURVEY)).orderBy(asc(surveyInvites.name));
    const people = rows.map((r) => {
      let answers: Record<string, string | string[]> = {};
      try { answers = r.answers ? JSON.parse(r.answers) : {}; } catch { answers = {}; }
      return { id: r.id, name: r.name, email: r.email, role: r.role, openedAt: r.openedAt, completedAt: r.completedAt, answers };
    });
    const totals: Record<string, Record<string, number>> = {};
    const notes: { name: string; text: string }[] = [];
    for (const q of SURVEY_QUESTIONS) totals[q.key] = Object.fromEntries(q.choices.map((c) => [c.key, 0]));
    for (const p of people) {
      for (const q of SURVEY_QUESTIONS) {
        const v = p.answers[q.key];
        if (q.kind === "text") { if (typeof v === "string" && v) notes.push({ name: p.name, text: v }); continue; }
        for (const k of Array.isArray(v) ? v : v ? [v] : []) if (k in totals[q.key]) totals[q.key][k]++;
      }
    }
    res.json({ people, totals, notes, invited: people.length, answered: people.filter((p) => p.completedAt).length });
  });

  /**
   * Each person's own thank-you from Riccoh, with their survey link, queued
   * for `sendAt` (or shown, with `preview`). Gifts are given separately;
   * this only says what they were.
   */
  app.post("/api/admin/survey/thanks", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const list = (Array.isArray(req.body?.people) ? req.body.people : []) as ThanksPerson[];
    const sendAt = String(req.body?.sendAt ?? "");
    const preview = req.body?.preview === true;
    if (!preview && !Number.isFinite(Date.parse(sendAt))) return res.status(400).json({ message: "When should it go?" });
    const out: { email: string; subject: string; queued?: number; html?: string; text?: string }[] = [];
    for (const p of list) {
      const email = String(p.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
      if (!p.host && !p.cohost && !p.interviewee && !p.award) continue;
      const role = p.cohost ? "cohost" : p.host ? "host" : "interviewee";
      const inv = await inviteFor(email, String(p.greet || p.name || ""), role);
      const mail = thanksEmail({ ...p, email }, `${ORIGIN}/survey/${inv.token}`);
      if (preview) { out.push({ email, ...mail }); continue; }
      const [already] = await db.select({ id: outboxMail.id }).from(outboxMail).where(and(eq(outboxMail.to, email), eq(outboxMail.kind, "marathon-thanks"), eq(outboxMail.status, "queued")));
      if (already) { out.push({ email, subject: mail.subject, queued: already.id }); continue; }
      const [row] = await db.insert(outboxMail).values({ to: email, subject: mail.subject, html: mail.html, text: mail.text, sender: "riccoh", kind: "marathon-thanks", sendAt: new Date(sendAt).toISOString(), createdAt: now() }).returning({ id: outboxMail.id });
      out.push({ email, subject: mail.subject, queued: row.id });
    }
    res.json({ count: out.length, items: out });
  });

  /** Mail waiting to go, and what went. */
  app.get("/api/admin/outbox", requireAdmin, async (_req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select({ id: outboxMail.id, to: outboxMail.to, subject: outboxMail.subject, kind: outboxMail.kind, sendAt: outboxMail.sendAt, status: outboxMail.status, sentAt: outboxMail.sentAt, error: outboxMail.error }).from(outboxMail).orderBy(asc(outboxMail.sendAt));
    const grants = await db.select().from(scheduledGrants).orderBy(asc(scheduledGrants.grantAt));
    res.json({ mail: rows, grants });
  });

  /** Stop something before it goes: one row, or a whole kind (`?kind=`). */
  app.post("/api/admin/outbox/cancel", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const id = Number(req.body?.id) || 0;
    const kind = String(req.body?.kind ?? "");
    if (!id && !kind) return res.status(400).json({ message: "Which one?" });
    const where = id ? and(eq(outboxMail.id, id), eq(outboxMail.status, "queued")) : and(eq(outboxMail.kind, kind), eq(outboxMail.status, "queued"));
    const rows = await db.update(outboxMail).set({ status: "cancelled" }).where(where).returning({ id: outboxMail.id });
    res.json({ cancelled: rows.length });
  });

  /** Credits for later: `{ grants: [{ email, credits, note, grantAt }] }`. */
  app.post("/api/admin/outbox/grants", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const list = Array.isArray(req.body?.grants) ? req.body.grants : [];
    let added = 0;
    for (const g of list) {
      const email = String(g?.email ?? "").trim().toLowerCase();
      const credits = Math.round(Number(g?.credits));
      const at = String(g?.grantAt ?? "");
      if (!/^[^@\s]+@[^@\s]+$/.test(email) || !(credits > 0 && credits <= 1000) || !Number.isFinite(Date.parse(at))) continue;
      const grantAt = new Date(at).toISOString();
      const [have] = await db.select({ id: scheduledGrants.id }).from(scheduledGrants).where(and(eq(scheduledGrants.email, email), eq(scheduledGrants.grantAt, grantAt)));
      if (have) continue;
      await db.insert(scheduledGrants).values({ email, credits, note: String(g?.note ?? "").slice(0, 200), grantAt, createdAt: now() });
      added++;
    }
    res.json({ added });
  });

  /**
   * A Pōstify plan given, not bought: active until `until`, with no card and
   * no extras billed (the cap is 0). Its monthly credits are scheduled grants.
   */
  app.post("/api/admin/postify/comp-plan", requireAdmin, async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const until = String(req.body?.until ?? "");
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !Number.isFinite(Date.parse(until))) return res.status(400).json({ message: "Whose plan, and until when?" });
    const existing = await storage.getSubscription(email);
    if (existing && existing.customerId && ["active", "trialing"].includes(existing.status)) return res.status(409).json({ message: "They already pay for a plan; leave it alone." });
    const row = await storage.upsertSubscription({ email, plan: "pro", status: "active", customerId: "", subscriptionId: `comp:${email}`, periodStart: now(), periodEnd: new Date(until).toISOString(), overageCapCents: 0, interval: "month" });
    res.json(row);
  });

  /**
   * Our sending domains in Resend, and adding one (news.militaryvoices.ai, for
   * bulk mail, so a newsletter can't hurt the sign-in codes). Returns the DNS
   * records to add at GoDaddy; `verify` asks Resend to check them.
   */
  const resend = async (path: string, init?: RequestInit) => {
    const key = process.env.RESEND_API_KEY;
    const proxy = process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
    const base = process.env.CUSTOM_CRED_API_RESEND_COM_URL || "https://api.resend.com";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`; else if (proxy) headers["x-api-key"] = proxy;
    const r = await fetch(`${base}${path}`, { ...init, headers });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  app.get("/api/admin/resend/domains", requireAdmin, async (req, res) => {
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    const list = await resend("/domains");
    const id = String(req.query.id ?? "");
    res.status(list.status < 400 ? 200 : list.status).json(id ? await resend(`/domains/${encodeURIComponent(id)}`) : list);
  });
  app.post("/api/admin/resend/domains", requireAdmin, async (req, res) => {
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    const name = String(req.body?.name ?? "").trim().toLowerCase();
    if (!/^[a-z0-9-]+\.militaryvoices\.ai$/.test(name)) return res.status(400).json({ message: "A subdomain of militaryvoices.ai, please." });
    const r = await resend("/domains", { method: "POST", body: JSON.stringify({ name, region: "us-east-1" }) });
    res.status(r.status).json(r.body);
  });
  app.post("/api/admin/resend/domains/:id/verify", requireAdmin, async (req, res) => {
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    const r = await resend(`/domains/${encodeURIComponent(String(req.params.id))}/verify`, { method: "POST" });
    res.status(r.status).json(r.body);
  });

  /** Every five minutes: send what's due, give what's due, end gifted plans that have run out. */
  const outboxCron: RequestHandler = async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    await schemaIsReady();
    const t = now();
    const due = await db.select().from(outboxMail).where(and(eq(outboxMail.status, "queued"), lte(outboxMail.sendAt, t))).orderBy(asc(outboxMail.sendAt)).limit(40);
    let sent = 0;
    for (const m of due) {
      // Claim it first, so two runs can't both send it.
      const [mine] = await db.update(outboxMail).set({ status: "sending" }).where(and(eq(outboxMail.id, m.id), eq(outboxMail.status, "queued"))).returning({ id: outboxMail.id });
      if (!mine) continue;
      try {
        const id = await sendOneOffEmail({ to: m.to, subject: m.subject, html: m.html, text: m.text, kind: m.kind, bcc: m.sender === "riccoh" ? bccFor("riccoh", m.to) : undefined });
        await db.update(outboxMail).set(id ? { status: "sent", sentAt: now() } : { status: "failed", error: "The mail service didn't take it." }).where(eq(outboxMail.id, m.id));
        if (id) sent++;
      } catch (err: any) {
        await db.update(outboxMail).set({ status: "failed", error: String(err?.message ?? err).slice(0, 300) }).where(eq(outboxMail.id, m.id));
      }
    }
    const grants = await db.select().from(scheduledGrants).where(and(eq(scheduledGrants.doneAt, ""), lte(scheduledGrants.grantAt, t))).limit(100);
    let given = 0;
    for (const g of grants) {
      await storage.addTokens({ email: g.email, delta: g.credits, reason: `Bonus credits: ${g.note || "a scheduled thank-you"}`, ref: `grant:${g.id}` });
      await db.update(scheduledGrants).set({ doneAt: now() }).where(eq(scheduledGrants.id, g.id));
      given++;
    }
    // A gifted plan ends on its date; a paid one is Stripe's to end.
    const ended = await db.update(postifySubscriptions).set({ status: "canceled", updatedAt: now() })
      .where(and(like(postifySubscriptions.subscriptionId, "comp:%"), eq(postifySubscriptions.status, "active"), lte(postifySubscriptions.periodEnd, t)))
      .returning({ id: postifySubscriptions.id });
    res.json({ sent, given, ended: ended.length });
  };
  app.get("/api/cron/outbox", outboxCron);
  app.post("/api/cron/outbox", outboxCron);
}
