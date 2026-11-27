// Military Voices LIVE phase 1 test fixtures (Packet A, 26 Nov 2026; split 27 Nov): two test productions, one each.
// Production A belongs to the test client org with hello+liveclient@ as Client Admin; production B belongs to the
// test vendor org with hello+livecrew@ as Crew Lead. So "a test client and a test vendor each see only their own
// production" can be proved both ways. Idempotent: run it again and nothing doubles.
// No email goes out; the two logins become active the first time they sign in and open LIVE.
import { and, eq } from "drizzle-orm";
import { db, schemaIsReady } from "../storage.js";
import { approvals, organizations, productionMembers, productions } from "../../shared/schema.js";
import { LIVE_TEST_CLIENT, LIVE_TEST_CREW } from "../../shared/live.js";
import { audit, now } from "./access.js";
import { ensureAlex, requestApproval } from "./routes.js";

export const FIXTURE_PRODUCTION = "Test production (LIVE phase 1)";
export const FIXTURE_OTHER = "Test production B (vendor)";
/** Its name before 27 Nov, when it had no org: found once by this, renamed by id, then found by FIXTURE_OTHER. */
const FIXTURE_OTHER_WAS = "Test production B (nobody's)";
const CLIENT_ORG = "Test Client (LIVE)";
const VENDOR_ORG = "Test Crew Co (LIVE)";

async function org(name: string, kind: "client" | "vendor", by: string): Promise<number> {
  const [had] = await db.select().from(organizations).where(and(eq(organizations.name, name), eq(organizations.kind, kind))).limit(1);
  if (had) return had.id;
  const [o] = await db.insert(organizations).values({ name, kind, status: "approved", createdBy: by, createdAt: now(), approvedAt: now() }).returning();
  return o.id;
}
async function production(name: string, orgId: number, by: string): Promise<number> {
  const [had] = await db.select().from(productions).where(eq(productions.name, name)).limit(1);
  if (had) return had.id;
  const [p] = await db.insert(productions).values({ name, orgId, status: "planning", scope: "Test data for the phase 1 access check. Safe to delete.", createdBy: by, createdAt: now(), updatedAt: now() }).returning();
  await audit(p.id, by, "production.created", "production", p.id, null, p);
  return p.id;
}
/** Takes someone off a production (status "removed", as the Members screen does; the row and its audit stay). */
async function unmember(productionId: number, email: string, by: string): Promise<void> {
  const [m] = await db.select().from(productionMembers).where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.email, email))).limit(1);
  if (!m || m.status === "removed") return;
  const [after] = await db.update(productionMembers).set({ status: "removed" }).where(eq(productionMembers.id, m.id)).returning();
  await audit(productionId, by, "member.updated", "member", m.id, m, after);
}
/** Production B, renamed by id from its old name if that's still what it's called. */
async function productionB(orgId: number, by: string): Promise<number> {
  const [had] = await db.select().from(productions).where(eq(productions.name, FIXTURE_OTHER)).limit(1);
  if (had) return had.id;
  const [old] = await db.select().from(productions).where(eq(productions.name, FIXTURE_OTHER_WAS)).limit(1);
  if (!old) return production(FIXTURE_OTHER, orgId, by);
  const [after] = await db.update(productions).set({ name: FIXTURE_OTHER, updatedAt: now() }).where(eq(productions.id, old.id)).returning();
  await audit(old.id, by, "production.updated", "production", old.id, old, after);
  return old.id;
}
/** Production B was made with no org (26 Nov); since 27 Nov it's the test vendor's. */
async function ownedBy(productionId: number, orgId: number, by: string): Promise<void> {
  const [p] = await db.select().from(productions).where(eq(productions.id, productionId)).limit(1);
  if (!p || p.orgId === orgId) return;
  const [after] = await db.update(productions).set({ orgId, updatedAt: now() }).where(eq(productions.id, productionId)).returning();
  await audit(productionId, by, "production.updated", "production", productionId, p, after);
}
type MemberLine = { email: string; role: string; orgId: number; status: string };
async function membersOf(ids: number[]): Promise<Record<number, MemberLine[]>> {
  const out: Record<number, MemberLine[]> = {};
  for (const id of ids) {
    const rows = await db.select().from(productionMembers).where(eq(productionMembers.productionId, id)).orderBy(productionMembers.id);
    out[id] = rows.map((m) => ({ email: m.email, role: m.role, orgId: m.orgId, status: m.status }));
  }
  return out;
}

async function member(productionId: number, email: string, role: string, orgId: number, by: string): Promise<void> {
  const [had] = await db.select().from(productionMembers).where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.email, email))).limit(1);
  if (had) return;
  const [m] = await db.insert(productionMembers).values({ productionId, email, role, orgId, status: "invited", invitedBy: by, createdAt: now() }).returning();
  await audit(productionId, by, "member.invited", "member", m.id, null, m);
}

export async function seedLiveFixtures(by: string): Promise<{
  production: number; other: number; clientOrg: number; vendorOrg: number;
  before: Record<number, MemberLine[]>; after: Record<number, MemberLine[]>;
}> {
  await schemaIsReady();
  const clientOrg = await org(CLIENT_ORG, "client", by);
  const vendorOrg = await org(VENDOR_ORG, "vendor", by);
  const p = await production(FIXTURE_PRODUCTION, clientOrg, by);
  const other = await productionB(vendorOrg, by);
  const before = await membersOf([p, other]);
  await ownedBy(other, vendorOrg, by);
  await member(p, LIVE_TEST_CLIENT, "client_admin", clientOrg, by);
  await unmember(p, LIVE_TEST_CREW, by);
  await member(other, LIVE_TEST_CREW, "crew_lead", vendorOrg, by);
  await ensureAlex(p, by); // every production has Alex on it (26 Nov)
  await ensureAlex(other, by);
  // One pending approval for the client, so the approve path can be tried.
  const [has] = await db.select({ id: approvals.id }).from(approvals).where(eq(approvals.productionId, p)).limit(1);
  if (!has) await requestApproval(p, { subjectType: "run_of_show", subjectId: 0, summary: "Run of show v1 (test)", requestedBy: by, approverRole: "client_admin" });
  return { production: p, other, clientOrg, vendorOrg, before, after: await membersOf([p, other]) };
}
