// Send new recordings to my editor (7 Oct 2026). Frank records on Zoom and
// sends the raw video to a production team that adds his intro, outro and a
// teaser. With this on, each recording that comes in by itself (Zoom, or the
// import link) is emailed to his editors as a download link that needs no
// account, and he can send any recording from the Library by hand.
import crypto from "node:crypto";
import type { Express, RequestHandler, Request } from "express";
import { storage } from "./storage.js";
import { sendEditorRecordingEmail } from "./email.js";
import { signedRecordingDownload } from "./recordingStorage.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const SECRET = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
const DAYS = 7;
const MAX = 3;
const key = (email: string) => `editor_send:${email}`;
const meOf = (req: Request) => String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export interface EditorSend { on: boolean; emails: string[] }
export async function editorSendOf(email: string): Promise<EditorSend> {
  try {
    const v = JSON.parse((await storage.getSetting(key(email))) || "{}") as Partial<EditorSend>;
    return { on: v.on === true, emails: Array.isArray(v.emails) ? v.emails.filter((e) => typeof e === "string" && isEmail(e)).slice(0, MAX) : [] };
  } catch { return { on: false, emails: [] }; }
}

/** A link to one recording that works for a week, without signing in. */
function tokenFor(id: number): string {
  const body = Buffer.from(JSON.stringify({ r: id, x: Date.now() + DAYS * 86400e3 })).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(`editor:${body}`).digest("base64url").slice(0, 32);
  return `${body}.${mac}`;
}
function readToken(t: string): number | null {
  const [body, mac] = t.split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", SECRET).update(`editor:${body}`).digest("base64url").slice(0, 32);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { r?: number; x?: number };
    return v.r && v.x && v.x > Date.now() ? v.r : null;
  } catch { return null; }
}

type Rec = { id: number; email: string; title: string; startedAt: string; durationSec: number };
async function mailEditors(rec: Rec, to: string[]): Promise<number> {
  const profile = await storage.getProfileByEmail(rec.email).catch(() => undefined);
  const link = `${ORIGIN}/api/editor/recording/${tokenFor(rec.id)}`;
  let sent = 0;
  for (const addr of to) {
    const ok = await sendEditorRecordingEmail({ to: addr, hostName: profile?.hostName || profile?.podcastName || "", hostEmail: rec.email, title: rec.title, startedAt: rec.startedAt, durationSec: rec.durationSec, link, days: DAYS })
      .catch((e) => { console.error("Editor email failed:", (e as Error).message); return false; });
    if (ok) sent++;
  }
  return sent;
}

/** After a recording came in by itself: to their editors, if they asked. Never throws. */
export async function sendToEditors(rec: Rec | null | undefined): Promise<void> {
  if (!rec?.email) return;
  try {
    const s = await editorSendOf(rec.email);
    if (s.on && s.emails.length) await mailEditors(rec, s.emails);
  } catch (e) { console.error("Editor send failed:", (e as Error).message); }
}

export function registerEditorSend(app: Express, requireHostSession: RequestHandler) {
  app.get("/api/host/editor-send", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await editorSendOf(meOf(req)));
  });

  app.put("/api/host/editor-send", requireHostSession, async (req, res) => {
    const raw: unknown[] = Array.isArray(req.body?.emails) ? req.body.emails : [];
    const emails = Array.from(new Set(raw.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean)));
    const bad = emails.find((e) => !isEmail(e));
    if (bad) return res.status(400).json({ message: `"${bad}" doesn't look like an email address.` });
    if (emails.length > MAX) return res.status(400).json({ message: `Up to ${MAX} editors.` });
    const v: EditorSend = { on: req.body?.on === true && emails.length > 0, emails };
    await storage.setSetting(key(meOf(req)), JSON.stringify(v));
    res.json(v);
  });

  /** Send one recording to the editors now, from the Library. */
  app.post("/api/host/recordings/:id/send-editor", requireHostSession, async (req, res) => {
    const me = meOf(req);
    const row = await storage.getRecording(Number(req.params.id));
    if (!row || row.email !== me || row.status !== "Ready" || !row.url) return res.status(404).json({ message: "That recording isn't ready." });
    const s = await editorSendOf(me);
    if (!s.emails.length) return res.status(400).json({ message: "Add your editor's email first." });
    const sent = await mailEditors(row, s.emails);
    if (!sent) return res.status(502).json({ message: "The email didn't go. Try again in a moment." });
    res.json({ sent, to: s.emails });
  });

  /** The editor's link: a fresh signed download, for a week from the email. */
  app.get("/api/editor/recording/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = readToken(String(req.params.token));
    const row = id ? await storage.getRecording(id) : undefined;
    if (!row || row.status !== "Ready" || !row.url) {
      return res.status(410).type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Link expired</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 16px;color:#0b1220"><h1 style="font-size:22px">This link has expired</h1><p>Download links last ${DAYS} days. Reply to the email it came in and ask for a fresh one.</p></body>`);
    }
    const name = `${(row.title || "recording").replace(/[\\/:*?"<>|]+/g, " ").trim()}.mp4`;
    res.redirect(302, await signedRecordingDownload(row.url, name));
  });
}
