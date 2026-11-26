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
import { boothGuestKey, bookingTimes } from "./booth.js";
import { dxEventIds } from "./digitalExperience.js";
import { roomInviteLink } from "./myStudio.js";
import { inviteShow, showFor, type Show } from "./hostShows.js";
import { buildShareCard } from "./shareCard.js";
import { attachBrief, deleteBriefOf, ensureBriefs } from "./guestBrief.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

/** The name before the @ on a host's invitations (bounce-back@militaryvoices.ai): theirs to choose, one each. */
const RESERVED = new Set(["hello", "admin", "support", "info", "contact", "sales", "press", "billing", "noreply", "no-reply", "postmaster", "abuse", "michael", "riccoh", "andrew", "team", "help", "mail", "www"]);
const slugOk = (v: string) => /^[a-z0-9][a-z0-9-]{2,29}$/.test(v) && !RESERVED.has(v);
/** With a show picked, invitations come from that show's name (warriors-voice@), unless someone else already uses it. */
async function senderFor(email: string, show: Show | null): Promise<string> {
  if (show && slugOk(show.slug)) {
    const taken = rows(await db.execute(sql`select key from site_settings where key like 'invite-slug:%' and value = ${show.slug} and key <> ${`invite-slug:${email}`} limit 1`));
    if (!taken.length) return show.slug;
  }
  return senderSlug(email);
}
async function senderSlug(email: string): Promise<string> {
  const saved = ((await storage.getSetting(`invite-slug:${email}`)) ?? "").trim();
  if (saved && slugOk(saved)) return saved;
  try {
    const r = (await db.execute(sql`select slug from hosted_shows where lower(email)=${email} order by archived_at, id limit 1`)) as unknown as { slug: string }[];
    const s0 = String(r[0]?.slug ?? "");
    if (slugOk(s0)) return s0;
  } catch { /* no show yet */ }
  const profile = await storage.getProfileByEmail(email);
  const fromName = (profile?.podcastName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return slugOk(fromName) ? fromName : "hello";
}

const etLabel = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
/** This host's coming live shows on MilitaryVoices Radio (as the booker or the co-host): where a guest can be invited into the booth. */
export async function boothBookings(owner: string) {
  const out: { id: number; show: string; startMs: number; endMs: number }[] = [];
  for (const eventId of await dxEventIds()) {
    const ev = await storage.getEventById(eventId);
    if (!ev) continue;
    for (const s of await storage.listSignups(eventId)) {
      if (s.status === "cancelled" || s.showFormat === "prerecorded" || s.id === 60) continue;
      if (s.email.trim().toLowerCase() !== owner && (s.coHostEmail ?? "").trim().toLowerCase() !== owner) continue;
      const t = bookingTimes(ev, s);
      if (t.end > Date.now()) out.push({ id: s.id, show: s.podcastName, startMs: t.start, endMs: t.end });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
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
    // 1 = the host will send the Zoom link in an email of their own (the invite says so instead of a link).
    await db.execute(sql`ALTER TABLE guest_invites ADD COLUMN IF NOT EXISTS link_later INTEGER NOT NULL DEFAULT 0`);
    // Which of the host's shows it's for (0 = not picked: the profile's podcast name, as before).
    await db.execute(sql`ALTER TABLE guest_invites ADD COLUMN IF NOT EXISTS show_id INTEGER NOT NULL DEFAULT 0`);
    // The guest's LinkedIn, if the host has it (Andrew, 24 Nov): for show prep (who they are, questions to ask). Never their photo.
    await db.execute(sql`ALTER TABLE guest_invites ADD COLUMN IF NOT EXISTS linkedin_url TEXT NOT NULL DEFAULT ''`);
    // Where it's recorded when it's the host's own tool (streamyard | restream | obs; '' = Zoom or ours), so the email names the link right.
    await db.execute(sql`ALTER TABLE guest_invites ADD COLUMN IF NOT EXISTS link_kind TEXT NOT NULL DEFAULT ''`);
    // The guest brief (26 Nov): guest_briefs, and brief_id here.
    await ensureBriefs();
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
    return { id: r.id, questions, guestName: r.guest_name, guestEmail: r.guest_email, whenText: r.when_text, whenIso: r.when_iso, linkedinUrl: r.linkedin_url ?? "", zoomLink: r.zoom_link, linkLater: Number(r.link_later ?? 0) === 1, note: r.note, showId: Number(r.show_id ?? 0) || null, status: r.status, answers, hasPhoto: !!r.photo_key, invitedAt: r.invited_at, answeredAt: r.answered_at, usedRec: r.used_rec, briefId: Number(r.brief_id ?? 0) || null, link: `${ORIGIN}/guest-invite/${r.token}` };
  };

  app.get("/api/host/guest-invites", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await ensure();
    res.json(rows(await db.execute(sql`select * from guest_invites where owner_email=${mine(req)} order by id desc limit 100`)).map(view));
  });

  /** Studio → Show panel (26 Nov): the next guest, nearest from an hour ago on, or null. Host only. */
  app.get("/api/host/guest-invites/next", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await ensure();
    const from = Date.now() - 3600_000;
    const next = rows(await db.execute(sql`select id, guest_name, when_text, when_iso, brief_id from guest_invites where owner_email=${mine(req)} and when_iso<>''`))
      .map((r) => ({ r, t: Date.parse(String(r.when_iso)) || 0 })).filter((x) => x.t >= from).sort((a, b) => a.t - b.t)[0]?.r;
    res.json(next ? { id: Number(next.id), guestName: String(next.guest_name), whenText: String(next.when_text), whenIso: String(next.when_iso), briefId: Number(next.brief_id ?? 0) || null } : null);
  });

  /** The host's coming Radio shows, for the "in my booth" choice. */
  app.get("/api/host/guest-invites/bookings", requireHostSession, async (req, res) => {
    const list = await boothBookings(mine(req));
    res.json(list.map((b) => ({ id: b.id, show: b.show, startAtUtc: new Date(b.startMs).toISOString(), label: `${b.show} · ${etLabel(b.startMs)}` })));
  });

  /** Who the invitation email says it is from: <name>@militaryvoices.ai, replies to the host. */
  app.get("/api/host/guest-invites/sender", requireHostSession, async (req, res) => {
    const email = mine(req);
    const show = await inviteShow(email, req.query.show);
    const slug = await senderFor(email, show);
    // For the email preview under the form (Andrew, 26 Nov: "Show them what it will look like"): the same names and
    // studio link sendInterviewInvite uses. Read only: a host with no studio yet sees no link rather than getting one made.
    const profile = await storage.getProfileByEmail(email);
    const title = show?.title || (profile?.podcastName ?? "");
    const tok = rows(await db.execute(sql`select invite_token from personal_studios where owner_email=${email} limit 1`))[0]?.invite_token;
    // fromShow: the address follows the picked show, so "Change the name" doesn't apply.
    res.json({
      slug, address: `${slug}@militaryvoices.ai`, replyTo: email, fromShow: !!show && slug === show.slug,
      who: profile?.hostName || title || "Your host", show: title, studioLink: tok ? `${ORIGIN}/my-studio/join/${tok}${show ? `?show=${show.id}` : ""}` : "",
    });
  });
  app.put("/api/host/guest-invites/sender", requireHostSession, async (req, res) => {
    const email = mine(req);
    const slug = str(req.body?.slug, 40).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slugOk(slug)) return res.status(400).json({ message: "Use 3 to 30 letters, numbers or dashes, like bounce-back." });
    const taken = (await db.execute(sql`select key from site_settings where key like 'invite-slug:%' and value = ${slug} and key <> ${`invite-slug:${email}`} limit 1`)) as unknown as unknown[];
    if (taken.length) return res.status(409).json({ message: "Someone already uses that one. Try another." });
    await storage.setSetting(`invite-slug:${email}`, slug);
    res.json({ slug, address: `${slug}@militaryvoices.ai`, replyTo: email });
  });

  app.post("/api/host/guest-invites", requireHostSession, async (req, res) => {
    await ensure();
    const owner = mine(req);
    const guestName = str(req.body?.guestName, 80), guestEmail = str(req.body?.guestEmail, 200).toLowerCase();
    const note = str(req.body?.note, 1200);
    // "linkedin.com/in/x" or a full link; anything else isn't a LinkedIn page.
    const liRaw = str(req.body?.linkedin, 300);
    const linkedinUrl = liRaw ? (/^https?:\/\//i.test(liRaw) ? liRaw : `https://${liRaw.replace(/^\/+/, "")}`) : "";
    if (linkedinUrl && !/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/\S+$/i.test(linkedinUrl)) return res.status(400).json({ message: "That doesn't look like a LinkedIn link. It should look like linkedin.com/in/their-name." });
    let zoomLink = str(req.body?.zoomLink, 500);
    const linkKind = ["streamyard", "restream", "obs"].includes(String(req.body?.where)) ? String(req.body.where) : "";
    // "In my Radio booth": the guest's private link into that booking (made here, with our own key), and its time.
    let boothShow = "";
    // "In my studio room": the guest joins the host's own room by its link; the time is the one they typed.
    const show = await inviteShow(owner, req.body?.showId);
    // The studio link carries the show, so the room greets the guest with its name, not the room's own.
    if (req.body?.where === "studio") zoomLink = `${await roomInviteLink(owner)}${show ? `?show=${show.id}` : ""}`;
    if (req.body?.where === "booth") {
      const mineList = await boothBookings(owner);
      const b = mineList.find((x) => x.id === Number(req.body?.bookingId));
      if (!b) return res.status(400).json({ message: "Pick one of your coming Radio shows." });
      zoomLink = `${ORIGIN}/booth/${b.id}?g=${boothGuestKey(b.id)}`;
      boothShow = b.show;
      req.body.whenText = etLabel(b.startMs);
      req.body.whenIso = new Date(b.startMs).toISOString();
    }
    const questions = (Array.isArray(req.body?.questions) ? req.body.questions : []).map((q: unknown) => str(q, 300)).filter(Boolean).slice(0, 10);
    if (!guestName) return res.status(400).json({ message: "Add the guest's name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)) return res.status(400).json({ message: "Add the guest's email address." });
    const whenText = str(req.body?.whenText, 120), whenIso = str(req.body?.whenIso, 40);
    if (zoomLink && !/^https?:\/\/\S+$/i.test(zoomLink)) return res.status(400).json({ message: `The ${linkKind ? "link" : "Zoom link"} should start with https://` });
    // On Zoom, the guest needs the link from somewhere: pasted here, or the host's word that they'll send it themselves.
    const linkLater = !zoomLink && req.body?.linkLater === true;
    if (!zoomLink && !linkLater) return res.status(400).json({ message: linkKind ? "Paste the link your guest opens, or tick \"I'll send the link in a separate email\"." : "Paste your Zoom link, or tick \"I'll send the Zoom link in a separate email\"." });
    const count = Number(rows(await db.execute(sql`select count(*)::int n from guest_invites where owner_email=${owner} and created_at > ${new Date(Date.now() - 24 * 3600_000).toISOString()}`))[0]?.n ?? 0);
    if (count >= 20) return res.status(429).json({ message: "That's a lot of invitations today. Try again tomorrow." });
    const profile = await storage.getProfileByEmail(owner);
    const token = crypto.randomBytes(18).toString("base64url");
    const now = new Date().toISOString();
    const [r] = rows(await db.execute(sql`insert into guest_invites (token, owner_email, guest_email, guest_name, when_text, when_iso, zoom_link, link_later, note, questions, created_at, invited_at) values (${token}, ${owner}, ${guestEmail}, ${guestName}, ${whenText}, ${whenIso}, ${zoomLink}, ${linkLater ? 1 : 0}, ${note}, ${JSON.stringify(questions)}, ${now}, ${now}) returning *`));
    if (show) { await db.execute(sql`update guest_invites set show_id=${show.id} where id=${Number(r.id)}`); r.show_id = show.id; }
    if (linkedinUrl) { await db.execute(sql`update guest_invites set linkedin_url=${linkedinUrl} where id=${Number(r.id)}`); r.linkedin_url = linkedinUrl; }
    if (linkKind) { await db.execute(sql`update guest_invites set link_kind=${linkKind} where id=${Number(r.id)}`); r.link_kind = linkKind; }
    // A brief looked up on the form goes with the invite (it's the host's alone; nothing of it is in the email).
    const briefId = Number(req.body?.briefId) || 0;
    if (briefId) { await attachBrief(owner, Number(r.id), briefId); r.brief_id = briefId; }
    const ok = await sendInterviewInvite({ fromLocal: await senderFor(owner, show), to: guestEmail, guestName, hostName: profile?.hostName ?? "", hostEmail: owner, show: boothShow || show?.title || (profile?.podcastName ?? ""), whenText, zoomLink, linkLater, where: linkKind, note, link: `${ORIGIN}/guest-invite/${token}` });
    if (!ok) return res.status(502).json({ message: "The email didn't go. Try again in a moment.", invite: view(r) });
    res.status(201).json(view(r));
  });

  /** Send an invitation again, to the same address or a corrected one (a typo is the usual reason it never arrived). */
  app.post("/api/host/guest-invites/:id/resend", requireHostSession, async (req, res) => {
    await ensure();
    const owner = mine(req);
    const [r] = rows(await db.execute(sql`select * from guest_invites where id=${Number(req.params.id)} and owner_email=${owner}`));
    if (!r) return res.status(404).json({ message: "No such invitation." });
    const to = str(req.body?.guestEmail, 200).toLowerCase() || String(r.guest_email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ message: "Add the guest's email address." });
    const since = new Date(Date.now() - 3600_000).toISOString();
    const n = Number(rows(await db.execute(sql`select count(*)::int n from guest_invites where owner_email=${owner} and invited_at > ${since}`))[0]?.n ?? 0);
    if (n >= 20) return res.status(429).json({ message: "That's a lot of invitations just now. Try again in a little while." });
    const now = new Date().toISOString();
    const [u] = rows(await db.execute(sql`update guest_invites set guest_email=${to}, invited_at=${now} where id=${Number(r.id)} returning *`));
    const profile = await storage.getProfileByEmail(owner);
    const show = await inviteShow(owner, u.show_id);
    const ok = await sendInterviewInvite({ fromLocal: await senderFor(owner, show), to, guestName: String(u.guest_name), hostName: profile?.hostName ?? "", hostEmail: owner, show: show?.title || (profile?.podcastName ?? ""), whenText: String(u.when_text), zoomLink: String(u.zoom_link), linkLater: Number(u.link_later ?? 0) === 1, where: String(u.link_kind ?? ""), note: String(u.note), link: `${ORIGIN}/guest-invite/${u.token}` });
    if (!ok) return res.status(502).json({ message: "The email didn't go. Try again in a moment." });
    res.json(view(u));
  });

  app.delete("/api/host/guest-invites/:id", requireHostSession, async (req, res) => {
    await ensure();
    const owner = mine(req);
    const gone = rows(await db.execute(sql`delete from guest_invites where id=${Number(req.params.id)} and owner_email=${owner} returning brief_id`))[0];
    // Its brief goes with it (PM, 26 Nov: "deleted with the invite").
    await deleteBriefOf(owner, Number(gone?.brief_id ?? 0));
    res.json({ ok: true });
  });

  /** Their photo, for the host to see. */
  app.get("/api/host/guest-invites/:id/photo", requireHostSession, async (req, res) => {
    await ensure();
    const r = rows(await db.execute(sql`select photo_key from guest_invites where id=${Number(req.params.id)} and owner_email=${mine(req)}`))[0];
    if (!r?.photo_key) return res.status(404).end();
    res.redirect(await signedRecordingUrl(String(r.photo_key), 900));
  });

  // ── Link previews (Andrew, 24 Nov: Riccoh's invite unfurled as the Podcast Marathon card) ──
  // A guest-invite or studio-join link pasted into a message shows the host's own show: its name, the host, its cover.
  // Only the preview robots get this page (vercel.json routes their user agents here). The guest's name and email,
  // and the invite's token, never go in it; the picture is keyed by the show (or the host's profile), not the invite.
  const PREVIEW_BOT = /facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|redditbot|pinterest|embedly|skypeuripreview|mastodon|bluesky|iframely|vkshare|quora link preview/i;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /** Which show a link is for: the picked one, else the one whose title matches the name the guest sees, else their only show. */
  const showForLink = async (owner: string, picked: unknown, name: string): Promise<Show | null> => {
    return showFor(owner, picked, name);
  };
  const previewPage = async (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], o: { owner: string; show: Show | null; name: string; join: boolean }) => {
    const profile = await storage.getProfileByEmail(o.owner);
    const host = profile?.hostName || "Your host";
    const showName = o.show?.title || o.name || profile?.podcastName || "a MilitaryVoices.ai show";
    const origin = `https://${req.get("host")}`;
    const title = o.join ? `Join ${host} on ${showName}` : `${host} invites you to be a guest on ${showName}`;
    const line = o.join
      ? `Open the link at interview time, allow your camera and microphone, and you're in. No account needed.`
      : `A few quick questions and the photo you'd like shown with your name, about five minutes. Then you're set for the interview.`;
    const img = `${origin}/og/invite.jpg?${o.show ? `show=${o.show.id}` : `p=${profile?.id ?? 0}`}${o.join ? "&join=1" : ""}&v=2`;
    const url = `${origin}${req.path}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    // Not for search engines: the link is the guest's key.
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="robots" content="noindex" /><title>${esc(title)}</title><meta name="description" content="${esc(line)}" /><meta property="og:type" content="website" /><meta property="og:site_name" content="MilitaryVoices.ai" /><meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(line)}" /><meta property="og:url" content="${esc(url)}" /><meta property="og:image" content="${esc(img)}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="${esc(`${showName}, with ${host}`)}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${esc(title)}" /><meta name="twitter:description" content="${esc(line)}" /><meta name="twitter:image" content="${esc(img)}" /></head><body><h1>${esc(title)}</h1><p>${esc(line)}</p></body></html>`);
  };
  app.get("/guest-invite/:token", async (req, res, next) => {
    if (!PREVIEW_BOT.test(String(req.get("user-agent") ?? ""))) return next();
    await ensure();
    const r = rows(await db.execute(sql`select owner_email, show_id from guest_invites where token=${String(req.params.token)}`))[0];
    if (!r) return next();
    const owner = String(r.owner_email);
    const profile = await storage.getProfileByEmail(owner);
    await previewPage(req, res, { owner, show: await showForLink(owner, r.show_id, profile?.podcastName ?? ""), name: profile?.podcastName ?? "", join: false });
  });
  app.get("/my-studio/join/:token", async (req, res, next) => {
    if (!PREVIEW_BOT.test(String(req.get("user-agent") ?? ""))) return next();
    const r = rows(await db.execute(sql`select owner_email, name from personal_studios where invite_token=${String(req.params.token)}`))[0];
    if (!r) return next();
    const owner = String(r.owner_email).trim().toLowerCase();
    await previewPage(req, res, { owner, show: await showForLink(owner, req.query.show, String(r.name ?? "")), name: String(r.name ?? ""), join: true });
  });
  /** The picture: the show's cover on our navy, its name and the host. By show id, or the host's profile when there's no show. */
  app.get("/og/invite.jpg", async (req, res) => {
    let name = "", host = "", photo = "", photoShape: "art" | "circle" = "art";
    const sid = Number(req.query.show) || 0;
    if (sid) {
      const s0 = rows(await db.execute(sql`select email, title, artwork_url from hosted_shows where id=${sid}`))[0];
      if (s0) {
        const profile = await storage.getProfileByEmail(String(s0.email).trim().toLowerCase());
        name = String(s0.title ?? ""); host = profile?.hostName ?? ""; photo = String(s0.artwork_url ?? "") || profile?.photoUrl || "";
        if (!s0.artwork_url) photoShape = "circle";
      }
    } else if (Number(req.query.p)) {
      const p0 = rows(await db.execute(sql`select podcast_name, host_name, photo_url from podcaster_profiles where id=${Number(req.query.p)}`))[0];
      if (p0) { name = String(p0.podcast_name ?? ""); host = String(p0.host_name ?? ""); photo = String(p0.photo_url ?? ""); photoShape = "circle"; }
    }
    const jpg = await buildShareCard({
      podcastName: name || "MilitaryVoices.ai",
      hostName: host,
      subline: host ? undefined : "Podcasts by and for the military community",
      whenLabel: req.query.join ? "Join the interview" : "You're invited",
      photoUrl: photo || undefined,
      photoShape,
      eyebrow: "Guest invitation",
      footer: "militaryvoices.ai",
    }, "wide");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.end(jpg);
  });

  // The guest's side: no account, the link is the key.
  app.get("/api/public/guest-invite/:token", async (req, res) => {
    await ensure();
    res.setHeader("Cache-Control", "no-store");
    const r = rows(await db.execute(sql`select * from guest_invites where token=${String(req.params.token)}`))[0];
    if (!r) return res.status(404).json({ message: "That link isn't working. Ask your host to send it again." });
    const profile = await storage.getProfileByEmail(String(r.owner_email));
    let questions: string[] = []; try { questions = JSON.parse(String(r.questions || "[]")); } catch { questions = []; }
    const show = await inviteShow(String(r.owner_email), r.show_id);
    res.json({ questions, hostName: profile?.hostName ?? "", hostPhoto: profile?.photoUrl ?? "", show: show?.title || (profile?.podcastName ?? ""), guestName: r.guest_name, whenText: r.when_text, zoomLink: r.zoom_link, linkLater: Number(r.link_later ?? 0) === 1, where: String(r.link_kind ?? ""), note: r.note, answered: r.status === "answered" });
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
    const show = await inviteShow(String(r.owner_email), r.show_id);
    void sendInterviewAnswered({ to: String(r.owner_email), guestName: name, show: show?.title || (profile?.podcastName ?? ""), summary, link: `${ORIGIN}/host/dashboard/podcast` }).catch(() => undefined);
    res.json({ ok: true });
  });
}
