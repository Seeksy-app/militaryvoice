// A creator's own studio: open any time to record their podcast (or just film something),
// with guests on an invite link, and go live to their YouTube or any streaming key. A LiveKit
// room of its own (my-<id>), apart from the event studio, so nothing here touches the marathon.
// Recordings land in their Library like any studio recording: the egress_ended webhook finishes
// them by egress id.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, isRecordingConfigured, publicLiveKitUrl, startBroadcast, startSegmentRecording, stopEgressById, studioToken, runningEgressIds } from "./livekit.js";
import { ensureRecordingsBucket } from "./recordingStorage.js";
import { createBroadcast } from "./youtube.js";
import { personalStudios, type PersonalStudioRow } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
const newToken = () => crypto.randomBytes(12).toString("base64url");

type Stream = { id: string; name: string; url: string; key: string; on: boolean };
const streamsOf = (s: PersonalStudioRow): Stream[] => { try { return JSON.parse(s.streams || "[]") as Stream[]; } catch { return []; } };
/** The address and key as one push URL, however they were pasted. */
const pushUrl = (x: Stream) => (x.key ? `${x.url.replace(/\/+$/, "")}/${x.key}` : x.url);

async function mine(email: string): Promise<PersonalStudioRow> {
  await schemaIsReady();
  const [row] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  if (row) return row;
  const profile = await storage.getProfileByEmail(email).catch(() => undefined);
  const name = profile?.podcastName?.trim() || profile?.hostName?.trim() || "My room";
  const [made] = await db.insert(personalStudios).values({ ownerEmail: email, name, inviteToken: newToken(), createdAt: now() }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  return again;
}
const room = (s: PersonalStudioRow) => `my-${s.id}`;

/** Recording and live flags checked against LiveKit, so a stopped egress never shows as running. */
async function settle(s: PersonalStudioRow): Promise<PersonalStudioRow> {
  if (!s.recordingEgressId && !s.liveEgressId) return s;
  const running = await runningEgressIds().catch(() => null);
  if (!running) return s;
  const patch: Partial<PersonalStudioRow> = {};
  if (s.recordingEgressId && !running.has(s.recordingEgressId)) Object.assign(patch, { recordingEgressId: "", recordingSince: "" });
  if (s.liveEgressId && !running.has(s.liveEgressId)) Object.assign(patch, { liveEgressId: "", liveSince: "", liveWatchUrl: "" });
  if (!Object.keys(patch).length) return s;
  const [out] = await db.update(personalStudios).set(patch).where(eq(personalStudios.id, s.id)).returning();
  return out;
}

export function registerMyStudio(app: Express, requireHostSession: RequestHandler, deps: { youtubeToken: (email: string) => Promise<string | null> }) {
  const view = (s: PersonalStudioRow, youtube: boolean) => ({
    id: s.id,
    name: s.name,
    inviteLink: `${ORIGIN}/room/join/${s.inviteToken}`,
    recording: s.recordingEgressId ? { since: s.recordingSince } : null,
    live: s.liveEgressId ? { since: s.liveSince, watchUrl: s.liveWatchUrl } : null,
    youtube,
    youtubeOn: s.youtubeOn,
    streams: streamsOf(s).map(({ key, ...x }) => ({ ...x, key: key ? `••••${key.slice(-4)}` : "" })),
    ready: isLiveKitConfigured(),
    canRecord: isRecordingConfigured(),
  });

  app.get("/api/host/my-studio", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = me(req);
    const s = await settle(await mine(email));
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    // Their own name, for the camera check's name box.
    res.json({ ...view(s, !!(await storage.getYoutubeAccount(email).catch(() => undefined))), you: profile?.hostName?.trim() || "" });
  });

  app.patch("/api/host/my-studio", requireHostSession, async (req, res) => {
    const email = me(req);
    const s = await mine(email);
    const b = req.body ?? {};
    const patch: Partial<PersonalStudioRow> = {};
    if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
    if (typeof b.youtubeOn === "boolean") patch.youtubeOn = b.youtubeOn;
    // Streaming keys: add one, switch one on or off, or remove one. Keys never come back in full.
    let streams = streamsOf(s);
    if (b.addStream && typeof b.addStream === "object") {
      const url = String(b.addStream.url ?? "").trim();
      if (!/^rtmps?:\/\/\S+$/i.test(url)) return res.status(400).json({ message: "The server address starts rtmp:// (or rtmps://)." });
      streams = [...streams, { id: newToken().slice(0, 8), name: String(b.addStream.name ?? "").trim().slice(0, 40) || "Custom", url, key: String(b.addStream.key ?? "").trim().slice(0, 300), on: true }].slice(0, 6);
    }
    if (typeof b.toggleStream === "string") streams = streams.map((x) => (x.id === b.toggleStream ? { ...x, on: !x.on } : x));
    if (typeof b.removeStream === "string") streams = streams.filter((x) => x.id !== b.removeStream);
    patch.streams = JSON.stringify(streams);
    if (b.newInvite === true) patch.inviteToken = newToken();
    const [out] = await db.update(personalStudios).set(patch).where(eq(personalStudios.id, s.id)).returning();
    res.json(view(out, !!(await storage.getYoutubeAccount(email).catch(() => undefined))));
  });

  /** The owner into their room: publishes, and runs it. */
  app.post("/api/host/my-studio/token", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "Rooms aren't switched on yet." });
    const email = me(req);
    const s = await mine(email);
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    const name = String(req.body?.name ?? "").trim().slice(0, 60) || profile?.hostName || email.split("@")[0];
    const token = await studioToken({ room: room(s), identity: `owner-${s.id}-${crypto.randomBytes(3).toString("hex")}`, name, canPublish: true, admin: true, attributes: { role: "host" } });
    res.json({ url: publicLiveKitUrl(), token, name: s.name });
  });

  /** A guest on the invite link: no account, just a name. */
  app.get("/api/my-studio/invite/:token", async (req, res) => {
    await schemaIsReady();
    const [s] = await db.select().from(personalStudios).where(eq(personalStudios.inviteToken, String(req.params.token))).limit(1);
    if (!s) return res.status(404).json({ message: "This invite link has expired. Ask the host for a new one." });
    res.json({ name: s.name });
  });
  app.post("/api/my-studio/invite/:token/token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "Rooms aren't switched on yet." });
    const [s] = await db.select().from(personalStudios).where(eq(personalStudios.inviteToken, String(req.params.token))).limit(1);
    if (!s) return res.status(404).json({ message: "This invite link has expired. Ask the host for a new one." });
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ message: "Your name, please." });
    const token = await studioToken({ room: room(s), identity: `guest-${crypto.randomBytes(5).toString("hex")}`, name, canPublish: true, attributes: { role: "guest" } });
    res.json({ url: publicLiveKitUrl(), token, name: s.name });
  });

  /** Record: the whole room, to an MP4 in their Library. */
  app.post("/api/host/my-studio/record", requireHostSession, async (req, res) => {
    const email = me(req);
    let s = await settle(await mine(email));
    const on = req.body?.on === true;
    try {
      if (on && !s.recordingEgressId) {
        if (!isRecordingConfigured()) return res.status(503).json({ message: "Recording isn't switched on yet." });
        await ensureRecordingsBucket();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filepath = `personal/${s.id}/${stamp}.mp4`;
        const egressId = await startSegmentRecording(room(s), filepath);
        const title = `${s.name} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}`;
        // A Library recording like an upload's: no event, no studio row, theirs by email.
        await storage.createRecording({ eventId: 0, studioId: 0, signupId: null, email, title, egressId, filepath });
        [s] = await db.update(personalStudios).set({ recordingEgressId: egressId, recordingSince: now() }).where(eq(personalStudios.id, s.id)).returning();
      } else if (!on && s.recordingEgressId) {
        await stopEgressById(s.recordingEgressId).catch(() => {});
        [s] = await db.update(personalStudios).set({ recordingEgressId: "", recordingSince: "" }).where(eq(personalStudios.id, s.id)).returning();
      }
      res.json(view(s, !!(await storage.getYoutubeAccount(email).catch(() => undefined))));
    } catch (err) {
      console.error("My studio record failed:", err);
      res.status(502).json({ message: "The recorder didn't start. Make sure someone's camera is on, then try again." });
    }
  });

  /** Go live: the room to their YouTube (a new broadcast) and any streaming keys that are on. */
  app.post("/api/host/my-studio/live", requireHostSession, async (req, res) => {
    const email = me(req);
    let s = await settle(await mine(email));
    const on = req.body?.on === true;
    try {
      if (on && !s.liveEgressId) {
        const targets: { url: string }[] = streamsOf(s).filter((x) => x.on).map((x) => ({ url: pushUrl(x) }));
        let watchUrl = "";
        if (s.youtubeOn) {
          const token = await deps.youtubeToken(email);
          if (token) {
            const title = String(req.body?.title ?? "").trim().slice(0, 100) || s.name;
            const b = await createBroadcast(token, { title, startAtIso: now(), privacy: req.body?.privacy === "unlisted" ? "unlisted" : "public" });
            targets.push({ url: `${b.ingestAddress.replace(/\/+$/, "")}/${b.streamName}` });
            watchUrl = b.watchUrl;
          }
        }
        if (!targets.length) return res.status(400).json({ message: "Connect YouTube or add a streaming key first." });
        const egressId = await startBroadcast(room(s), targets as never);
        [s] = await db.update(personalStudios).set({ liveEgressId: egressId, liveSince: now(), liveWatchUrl: watchUrl }).where(eq(personalStudios.id, s.id)).returning();
      } else if (!on && s.liveEgressId) {
        await stopEgressById(s.liveEgressId).catch(() => {});
        [s] = await db.update(personalStudios).set({ liveEgressId: "", liveSince: "", liveWatchUrl: "" }).where(eq(personalStudios.id, s.id)).returning();
      }
      res.json(view(s, !!(await storage.getYoutubeAccount(email).catch(() => undefined))));
    } catch (err) {
      console.error("My studio live failed:", err);
      const msg = (err as Error).message ?? "";
      res.status(502).json({ message: /live streaming is not enabled|liveStreamingNotEnabled/i.test(msg) ? "Live streaming isn't turned on for your YouTube channel yet. Turn it on in YouTube Studio (it can take a day), or use a streaming key." : "Going live didn't start. Try again in a moment." });
    }
  });
}
