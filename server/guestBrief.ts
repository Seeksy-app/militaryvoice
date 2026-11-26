// The guest brief (Andrew, 26 Nov 2026: "pull information or do a discovery on this guest… give the host more information on the
// person… they're creating the invite, but at the same time, they're going to be creating notes about the guest"; "Yes, build it").
//
// "Look them up" on the invite form (or Send, if they didn't) researches the guest from public pages only and fills a short card:
// who they are with sources, their service if a public page says it, recent podcasts, socials, and five questions for this show.
// - Parallel's Task API (core, ~$0.025) reads the public web. It's told never to open linkedin.com; the LinkedIn link the host
//   typed is only a hint to tell two people of one name apart, and linkedin.com is never shown as a source.
// - Listen Notes episodes with their name, kept only when they're this person (sameGuest), beside what Parallel found.
// - Influencers Club, only for handles Parallel found, for follower counts. "likely" unless their profile points back to them.
// - Five questions from Claude, from the brief and the show.
// It's the host's alone: never in an email to the guest, never on a public page, deleted with the invite. Cached per guest for
// 30 days, so a re-invite costs nothing. Free on Scale and Pro; Growth gets 3 a month.
import type { Express, Request, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { sql, eq } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { postifySubscriptions } from "../shared/schema.js";
import { lnSearchEpisodes, spendListenNotes, isListenNotesConfigured, type LnEpisode } from "./listenNotes.js";
import { sameGuest } from "./lnGuests.js";
import { rawAccount, PLATFORMS } from "./discovery.js";
import { workDomain, type Brief } from "../shared/guestBrief.js";

const API = "https://api.parallel.ai/v1/tasks/runs";
const KEY_NAMES = ["PARALLEL_API_KEY", "PARALLEL_AI_API_KEY", "PARALLELAI_API_KEY", "PARALLEL_KEY", "PARALLEL_WEB_API_KEY"];
const pKey = () => KEY_NAMES.map((n) => (process.env[n] || "").trim()).find(Boolean) || "";
const DAY = 24 * 3600_000;
const KEEP_MS = 30 * DAY;
export const FREE_BRIEFS = 3;
/** What one fresh brief costs us, roughly: Parallel core + one Claude call (IC credits are counted by Discovery). */
export const BRIEF_COST_USD = 0.035;

const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));
const str = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const liNorm = (u: string) => {
  const m = /linkedin\.com\/(in|pub)\/([^/?#\s]+)/i.exec(u);
  return m ? `linkedin.com/in/${decodeURIComponent(m[2]).toLowerCase()}` : "";
};

let ready: Promise<void> | null = null;
export function ensureBriefs(): Promise<void> {
  return (ready ??= (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS guest_briefs (
      id SERIAL PRIMARY KEY, owner_email TEXT NOT NULL, guest_name TEXT NOT NULL DEFAULT '', guest_email TEXT NOT NULL DEFAULT '',
      linkedin TEXT NOT NULL DEFAULT '', show_id INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'running', run_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', charged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS guest_briefs_owner_idx ON guest_briefs (owner_email)`);
    // The invite it belongs to (0 = looked up on the form and not sent yet).
    await db.execute(sql`ALTER TABLE guest_invites ADD COLUMN IF NOT EXISTS brief_id INTEGER NOT NULL DEFAULT 0`);
  })());
}

/** Paid plans (Scale, Pro, comped) and admins have unlimited briefs; Growth has FREE_BRIEFS a month. */
async function unlimited(email: string): Promise<boolean> {
  if (await storage.isAdminEmail(email)) return true;
  const subs = await db.select({ status: postifySubscriptions.status }).from(postifySubscriptions).where(eq(postifySubscriptions.email, email));
  return subs.some((x) => ["active", "trialing", "past_due", "comped"].includes(String(x.status)));
}
/** Open to every host once tested (setting guest-brief:on = "on"); until then, admins only. */
async function open(email: string): Promise<boolean> {
  if (!pKey()) return false;
  return (await storage.getSetting("guest-brief:on")) === "on" || (await storage.isAdminEmail(email));
}
const monthStart = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };
async function usedThisMonth(email: string): Promise<number> {
  return Number(rows(await db.execute(sql`select count(*)::int n from guest_briefs where owner_email=${email} and charged=1 and created_at >= ${monthStart()}`))[0]?.n ?? 0);
}

const s = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const SCHEMA = obj({
  confidence: s("How sure you are that the pages found are about this one person: 'high', 'medium' or 'low'."),
  summary: s("Two or three plain sentences for a podcast host: who they are, what they do now, what they're known for. Facts from public pages only; no praise words. Empty if nothing reliable was found."),
  role: s("Their current role and organisation, e.g. 'Founder, Hayes Benefits Group'. Empty if unknown."),
  service: s("Their military service only if a public page states it: branch, and years or rank if stated, e.g. 'U.S. Marine Corps, 2006–2014'. Empty if not stated. Never guess from a photo or a name."),
  service_where: s("Where that was stated, in a few words, e.g. 'their company website'. Empty if service is empty."),
  website: s("Their own or their organisation's website URL. Empty if none."),
  handles: {
    type: "array",
    description: "Their own public social accounts that are clearly theirs (linked from their website or bio). Up to five. Not LinkedIn.",
    items: obj({ platform: s("One of instagram, youtube, tiktok, twitter, facebook, other."), handle: s("The handle without @."), url: s("The profile URL.") }),
  },
  podcasts: {
    type: "array",
    description: "Podcast episodes they were a guest on, or shows they host, newest first. Up to five.",
    items: obj({ show: s("The podcast's name."), episode: s("The episode title, or 'host' if they host it."), date: s("Month and year, e.g. 'Oct 2026'. Empty if unknown."), url: s("A link to the episode or show page.") }),
  },
});

async function parallel(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { "x-api-key": pKey(), "Content-Type": "application/json", ...(init?.headers ?? {}) } });
}

async function showContext(owner: string, showId: number): Promise<{ title: string; about: string }> {
  try {
    const r = rows(await db.execute(showId
      ? sql`select title, description from hosted_shows where id=${showId} and lower(email)=${owner} limit 1`
      : sql`select title, description from hosted_shows where lower(email)=${owner} and archived_at='' order by id limit 1`))[0];
    if (r) return { title: str(r.title, 120), about: str(r.description, 600) };
  } catch { /* no hosted show */ }
  const p = await storage.getProfileByEmail(owner).catch(() => undefined);
  return { title: str(p?.podcastName, 120), about: "" };
}

async function startRun(name: string, email: string, linkedin: string, show: { title: string; about: string }): Promise<string> {
  const domain = workDomain(email);
  const input = [
    `Research this person for a podcast host who is about to interview them. Use public web pages only.`,
    `Do not open or read any linkedin.com page. The LinkedIn link below is only a hint to tell apart people with the same name.`,
    `If you can't be sure the pages are about this person, say so in confidence and leave the fields empty rather than guess.`,
    ``,
    `Name: ${name}`,
    domain ? `Their work email is at ${domain}, so their organisation's website is likely https://${domain}` : ``,
    linkedin ? `LinkedIn (hint only, do not open): ${linkedin}` : ``,
    show.title ? `The podcast interviewing them: ${show.title}${show.about ? ` — ${show.about}` : ""}` : ``,
  ].filter((l, i, a) => l || a[i - 1]).join("\n");
  const r = await parallel("", { method: "POST", body: JSON.stringify({ input, processor: "core", task_spec: { output_schema: { type: "json", json_schema: SCHEMA } } }) });
  if (!r.ok) throw new Error(r.status === 402 ? "out of credit" : `Parallel ${r.status}`);
  const run = (await r.json()) as { run_id?: string };
  if (!run.run_id) throw new Error("no run");
  return run.run_id;
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const noLinkedIn = (u: string) => !!u && !/(^|\.)linkedin\.com$/i.test(host(u));
const lnDate = (iso: string) => { const t = Date.parse(iso); return t ? new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : ""; };

/** Listen Notes episodes that are this person, newest first (only when the monthly allowance has room). */
async function lnAppearances(owner: string, name: string, about: string): Promise<Brief["podcasts"]> {
  if (!isListenNotesConfigured() || !(await spendListenNotes(owner))) return [];
  try {
    const { episodes } = await lnSearchEpisodes({ term: `"${name}"`, page: 0, byDate: true });
    const named = (episodes as LnEpisode[]).filter((e) => `${e.title} ${e.about}`.toLowerCase().includes(name.toLowerCase()));
    if (!named.length) return [];
    const keep = about ? await sameGuest(name, about, named) : [];
    // Without anything to tell namesakes apart, a common name would bring strangers: keep none.
    return keep.slice(0, 5).map((i) => named[i]).map((e) => ({ show: str(e.show.title, 80), episode: str(e.title, 120), date: lnDate(e.date), url: e.web }));
  } catch { return []; }
}

/** Follower counts for the handles found, "likely" unless their profile links back to their site or carries their full name. */
async function socials(handles: { platform: string; handle: string; url: string }[], name: string, site: string, sure: boolean): Promise<Brief["socials"]> {
  const out: Brief["socials"] = [];
  for (const h of handles.slice(0, 4)) {
    const platform = h.platform.toLowerCase().trim();
    const handle = h.handle.replace(/^@/, "").trim();
    if (!handle || !/^[\w.-]{1,60}$/.test(handle)) continue;
    let followers: number | null = null;
    let linked = false;
    if ((PLATFORMS as readonly string[]).includes(platform)) {
      try {
        const a = await rawAccount(platform, handle);
        if (a) {
          const n = Number(a.follower_count ?? a.subscriber_count ?? a.followers);
          followers = Number.isFinite(n) && n > 0 ? n : null;
          const text = `${a.full_name ?? ""} ${a.biography ?? ""} ${a.external_url ?? ""} ${a.description ?? ""}`.toLowerCase();
          linked = (!!site && text.includes(host(site))) || text.includes(name.toLowerCase());
        }
      } catch { /* over the daily cap or unknown: no count */ }
    }
    out.push({ platform, handle, url: h.url && /^https?:\/\//.test(h.url) ? h.url : "", followers, likely: !(sure && linked) });
  }
  return out;
}

async function questionsFor(name: string, b: Omit<Brief, "questions">, show: { title: string; about: string }): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  try {
    const facts = [b.summary, b.role && `Role: ${b.role}`, b.service && `Service: ${b.service}`, b.podcasts.length && `Recent podcasts: ${b.podcasts.map((p) => `${p.show} (${p.episode})`).join("; ")}`].filter(Boolean).join("\n");
    const out = await new Anthropic().messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: `You suggest interview questions for a podcast host. Write exactly five short, open questions (under 110 characters each) a host could ask this guest on this show, built on the facts given. Plain words, no flattery, nothing the facts don't support, nothing about their private life. Return JSON only: {"questions":["…"]}`,
      messages: [{ role: "user", content: `Guest: ${name}\n${facts || "Little is public about them."}\n\nShow: ${show.title || "a podcast"}${show.about ? `\n${show.about}` : ""}` }],
    });
    const text = out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    const qs = (m ? (JSON.parse(m[0]) as { questions?: unknown[] }).questions ?? [] : []).map((q) => str(q, 160)).filter(Boolean);
    return qs.slice(0, 5);
  } catch { return []; }
}

type Row = Record<string, unknown>;
const finishing = new Set<number>();

/** Look at a running brief once; when Parallel has answered, add podcasts, socials and questions, and store it. */
async function settle(r: Row): Promise<Row> {
  const id = Number(r.id);
  if (r.status !== "running" || !r.run_id || finishing.has(id)) return r;
  const st = await parallel(`/${r.run_id}`);
  if (!st.ok) return r;
  const run = (await st.json()) as { status?: string };
  const fail = async (why: string) => rows(await db.execute(sql`update guest_briefs set status='failed', error=${why}, updated_at=${new Date().toISOString()} where id=${id} returning *`))[0] ?? r;
  if (run.status === "failed" || run.status === "cancelled") return fail(`The look-up ${run.status}.`);
  if (Date.now() - Date.parse(String(r.created_at)) > 20 * 60_000 && run.status !== "completed") return fail("The look-up took too long.");
  if (run.status !== "completed") return r;
  finishing.add(id);
  try {
    const res = await parallel(`/${r.run_id}/result?timeout=20`);
    if (!res.ok) return r;
    const j = (await res.json()) as { output?: { content?: unknown; basis?: Array<{ field?: string; citations?: Array<{ url?: string; title?: string }> }> } };
    let c: any = j.output?.content;
    if (typeof c === "string") { try { c = JSON.parse(c); } catch { c = {}; } }
    c = c ?? {};
    const conf = (["high", "medium", "low"].includes(String(c.confidence)) ? c.confidence : "low") as Brief["confidence"];
    const name = String(r.guest_name);
    // Sources: the pages behind who they are and their service, never LinkedIn, at most four.
    const seen = new Map<string, { url: string; title: string }>();
    for (const b of j.output?.basis ?? []) {
      if (!/^(summary|role|service|website)/.test(b.field ?? "")) continue;
      for (const ct of b.citations ?? []) if (ct.url && noLinkedIn(ct.url) && !seen.has(ct.url) && seen.size < 4) seen.set(ct.url, { url: ct.url, title: str(ct.title, 80) || host(ct.url) });
    }
    const sources = Array.from(seen.values()).map((x, i) => ({ n: i + 1, ...x }));
    const low = conf === "low";
    const summary = low ? "" : str(c.summary, 600);
    const pods: Brief["podcasts"] = (Array.isArray(c.podcasts) ? c.podcasts : []).map((p: any) => ({ show: str(p?.show, 80), episode: str(p?.episode, 120), date: str(p?.date, 20), url: noLinkedIn(String(p?.url ?? "")) ? String(p.url) : "" })).filter((p: { show: string }) => p.show);
    const about = [str(c.role, 120), summary.slice(0, 200)].filter(Boolean).join(". ");
    const fromLn = low ? [] : await lnAppearances(String(r.owner_email), name, about);
    const key = (p: { show: string; episode: string }) => `${p.show}|${p.episode}`.toLowerCase().replace(/[^a-z0-9|]+/g, "");
    const podcasts = [...pods, ...fromLn].filter((p, i, a) => a.findIndex((q) => key(q) === key(p)) === i).slice(0, 3);
    const handles = low ? [] : (Array.isArray(c.handles) ? c.handles : []).map((h: any) => ({ platform: str(h?.platform, 20), handle: str(h?.handle, 60), url: str(h?.url, 300) })).filter((h: { platform: string }) => h.platform && h.platform !== "linkedin");
    const site = noLinkedIn(String(c.website ?? "")) ? str(c.website, 300) : "";
    const base: Omit<Brief, "questions"> = {
      confidence: conf, summary, role: low ? "" : str(c.role, 120),
      service: low ? "" : str(c.service, 120), serviceWhere: low ? "" : str(c.service_where, 60),
      website: low ? "" : site, sources: low ? [] : sources, podcasts,
      socials: await socials(handles, name, site, conf === "high"),
      linkedin: String(r.linkedin ?? ""),
    };
    const brief: Brief = { ...base, questions: await questionsFor(name, base, await showContext(String(r.owner_email), Number(r.show_id))) };
    return rows(await db.execute(sql`update guest_briefs set status='done', result=${JSON.stringify(brief)}, updated_at=${new Date().toISOString()} where id=${id} returning *`))[0] ?? r;
  } finally { finishing.delete(id); }
}

function view(r: Row) {
  let result: Brief | null = null;
  try { result = r.result ? (JSON.parse(String(r.result)) as Brief) : null; } catch { result = null; }
  return { id: Number(r.id), status: String(r.status), guestName: String(r.guest_name), result, notes: String(r.notes ?? ""), error: r.status === "failed" ? "We couldn't finish the look-up. Try again in a little while." : "" };
}

/** An invite and its brief go together: deleting the invite deletes the brief unless another invite still uses it. */
export async function deleteBriefOf(owner: string, briefId: number): Promise<void> {
  if (!briefId) return;
  await ensureBriefs();
  const still = rows(await db.execute(sql`select 1 from guest_invites where owner_email=${owner} and brief_id=${briefId} limit 1`));
  if (!still.length) await db.execute(sql`delete from guest_briefs where id=${briefId} and owner_email=${owner}`);
}

/** Link a brief to the invite just sent (only the host's own). */
export async function attachBrief(owner: string, inviteId: number, briefId: number): Promise<void> {
  if (!briefId) return;
  await ensureBriefs();
  await db.execute(sql`update guest_invites set brief_id=${briefId} where id=${inviteId} and owner_email=${owner} and exists (select 1 from guest_briefs where id=${briefId} and owner_email=${owner})`);
}

/** The brief's facts as plain text, for conversation starters (Engineering's listener) and the prep view. */
export async function briefText(owner: string, inviteId: number): Promise<string> {
  await ensureBriefs();
  const r = rows(await db.execute(sql`select b.result, b.notes from guest_briefs b join guest_invites i on i.brief_id=b.id where i.id=${inviteId} and i.owner_email=${owner} and b.owner_email=${owner} limit 1`))[0];
  if (!r) return "";
  if (String(r.notes ?? "").trim()) return String(r.notes);
  try {
    const b = JSON.parse(String(r.result)) as Brief;
    return [b.summary, b.role, b.service, ...b.podcasts.map((p) => `${p.show}: ${p.episode}`), ...b.questions].filter(Boolean).join("\n");
  } catch { return ""; }
}

export function registerGuestBrief(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  const mine = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();

  /** Start (or find) the brief for this guest. Cached ones are free; fresh ones count on Growth. */
  app.post("/api/host/guest-brief", requireHostSession, async (req, res) => {
    await ensureBriefs();
    const owner = mine(req);
    const name = str(req.body?.guestName, 80);
    const email = str(req.body?.guestEmail, 200).toLowerCase();
    const liRaw = str(req.body?.linkedin, 300);
    const linkedin = liRaw ? (/^https?:\/\//i.test(liRaw) ? liRaw : `https://${liRaw.replace(/^\/+/, "")}`) : "";
    const li = liNorm(linkedin);
    const inviteId = Number(req.body?.inviteId) || 0;
    const showId = Number(req.body?.showId) || 0;
    if (name.length < 3 || !/\s/.test(name)) return res.status(400).json({ message: "Add their first and last name to look them up." });
    if (!workDomain(email) && !li) return res.status(400).json({ message: "Add their LinkedIn, or a work email, so we look up the right person." });
    // Old look-ups nobody sent go after 30 days.
    await db.execute(sql`delete from guest_briefs where owner_email=${owner} and created_at < ${new Date(Date.now() - KEEP_MS).toISOString()} and not exists (select 1 from guest_invites i where i.brief_id=guest_briefs.id)`);
    const since = new Date(Date.now() - KEEP_MS).toISOString();
    const held = rows(await db.execute(sql`select * from guest_briefs where owner_email=${owner} and status<>'failed' and created_at >= ${since} and lower(guest_name)=${name.toLowerCase()} and ((${email} <> '' and guest_email=${email}) or (${li} <> '' and linkedin ilike ${`%${li.replace("linkedin.com/in/", "/in/")}%`})) order by id desc limit 1`))[0];
    if (held) {
      if (inviteId) await attachBrief(owner, inviteId, Number(held.id));
      return res.json({ ...view(held.status === "running" ? await settle(held).catch(() => held) : held), cached: true });
    }
    if (!(await open(owner))) return res.status(503).json({ message: "Guest briefs aren't switched on yet." });
    const paid = await unlimited(owner);
    if (!paid && (await usedThisMonth(owner)) >= FREE_BRIEFS) {
      return res.status(402).json({ limit: true, message: `You've used your ${FREE_BRIEFS} free guest briefs this month. Upgrade to Scale for unlimited guest briefs.` });
    }
    let runId = "";
    try { runId = await startRun(name, email, li ? `https://www.${li}` : "", await showContext(owner, showId)); } catch (e) {
      console.error("[guest-brief] start", (e as Error).message);
      return res.status(502).json({ message: "We couldn't start the look-up. Try again in a moment." });
    }
    const now = new Date().toISOString();
    const [r] = rows(await db.execute(sql`insert into guest_briefs (owner_email, guest_name, guest_email, linkedin, show_id, status, run_id, charged, created_at, updated_at) values (${owner}, ${name}, ${email}, ${linkedin}, ${showId}, 'running', ${runId}, 1, ${now}, ${now}) returning *`));
    if (inviteId) await attachBrief(owner, inviteId, Number(r.id));
    res.status(201).json(view(r));
  });

  app.get("/api/host/guest-brief/:id", requireHostSession, async (req, res) => {
    await ensureBriefs();
    res.setHeader("Cache-Control", "no-store");
    const r = rows(await db.execute(sql`select * from guest_briefs where id=${Number(req.params.id)} and owner_email=${mine(req)}`))[0];
    if (!r) return res.status(404).json({ message: "That brief is gone." });
    res.json(view(await settle(r).catch(() => r)));
  });

  /** The host's own words for it (Edit). Plain text. */
  app.put("/api/host/guest-brief/:id", requireHostSession, async (req, res) => {
    await ensureBriefs();
    const notes = String(req.body?.notes ?? "").replace(/<[^>]*>/g, "").slice(0, 4000);
    const [r] = rows(await db.execute(sql`update guest_briefs set notes=${notes}, updated_at=${new Date().toISOString()} where id=${Number(req.params.id)} and owner_email=${mine(req)} returning *`));
    if (!r) return res.status(404).json({ message: "That brief is gone." });
    res.json(view(r));
  });

  /** "Not them?": the brief goes, and so does its place on any invite. */
  app.delete("/api/host/guest-brief/:id", requireHostSession, async (req, res) => {
    await ensureBriefs();
    const owner = mine(req);
    const id = Number(req.params.id);
    await db.execute(sql`update guest_invites set brief_id=0 where owner_email=${owner} and brief_id=${id}`);
    await db.execute(sql`delete from guest_briefs where id=${id} and owner_email=${owner}`);
    res.json({ ok: true });
  });

  /** How many this host has left this month (null = unlimited). */
  app.get("/api/host/guest-brief-allowance", requireHostSession, async (req, res) => {
    await ensureBriefs();
    const owner = mine(req);
    res.setHeader("Cache-Control", "no-store");
    if (!(await open(owner))) return res.json({ on: false, left: null });
    if (await unlimited(owner)) return res.json({ on: true, left: null });
    res.json({ on: true, left: Math.max(0, FREE_BRIEFS - (await usedThisMonth(owner))) });
  });

  /** Admin: this month's fresh briefs and what they cost us (for Finances). */
  app.get("/api/admin/guest-briefs/usage", requireAdmin, async (_req, res) => {
    await ensureBriefs();
    const n = Number(rows(await db.execute(sql`select count(*)::int n from guest_briefs where charged=1 and created_at >= ${monthStart()}`))[0]?.n ?? 0);
    res.json({ month: monthStart().slice(0, 7), briefs: n, perBriefUsd: BRIEF_COST_USD, estUsd: Math.round(n * BRIEF_COST_USD * 100) / 100 });
  });
}

