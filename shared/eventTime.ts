// A member's event reads in its own zone (24 Nov 2026, Andrew via PM: times follow the event, "9:00 AM PT").
// Plain Intl, no library; used by the event page, the /events cards, My events and the sign-up email.

const SHORT: Record<string, string> = {
  "America/New_York": "ET", "America/Detroit": "ET", "America/Indiana/Indianapolis": "ET",
  "America/Chicago": "CT", "America/Denver": "MT", "America/Boise": "MT", "America/Phoenix": "MT",
  "America/Los_Angeles": "PT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HT", "America/Puerto_Rico": "AT",
};

/** "PT", "ET"… for US zones; the zone's own short name elsewhere ("GMT+9", "CET"). */
export function zoneShort(tz: string, at: Date = new Date()): string {
  if (SHORT[tz]) return SHORT[tz];
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

const safe = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "America/New_York"; } };

/** "Saturday, December 12" in the event's zone. */
export function eventDay(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: safe(tz), weekday: "long", month: "long", day: "numeric" });
}
/** "9:00 AM" in the event's zone. */
export function eventTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: safe(tz), hour: "numeric", minute: "2-digit" });
}
/** "9:00 – 11:00 AM PT", or "9:00 AM PT" with no end. */
export function eventTimes(startIso: string, endIso: string, tz: string): string {
  const z = zoneShort(safe(tz), new Date(startIso));
  if (!endIso) return `${eventTime(startIso, tz)} ${z}`;
  const a = eventTime(startIso, tz), b = eventTime(endIso, tz);
  const [at, am] = a.split(" "), [, bm] = b.split(" ");
  return `${am === bm ? at : a} – ${b} ${z}`;
}

export type EventQuestion = { q: string; type: "text" | "choice"; options: string[] };
/** The planner's questions, cleaned: up to five, each with a prompt; choices need two or more options. */
export function readQuestions(raw: unknown): EventQuestion[] {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = raw ? JSON.parse(raw) : []; } catch { v = []; } }
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const q = String(o.q ?? "").trim().slice(0, 160);
    const options = Array.isArray(o.options) ? o.options.map((s) => String(s ?? "").trim().slice(0, 80)).filter(Boolean).slice(0, 8) : [];
    const type: EventQuestion["type"] = o.type === "choice" && options.length >= 2 ? "choice" : "text";
    return { q, type, options: type === "choice" ? options : [] };
  }).filter((x) => x.q);
}
