import type { EventRow, SignupRow, CampaignKind } from "../shared/schema.js";
import { CAMPAIGN_KINDS } from "../shared/schema.js";
import type { CardInput } from "./shareCard.js";

// The posting plan: six posts we design for a podcaster, which they tick and
// we publish from their own accounts. Anchored to the event, not to today —
// a podcaster who books late sees the early ones as "goes out within the
// hour", and a future tenant with more runway gets the full run-up.

export interface KindDef {
  kind: CampaignKind;
  label: string;
  /** Weeks before the event's start; null = the morning of their own slot. */
  weeksBefore: number | null;
  blurb: string;
}

export const KINDS: KindDef[] = [
  { kind: "join", label: "Join me", weeksBefore: 5, blurb: "Announces your slot and asks people to set a reminder." },
  { kind: "share", label: "Share this", weeksBefore: 4, blurb: "Asks your audience to pass it on." },
  { kind: "about", label: "What is the day?", weeksBefore: 3, blurb: "Explains the day itself, with a link to the About page." },
  { kind: "twoweeks", label: "Two weeks to go", weeksBefore: 2, blurb: "Countdown post." },
  { kind: "thisweek", label: "This week", weeksBefore: 1, blurb: "Final reminder before the week starts." },
  { kind: "today", label: "I'm on today", weeksBefore: null, blurb: "Goes out three hours before your slot." },
];

const POST_HOUR_UTC = 14; // 10:00 Eastern in October

export function scheduleFor(def: KindDef, event: EventRow, onAirStart: Date): Date {
  if (def.weeksBefore === null) return new Date(onAirStart.getTime() - 3 * 60 * 60 * 1000);
  const d = new Date(new Date(event.startAtUtc).getTime() - def.weeksBefore * 7 * 86400000);
  d.setUTCHours(POST_HOUR_UTC, 0, 0, 0);
  return d;
}

const DAY = 86400000;

/**
 * The dates we actually post on. Anything already overdue is not fired all at
 * once — a podcaster who books late would otherwise hit their followers with
 * three posts in one hour. Overdue posts go now, then every two days, always
 * finishing before the next dated one.
 */
export function effectiveSchedule(event: EventRow, onAirStart: Date, now = new Date()): Map<CampaignKind, Date> {
  const planned = KINDS.map((d) => ({ def: d, at: scheduleFor(d, event, onAirStart) }));
  const overdue = planned.filter((p) => p.at.getTime() <= now.getTime());
  const future = planned.filter((p) => p.at.getTime() > now.getTime());
  const ceiling = future.length ? Math.min(...future.map((p) => p.at.getTime())) - 12 * 3600000 : Infinity;
  const out = new Map<CampaignKind, Date>();
  for (const p of future) out.set(p.def.kind, p.at);
  // Two days apart when there's room; otherwise spread evenly across the room
  // there is, so a very late booking still never posts twice in one hour.
  const room = Number.isFinite(ceiling) ? Math.max(0, ceiling - now.getTime()) : Infinity;
  const step = Math.min(2 * DAY, room / Math.max(1, overdue.length - 1));
  overdue.forEach((p, i) => {
    out.set(p.def.kind, new Date(now.getTime() + i * step));
  });
  return out;
}

export interface CampaignContext {
  event: EventRow;
  signup: SignupRow;
  whenLabel: string; // "Mon, Oct 5, 9:30 AM EDT"
  timeLabel: string; // "9:30 AM EDT"
  eventDateLabel: string; // "Oct 5"
  shareUrl: string;
  aboutUrl: string;
}

function occasion(c: CampaignContext): string {
  return c.event.occasion || "National Military Podcast Day";
}

/** What's drawn on the card. */
export function cardInput(kind: CampaignKind, c: CampaignContext): CardInput {
  const base = {
    podcastName: c.signup.podcastName,
    hostName: c.signup.hostName,
    whenLabel: c.whenLabel,
    photoUrl: c.signup.photoUrl || undefined,
    footer: `${c.event.name} · militaryvoice.ai`,
  };
  switch (kind) {
    case "join":
      return { ...base, eyebrow: `Join me on ${occasion(c)}` };
    case "share":
      return { ...base, eyebrow: "Share this with a friend", subline: `Live on ${occasion(c)}` };
    case "about":
      return {
        ...base,
        eyebrow: occasion(c),
        podcastName: `What is ${occasion(c)}?`,
        subline: `${c.event.name} — 26.2 miles of stories`,
        whenLabel: `${c.eventDateLabel} · militaryvoice.ai`,
      };
    case "twoweeks":
      return { ...base, eyebrow: "Two weeks to go", subline: `with ${c.signup.hostName} · ${occasion(c)}` };
    case "thisweek":
      return { ...base, eyebrow: "This week", subline: `with ${c.signup.hostName} · ${occasion(c)}` };
    case "today":
      return { ...base, eyebrow: "I'm on today", subline: occasion(c), whenLabel: `Today · ${c.timeLabel}` };
  }
}

/** The text that goes with it. */
export function caption(kind: CampaignKind, c: CampaignContext): string {
  const show = c.signup.podcastName;
  const day = occasion(c);
  switch (kind) {
    case "join":
      return `I'm on ${day}! ${show} goes live ${c.whenLabel} as part of the ${c.event.name} on MilitaryVoice.ai. Set a reminder: ${c.shareUrl}`;
    case "share":
      return `Know someone who'd want to hear this? Pass it on. ${show} — live ${c.whenLabel} for ${day}. ${c.shareUrl}`;
    case "about":
      return `What is ${day}? One day, 26.2 miles of stories, one stage for the military and veteran podcast community. Here's the story and how to take part: ${c.aboutUrl}`;
    case "twoweeks":
      return `Two weeks from now ${show} is live on ${day} — ${c.whenLabel}. Set a reminder so you don't miss it: ${c.shareUrl}`;
    case "thisweek":
      return `This week: ${show} goes live ${c.whenLabel} for ${day}. ${c.shareUrl}`;
    case "today":
      return `Today's the day. ${show} is live at ${c.timeLabel} for ${day}. Watch: ${c.shareUrl}`;
  }
}

export function isKind(v: unknown): v is CampaignKind {
  return typeof v === "string" && (CAMPAIGN_KINDS as readonly string[]).includes(v);
}
