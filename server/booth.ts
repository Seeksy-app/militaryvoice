// MilitaryVoices Radio booth: a podcaster's own simple studio for their
// booking, and the schedule the broadcast plays from. No producer, no scenes:
// the clock decides who's on (see client/src/pages/Program.tsx).
//
// Everyone on a day shares that day's LiveKit room; each person carries their
// booking's id as an attribute, so the program shows only the booking on the
// clock and each booth only shows its own people.
import crypto from "node:crypto";
import type { Express, RequestHandler } from "express";
import { storage, db } from "./storage.js";
import { eq } from "drizzle-orm";
import { recordings as recordingsTable } from "../shared/schema.js";
import { getAdminEmail, getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl, roomName, studioToken, rooms, egressIsActive } from "./livekit.js";
import { dxEventIds } from "./digitalExperience.js";
import { buildShareCard } from "./shareCard.js";
import { signedRecordingUrl, putRecordingObject } from "./recordingStorage.js";
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

/** The day for listeners: the one on today (Eastern), else the next one, else the last one. */
async function radioDay(): Promise<EventRow | undefined> {
  const days: EventRow[] = [];
  for (const id of await dxEventIds()) { const ev = await storage.getEventById(id); if (ev) days.push(ev); }
  days.sort((a, b) => ms(a.startAtUtc) - ms(b.startAtUtc));
  const now = Date.now();
  const end = (e: EventRow) => ms(e.startAtUtc) + e.durationHours * 3600_000;
  const et = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return days.find((e) => et(ms(e.startAtUtc)) === et(now) && end(e) > now) ?? days.find((e) => ms(e.startAtUtc) > now) ?? days[days.length - 1];
}


/** The station's spoken clips (made by scripts/radio-voice.ts, stored in R2): one welcome, one sign-off, an intro and an outro per booking. */
type VoiceMap = { welcome?: { key: string; sec: number }; signoff?: { key: string; sec: number }; map: Record<string, { introKey?: string; outroKey?: string }> };
async function readVoice(): Promise<VoiceMap> {
  try { const j = JSON.parse((await storage.getSetting("dx:voice")) ?? "{}"); return { welcome: j.welcome, signoff: j.signoff, map: j.map ?? {} }; } catch { return { map: {} }; }
}

export function registerBooth(app: Express): void {
  /** What the program page needs to play the welcome and the sign-off. */
  async function voiceFor() {
    const v = await readVoice();
    return {
      welcomeUrl: v.welcome?.key ? await signedRecordingUrl(v.welcome.key, 6 * 3600).catch(() => "") : "",
      welcomeSec: v.welcome?.sec ?? 0,
      signoffUrl: v.signoff?.key ? await signedRecordingUrl(v.signoff.key, 6 * 3600).catch(() => "") : "",
      signoffSec: v.signoff?.sec ?? 0,
      // A soft music bed for any stretch that would otherwise be silent (a replay that ends before its slot does, a booth with no one in it).
      bedUrl: await (async () => { const t = await storage.getMusic("soft-landing").catch(() => undefined); return t?.url ? await signedRecordingUrl(t.url, 6 * 3600).catch(() => "") : ""; })(),
    };
  }

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
    if (!ev) return res.status(404).json({ message: "Not a MilitaryVoices Radio room." });
    const voice = await readVoice();
    const list = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
    res.json({
      eventId: ev.id,
      day: ev.name,
      startAtUtc: ev.startAtUtc,
      endAtUtc: new Date(ms(ev.startAtUtc) + ev.durationHours * 3600_000).toISOString(),
      fillerUrl: (await storage.getSetting("dx:filler-url")) ?? "",
      voice: await voiceFor(),
      // Open time plays replays (setting "dx:replays": [{key, show, host, photo, durationSec}], in play order).
      // The day's place in the week shifts where the rotation starts, so each day opens on something different.
      dayIndex: Math.max(0, ids.slice().sort((a, b) => a - b).indexOf(ev.id)),
      replays: await (async () => {
        let list: Array<{ key?: string; show?: string; host?: string; photo?: string; durationSec?: number }> = [];
        try { list = JSON.parse((await storage.getSetting("dx:replays")) ?? "[]"); } catch { list = []; }
        return Promise.all(list.filter((r) => r.key).slice(0, 200).map(async (r, i) => ({
          id: i, show: r.show ?? "", host: r.host ?? "", photo: r.photo ?? "", durationSec: r.durationSec ?? 0,
          mediaUrl: await signedRecordingUrl(r.key!, 6 * 3600).catch(() => ""),
        })));
      })(),
      bookings: await Promise.all(list.map(async (s) => {
        const t = bookingTimes(ev!, s);
        // A recorded episode rolls in its slot: the page plays this file from where the clock is.
        const key = s.showFormat === "prerecorded" ? s.recordingUrl.trim() : "";
        const mediaUrl = key ? (/^https?:\/\//i.test(key) ? key : await signedRecordingUrl(key, 6 * 3600).catch(() => "")) : "";
        // Ended early from the booth: the outro plays now, and the rest of the slot goes to open time.
        const endedRaw = await storage.getSetting(`dx:ended:${s.id}`);
        const endedMs = endedRaw ? Date.parse(endedRaw) : NaN;
        const early = Number.isFinite(endedMs) && endedMs >= t.onAirStart && endedMs < t.onAirEnd;
        if (early) { t.onAirEnd = endedMs; t.end = Math.min(t.end, endedMs + 45_000); }
        return { id: s.id, endedEarly: early, show: s.podcastName, host: s.hostName, photo: s.photoUrl, mediaUrl, introUrl: voice.map[String(s.id)]?.introKey ? await signedRecordingUrl(voice.map[String(s.id)].introKey!, 6 * 3600).catch(() => "") : "", outroUrl: voice.map[String(s.id)]?.outroKey ? await signedRecordingUrl(voice.map[String(s.id)].outroKey!, 6 * 3600).catch(() => "") : "", startAtUtc: new Date(t.start).toISOString(), endAtUtc: new Date(t.end).toISOString(), onAirAtUtc: new Date(t.onAirStart).toISOString(), offAirAtUtc: new Date(t.onAirEnd).toISOString() };
      })),
    });
  });

  /**
   * MilitaryVoices Radio for listeners (/radio): which day, whether it's on air,
   * the day's lineup, and where else to watch (set in site_settings
   * "dx:youtube-url" / "dx:liveone-url" once those streams exist).
   */
  app.get("/api/radio", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const ev = await radioDay();
    if (!ev) return res.json({ day: null });
    const studio = await storage.getOrCreateStudio(ev.id);
    const list = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
    const start = ms(ev.startAtUtc), end = start + ev.durationHours * 3600_000;
    res.json({
      day: { eventId: ev.id, name: ev.name, startAtUtc: ev.startAtUtc, endAtUtc: new Date(end).toISOString() },
      onAir: studio.status === "Live" || (Date.now() >= start && Date.now() < end),
      youtube: (await storage.getSetting("dx:youtube-url")) ?? "",
      liveone: (await storage.getSetting("dx:liveone-url")) ?? "",
      bookings: list.map((s) => { const t = bookingTimes(ev, s); return { id: s.id, show: s.podcastName, host: s.hostName, photo: s.photoUrl, about: s.notes, startAtUtc: new Date(t.start).toISOString(), endAtUtc: new Date(t.end).toISOString() }; }),
    });
  });

  /**
   * The producer's run of show (Admin → /admin/radio-ros): all five days, every half hour, what is in it
   * (LIVE booth, VOD recorded episode, REPLAY filling open time, or nothing yet), whether it has the station's
   * intro and outro, and what the room looks like right now. Admins only.
   */
  app.get("/api/admin/radio/ros", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const adminEmail = getAdminEmail(req);
    if (!adminEmail || !(await storage.isAdminEmail(adminEmail))) return res.status(401).json({ message: "Sign in to the admin." });
    const ids = (await dxEventIds()).slice().sort((a, b) => a - b);
    const voiceMap = await readVoice();
    let replays: Array<{ key?: string; show?: string; host?: string; durationSec?: number }> = [];
    try { replays = (JSON.parse((await storage.getSetting("dx:replays")) ?? "[]") as typeof replays).filter((r) => r.key); } catch { replays = []; }
    const now = Date.now();
    const days = [];
    for (let di = 0; di < ids.length; di++) {
      const ev = await storage.getEventById(ids[di]);
      if (!ev) continue;
      const studio = await storage.getOrCreateStudio(ev.id);
      const slots = Math.floor((ev.durationHours * 60) / ev.slotMinutes);
      const list = (await storage.listSignups(ev.id)).filter((x) => x.status !== "cancelled" && x.id !== 60).sort((a, b) => a.slotIndex - b.slotIndex);
      // Who is in the room now (only worth asking for the day that is on).
      let inRoom: Array<{ name: string; signupId: number }> = [];
      const dayStart = ms(ev.startAtUtc), dayEnd = dayStart + ev.durationHours * 3600_000;
      let recording = false;
      if (isLiveKitConfigured() && now >= dayStart - 3600_000 && now < dayEnd) {
        try { inRoom = (await rooms().listParticipants(roomName(studio.id))).map((p) => ({ name: p.name || p.identity, signupId: Number((p.attributes as Record<string, string> | undefined)?.signupId) || 0 })); } catch { /* the room is not up */ }
        try { recording = studio.recordingEgressId ? await egressIsActive(studio.recordingEgressId) : false; } catch { /* unknown */ }
      }
      const rows: Array<Record<string, unknown>> = [];
      for (let k = 0; k < slots; k++) {
        const b = list.find((x) => x.slotIndex === k);
        const covered = list.find((x) => x.slotIndex < k && k < x.slotIndex + Math.max(1, x.slotSpan));
        if (covered) continue;
        const slotStart = dayStart + k * ev.slotMinutes * 60_000;
        if (b) {
          const t = bookingTimes(ev, b);
          const vod = b.showFormat === "prerecorded";
          let durationSec = 0;
          if (vod && b.recordingUrl) {
            const [rec] = await db.select({ d: recordingsTable.durationSec }).from(recordingsTable).where(eq(recordingsTable.url, b.recordingUrl)).limit(1);
            durationSec = rec?.d ?? 0;
          }
          const liveWindow = (t.onAirEnd - t.onAirStart) / 1000;
          rows.push({
            slot: k, span: Math.max(1, b.slotSpan), startAtUtc: new Date(t.start).toISOString(), endAtUtc: new Date(t.end).toISOString(),
            kind: vod ? "vod" : "live", show: b.podcastName, host: b.hostName, note: b.notes, signupId: b.id,
            intro: true, outro: true, introAudio: !!voiceMap.map[String(b.id)]?.introKey, outroAudio: !!voiceMap.map[String(b.id)]?.outroKey, introMin: (t.onAirStart - t.start) / 60_000, outroMin: (t.end - t.onAirEnd) / 60_000,
            onAirAtUtc: new Date(t.onAirStart).toISOString(), offAirAtUtc: new Date(t.onAirEnd).toISOString(),
            durationSec, warning: vod && !b.recordingUrl ? "No file yet" : vod && durationSec && durationSec > liveWindow ? "Runs longer than its window" : "",
            opensAtUtc: new Date(t.start - OPENS_MIN * 60_000).toISOString(),
          });
        } else if (replays.length) {
          const r = replays[(di * 30 + k) % replays.length];
          rows.push({ slot: k, span: 1, startAtUtc: new Date(slotStart).toISOString(), endAtUtc: new Date(slotStart + ev.slotMinutes * 60_000).toISOString(), kind: "replay", show: r.show ?? "", host: r.host ?? "", intro: false, outro: false, durationSec: r.durationSec ?? 0, warning: "" });
        } else {
          rows.push({ slot: k, span: 1, startAtUtc: new Date(slotStart).toISOString(), endAtUtc: new Date(slotStart + ev.slotMinutes * 60_000).toISOString(), kind: "open", show: "", host: "", intro: false, outro: false, durationSec: 0, warning: "" });
        }
      }
      days.push({ eventId: ev.id, name: ev.name, startAtUtc: ev.startAtUtc, endAtUtc: new Date(dayEnd).toISOString(), status: studio.status, recording, inRoom, rows });
    }
    res.json({ now: new Date(now).toISOString(), days });
  });

  /**
   * What the station is doing right now, for the share card and the link preview: the show on
   * air, else the next one up today, else the plain station line. Names and times only.
   */
  async function radioNow(showId = 0): Promise<{ show: string; host: string; photo: string; label: string; line: string }> {
    const plain = { show: "MilitaryVoices Radio", host: "", photo: "", label: "Weekdays 7 am – 10 pm ET", line: "The live station for military and veteran voices, weekdays 7 am to 10 pm ET." };
    const et = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
    // A shared show: "come and hear this one".
    if (showId) {
      const b = await bookingFor(showId);
      if (b) {
        const t = bookingTimes(b.ev, b.s);
        const when = `${day(new Date(t.start).toISOString())} at ${et(new Date(t.start).toISOString())} ET`;
        return { show: b.s.podcastName, host: b.s.hostName, photo: b.s.photoUrl ?? "", label: `Live ${when}`, line: `${b.s.podcastName}, with ${b.s.hostName}. Live on MilitaryVoices Radio ${when}.` };
      }
    }
    const ev = await radioDay();
    if (!ev) return plain;
    const list = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
    const now = Date.now();
    for (const s of list) {
      const t = bookingTimes(ev, s);
      if (now >= t.start && now < t.end) return { show: s.podcastName, host: s.hostName, photo: s.photoUrl ?? "", label: "ON AIR NOW", line: `On air now: ${s.podcastName}, with ${s.hostName}. Listen live on MilitaryVoices Radio.` };
    }
    const next = list.find((s) => bookingTimes(ev, s).start > now);
    if (next) {
      const iso = new Date(bookingTimes(ev, next).start).toISOString();
      return { show: next.podcastName, host: next.hostName, photo: next.photoUrl ?? "", label: `Up next ${et(iso)} ET`, line: `Up next at ${et(iso)} ET: ${next.podcastName}, with ${next.hostName}. MilitaryVoices Radio, live.` };
    }
    return plain;
  }

  /** The picture that goes with a shared /radio link: what's on air now (or the show that was shared). */
  app.get("/og/radio.jpg", async (req, res) => {
    const n = await radioNow(Number(req.query.show) || 0);
    const origin = `https://${req.get("host")}`;
    const jpg = await buildShareCard({
      podcastName: n.show,
      hostName: n.host,
      subline: n.host ? undefined : "Live From Anywhere",
      whenLabel: n.label,
      photoUrl: n.photo ? (n.photo.startsWith("http") ? n.photo : `${origin}${n.photo}`) : undefined,
      eyebrow: "MilitaryVoices Radio",
      footer: "militaryvoices.ai/radio",
    }, "wide");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300");
    res.end(jpg);
  });

  /**
   * Link previews for /radio: the preview robots (vercel.json sends only their user agents here)
   * get a page with the right title and picture; people get the app as always.
   */
  const PREVIEW_BOT = /facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|redditbot|pinterest|embedly|skypeuripreview|mastodon|bluesky|iframely|vkshare|quora link preview/i;
  const radioPreview = (book: boolean): RequestHandler => async (req, res, next) => {
    if (!PREVIEW_BOT.test(String(req.get("user-agent") ?? ""))) return next();
    const showId = Number(req.query.show) || 0;
    const n = await radioNow(showId);
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const origin = `https://${req.get("host")}`;
    const url = `${origin}/radio${book ? "/book" : ""}${showId ? `?show=${showId}` : ""}`;
    const title = showId && n.host ? `${n.show} · MilitaryVoices Radio` : book ? "Book your slot · MilitaryVoices Radio" : "MilitaryVoices Radio · Live From Anywhere";
    const img = `${origin}/og/radio.jpg?${showId ? `show=${showId}&` : ""}v=${Math.floor(Date.now() / 600_000)}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120");
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${esc(title)}</title><meta name="description" content="${esc(n.line)}" /><meta property="og:type" content="website" /><meta property="og:site_name" content="MilitaryVoices.ai" /><meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(n.line)}" /><meta property="og:url" content="${url}" /><meta property="og:image" content="${img}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${esc(title)}" /><meta name="twitter:description" content="${esc(n.line)}" /><meta name="twitter:image" content="${img}" /><link rel="canonical" href="${url}" /></head><body><h1>${esc(title)}</h1><p>${esc(n.line)}</p></body></html>`);
  };
  app.get("/radio", radioPreview(false));
  // The link hosts are sent and share ("Your graphics, caption and link"): its preview used to be the Marathon's.
  app.get("/radio/book", radioPreview(true));

  /**
   * The station's voice (Alex, in Madison's voice) for a booking's intro and outro. Made once with
   * ElevenLabs and kept in the bucket; the program page plays it as the intro or outro card starts.
   */
  app.get("/api/radio/voice/:id/:kind.mp3", async (req, res) => {
    const kind = req.params.kind === "outro" ? "outro" : "intro";
    const b = await bookingFor(Number(req.params.id));
    const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim();
    if (!b) return res.status(404).json({ message: "That booking isn't on MilitaryVoices Radio." });
    // The finished clip (voice over music), made by scripts/radio-voice.ts: use it when it is there.
    const made = (await readVoice()).map[String(b.s.id)]?.[kind === "outro" ? "outroKey" : "introKey"];
    if (made) {
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.redirect(302, await signedRecordingUrl(made, 3 * 3600));
    }
    if (!key) return res.status(503).json({ message: "No voice key on this server." });
    // Spoken spellings: Riccoh reads "Reeko", Pōstify "Post-ify" (written text keeps the real ones).
    const say = (v: string) => v.replace(/riccoh/gi, "Reeko").replace(/p[oō]stify/gi, "Post-ify").replace(/&/g, "and");
    const show = say(b.s.podcastName), host = say(b.s.hostName);
    const who = host.trim().toLowerCase() === show.trim().toLowerCase() ? show : `${show}, with ${host}`;
    const recorded = b.s.showFormat === "prerecorded";
    const text = kind === "intro"
      ? `Coming up on MilitaryVoices Radio${recorded ? ", an encore of " : ": "}${who}. Starting in three minutes.`
      : `That was ${who}. Thank you for listening to MilitaryVoices Radio.`;
    const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
    const path = `radio-voice/${b.s.id}-${kind}-${hash}.mp3`;
    try {
      const have = await fetch(await signedRecordingUrl(path, 300), { method: "HEAD" });
      if (!have.ok) {
        const t = await fetch("https://api.elevenlabs.io/v1/text-to-speech/NUjosfEayZAdRcDmcHM8?output_format=mp3_44100_128", {
          method: "POST", signal: AbortSignal.timeout(45_000),
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, speed: 1.0 } }),
        });
        if (!t.ok) return res.status(502).end();
        await putRecordingObject(path, Buffer.from(await t.arrayBuffer()), "audio/mpeg");
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.redirect(302, await signedRecordingUrl(path, 3 * 3600));
    } catch (err) {
      console.error("Radio voice failed:", err);
      res.status(502).end();
    }
  });

  /** A listener's pass into the day's room: watch and hear only, while the day is on. */
  app.post("/api/radio/token", async (_req, res) => {
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The station isn't on yet." });
    const ev = await radioDay();
    if (!ev) return res.status(404).json({ message: "Nothing scheduled." });
    const studio = await storage.getOrCreateStudio(ev.id);
    const token = await studioToken({ room: roomName(studio.id), identity: `listener-${crypto.randomBytes(6).toString("hex")}`, name: "Listener", canPublish: false, attributes: { role: "listener" } });
    res.json({ url: publicLiveKitUrl(), token, eventId: ev.id });
  });

  app.get("/api/booth/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const b = await bookingFor(Number(req.params.id));
    if (!b) return res.status(404).json({ message: "That booking isn't on MilitaryVoices Radio." });
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
      endedAtUtc: (await storage.getSetting(`dx:ended:${b.s.id}`)) || "",
      guestLink: role === "guest" ? "" : `${origin}/booth/${b.s.id}?g=${boothGuestKey(b.s.id)}`,
      // An admin can open any booth at any time (to see it, or to help); so can a developer's machine.
      anytime: !!getAdminEmail(req) || (process.env.NODE_ENV === "development" && !process.env.VERCEL),
      ready: isLiveKitConfigured(),
    });
  });

  /** The host ends their show early, from the booth: the station plays the outro now and moves on. Only while they are on air. */
  app.post("/api/booth/:id/end", async (req, res) => {
    const b = await bookingFor(Number(req.params.id));
    if (!b) return res.status(404).json({ message: "That booking isn't on MilitaryVoices Radio." });
    const role = roleOf(req, b.s, req.body?.g);
    if (role !== "host" && role !== "admin") return res.status(403).json({ message: "Only the host can end the show." });
    const t = bookingTimes(b.ev, b.s);
    const now = Date.now();
    if (now < t.onAirStart || now >= t.onAirEnd) return res.status(409).json({ message: "You can end your show while you're on air." });
    await storage.setSetting(`dx:ended:${b.s.id}`, new Date(now).toISOString());
    res.json({ ok: true, endedAtUtc: new Date(now).toISOString() });
  });

  /** Into the day's room, carrying the booking's id. Open from an hour before until ten minutes after. */
  app.post("/api/booth/:id/token", async (req, res) => {
    const b = await bookingFor(Number(req.params.id));
    if (!b) return res.status(404).json({ message: "That booking isn't on MilitaryVoices Radio." });
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
    // An admin can watch a booth exactly as the host sees it, without being in the show: no camera, no mic, no signupId
    // (so they don't appear on the station, and their presence doesn't hide a host who has left).
    const watch = role === "admin" && req.body?.watch === true;
    const token = await studioToken({
      room: roomName(studio.id),
      identity: `${watch ? "w" : "b"}-${b.s.id}-${crypto.randomBytes(4).toString("hex")}`,
      name: watch ? "Admin watching" : name,
      canPublish: !watch,
      attributes: watch ? { role: "watcher" } : {
        signupId: String(b.s.id),
        role: role === "guest" ? "guest" : "host",
        displayTitle: role === "guest" ? `Guest · ${b.s.podcastName}` : b.s.podcastName,
        photoUrl: role === "guest" ? "" : b.s.photoUrl,
      },
    });
    res.json({ url: publicLiveKitUrl(), token, name });
  });

}
