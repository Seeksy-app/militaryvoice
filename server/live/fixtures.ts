// Military Voices LIVE phase 1 test fixtures (Packet A, 26 Nov 2026): one test production with a test client
// (Client Admin, hello+liveclient@) and a test vendor (Crew Lead, hello+livecrew@), plus a second production neither
// can see, so "each sees only its own production" can be proved. Idempotent: run it again and nothing doubles.
// No email goes out; the two logins become active the first time they sign in and open LIVE.
import { and, eq } from "drizzle-orm";
import { db, schemaIsReady } from "../storage.js";
import { approvals, organizations, productionMembers, productions } from "../../shared/schema.js";
import { LIVE_TEST_CLIENT, LIVE_TEST_CREW } from "../../shared/live.js";
import { audit, now } from "./access.js";
import { requestApproval } from "./routes.js";

export const FIXTURE_PRODUCTION = "Test production (LIVE phase 1)";
export const FIXTURE_OTHER = "Test production B (nobody's)";
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
async function member(productionId: number, email: string, role: string, orgId: number, by: string): Promise<void> {
  const [had] = await db.select().from(productionMembers).where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.email, email))).limit(1);
  if (had) return;
  const [m] = await db.insert(productionMembers).values({ productionId, email, role, orgId, status: "invited", invitedBy: by, createdAt: now() }).returning();
  await audit(productionId, by, "member.invited", "member", m.id, null, m);
}

export async function seedLiveFixtures(by: string): Promise<{ production: number; other: number; clientOrg: number; vendorOrg: number }> {
  await schemaIsReady();
  const clientOrg = await org(CLIENT_ORG, "client", by);
  const vendorOrg = await org(VENDOR_ORG, "vendor", by);
  const p = await production(FIXTURE_PRODUCTION, clientOrg, by);
  const other = await production(FIXTURE_OTHER, 0, by);
  await member(p, LIVE_TEST_CLIENT, "client_admin", clientOrg, by);
  await member(p, LIVE_TEST_CREW, "crew_lead", vendorOrg, by);
  // One pending approval for the client, so the approve path can be tried.
  const [has] = await db.select({ id: approvals.id }).from(approvals).where(eq(approvals.productionId, p)).limit(1);
  if (!has) await requestApproval(p, { subjectType: "run_of_show", subjectId: 0, summary: "Run of show v1 (test)", requestedBy: by, approverRole: "client_admin" });
  return { production: p, other, clientOrg, vendorOrg };
}
