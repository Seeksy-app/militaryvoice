// Guest invitations (17 Nov 2026): a podcaster invites a guest to an interview. The guest gets an email from us on the host's
// behalf with a private link; the link is a short pre-interview questionnaire (name as it should read, what they do, a bio, topics,
// links) and the photo they want on the guest card. The host sees the answers, and when the recording arrives the card is made
// from the guest's own name and photo.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { putRecordingObject, signedRecordingUrl } from "./recordingStorage.js";
import { sendInterviewInvite, sendInterviewAnswered } from "./email.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));
const photos = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  return (ready ??= (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS guest_invites (
      id SERIAL PRIMARY KEY, token TEXT NOT NULL UNIQUE, owner_email TEXT NOT NULL, guest_email TEXT NOT NULL, guest_name TEXT NOT NULL DEFAULT '',
      when_text TEXT NOT NULL DEFAULT '', when_iso TEXT NOT NULL DEFAULT '', zoom_link TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'invited', answers TEXT NOT NULL DEFAULT '', photo_key TEXT NOT NULL DEFAULT '',
      used_rec INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, invited_at TEXT NOT NULL DEFAULT '', answered_at TEXT NOT NULL DEFAULT '')`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS guest_invites_owner_idx ON guest_invites (owner_email)`);
    await db.execute(sql`ALTER TABLE guest_invites ADD COLUMN IF NOT EXISTS questions TEXT NOT NULL DEFAULT '[]'`);
  })());
}

/** The answered invite for this owner that a recording most likely belongs to: the one whose interview time is nearest, unused. */
export async function takeAnsweredInvite(ownerEmail: string, nearIso: string, recId: number): Promise<{ name: string; photoKey: string } | null> {
  await ensure();
  const list = rows(await db.execute(sql`select id, guest_name, photo_key, when_iso, answered_at from guest_invites where owner_email=${ownerEmail.trim().toLowerCase()} and status='answered' and used_rec=0 and photo_key<>''`));
  if (!list.length) return null;
  const t = Date.parse(nearIso) || Date.now();
  const pick = list.map((r) => ({ r, d: Math.abs((Date.parse(String(r.when_iso)) || Date.parse(String(r.answered_at)) || 0) - t) })).sort((a, b) => a.d - b.d)[0].r;
  await db.execute(sql`update guest_invites set used_rec=${recId} where id=${Number(pick.id)}`);
  return { name: String(pick.guest_name), photoKey: String(pick.photo_key) };
}

export function registerGuestInvites(app: Express, requireHostSession: RequestHandler) {
  const mine = (req: Parameters<RequestHandler>[0]) => (getSessionEmail(req) ?? "").trim().toLowerCase();
  const view = (r: Record<string, unknown>) => {
    let answers: Record<string, string> = {}; try { answers = JSON.parse(String(r.answers || "{}")); } catch { answers = {}; }
    let questions: string[] = []; try { questions = JSON.parse(String(r.questions || "[]")); } catch { questions = []; }
    return { id: r.id, questions, guestName: r.guest_name, guestEmail: r.guest_email, whenText: r.when_text, zoomLink: r.zoom_link, note: r.note, status: r.status, answers, hasPhoto: !!r.photo_key, invitedAt: r.invited_at, answeredAt: r.answered_at, usedRec: r.used_rec, link: `${ORIGIN}/guest-invite/${r.token}` };
  };

  app.get("/api/host/guest-invites", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await ensure();
    res.json(rows(await db.execute(sql`select * from guest_invites where owner_email=${mine(req)} order by id desc limit 100`)).map(view));
  });

  app.post("/api/host/guest-invites", requireHostSession, async (req, res) => {
    await ensure();
    const owner = mine(req);
    const guestName = str(req.body?.guestName, 80), guestEmail = str(req.body?.guestEmail, 200).toLowerCase();
    const whenText = str(req.body?.whenText, 120), whenIso = str(req.body?.whenIso, 40), note = str(req.body?.note, 1200);
    const zoomLink = str(req.body?.zoomLink, 500);
    const questions = (Array.isArray(req.body?.questions) ? req.body.questions : []).map((q: unknown) => str(q, 300)).filter(Boolean).slice(0, 10);
    if (!guestName) return res.status(400).json({ message: "Add the guest's name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)) return res.status(400).json({ message: "Add the guest's email address." });
    if (zoomLink && !/^https?:\/\/\S+$/i.test(zoomLink)) return res.status(400).json({ message: "The Zoom link should start with https://" });
    const count = Number(rows(await db.execute(sql`select count(*)::int n from guest_invites where owner_email=${owner} and created_at > ${new Date(Date.now() - 24 * 3600_000).toISOString()}`))[0]?.n ?? 0);
    if (count >= 20) return res.status(429).json({ message: "That's a lot of invitations today. Try again tomorrow." });
    const profile = await storage.getProfileByEmail(owner);
    const token = crypto.randomBytes(18).toString("base64url");
    const now = new Date().toISOString();
    const [r] = rows(await db.execute(sql`insert into guest_invites (token, owner_email, guest_email, guest_name, when_text, when_iso, zoom_link, note, questions, created_at, invited_at) values (${token}, ${owner}, ${guestEmail}, ${guestName}, ${whenText}, ${whenIso}, ${zoomLink}, ${note}, ${JSON.stringify(questions)}, ${now}, ${now}) returning *`));
    const ok = await sendInterviewInvite({ to: guestEmail, guestName, hostName: profile?.hostName ?? "", hostEmail: owner, show: profile?.podcastName ?? "", whenText, zoomLink, note, link: `${ORIGIN}/guest-invite/${token}` });
    if (!ok) return res.status(502).json({ message: "The email didn't go. Try again in a moment.", invite: view(r) });
    res.status(201).json(view(r));
  });

  app.delete("/api/host/guest-invites/:id", requireHostSession, async (req, res) => {
    await ensure();
    await db.execute(sql`delete from guest_invites where id=${Number(req.params.id)} and owner_email=${mine(req)}`);
    res.json({ ok: true });
  });

  /** Their photo, for the host to see. */
  app.get("/api/host/guest-invites/:id/photo", requireHostSession, async (req, res) => {
    await ensure();
    const r = rows(await db.execute(sql`select photo_key from guest_invites where id=${Number(req.params.id)} and owner_email=${mine(req)}`))[0];
    if (!r?.photo_key) return res.status(404).end();
    res.redirect(await signedRecordingUrl(String(r.photo_key), 900));
  });

  // The guest's side: no account, the link is the key.
  app.get("/api/public/guest-invite/:token", async (req, res) => {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    const r = rows(await db.execute(sql`select * from guest_invites where token=${String(req.params.token)}`))[0];
    if (!r) return res.status(404).json({ message: "That link isn't working. Ask your host to send it again." });
    const profile = await storage.getProfileByEmail(String(r.owner_email));
    let questions: string[] = []; try { questions = JSON.parse(String(r.questions || "[]")); } catch { questions = []; }
    res.json({ questions, hostName: profile?.hostName ?? "", hostPhoto: profile?.photoUrl ?? "", show: profile?.podcastName ?? "", guestName: r.guest_name, whenText: r.when_text, zoomLink: r.zoom_link, note: r.note, answered: r.status === "answered" });
  });

  app.post("/api/public/guest-invite/:token", photos.single("photo"), async (req, res) => {
    await ensure();
    const r = rows(await db.execute(sql`select * from guest_invites where token=${String(req.params.token)}`))[0];
    if (!r) return res.status(404).json({ message: "That link isn't working. Ask your host to send it again." });
    const name = str(req.body?.name, 80);
    if (!name) return res.status(400).json({ message: "Add your name, as you'd like it to read." });
    if (String(req.body?.consent ?? "") !== "yes") return res.status(400).json({ message: "Please tick the box to say we may show your name and photo with the episode." });
    const file = (req as unknown as { file?: { buffer: Buffer } }).file;
    let photoKey = String(r.photo_key || "");
    if (file) {
      try {
        const jpg = await sharp(file.buffer).rotate().resize(1000, 1000, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
        photoKey = `show-assets/gi-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
        await putRecordingObject(photoKey, jpg, "image/jpeg");
      } catch { return res.status(400).json({ message: "That photo couldn't be used. Try a JPG or PNG." }); }
    }
    if (!photoKey) return res.status(400).json({ message: "Add the photo you'd like shown with your name." });
    let asked: string[] = []; try { asked = JSON.parse(String(r.questions || "[]")); } catch { asked = []; }
    const custom = asked.map((q, i) => ({ q, a: str(req.body?.[`q${i}`], 2000) }));
    const answers = { custom, name, title: str(req.body?.title, 120), bio: str(req.body?.bio, 1500), topics: str(req.body?.topics, 1200), links: str(req.body?.links, 600), avoid: str(req.body?.avoid, 600) };
    await db.execute(sql`update guest_invites set status='answered', guest_name=${name}, answers=${JSON.stringify(answers)}, photo_key=${photoKey}, answered_at=${new Date().toISOString()} where id=${Number(r.id)}`);
    const summary = [`${name}${answers.title ? `, ${answers.title}` : ""}`, ...custom.filter((c) => c.a).map((c) => `${c.q}\n${c.a}`), answers.bio && `About: ${answers.bio}`, answers.topics && `Topics: ${answers.topics}`, answers.links && `Links: ${answers.links}`, answers.avoid && `Please avoid: ${answers.avoid}`].filter(Boolean).join("\n");
    const profile = await storage.getProfileByEmail(String(r.owner_email));
    void sendInterviewAnswered({ to: String(r.owner_email), guestName: name, show: profile?.podcastName ?? "", summary, link: `${ORIGIN}/host/dashboard/podcast` }).catch(() => undefined);
    res.json({ ok: true });
  });
}
