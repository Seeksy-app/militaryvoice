// An account's own AI guide (21 Nov 2026; Andrew: "Yes" to Lori, Frank Zaccari's account first).
//
// - Built on Ask Alex: the same knowledge (help articles) and the team's learned answers. When she doesn't know,
//   she says "I'm not sure about that one. Leave a note and someone will get back to you as soon as possible."
//   and the client shows the note form (no help-desk wait, PM 21 Nov). Money, legal, press and complaints get
//   "Someone will get back to you as soon as possible."
// - Knows the account: a read-only snapshot of the signed-in person's own account (the Team desk's
//   account_status), built fresh on every message.
// - Offers to open a page from a fixed list (shared/guideTargets.ts); the card asks "Want me to open that for you?". Nothing
//   moves until they tap Yes; the page then opens and the walkthrough points at each control. She can't pay,
//   send, post, delete or change a setting, and she is never presented as a person.
// - Voice: off until they tap the mic. Speech to text is ElevenLabs Scribe; her voice is ElevenLabs TTS
//   (Lori = Eryn).
// - Per-account switch: setting guide:<email> = { enabled, name, voiceId, avatarUrl }. Off for everyone;
//   on for Frank only after Andrew has tried her himself. Where it's on, she replaces Ask Alex while signed in.
import Anthropic from "@anthropic-ai/sdk";
import express, { type Express, type Request, type RequestHandler } from "express";
import { storage } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { KNOWLEDGE, CHECKING, GET_BACK } from "./help.js";
import { learnedForAlex } from "./helpDesk.js";

const NOT_SURE = "I'm not sure about that one. Leave a note and someone will get back to you as soon as possible.";
import { runTool } from "./teamDesk.js";
import { GUIDE_TARGETS, guideTarget } from "../shared/guideTargets.js";

export const ERYN = "DXFkLCBUTmvXpp2QwZjA";
const OPEN = /\[\[OPEN:([a-z-]+)\]\]/;
const NAME = /\[\[NAME:([^\]]{1,24})\]\]/;
const HANDOFF = "[[HUMAN]]";
const PRIVATE = "[[PRIVATE]]";

export type GuideSettings = { enabled: boolean; name: string; voiceId: string; avatarUrl: string };
const key = (email: string) => `guide:${email.trim().toLowerCase()}`;
export async function guideFor(email: string): Promise<GuideSettings> {
  let v: Partial<GuideSettings> = {};
  try { v = JSON.parse((await storage.getSetting(key(email))) ?? "{}"); } catch { v = {}; }
  return { enabled: v.enabled === true, name: (v.name || "Alex").slice(0, 24), voiceId: v.voiceId || ERYN, avatarUrl: v.avatarUrl || "" };
}
const saveGuide = (email: string, g: GuideSettings) => storage.setSetting(key(email), JSON.stringify(g));
const cleanName = (s: unknown) => String(s ?? "").replace(new RegExp("[^\\p{L}\\p{N} '.-]", "gu"), "").replace(/\s+/g, " ").trim().slice(0, 24);

/** Spoken spellings (written text keeps the real ones). */
export const sayable = (v: string) => v.replace(/riccoh/gi, "Reeko").replace(/p[oō]stify/gi, "Post-ify").replace(/&/g, "and");

function prompt(name: string): string {
  return `You are ${name}, the AI guide inside MilitaryVoices.ai for the person signed in to this account. You are an AI guide, not a person: if asked, say so plainly. You help them use MilitaryVoices.ai: answer questions about their account and the platform, and offer to open the page that does what they want, then walk them through it.

How to answer:
- Plain text, warm and brief: one to three short sentences. Answer exactly what was asked, first.
- Use their account facts (below) when they help: their show, episodes, what's connected and what isn't. Never invent facts about the account.
- Use the on-screen labels exactly as the knowledge gives them. Write Pōstify with the ō. Say "SI" (never "AI") for the platform's own smart features; you yourself are an "AI guide".
- When one of the pages below does what they want, end with the exact token [[OPEN:<id>]] on its own. Don't ask "Want me to open it?" in your words: the card under your reply asks that. Offer one page at a time, only from this list, and only when it helps with what they asked: never offer to connect or set up something their account already has. You never click, change, pay, send, post or delete anything yourself: you open the page and point, and they do it. If they ask you to do one of those, say "That part's yours to press, but I can show you where it is." and offer the page. Never say "I'll do it for you" or "let me click".
- If they ask you to go by another name ("call you Sam"), say you'd be glad to, and end with the token [[NAME:<the name>]].
- If the question is about a charge, refund, payment or any money matter, a legal matter, a complaint, or press: reply with exactly "Someone will get back to you as soon as possible." and end with the exact token ${PRIVATE} on its own.
- If you don't know, or it needs something you can't see or do, or they ask for the team: reply with exactly "Hold on, let me check with the team." and end with the exact token ${HANDOFF} on its own.
- Never offer a person, a human or a call. Never ask for passwords or codes.

Pages you can open (id: label: what's there):
${GUIDE_TARGETS.map((x) => `- ${x.id}: ${x.label}: ${x.about}`).join("\n")}

KNOWLEDGE:
${KNOWLEDGE}`;
}

type Turn = { role: "user" | "assistant"; content: string };
export async function guideAnswer(turns: Turn[], g: GuideSettings, account: string, learned: string): Promise<{ text: string; handoff: boolean; sensitive: boolean; open?: string; rename?: string }> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 700,
    output_config: { effort: "low" },
    system: [
      { type: "text", text: prompt(g.name), cache_control: { type: "ephemeral" } },
      { type: "text", text: `THIS ACCOUNT (read only, right now):\n${account}` },
      ...(learned ? [{ type: "text" as const, text: learned }] : []),
    ],
    messages: turns as Anthropic.MessageParam[],
  });
  if (res.stop_reason === "refusal") return { text: GET_BACK, handoff: true, sensitive: true };
  let text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  const sensitive = text.includes(PRIVATE);
  const handoff = sensitive || text.includes(HANDOFF);
  const open = text.match(OPEN)?.[1];
  const rename = cleanName(text.match(NAME)?.[1]);
  text = text.replace(PRIVATE, "").replace(HANDOFF, "").replace(OPEN, "").replace(NAME, "").trim();
  if (sensitive) return { text: GET_BACK, handoff: true, sensitive: true };
  return { text: text || CHECKING, handoff, sensitive: false, ...(open && guideTarget(open) ? { open } : {}), ...(rename ? { rename } : {}) };
}

// A light brake per account: chat 60 an hour, voice 120 an hour.
const hits = new Map<string, number[]>();
const limited = (k: string, max: number) => {
  const now = Date.now(), recent = (hits.get(k) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now); hits.set(k, recent);
  return recent.length > max;
};
const eleven = () => (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim();
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();

export function registerGuide(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler): void {
  /** Is there a guide on this account? The panel shows only when enabled. */
  app.get("/api/guide/me", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const g = await guideFor(me(req));
    if (!g.enabled) return res.json({ enabled: false });
    res.json({ enabled: true, name: g.name, avatarUrl: g.avatarUrl, voice: !!eleven(), targets: GUIDE_TARGETS });
  });

  /** Settings → Your guide: rename her. */
  app.put("/api/guide/me", requireHostSession, async (req, res) => {
    const email = me(req), g = await guideFor(email);
    if (!g.enabled) return res.status(404).json({ message: "Not found." });
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ message: "Give your guide a name." });
    await saveGuide(email, { ...g, name });
    res.json({ name });
  });

  app.post("/api/guide/chat", requireHostSession, async (req, res) => {
    const email = me(req), g = await guideFor(email);
    if (!g.enabled) return res.status(404).json({ message: "Not found." });
    if (limited(`c:${email}`, 60)) return res.status(429).json({ message: "That's a lot at once. Give it a few minutes." });
    const turns: Turn[] = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-12)
      .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 1500).trim() }))
      .filter((m: Turn) => m.content);
    if (!turns.length || turns[turns.length - 1].role !== "user") return res.status(400).json({ message: "Ask something first." });
    try {
      const [account, learned] = await Promise.all([
        runTool("account_status", { email }, { who: `guide:${email}`, draft: null, links: [] }).catch(() => "{}"),
        learnedForAlex().catch(() => ""),
      ]);
      const out = await guideAnswer(turns, g, account, learned);
      if (out.rename) await saveGuide(email, { ...g, name: out.rename });
      // For Andrew's review of how she's doing: the last 40 exchanges on this account.
      try {
        const k = `guide:log:${email}`, log = JSON.parse((await storage.getSetting(k)) ?? "[]");
        log.unshift({ at: new Date().toISOString(), ask: turns[turns.length - 1].content.slice(0, 400), reply: out.text.slice(0, 600), open: out.open ?? "", handoff: out.handoff });
        await storage.setSetting(k, JSON.stringify(log.slice(0, 40)));
      } catch { /* the answer matters more than the log */ }
      // Don't-know path (PM, 21 Nov): no "let me check with the team" wait for a guide. The server sends the
      // line itself and the client shows the leave-a-note form under it.
      if (out.handoff && !out.sensitive) return res.json({ text: NOT_SURE, handoff: true });
      const target = out.open ? guideTarget(out.open) : undefined;
      res.json({ text: out.text, handoff: out.handoff, ...(target ? { offer: { id: target.id, label: target.label } } : {}), ...(out.rename ? { name: out.rename } : {}) });
    } catch (err) {
      console.error("guide chat failed:", (err as Error).message);
      res.json({ text: "I couldn't reach my notes just now. Leave your question and someone will get back to you as soon as possible.", handoff: true });
    }
  });

  /** Her voice: one reply read out (Eryn for Lori). */
  app.post("/api/guide/speak", requireHostSession, async (req, res) => {
    const email = me(req), g = await guideFor(email);
    if (!g.enabled || !eleven()) return res.status(404).json({ message: "Not found." });
    if (limited(`v:${email}`, 120)) return res.status(429).json({ message: "Give it a few minutes." });
    const text = sayable(String(req.body?.text ?? "").trim().slice(0, 700));
    if (!text) return res.status(400).json({ message: "Nothing to say." });
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${g.voiceId}?output_format=mp3_44100_64`, {
      method: "POST", headers: { "xi-api-key": eleven(), "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
    });
    if (!r.ok) { console.error("guide speak", r.status, (await r.text()).slice(0, 200)); return res.status(502).json({ message: "My voice isn't working just now." }); }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(await r.arrayBuffer()));
  });

  /** The mic: what they said, as text (ElevenLabs Scribe). The browser sends the recording as the body. */
  app.post("/api/guide/listen", requireHostSession, express.raw({ type: "*/*", limit: "4mb" }), async (req, res) => {
    const email = me(req), g = await guideFor(email);
    if (!g.enabled || !eleven()) return res.status(404).json({ message: "Not found." });
    if (limited(`v:${email}`, 120)) return res.status(429).json({ message: "Give it a few minutes." });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 500) return res.status(400).json({ message: "I didn't catch that. Try again." });
    const type = String(req.headers["content-type"] ?? "audio/webm").split(";")[0];
    const form = new FormData();
    form.append("model_id", "scribe_v1");
    form.append("language_code", "en");
    form.append("file", new Blob([new Uint8Array(body)], { type }), `speech.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`);
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": eleven() }, body: form });
    if (!r.ok) { console.error("guide listen", r.status, (await r.text()).slice(0, 200)); return res.status(502).json({ message: "I couldn't hear that just now. Try typing it." }); }
    const j = (await r.json()) as { text?: string };
    res.json({ text: String(j.text ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim() });
  });

  // ---- the switch (admin) ----
  app.get("/api/admin/guide/:email", requireAdmin, async (req, res) => {
    const email = String(req.params.email).toLowerCase();
    let log: unknown = [];
    try { log = JSON.parse((await storage.getSetting(`guide:log:${email}`)) ?? "[]"); } catch { /* none */ }
    res.json({ guide: await guideFor(email), log });
  });
  /** Try her on an account before switching her on: the same answer that account would get, nothing saved or sent. */
  app.post("/api/admin/guide/:email/try", requireAdmin, async (req, res) => {
    const email = String(req.params.email).toLowerCase();
    const turns: Turn[] = (Array.isArray(req.body?.messages) ? req.body.messages : [{ role: "user", content: String(req.body?.ask ?? "") }]).slice(-12)
      .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 1500).trim() }))
      .filter((m: Turn) => m.content);
    if (!turns.length || turns[turns.length - 1].role !== "user") return res.status(400).json({ message: "Ask something first." });
    const g = await guideFor(email);
    const account = await runTool("account_status", { email }, { who: "guide-try", draft: null, links: [] }).catch(() => "{}");
    const out = await guideAnswer(turns, { ...g, name: cleanName(req.body?.name) || g.name }, account, await learnedForAlex().catch(() => ""));
    res.json({ ...out, ...(out.open ? { offer: guideTarget(out.open) } : {}) });
  });
  app.put("/api/admin/guide/:email", requireAdmin, async (req, res) => {
    const email = String(req.params.email).toLowerCase();
    if (!email.includes("@")) return res.status(400).json({ message: "Give an email address." });
    const g = await guideFor(email);
    const next: GuideSettings = {
      enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : g.enabled,
      name: cleanName(req.body?.name) || g.name,
      voiceId: /^[A-Za-z0-9]{20}$/.test(String(req.body?.voiceId ?? "")) ? String(req.body.voiceId) : g.voiceId,
      avatarUrl: /^https:\/\//.test(String(req.body?.avatarUrl ?? "")) ? String(req.body.avatarUrl).slice(0, 500) : req.body?.avatarUrl === "" ? "" : g.avatarUrl,
    };
    await saveGuide(email, next);
    res.json({ guide: next });
  });
}
