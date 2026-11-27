// Military Voices LIVE phase 1 test fixtures (Packet A, 26 Nov 2026; split 27 Nov): two test productions, one each.
// Production A belongs to the test client org with hello+liveclient@ as Client Admin; production B belongs to the
// test vendor org with hello+livecrew@ as Crew Lead. So "a test client and a test vendor each see only their own
// production" can be proved both ways. Idempotent: run it again and nothing doubles.
// No email goes out; the two logins become active the first time they sign in and open LIVE.
import { and, eq } from "drizzle-orm";
import { db, schemaIsReady } from "../storage.js";
import { approvals, liveSessions, liveSpeakers, liveTemplates, organizations, productionMembers, productions, stages } from "../../shared/schema.js";
import { LIVE_TEST_CLIENT, LIVE_TEST_CREW, LIVE_TEST_REVIEWER, TEMPLATE_KINDS, type SessionKind } from "../../shared/live.js";
import { createSession, createSpeaker } from "./programme.js";
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

/* ── Phase 2 (27 Nov): the programme on production A only. Placeholder names only, never a person's (Andrew, 27 Nov). ── */
const SAMPLE_STAGE = "Main stage";
const SAMPLE_DAY = "2026-12-10"; // a test day; times are UTC
const SAMPLE_SESSIONS: { title: string; kind: SessionKind; at: string; minutes: number; speakers: number[]; mvOnly?: boolean }[] = [
  { title: "Session 1: Opening", kind: "keynote", at: "15:00", minutes: 20, speakers: [1] },
  { title: "Session 2: Panel", kind: "panel", at: "15:20", minutes: 45, speakers: [2, 3, 4] },
  { title: "Changeover", kind: "break", at: "16:05", minutes: 10, speakers: [], mvOnly: true },
  { title: "Session 3: Fireside chat", kind: "fireside", at: "16:15", minutes: 30, speakers: [2] },
  { title: "Session 4: Closing", kind: "keynote", at: "16:45", minutes: 15, speakers: [1] },
];
async function seedProgramme(p: number, by: string): Promise<{ stage: number; speakers: number; sessions: number; starters: number }> {
  const [hadStage] = await db.select().from(stages).where(and(eq(stages.productionId, p), eq(stages.name, SAMPLE_STAGE))).limit(1);
  const stage = hadStage ?? (await db.insert(stages).values({ productionId: p, name: SAMPLE_STAGE, createdAt: now() }).returning())[0];
  if (!hadStage) await audit(p, by, "stage.created", "stage", stage.id, null, stage);
  const speakerIds: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const name = `Speaker ${i}`;
    const [had] = await db.select({ id: liveSpeakers.id }).from(liveSpeakers).where(and(eq(liveSpeakers.productionId, p), eq(liveSpeakers.name, name))).limit(1);
    speakerIds[i] = had?.id ?? (await createSpeaker(by, p, "mv_admin", { name, title: "Title to come", company: "Organisation to come" })).id;
  }
  for (const s of SAMPLE_SESSIONS) {
    const [had] = await db.select({ id: liveSessions.id }).from(liveSessions).where(and(eq(liveSessions.productionId, p), eq(liveSessions.stageId, stage.id), eq(liveSessions.title, s.title))).limit(1);
    if (had) continue;
    const startsAt = new Date(`${SAMPLE_DAY}T${s.at}:00.000Z`).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + s.minutes * 60_000).toISOString();
    await createSession(by, p, "mv_admin", { stageId: stage.id, title: s.title, kind: s.kind, startsAt, endsAt, status: "confirmed", mvOnly: !!s.mvOnly, people: s.speakers.map((n, k) => ({ speakerId: speakerIds[n], role: s.kind === "panel" && k === 0 ? "moderator" : "speaker" })) });
  }
  // MV's blank starters, one of each kind (org 0): empty until Andrew approves their exact words.
  let starters = 0;
  for (const kind of TEMPLATE_KINDS) {
    const [had] = await db.select({ id: liveTemplates.id }).from(liveTemplates).where(and(eq(liveTemplates.orgId, 0), eq(liveTemplates.productionId, 0), eq(liveTemplates.kind, kind))).limit(1);
    if (had) { starters++; continue; }
    const [t] = await db.insert(liveTemplates).values({ orgId: 0, productionId: 0, kind, channel: "email", subject: "", text: "", state: "draft", createdBy: by, createdAt: now(), updatedAt: now() }).returning();
    await audit(0, by, "template.created", "template", t.id, null, t);
    starters++;
  }
  const sessions = (await db.select({ id: liveSessions.id }).from(liveSessions).where(and(eq(liveSessions.productionId, p), eq(liveSessions.stageId, stage.id)))).length;
  return { stage: stage.id, speakers: speakerIds.filter(Boolean).length, sessions, starters };
}

export async function seedLiveFixtures(by: string): Promise<{
  production: number; other: number; clientOrg: number; vendorOrg: number;
  before: Record<number, MemberLine[]>; after: Record<number, MemberLine[]>;
  programme: { stage: number; speakers: number; sessions: number; starters: number };
}> {
  await schemaIsReady();
  const clientOrg = await org(CLIENT_ORG, "client", by);
  const vendorOrg = await org(VENDOR_ORG, "vendor", by);
  const p = await production(FIXTURE_PRODUCTION, clientOrg, by);
  const other = await productionB(vendorOrg, by);
  const before = await membersOf([p, other]);
  await ownedBy(other, vendorOrg, by);
  await member(p, LIVE_TEST_CLIENT, "client_admin", clientOrg, by);
  await member(p, LIVE_TEST_REVIEWER, "client_reviewer", clientOrg, by); // phase 2: approves the run of show and bios
  await unmember(p, LIVE_TEST_CREW, by);
  await member(other, LIVE_TEST_CREW, "crew_lead", vendorOrg, by);
  await ensureAlex(p, by); // every production has Alex on it (26 Nov)
  await ensureAlex(other, by);
  // One pending approval for the client, so the approve path can be tried.
  const [has] = await db.select({ id: approvals.id }).from(approvals).where(eq(approvals.productionId, p)).limit(1);
  if (!has) await requestApproval(p, { subjectType: "run_of_show", subjectId: 0, summary: "Run of show v1 (test)", requestedBy: by, approverRole: "client_admin" });
  const programme = await seedProgramme(p, by);
  return { production: p, other, clientOrg, vendorOrg, before, after: await membersOf([p, other]), programme };
}
