import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { storage } from "./storage.js";
import { getSessionEmail, requireHostSession } from "./session.js";
import type { ZoomConnectionRow } from "../shared/schema.js";

/**
 * Zoom, connected per podcaster (OAuth, a Zoom Marketplace app). Their cloud
 * recordings come into the Library: new ones on their own when Zoom says a
 * recording is finished (the recording.completed event), past ones picked
 * from a list. The download itself is the worker's (an hour of video is too
 * big for a function): a recording waits as "Importing" until it's fetched.
 *
 * Env: ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (OAuth), ZOOM_WEBHOOK_SECRET (the
 * app's "Secret Token" for event notifications).
 */

const id = () => process.env.ZOOM_CLIENT_ID || "";
const secret = () => process.env.ZOOM_CLIENT_SECRET || "";
export const zoomReady = () => Boolean(id() && secret());
const origin = (req: Request) => (process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
const redirectUri = (req: Request) => `${origin(req)}/api/zoom/callback`;
const basic = () => `Basic ${Buffer.from(`${id()}:${secret()}`).toString("base64")}`;

/** The OAuth state: who started it and when, signed, so the callback can't be replayed for someone else. */
function signState(email: string): string {
  const body = Buffer.from(JSON.stringify({ e: email, t: Date.now() })).toString("base64url");
  const mac = crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev-only").update(body).digest("base64url");
  return `${body}.${mac}`;
}
function readState(state: string): string | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev-only").update(body).digest("base64url");
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const { e, t } = JSON.parse(Buffer.from(body, "base64url").toString()) as { e: string; t: number };
  return Date.now() - t < 15 * 60_000 ? e : null;
}

async function tokenRequest(form: Record<string, string>) {
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; reason?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Zoom token: ${j.reason || j.error || res.status}`);
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? "", expiresAt: new Date(Date.now() + ((j.expires_in ?? 3600) - 120) * 1000).toISOString() };
}

/** A working access token for this connection, refreshed (and saved) when it's near its hour. */
export async function zoomAccessToken(c: ZoomConnectionRow): Promise<string> {
  if (Date.parse(c.expiresAt) > Date.now()) return c.accessToken;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken });
  await storage.updateZoom(c.email, { accessToken: t.accessToken, refreshToken: t.refreshToken || c.refreshToken, expiresAt: t.expiresAt });
  return t.accessToken;
}

async function zoomApi<T>(c: ZoomConnectionRow, path: string): Promise<T> {
  const res = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${await zoomAccessToken(c)}` } });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`Zoom: ${(j as { message?: string }).message || res.status}`);
  return j;
}

interface ZoomFile { id: string; file_type: string; file_size?: number; download_url: string; recording_type?: string; status?: string }
interface ZoomMeeting { uuid: string; id: number | string; topic: string; start_time: string; duration: number; host_id?: string; recording_files?: ZoomFile[] }

/** The one video to keep from a meeting: the speaker with the shared screen, else the speaker, else any finished MP4. */
export function bestZoomFile(m: ZoomMeeting): ZoomFile | undefined {
  const mp4s = (m.recording_files ?? []).filter((f) => f.file_type === "MP4" && (!f.status || f.status === "completed"));
  const order = ["shared_screen_with_speaker_view", "active_speaker", "speaker_view", "shared_screen_with_gallery_view", "gallery_view", "shared_screen"];
  return [...mp4s].sort((a, b) => (order.indexOf(a.recording_type ?? "") + 99) % 99 - (order.indexOf(b.recording_type ?? "") + 99) % 99)[0];
}

async function queue(email: string, m: ZoomMeeting, downloadToken?: string) {
  const f = bestZoomFile(m);
  if (!f) return undefined;
  return storage.queueImport({
    email,
    title: m.topic || "Zoom recording",
    egressId: `ZOOM_${f.id}`,
    startedAt: new Date(m.start_time || Date.now()).toISOString(),
    durationSec: (m.duration || 0) * 60,
    sizeBytes: f.file_size ?? 0,
    source: JSON.stringify({ provider: "zoom", url: f.download_url, fileId: f.id, meetingId: String(m.id), token: downloadToken || undefined }),
  });
}

/** For the worker: where to fetch an Importing recording from, with the auth it needs right now. */
export async function importFetch(rec: { email: string; importSource: string }): Promise<{ url: string; headers: Record<string, string> } | null> {
  let s: { provider?: string; url?: string; token?: string } = {};
  try { s = JSON.parse(rec.importSource); } catch { return null; }
  if (s.provider !== "zoom" || !s.url) return null;
  const c = await storage.getZoom(rec.email);
  if (c) return { url: s.url, headers: { Authorization: `Bearer ${await zoomAccessToken(c)}` } };
  // Disconnected since: the event's own download token still works for a day.
  return s.token ? { url: `${s.url}${s.url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(s.token)}`, headers: {} } : null;
}

function signedByZoom(req: Request): boolean {
  const key = process.env.ZOOM_WEBHOOK_SECRET || "";
  const raw = (req as any).rawBody as Buffer | undefined;
  const ts = req.get("x-zm-request-timestamp") ?? "";
  const sig = req.get("x-zm-signature") ?? "";
  if (!key || !raw || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = `v0=${crypto.createHmac("sha256", key).update(`v0:${ts}:${raw.toString("utf8")}`).digest("hex")}`;
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

export function registerZoom(app: Express): void {
  app.get("/api/host/zoom", requireHostSession, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const c = await storage.getZoom(getSessionEmail(req) ?? "");
    res.json({ configured: zoomReady(), connected: !!c, zoomEmail: c?.zoomEmail ?? "", autoImport: c?.autoImport ?? true });
  });

  /** Off to Zoom to approve; back at /api/zoom/callback. */
  app.get("/api/host/zoom/connect", requireHostSession, (req, res) => {
    if (!zoomReady()) return res.status(503).send("Zoom isn't switched on yet.");
    const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
    const q = new URLSearchParams({ response_type: "code", client_id: id(), redirect_uri: redirectUri(req), state: signState(email) });
    res.redirect(302, `https://zoom.us/oauth/authorize?${q}`);
  });

  app.get("/api/zoom/callback", async (req: Request, res: Response) => {
    const back = (s: string) => res.redirect(302, `/host/dashboard/integrations?zoom=${s}`);
    const email = readState(String(req.query.state ?? ""));
    const session = (getSessionEmail(req) ?? "").trim().toLowerCase();
    if (!email || (session && session !== email)) return back("expired");
    if (req.query.error || !req.query.code) return back("declined");
    try {
      const t = await tokenRequest({ grant_type: "authorization_code", code: String(req.query.code), redirect_uri: redirectUri(req) });
      const me = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${t.accessToken}` } }).then((r) => r.json()) as { id?: string; email?: string; account_id?: string };
      if (!me.id) throw new Error("no Zoom user");
      await storage.upsertZoom({ email, zoomUserId: me.id, zoomAccountId: me.account_id ?? "", zoomEmail: me.email ?? "", accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt });
      back("connected");
    } catch (err) {
      console.error("Zoom connect failed:", (err as Error).message);
      back("failed");
    }
  });

  app.post("/api/host/zoom/auto", requireHostSession, async (req, res) => {
    await storage.updateZoom(getSessionEmail(req) ?? "", { autoImport: req.body?.on !== false });
    res.json({ ok: true });
  });

  app.delete("/api/host/zoom", requireHostSession, async (req, res) => {
    const email = getSessionEmail(req) ?? "";
    const c = await storage.getZoom(email);
    if (c) {
      await fetch("https://zoom.us/oauth/revoke", { method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: c.accessToken }).toString() }).catch(() => {});
      await storage.deleteZoom(email);
    }
    res.json({ ok: true });
  });

  /** Their cloud recordings from the last 30 days (Zoom's own limit per ask), newest first. */
  app.get("/api/host/zoom/recordings", requireHostSession, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const c = await storage.getZoom(getSessionEmail(req) ?? "");
    if (!c) return res.status(404).json({ message: "Connect Zoom first." });
    try {
      const to = new Date();
      const from = new Date(Date.now() - 30 * 86_400_000);
      const d = (x: Date) => x.toISOString().slice(0, 10);
      const j = await zoomApi<{ meetings?: ZoomMeeting[] }>(c, `/users/me/recordings?page_size=50&from=${d(from)}&to=${d(to)}`);
      const mine = await storage.listRecordingsByEmail(c.email);
      const have = new Set(mine.map((r) => r.egressId));
      res.json((j.meetings ?? []).map((m) => {
        const f = bestZoomFile(m);
        return { meetingId: String(m.id), uuid: m.uuid, topic: m.topic, startTime: m.start_time, durationMin: m.duration, sizeBytes: f?.file_size ?? 0, importable: !!f, imported: f ? have.has(`ZOOM_${f.id}`) : false };
      }).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)));
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  /** Bring one past recording in. */
  app.post("/api/host/zoom/import", requireHostSession, async (req, res) => {
    const c = await storage.getZoom(getSessionEmail(req) ?? "");
    if (!c) return res.status(404).json({ message: "Connect Zoom first." });
    try {
      // The meeting's own recordings: a UUID starting with / or containing // is double-encoded, as Zoom asks.
      const uuid = String(req.body?.uuid ?? "");
      const idOrUuid = /^\/|\/\//.test(uuid) ? encodeURIComponent(encodeURIComponent(uuid)) : encodeURIComponent(uuid || String(req.body?.meetingId ?? ""));
      const m = await zoomApi<ZoomMeeting>(c, `/meetings/${idOrUuid}/recordings`);
      const row = await queue(c.email, m);
      if (!row) return res.status(409).json({ message: "Already in your Library, or no video in that recording." });
      res.status(201).json({ id: row.id });
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  /**
   * Zoom's event notifications: the endpoint check, a finished recording
   * (into the Library when they've left auto-import on), and the app being
   * removed from their Zoom (the connection goes, as Zoom requires).
   */
  app.post("/api/webhooks/zoom", async (req, res) => {
    const b = req.body ?? {};
    if (b.event === "endpoint.url_validation") {
      const plain = String(b.payload?.plainToken ?? "");
      const key = process.env.ZOOM_WEBHOOK_SECRET || "";
      return res.json({ plainToken: plain, encryptedToken: crypto.createHmac("sha256", key).update(plain).digest("hex") });
    }
    if (!signedByZoom(req)) return res.status(401).json({ message: "Unsigned." });
    try {
      if (b.event === "recording.completed") {
        const m = b.payload?.object as ZoomMeeting | undefined;
        if (m?.host_id) {
          for (const c of await storage.getZoomsByUserId(m.host_id)) {
            if (c.autoImport) await queue(c.email, m, b.download_token);
          }
        }
      }
      if (b.event === "app_deauthorized") {
        const who = String(b.payload?.user_id ?? "");
        if (who) await storage.deleteZoomsByUserId(who);
      }
    } catch (err) {
      console.error("Zoom event failed:", (err as Error).message);
      return res.status(500).json({ message: "Try again." });
    }
    res.json({ ok: true });
  });
}
