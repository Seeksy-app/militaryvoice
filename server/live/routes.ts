// Military Voices LIVE, phase 1 routes (Packet A, 26 Nov 2026). The contract is shared/live.ts (frozen: add fields only).
// Every write adds an audit_log row. Invites are stored only: no email goes out in phase 1.
import type { Express, Request, RequestHandler, Response } from "express";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, schemaIsReady } from "../storage.js";
import { approvals, auditLog, organizations, productionMembers, productions, stages, venues, type ApprovalRow, type OrganizationRow, type ProductionMemberRow, type ProductionRow, type StageRow, type VenueRow } from "../../shared/schema.js";
import {
  CLIENT_CONTENT_SUBJECTS, CLIENT_ROLES, MEMBER_ROLES, PRODUCTION_STATUSES, LIVE_TEST_CLIENT, LIVE_TEST_CREW,
  type Approval, type AuditEntry, type LiveOrg, type LiveRole, type Member, type Production, type Stage, type Venue,
} from "../../shared/live.js";
import { audit, canFor, isClient, liveOpen, memberRow, norm, now, requireLive, requireProductionRole, roleOn, seesApprovals, whoIs, type LiveReq, type LiveWho } from "./access.js";

type MemberRole = Exclude<LiveRole, "mv_admin">;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const day = (v: unknown) => { const s = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) || s === "" ? s : null; };
const tz = (v: unknown) => { const s = str(v, 64); if (!s) return ""; try { new Intl.DateTimeFormat("en-US", { timeZone: s }); return s; } catch { return null; } };
const asRole = (v: unknown): MemberRole | null => (MEMBER_ROLES as string[]).includes(String(v)) ? (v as MemberRole) : null;
const parse = (s: string): unknown => { if (!s) return null; try { return JSON.parse(s); } catch { return s; } };
class Bad extends Error { constructor(public code: number, msg: string) { super(msg); } }

/* ── Views ── */
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
/** Portal slugs: the name made URL-safe, unique among LIVE (client/vendor) orgs; a later clash gets -<id>. */
async function slugsFor(orgs: OrganizationRow[]): Promise<Map<number, string>> {
  if (!orgs.length) return new Map();
  const all = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.kind, ["client", "vendor"])).orderBy(organizations.id);
  const first = new Map<string, number>();
  for (const o of all) { const s = slugify(o.name); if (!first.has(s)) first.set(s, o.id); }
  return new Map(orgs.map((o) => { const s = slugify(o.name); return [o.id, first.get(s) === o.id || !first.has(s) ? s : `${s}-${o.id}`]; }));
}
const orgView = (o: OrganizationRow | undefined, slugs: Map<number, string>): LiveOrg | null => (o ? { id: o.id, name: o.name, kind: o.kind, logoUrl: o.logoUrl, slug: slugs.get(o.id) ?? slugify(o.name) } : null);
type Orgs = { get: (id: number) => LiveOrg | null };
async function orgsById(ids: number[]): Promise<Orgs> {
  const want = Array.from(new Set(ids.filter((x) => x > 0)));
  const rows = want.length ? await db.select().from(organizations).where(inArray(organizations.id, want)) : [];
  const slugs = await slugsFor(rows);
  const m = new Map(rows.map((o) => [o.id, orgView(o, slugs)]));
  return { get: (id) => m.get(id) ?? null };
}
function productionView(p: ProductionRow, role: LiveRole, org: LiveOrg | null, counts: { stages: number; members: number }): Production {
  return {
    id: p.id, name: p.name, status: p.status as Production["status"], org, startsOn: p.startsOn, endsOn: p.endsOn, timezone: p.timezone,
    scope: p.scope, eventId: p.eventId || null, createdAt: p.createdAt, updatedAt: p.updatedAt, myRole: role, stageCount: counts.stages, memberCount: counts.members, can: canFor(role),
  };
}
/** Stage and member (active + invited) counts per production. */
async function countsFor(ids: number[]): Promise<(id: number) => { stages: number; members: number }> {
  if (!ids.length) return () => ({ stages: 0, members: 0 });
  const st = await db.select({ p: stages.productionId }).from(stages).where(inArray(stages.productionId, ids));
  const mb = await db.select({ p: productionMembers.productionId, s: productionMembers.status }).from(productionMembers).where(inArray(productionMembers.productionId, ids));
  return (id) => ({ stages: st.filter((x) => x.p === id).length, members: mb.filter((x) => x.p === id && x.s !== "removed").length });
}
const memberView = (m: ProductionMemberRow, org: LiveOrg | null): Member => ({
  id: m.id, productionId: m.productionId, email: m.email, name: m.name, org, role: m.role as MemberRole,
  status: m.status as Member["status"], invitedBy: m.invitedBy, createdAt: m.createdAt, inviteSent: false,
});
const venueView = (v: VenueRow): Venue => ({ id: v.id, name: v.name, address: v.address, timezone: v.timezone, power: v.power, network: v.network, createdAt: v.createdAt });
const stageView = (s: StageRow, v: VenueRow | undefined): Stage => ({ id: s.id, productionId: s.productionId, name: s.name, venue: v ? { id: v.id, name: v.name } : null, studioId: s.studioId || null, ingestProfile: s.ingestProfile, createdAt: s.createdAt });
function approvalView(a: ApprovalRow, who: LiveWho, role: LiveRole): Approval {
  return {
    id: a.id, productionId: a.productionId, subjectType: a.subjectType, subjectId: a.subjectId, version: a.version, summary: a.summary,
    requestedBy: a.requestedBy, approverRole: a.approverRole as LiveRole, state: a.state as Approval["state"], decidedBy: a.decidedBy,
    decidedAt: a.decidedAt, note: a.note, createdAt: a.createdAt, mine: a.state === "pending" && mayDecide(role, a) && norm(a.requestedBy) !== who.email,
  };
}
/** Client content (run of show, speakers, scripts, assets): only the client decides, the role it's addressed to or a Client
 *  Admin for a reviewer's item; never MV or crew. Anything else (the technical go): the role it's addressed to, or a platform admin. */
const clientContent = (a: ApprovalRow) => (CLIENT_CONTENT_SUBJECTS as readonly string[]).includes(a.subjectType);
const mayDecide = (role: LiveRole, a: ApprovalRow) => clientContent(a)
  ? (role === a.approverRole && isClient(role)) || (role === "client_admin" && a.approverRole === "client_reviewer")
  : role === a.approverRole || role === "mv_admin";

/* ── The functions (each route is a thin wrapper, so the access rules can be proved without HTTP) ── */

/** Invited rows become active the first time that address signs in and opens LIVE (the emailed code proves it). */
export async function activateInvites(who: LiveWho): Promise<void> {
  const waiting = await db.select().from(productionMembers).where(and(eq(productionMembers.email, who.email), eq(productionMembers.status, "invited")));
  for (const m of waiting) {
    await db.update(productionMembers).set({ status: "active", joinedAt: now() }).where(eq(productionMembers.id, m.id));
    await audit(m.productionId, who.email, "member.joined", "member", m.id, { status: "invited" }, { status: "active" });
  }
}

/** The productions someone can see, newest first, with their role on each. */
export async function visibleProductions(who: LiveWho): Promise<Production[]> {
  await schemaIsReady();
  await activateInvites(who);
  let rows: { p: ProductionRow; role: LiveRole }[];
  if (who.admin) {
    rows = (await db.select().from(productions).orderBy(desc(productions.id))).map((p) => ({ p, role: "mv_admin" as LiveRole }));
  } else {
    const mine = await db.select().from(productionMembers).where(and(eq(productionMembers.email, who.email), eq(productionMembers.status, "active")));
    if (!mine.length) return [];
    const byId = new Map(mine.map((m) => [m.productionId, m.role as LiveRole]));
    rows = (await db.select().from(productions).where(inArray(productions.id, Array.from(byId.keys()))).orderBy(desc(productions.id))).map((p) => ({ p, role: byId.get(p.id)! }));
  }
  const orgs = await orgsById(rows.map((r) => r.p.orgId));
  const counts = await countsFor(rows.map((r) => r.p.id));
  return rows.map((r) => productionView(r.p, r.role, orgs.get(r.p.orgId), counts(r.p.id)));
}

async function getProduction(id: number, role: LiveRole): Promise<Production> {
  const [p] = await db.select().from(productions).where(eq(productions.id, id)).limit(1);
  if (!p) throw new Bad(404, "We couldn't find that production.");
  return productionView(p, role, (await orgsById([p.orgId])).get(p.orgId), (await countsFor([p.id]))(p.id));
}

/** A client or vendor org for LIVE (approved at once; it never appears in sign-up or Discovery choices). */
async function makeOrg(name: string, kind: "client" | "vendor", by: string, logoUrl = ""): Promise<OrganizationRow> {
  const n = str(name, 120);
  if (n.length < 2) throw new Bad(400, "Give the organisation a name.");
  const [o] = await db.insert(organizations).values({ name: n, kind, logoUrl: str(logoUrl, 500), status: "approved", createdBy: by, createdAt: now(), approvedAt: now() }).returning();
  return o;
}
async function orgOk(id: unknown, kind?: "client" | "vendor"): Promise<number> {
  const n = Number(id) || 0;
  if (!n) return 0;
  const [o] = await db.select().from(organizations).where(eq(organizations.id, n)).limit(1);
  if (!o || (kind && o.kind !== kind)) throw new Bad(400, kind === "client" ? "That isn't a client organisation." : "We couldn't find that organisation.");
  return o.id;
}

function productionFields(b: Record<string, unknown>, creating: boolean): Partial<ProductionRow> {
  const out: Partial<ProductionRow> = {};
  if (creating || b.name !== undefined) { const n = str(b.name, 120); if (n.length < 2) throw new Bad(400, "Give the production a name."); out.name = n; }
  if (b.status !== undefined) { if (!(PRODUCTION_STATUSES as readonly string[]).includes(String(b.status))) throw new Bad(400, "That isn't a production status."); out.status = String(b.status); }
  for (const k of ["startsOn", "endsOn"] as const) if (b[k] !== undefined) { const d = day(b[k]); if (d === null) throw new Bad(400, "Dates are YYYY-MM-DD."); out[k] = d; }
  if (b.timezone !== undefined) { const t = tz(b.timezone); if (t === null) throw new Bad(400, "That isn't a time zone we know."); out.timezone = t || "America/New_York"; }
  if (b.scope !== undefined) out.scope = str(b.scope, 4000);
  if (b.eventId !== undefined) out.eventId = Number(b.eventId) > 0 ? Number(b.eventId) : 0;
  if ((out.startsOn && out.endsOn) && out.endsOn < out.startsOn) throw new Bad(400, "The end date is before the start date.");
  return out;
}

export async function createProduction(who: LiveWho, b: Record<string, unknown>): Promise<Production> {
  if (!who.admin) throw new Bad(403, "Only MV admins can start a production for now.");
  const f = productionFields(b, true);
  const nb = b.newOrg as { name?: string; logoUrl?: string } | undefined;
  const orgId = nb?.name ? (await makeOrg(nb.name, "client", who.email, nb.logoUrl)).id : await orgOk(b.orgId, "client");
  const [p] = await db.insert(productions).values({ ...f, name: f.name!, orgId, createdBy: who.email, createdAt: now(), updatedAt: now() }).returning();
  await audit(p.id, who.email, "production.created", "production", p.id, null, p);
  return getProduction(p.id, "mv_admin");
}

export async function updateProduction(who: LiveWho, id: number, role: LiveRole, b: Record<string, unknown>): Promise<Production> {
  const [before] = await db.select().from(productions).where(eq(productions.id, id)).limit(1);
  if (!before) throw new Bad(404, "We couldn't find that production.");
  const f = productionFields(b, false);
  if (b.orgId !== undefined || b.newOrg !== undefined) {
    const nb = b.newOrg as { name?: string; logoUrl?: string } | undefined;
    f.orgId = nb?.name ? (await makeOrg(nb.name, "client", who.email, nb.logoUrl)).id : await orgOk(b.orgId, "client");
  }
  const s = f.startsOn ?? before.startsOn, e = f.endsOn ?? before.endsOn;
  if (s && e && e < s) throw new Bad(400, "The end date is before the start date.");
  if (!Object.keys(f).length) return getProduction(id, role);
  const [after] = await db.update(productions).set({ ...f, updatedAt: now() }).where(eq(productions.id, id)).returning();
  await audit(id, who.email, "production.updated", "production", id, before, after);
  return getProduction(id, role);
}

/** Who a member list shows: MV everyone; Crew Lead and Client Admin their own org; everyone else themselves. */
export async function listMembers(who: LiveWho, id: number, role: LiveRole): Promise<Member[]> {
  let rows = await db.select().from(productionMembers).where(eq(productionMembers.productionId, id)).orderBy(productionMembers.id);
  if (role === "crew_lead" || role === "client_admin") {
    const me = await memberRow(id, who.email);
    rows = rows.filter((m) => m.status !== "removed" && ((me?.orgId ?? 0) > 0 && m.orgId === me!.orgId || m.email === who.email));
  } else if (!["mv_admin", "mv_producer", "mv_coordinator", "mv_editor"].includes(role)) {
    rows = rows.filter((m) => m.email === who.email);
  }
  const orgs = await orgsById(rows.map((m) => m.orgId));
  return rows.map((m) => memberView(m, orgs.get(m.orgId)));
}

/** Who may give which role: MV Admin and Coordinator any; Client Admin client roles in their org; Crew Lead operators in theirs. */
async function inviteScope(who: LiveWho, id: number, role: LiveRole): Promise<{ roles: MemberRole[]; orgId: number | null }> {
  if (role === "mv_admin" || role === "mv_coordinator") return { roles: [...MEMBER_ROLES], orgId: null };
  const me = await memberRow(id, who.email);
  if (role === "client_admin" && me?.orgId) return { roles: CLIENT_ROLES as MemberRole[], orgId: me.orgId };
  if (role === "crew_lead" && me?.orgId) return { roles: ["crew_operator"], orgId: me.orgId };
  throw new Bad(403, "Your role on this production can't add people.");
}

export async function inviteMember(who: LiveWho, id: number, role: LiveRole, b: Record<string, unknown>): Promise<Member> {
  const scope = await inviteScope(who, id, role);
  const email = norm(b.email);
  if (!validEmail(email)) throw new Bad(400, "Enter a valid email.");
  const newRole = asRole(b.role);
  if (!newRole || !scope.roles.includes(newRole)) throw new Bad(403, "You can't give that role.");
  let orgId = scope.orgId ?? 0;
  if (scope.orgId === null) {
    const nb = b.newOrg as { name?: string; kind?: string } | undefined;
    orgId = nb?.name ? (await makeOrg(nb.name, nb.kind === "vendor" ? "vendor" : "client", who.email)).id : await orgOk(b.orgId);
  }
  const had = await memberRow(id, email);
  if (had && had.status !== "removed") throw new Bad(409, "They're already on this production.");
  const values = { productionId: id, email, name: str(b.name, 80), orgId, role: newRole, status: "invited", invitedBy: who.email, createdAt: now(), joinedAt: "" };
  const [m] = had
    ? await db.update(productionMembers).set({ ...values, createdAt: had.createdAt }).where(eq(productionMembers.id, had.id)).returning()
    : await db.insert(productionMembers).values(values).returning();
  await audit(id, who.email, had ? "member.reinvited" : "member.invited", "member", m.id, had ?? null, m);
  return memberView(m, (await orgsById([m.orgId])).get(m.orgId));
}

export async function patchMember(who: LiveWho, id: number, role: LiveRole, memberId: number, b: Record<string, unknown>): Promise<Member> {
  const [m] = await db.select().from(productionMembers).where(and(eq(productionMembers.id, memberId), eq(productionMembers.productionId, id))).limit(1);
  if (!m) throw new Bad(404, "We couldn't find that person on this production.");
  if (m.email === who.email) throw new Bad(403, "Ask someone else to change your own role.");
  const scope = await inviteScope(who, id, role);
  if (!scope.roles.includes(m.role as MemberRole) || (scope.orgId !== null && m.orgId !== scope.orgId)) throw new Bad(403, "You can't change that person.");
  const set: Partial<ProductionMemberRow> = {};
  if (b.role !== undefined) { const r = asRole(b.role); if (!r || !scope.roles.includes(r)) throw new Bad(403, "You can't give that role."); set.role = r; }
  if (b.status !== undefined) { if (b.status !== "active" && b.status !== "removed") throw new Bad(400, "Status is active or removed."); set.status = b.status === "active" && m.status === "removed" ? "invited" : String(b.status); }
  if (b.name !== undefined) set.name = str(b.name, 80);
  if (!Object.keys(set).length) return memberView(m, (await orgsById([m.orgId])).get(m.orgId));
  const [after] = await db.update(productionMembers).set(set).where(eq(productionMembers.id, m.id)).returning();
  await audit(id, who.email, "member.updated", "member", m.id, m, after);
  return memberView(after, (await orgsById([after.orgId])).get(after.orgId));
}

/** MV roles anywhere (or admins) see and add the shared venues. */
async function mvAnywhere(who: LiveWho): Promise<boolean> {
  if (who.admin) return true;
  const rows = await db.select({ role: productionMembers.role }).from(productionMembers).where(and(eq(productionMembers.email, who.email), eq(productionMembers.status, "active")));
  return rows.some((r) => ["mv_producer", "mv_coordinator", "mv_editor"].includes(r.role));
}

/** For later phases (and the fixtures): ask for an approval. The AI and MV never decide; the client does. */
export async function requestApproval(productionId: number, a: { subjectType: string; subjectId: number; version?: number; summary: string; requestedBy: string; approverRole: LiveRole }): Promise<ApprovalRow> {
  if ((CLIENT_CONTENT_SUBJECTS as readonly string[]).includes(a.subjectType) && !isClient(a.approverRole)) throw new Bad(400, "The client approves content.");
  const [row] = await db.insert(approvals).values({ productionId, subjectType: str(a.subjectType, 40), subjectId: a.subjectId, version: a.version ?? 1, summary: str(a.summary, 200), requestedBy: norm(a.requestedBy), approverRole: a.approverRole, state: "pending", createdAt: now() }).returning();
  await audit(productionId, a.requestedBy, "approval.requested", a.subjectType, a.subjectId, null, row);
  return row;
}

export async function decideApproval(who: LiveWho, approvalId: number, b: Record<string, unknown>): Promise<Approval> {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  const role = a ? await roleOn(who, a.productionId) : null;
  if (!a || !role || !seesApprovals(role)) throw new Bad(404, "We couldn't find that approval.");
  if (!mayDecide(role, a)) throw new Bad(403, clientContent(a) ? "Only the client can approve this." : "This isn't yours to sign off.");
  if (norm(a.requestedBy) === who.email) throw new Bad(403, "Someone else has to approve your own change.");
  if (a.state !== "pending") throw new Bad(409, "That's already been decided.");
  const decision = b.decision === "approved" || b.decision === "changes_requested" ? b.decision : null;
  if (!decision) throw new Bad(400, "Approve it or ask for changes.");
  const [after] = await db.update(approvals).set({ state: decision, decidedBy: who.email, decidedAt: now(), note: str(b.note, 2000) }).where(and(eq(approvals.id, a.id), eq(approvals.state, "pending"))).returning();
  if (!after) throw new Bad(409, "That's already been decided.");
  await audit(a.productionId, who.email, `approval.${decision}`, a.subjectType, a.subjectId, a, after);
  return approvalView(after, who, role);
}

/* ── The routes ── */
const send = (res: Response, p: Promise<unknown>, code = 200) => p.then((v) => res.status(code).json(v)).catch((e: unknown) => {
  if (e instanceof Bad) return void res.status(e.code).json({ message: e.message });
  console.error("LIVE route failed:", (e as Error).message);
  res.status(500).json({ message: "Something went wrong. Try again." });
});
const L = (req: Request) => req as LiveReq;
const body = (req: Request) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

export function registerLive(app: Express): void {
  const MANAGE: LiveRole[] = ["mv_producer", "mv_coordinator"];
  const noStore: RequestHandler = (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); };
  app.use("/api/production", noStore);

  /** Who I am in LIVE (no gate, so the screen can say "not open yet"). */
  app.get("/api/production/me", (req, res) => send(res, (async () => {
    const who = await whoIs(req);
    if (!who) throw new Bad(401, "Please sign in again.");
    const open = who.admin || who.email === LIVE_TEST_CLIENT || who.email === LIVE_TEST_CREW || (await liveOpen());
    return { email: who.email, admin: who.admin, open, productions: open ? (await visibleProductions(who)).length : 0 };
  })()));

  /** Platform admins: make (or find) the phase 1 test production and its two test logins. Idempotent; no email. */
  app.post("/api/production/admin/fixtures", requireLive, (req, res) => send(res, (async () => {
    if (!L(req).live.admin) throw new Bad(403, "MV admins only.");
    return (await import("./fixtures.js")).seedLiveFixtures(L(req).live.email);
  })()));

  app.get("/api/production/productions", requireLive, (req, res) => send(res, visibleProductions(L(req).live)));
  app.post("/api/production/productions", requireLive, (req, res) => send(res, createProduction(L(req).live, body(req)), 201));
  app.get("/api/production/productions/:id", ...requireProductionRole(), (req, res) => send(res, getProduction(L(req).productionId!, L(req).liveRole!)));
  app.patch("/api/production/productions/:id", ...requireProductionRole(...MANAGE), (req, res) => send(res, updateProduction(L(req).live, L(req).productionId!, L(req).liveRole!, body(req))));

  app.get("/api/production/productions/:id/members", ...requireProductionRole(), (req, res) => send(res, listMembers(L(req).live, L(req).productionId!, L(req).liveRole!)));
  app.post("/api/production/productions/:id/members", ...requireProductionRole("mv_coordinator", "client_admin", "crew_lead"), (req, res) => send(res, inviteMember(L(req).live, L(req).productionId!, L(req).liveRole!, body(req)), 201));
  app.patch("/api/production/productions/:id/members/:memberId", ...requireProductionRole("mv_coordinator", "client_admin", "crew_lead"), (req, res) => send(res, patchMember(L(req).live, L(req).productionId!, L(req).liveRole!, Number(req.params.memberId), body(req))));

  app.get("/api/production/productions/:id/stages", ...requireProductionRole(), (req, res) => send(res, (async () => {
    const rows = await db.select().from(stages).where(eq(stages.productionId, L(req).productionId!)).orderBy(stages.id);
    const vs = rows.length ? new Map((await db.select().from(venues).where(inArray(venues.id, Array.from(new Set(rows.map((s) => s.venueId).filter(Boolean))).concat(0)))).map((v) => [v.id, v])) : new Map<number, VenueRow>();
    return rows.map((s) => stageView(s, vs.get(s.venueId)));
  })()));
  app.post("/api/production/productions/:id/stages", ...requireProductionRole(...MANAGE), (req, res) => send(res, (async () => {
    const b = body(req), id = L(req).productionId!;
    const name = str(b.name, 80);
    if (name.length < 1) throw new Bad(400, "Give the stage a name.");
    let venue: VenueRow | undefined;
    if (Number(b.venueId) > 0) { [venue] = await db.select().from(venues).where(eq(venues.id, Number(b.venueId))).limit(1); if (!venue) throw new Bad(400, "We couldn't find that venue."); }
    const [s] = await db.insert(stages).values({ productionId: id, venueId: venue?.id ?? 0, name, studioId: Number(b.studioId) > 0 ? Number(b.studioId) : 0, ingestProfile: str(b.ingestProfile, 200), createdAt: now() }).returning();
    await audit(id, L(req).live.email, "stage.created", "stage", s.id, null, s);
    return stageView(s, venue);
  })(), 201));

  /** Client and vendor orgs, for the pickers (MV roles and admins). */
  app.get("/api/production/orgs", requireLive, (req, res) => send(res, (async () => {
    if (!(await mvAnywhere(L(req).live))) throw new Bad(403, "That list is for the MV team.");
    const kind = req.query.kind === "client" || req.query.kind === "vendor" ? [String(req.query.kind)] : ["client", "vendor"];
    const rows = await db.select().from(organizations).where(inArray(organizations.kind, kind)).orderBy(organizations.name);
    const slugs = await slugsFor(rows);
    return rows.map((o) => orgView(o, slugs));
  })()));

  app.get("/api/production/venues", requireLive, (req, res) => send(res, (async () => {
    if (!(await mvAnywhere(L(req).live))) throw new Bad(403, "Venues are for the MV team.");
    return (await db.select().from(venues).orderBy(venues.name)).map(venueView);
  })()));
  app.post("/api/production/venues", requireLive, (req, res) => send(res, (async () => {
    const who = L(req).live, b = body(req);
    if (!(await mvAnywhere(who))) throw new Bad(403, "Venues are for the MV team.");
    const name = str(b.name, 120);
    if (name.length < 2) throw new Bad(400, "Give the venue a name.");
    const t = tz(b.timezone);
    if (t === null) throw new Bad(400, "That isn't a time zone we know.");
    const [v] = await db.insert(venues).values({ name, address: str(b.address, 300), timezone: t, power: str(b.power, 1000), network: str(b.network, 1000), createdBy: who.email, createdAt: now() }).returning();
    await audit(0, who.email, "venue.created", "venue", v.id, null, v);
    return venueView(v);
  })(), 201));

  app.get("/api/production/productions/:id/approvals", ...requireProductionRole("mv_producer", "mv_coordinator", "mv_editor", "client_admin", "client_reviewer", "client_viewer"), (req, res) => send(res, (async () => {
    const rows = await db.select().from(approvals).where(eq(approvals.productionId, L(req).productionId!)).orderBy(desc(approvals.id));
    return rows.map((a) => approvalView(a, L(req).live, L(req).liveRole!));
  })()));
  app.post("/api/production/approvals/:id/decide", requireLive, (req, res) => send(res, decideApproval(L(req).live, Number(req.params.id), body(req))));

  app.get("/api/production/productions/:id/audit", ...requireProductionRole(...MANAGE), (req, res) => send(res, (async () => {
    const before = Number(req.query.before) || 0;
    const rows = await db.select().from(auditLog)
      .where(before ? and(eq(auditLog.productionId, L(req).productionId!), lt(auditLog.id, before)) : eq(auditLog.productionId, L(req).productionId!))
      .orderBy(desc(auditLog.id)).limit(200);
    return rows.map((r): AuditEntry => ({ id: r.id, productionId: r.productionId || null, who: r.who, what: r.what, subjectType: r.subjectType, subjectId: r.subjectId || null, before: parse(r.before), after: parse(r.after), at: r.at }));
  })()));
}

