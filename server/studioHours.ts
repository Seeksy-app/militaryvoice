// Studio hours (Andrew, 25 Nov 2026: "1. Agree" to Growth 2, Scale 4 and Pro 10 hours a month).
//
// Counted: time a creator's own Studio (/room, personal_studios) is recording or live, per account per calendar month
// (UTC, like Stream in). Recording and live at the same time count once. Radio, the producer console and Stream in
// are not counted. One studio_sessions row per stretch; myStudio.ts calls syncStudioMeter whenever its recording or
// live flags change, and the minute pass closes anything left open.
//
// At the limit nothing already running is cut (a live show is never stopped on the clock); a new Record or Go live
// answers 402 with a line pointing to an upgrade. Extra hours ($2 each) aren't built yet.
//
// Unlimited: Pōstify testers (POST_TESTERS), the owner's own accounts (OWNER_ACCOUNTS + SOCIAL_TRIAL_EXEMPT) and
// admins. Comp Pro is Pro (10). A setting studio-hours:<email> (hours, or "unlimited") overrides one account.
import { and, eq, gte } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { studioSessions, type PersonalStudioRow } from "../shared/schema.js";
import { STUDIO_HOURS } from "../shared/tokens.js";

export const STUDIO_PLAN_HOURS = STUDIO_HOURS;
const PLAN_NAME = { growth: "Growth", creator: "Scale", pro: "Pro" } as const;
type PlanKey = keyof typeof STUDIO_PLAN_HOURS;
/** "Close": this much left or less. */
export const NEAR_SECONDS = 30 * 60;

const now = () => new Date().toISOString();
const norm = (e: string) => e.trim().toLowerCase();
const list = (v: string | undefined) => (v || "").split(",").map(norm).filter(Boolean);
const testers = () => new Set(list(process.env.POST_TESTERS || "marineocsblog@gmail.com"));
const owners = () => new Set(["andrew@smartloads.io", "andrew@workready360.com", ...list(process.env.SOCIAL_TRIAL_EXEMPT)]);

/** The first of this month, UTC. */
function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
function nextMonthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

async function planKeyOf(email: string): Promise<PlanKey> {
  const sub = await storage.getSubscription(email).catch(() => undefined);
  if (sub && ["active", "trialing", "past_due"].includes(sub.status) && (sub.plan === "pro" || sub.plan === "creator")) return sub.plan;
  return "growth";
}

/** Hours this account gets a month, or null for unlimited. */
async function capHoursOf(email: string): Promise<{ hours: number | null; plan: PlanKey }> {
  const plan = await planKeyOf(email);
  const set = ((await storage.getSetting(`studio-hours:${email}`).catch(() => null)) || "").trim().toLowerCase();
  if (set === "unlimited") return { hours: null, plan };
  if (set && Number(set) >= 0) return { hours: Number(set), plan };
  if (testers().has(email) || owners().has(email)) return { hours: null, plan };
  if (await storage.isAdminEmail(email).catch(() => false)) return { hours: null, plan };
  return { hours: STUDIO_PLAN_HOURS[plan], plan };
}

export async function studioUsedSeconds(email: string, at = Date.now()): Promise<number> {
  const rows = await db.select().from(studioSessions).where(and(eq(studioSessions.ownerEmail, email), gte(studioSessions.startedAt, monthStart(new Date(at)))));
  return rows.reduce((n, r) => n + (r.endedAt ? r.seconds : Math.max(0, Math.round((at - Date.parse(r.startedAt)) / 1000))), 0);
}

export type StudioHours = {
  plan: string;
  /** Null: unlimited. */
  capMin: number | null;
  usedMin: number;
  leftMin: number | null;
  near: boolean;
  over: boolean;
  /** When the hours come back (the 1st of next month, ISO). */
  resetsAt: string;
  /** The plan with more hours, when there is one. */
  upgradeTo: { name: string; hours: number } | null;
};

export async function studioHours(emailIn: string): Promise<StudioHours> {
  await schemaIsReady();
  const email = norm(emailIn);
  const [{ hours, plan }, used] = await Promise.all([capHoursOf(email), studioUsedSeconds(email)]);
  const capS = hours === null ? null : Math.round(hours * 3600);
  const left = capS === null ? null : Math.max(0, capS - used);
  const upgradeTo = plan === "growth" ? { name: "Scale", hours: STUDIO_PLAN_HOURS.creator } : plan === "creator" ? { name: "Pro", hours: STUDIO_PLAN_HOURS.pro } : null;
  return {
    plan: PLAN_NAME[plan],
    capMin: capS === null ? null : Math.round(capS / 60),
    usedMin: Math.floor(used / 60),
    leftMin: left === null ? null : Math.floor(left / 60),
    near: left !== null && left > 0 && left <= NEAR_SECONDS,
    over: left !== null && left <= 0,
    resetsAt: nextMonthStart(),
    upgradeTo,
  };
}

const hrs = (n: number) => `${n} Studio hour${n === 1 ? "" : "s"}`;
const resetDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** The line for a Record or Go live that the month's hours don't cover. */
export function overMessage(h: StudioHours): string {
  const cap = Math.round((h.capMin ?? 0) / 60);
  const more = h.upgradeTo ? ` Upgrade to ${h.upgradeTo.name} for ${hrs(h.upgradeTo.hours)} a month, or they` : " They";
  return `You've used this month's ${hrs(cap)} on ${h.plan}.${more} come back on ${resetDay(h.resetsAt)}.`;
}

/** May this account start recording or going live in its Studio? Starting the second while the first runs is fine. */
export async function studioMayStart(email: string, alreadyOn: boolean): Promise<{ ok: true } | { ok: false; message: string; hours: StudioHours }> {
  if (alreadyOn) return { ok: true };
  const h = await studioHours(email);
  return h.over ? { ok: false, message: overMessage(h), hours: h } : { ok: true };
}

/** Keep the studio's open session in step with its recording and live flags. Never throws. */
export async function syncStudioMeter(s: Pick<PersonalStudioRow, "id" | "ownerEmail" | "recordingEgressId" | "liveEgressId">): Promise<void> {
  try {
    await schemaIsReady();
    const on = !!s.recordingEgressId || !!s.liveEgressId;
    const [open] = await db.select().from(studioSessions).where(and(eq(studioSessions.studioId, s.id), eq(studioSessions.endedAt, ""))).limit(1);
    if (on && !open) await db.insert(studioSessions).values({ studioId: s.id, ownerEmail: norm(s.ownerEmail), startedAt: now() });
    else if (!on && open) await closeSession(open.id, open.startedAt);
  } catch (err) {
    console.error("Studio hours meter:", (err as Error).message);
  }
}

async function closeSession(id: number, startedAt: string): Promise<void> {
  const end = now();
  await db.update(studioSessions).set({ endedAt: end, seconds: Math.max(0, Math.round((Date.parse(end) - Date.parse(startedAt)) / 1000)) }).where(and(eq(studioSessions.id, id), eq(studioSessions.endedAt, "")));
}

/** The minute pass: close sessions whose studio isn't recording or live any more (however it stopped). */
export async function closeStrayStudioSessions(studios: Map<number, boolean>): Promise<number> {
  const open = await db.select().from(studioSessions).where(eq(studioSessions.endedAt, ""));
  let closed = 0;
  for (const o of open) if (!studios.get(o.studioId)) { await closeSession(o.id, o.startedAt); closed++; }
  return closed;
}
