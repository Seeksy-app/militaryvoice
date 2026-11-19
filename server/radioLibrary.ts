// MilitaryVoices Radio shows into the host's own Library (18 Nov 2026).
//
// The station records the whole day. Once a live booking has ended and one finished recording covers all of it, the worker cuts
// that show out (720p, without the red LIVE badge, read straight from storage so nothing big is downloaded) and it becomes a
// recording in the host's Library, with the same "your episode is in your Library" email a Zoom recording gets.
//
// State per booking is the site setting dx:lib:<signupId>: "" (not yet), "want" (do it even though it aired before this began),
// "running:<time>", "done:<recordingId>", "missed" (no recording covers it) or "failed:<n>". Shows that aired before dx:lib-from
// (set the first time this runs) are left alone unless marked "want": no surprise emails about last week.
import { getLayoutDefault } from "./layoutDefault.js";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import { bookingTimes } from "./booth.js";
import { dxEventIds } from "./digitalExperience.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { sendImportReadyEmail } from "./email.js";
import { DEFAULT_CLIP_OPTIONS } from "../shared/schema.js";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const stateKey = (id: number) => `dx:lib:${id}`;

export type RadioCutJob = { signupId: number; title: string; durationSec: number; srcUrl: string; ss: number; dur: number; /** 2 when a co-host was in the booth too: they get a copy of their own. */ copies: number };

let lastScan = 0;
export async function claimRadioShowCut(): Promise<RadioCutJob | null> {
  if (Date.now() - lastScan < 30_000) return null; // the worker asks every few seconds; once every half minute is plenty
  lastScan = Date.now();
  let from = await storage.getSetting("dx:lib-from");
  if (!from) { from = new Date().toISOString(); await storage.setSetting("dx:lib-from", from); }
  const now = Date.now();
  const stale = new Date(now - 90 * 60_000).toISOString();
  for (const eventId of await dxEventIds()) {
    const ev = await storage.getEventById(eventId);
    if (!ev) continue;
    const signups = (await storage.listSignups(eventId)).filter((x) => x.status !== "cancelled" && x.showFormat !== "prerecorded" && x.id !== 60 && x.email);
    let recs: { id: number; url: string; startMs: number; durMs: number; status: string }[] | null = null;
    for (const s of signups.sort((a, b) => a.slotIndex - b.slotIndex)) {
      const state = ((await storage.getSetting(stateKey(s.id))) ?? "").trim();
      const t = bookingTimes(ev, s);
      const endedRaw = await storage.getSetting(`dx:ended:${s.id}`);
      const ended = endedRaw ? Date.parse(endedRaw) : 0;
      const showStart = t.onAirStart, showEnd = ended && ended < t.onAirEnd ? ended : t.onAirEnd;
      if (state.startsWith("done:") || state === "missed") continue;
      if (state.startsWith("running:") && state.slice(8) > stale) continue;
      const fails = state.startsWith("failed:") ? Number(state.slice(7)) : 0;
      if (fails >= 3) continue;
      if (state !== "want" && new Date(showEnd).toISOString() < from) continue;
      if (showEnd > now - 5 * 60_000) continue; // still on, or just ended
      // A booking nobody came to (the station moved on in a few minutes) has no show to keep.
      if (showEnd - showStart < 5 * 60_000) { await storage.setSetting(stateKey(s.id), "missed"); continue; }
      if (!recs) recs = await listDayRecordings(eventId);
      const rec = recs.find((r) => r.status === "Ready" && r.url && showStart >= r.startMs && showEnd <= r.startMs + r.durMs);
      if (!rec) {
        // Recordings still running may yet cover it; one that finished without covering it never will.
        const open = recs.some((r) => r.status === "Recording");
        if (!open && now - showEnd > 3 * 3600_000) await storage.setSetting(stateKey(s.id), "missed");
        continue;
      }
      await storage.setSetting(stateKey(s.id), `running:${new Date().toISOString()}`);
      const day = new Date(ev.startAtUtc).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
      return {
        signupId: s.id, title: `${s.podcastName} · MilitaryVoices Radio · ${day}`.slice(0, 160), durationSec: Math.round((showEnd - showStart) / 1000),
        srcUrl: /^https?:\/\//i.test(rec.url) ? rec.url : await signedRecordingUrl(rec.url, 3 * 3600),
        ss: Math.max(0, (showStart - rec.startMs) / 1000), dur: (showEnd - showStart) / 1000,
        copies: s.coHostEmail && s.coHostEmail.trim().toLowerCase() !== s.email.trim().toLowerCase() ? 2 : 1,
      };
    }
  }
  return null;
}

async function listDayRecordings(eventId: number) {
  const { db } = await import("./storage.js");
  const { sql } = await import("drizzle-orm");
  const r = (await db.execute(sql`select id, url, started_at, duration_sec, status from recordings where event_id = ${eventId} and status in ('Ready', 'Recording') order by id`)) as unknown as { id: number; url: string; started_at: string; duration_sec: number; status: string }[];
  return r.map((x) => ({ id: x.id, url: x.url, startMs: Date.parse(x.started_at), durMs: (x.duration_sec || 0) * 1000, status: x.status }));
}

export function registerRadioLibrary(app: Express, requireAgent: RequestHandler): void {
  app.post("/api/agent/radio-cut/:id/done", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    const key = String(req.body?.key ?? "");
    if (!/^clean\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "No file." });
    const s = await storage.getSignupById(id);
    if (!s) return res.status(404).json({ message: "No such booking." });
    const state = ((await storage.getSetting(stateKey(id))) ?? "");
    if (state.startsWith("done:")) return res.json({ ok: true });
    const ev = await storage.getEventById(s.eventId);
    const day = ev ? new Date(ev.startAtUtc).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }) : "";
    // Everyone who was in the booth under their own name gets it in their own Library: the host, and the co-host if there was one.
    // (A guest who joined by the link has no account to put it in.) Each gets a file of their own, so deleting one never touches the other.
    const people = [{ email: s.email, key }];
    const co = (s.coHostEmail ?? "").trim().toLowerCase();
    const key2 = String(req.body?.key2 ?? "");
    if (co && co !== s.email.trim().toLowerCase() && /^clean\/[\w.-]+$/.test(key2)) people.push({ email: co, key: key2 });
    const title = `${s.podcastName} · MilitaryVoices Radio · ${day}`.slice(0, 160);
    let rec = null as Awaited<ReturnType<typeof storage.createUploadedRecording>> | null;
    for (const p of people) {
      const row = await storage.createUploadedRecording({ email: p.email, title, storageKey: p.key, durationSec: Number(req.body?.durationSec) || 0, sizeBytes: Number(req.body?.sizeBytes) || 0, free: false, queue: false });
      rec ??= row;
      // A Radio show has two people in two tiles: Pōstify stacks them, one over the other, by default.
      // Unless the podcaster's own default for two people is side by side or follow the speaker; then that.
      const own = await getLayoutDefault(p.email);
      await storage.setClipOptions(row.id, JSON.stringify({ ...DEFAULT_CLIP_OPTIONS, layout: own === "side" || own === "single" ? own : "radio" }));
      // The same note a Zoom recording gets: it's in your Library.
      void sendImportReadyEmail({ to: p.email, recordingId: row.id, title: row.title, startedAt: new Date(Date.now() - (Number(req.body?.durationSec) || 0) * 1000).toISOString(), durationSec: row.durationSec, provider: "radio" }).catch((err) => console.error("Radio library email failed:", (err as Error).message));
    }
    await storage.setSetting(stateKey(id), `done:${rec!.id}`);
    res.json({ ok: true, recordingId: rec!.id });
  });
  app.post("/api/agent/radio-cut/:id/failed", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    const state = ((await storage.getSetting(stateKey(id))) ?? "");
    const n = (state.startsWith("failed:") ? Number(state.slice(7)) : 0) + 1;
    await storage.setSetting(stateKey(id), `failed:${n}`);
    res.json({ ok: true });
  });
}
