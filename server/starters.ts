// Conversation starters (Andrew, 26 Nov: "yes" to the build, then "Yes, run it" for the listener on the Alex VPS).
//
// When the owner has Tips > Conversation starters on and people are in their room, a hidden listener on the Alex VPS
// (agent/starters.ts) joins it, hears the talk and, on a lull, asks here for 2–3 questions. They go to the owner's
// screen only, on the room's "mv-starter" topic. Nothing the listener hears is stored: the transcript lives in its
// memory for a few minutes and in this request only. All we keep is how long it listened, how many cards, and the cost.
//
// The listener holds only the agent token. Everything else stays here: the room pass (a hidden, can't-publish
// LiveKit token), a short-lived Deepgram token, the host's notes and guest prep, and the Anthropic key.
//
// Dark by default: only the studios in setting starters:studios (default "13", the test account) are ever listened to,
// whatever their toggle says.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { sql, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { AccessToken } from "livekit-server-sdk";
import { db, storage, schemaIsReady } from "./storage.js";
import { isLiveKitConfigured, publicLiveKitUrl, rooms } from "./livekit.js";
import { personalStudios } from "../shared/schema.js";
import { studioTitle } from "./hostShows.js";
import { briefText } from "./guestBrief.js";

const rowsOf = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));
const realPerson = (identity: string) => /^(owner|guest)-/.test(identity);
const month = (d = new Date()) => d.toISOString().slice(0, 7);
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const hour = (d = new Date()) => d.toISOString().slice(0, 13);

/** Deepgram nova-3 streaming at list price: $0.0077 a minute. In hundredths of a cent a second, to keep it whole. */
const STT_MILLICENTS_PER_SEC = (0.77 / 60) * 1000;
/** Claude Haiku 5.5 at $0.10 / $0.50 per million tokens in / out (prompts under 100K), in millicents a token. */
const HAIKU_IN = 0.01;
const HAIKU_OUT = 0.05;

type Usage = { sec: number; cards: number; used: number; dismissed: number; mc: number };
const zero = (): Usage => ({ sec: 0, cards: 0, used: 0, dismissed: 0, mc: 0 });
const readJson = async <T>(key: string, blank: T): Promise<T> => {
  try { const v = await storage.getSetting(key); return v ? { ...blank, ...(JSON.parse(v) as T) } : blank; } catch { return blank; }
};
const monthKey = (id: number) => `starters-usage:${id}:${month()}`;
const hourKey = (id: number) => `starters-hour:${id}:${hour()}`;
const dayKey = () => `starters-spend:${day()}`;

async function caps(): Promise<{ hourCents: number; monthHours: number }> {
  const h = Number(await storage.getSetting("starters:cap-hour-cents").catch(() => null));
  const m = Number(await storage.getSetting("starters:cap-month-hours").catch(() => null));
  return { hourCents: h > 0 ? h : 100, monthHours: m > 0 ? m : 10 };
}

/** Which studios may be listened to at all (setting starters:studios, "13" until it's opened up; "all" = everyone). */
async function allowed(studioId: number): Promise<boolean> {
  const v = ((await storage.getSetting("starters:studios").catch(() => null)) ?? "13").trim();
  if (v === "all") return true;
  return v.split(",").map((x) => Number(x.trim())).includes(studioId);
}

type Starters = { on: boolean; from: { notes: boolean; prep: boolean; talk: boolean; brief: boolean }; wait: number };
async function readStarters(id: number): Promise<Starters> {
  let v: Partial<Starters> = {};
  try { v = JSON.parse((await storage.getSetting(`studio-starters:${id}`)) ?? "{}"); } catch { v = {}; }
  const f = v.from ?? ({} as Partial<Starters["from"]>);
  return { on: v.on === true, from: { notes: f.notes !== false, prep: f.prep !== false, talk: f.talk !== false, brief: f.brief !== false }, wait: [5, 8, 12, 20].includes(Number(v.wait)) ? Number(v.wait) : 8 };
}

/** Over a cap? "month" (listened hours this month) or "hour" (spend this clock hour). */
async function capHit(id: number): Promise<"month" | "hour" | null> {
  const c = await caps();
  const m = await readJson(monthKey(id), zero());
  if (m.sec >= c.monthHours * 3600) return "month";
  const h = await readJson(hourKey(id), zero());
  if (h.mc >= c.hourCents * 1000) return "hour";
  return null;
}

async function addUsage(id: number, add: Partial<Usage>): Promise<void> {
  for (const key of [monthKey(id), hourKey(id)]) {
    const cur = await readJson(key, zero());
    const next: Usage = { sec: cur.sec + (add.sec ?? 0), cards: cur.cards + (add.cards ?? 0), used: cur.used + (add.used ?? 0), dismissed: cur.dismissed + (add.dismissed ?? 0), mc: cur.mc + (add.mc ?? 0) };
    await storage.setSetting(key, JSON.stringify(next));
  }
  if (add.mc) {
    const d = await readJson(dayKey(), { mc: 0 });
    await storage.setSetting(dayKey(), JSON.stringify({ mc: d.mc + add.mc }));
  }
}

/** The invite for the guest whose interview is nearest now (within 12 hours), answered or not. Host only. */
async function nearestInvite(ownerEmail: string): Promise<Record<string, unknown> | null> {
  try {
    const list = rowsOf(await db.execute(sql`select id, status, guest_name, when_iso, answered_at, invited_at, note, answers from guest_invites where owner_email=${ownerEmail} and status <> 'cancelled' order by id desc limit 20`));
    const t = Date.now();
    return list
      .map((r) => ({ r, d: Math.abs((Date.parse(String(r.when_iso)) || Date.parse(String(r.answered_at)) || Date.parse(String(r.invited_at)) || 0) - t) }))
      .filter((x) => x.d < 12 * 3600_000)
      .sort((a, b) => a.d - b.d)[0]?.r ?? null;
  } catch {
    return null;
  }
}

/** That guest's invite answers, for the prompt. */
function guestPrep(near: Record<string, unknown> | null): string {
  try {
    if (!near || near.status !== "answered") return "";
    let a: { custom?: { q?: string; a?: string }[]; name?: string; title?: string; bio?: string; topics?: string; avoid?: string } = {};
    try { a = JSON.parse(String(near.answers || "{}")); } catch { a = {}; }
    return [
      `Guest: ${a.name || near.guest_name}${a.title ? `, ${a.title}` : ""}`,
      a.bio && `About them: ${a.bio}`,
      a.topics && `Topics they'd like: ${a.topics}`,
      a.avoid && `They asked us to avoid: ${a.avoid}`,
      ...(a.custom ?? []).filter((c) => c?.a).map((c) => `${c.q}: ${c.a}`),
      near.note && `Host's note: ${near.note}`,
    ].filter(Boolean).join("\n").slice(0, 3000);
  } catch {
    return "";
  }
}

/** Podcasting's guest brief for that invite (server/guestBrief.ts): the host's edited notes, or the brief's facts. */
async function guestBrief(ownerEmail: string, near: Record<string, unknown> | null): Promise<string> {
  if (!near) return "";
  try { return (await briefText(ownerEmail, Number(near.id))).slice(0, 3000); } catch { return ""; }
}

const SYSTEM = `You help a podcast host when the conversation goes quiet. You see what has been said in the last few minutes and the host's own prep. Suggest 2 or 3 questions the host could ask next.

Rules:
- Each is one open question, 120 characters or fewer, in the host's own voice, ready to say out loud.
- Follow a thread from the conversation or the prep, or move the conversation on. Never repeat a question already asked or already suggested.
- No yes/no questions. Nothing about money, politics, religion or anything the guest asked to avoid. No medical, legal or financial advice. Be respectful to service members, veterans and their families.
- Never invent facts about the guest.
- basis: a few words on where the first question came from, like "From their invite answers" or "From what they just said".

Return JSON only: {"lines": ["...", "..."], "basis": "..."}`;

export function registerStarters(app: Express, requireAgent: RequestHandler, requireAdmin: RequestHandler) {
  /** The rooms to be in now: toggle on, allowed, someone real in the room. Polled by the listener every ~15s. */
  app.get("/api/agent/starters/rooms", requireAgent, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLiveKitConfigured()) return res.json({ rooms: [] });
    await schemaIsReady();
    const keys = rowsOf(await db.execute(sql`select key, value from site_settings where key like 'studio-starters:%'`));
    const out: unknown[] = [];
    for (const k of keys) {
      const id = Number(String(k.key).split(":")[1]);
      if (!id) continue;
      let on = false;
      try { on = (JSON.parse(String(k.value)) as { on?: boolean }).on === true; } catch { on = false; }
      if (!on || !(await allowed(id))) continue;
      const room = `my-${id}`;
      let people = 0;
      try { people = (await rooms().listParticipants(room)).filter((p) => realPerson(p.identity)).length; } catch { continue; }
      if (!people) continue;
      const s = await readStarters(id);
      const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity: `listener-${id}`, name: "Conversation starters", ttl: "3h" });
      // Hidden: no tile, not in anyone's list, never filmed. It can't publish audio or video, only data.
      at.addGrant({ room, roomJoin: true, hidden: true, canPublish: false, canSubscribe: true, canPublishData: true });
      out.push({ studioId: id, room, url: publicLiveKitUrl(), token: await at.toJwt(), people, wait: s.wait, cap: await capHit(id) });
    }
    res.json({ rooms: out });
  });

  /** A Deepgram token good for 10 minutes, for one streaming connection. The key itself never leaves here. */
  app.post("/api/agent/starters/stt-token", requireAgent, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const key = (process.env.DEEPGRAM_API_KEY ?? "").trim();
    if (!key) return res.status(503).json({ message: "No Deepgram key here." });
    try {
      const r = await fetch("https://api.deepgram.com/v1/auth/grant", { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl_seconds: 600 }), signal: AbortSignal.timeout(8000) });
      const j = (await r.json().catch(() => ({}))) as { access_token?: string; err_msg?: string };
      if (!r.ok || !j.access_token) return res.status(502).json({ message: `Deepgram said ${r.status}${j.err_msg ? `: ${j.err_msg}` : ""}` });
      res.json({ token: j.access_token });
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  /** On a lull: 2–3 questions. The transcript is used for this answer only and never saved. */
  app.post("/api/agent/starters/suggest", requireAgent, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = Number(req.body?.studioId);
    if (!id || !(await allowed(id))) return res.status(404).json({ message: "Not a starters room." });
    const s = await readStarters(id);
    if (!s.on) return res.json({ off: true });
    const cap = await capHit(id);
    if (cap) return res.json({ cap });
    await schemaIsReady();
    const [studio] = await db.select().from(personalStudios).where(eq(personalStudios.id, id)).limit(1);
    if (!studio) return res.status(404).json({ message: "No such studio." });
    const owner = studio.ownerEmail.trim().toLowerCase();
    const transcript = s.from.talk ? String(req.body?.transcript ?? "").slice(-6000) : "";
    const shown = (Array.isArray(req.body?.shown) ? req.body.shown : []).map((x: unknown) => String(x ?? "").slice(0, 140)).slice(-30);
    let notes = "";
    if (s.from.notes) {
      try { const v = JSON.parse((await storage.getSetting(`studio-notes:${id}`)) ?? "{}") as { text?: string }; notes = String(v.text ?? "").slice(0, 4000); } catch { notes = ""; }
    }
    const near = s.from.prep || s.from.brief ? await nearestInvite(owner) : null;
    const prep = s.from.prep ? guestPrep(near) : "";
    const brief = s.from.brief ? await guestBrief(owner, near) : "";
    if (!transcript && !notes && !prep && !brief) return res.json({ lines: [] });
    const title = await studioTitle(owner, id, studio.name).catch(() => studio.name);
    const user = [
      `Show: ${title}`,
      notes && `The host's notes:\n${notes}`,
      prep && `The guest's invite answers:\n${prep}`,
      brief && `The host's guest brief:\n${brief}`,
      transcript && `The last few minutes of the conversation (one stream, speakers not named):\n${transcript}`,
      shown.length ? `Already suggested (don't repeat):\n${shown.map((x: string) => `- ${x}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    try {
      const out = await new Anthropic().messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 400,
        // Fast is the point: the card has to land within a couple of seconds of the quiet.
        thinking: { type: "disabled" },
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      } as Parameters<Anthropic["messages"]["create"]>[0]) as Anthropic.Message;
      const text = out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
      const m = text.match(/\{[\s\S]*\}/);
      const j = m ? (JSON.parse(m[0]) as { lines?: unknown; basis?: unknown }) : {};
      const lines = (Array.isArray(j.lines) ? j.lines : []).map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter((x) => x && x.length <= 140).slice(0, 3);
      const mc = Math.ceil((out.usage?.input_tokens ?? 0) * HAIKU_IN + (out.usage?.output_tokens ?? 0) * HAIKU_OUT);
      await addUsage(id, { cards: lines.length ? 1 : 0, mc });
      res.json({ lines, basis: typeof j.basis === "string" ? j.basis.slice(0, 60) : undefined, id: crypto.randomBytes(4).toString("hex") });
    } catch (err) {
      console.error("Starters suggest failed:", (err as Error).message);
      res.status(502).json({ message: "No suggestion this time." });
    }
  });

  /** The listener's running count: seconds heard, cards used or closed. Answers whether a cap is now hit. */
  app.post("/api/agent/starters/usage", requireAgent, async (req, res) => {
    const id = Number(req.body?.studioId);
    if (!id) return res.status(400).json({ message: "Which studio?" });
    const sec = Math.max(0, Math.min(600, Math.round(Number(req.body?.seconds) || 0)));
    const used = Math.max(0, Math.min(50, Math.round(Number(req.body?.used) || 0)));
    const dismissed = Math.max(0, Math.min(50, Math.round(Number(req.body?.dismissed) || 0)));
    await addUsage(id, { sec, used, dismissed, mc: Math.ceil(sec * STT_MILLICENTS_PER_SEC) });
    res.json({ cap: await capHit(id) });
  });

  /** For Admin: this month per studio, and today's spend. */
  app.get("/api/admin/starters", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const list = rowsOf(await db.execute(sql`select key, value from site_settings where key like ${`starters-usage:%:${month()}`}`));
    const today = await readJson(dayKey(), { mc: 0 });
    res.json({
      todayCents: Math.round(today.mc / 10) / 100,
      month: list.map((r) => { let u = zero(); try { u = { ...u, ...JSON.parse(String(r.value)) }; } catch { /* blank */ } return { studioId: Number(String(r.key).split(":")[1]), minutes: Math.round(u.sec / 60), cards: u.cards, used: u.used, dismissed: u.dismissed, cents: Math.round(u.mc / 10) / 100 }; }),
      caps: await caps(),
      studios: (await storage.getSetting("starters:studios").catch(() => null)) ?? "13",
    });
  });
}
