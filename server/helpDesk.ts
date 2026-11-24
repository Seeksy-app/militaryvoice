// Alex's "hold on, let me check" (Andrew, 20 Nov 2026: "If Alex doesn't know the answer she will ask you
// in Claude Code session, and can also text me or slack me"). When the Help chat would hand off, the
// question goes into help_questions and the team hears at once: Slack, a text to the help-desk phone
// (setting help-desk:phone), and the admin queue a Claude Code session watches. The first answer wins
// and shows in the visitor's chat (it polls GET /api/help/question/:token every few seconds). No answer
// in 5 minutes: the chat says someone will get back to them and offers the usual email form.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { slackNote } from "./slack.js";
import { onTextReply, sendSms, toE164 } from "./sms.js";
import { helpQuestions, inboundEmails, podcasterProfiles, type HelpQuestionRow } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
export const WAIT_MS = 5 * 60_000;
const PHONE_SETTING = "help-desk:phone";
const deskLink = (id: number) => `${ORIGIN}/admin/help-desk?q=${id}`;
const short = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The phone that gets "Alex needs help" texts (set on the help desk page; never in code). */
export async function deskPhone(): Promise<string> {
  return toE164((await storage.getSetting(PHONE_SETTING)) ?? "");
}

// What the team taught Alex (PM for Andrew, 20 Nov: "Alex learns it"): every answered question is kept
// here and read on every chat, so next time she answers it herself. Edit or delete on /admin/help-desk.
const LEARNED_SETTING = "help-learned";
const LEARNED_MAX = 150;
export type Learned = { id: string; q: string; a: string; at: string; by: string };
export async function listLearned(): Promise<Learned[]> {
  try { const v = JSON.parse((await storage.getSetting(LEARNED_SETTING)) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
const saveLearned = (items: Learned[]) => storage.setSetting(LEARNED_SETTING, JSON.stringify(items.slice(-LEARNED_MAX)));
async function learn(q: string, a: string, by: string): Promise<void> {
  const items = await listLearned();
  items.push({ id: crypto.randomBytes(6).toString("hex"), q: q.slice(0, 600), a: a.slice(0, 2000), at: now(), by });
  await saveLearned(items);
}
/** For Alex's system prompt: the team's answers, newest last. Empty when there are none. */
export async function learnedForAlex(): Promise<string> {
  const items = await listLearned();
  if (!items.length) return "";
  return `TEAM ANSWERS (the team answered these for visitors before; they are true, use them when the same question comes up, in your own words):\n${items.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")}`;
}

/** Past its 5 minutes with no answer: timed out, and into Mail as Needs a reply. Returns the row as it now stands. */
async function settle(q: HelpQuestionRow): Promise<HelpQuestionRow> {
  if (q.status !== "open" || Date.now() - Date.parse(q.createdAt) < WAIT_MS) return q;
  const [out] = await db.update(helpQuestions).set({ status: "timed_out" }).where(and(eq(helpQuestions.id, q.id), eq(helpQuestions.status, "open"))).returning();
  if (out) await fileInMail(out).catch((e) => console.error("[help-desk] file in Mail", e));
  return out ?? (await db.select().from(helpQuestions).where(eq(helpQuestions.id, q.id)))[0];
}

// A question nobody answered in time goes to Admin → CRM → Mail as Needs a reply (PM for Andrew, 24 Nov: "Yes, fix it";
// Daniel Flint's #4 sat unseen for hours). One Mail row per question, keyed resend_id = "help-q:<id>". It files as
// "Help chat" like the email form does, so a reply to that person (Mail, a one-off, Chat with Alex) answers and
// archives it (clearWaiting). Nothing is sent to them from here.
export const helpKey = (id: number) => `help-q:${id}`;
const RECENT_MS = 2 * 3600_000;
/** The same question from this person, still waiting in Mail from the last two hours (the email form or a timed-out chat). */
export async function waitingHelpRow(email: string, question: string) {
  const qn = question.replace(/\s+/g, " ").trim();
  if (!qn) return null;
  const rows = await db.select().from(inboundEmails).where(and(
    eq(sql`lower(${inboundEmails.fromEmail})`, email.trim().toLowerCase()), eq(inboundEmails.toAddr, "Help chat"),
    inArray(inboundEmails.status, ["new", "drafted"]), eq(inboundEmails.archived, false),
    gte(inboundEmails.receivedAt, new Date(Date.now() - RECENT_MS).toISOString()),
  )).orderBy(desc(inboundEmails.id)).limit(10);
  return rows.find((r) => r.bodyText.replace(/\s+/g, " ").trim().startsWith(qn)) ?? null;
}
function chatText(turnsJson: string): string {
  try {
    const turns = JSON.parse(turnsJson) as { role: string; content: string }[];
    return turns.map((t) => `${t.role === "assistant" ? "Alex" : "Them"}: ${t.content}`).join("\n");
  } catch { return ""; }
}
export async function fileInMail(q: HelpQuestionRow, done?: { at: string; by: string; text: string; resendId: string }): Promise<number | null> {
  const email = q.email.trim().toLowerCase();
  if (!/^[^@\s:<>]+@[^@\s:<>]+\.[^@\s:<>]+$/.test(email)) return null; // no address, nobody to write back to
  const [have] = await db.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.resendId, helpKey(q.id))).limit(1);
  if (have) return have.id;
  if (!done && (await waitingHelpRow(email, q.question))) return null; // they already sent it with the email form: that row stands for it
  const [p] = await db.select({ name: podcasterProfiles.hostName }).from(podcasterProfiles).where(eq(sql`lower(${podcasterProfiles.email})`, email)).limit(1);
  const question = q.question.replace(/\s+/g, " ").trim();
  const row = await storage.createInbound({
    resendId: helpKey(q.id), messageId: "", fromEmail: email, fromName: p?.name?.trim() ?? "", toAddr: "Help chat",
    subject: `Your question: ${question.slice(0, 70)}${question.length > 70 ? "…" : ""}`,
    bodyText: `${q.question}\n\n(Asked Ask Alex${q.page ? ` on ${q.page}` : ""}. Alex didn't know, and nobody answered on the help desk within ${WAIT_MS / 60_000} minutes.)\n\nThe chat:\n${chatText(q.turns)}`,
    receivedAt: q.createdAt, broadcastId: null, category: "question", summary: short(question, 140),
    draftFrom: "team", draftSubject: "", draftText: "",
    status: done ? "sent" : "new", repliedAt: done?.at ?? null, replyResendId: done?.resendId ?? "", replyFrom: done?.by ?? "", replyText: done?.text ?? "",
    ackAt: null, ackResendId: "", ackText: "",
    ...(done ? { archived: true, readAt: done.at } : {}),
  });
  return row.id;
}

/** Every open question past its 5 minutes, settled (and so filed). The chat may have closed, so nothing else would. */
export async function sweepHelpQuestions(): Promise<number> {
  await schemaIsReady();
  const stale = await db.select().from(helpQuestions).where(and(eq(helpQuestions.status, "open"), lte(helpQuestions.createdAt, new Date(Date.now() - WAIT_MS).toISOString())));
  for (const q of stale) await settle(q);
  return stale.length;
}

/** A question Alex couldn't answer: saved, and the team pinged everywhere at once. */
export async function openQuestion(o: { turns: { role: string; content: string }[]; page: string; email: string }): Promise<HelpQuestionRow> {
  await schemaIsReady();
  const lastUser = [...o.turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const [q] = await db.insert(helpQuestions).values({
    token: crypto.randomBytes(16).toString("base64url"),
    question: lastUser.slice(0, 2000),
    turns: JSON.stringify(o.turns.slice(-6).map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }))),
    page: o.page.slice(0, 300),
    email: o.email.slice(0, 200),
    createdAt: now(),
  }).returning();
  const line = `Alex needs help: "${short(q.question, 140)}"`;
  // All at once, and the chat doesn't wait on any of them.
  await Promise.allSettled([
    slackNote(`:sos: ${line}${q.email ? ` (${q.email})` : ""}${q.page ? ` on ${q.page}` : ""}`, { label: "Answer it", url: deskLink(q.id) }, "helpdesk"),
    (async () => {
      const phone = await deskPhone();
      if (phone) await sendSms({ phone, body: `${line} Answer: ${deskLink(q.id)} (or reply to this text)`, name: "Help desk", sentBy: "help-desk" });
    })(),
  ]);
  return q;
}

/** The first answer wins. A late one (after the 5 minutes) is kept on the row, not shown. */
async function answer(id: number, text: string, by: string): Promise<HelpQuestionRow | null> {
  const [q] = await db.select().from(helpQuestions).where(eq(helpQuestions.id, id)).limit(1);
  if (!q || q.answer) return null;
  const cur = await settle(q);
  const [out] = await db.update(helpQuestions).set({ answer: text.slice(0, 4000), answeredBy: by, answeredAt: now(), ...(cur.status === "open" ? { status: "answered" } : {}) })
    .where(and(eq(helpQuestions.id, id), eq(helpQuestions.answer, ""))).returning();
  if (out && out.question) await learn(out.question, out.answer, by).catch((e) => console.error("[help-desk] learn", e));
  return out ?? null;
}

const adminView = (q: HelpQuestionRow) => {
  let turns: unknown = [];
  try { turns = JSON.parse(q.turns); } catch { /* keep [] */ }
  return { id: q.id, question: q.question, turns, page: q.page, email: q.email, status: q.status, answer: q.answer, answeredBy: q.answeredBy, answeredAt: q.answeredAt, createdAt: q.createdAt, late: q.status === "timed_out" && !!q.answer };
};

export function registerHelpDesk(app: Express, requireAdmin: RequestHandler): void {
  app.get("/api/cron/help-desk", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    try { res.json({ settled: await sweepHelpQuestions() }); } catch (err) { console.error("[help-desk] sweep", err); res.status(500).json({ message: (err as Error).message }); }
  });

  /** The visitor's chat, every few seconds: still checking, the answer, or timed out. */
  app.get("/api/help/question/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const [row] = await db.select().from(helpQuestions).where(eq(helpQuestions.token, String(req.params.token))).limit(1);
    if (!row) return res.status(404).json({ message: "Not found." });
    const q = await settle(row);
    res.json({ status: q.status, answer: q.status === "answered" ? q.answer : "", question: q.question, email: q.email });
  });

  /** The queue: open ones first (oldest first), or by status. Timed-out ones are settled on the way. */
  app.get("/api/admin/help/questions", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const status = String(req.query.status ?? "");
    const open = await db.select().from(helpQuestions).where(eq(helpQuestions.status, "open"));
    await Promise.all(open.map(settle));
    const rows = ["open", "answered", "timed_out"].includes(status)
      ? await db.select().from(helpQuestions).where(eq(helpQuestions.status, status)).orderBy(status === "open" ? helpQuestions.id : desc(helpQuestions.id)).limit(100)
      : await db.select().from(helpQuestions).orderBy(desc(helpQuestions.id)).limit(60);
    res.json({ questions: rows.map(adminView), waitSec: WAIT_MS / 1000, phoneSet: !!(await deskPhone()) });
  });

  app.post("/api/admin/help/questions/:id/answer", requireAdmin, async (req, res) => {
    const text = String(req.body?.answer ?? "").trim();
    if (!text) return res.status(400).json({ message: "Write the answer first." });
    // Andrew is the one who answers (20 Nov): the admin page, his text reply, or the PM relaying his exact words.
    const by = String(req.body?.by ?? "").trim().slice(0, 60) || "andrew";
    const out = await answer(Number(req.params.id), text, by);
    if (!out) return res.status(409).json({ message: "Someone answered it already." });
    res.json({ question: adminView(out), shown: out.status === "answered" });
  });

  /** What Alex has learned from the team's answers. */
  app.get("/api/admin/help/learned", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: (await listLearned()).reverse() });
  });
  app.put("/api/admin/help/learned/:id", requireAdmin, async (req, res) => {
    const q = String(req.body?.q ?? "").trim(), a = String(req.body?.a ?? "").trim();
    if (!q || !a) return res.status(400).json({ message: "Both the question and the answer are needed." });
    const items = await listLearned();
    const it = items.find((x) => x.id === req.params.id);
    if (!it) return res.status(404).json({ message: "Not found." });
    it.q = q.slice(0, 600); it.a = a.slice(0, 2000);
    await saveLearned(items);
    res.json({ item: it });
  });
  app.delete("/api/admin/help/learned/:id", requireAdmin, async (req, res) => {
    const items = await listLearned();
    await saveLearned(items.filter((x) => x.id !== req.params.id));
    res.json({ ok: true });
  });

  /** Where the "Alex needs help" texts go. */
  app.get("/api/admin/help/phone", requireAdmin, async (_req, res) => {
    const p = await deskPhone();
    res.json({ phone: p ? `•••${p.slice(-4)}` : "" });
  });
  app.put("/api/admin/help/phone", requireAdmin, async (req, res) => {
    const raw = String(req.body?.phone ?? "").trim();
    const p = raw ? toE164(raw) : "";
    if (raw && !p) return res.status(400).json({ message: "Enter a US mobile number." });
    await storage.setSetting(PHONE_SETTING, p);
    res.json({ phone: p ? `•••${p.slice(-4)}` : "" });
  });

  // A text back from the help-desk phone while a question is open: that's the answer (the newest open one).
  onTextReply(async (phone, text) => {
    if (!text.trim() || phone !== (await deskPhone())) return false;
    const [q] = await db.select().from(helpQuestions).where(eq(helpQuestions.status, "open")).orderBy(desc(helpQuestions.id)).limit(1);
    if (!q) return false;
    const out = await answer(q.id, text.trim(), "andrew");
    if (!out) return false;
    await slackNote(`:white_check_mark: Answered by text${out.status === "answered" ? "" : " (too late to show in the chat)"}: "${short(out.question, 80)}"`, undefined, "helpdesk").catch(() => {});
    return true;
  });
}

/** For /api/help/chat: who's asking, when we know. */
export const askerEmail = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
