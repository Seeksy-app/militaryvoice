// The Team desk (17 Nov 2026): an assistant in Admin for the team, like Alex's chat but with a few safe tools behind it.
//
// A team member (Rymsha, who runs podcaster onboarding) asks in plain words: "is Frank's Zoom connected?", "make Frank a private
// link for his Buzzsprout login", "write Dave about an extra spot". It looks things up, makes links, drafts emails and files
// requests for Andrew's Claude sessions on the Projects board. It cannot send anything, change an account, or see
// Finances: an email is a draft the person presses Send on, and every exchange is logged where the owner can read it.
import Anthropic from "@anthropic-ai/sdk";
import type { Express, RequestHandler, Request } from "express";
import { sql, eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { createShareLogin } from "./shareLogin.js";
import { pmItems, pmProjects } from "../shared/schema.js";

type Turn = { role: "user" | "assistant"; content: string };
type Draft = { to: string; toName: string; subject: string; text: string; from: "alex" | "team" };
const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));
const ET = "America/New_York";
const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "never");

const TOOLS: Anthropic.Tool[] = [
  { name: "find_person", description: "Find podcasters by name, show or email. Use first, then account_status with the email.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "account_status", description: "One person's account: profile, last login, connected Zoom, YouTube, social accounts, Buzzsprout or other stats, hosted shows and episodes, Library recordings, Pōstify plan and credits, and upcoming Radio bookings.", input_schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
  { name: "recent_mail", description: "The last emails we sent to a person and the last they sent us.", input_schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
  { name: "create_login_link", description: "Make a private page where someone can hand us a login (for example Buzzsprout) without emailing a password. Returns the link; it must go to them in an email.", input_schema: { type: "object", properties: { name: { type: "string" }, service: { type: "string" } }, required: ["name", "service"] } },
  { name: "draft_email", description: "Write an email for the team member to read and send. Nothing is sent until they press Send. Only one email per answer.", input_schema: { type: "object", properties: { to: { type: "string" }, toName: { type: "string" }, subject: { type: "string" }, text: { type: "string", description: "Plain text, greeting through sign-off." }, from: { type: "string", enum: ["alex", "team"] } }, required: ["to", "subject", "text"] } },
  { name: "add_request", description: "File a request or note on the Projects board for Andrew and his Claude sessions: anything that needs a change to the platform, an access, or a decision.", input_schema: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } }, required: ["title"] } },
];

export async function runTool(name: string, input: Record<string, unknown>, ctx: { who: string; draft: Draft | null; links: string[] }): Promise<string> {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (name === "find_person") {
    const q = `%${String(input.query ?? "").trim().toLowerCase()}%`;
    const r = rows(await db.execute(sql`select email, host_name, podcast_name from podcaster_profiles where lower(email) like ${q} or lower(host_name) like ${q} or lower(podcast_name) like ${q} limit 8`));
    return JSON.stringify(r.map((x) => ({ email: x.email, name: x.host_name, show: x.podcast_name })));
  }
  if (name === "account_status") {
    if (!email.includes("@")) return "Give an email address.";
    const g = async (q: ReturnType<typeof sql>) => rows(await db.execute(q).catch(() => []));
    const [prof] = await g(sql`select host_name, podcast_name, photo_url, upload_post_username, social_accounts from podcaster_profiles where lower(email)=${email}`);
    const [login] = await g(sql`select max(used_at) l, count(*)::int n from login_tokens where lower(email)=${email} and used_at is not null`);
    const zoom = await g(sql`select zoom_email, created_at from zoom_connections where lower(email)=${email}`);
    const yt = await g(sql`select channel_title, scope from youtube_accounts where lower(email)=${email}`);
    const stats = await g(sql`select source from podcast_stats where lower(email)=${email}`);
    const shows = await g(sql`select s.title, s.slug, (select count(*)::int from hosted_episodes e where e.show_id=s.id) eps from hosted_shows s where lower(s.email)=${email}`);
    const [lib] = await g(sql`select count(*)::int n, max(started_at) last from recordings where lower(email)=${email}`);
    const [tok] = await g(sql`select coalesce(sum(delta),0)::int bal from postify_tokens where lower(email)=${email}`);
    const [plan] = await g(sql`select plan, status from postify_subscriptions where lower(email)=${email} order by id desc limit 1`);
    const book = await g(sql`select s.event_id, s.podcast_name, s.slot_index, s.status, s.show_format from signups s where lower(s.email)=${email} and s.event_id between 5 and 9 and s.status<>'cancelled'`);
    let socials: string[] = [];
    try { const a = JSON.parse(String(prof?.social_accounts ?? "[]")) as { platform?: string }[]; socials = a.map((x) => x.platform ?? "").filter(Boolean); } catch { /* none */ }
    return JSON.stringify({
      found: !!prof, name: prof?.host_name, show: prof?.podcast_name, hasPhoto: !!prof?.photo_url,
      lastLogin: when(login?.l), logins: login?.n ?? 0,
      zoom: zoom.length ? { connected: true, zoomEmail: zoom[0].zoom_email, since: when(zoom[0].created_at) } : { connected: false },
      youtube: yt.map((y) => ({ channel: y.channel_title, scope: y.scope })), socialAccounts: socials, statsSources: stats.map((s) => s.source),
      hostedShows: shows.map((s) => ({ title: s.title, episodes: s.eps })), library: { recordings: lib?.n ?? 0, lastRecording: when(lib?.last) },
      postify: { plan: plan?.plan ?? "none", status: plan?.status ?? "", credits: tok?.bal ?? 0 }, radioBookings: book.map((b) => `${b.podcast_name} (event ${b.event_id}, slot ${b.slot_index}, ${b.show_format || "live"})`),
    });
  }
  if (name === "recent_mail") {
    if (!email.includes("@")) return "Give an email address.";
    const sent = rows(await db.execute(sql`select sent_at, subject, ok from mail_log where lower(to_email)=${email} order by sent_at desc limit 6`));
    const got = rows(await db.execute(sql`select received_at, subject from inbound_emails where lower(from_email)=${email} order by id desc limit 6`));
    return JSON.stringify({ weSent: sent.map((m) => `${when(m.sent_at)}: ${m.subject}${m.ok === false ? " (failed)" : ""}`), theySent: got.map((m) => `${when(m.received_at)}: ${m.subject}`) });
  }
  if (name === "create_login_link") {
    const url = await createShareLogin(String(input.name ?? ""), String(input.service ?? "Buzzsprout"));
    ctx.links.push(url);
    return `Link made: ${url}. It has to reach them by email; tell the team member, or draft the email with it.`;
  }
  if (name === "draft_email") {
    const to = String(input.to ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "That isn't an email address. Look the person up first.";
    ctx.draft = { to, toName: String(input.toName ?? ""), subject: String(input.subject ?? "").slice(0, 200), text: String(input.text ?? "").trim(), from: input.from === "alex" ? "alex" : "team" };
    return "Draft ready. The team member will see it under your reply and can edit it and press Send.";
  }
  if (name === "add_request") {
    await schemaIsReady();
    let [p] = await db.select({ id: pmProjects.id }).from(pmProjects).where(eq(pmProjects.name, "Team desk requests"));
    if (!p) [p] = await db.insert(pmProjects).values({ name: "Team desk requests", goal: "Things the team asks for from the Team desk.", createdAt: new Date().toISOString() }).returning({ id: pmProjects.id });
    const title = String(input.title ?? "").trim().slice(0, 200);
    if (!title) return "A request needs a title.";
    await db.insert(pmItems).values({ projectId: p.id, title, detail: `${String(input.detail ?? "").slice(0, 7000)}\n\n(Asked by ${ctx.who} on the Team desk.)`.trim(), status: "todo", owner: "claude", position: 9999, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as typeof pmItems.$inferInsert);
    return "Filed on the Projects board for Andrew and Claude.";
  }
  return "Unknown tool.";
}

export async function teamDesk(turns: Turn[], who: string): Promise<{ reply: string; draft: Draft | null; used: string[] }> {
  const system = `You are the Team desk for MilitaryVoices.ai: the assistant for a team member in the admin (today that is Rymsha, our Media & Digital Specialist, who onboards podcasters and trains them). Be brief and plain, at an 8th-grade reading level, no corporate phrases.

What you can do: look people up (find_person), read an account (account_status), read recent mail (recent_mail), make a private login link (create_login_link), write an email for the team member to send (draft_email), and file a request for Andrew on the Projects board (add_request).

Rules:
- Always look the person up before you say anything about their account. Never guess; if a tool finds nothing, say so.
- You cannot send email, change an account, connect anything, or see finances, billing, revenue or costs. If asked, say that's outside the Team desk and offer add_request.
- Never ask a customer for a password by email. For a login, make a private link with create_login_link and put it in the draft.
- Customer email comes from the team (from "team", signed "The MilitaryVoices.ai team") unless the team member asks for Alex. Never use Andrew's name in a customer email.
- Say what you found in two or three short lines, then the next step.
- Today's date is ${new Date().toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`;
  const client = new Anthropic();
  const ctx = { who, draft: null as Draft | null, links: [] as string[] };
  const used: string[] = [];
  const msgs: Anthropic.MessageParam[] = turns.slice(-12).map((t) => ({ role: t.role, content: t.content }));
  for (let i = 0; i < 6; i++) {
    const res = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 1200, system, tools: TOOLS, messages: msgs });
    const calls = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
      return { reply: text || (ctx.draft ? "Here's the draft." : "Say that again?"), draft: ctx.draft, used };
    }
    msgs.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      used.push(c.name);
      let out: string;
      try { out = await runTool(c.name, (c.input ?? {}) as Record<string, unknown>, ctx); } catch (err) { out = `That failed: ${(err as Error).message}`; }
      results.push({ type: "tool_result", tool_use_id: c.id, content: out });
    }
    msgs.push({ role: "user", content: results });
  }
  return { reply: "That took too many steps. Try asking for one thing at a time.", draft: ctx.draft, used };
}

export function registerTeamDesk(app: Express, requireAdmin: RequestHandler) {
  app.post("/api/admin/team-desk", requireAdmin, async (req: Request, res) => {
    const turns = (Array.isArray(req.body?.messages) ? req.body.messages : []) as Turn[];
    const clean = turns.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string").map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
    if (!clean.length || clean[clean.length - 1].role !== "user") return res.status(400).json({ message: "Say something first." });
    const who = getAdminEmail(req) ?? "a team member";
    try {
      const out = await teamDesk(clean, who);
      res.json({ reply: out.reply, draft: out.draft });
      // The owner can read every exchange.
      try {
        const log = JSON.parse((await storage.getSetting("teamdesk:log")) || "[]") as unknown[];
        log.unshift({ at: new Date().toISOString(), who, ask: clean[clean.length - 1].content.slice(0, 400), reply: out.reply.slice(0, 600), tools: out.used, draft: out.draft ? { to: out.draft.to, subject: out.draft.subject } : null });
        await storage.setSetting("teamdesk:log", JSON.stringify(log.slice(0, 300)));
      } catch { /* the log is a convenience */ }
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });
  app.get("/api/admin/team-desk/log", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(JSON.parse((await storage.getSetting("teamdesk:log")) || "[]")); } catch { res.json([]); }
  });
}
