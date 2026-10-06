// Event admins (6 Oct 2026): someone who runs one event — its studio, lineup,
// sponsors, magazine, texts and money — and nothing on the platform beyond it.
// Riccoh is the first: he co-runs the Marathon but isn't a platform admin.
//
// An allowlist, not a denylist: a new admin endpoint is closed to event admins
// until it's added here, so nothing platform-wide leaks by default.
import { storage } from "./storage.js";

export const eventAdminKey = (eventId: number) => `event_admins:${eventId}`;

export async function eventAdminEmails(eventId: number): Promise<string[]> {
  return ((await storage.getSetting(eventAdminKey(eventId))) ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

/** The events this address is an admin of (none for most people). */
export async function eventAdminEvents(email: string | null | undefined): Promise<number[]> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return [];
  const out: number[] = [];
  for (const ev of await storage.listEvents()) if ((await eventAdminEmails(ev.id)).includes(e)) out.push(ev.id);
  return out;
}

/** The parts of admin that belong to an event. Everything else is the platform's. */
const EVENT_SECTIONS = new Set([
  "studio", "studios", "scenes", "run-of-show", "media", "destinations", "ingress", "lower-thirds", "standby-build", "scene-takes",
  "signups", "recordings", "cohost-slots", "greenroom", "chat", "guests", "captures", "clips", "assets",
  "sponsors", "sponsor-packages", "sponsor-leads", "show-sponsors", "sponsor-finder", "settings",
  "social-posts", "magazine", "survey", "sms", "finance-actuals", "production-costs", "aar",
  "event", "events", "audience", "reach", "studio-hosts", "handoff-scripts", "headshot-links", "reminders", "nudges", "music", "house-upload",
]);

/** May an event admin of `events` make this request? */
export function eventAdminMay(o: { method: string; path: string; query: Record<string, unknown>; body: Record<string, unknown> | undefined; events: number[]; featuredId: number }): boolean {
  const m = o.path.match(/^\/api\/admin\/([a-z0-9-]+)(\/.*)?$/);
  if (!m || !EVENT_SECTIONS.has(m[1])) return false;
  const [, section, rest = ""] = m;
  const body = o.body ?? {};
  const mine = (n: number) => o.events.includes(n);

  if (section === "events") {
    if (rest === "" || rest === "/") return o.method === "GET"; // the list (filtered to theirs); never create one
    const id = Number(rest.split("/")[1]);
    if (!mine(id)) return false;
    if (o.method === "DELETE" && rest.split("/").length === 2) return false; // deleting the event itself
    if ("isFeatured" in body) return false; // what the homepage shows is the platform's call
    return true;
  }
  if (section === "sms" && /^\/(connect-webhook|test)\b/.test(rest)) return false;
  // Reports and money with a scope: theirs only, never the platform's.
  for (const s of [o.query.scope, body.scope]) {
    if (s === undefined || s === null || s === "") continue;
    const id = Number(String(s).replace(/^event:/, ""));
    if (!Number.isFinite(id) || !mine(id)) return false;
  }
  const ids = [o.query.eventId, body.eventId].filter((v) => v !== undefined && v !== null && v !== "").map(Number);
  if (ids.length) return ids.every(mine);
  // No event named: the route works on the featured event, so it has to be theirs.
  return mine(o.featuredId);
}
