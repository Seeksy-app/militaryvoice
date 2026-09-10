// Time zone + slot math helpers. Pure functions, no React here.

export interface TimeZoneOption {
  id: string;
  label: string;
}

// Zones we spotlight because they matter for a global military/veteran audience:
// Guam and Japan are explicitly the "can we make late-night US slots shine somewhere"
// zones, Korea/Germany/Hawaii/UK cover the largest overseas and stateside duty station
// clusters, and the four continental US zones cover the bulk of hosts signing up.
export const SPOTLIGHT_ZONES: TimeZoneOption[] = [
  { id: "Pacific/Guam", label: "Guam" },
  { id: "Asia/Tokyo", label: "Japan" },
  { id: "Asia/Seoul", label: "South Korea" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "Australia/Sydney", label: "Australia (Sydney)" },
  { id: "Europe/Berlin", label: "Germany" },
  { id: "Europe/London", label: "UK" },
];

export const US_ZONES: TimeZoneOption[] = [
  { id: "America/New_York", label: "US Eastern" },
  { id: "America/Chicago", label: "US Central" },
  { id: "America/Denver", label: "US Mountain" },
  { id: "America/Los_Angeles", label: "US Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
];

export const COMMON_ZONES: TimeZoneOption[] = [...SPOTLIGHT_ZONES, ...US_ZONES, { id: "UTC", label: "UTC" }];

export function detectLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function allTimeZones(): string[] {
  try {
    // @ts-ignore - supportedValuesOf is available in modern runtimes
    if (typeof Intl.supportedValuesOf === "function") {
      // @ts-ignore
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // fall through
  }
  return COMMON_ZONES.map((z) => z.id);
}

export function totalSlots(durationHours: number, slotMinutes: number): number {
  return Math.max(0, Math.floor((durationHours * 60) / slotMinutes));
}

export function slotStart(eventStartUtc: string, slotMinutes: number, index: number): Date {
  const start = new Date(eventStartUtc);
  return new Date(start.getTime() + index * slotMinutes * 60000);
}

export function slotEnd(eventStartUtc: string, slotMinutes: number, index: number): Date {
  return new Date(slotStart(eventStartUtc, slotMinutes, index).getTime() + slotMinutes * 60000);
}

export function hourInZone(date: Date, timeZone: string): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(date);
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h;
}

export function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

const PRIME_START_HOUR = 8; // 8:00 AM
const PRIME_END_HOUR = 22; // 10:00 PM (exclusive)

export function isPrimeTimeInZone(date: Date, timeZone: string): boolean {
  const h = hourInZone(date, timeZone);
  return h >= PRIME_START_HOUR && h < PRIME_END_HOUR;
}

export function primeZonesFor(date: Date, zones: TimeZoneOption[] = SPOTLIGHT_ZONES): TimeZoneOption[] {
  return zones.filter((z) => isPrimeTimeInZone(date, z.id));
}

// A "hidden gem" slot is rough for the US mainland (late night / early morning
// Eastern) but lands in prime waking hours somewhere overseas — exactly the
// slots hosts overlook that we want to spotlight for a global audience.
export function isHiddenGemSlot(date: Date): boolean {
  const easternHour = hourInZone(date, "America/New_York");
  const isUsOffHours = easternHour >= 23 || easternHour < 7;
  if (!isUsOffHours) return false;
  return primeZonesFor(date).length > 0;
}

export function zoneLabel(id: string): string {
  const found = COMMON_ZONES.find((z) => z.id === id);
  if (found) return found.label;
  const city = id.split("/").pop() || id;
  return city.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Wall-clock <-> UTC conversion for the admin "when does this start" input.
// No date library needed — Intl.DateTimeFormat gives us everything.
// ---------------------------------------------------------------------------

function partsInZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asUtc - date.getTime();
}

/** Format a UTC instant as a `YYYY-MM-DDTHH:mm` string for an `<input type="datetime-local">`, in the given zone. */
export function utcToDateTimeLocalValue(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/** Interpret a `datetime-local` string as wall-clock time in the given zone, return the equivalent UTC Date. */
export function dateTimeLocalToUtc(value: string, timeZone: string): Date {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = (timePart || "00:00").split(":").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = zoneOffsetMs(new Date(utcGuess), timeZone);
  let utc = utcGuess - offset;
  offset = zoneOffsetMs(new Date(utc), timeZone);
  utc = utcGuess - offset;
  return new Date(utc);
}
