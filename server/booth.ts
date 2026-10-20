// The Digital Bureau booth: a podcaster's own simple studio for their
// booking, and the schedule the broadcast plays from. No producer, no scenes:
// the clock decides who's on (see client/src/pages/Program.tsx).
//
// Everyone on a day shares that day's LiveKit room; each person carries their
// booking's id as an attribute, so the program shows only the booking on the
// clock and each booth only shows its own people.
import crypto from "node:crypto";
import type { Express } from "express";
import { storage } from "./storage.js";
import { getAdminEmail, getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl, roomName, studioToken } from "./livekit.js";
import { dxEventIds } from "./digitalExperience.js";
import type { EventRow, SignupRow } from "../shared/schema.js";

/** How early the booth opens, and how long after their end it stays open. */
const OPENS_MIN = 60;
const CLOSES_MIN = 10;

const secret = () => process.env.SESSION_SECRET ?? "";
/** The guest link's key: signed, not stored, so there's nothing to leak. */
export function boothGuestKey(signupId: number): string {
  return crypto.createHmac("sha256", secret()).update(`booth:${signupId}`).digest("base64url").slice(0, 22);
}
const keyOk = (signupId: number, g: unknown) => typeof g === "string" && g.length === 22 && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(boothGuestKey(signupId)));

const ms = (iso: string) => Date.parse(iso);
/** A booking's block, and when they're live inside it (the station's intro and outro either side). */
export function bookingTimes(ev: EventRow, s: Pick<SignupRow, "slotIndex" | "slotSpan">) {
  const start = ms(ev.startAtUtc) + s.slotIndex * ev.slotMinutes * 60_000;
  const end = start + Math.max(1, s.slotSpan || 1) * ev.slotMinutes * 60_000;
  const lead = ev.bufferPosition === "both" ? (ev.bufferMinutes / 2) * 60_000 : ev.bufferPosition === "before" ? ev.bufferMinutes * 60_000 : 0;
  const tail = ev.bufferPosition === "both" ? (ev.bufferMinutes / 2) * 60_000 : ev.bufferPosition === "after" ? ev.bufferMinutes * 60_000 : 0;
  return { start, end, onAirStart: start + lead, onAirEnd: end - tail };
}

async function bookingFor(id: number): Promise<{ s: SignupRow; ev: EventRow } | null> {
  const s = await storage.getSignupById(id);
  if (!s || s.status === "cancelled" || !(await dxEventIds()).includes(s.eventId)) return null;
  const ev = await storage.getEventById(s.eventId);
  return ev ? { s, ev } : null;
}

export function registerBooth(app: Express): void {
  /** Who they are to this booking, or nothing: the booking's owner or co-host signed in, an admin, or a guest with the link. */
  const roleOf = (req: Parameters<Parameters<Express["get"]>[1]>[0], s: SignupRow, g: unknown): "host" | "guest" | "admin" | null => {
    const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
    if (email && (email === s.email.trim().toLowerCase() || (s.coHostEmail && email === s.coHostEmail.trim().toLowerCase()))) return "host";
    if (keyOk(s.id, g)) return "guest";
    if (getAdminEmail(req)) return "admin";
    return null;
  };

  /**
   * The day's running order, for the broadcast page: who, when, and the
   * station's own pieces (filler while nobody's booked). Names and photos
   * only, the same as the public schedule. By room (the recorder's token
   * names it) or by event.
   */
  app.get("/api/booth/program", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ids = await dxEventIds();
    let ev: EventRow | undefined;
    const room = String(req.query.room ?? "");
    if (room) {
      for (const id of ids) {
        const studio = await storage.getOrCreateStudio(id);
        if (roomName(studio.id) === room) { ev = await storage.getEventById(id); break; }
      }
    } else if (ids.includes(Number(req.query.eventId))) ev = await storage.getEventById(Number(req.query.eventId));
    if (!ev) return res.status(404).json({ message: "Not a Digital Bureau room." });
    const list = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
    res.json({
      eventId: ev.id,
      day: ev.name,
      startAtUtc: ev.startAtUtc,
      endAtUtc: new Date(ms(ev.startAtUtc) + ev.durationHours * 3600_000).toISOString(),
      fillerUrl: (await storage.getSetting("dx:filler-url")) ?? "",
      bookings: list.map((s) => {
        const t = bookingTimes(ev!, s);
        return { id: s.id, show: s.podcastName, host: s.hostName, photo: s.photoUrl, startAtUtc: new Date(t.start).toISOString(), endAtUtc: new Date(t.end).toISOString(), onAirAtUtc: new Date(t.onAirStart).toISOString(), offAirAtUtc: new Date(t.onAirEnd).toISOString() };
      }),
    });
  });

  app.get("/api/booth/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const b = await bookingFor(Number(req.params.id));
    if (!b) return res.status(404).json({ message: "That booking isn't on the Digital Bureau." });
    const role = roleOf(req, b.s, req.query.g);
    if (!role) return res.status(401).json({ message: "Sign in with the email you booked with, or use the guest link you were sent." });
    const t = bookingTimes(b.ev, b.s);
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      signupId: b.s.id,
      role,
      show: b.s.podcastName,
      host: b.s.hostName,
      day: b.ev.name,
      startAtUtc: new Date(t.start).toISOString(),
      endAtUtc: new Date(t.end).toISOString(),
      onAirAtUtc: new Date(t.onAirStart).toISOString(),
      offAirAtUtc: new Date(t.onAirEnd).toISOString(),
      opensAtUtc: new Date(t.start - OPENS_MIN * 60_000).toISOString(),
      closesAtUtc: new Date(t.end + CLOSES_MIN * 60_000).toISOString(),
      guestLink: role === "guest" ? "" : `${origin}/booth/${b.s.id}?g=${boothGuestKey(b.s.id)}`,
      // An admin can open any booth at any time (to see it, or to help); so can a developer's machine.
      anytime: !!getAdminEmail(req) || (process.env.NODE_ENV === "development" && !process.env.VERCEL),
      ready: isLiveKitConfigured(),
    });
  });

  /** Into the day's room, carrying the booking's id. Open from an hour before until ten minutes after. */
  app.post("/api/booth/:id/token", async (req, res) => {
    const b = await bookingFor(Number(req.params.id));
    if (!b) return res.status(404).json({ message: "That booking isn't on the Digital Bureau." });
    const role = roleOf(req, b.s, req.body?.g);
    if (!role) return res.status(401).json({ message: "Sign in with the email you booked with, or use the guest link you were sent." });
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on yet." });
    const t = bookingTimes(b.ev, b.s);
    const now = Date.now();
    // On a developer's machine the booth opens any time, to try it.
    const anytime = !!getAdminEmail(req) || (process.env.NODE_ENV === "development" && !process.env.VERCEL);
    if (!anytime && now < t.start - OPENS_MIN * 60_000) return res.status(409).json({ message: `Your booth opens an hour before your time.` });
    if (!anytime && now > t.end + CLOSES_MIN * 60_000) return res.status(409).json({ message: "Your time has finished. Thank you for being on!" });
    const studio = await storage.getOrCreateStudio(b.ev.id);
    const name = String(req.body?.name ?? "").trim().slice(0, 60) || (role === "guest" ? "Guest" : b.s.hostName);
    const token = await studioToken({
      room: roomName(studio.id),
      identity: `b-${b.s.id}-${crypto.randomBytes(4).toString("hex")}`,
      name,
      canPublish: true,
      attributes: {
        signupId: String(b.s.id),
        role: role === "guest" ? "guest" : "host",
        displayTitle: role === "guest" ? `Guest · ${b.s.podcastName}` : b.s.podcastName,
        photoUrl: role === "guest" ? "" : b.s.photoUrl,
      },
    });
    res.json({ url: publicLiveKitUrl(), token, name });
  });

}
