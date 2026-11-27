// Send us a recording (27 Nov 2026, Andrew: "put a place where he can put the link of the show and the password").
//
// A podcaster pastes a share link (Zoom, Dropbox, Google Drive, anything) for one of their shows, with an optional
// passcode and note. The link and passcode are stored sealed (AES-256-GCM, the share-login key), never in plain text,
// never in a log line or an email; Slack hears which show sent one, not the link. An admin reads it on /admin-logins
// (reveal answers with res.send, which the JSON logger doesn't capture), marks it Picked up, then In your Library,
// which forgets the link and passcode. Delete wipes the whole row. No automatic downloads.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { slackNote } from "./slack.js";
import { seal, open } from "./shareLogin.js";
import { hostedShows, siteSettings } from "../shared/schema.js";

const PREFIX = "recin:";
const str = (v: unknown, n: number) => (typeof v === "string" ? v : "").trim().slice(0, n);
const ID = /^[A-Za-z0-9_-]{20,40}$/;

export type RecordingInStatus = "sent" | "picked" | "library";
interface Row {
  email: string;
  showId: number;
  showTitle: string;
  /** Where the link points (zoom.us, dropbox.com…), so the lists can say what it is without the link. */
  site: string;
  note: string;
  hasPasscode: boolean;
  status: RecordingInStatus;
  createdAt: string;
  pickedAt?: string;
  libraryAt?: string;
  revealedAt?: string;
  /** iv.tag.ciphertext of {link, passcode}; gone once it's in their Library. */
  box?: string;
}

/** A pasted share link: http(s) only, no spaces. Returns the cleaned link and its site, or null. */
export function checkLink(raw: string): { link: string; site: string } | null {
  const v = raw.trim();
  if (!v || v.length > 1000 || /\s/.test(v)) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return { link: u.toString(), site: u.hostname.replace(/^www\./, "").toLowerCase() };
  } catch {
    return null;
  }
}

async function load(id: string): Promise<Row | null> {
  if (!ID.test(id)) return null;
  const raw = await storage.getSetting(PREFIX + id);
  try { return raw ? (JSON.parse(raw) as Row) : null; } catch { return null; }
}
const save = (id: string, r: Row) => storage.setSetting(PREFIX + id, JSON.stringify(r));
async function all(): Promise<(Row & { id: string })[]> {
  const rows = await db.select().from(siteSettings).where(like(siteSettings.key, `${PREFIX}%`));
  return rows
    .flatMap((row) => { try { return [{ ...(JSON.parse(row.value) as Row), id: row.key.slice(PREFIX.length) }]; } catch { return []; } })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** What the podcaster sees of one: never the link or the passcode. */
const mineView = (r: Row & { id: string }) => ({ id: r.id, showId: r.showId, site: r.site, note: r.note, status: r.status, createdAt: r.createdAt });

export function registerRecordingIn(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler): void {
  const me = (req: Parameters<RequestHandler>[0]) => (getSessionEmail(req) ?? "").trim().toLowerCase();

  // ── The podcaster's side ───────────────────────────────────────────────
  app.get("/api/host/recordings-in", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = me(req);
    const showId = Number(req.query.showId) || 0;
    const rows = (await all()).filter((r) => r.email === email && (!showId || r.showId === showId)).slice(0, 20);
    res.json(rows.map(mineView));
  });

  app.post("/api/host/recordings-in", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = me(req);
    if (!email) return res.status(401).json({ message: "Please sign in again." });
    const showId = Number(req.body?.showId) || 0;
    const [show] = await db.select().from(hostedShows).where(and(eq(hostedShows.id, showId), eq(hostedShows.email, email))).limit(1);
    if (!show) return res.status(404).json({ message: "We couldn't find that show." });
    const checked = checkLink(str(req.body?.link, 1200));
    if (!checked) return res.status(400).json({ message: "Paste the full share link, starting with https://" });
    const passcode = str(req.body?.passcode, 200);
    const note = str(req.body?.note, 300);
    const mine = (await all()).filter((r) => r.email === email);
    const today = new Date().toISOString().slice(0, 10);
    if (mine.filter((r) => r.createdAt.startsWith(today)).length >= 20) return res.status(429).json({ message: "That's a lot for one day. Please write to us and we'll help." });
    let box: string;
    try {
      box = seal(JSON.stringify({ link: checked.link, passcode }));
    } catch {
      return res.status(503).json({ message: "We can't take this right now. Please write to hello@militaryvoices.ai and we'll find another way." });
    }
    const id = crypto.randomBytes(18).toString("base64url");
    const row: Row = { email, showId: show.id, showTitle: show.title || "Untitled show", site: checked.site, note, hasPasscode: !!passcode, status: "sent", createdAt: new Date().toISOString(), box };
    await save(id, row);
    // The team hears which show and where the link points, never the link or the passcode.
    void slackNote(
      `:inbox_tray: ${row.showTitle} (${email}) sent a recording: a ${checked.site} link${passcode ? " with a passcode" : ""}.${note ? ` Note: ${note}` : ""}`,
      { label: "Open recordings sent in", url: "/admin-logins" },
    );
    res.json(mineView({ ...row, id }));
  });

  // ── The team's side ────────────────────────────────────────────────────
  app.get("/api/admin/recordings-in", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json((await all()).map(({ box, ...r }) => ({ ...r, stored: !!box })));
  });

  // The link and passcode. res.send, not res.json: the JSON logger writes every json answer to the server log.
  app.get("/api/admin/recordings-in/:id/reveal", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = String(req.params.id ?? "");
    const r = await load(id);
    if (!r?.box) return res.status(404).json({ message: "The link isn't stored any more." });
    try {
      const plain = open(r.box);
      r.revealedAt = new Date().toISOString();
      await save(id, r);
      res.type("application/json").send(plain);
    } catch {
      res.status(500).json({ message: "Couldn't open that one." });
    }
  });

  /** Picked up, then In your Library. In your Library forgets the link and passcode: nothing left to read. */
  app.post("/api/admin/recordings-in/:id/status", requireAdmin, async (req, res) => {
    const id = String(req.params.id ?? "");
    const r = await load(id);
    if (!r) return res.status(404).json({ message: "Not found." });
    const to = String(req.body?.status ?? "");
    if (to !== "sent" && to !== "picked" && to !== "library") return res.status(400).json({ message: "Status is sent, picked or library." });
    r.status = to;
    const t = new Date().toISOString();
    if (to === "picked") r.pickedAt ||= t;
    if (to === "library") { r.pickedAt ||= t; r.libraryAt = t; delete r.box; }
    await save(id, r);
    res.json({ ok: true, status: r.status });
  });

  app.delete("/api/admin/recordings-in/:id", requireAdmin, async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ID.test(id)) return res.status(400).json({ message: "Not one of ours." });
    await db.delete(siteSettings).where(eq(siteSettings.key, PREFIX + id));
    res.json({ ok: true });
  });
}
