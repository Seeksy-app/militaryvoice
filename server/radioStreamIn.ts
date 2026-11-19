import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getAdminEmail, getSessionEmail } from "./session.js";
import { createRtmpIngress, deleteIngress, listIngressForRoom, isLiveKitConfigured, roomName, rooms } from "./livekit.js";
import { bookingTimes } from "./booth.js";
import { dxEventIds } from "./digitalExperience.js";
import { seal, unseal } from "./secretBox.js";
import { slackNote } from "./slack.js";
import { radioFeeds, type EventRow, type RadioFeedRow, type SignupRow } from "../shared/schema.js";

/**
 * Radio, "I'll stream in": a booked host who produces their show in
 * StreamYard, Restream or OBS gets a stream key for that booking, from their
 * booth. The feed arrives in the day's Radio room as a participant carrying the
 * booking's signupId, so the program page plays it exactly as it plays a booth
 * camera: on the clock, in the booking's live window, and nowhere else.
 *
 * Nothing about switching changes: the clock still decides, the host still
 * ends their show from the booth, and a feed that drops during a show leaves
 * the program's "joining in a moment" card rather than cutting anywhere.
 * Radio's own broadcast recording is what puts the show in their Library.
 */

/** The booth opens an hour before the slot and stays open ten minutes after (as in booth.ts). */
const OPENS_MS = 60 * 60_000;
const CLOSES_MS = 10 * 60_000;

const noStore = (res: Response) => void res.set("Cache-Control", "no-store");
const now = () => new Date().toISOString();
const identityOf = (signupId: number) => `radio-feed-${signupId}`;

async function bookingFor(id: number): Promise<{ s: SignupRow; ev: EventRow } | null> {
  const s = await storage.getSignupById(id);
  if (!s || s.status === "cancelled" || !(await dxEventIds()).includes(s.eventId)) return null;
  const ev = await storage.getEventById(s.eventId);
  return ev ? { s, ev } : null;
}

/** The booking's host or co-host, signed in, or an admin. Guests don't get the key. */
function mayManage(req: Parameters<Parameters<Express["get"]>[1]>[0], s: SignupRow): boolean {
  const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
  if (email && (email === s.email.trim().toLowerCase() || (s.coHostEmail && email === s.coHostEmail.trim().toLowerCase()))) return true;
  return !!getAdminEmail(req);
}

async function feedFor(signupId: number): Promise<RadioFeedRow | undefined> {
  const [row] = await db.select().from(radioFeeds).where(eq(radioFeeds.signupId, signupId)).limit(1);
  return row;
}

/** Give the ingress participant the booking's attributes, so the program page finds it. */
async function tagParticipant(s: SignupRow, room: string): Promise<boolean> {
  try {
    await rooms().updateParticipant(room, identityOf(s.id), {
      attributes: { signupId: String(s.id), role: "host", displayTitle: s.podcastName, photoUrl: s.photoUrl || "" },
    });
    return true;
  } catch {
    return false; // not connected yet
  }
}

async function issue(s: SignupRow, ev: EventRow): Promise<RadioFeedRow> {
  const studio = await storage.getOrCreateStudio(ev.id);
  const room = roomName(studio.id);
  const cred = await createRtmpIngress({ room, identity: identityOf(s.id), name: s.hostName || s.podcastName || "Host" });
  const values = { room, ingressId: cred.ingressId, url: cred.url, streamKey: seal(cred.streamKey), problem: "" };
  const existing = await feedFor(s.id);
  if (existing) {
    const [out] = await db.update(radioFeeds).set(values).where(eq(radioFeeds.id, existing.id)).returning();
    return out;
  }
  const [out] = await db.insert(radioFeeds).values({ signupId: s.id, createdAt: now(), ...values }).returning();
  return out;
}

async function view(s: SignupRow, ev: EventRow, f: RadioFeedRow | undefined) {
  const t = bookingTimes(ev, s);
  let arriving = false;
  if (f?.ingressId && isLiveKitConfigured()) {
    try {
      // The whole room's feeds; ours is the one with our id.
      const mine = (await listIngressForRoom(f.room)).find((x) => x.ingressId === f.ingressId);
      const st = Number(mine?.state?.status);
      arriving = st === 1 || st === 2;
    } catch {
      /* LiveKit unreachable: show what we issued */
    }
  }
  return {
    key: f ? { url: f.url, streamKey: unseal(f.streamKey), arriving, problem: f.problem, dead: !f.ingressId } : null,
    startAtUtc: new Date(t.start).toISOString(),
    onAirAtUtc: new Date(t.onAirStart).toISOString(),
    offAirAtUtc: new Date(t.onAirEnd).toISOString(),
    opensAtUtc: new Date(t.start - OPENS_MS).toISOString(),
  };
}

/** From the LiveKit webhook: our feed's participant joined (tag it), or its stream started too early (cut it). */
export async function onRadioFeedWebhook(event: { event?: string; participant?: { identity?: string }; ingressInfo?: { ingressId?: string } }): Promise<void> {
  const identity = event.event === "participant_joined" ? event.participant?.identity ?? "" : "";
  if (identity.startsWith("radio-feed-")) {
    await schemaIsReady();
    const b = await bookingFor(Number(identity.slice("radio-feed-".length)));
    const f = b ? await feedFor(b.s.id) : undefined;
    if (b && f) await tagParticipant(b.s, f.room);
    return;
  }
  const ingressId = event.event === "ingress_started" ? event.ingressInfo?.ingressId ?? "" : "";
  if (!ingressId) return;
  await schemaIsReady();
  const [f] = await db.select().from(radioFeeds).where(eq(radioFeeds.ingressId, ingressId)).limit(1);
  if (!f) return;
  const b = await bookingFor(f.signupId);
  if (!b) return;
  const t = bookingTimes(b.ev, b.s);
  const n = Date.now();
  if (n < t.start - OPENS_MS || n > t.end + CLOSES_MS) {
    // Too early (or too late): end it, or LiveKit transcodes it at our cost all the same.
    await deleteIngress(f.ingressId).catch(() => {});
    await db.update(radioFeeds).set({ ingressId: "", problem: `Your stream reached us outside your booth hours (an hour before your slot to ten minutes after), so we stopped it. Make a new key, then start streaming from ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(t.start - OPENS_MS))}.` }).where(eq(radioFeeds.id, f.id));
    return;
  }
  // The participant usually joins a moment after the stream starts; the join event tags it, and this catches the other order.
  for (let i = 0; i < 3; i++) {
    if (await tagParticipant(b.s, f.room)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The minute pass: a booking's key stops existing a little after the booking does. */
export async function cleanupRadioFeeds(): Promise<number> {
  let n = 0;
  for (const f of await db.select().from(radioFeeds)) {
    const b = await bookingFor(f.signupId);
    const over = !b || Date.now() > bookingTimes(b.ev, b.s).end + CLOSES_MS + 10 * 60_000;
    if (!over) continue;
    if (f.ingressId) await deleteIngress(f.ingressId).catch(() => {});
    await db.delete(radioFeeds).where(eq(radioFeeds.id, f.id));
    n++;
  }
  return n;
}

export function registerRadioStreamIn(app: Express): void {
  const load = async (req: Parameters<Parameters<Express["get"]>[1]>[0], res: Response) => {
    noStore(res);
    await schemaIsReady();
    const b = await bookingFor(Number(req.params.id));
    if (!b) { res.status(404).json({ message: "That booking isn't on MilitaryVoices Radio." }); return null; }
    if (!mayManage(req, b.s)) { res.status(401).json({ message: "Sign in with the email you booked with." }); return null; }
    return b;
  };

  app.get("/api/booth/:id/stream-in", async (req, res) => {
    const b = await load(req, res);
    if (!b) return;
    res.json({ configured: isLiveKitConfigured(), ...(await view(b.s, b.ev, await feedFor(b.s.id))) });
  });

  /** Get the key (the same one every time), or make a new one: a dead key (cut for streaming too early) is replaced, and so is one asked to be. */
  app.post("/api/booth/:id/stream-in", async (req, res) => {
    const b = await load(req, res);
    if (!b) return;
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "Live streaming in isn't switched on yet." });
    const t = bookingTimes(b.ev, b.s);
    if (!getAdminEmail(req) && Date.now() > t.end + CLOSES_MS) return res.status(409).json({ message: "Your time has finished. Thank you for being on!" });
    try {
      let f = await feedFor(b.s.id);
      if (f && (req.body?.renew === true || !f.ingressId)) {
        if (f.ingressId) await deleteIngress(f.ingressId).catch(() => {});
        f = await issue(b.s, b.ev);
      } else if (!f) {
        f = await issue(b.s, b.ev);
      }
      res.json({ configured: true, ...(await view(b.s, b.ev, f)) });
    } catch (err) {
      console.error("Couldn't make a Radio stream key:", (err as Error).message);
      void slackNote(`Radio stream in: couldn't make a stream key for booking ${b.s.id} (${(err as Error).message}). Check the LiveKit plan limits.`).catch(() => {});
      res.status(502).json({ message: "Couldn't make your stream key right now. Try again in a moment." });
    }
  });

  app.delete("/api/booth/:id/stream-in", async (req, res) => {
    const b = await load(req, res);
    if (!b) return;
    const f = await feedFor(b.s.id);
    if (f) {
      if (f.ingressId) await deleteIngress(f.ingressId).catch(() => {});
      await db.delete(radioFeeds).where(eq(radioFeeds.id, f.id));
    }
    res.json({ ok: true });
  });
}
