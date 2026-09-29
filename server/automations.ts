// Automations: a series of emails each person gets on their own clock (a welcome series, say).
// Someone joins when they do something (make an account, a SmartLink, a show, join Discovery,
// book a slot, get a tag) after the automation was switched on, or when the team adds them.
// A cron walks the due ones every 15 minutes. Stops for anyone who unsubscribes, and (by
// default) for anyone who writes back.
import type { Express, Request, RequestHandler } from "express";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { sendBroadcastEmail } from "./email.js";
import {
  automations, automationSteps, automationRuns, automationSends, bioPages, broadcastEvents, contacts, discoveryMembers,
  hostedShows, inboundEmails, podcasterProfiles, signups,
  type AutomationRow, type AutomationStepRow,
} from "../shared/schema.js";

const SITE = "https://www.militaryvoices.ai";
const HOUSE = new Set(["hello@militaryvoice.ai", "hello@militaryvoices.ai"]);
const now = () => new Date().toISOString();
const inHours = (h: number, from = Date.now()) => new Date(from + Math.max(0, h) * 3600_000).toISOString();
const firstWord = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";
const norm = (e: string) => e.trim().toLowerCase();

type Deps = {
  unsubscribeUrl: (req: Request, email: string) => string;
  resolveRecipients: (segment: string, eventId: number | null) => Promise<{ email: string; firstName: string }[]>;
};

type StepInput = { delayHours: number; subject: string; preheader?: string; bodyText: string; sender?: string; banner?: string };

/** Ready-made series. Every email is the team's to edit before switching it on. */
export const RECIPES: Record<string, { name: string; trigger: string; steps: StepInput[] }> = {
  welcome: {
    name: "Welcome series",
    trigger: "account",
    steps: [
      {
        delayHours: 0, banner: "welcome",
        subject: "Welcome to MilitaryVoices.ai, {{First_Name}}",
        preheader: "Here's what you can do first, and it's all free",
        bodyText: "Hi {{First_Name}},\n\nWelcome aboard. MilitaryVoices.ai is built for military and veteran creators, and everything below is free.\n\n- **Your SmartLink:** one link for your bio, with your podcast, videos and a way to collect emails\n- **Podcast hosting:** your show, your feed, every directory\n- **Discovery:** find guests to book, and shows to be a guest on\n\n[[Open my dashboard]](https://www.militaryvoices.ai/host/dashboard)\n\nReply to this email if you get stuck. A real person reads every one.",
      },
      {
        delayHours: 48, banner: "podcasters",
        subject: "Your SmartLink in five minutes",
        preheader: "One link for your bio that does the work for you",
        bodyText: "Hi {{First_Name}},\n\nYour SmartLink is the one link to put in every bio. It shows your latest episode, your videos and your socials, and it collects emails from the people who want more.\n\n[[Make my SmartLink]](https://www.militaryvoices.ai/host/dashboard/page)\n\n> Tip: add a Stay in touch block. Every sign-up is someone you can reach without an algorithm in the way.",
      },
      {
        delayHours: 72, banner: "mic",
        subject: "Host your podcast free, on every app",
        preheader: "Bring your show over in a few minutes, and nothing breaks",
        bodyText: "Hi {{First_Name}},\n\nWe host podcasts for free: your feed, your episodes and your listing on Apple, Spotify and the rest.\n\nAlready hosted somewhere else? Paste your feed and we copy your episodes across. Your listeners won't notice a thing.\n\n[[Set up my podcast]](https://www.militaryvoices.ai/host/dashboard/podcast)",
      },
      {
        delayHours: 96, banner: "board",
        subject: "One episode, a week of posts",
        preheader: "Pōstify cuts the clips and writes the captions for you",
        bodyText: "Hi {{First_Name}},\n\nPōstify turns one episode into short clips with captions for YouTube, Instagram, TikTok and LinkedIn, and can post them for you.\n\nYour first episode is on us.\n\n[[Try Pōstify]](https://www.militaryvoices.ai/host/dashboard/postify)",
      },
    ],
  },
  smartlink: {
    name: "New SmartLink tips",
    trigger: "smartlink",
    steps: [
      {
        delayHours: 1, banner: "podcasters",
        subject: "Your SmartLink is live. Three places to put it",
        preheader: "Instagram, YouTube and your email signature",
        bodyText: "Hi {{First_Name}},\n\nNice work, your SmartLink is up. It only works if people see it, so put it in these three places today:\n\n1. Your Instagram and TikTok bio\n2. The description of every YouTube video\n3. Your email signature\n\n[[Open my SmartLink]](https://www.militaryvoices.ai/host/dashboard/page)",
      },
      {
        delayHours: 72, banner: "conversation",
        subject: "Turn visitors into a list you own",
        preheader: "Add a Stay in touch block in one click",
        bodyText: "Hi {{First_Name}},\n\nMost people who visit your SmartLink will never come back on their own. A Stay in touch block asks for their first name and email, so you can tell them when the next episode is out.\n\n[[Add Stay in touch]](https://www.militaryvoices.ai/host/dashboard/page)",
      },
    ],
  },
  discovery: {
    name: "Discovery welcome",
    trigger: "discovery",
    steps: [
      {
        delayHours: 0, banner: "conversation",
        subject: "How to find your next guest",
        preheader: "Search by topic and see who's booked most",
        bodyText: "Hi {{First_Name}},\n\nWelcome to Discovery. Two things most people do first:\n\n- **Book a guest:** search a topic and see who's been on the most shows\n- **Be a guest:** find shows that take guests, and have AI write your pitch\n\n[[Open Discovery]](https://www.militaryvoices.ai/host/dashboard/discovery)",
      },
    ],
  },
  blank: { name: "New automation", trigger: "manual", steps: [{ delayHours: 0, subject: "", bodyText: "Hi {{First_Name}},\n\n" }] },
};

/** People who did the trigger since `since`: email and a first name where we have one. */
async function startersSince(trigger: string, since: string): Promise<{ email: string; firstName: string }[]> {
  switch (trigger) {
    case "account":
      return (await db.select({ email: podcasterProfiles.email, name: podcasterProfiles.hostName }).from(podcasterProfiles).where(gte(podcasterProfiles.createdAt, since)))
        .map((r) => ({ email: r.email, firstName: firstWord(r.name) }));
    case "smartlink":
      return (await db.select({ email: bioPages.email, name: bioPages.displayName }).from(bioPages).where(gte(bioPages.createdAt, since)))
        .map((r) => ({ email: r.email, firstName: firstWord(r.name) }));
    case "podcast":
      return (await db.select({ email: hostedShows.email, owner: hostedShows.ownerEmail }).from(hostedShows).where(gte(hostedShows.createdAt, since)))
        .map((r) => ({ email: r.owner || r.email, firstName: "" }));
    case "discovery":
      return (await db.select({ email: discoveryMembers.email }).from(discoveryMembers).where(gte(discoveryMembers.createdAt, since)))
        .map((r) => ({ email: r.email, firstName: "" }));
    case "slot":
      return (await db.select({ email: signups.email, name: signups.hostName }).from(signups).where(and(gte(signups.createdAt, since), eq(signups.status, "confirmed"))))
        .map((r) => ({ email: r.email, firstName: firstWord(r.name) }));
    case "contact":
      return (await db.select({ email: contacts.email, name: contacts.firstName }).from(contacts).where(and(gte(contacts.importedAt, since), eq(contacts.status, "active"))))
        .map((r) => ({ email: r.email, firstName: r.name }));
    default:
      return []; // tag:* joins from the tag editor; manual from "Add people"
  }
}

async function stepsOf(automationId: number): Promise<AutomationStepRow[]> {
  return db.select().from(automationSteps).where(eq(automationSteps.automationId, automationId)).orderBy(asc(automationSteps.position), asc(automationSteps.id));
}

/** Add people to one automation. Anyone already in it (now or before) is skipped. */
async function enroll(a: AutomationRow, people: { email: string; firstName: string }[]): Promise<number> {
  const steps = await stepsOf(a.id);
  if (!steps.length || !people.length) return 0;
  const seen = new Set((await db.select({ email: automationRuns.email }).from(automationRuns).where(eq(automationRuns.automationId, a.id))).map((r) => norm(r.email)));
  const t = now();
  const rows = [];
  for (const p of people) {
    const email = norm(p.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || HOUSE.has(email) || seen.has(email)) continue;
    seen.add(email);
    rows.push({ automationId: a.id, email, firstName: (p.firstName ?? "").trim().slice(0, 60), enrolledAt: t, nextAt: inHours(steps[0].delayHours) });
  }
  if (rows.length) await db.insert(automationRuns).values(rows);
  return rows.length;
}

/** A tag (or any other trigger) happened to one person: join every automation that's on for it. */
export async function enrollByTrigger(trigger: string, email: string, firstName = ""): Promise<void> {
  try {
    await schemaIsReady();
    const list = await db.select().from(automations).where(and(eq(automations.trigger, trigger), eq(automations.status, "on")));
    for (const a of list) await enroll(a, [{ email, firstName }]);
  } catch (err) {
    console.error("Automation enroll failed:", (err as Error).message);
  }
}

async function isUnsubscribed(email: string): Promise<boolean> {
  const [c] = await db.select({ status: contacts.status }).from(contacts).where(eq(sql`lower(${contacts.email})`, email)).limit(1);
  return !!c && c.status === "unsubscribed";
}
async function repliedSince(email: string, since: string): Promise<boolean> {
  const [m] = await db.select({ id: inboundEmails.id }).from(inboundEmails).where(and(eq(sql`lower(${inboundEmails.fromEmail})`, email), gte(inboundEmails.receivedAt, since))).limit(1);
  return !!m;
}

async function sendStep(step: AutomationStepRow, to: string, firstName: string, unsubscribeUrl: string, test = false): Promise<string | null> {
  const senderMember = step.sender.startsWith("member:") ? await storage.getTeamMember(Number(step.sender.split(":")[1])) : null;
  return sendBroadcastEmail({
    to,
    firstName: firstName || (test ? "Sam" : ""),
    subject: test ? `[TEST] ${step.subject}` : step.subject,
    bodyText: step.bodyText,
    preheader: step.preheader,
    unsubscribeUrl,
    sender: step.sender,
    banner: step.banner,
    senderMember: senderMember ?? undefined,
    kind: test ? "automation-test" : `automation:${step.automationId}`,
  });
}

/** One pass: bring in new starters, then send whatever is due. */
async function runOnce(req: Request, deps: Deps): Promise<{ enrolled: number; sent: number; stopped: number; failed: number }> {
  await schemaIsReady();
  let enrolled = 0, sent = 0, stopped = 0, failed = 0;
  const on = await db.select().from(automations).where(eq(automations.status, "on"));
  for (const a of on) {
    if (!a.startedAt) continue;
    enrolled += await enroll(a, await startersSince(a.trigger, a.startedAt));
  }
  if (!on.length) return { enrolled, sent, stopped, failed };

  const byId = new Map(on.map((a) => [a.id, a]));
  const due = await db.select().from(automationRuns)
    .where(and(eq(automationRuns.status, "active"), lte(automationRuns.nextAt, now()), inArray(automationRuns.automationId, on.map((a) => a.id))))
    .orderBy(asc(automationRuns.nextAt)).limit(300);
  const stepCache = new Map<number, AutomationStepRow[]>();
  for (const run of due) {
    // Claimed first, so two passes at once can't both send it.
    const [mine] = await db.update(automationRuns).set({ nextAt: "9999" }).where(and(eq(automationRuns.id, run.id), eq(automationRuns.nextAt, run.nextAt))).returning({ id: automationRuns.id });
    if (!mine) continue;
    const a = byId.get(run.automationId)!;
    const end = async (reason: string) => { await db.update(automationRuns).set({ status: reason === "finished" ? "done" : "stopped", endReason: reason, endedAt: now(), nextAt: "" }).where(eq(automationRuns.id, run.id)); };
    if (await isUnsubscribed(run.email)) { await end("unsubscribed"); stopped++; continue; }
    if (a.stopOnReply && (await repliedSince(run.email, run.enrolledAt))) { await end("replied"); stopped++; continue; }
    if (!stepCache.has(a.id)) stepCache.set(a.id, await stepsOf(a.id));
    const steps = stepCache.get(a.id)!;
    let i = run.stepIndex;
    while (steps[i] && (!steps[i].subject.trim() || !steps[i].bodyText.trim())) i++; // an unwritten email is skipped, not sent blank
    const step = steps[i];
    if (!step) { await end("finished"); continue; }
    const resendId = await sendStep(step, run.email, run.firstName, deps.unsubscribeUrl(req, run.email)).catch(() => null);
    if (!resendId) {
      // Try again in an hour; the provider being down shouldn't lose anyone their email.
      await db.update(automationRuns).set({ nextAt: inHours(1) }).where(eq(automationRuns.id, run.id));
      failed++;
      continue;
    }
    sent++;
    await db.insert(automationSends).values({ runId: run.id, automationId: a.id, stepId: step.id, email: run.email, resendId, sentAt: now() });
    const next = steps[i + 1];
    if (next) await db.update(automationRuns).set({ stepIndex: i + 1, nextAt: inHours(next.delayHours) }).where(eq(automationRuns.id, run.id));
    else { await db.update(automationRuns).set({ stepIndex: i + 1 }).where(eq(automationRuns.id, run.id)); await end("finished"); }
  }
  return { enrolled, sent, stopped, failed };
}

/** Sent, opened and clicked, for a set of sends. */
async function fates(automationId: number) {
  const sends = await db.select({ stepId: automationSends.stepId, resendId: automationSends.resendId }).from(automationSends).where(eq(automationSends.automationId, automationId));
  const ids = sends.map((s) => s.resendId).filter(Boolean);
  const events = ids.length ? await db.select({ resendId: broadcastEvents.resendId, type: broadcastEvents.eventType }).from(broadcastEvents).where(inArray(broadcastEvents.resendId, ids)) : [];
  const opened = new Set(events.filter((e) => e.type === "opened" || e.type === "clicked").map((e) => e.resendId));
  const clicked = new Set(events.filter((e) => e.type === "clicked").map((e) => e.resendId));
  const per = new Map<number, { sent: number; opened: number; clicked: number }>();
  for (const s of sends) {
    const p = per.get(s.stepId) ?? { sent: 0, opened: 0, clicked: 0 };
    p.sent++;
    if (opened.has(s.resendId)) p.opened++;
    if (clicked.has(s.resendId)) p.clicked++;
    per.set(s.stepId, p);
  }
  const total = { sent: sends.length, opened: sends.filter((s) => opened.has(s.resendId)).length, clicked: sends.filter((s) => clicked.has(s.resendId)).length };
  return { per, total };
}

async function people(automationId: number) {
  const rows = await db.select({ status: automationRuns.status, n: sql<number>`count(*)::int` }).from(automationRuns).where(eq(automationRuns.automationId, automationId)).groupBy(automationRuns.status);
  const c = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { active: c("active"), done: c("done"), stopped: c("stopped") };
}

function cleanStep(s: any, i: number) {
  return {
    position: i,
    delayHours: Math.min(24 * 365, Math.max(0, Math.round(Number(s?.delayHours) || 0))),
    subject: String(s?.subject ?? "").trim().slice(0, 200),
    preheader: String(s?.preheader ?? "").trim().slice(0, 200),
    bodyText: String(s?.bodyText ?? "").slice(0, 50000),
    sender: /^(team|member:\d+)$/.test(String(s?.sender)) ? String(s.sender) : "team",
    banner: String(s?.banner ?? "welcome").replace(/[^a-z-]/g, "").slice(0, 30) || "welcome",
  };
}

export function registerAutomations(app: Express, requireAdmin: RequestHandler, deps: Deps) {
  const cron: RequestHandler = async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (secret && auth !== secret) return res.status(401).json({ message: "Not authorised." });
    try { res.json(await runOnce(req, deps)); } catch (err) { console.error("Automations run failed:", err); res.status(500).json({ message: (err as Error).message }); }
  };
  app.get("/api/cron/automations", cron);

  app.get("/api/admin/automations", requireAdmin, async (_req, res) => {
    await schemaIsReady();
    const list = await db.select().from(automations).orderBy(desc(automations.createdAt));
    res.json(await Promise.all(list.map(async (a) => ({
      ...a,
      steps: (await stepsOf(a.id)).length,
      people: await people(a.id),
      stats: (await fates(a.id)).total,
    }))));
  });

  app.post("/api/admin/automations", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const recipe = RECIPES[String(req.body?.recipe ?? "blank")] ?? RECIPES.blank;
    const t = now();
    const [a] = await db.insert(automations).values({ name: recipe.name, trigger: recipe.trigger, createdAt: t, updatedAt: t }).returning();
    await db.insert(automationSteps).values(recipe.steps.map((s, i) => ({ ...cleanStep(s, i), automationId: a.id })));
    res.json(a);
  });

  app.get("/api/admin/automations/:id", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const id = Number(req.params.id);
    const [a] = await db.select().from(automations).where(eq(automations.id, id));
    if (!a) return res.status(404).json({ message: "Not found." });
    const steps = await stepsOf(id);
    const f = await fates(id);
    // Where everyone is: how many are waiting for each email.
    const waiting = await db.select({ stepIndex: automationRuns.stepIndex, n: sql<number>`count(*)::int` }).from(automationRuns).where(and(eq(automationRuns.automationId, id), eq(automationRuns.status, "active"))).groupBy(automationRuns.stepIndex);
    const runs = await db.select().from(automationRuns).where(eq(automationRuns.automationId, id)).orderBy(desc(automationRuns.enrolledAt)).limit(100);
    res.json({
      ...a,
      steps: steps.map((s, i) => ({ ...s, stats: f.per.get(s.id) ?? { sent: 0, opened: 0, clicked: 0 }, waiting: waiting.find((w) => w.stepIndex === i)?.n ?? 0 })),
      people: await people(id),
      stats: f.total,
      runs,
    });
  });

  app.put("/api/admin/automations/:id", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const id = Number(req.params.id);
    const patch: Partial<AutomationRow> = { updatedAt: now() };
    if (typeof req.body?.name === "string") patch.name = req.body.name.trim().slice(0, 120) || "Automation";
    if (typeof req.body?.trigger === "string" && /^(account|smartlink|podcast|discovery|slot|contact|manual|tag:[a-z0-9 ._-]{1,30})$/.test(req.body.trigger)) patch.trigger = req.body.trigger;
    if (typeof req.body?.stopOnReply === "boolean") patch.stopOnReply = req.body.stopOnReply;
    const [a] = await db.update(automations).set(patch).where(eq(automations.id, id)).returning();
    if (!a) return res.status(404).json({ message: "Not found." });
    // The emails, in order: replaced as a set, keeping ids where they came back so stats stay with them.
    if (Array.isArray(req.body?.steps)) {
      const given = req.body.steps as any[];
      const old = await stepsOf(id);
      const keep = new Set<number>();
      for (let i = 0; i < given.length; i++) {
        const v = cleanStep(given[i], i);
        const sid = Number(given[i]?.id);
        if (sid && old.some((o) => o.id === sid)) { keep.add(sid); await db.update(automationSteps).set(v).where(eq(automationSteps.id, sid)); }
        else await db.insert(automationSteps).values({ ...v, automationId: id });
      }
      const gone = old.filter((o) => !keep.has(o.id)).map((o) => o.id);
      if (gone.length) await db.delete(automationSteps).where(inArray(automationSteps.id, gone));
    }
    res.json(a);
  });

  /** On (from now: nobody from before joins) or off (everyone in it waits where they are). */
  app.post("/api/admin/automations/:id/status", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const id = Number(req.params.id);
    const turnOn = !!req.body?.on;
    if (turnOn) {
      const ready = (await stepsOf(id)).filter((s) => s.subject.trim() && s.bodyText.trim());
      if (!ready.length) return res.status(400).json({ message: "Write at least one email first." });
    }
    const [a] = await db.update(automations).set(turnOn ? { status: "on", startedAt: now(), updatedAt: now() } : { status: "off", updatedAt: now() }).where(eq(automations.id, id)).returning();
    if (!a) return res.status(404).json({ message: "Not found." });
    res.json(a);
  });

  app.delete("/api/admin/automations/:id", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const id = Number(req.params.id);
    const [a] = await db.select().from(automations).where(eq(automations.id, id));
    if (!a) return res.status(404).json({ message: "Not found." });
    if (a.status === "on") return res.status(409).json({ message: "Switch it off first." });
    await db.delete(automationSteps).where(eq(automationSteps.automationId, id));
    await db.delete(automationRuns).where(eq(automationRuns.automationId, id));
    await db.delete(automations).where(eq(automations.id, id));
    res.json({ ok: true });
  });

  /** Put a list (or tagged people) into it now. Only while it's on, so nobody sits in a paused series. */
  app.post("/api/admin/automations/:id/enroll", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const id = Number(req.params.id);
    const [a] = await db.select().from(automations).where(eq(automations.id, id));
    if (!a) return res.status(404).json({ message: "Not found." });
    if (a.status !== "on") return res.status(409).json({ message: "Switch it on first." });
    const list: { email: string; firstName: string }[] = [];
    if (typeof req.body?.email === "string") list.push({ email: req.body.email, firstName: String(req.body.firstName ?? "") });
    if (typeof req.body?.segment === "string") list.push(...(await deps.resolveRecipients(req.body.segment, req.body.eventId ? Number(req.body.eventId) : null)));
    const added = await enroll(a, list);
    // The first email may be due now: don't make them wait for the next pass.
    await runOnce(req, deps).catch(() => undefined);
    res.json({ added });
  });

  app.post("/api/admin/automations/:id/runs/:runId/stop", requireAdmin, async (req, res) => {
    await schemaIsReady();
    await db.update(automationRuns).set({ status: "stopped", endReason: "removed", endedAt: now(), nextAt: "" }).where(and(eq(automationRuns.id, Number(req.params.runId)), eq(automationRuns.automationId, Number(req.params.id))));
    res.json({ ok: true });
  });

  /** The whole series (or one email, as it stands in the editor) to whoever's signed in. */
  app.post("/api/admin/automations/:id/test", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const to = getAdminEmail(req) || process.env.SIGNUP_NOTIFY_EMAIL || "";
    if (!to) return res.status(400).json({ message: "Sign in again, then try." });
    const id = Number(req.params.id);
    const draft = req.body?.draft;
    const steps: AutomationStepRow[] = draft
      ? [{ ...cleanStep(draft, 0), id: 0, automationId: id } as AutomationStepRow]
      : (await stepsOf(id)).filter((s) => s.subject.trim() && s.bodyText.trim());
    let ok = true;
    for (const s of steps) ok = !!(await sendStep(s, to, "", `${SITE}/unsubscribe?test=1`, true)) && ok;
    res.json({ ok, to, count: steps.length });
  });
}
