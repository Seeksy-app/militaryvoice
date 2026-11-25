// A creator's own studio: open any time to record their podcast (or just film something),
// with guests on an invite link, and go live to their YouTube or any streaming key. A LiveKit
// room of its own (my-<id>), apart from the event studio, so nothing here touches the marathon.
// Recordings land in their Library like any studio recording: the egress_ended webhook finishes
// them by egress id.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { eq, ne, or } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, isRecordingConfigured, publicLiveKitUrl, startBroadcast, startSegmentRecording, stopEgressById, studioToken, runningEgressIds, rooms } from "./livekit.js";
import { sendStudioLeftLiveEmail } from "./email.js";
import { ensureRecordingsBucket } from "./recordingStorage.js";
import { createBroadcast } from "./youtube.js";
import { getYoutubeKey, youtubeKeyHint, youtubePushUrl, YOUTUBE_OAUTH } from "./youtubeKey.js";
import { onLookSaved, roomLookKey } from "./roomKit.js";
import { liveHandleOf, livePageOn, liveUrlOf } from "./livePage.js";
import { bumpLookRev, noteMusicOnAir, registerRoomStage, roomTemplateUrl, useRoomKit, v3For } from "./roomStage.js";
import { personalStudios, type PersonalStudioRow } from "../shared/schema.js";
import { inviteShow, ownerShows, studioShow, studioShowKey, studioTitle } from "./hostShows.js";
import { registerStudioSetups } from "./studioSetups.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
const newToken = () => crypto.randomBytes(12).toString("base64url");

type Stream = { id: string; name: string; url: string; key: string; on: boolean };
const streamsOf = (s: PersonalStudioRow): Stream[] => { try { return JSON.parse(s.streams || "[]") as Stream[]; } catch { return []; } };
/** The address and key as one push URL, however they were pasted. */
const pushUrl = (x: Stream) => (x.key ? `${x.url.replace(/\/+$/, "")}/${x.key}` : x.url);
/**
 * Where their live shows go besides their MilitaryVoices page: YouTube (their stream key, when YouTube is on) and every
 * other key that's switched on. Stream in uses this too, so a show sent from StreamYard goes to the same places (22 Nov).
 */
export async function liveTargetsOf(email: string): Promise<string[]> {
  const [s] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email.trim().toLowerCase())).limit(1);
  const out = s ? streamsOf(s).filter((x) => x.on).map(pushUrl) : [];
  const key = !s || s.youtubeOn ? await getYoutubeKey(email).catch(() => "") : "";
  if (key) out.push(youtubePushUrl(key));
  return out;
}

async function mine(email: string): Promise<PersonalStudioRow> {
  await schemaIsReady();
  const [row] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  if (row) return row;
  const profile = await storage.getProfileByEmail(email).catch(() => undefined);
  const name = profile?.podcastName?.trim() || profile?.hostName?.trim() || "My studio";
  const [made] = await db.insert(personalStudios).values({ ownerEmail: email, name, inviteToken: newToken(), createdAt: now() }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  return again;
}
const room = (s: PersonalStudioRow) => `my-${s.id}`;
/** The studio with its show's name (studioTitle), for everything that shows or files it under a name. */
const titled = async (s: PersonalStudioRow, picked?: unknown): Promise<PersonalStudioRow> => ({ ...s, name: await studioTitle(s.ownerEmail, s.id, s.name, picked) });
/** liveEgressId when the show is live on their MilitaryVoices page only (no YouTube or other key on). */
const PAGE_ONLY = "page";
// Guests wait backstage (stage = "off") until the host brings them on, once the room UI has the
// button for it (ROOM_BACKSTAGE=1). Until then they go straight on stage (stage = "on"), as
// before, so nobody is ever left out of a recording by a control that isn't there yet.
const GUEST_STAGE = process.env.ROOM_BACKSTAGE === "1" ? "off" : "on";
// The title under a name on stage ("Host", "Army veteran, author"), from the setup page.
const titleOf = (req: Request): { displayTitle?: string } => {
  const t = String(req.body?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return t ? { displayTitle: t } : {};
};

/** Recording and live flags checked against LiveKit, so a stopped egress never shows as running. */
async function settle(s: PersonalStudioRow): Promise<PersonalStudioRow> {
  if (!s.recordingEgressId && !s.liveEgressId) return s;
  const running = await runningEgressIds().catch(() => null);
  if (!running) return s;
  const patch: Partial<PersonalStudioRow> = {};
  if (s.recordingEgressId && !running.has(s.recordingEgressId)) Object.assign(patch, { recordingEgressId: "", recordingSince: "" });
  // "page": live on their MilitaryVoices page only, with no recorder or stream to check (22 Nov).
  if (s.liveEgressId && s.liveEgressId !== PAGE_ONLY && !running.has(s.liveEgressId)) Object.assign(patch, { liveEgressId: "", liveSince: "", liveWatchUrl: "" });
  if (!Object.keys(patch).length) return s;
  const [out] = await db.update(personalStudios).set(patch).where(eq(personalStudios.id, s.id)).returning();
  return out;
}

/**
 * The leave-live safety net (Andrew, 21 Nov): an owner can leave and keep the show live, but a
 * studio with nobody real in it (the player bot, the hidden stage view and the recorder don't
 * count) for 2 minutes ends the live show and stops the recording by itself, then emails the
 * owner. A recording left running on its own (not live) stops the same way, with its own email. Anyone coming back inside the 2 minutes cancels it. Run every minute by the cron, so
 * the "first seen empty" time is kept in settings between passes.
 */
const EMPTY_GRACE_MS = 2 * 60_000;
const realPerson = (identity: string) => /^(owner|guest)-/.test(identity);
const emptyKey = (id: number) => `studio-empty:${id}`;
export async function runStudioEmptyPass(nowMs = Date.now()): Promise<{ running: number; waiting: number[]; ended: number[] }> {
  await schemaIsReady();
  const rows = await db.select().from(personalStudios).where(or(ne(personalStudios.liveEgressId, ""), ne(personalStudios.recordingEgressId, "")));
  const waiting: number[] = [];
  const ended: number[] = [];
  for (const row of rows) {
    const s = await settle(row);
    const key = emptyKey(s.id);
    const since = (await storage.getSetting(key)) || "";
    if (!s.liveEgressId && !s.recordingEgressId) { if (since) await storage.setSetting(key, ""); continue; }
    let people: number;
    // A LiveKit hiccup is never read as "everyone left".
    try { people = (await rooms().listParticipants(room(s))).filter((p) => realPerson(p.identity)).length; } catch { continue; }
    if (people > 0) { if (since) await storage.setSetting(key, ""); continue; }
    if (!since) { await storage.setSetting(key, new Date(nowMs).toISOString()); waiting.push(s.id); continue; }
    // A little slack for the cron's own timing, so it ends on the second pass after it first saw nobody.
    if (nowMs - Date.parse(since) < EMPTY_GRACE_MS - 15_000) { waiting.push(s.id); continue; }
    const live = !!s.liveEgressId;
    const recorded = !!s.recordingEgressId;
    if (live) await stopEgressById(s.liveEgressId).catch(() => {});
    if (recorded) await stopEgressById(s.recordingEgressId).catch(() => {});
    await db.update(personalStudios).set({ ...(live ? { liveEgressId: "", liveSince: "", liveWatchUrl: "" } : {}), ...(recorded ? { recordingEgressId: "", recordingSince: "" } : {}) }).where(eq(personalStudios.id, s.id));
    await storage.setSetting(key, "");
    console.log(`My studio ${s.id}: ${live ? `live show ended${recorded ? " and recording stopped" : ""}` : "recording stopped"} after 2 minutes with nobody in the studio.`);
    await sendStudioLeftLiveEmail({ to: s.ownerEmail, studioName: await studioTitle(s.ownerEmail, s.id, s.name), live, recorded }).catch((err) => console.error("Left-studio email failed:", (err as Error).message));
    ended.push(s.id);
  }
  return { running: rows.length, waiting, ended };
}

/** The link a guest uses to join this host's own studio room (made on first use). */
export async function roomInviteLink(email: string): Promise<string> {
  const s = await mine(email.trim().toLowerCase());
  return `${ORIGIN}/my-studio/join/${s.inviteToken}`;
}

export function registerMyStudio(app: Express, requireHostSession: RequestHandler, deps: { youtubeToken: (email: string) => Promise<string | null> }) {
  registerRoomStage(app, requireHostSession);
  registerStudioSetups(app, requireHostSession);
  // Podcasting's saved look is read through its key, and a save refreshes any room that is live.
  useRoomKit({ roomLookKey });
  onLookSaved((studioId, look) => bumpLookRev(studioId, look.rev));
  /** YouTube for Go live: their saved stream key, or (until they save one) the old Google connection. */
  const yt = async (email: string) => {
    const key = await getYoutubeKey(email).catch(() => "");
    const legacy = !key && YOUTUBE_OAUTH && !!(await storage.getYoutubeAccount(email).catch(() => undefined));
    const url = liveUrlOf(await liveHandleOf(email).catch(() => ""));
    return { youtube: !!key || legacy, youtubeKey: youtubeKeyHint(key), youtubeLegacy: legacy, page: { on: !!url && (await livePageOn(email)), url } };
  };
  const view = (s: PersonalStudioRow, youtube: { youtube: boolean; youtubeKey: string; youtubeLegacy: boolean; page: { on: boolean; url: string } }) => ({
    id: s.id,
    name: s.name,
    inviteLink: `${ORIGIN}/my-studio/join/${s.inviteToken}`,
    recording: s.recordingEgressId ? { since: s.recordingSince } : null,
    live: s.liveEgressId ? { since: s.liveSince, watchUrl: s.liveWatchUrl || (youtube.page.on ? youtube.page.url : "") } : null,
    // Their MilitaryVoices live page: in Go live as a place it goes, switched in Integrations → Live.
    livePage: youtube.page,
    youtube: youtube.youtube, youtubeKey: youtube.youtubeKey, youtubeLegacy: youtube.youtubeLegacy,
    youtubeOn: s.youtubeOn,
    streams: streamsOf(s).map(({ key, ...x }) => ({ ...x, key: key ? `••••${key.slice(-4)}` : "" })),
    ready: isLiveKitConfigured(),
    canRecord: isRecordingConfigured(),
    // Studio v3 (scene types, cards, sounds and music): the UI switches to it only when this is true.
    v3: v3For(s.id),
  });

  // The leave-live safety net, every minute (vercel.json).
  const emptyCron: RequestHandler = async (req, res) => {
    if (process.env.CRON_SECRET && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== process.env.CRON_SECRET) return void res.status(401).json({ message: "Not authorised." });
    if (!isLiveKitConfigured()) return void res.json({ skipped: "no media layer" });
    try { res.json(await runStudioEmptyPass()); } catch (err) { console.error("Studio empty pass failed:", (err as Error).message); res.status(500).json({ message: "Studio empty pass failed." }); }
  };
  app.get("/api/cron/studio-empty", emptyCron);
  app.post("/api/cron/studio-empty", emptyCron);

  app.get("/api/host/my-studio", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = me(req);
    const s = await settle(await mine(email));
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    // Opened for one of their shows (?show=<id>, hosts with 2 or more): that show from now on, until they pick another.
    const picked = req.query.show ? await inviteShow(email, req.query.show).catch(() => null) : null;
    if (picked && (await storage.getSetting(studioShowKey(s.id)).catch(() => null)) !== String(picked.id)) await storage.setSetting(studioShowKey(s.id), String(picked.id)).catch(() => {});
    // Hosts with 2 or more shows pick one on the entry screen; it names the studio, the icon and the recording.
    const list = await ownerShows(email);
    const shows = list.length > 1 ? { shows: list.map(({ id, title }) => ({ id, title })), showId: (await studioShow(email, s.id, s.name, picked?.id).catch(() => null))?.id ?? null } : {};
    // Their own name, for the camera check's name box.
    res.json({ ...view(await titled(s, picked?.id), await yt(email)), you: profile?.hostName?.trim() || "", ...shows });
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
    res.json(view(await titled(out), await yt(email)));
  });

  /**
   * The studio's Notes, which are also the teleprompter's script (PM, 21 Nov: "save the teleprompter
   * script on the server ... per studio"): written ahead on one computer, read live on another. Owner
   * only, plain text, never sent to guests or the recording. The newest save wins.
   */
  const NOTES_MAX = 60_000;
  const notesKey = (id: number) => `studio-notes:${id}`;
  const readNotes = async (id: number): Promise<{ text: string; at: string }> => {
    try { const v = JSON.parse((await storage.getSetting(notesKey(id))) ?? "{}"); return { text: typeof v.text === "string" ? v.text : "", at: typeof v.at === "string" ? v.at : "" }; } catch { return { text: "", at: "" }; }
  };
  app.get("/api/host/my-studio/notes", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await readNotes((await mine(me(req))).id));
  });
  app.put("/api/host/my-studio/notes", requireHostSession, async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== "string") return res.status(400).json({ message: "Those notes didn't come through." });
    if (text.length > NOTES_MAX) return res.status(400).json({ message: "Your notes are too long to save. Make them a little shorter." });
    const s = await mine(me(req));
    const out = { text, at: now() };
    await storage.setSetting(notesKey(s.id), JSON.stringify(out));
    res.json(out);
  });

  /**
   * Saved teleprompter scripts (Andrew, 22 Nov: "make sure we can save promts"): a named list per studio, owner
   * only. The client sends the whole list; using one copies it into Notes, which stays the live script.
   */
  type Script = { id: string; name: string; text: string; at: string };
  const SCRIPTS_MAX = 50;
  const scriptsKey = (id: number) => `studio-scripts:${id}`;
  const readScripts = async (id: number): Promise<Script[]> => {
    try { const v = JSON.parse((await storage.getSetting(scriptsKey(id))) ?? "[]"); return Array.isArray(v) ? (v as Script[]) : []; } catch { return []; }
  };
  app.get("/api/host/my-studio/scripts", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ scripts: await readScripts((await mine(me(req))).id) });
  });
  app.put("/api/host/my-studio/scripts", requireHostSession, async (req, res) => {
    const list = req.body?.scripts;
    if (!Array.isArray(list)) return res.status(400).json({ message: "Those scripts didn't come through." });
    if (list.length > SCRIPTS_MAX) return res.status(400).json({ message: `You can keep up to ${SCRIPTS_MAX} scripts. Delete one to save another.` });
    const clean: Script[] = [];
    for (const x of list) {
      const text = typeof x?.text === "string" ? x.text : "";
      if (text.length > NOTES_MAX) return res.status(400).json({ message: "That script is too long to save. Make it a little shorter." });
      const name = String(x?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled script";
      const id = /^[a-z0-9-]{1,40}$/i.test(String(x?.id ?? "")) ? String(x.id) : Math.random().toString(36).slice(2, 10);
      clean.push({ id, name, text, at: typeof x?.at === "string" ? x.at.slice(0, 40) : now() });
    }
    const s = await mine(me(req));
    await storage.setSetting(scriptsKey(s.id), JSON.stringify(clean));
    res.json({ scripts: clean });
  });

  /** The owner into their room: publishes, and runs it. */
  app.post("/api/host/my-studio/token", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on yet." });
    const email = me(req);
    const s = await mine(email);
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    const name = String(req.body?.name ?? "").trim().slice(0, 60) || profile?.hostName || email.split("@")[0];
    const identity = `owner-${s.id}-${crypto.randomBytes(3).toString("hex")}`;
    const token = await studioToken({ room: room(s), identity, name, canPublish: true, admin: true, attributes: { role: "host", stage: "on", who: identity, ...titleOf(req) } });
    res.json({ url: publicLiveKitUrl(), token, name: await studioTitle(s.ownerEmail, s.id, s.name), v3: v3For(s.id) });
  });

  /** A guest on the invite link: no account, just a name. */
  app.get("/api/my-studio/invite/:token", async (req, res) => {
    await schemaIsReady();
    const [s] = await db.select().from(personalStudios).where(eq(personalStudios.inviteToken, String(req.params.token))).limit(1);
    if (!s) return res.status(404).json({ message: "This invite link has expired. Ask the host for a new one." });
    // An invitation for one of the host's shows (?show=11) greets the guest with that show's name.
    const show = req.query.show ? await inviteShow(s.ownerEmail.trim().toLowerCase(), req.query.show).catch(() => null) : null;
    res.json({ name: show?.title || (await studioTitle(s.ownerEmail, s.id, s.name)), v3: v3For(s.id) });
  });
  app.post("/api/my-studio/invite/:token/token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on yet." });
    const [s] = await db.select().from(personalStudios).where(eq(personalStudios.inviteToken, String(req.params.token))).limit(1);
    if (!s) return res.status(404).json({ message: "This invite link has expired. Ask the host for a new one." });
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ message: "Your name, please." });
    const identity = `guest-${crypto.randomBytes(5).toString("hex")}`;
    const token = await studioToken({ room: room(s), identity, name, canPublish: true, attributes: { role: "guest", stage: GUEST_STAGE, who: identity, ...titleOf(req) } });
    res.json({ url: publicLiveKitUrl(), token, name: await studioTitle(s.ownerEmail, s.id, s.name), v3: v3For(s.id) });
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
        // Film our own page (the room's look, scene and clips); the stock grid if it can't be reached.
        const egressId = await startSegmentRecording(room(s), filepath, await roomTemplateUrl(s.id));
        const title = `${await studioTitle(email, s.id, s.name)} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}`;
        // A Library recording like an upload's: no event, no studio row, theirs by email.
        await storage.createRecording({ eventId: 0, studioId: 0, signupId: null, email, title, egressId, filepath });
        [s] = await db.update(personalStudios).set({ recordingEgressId: egressId, recordingSince: now() }).where(eq(personalStudios.id, s.id)).returning();
        void noteMusicOnAir(s.id);
      } else if (!on && s.recordingEgressId) {
        await stopEgressById(s.recordingEgressId).catch(() => {});
        [s] = await db.update(personalStudios).set({ recordingEgressId: "", recordingSince: "" }).where(eq(personalStudios.id, s.id)).returning();
      }
      res.json(view(await titled(s), await yt(email)));
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
        const ytKey = s.youtubeOn ? await getYoutubeKey(email) : "";
        if (ytKey) {
          // Their own stream key: it goes live under the channel's default title (YouTube Studio).
          targets.push({ url: youtubePushUrl(ytKey) });
        } else if (s.youtubeOn && YOUTUBE_OAUTH) {
          const token = await deps.youtubeToken(email);
          if (token) {
            const title = String(req.body?.title ?? "").trim().slice(0, 100) || (await studioTitle(email, s.id, s.name));
            const b = await createBroadcast(token, { title, startAtIso: now(), privacy: req.body?.privacy === "unlisted" ? "unlisted" : "public" });
            targets.push({ url: `${b.ingestAddress.replace(/\/+$/, "")}/${b.streamName}` });
            watchUrl = b.watchUrl;
          }
        }
        const page = await livePageOn(email) && !!(await liveHandleOf(email));
        if (!targets.length && !page) return res.status(400).json({ message: "Add your YouTube stream key or another streaming key first." });
        // Only their MilitaryVoices page: viewers watch the room itself, so there's nothing to start.
        const egressId = targets.length ? await startBroadcast(room(s), targets as never, await roomTemplateUrl(s.id)) : PAGE_ONLY;
        [s] = await db.update(personalStudios).set({ liveEgressId: egressId, liveSince: now(), liveWatchUrl: watchUrl }).where(eq(personalStudios.id, s.id)).returning();
      } else if (!on && s.liveEgressId) {
        if (s.liveEgressId !== PAGE_ONLY) await stopEgressById(s.liveEgressId).catch(() => {});
        [s] = await db.update(personalStudios).set({ liveEgressId: "", liveSince: "", liveWatchUrl: "" }).where(eq(personalStudios.id, s.id)).returning();
      }
      res.json(view(await titled(s), await yt(email)));
    } catch (err) {
      console.error("My studio live failed:", err);
      const msg = (err as Error).message ?? "";
      res.status(502).json({ message: /live streaming is not enabled|liveStreamingNotEnabled/i.test(msg) ? "Live streaming isn't turned on for your YouTube channel yet. Turn it on in YouTube Studio (it can take a day), or use a streaming key." : "Going live didn't start. Try again in a moment." });
    }
  });
}
