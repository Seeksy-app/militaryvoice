// Cloud recording reminders (19 Nov 2026): the thing a podcaster forgets is turning on Zoom's cloud recording.
// For each interview they invited a guest to (guest_invites, with a time and a Zoom link):
//   - about 45 minutes ahead: "is cloud recording on?" with the steps;
//   - 75 minutes after the start: if nothing has come into the Library (or Zoom kept one that wasn't imported), say so.
// Runs every 10 minutes from Vercel cron. One email of each kind per invite, remembered in site_settings.
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { sendRecordingReminderEmail } from "./email.js";
import { zoomRecordedNear } from "./zoom.js";

const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));
const etLabel = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

const AHEAD = 45 * 60_000;
const AFTER = 75 * 60_000;
const GIVE_UP = 24 * 3_600_000;

export async function runRecordingReminders(now = Date.now(), dryRun = false) {
  const out: { id: number; to: string; sent: string }[] = [];
  let invites: Record<string, unknown>[] = [];
  try {
    invites = rows(await db.execute(sql`select id, owner_email, guest_name, when_iso, zoom_link from guest_invites where when_iso <> '' and zoom_link <> ''`));
  } catch {
    return out; // no invitations have ever been made
  }
  for (const inv of invites) {
    const id = Number(inv.id);
    const whenMs = Date.parse(String(inv.when_iso));
    if (!Number.isFinite(whenMs) || !/zoom\.(us|com)/i.test(String(inv.zoom_link))) continue;
    const to = String(inv.owner_email).trim().toLowerCase();
    const name = String(inv.guest_name ?? "");
    const label = etLabel(whenMs);

    // Ahead of the call: from 45 minutes before, until it has begun.
    const beforeKey = `rec-remind:before:${id}`;
    if (now >= whenMs - AHEAD && now < whenMs + 5 * 60_000 && !(await storage.getSetting(beforeKey))) {
      if (!dryRun) {
        await storage.setSetting(beforeKey, new Date(now).toISOString());
        await sendRecordingReminderEmail({ to, kind: "before", guestName: name, whenLabel: label });
      }
      out.push({ id, to, sent: "before" });
    }

    // After it: 75 minutes in, for a day.
    const afterKey = `rec-remind:after:${id}`;
    if (now >= whenMs + AFTER && now < whenMs + GIVE_UP && !(await storage.getSetting(afterKey))) {
      const mine = await storage.listRecordingsByEmail(to);
      const inLibrary = mine.some((r) => {
        const t = Date.parse(r.startedAt || r.endedAt || "");
        return Number.isFinite(t) && Math.abs(t - whenMs) < 4 * 3_600_000;
      });
      if (inLibrary) {
        if (!dryRun) await storage.setSetting(afterKey, "in-library");
        continue;
      }
      const zoom = await zoomRecordedNear(to, whenMs);
      const kind = zoom === "found" ? "in-zoom" : "none";
      if (!dryRun) {
        await storage.setSetting(afterKey, kind);
        await sendRecordingReminderEmail({ to, kind, guestName: name, whenLabel: label });
      }
      out.push({ id, to, sent: kind });
    }
  }
  return out;
}

export function registerRecordingReminders(app: Express): void {
  const handler: RequestHandler = async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (secret && auth !== secret) return res.status(401).json({ message: "Not authorised." });
    try {
      res.json({ sent: await runRecordingReminders(Date.now(), req.query.dryRun === "1") });
    } catch (err) {
      console.error("recording reminders failed:", (err as Error).message);
      res.status(500).json({ message: "Try again." });
    }
  };
  app.get("/api/cron/recording-reminders", handler);
  app.post("/api/cron/recording-reminders", handler);
}
