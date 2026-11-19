// The MilitaryVoices browser extension (19 Nov 2026): what it can ask of the signed-in podcaster's account.
//   /api/ext/me       who is signed in (the extension shows "sign in" when it isn't)
//   /api/ext/capture  "Add to my show": a person found on any page, saved to Invite a guest
//   /api/ext/import   "Send to my Library": a direct video link, brought in like an import-link recording
//   /api/ext/prep     "Prep me for this guest": Alex's one-page briefing from the page the person is on
// The extension sends the session cookie (it has permission for this site), so these use the same sign-in as the dashboard.
import crypto from "node:crypto";
import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage.js";
import type { NextFunction, Request, Response } from "express";
import { getAdminEmail, getSessionEmail, requireHostSession } from "./session.js";

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
