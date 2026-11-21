/**
 * Founding Members 2026: Riccoh's three emails to the Marathon's podcasters (Andrew, 21 Nov 2026: "Yes, 3a, ok").
 *   1  "I'm letting you in first"  → whenever Andrew says
 *   2  the nudge                    → Wed 25 Nov 9:00 am ET, only if they haven't answered since email 1
 *   3  "Closing your account" (3a)  → Fri 27 Nov 8:00 am ET, the same test
 * From "Riccoh Player <hello@militaryvoices.ai>", blind-copied to Riccoh. They run on the 5-minute outbox cron
 * (outbox_mail kinds founding-marathon-1/2/3, sender "riccoh-named").
 *
 * Nothing is queued by code. POST /api/admin/promo/marathon/queue needs confirm = "andrew-ok" (his go on the exact
 * texts and the test send). Email 3 says the account will be closed and archived: NOTHING here archives anything.
 *
 * "Answered" = since email 1 went: wrote back, used a sign-in code, clicked their own link, started a plan, or
 * unsubscribed. Their own link is /go/bf?src=email-marathon-N&u=<opaque token> (no email in the URL).
 */
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, eq, gt, isNotNull, like } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { emailShell, sendOneOffEmail, bccFor } from "./email.js";
import { inboundEmails, loginTokens, outboxMail } from "../shared/schema.js";
import { PLANS } from "../shared/tokens.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
export const RICCOH_FROM = "Riccoh Player <hello@militaryvoices.ai>";
export const MARATHON_KIND = "founding-marathon-";
const HEADER = `${ORIGIN}/email/founding-hero.jpg`;

const scale = PLANS.creator;
const pro = PLANS.pro;
const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const OFFER = `Scale is free for your first 30 days, then ${money(scale.cents)} a month. You'll need a card at checkout, and if you cancel before day 30 you pay nothing.`;
const PRO_LINE = `Want more? Pro is in the offer too: 30 days free, then ${money(pro.quarterCents)} every 3 months, with ${pro.clipsPerEpisode} clips an episode instead of ${scale.clipsPerEpisode} and ${pro.credits} credits a month.`;
const GETS = [
  `Pōstify cuts ${scale.clipsPerEpisode} captioned clips from every episode, ready to post`,
  "Post to all your socials: Instagram, Facebook, YouTube, TikTok and LinkedIn",
  "Animated captions that light up each word",
  "A clean episode every time: ums and dead air taken out",
  `${scale.credits} Pōstify credits a month, yours on day 1`,
  "Your own Studio to record and go live with your guests",
];

type Para = string | string[];
export type MarathonStep = 1 | 2 | 3;
export const STEPS: Record<MarathonStep, { subject: string; preheader: string; heading: string; paras: Para[]; cta: string }> = {
  1: {
    subject: "I'm letting you in first",
    preheader: "Founding Members opens Black Friday. You're in before everyone else.",
    heading: "I'm letting you in first",
    paras: [
      "Hi {first},",
      "You were on the Marathon with us, so I'm letting you in before anyone else.",
      `Founding Members opens on Black Friday, and you can join today. ${OFFER}`,
      "What you get with Scale:",
      GETS,
      PRO_LINE,
      "Everyone who joins in 2026 is a Founding Member. The offer ends December 31, 2026.",
    ],
    cta: "Become a Founding Member",
  },
  2: {
    subject: "Your Founding Member spot is still open",
    preheader: "Scale free for 30 days. Before Thanksgiving, a quick reminder.",
    heading: "Your spot is still open",
    paras: [
      "Hi {first},",
      "A quick one before Thanksgiving. Your spot as a Founding Member is still open.",
      OFFER,
      "That's clips from every episode, posting to all your socials (Instagram, Facebook, YouTube, TikTok and LinkedIn), animated captions, a clean edit and your own Studio.",
      PRO_LINE,
      "Happy Thanksgiving to you and yours.",
    ],
    cta: "Become a Founding Member",
  },
  3: {
    subject: "Closing your account",
    preheader: "If you want to come back, just reply.",
    heading: "Closing your account",
    paras: [
      "Hi {first},",
      "I haven't heard back from you, and I understand you may have other options.",
      "So we'll close and archive your MilitaryVoices.ai account. If you'd like to come back, reply to this email and let us know.",
      `And if you'd rather stay as a Founding Member, today is Black Friday. ${OFFER}`,
      PRO_LINE,
      "Thank you for being on the Marathon.",
    ],
    cta: "Stay as a Founding Member",
  },
};

const secret = () => process.env.SESSION_SECRET || "mv-unsub-secret";
/** The same link /api/unsubscribe checks (routes.ts unsubscribeToken). */
const unsubscribeUrl = (email: string) => `${ORIGIN}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${crypto.createHmac("sha256", secret()).update(email.toLowerCase()).digest("hex").slice(0, 32)}`;
/** Opaque per-person token for their link; the email isn't in the URL. */
const personToken = (email: string) => crypto.createHmac("sha256", `${secret()}:mf`).update(email.toLowerCase()).digest("hex").slice(0, 16);
const linkFor = (step: MarathonStep, email: string) => `${ORIGIN}/go/bf?src=email-marathon-${step}&u=${personToken(email)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderMarathon(step: MarathonStep, to: string, first: string): { subject: string; html: string; text: string } {
  const d = STEPS[step];
  const name = first.trim() || "there";
  const fill = (s: string) => s.replaceAll("{first}", name);
  const href = linkFor(step, to);
  const unsub = unsubscribeUrl(to);
  const body = d.paras.map((p) => Array.isArray(p)
    ? `<ul style="margin:0 0 16px;padding-left:20px;">${p.map((l) => `<li style="margin:0 0 6px;">${esc(l)}</li>`).join("")}</ul>`
    : `<p style="margin:0 0 16px;">${esc(fill(p))}</p>`).join("\n");
  const html = emailShell({
    banner: HEADER, bannerAlt: "Black Friday Special: Founding Members 2026, 30 days free",
    eyebrow: "Founding Members 2026", heading: d.heading, body,
    cta: { href, label: d.cta },
    secondary: `<p style="margin:16px 0 0;">Semper Fi,<br>Riccoh Player</p>`,
    footerNote: `Questions? Reply to this email. · <a href="${unsub}" style="color:#6b7280;">Unsubscribe</a>`,
    preheader: d.preheader,
  });
  const text = [
    ...d.paras.flatMap((p) => (Array.isArray(p) ? [...p.map((l) => `- ${l}`), ""] : [fill(p), ""])),
    `${d.cta}: ${href}`, "", "Semper Fi,", "Riccoh Player", "", `Unsubscribe: ${unsub}`,
  ].join("\n");
  return { subject: d.subject, html, text };
}

/** /go/bf with their own token: note the click (a response, for the skip test). Called from promo.ts. */
export async function noteMarathonClick(token: string): Promise<void> {
  if (!/^[a-f0-9]{16}$/.test(token)) return;
  const email = await storage.getSetting(`mf-u:${token}`);
  if (email) await storage.setSetting(`mf-click:${email}`, new Date().toISOString());
}

/** From the outbox cron, just before a Marathon email goes: why not to send it, or null to send. */
export async function marathonSkip(toIn: string, kind: string): Promise<string | null> {
  const to = toIn.trim().toLowerCase();
  if ((await storage.listUnsubscribedEmails()).has(to)) return "Unsubscribed.";
  if (kind === `${MARATHON_KIND}1`) return null;
  const [first] = await db.select({ sentAt: outboxMail.sentAt }).from(outboxMail)
    .where(and(eq(outboxMail.to, to), eq(outboxMail.kind, `${MARATHON_KIND}1`), eq(outboxMail.status, "sent")));
  if (!first?.sentAt) return "Email 1 never went.";
  const since = first.sentAt;
  const [wrote] = await db.select({ id: inboundEmails.id }).from(inboundEmails).where(and(eq(inboundEmails.fromEmail, to), gt(inboundEmails.receivedAt, since))).limit(1);
  if (wrote) return "Wrote back.";
  const [signed] = await db.select({ id: loginTokens.id }).from(loginTokens).where(and(eq(loginTokens.email, to), isNotNull(loginTokens.usedAt), gt(loginTokens.usedAt, since))).limit(1);
  if (signed) return "Signed in.";
  const click = await storage.getSetting(`mf-click:${to}`);
  if (click && click > since) return "Clicked their link.";
  const sub = await storage.getSubscription(to);
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) return "On a plan.";
  return null;
}

export function registerMarathonFounding(app: Express, requireAdmin: RequestHandler): void {
  /** A preview of one email, as a given person would get it. */
  app.get("/api/admin/promo/marathon/preview", requireAdmin, (req, res) => {
    const step = (Number(req.query.step) || 1) as MarathonStep;
    if (!STEPS[step]) return res.status(400).send("Which email?");
    const r = renderMarathon(step, String(req.query.to || "preview@example.com"), String(req.query.first || "Laura"));
    res.type(req.query.text ? "text/plain" : "html").send(req.query.text ? `Subject: ${r.subject}\n\n${r.text}` : r.html);
  });

  /** One test, sent now, to an admin's own address only. */
  app.post("/api/admin/promo/marathon/test", requireAdmin, async (req, res) => {
    const step = (Number(req.body?.step) || 1) as MarathonStep;
    const to = String(req.body?.to ?? "").trim().toLowerCase();
    if (!STEPS[step]) return res.status(400).json({ message: "Which email?" });
    if (!(await storage.listAdmins()).some((a) => a.email.trim().toLowerCase() === to)) return res.status(400).json({ message: "A test goes to an admin's own address only." });
    const r = renderMarathon(step, to, String(req.body?.first ?? "") || "Andrew");
    const id = await sendOneOffEmail({ to, subject: `[Test] ${r.subject}`, html: r.html, text: r.text, from: RICCOH_FROM, kind: `${MARATHON_KIND}test` });
    res.json({ ok: Boolean(id), id });
  });

  /** Queue the three for a list of people. Needs Andrew's go: confirm = "andrew-ok". Re-running skips anyone already queued. */
  app.post("/api/admin/promo/marathon/queue", requireAdmin, async (req, res) => {
    if (req.body?.confirm !== "andrew-ok") return res.status(400).json({ message: "Only with Andrew's go on the exact texts and the test." });
    await schemaIsReady();
    const at = (k: string) => { const t = Date.parse(String(req.body?.[k] ?? "")); return Number.isFinite(t) ? new Date(t).toISOString() : ""; };
    const when: Record<MarathonStep, string> = { 1: at("step1At"), 2: at("step2At") || "2026-11-25T14:00:00.000Z", 3: at("step3At") || "2026-11-27T13:00:00.000Z" };
    if (!when[1]) return res.status(400).json({ message: "When does email 1 go? (step1At)" });
    const people = (Array.isArray(req.body?.recipients) ? req.body.recipients : [])
      .map((p: any) => ({ email: String(p?.email ?? "").trim().toLowerCase(), first: String(p?.first ?? "").trim() }))
      .filter((p: { email: string }) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email));
    const unsub = await storage.listUnsubscribedEmails();
    const created = new Date().toISOString();
    let queued = 0;
    const skipped: string[] = [];
    for (const p of people) {
      if (unsub.has(p.email)) { skipped.push(`${p.email}: unsubscribed`); continue; }
      const [had] = await db.select({ id: outboxMail.id }).from(outboxMail).where(and(eq(outboxMail.to, p.email), like(outboxMail.kind, `${MARATHON_KIND}%`), eq(outboxMail.status, "queued"))).limit(1);
      if (had) { skipped.push(`${p.email}: already queued`); continue; }
      await storage.setSetting(`mf-u:${personToken(p.email)}`, p.email);
      for (const step of [1, 2, 3] as MarathonStep[]) {
        const r = renderMarathon(step, p.email, p.first);
        await db.insert(outboxMail).values({ to: p.email, subject: r.subject, html: r.html, text: r.text, sender: "riccoh-named", kind: `${MARATHON_KIND}${step}`, sendAt: when[step], createdAt: created });
      }
      queued++;
    }
    await storage.setSetting("mf-audience", JSON.stringify({ at: created, people, when }));
    res.json({ queued, skipped, when });
  });

  /** Where each one stands. */
  app.get("/api/admin/promo/marathon", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select({ id: outboxMail.id, to: outboxMail.to, kind: outboxMail.kind, sendAt: outboxMail.sendAt, status: outboxMail.status, sentAt: outboxMail.sentAt, error: outboxMail.error })
      .from(outboxMail).where(like(outboxMail.kind, `${MARATHON_KIND}%`));
    res.json({ rows });
  });
}

/** For the outbox cron. */
export const senderFrom = (sender: string): string | undefined => (sender === "riccoh-named" ? RICCOH_FROM : undefined);
export const bccForSender = (sender: string, to: string): string[] | undefined => bccFor(sender === "riccoh-named" ? "riccoh" : sender, to);
