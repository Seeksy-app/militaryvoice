// Military Voices LIVE (Packet A, 26 Nov 2026): who may do what on a production. The plan's section 4 matrix, in code.
// Access comes only from production_members (never admin_users); a platform admin (admin session) is mv_admin on
// every production. Clients and crew sign in with the ordinary emailed-code session.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, schemaIsReady, storage } from "../storage.js";
import { getAdminEmail, getSessionEmail } from "../session.js";
import { auditLog, productionMembers, productions } from "../../shared/schema.js";
import { CLIENT_ROLES, CREW_ROLES, LIVE_TEST_CLIENT, LIVE_TEST_CREW, MV_ROLES, type LiveRole, type ProductionCan } from "../../shared/live.js";

export const now = () => new Date().toISOString();
export const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();

/** The live:on gate: off means platform admins (and the two test logins) only. */
export async function liveOpen(): Promise<boolean> {
  return (await storage.getSetting("live:on").catch(() => null)) === "on";
}
const TEST_LOGINS = new Set([LIVE_TEST_CLIENT, LIVE_TEST_CREW]);

/** A platform admin: a signed admin session whose address is an admin. Event admins, studio hosts and keys are not. */
export async function platformAdmin(req: Request): Promise<string | null> {
  const a = norm(getAdminEmail(req));
  return a && (await storage.isAdminEmail(a).catch(() => false)) ? a : null;
}

export type LiveWho = { email: string; admin: boolean };
/** Who is asking: their sign-in address (or the admin's), and whether they're a platform admin. */
export async function whoIs(req: Request): Promise<LiveWho | null> {
  const admin = await platformAdmin(req);
  const email = norm(getSessionEmail(req)) || admin || "";
  return email ? { email, admin: !!admin } : null;
}

/** Their role on one production, or null. Active rows only; mv_admin for platform admins. */
export async function roleOn(who: LiveWho, productionId: number): Promise<LiveRole | null> {
  if (!Number.isFinite(productionId) || productionId <= 0) return null;
  await schemaIsReady();
  const [p] = await db.select({ id: productions.id }).from(productions).where(eq(productions.id, productionId)).limit(1);
  if (!p) return null;
  if (who.admin) return "mv_admin";
  const [m] = await db.select().from(productionMembers)
    .where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.email, who.email), eq(productionMembers.status, "active"))).limit(1);
  return (m?.role as LiveRole) ?? null;
}

/** The member row behind a role (org scoping for crew_lead and client_admin). */
export async function memberRow(productionId: number, email: string) {
  const [m] = await db.select().from(productionMembers).where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.email, norm(email)))).limit(1);
  return m ?? null;
}

const isMv = (r: LiveRole) => MV_ROLES.includes(r);
export const isClient = (r: LiveRole) => CLIENT_ROLES.includes(r);
export const isCrew = (r: LiveRole) => CREW_ROLES.includes(r);

/** What a role may do on a production (section 4). The screens read it; every route checks it again. */
export function canFor(role: LiveRole): ProductionCan {
  return {
    edit: role === "mv_admin" || role === "mv_producer" || role === "mv_coordinator",
    invite: role === "mv_admin" || role === "mv_coordinator" || role === "client_admin" || role === "crew_lead",
    stages: role === "mv_admin" || role === "mv_producer" || role === "mv_coordinator",
    audit: role === "mv_admin" || role === "mv_producer" || role === "mv_coordinator",
    approve: role === "client_admin" || role === "client_reviewer",
  };
}
/** Roles that see approvals: MV and client (crew never do). */
export const seesApprovals = (r: LiveRole) => isMv(r) || isClient(r);
/** Roles that see the shared venue list. */
export const seesVenues = (r: LiveRole) => isMv(r);

/** The gate, then a signed-in person. Sets req.live = { email, admin }. */
export const requireLive: RequestHandler = (req, res, next) => {
  void (async () => {
    const who = await whoIs(req);
    if (!who) return void res.status(401).json({ message: "Please sign in again." });
    if (!who.admin && !TEST_LOGINS.has(who.email) && !(await liveOpen())) return void res.status(403).json({ message: "Military Voices LIVE isn't open yet." });
    (req as LiveReq).live = who;
    next();
  })().catch(next);
};

export type LiveReq = Request & { live: LiveWho; liveRole?: LiveRole; productionId?: number };

/**
 * requireProductionRole(...roles): the production in :id (or :productionId) and a role on it from the list.
 * A platform admin passes everywhere (approving is checked by the decide route itself). Anyone else needs an active
 * production_members row. No role list = any member. 404 when it's not theirs, so a production's existence never leaks.
 */
export function requireProductionRole(...roles: LiveRole[]): RequestHandler[] {
  return [requireLive, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const r = req as LiveReq;
      const id = Number(req.params.id ?? req.params.productionId);
      const role = await roleOn(r.live, id);
      if (!role) return void res.status(404).json({ message: "We couldn't find that production." });
      if (roles.length && role !== "mv_admin" && !roles.includes(role)) return void res.status(403).json({ message: "Your role on this production can't do that." });
      r.liveRole = role;
      r.productionId = id;
      next();
    })().catch(next);
  }];
}

/** Every write adds one row. before/after are stored as JSON. */
export async function audit(productionId: number, who: string, what: string, subjectType: string, subjectId: number, before: unknown, after: unknown): Promise<void> {
  const j = (v: unknown) => (v === undefined || v === null ? "" : JSON.stringify(v).slice(0, 20_000));
  await db.insert(auditLog).values({ productionId, who: norm(who), what, subjectType, subjectId, before: j(before), after: j(after), at: now() });
}
