// Which slots must be broadcast live.
//
// Daytime is the shop window: the hours a first-time visitor is most likely to
// drop in, so those slots have to be someone actually on camera rather than a
// file rolling. Overnight, a pre-recorded episode is welcome — it keeps the
// marathon going at 3am without asking anyone to be awake for it.
//
// The window is fixed to the event's home zone, not the viewer's: a podcaster
// in Guam picking a slot still gets the rule the schedule was built around.

export const LIVE_ONLY_ZONE = "America/New_York";
export const LIVE_ONLY_START_HOUR = 7; // 7:00 AM
export const LIVE_ONLY_END_HOUR = 20; // 8:00 PM — the last restricted slot is 7:30–8:00

/** "7:00 AM – 8:00 PM ET", for anything that has to say the rule out loud. */
export const LIVE_ONLY_LABEL = "7:00 AM – 8:00 PM ET";

/** Minutes past midnight in the given zone. */
function wallMinutes(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * True when the whole block sits inside the live-only window. Containment, not
 * overlap: a block straddling 8pm is an evening slot and keeps its choice.
 */
export function isLiveOnlyBlock(start: Date, end: Date): boolean {
  const s = wallMinutes(start, LIVE_ONLY_ZONE);
  let e = wallMinutes(end, LIVE_ONLY_ZONE);
  if (e <= s) e += 24 * 60; // block crossed midnight
  return s >= LIVE_ONLY_START_HOUR * 60 && e <= LIVE_ONLY_END_HOUR * 60;
}

/** Same rule, from the schedule maths every caller already has to hand. */
export function isLiveOnlySlot(
  eventStartAtUtc: string,
  slotMinutes: number,
  slotIndex: number,
): boolean {
  const start = new Date(new Date(eventStartAtUtc).getTime() + slotIndex * slotMinutes * 60000);
  if (Number.isNaN(start.getTime())) return false;
  return isLiveOnlyBlock(start, new Date(start.getTime() + slotMinutes * 60000));
}
