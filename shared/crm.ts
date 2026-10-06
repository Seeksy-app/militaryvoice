// Who's in each CRM audience, in one place the server (sending) and the page
// (showing) both read, so a count on screen is always who a campaign reaches.
import { PLANS } from "./tokens.js";

/** The fields of a person the audiences look at (server/people.ts builds the rest). */
export type PersonFacts = {
  roles: string[];
  plan: string;
  path: string;
  tags: string[];
  events: { id: number }[];
  smartlink: string;
  joinedAt: string;
  lastActivityAt: string;
};

export const BUILT_IN_AUDIENCES: { key: string; label: string; scope: "platform" | "event" | "both"; test: (p: PersonFacts) => boolean }[] = [
  { key: "everyone", label: "Everyone", scope: "both", test: () => true },
  { key: "members", label: "Members", scope: "both", test: (p) => p.roles.includes("Member") },
  { key: "podcasters", label: "Podcasters", scope: "both", test: (p) => p.roles.includes("Podcaster") || p.roles.includes("Co-host") },
  { key: "pro", label: "On Pro", scope: "platform", test: (p) => p.plan === PLANS.pro.name },
  { key: "scale", label: "On Scale", scope: "platform", test: (p) => p.plan === PLANS.creator.name },
  { key: "growth", label: "On Growth", scope: "platform", test: (p) => p.plan === "Growth" },
  { key: "discovery", label: "Discovery", scope: "platform", test: (p) => p.roles.includes("Discovery") },
  { key: "sponsors", label: "Sponsors", scope: "both", test: (p) => p.roles.includes("Sponsor") },
  { key: "team", label: "Event team", scope: "both", test: (p) => p.roles.includes("Team") },
  { key: "listeners", label: "Listeners", scope: "both", test: (p) => p.roles.includes("Listener") },
  { key: "imported", label: "Imported", scope: "platform", test: (p) => p.roles.includes("Imported") },
  { key: "no-smartlink", label: "No SmartLink yet", scope: "platform", test: (p) => p.roles.includes("Member") && !p.smartlink },
];

/**
 * A filter on top of an audience. Inside one kind (roles, plans…) any match
 * counts; across kinds, all must. Empty means "don't care".
 */
export type AudienceFilter = {
  /** The audience it narrows ("everyone" if unset). */
  base?: string;
  roles?: string[];
  plans?: string[];
  /** podcaster | creator | planner — the path they picked at sign-up. */
  paths?: string[];
  tags?: string[];
  eventIds?: number[];
  /** Joined in the last N days. */
  joinedDays?: number;
  /** Nothing from or to them for N days. */
  quietDays?: number;
  smartlink?: "yes" | "no";
};
export type SavedAudience = { id: string; name: string; filter: AudienceFilter; createdAt: string };

const DAY = 86400000;
const within = (iso: string, days: number) => !!iso && Date.now() - Date.parse(iso) <= days * DAY;

export function matchesFilter(p: PersonFacts, f: AudienceFilter): boolean {
  const base = BUILT_IN_AUDIENCES.find((a) => a.key === (f.base || "everyone"));
  if (base && !base.test(p)) return false;
  if (f.roles?.length && !f.roles.some((r) => p.roles.includes(r))) return false;
  if (f.plans?.length && !f.plans.includes(p.plan)) return false;
  if (f.paths?.length && !f.paths.includes(p.path)) return false;
  if (f.tags?.length && !f.tags.some((t) => p.tags.includes(t))) return false;
  if (f.eventIds?.length && !p.events.some((e) => f.eventIds!.includes(e.id))) return false;
  if (f.joinedDays && !within(p.joinedAt, f.joinedDays)) return false;
  if (f.quietDays && within(p.lastActivityAt, f.quietDays)) return false;
  if (f.smartlink === "yes" && !p.smartlink) return false;
  if (f.smartlink === "no" && !!p.smartlink) return false;
  return true;
}

/** True when the filter narrows anything beyond its base. */
export const filterIsActive = (f: AudienceFilter) =>
  !!(f.roles?.length || f.plans?.length || f.paths?.length || f.tags?.length || f.eventIds?.length || f.joinedDays || f.quietDays || f.smartlink);

export const PATH_LABEL: Record<string, string> = { podcaster: "Podcaster", creator: "Content creator", planner: "Event planner" };
