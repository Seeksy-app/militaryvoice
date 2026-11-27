// Military Voices LIVE, phase 2: Programme (Packet A, Podcasting, 27 Nov 2026). Sessions, speakers, who's on each
// session, the run-of-show view, scripts, sponsors and message templates. The contract is shared/live.ts (phase 2
// block, frozen: add fields only). Every write adds an audit_log row. Nothing here sends mail or renders audio.
//
// Versions: any change to a session, who's on it, a speaker on it, or one of its scripts raises that stage's
// ros_version. Approving freezes a versions row (subject run_of_show, subject_id = stage id; step 2); this file only
// reads it, to say what changed since and whether the run of show is approved, in review or changes_pending.
import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../storage.js";
import {
  approvals, liveScripts, liveSessionPeople, liveSessions, liveSpeakers, liveSponsors, liveTemplates, productions, stages, versions,
  type ApprovalRow, type LiveScriptRow, type LiveSessionRow, type LiveSpeakerRow, type LiveSponsorRow, type LiveTemplateRow, type StageRow,
} from "../../shared/schema.js";
import {
  CLIENT_ROLES, MV_ROLES, SCRIPT_KINDS, SESSION_KINDS, SESSION_PERSON_ROLES, SESSION_STATUSES, TEMPLATE_KINDS,
  type ApprovalState, type LiveRole, type LiveSponsor, type LiveTemplate, type RunOfShow, type RunOfShowState, type Script,
  sessionMinutes, type ScriptKind, type Session, type SessionKind, type SessionPerson, type SessionPersonRole, type Speaker, type TemplateKind,
} from "../../shared/live.js";
import { audit, now, requireProductionRole, type LiveReq } from "./access.js";

export class ProgrammeError extends Error { constructor(public code: number, msg: string) { super(msg); } }
const Bad = ProgrammeError;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const https = (v: unknown, what: string) => { const u = str(v, 1000); if (u && !/^https:\/\//.test(u)) throw new Bad(400, `${what} needs an https:// link.`); return u; };
const json = <T>(raw: string, fallback: T): T => { try { const v = JSON.parse(raw || ""); return (v ?? fallback) as T; } catch { return fallback; } };
const iso = (v: unknown): string | null => { const t = Date.parse(str(v, 40)); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const isMv = (r: LiveRole) => MV_ROLES.includes(r);
const isClientRole = (r: LiveRole) => CLIENT_ROLES.includes(r);

/* ── Reads ── */

async function stageOf(productionId: number, stageId: number): Promise<StageRow> {
  const [s] = await db.select().from(stages).where(and(eq(stages.id, stageId), eq(stages.productionId, productionId))).limit(1);
  if (!s) throw new Bad(404, "We couldn't find that stage.");
  return s;
}
async function sessionOf(productionId: number, sessionId: number): Promise<LiveSessionRow> {
  const [s] = await db.select().from(liveSessions).where(and(eq(liveSessions.id, sessionId), eq(liveSessions.productionId, productionId), ne(liveSessions.status, "removed"))).limit(1);
  if (!s) throw new Bad(404, "We couldn't find that session.");
  return s;
}
async function speakerOf(productionId: number, speakerId: number): Promise<LiveSpeakerRow> {
  const [s] = await db.select().from(liveSpeakers).where(and(eq(liveSpeakers.id, speakerId), eq(liveSpeakers.productionId, productionId), eq(liveSpeakers.removed, false))).limit(1);
  if (!s) throw new Bad(404, "We couldn't find that speaker.");
  return s;
}

/** Raise a stage's working run-of-show version (any change to what it would freeze). */
async function bumpStages(stageIds: number[]): Promise<void> {
  for (const id of Array.from(new Set(stageIds.filter((x) => x > 0)))) {
    const [s] = await db.select({ v: stages.rosVersion }).from(stages).where(eq(stages.id, id)).limit(1);
    if (s) await db.update(stages).set({ rosVersion: s.v + 1 }).where(eq(stages.id, id));
  }
}
/** The stages a speaker's sessions are on. */
async function stagesOfSpeaker(speakerId: number): Promise<number[]> {
  const links = await db.select({ s: liveSessionPeople.sessionId }).from(liveSessionPeople).where(eq(liveSessionPeople.speakerId, speakerId));
  if (!links.length) return [];
  const rows = await db.select({ st: liveSessions.stageId }).from(liveSessions).where(and(inArray(liveSessions.id, links.map((l) => l.s)), ne(liveSessions.status, "removed")));
  return rows.map((r) => r.st);
}

/** What an approved run of show froze (versions.data), as far as "what changed since" needs it. Step 2 writes it. */
export type FrozenRunOfShow = {
  sessions: {
    id: number; version: number; title: string;
    people: { speakerId: number; version: number; name?: string; role?: string }[];
    scripts: { id: number; version: number; kind?: ScriptKind }[];
    // What the console rows are written from (step 2, approve.ts).
    kind?: string; status?: string; startsAt?: string; endsAt?: string; sort?: number; mvOnly?: boolean;
  }[];
};
async function approvedOf(stageId: number): Promise<{ version: number; at: string; data: FrozenRunOfShow } | null> {
  const [v] = await db.select().from(versions).where(and(eq(versions.subjectType, "run_of_show"), eq(versions.subjectId, stageId))).orderBy(desc(versions.version)).limit(1);
  return v ? { version: v.version, at: v.createdAt, data: json<FrozenRunOfShow>(v.data, { sessions: [] }) } : null;
}
async function latestApproval(subjectType: string, subjectIds: number[]): Promise<Map<number, ApprovalRow>> {
  if (!subjectIds.length) return new Map();
  const rows = await db.select().from(approvals).where(and(eq(approvals.subjectType, subjectType), inArray(approvals.subjectId, subjectIds), ne(approvals.state, "withdrawn"))).orderBy(desc(approvals.id));
  const m = new Map<number, ApprovalRow>();
  for (const a of rows) if (!m.has(a.subjectId)) m.set(a.subjectId, a);
  return m;
}

/* ── Views ── */

const scriptView = (s: LiveScriptRow): Script => ({
  id: s.id, productionId: s.productionId, sessionId: s.sessionId, kind: s.kind as ScriptKind, sponsorId: s.sponsorId || null, text: s.text,
  audioUrl: s.audioUrl, version: s.version, state: s.state as Script["state"], draftedBy: s.draftedBy, createdAt: s.createdAt, updatedAt: s.updatedAt,
});
/** Clients and crew see only scripts that have gone to the client (in_review) or been approved. */
const scriptsFor = (role: LiveRole, rows: LiveScriptRow[]) => rows.filter((s) => s.state !== "removed" && (isMv(role) || s.state === "in_review" || s.state === "approved"));

async function speakerViews(productionId: number, role: LiveRole, rows: LiveSpeakerRow[]): Promise<Speaker[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const links = await db.select().from(liveSessionPeople).where(inArray(liveSessionPeople.speakerId, ids));
  const live = links.length ? new Set((await db.select({ id: liveSessions.id }).from(liveSessions).where(and(inArray(liveSessions.id, links.map((l) => l.sessionId)), ne(liveSessions.status, "removed")))).map((r) => r.id)) : new Set<number>();
  const appr = await latestApproval("speaker", ids);
  const contact = isMv(role) || role === "client_admin";
  return rows.map((s) => {
    const a = appr.get(s.id);
    return {
      id: s.id, productionId, name: s.name, title: s.title, company: s.company, bio: s.bio, photoUrl: s.photoUrl, cutoutUrl: s.cutoutUrl,
      links: json<Speaker["links"]>(s.links, []), pronunciationText: s.pronunciationText, pronunciationAudioUrl: s.pronunciationAudioUrl,
      email: contact ? s.email : "", phone: contact ? s.phone : "", version: s.version,
      approval: (a?.state as ApprovalState | undefined) ?? "none",
      changedSinceApproval: !!a && a.state === "approved" && s.version > a.version,
      sessionIds: links.filter((l) => l.speakerId === s.id && live.has(l.sessionId)).map((l) => l.sessionId),
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    };
  });
}

/** The sessions of one stage (or one session), as the role may see them, with people and scripts. */
async function sessionViews(role: LiveRole, rows: LiveSessionRow[], frozen: FrozenRunOfShow | null): Promise<Session[]> {
  const client = isClientRole(role);
  const shown = rows.filter((s) => s.status !== "removed" && !(client && s.mvOnly));
  if (!shown.length) return [];
  const ids = shown.map((s) => s.id);
  const links = await db.select().from(liveSessionPeople).where(inArray(liveSessionPeople.sessionId, ids)).orderBy(liveSessionPeople.sort, liveSessionPeople.id);
  const sp = links.length ? await db.select().from(liveSpeakers).where(inArray(liveSpeakers.id, Array.from(new Set(links.map((l) => l.speakerId))))) : [];
  const byId = new Map(sp.map((s) => [s.id, s]));
  const scripts = await db.select().from(liveScripts).where(inArray(liveScripts.sessionId, ids)).orderBy(liveScripts.id);
  const was = new Map((frozen?.sessions ?? []).map((f) => [f.id, f]));
  return shown.map((s) => {
    const people: SessionPerson[] = links.filter((l) => l.sessionId === s.id && byId.get(l.speakerId) && !byId.get(l.speakerId)!.removed)
      .map((l) => { const p = byId.get(l.speakerId)!; return { speakerId: p.id, name: p.name, role: l.role as SessionPersonRole, photoUrl: p.photoUrl, cutoutUrl: p.cutoutUrl }; });
    const mine = scripts.filter((x) => x.sessionId === s.id && x.state !== "removed");
    const f = was.get(s.id);
    const changed = !!frozen && (!f || f.version !== s.version
      || JSON.stringify(f.people.map((p) => ({ speakerId: p.speakerId, version: p.version }))) !== JSON.stringify(links.filter((l) => l.sessionId === s.id && byId.get(l.speakerId) && !byId.get(l.speakerId)!.removed).map((l) => ({ speakerId: l.speakerId, version: byId.get(l.speakerId)!.version })))
      || JSON.stringify(f.scripts.map((x) => ({ id: x.id, version: x.version }))) !== JSON.stringify(mine.map((x) => ({ id: x.id, version: x.version }))));
    return {
      id: s.id, productionId: s.productionId, stageId: s.stageId, startsAt: s.startsAt, endsAt: s.endsAt, durationMinutes: sessionMinutes(s.startsAt, s.endsAt),
      title: s.title, kind: s.kind as SessionKind, status: s.status as Session["status"], sort: s.sort, mvOnly: s.mvOnly, notes: client ? "" : s.notes,
      people, scripts: scriptsFor(role, mine).map(scriptView), version: s.version, changedSinceApproval: changed, createdAt: s.createdAt, updatedAt: s.updatedAt,
    };
  });
}
const bySchedule = (a: LiveSessionRow, b: LiveSessionRow) => a.startsAt.localeCompare(b.startsAt) || a.sort - b.sort || a.id - b.id;

export async function runOfShow(productionId: number, stageId: number, role: LiveRole): Promise<RunOfShow> {
  const st = await stageOf(productionId, stageId);
  const [p] = await db.select({ tz: productions.timezone }).from(productions).where(eq(productions.id, productionId)).limit(1);
  const rows = (await db.select().from(liveSessions).where(and(eq(liveSessions.productionId, productionId), eq(liveSessions.stageId, stageId)))).sort(bySchedule);
  const approved = await approvedOf(stageId);
  const appr = (await latestApproval("run_of_show", [stageId])).get(stageId) ?? null;
  const sessions = await sessionViews(role, rows, approved?.data ?? null);
  let state: RunOfShowState = "draft";
  if (appr?.state === "pending") state = appr.version === st.rosVersion ? "in_review" : "changes_pending";
  else if (appr?.state === "changes_requested") state = "changes_requested";
  else if (approved) state = approved.version === st.rosVersion ? "approved" : "changes_pending";
  const now = new Set(rows.filter((r) => r.status !== "removed").map((r) => r.id));
  const visible = new Set(sessions.map((s) => s.id));
  const frozen = approved?.data.sessions ?? [];
  return {
    productionId, stageId, stageName: st.name, timezone: p?.tz ?? "America/New_York", version: st.rosVersion,
    approvedVersion: approved?.version ?? null, approvedAt: approved?.at ?? "", state, approvalId: appr?.id ?? null, sessions,
    changes: approved
      ? {
        added: sessions.filter((s) => !frozen.some((f) => f.id === s.id)).map((s) => s.id),
        changed: sessions.filter((s) => s.changedSinceApproval && frozen.some((f) => f.id === s.id)).map((s) => s.id),
        removed: frozen.filter((f) => !now.has(f.id) && (visible.has(f.id) || !rows.some((r) => r.id === f.id && r.mvOnly && isClientRole(role)))).map((f) => ({ id: f.id, title: f.title })),
      }
      : { added: [], changed: [], removed: [] },
  };
}

/* ── Sessions ── */

function sessionFields(b: Record<string, unknown>, creating: boolean, before?: LiveSessionRow): Partial<LiveSessionRow> {
  const out: Partial<LiveSessionRow> = {};
  if (creating || b.title !== undefined) { const t = str(b.title, 160); if (!t) throw new Bad(400, "Give the session a title."); out.title = t; }
  for (const k of ["startsAt", "endsAt"] as const) if (creating || b[k] !== undefined) { const t = iso(b[k]); if (!t) throw new Bad(400, "Times need a date and time."); out[k] = t; }
  const s = out.startsAt ?? before?.startsAt ?? "", e = out.endsAt ?? before?.endsAt ?? "";
  if (Date.parse(e) <= Date.parse(s)) throw new Bad(400, "The session ends before it starts.");
  if (Date.parse(e) - Date.parse(s) > 24 * 3600_000) throw new Bad(400, "A session can be at most 24 hours.");
  if (b.kind !== undefined) { if (!(SESSION_KINDS as readonly string[]).includes(String(b.kind))) throw new Bad(400, "That isn't a session kind."); out.kind = String(b.kind); }
  if (b.status !== undefined) { if (!(SESSION_STATUSES as readonly string[]).includes(String(b.status))) throw new Bad(400, "That isn't a session status."); out.status = String(b.status); }
  if (b.sort !== undefined) out.sort = Math.max(-100000, Math.min(100000, Math.round(Number(b.sort) || 0)));
  if (b.mvOnly !== undefined) out.mvOnly = b.mvOnly === true;
  if (b.notes !== undefined) out.notes = str(b.notes, 4000);
  return out;
}
async function setPeople(productionId: number, sessionId: number, list: unknown): Promise<void> {
  if (!Array.isArray(list) || list.length > 40) throw new Bad(400, "People is a list of speakers.");
  const want = list.map((x, i) => {
    const o = (x ?? {}) as { speakerId?: unknown; role?: unknown };
    const role = o.role === undefined ? "speaker" : String(o.role);
    if (!(SESSION_PERSON_ROLES as readonly string[]).includes(role)) throw new Bad(400, "That isn't a role on a session.");
    return { speakerId: Number(o.speakerId) || 0, role, sort: i };
  });
  const ids = Array.from(new Set(want.map((w) => w.speakerId)));
  if (ids.length !== want.length) throw new Bad(400, "Someone's on the list twice.");
  const ok = ids.length ? await db.select({ id: liveSpeakers.id }).from(liveSpeakers).where(and(inArray(liveSpeakers.id, ids), eq(liveSpeakers.productionId, productionId), eq(liveSpeakers.removed, false))) : [];
  if (ok.length !== ids.length) throw new Bad(400, "Those speakers aren't on this production.");
  await db.delete(liveSessionPeople).where(eq(liveSessionPeople.sessionId, sessionId));
  if (want.length) await db.insert(liveSessionPeople).values(want.map((w) => ({ productionId, sessionId, ...w })));
}
async function oneSession(productionId: number, id: number, role: LiveRole): Promise<Session> {
  const s = await sessionOf(productionId, id);
  const [v] = await sessionViews(role, [s], (await approvedOf(s.stageId))?.data ?? null);
  if (!v) throw new Bad(404, "We couldn't find that session.");
  return v;
}

export async function createSession(who: string, productionId: number, role: LiveRole, b: Record<string, unknown>): Promise<Session> {
  const st = await stageOf(productionId, Number(b.stageId) || 0);
  const f = sessionFields(b, true);
  const [s] = await db.insert(liveSessions).values({ kind: "other", ...f, productionId, stageId: st.id, title: f.title!, startsAt: f.startsAt!, endsAt: f.endsAt!, createdBy: who, createdAt: now(), updatedAt: now() }).returning();
  if (b.people !== undefined) await setPeople(productionId, s.id, b.people);
  await bumpStages([st.id]);
  await audit(productionId, who, "session.created", "session", s.id, null, { ...s, people: b.people ?? [] });
  return oneSession(productionId, s.id, role);
}

export async function updateSession(who: string, productionId: number, role: LiveRole, id: number, b: Record<string, unknown>): Promise<Session> {
  const before = await sessionOf(productionId, id);
  const f = sessionFields(b, false, before);
  if (b.stageId !== undefined) f.stageId = (await stageOf(productionId, Number(b.stageId) || 0)).id;
  const peopleBefore = b.people !== undefined ? await db.select().from(liveSessionPeople).where(eq(liveSessionPeople.sessionId, id)) : null;
  if (b.people !== undefined) await setPeople(productionId, id, b.people);
  if (!Object.keys(f).length && b.people === undefined) return oneSession(productionId, id, role);
  const [after] = await db.update(liveSessions).set({ ...f, version: before.version + 1, updatedAt: now() }).where(eq(liveSessions.id, id)).returning();
  await bumpStages([before.stageId, after.stageId]);
  await audit(productionId, who, "session.updated", "session", id, { ...before, ...(peopleBefore ? { people: peopleBefore } : {}) }, { ...after, ...(b.people !== undefined ? { people: b.people } : {}) });
  return oneSession(productionId, id, role);
}

export async function removeSession(who: string, productionId: number, id: number): Promise<{ ok: true }> {
  const before = await sessionOf(productionId, id);
  const [after] = await db.update(liveSessions).set({ status: "removed", version: before.version + 1, updatedAt: now() }).where(eq(liveSessions.id, id)).returning();
  await bumpStages([before.stageId]);
  await audit(productionId, who, "session.removed", "session", id, before, after);
  return { ok: true };
}

/* ── Speakers ── */

function speakerFields(b: Record<string, unknown>, creating: boolean): Partial<LiveSpeakerRow> {
  const out: Partial<LiveSpeakerRow> = {};
  if (creating || b.name !== undefined) { const n = str(b.name, 120); if (n.length < 2) throw new Bad(400, "Give the speaker's name."); out.name = n; }
  if (b.title !== undefined) out.title = str(b.title, 160);
  if (b.company !== undefined) out.company = str(b.company, 160);
  if (b.bio !== undefined) out.bio = str(b.bio, 4000);
  if (b.photoUrl !== undefined) out.photoUrl = https(b.photoUrl, "The headshot");
  if (b.cutoutUrl !== undefined) out.cutoutUrl = https(b.cutoutUrl, "The cutout");
  if (b.pronunciationAudioUrl !== undefined) out.pronunciationAudioUrl = https(b.pronunciationAudioUrl, "The pronunciation audio");
  if (b.pronunciationText !== undefined) out.pronunciationText = str(b.pronunciationText, 200);
  if (b.email !== undefined) { const e = str(b.email, 200).toLowerCase(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Bad(400, "Enter a valid email."); out.email = e; }
  if (b.phone !== undefined) out.phone = str(b.phone, 40);
  if (b.links !== undefined) {
    if (!Array.isArray(b.links) || b.links.length > 10) throw new Bad(400, "Links is a list of up to 10.");
    out.links = JSON.stringify(b.links.map((l) => { const o = (l ?? {}) as { label?: unknown; url?: unknown }; return { label: str(o.label, 60), url: https(o.url, "Each link") }; }).filter((l) => l.url));
  }
  return out;
}
export async function listSpeakers(productionId: number, role: LiveRole): Promise<Speaker[]> {
  const rows = await db.select().from(liveSpeakers).where(and(eq(liveSpeakers.productionId, productionId), eq(liveSpeakers.removed, false))).orderBy(liveSpeakers.name);
  return speakerViews(productionId, role, rows);
}
export async function createSpeaker(who: string, productionId: number, role: LiveRole, b: Record<string, unknown>): Promise<Speaker> {
  const f = speakerFields(b, true);
  const [p] = await db.select({ orgId: productions.orgId }).from(productions).where(eq(productions.id, productionId)).limit(1);
  const [s] = await db.insert(liveSpeakers).values({ ...f, name: f.name!, productionId, orgId: p?.orgId ?? 0, createdBy: who, createdAt: now(), updatedAt: now() }).returning();
  await audit(productionId, who, "speaker.created", "speaker", s.id, null, s);
  return (await speakerViews(productionId, role, [s]))[0];
}
export async function updateSpeaker(who: string, productionId: number, role: LiveRole, id: number, b: Record<string, unknown>): Promise<Speaker> {
  const before = await speakerOf(productionId, id);
  const f = speakerFields(b, false);
  if (!Object.keys(f).length) return (await speakerViews(productionId, role, [before]))[0];
  const [after] = await db.update(liveSpeakers).set({ ...f, version: before.version + 1, updatedAt: now() }).where(eq(liveSpeakers.id, id)).returning();
  await bumpStages(await stagesOfSpeaker(id));
  await audit(productionId, who, "speaker.updated", "speaker", id, before, after);
  return (await speakerViews(productionId, role, [after]))[0];
}
export async function removeSpeaker(who: string, productionId: number, id: number): Promise<{ ok: true }> {
  const before = await speakerOf(productionId, id);
  if ((await stagesOfSpeaker(id)).length) throw new Bad(409, "Take them off their sessions first.");
  await db.update(liveSpeakers).set({ removed: true, updatedAt: now() }).where(eq(liveSpeakers.id, id));
  await audit(productionId, who, "speaker.removed", "speaker", id, before, { removed: true });
  return { ok: true };
}

/* ── Scripts ── */

export async function listScripts(productionId: number, role: LiveRole, sessionId: number): Promise<Script[]> {
  const rows = await db.select().from(liveScripts).where(sessionId ? and(eq(liveScripts.productionId, productionId), eq(liveScripts.sessionId, sessionId)) : eq(liveScripts.productionId, productionId)).orderBy(liveScripts.sessionId, liveScripts.id);
  return scriptsFor(role, rows).map(scriptView);
}
export async function createScript(who: string, productionId: number, b: Record<string, unknown>, aiActionId = 0): Promise<Script> {
  const s = await sessionOf(productionId, Number(b.sessionId) || 0);
  const kind = String(b.kind ?? "intro");
  if (!(SCRIPT_KINDS as string[]).includes(kind)) throw new Bad(400, "That isn't a script kind.");
  const sponsorId = Number(b.sponsorId) || 0;
  if (sponsorId) { const [sp] = await db.select({ id: liveSponsors.id }).from(liveSponsors).where(and(eq(liveSponsors.id, sponsorId), eq(liveSponsors.productionId, productionId))).limit(1); if (!sp) throw new Bad(400, "That sponsor isn't on this production."); }
  const [row] = await db.insert(liveScripts).values({ productionId, sessionId: s.id, kind, sponsorId, text: str(b.text, 8000), state: "draft", draftedBy: aiActionId ? "alex" : who, aiActionId, createdAt: now(), updatedAt: now() }).returning();
  await bumpStages([s.stageId]);
  await audit(productionId, who, "script.created", "script", row.id, null, row, aiActionId);
  return scriptView(row);
}
export async function updateScript(who: string, productionId: number, id: number, b: Record<string, unknown>): Promise<Script> {
  const [before] = await db.select().from(liveScripts).where(and(eq(liveScripts.id, id), eq(liveScripts.productionId, productionId), ne(liveScripts.state, "removed"))).limit(1);
  if (!before) throw new Bad(404, "We couldn't find that script.");
  if (b.text === undefined) return scriptView(before);
  // A new version: back to draft, and its audio goes (it was for the old words).
  const [after] = await db.update(liveScripts).set({ text: str(b.text, 8000), version: before.version + 1, state: "draft", audioUrl: "", updatedAt: now() }).where(eq(liveScripts.id, id)).returning();
  const [s] = await db.select({ st: liveSessions.stageId }).from(liveSessions).where(eq(liveSessions.id, before.sessionId)).limit(1);
  await bumpStages([s?.st ?? 0]);
  await audit(productionId, who, "script.updated", "script", id, before, after);
  return scriptView(after);
}

/* ── Sponsors ── */

const sponsorView = (s: LiveSponsorRow): LiveSponsor => ({ id: s.id, productionId: s.productionId, name: s.name, logoUrl: s.logoUrl, obligations: json<LiveSponsor["obligations"]>(s.obligations, []), createdAt: s.createdAt, updatedAt: s.updatedAt });
function sponsorFields(b: Record<string, unknown>, creating: boolean): Partial<LiveSponsorRow> {
  const out: Partial<LiveSponsorRow> = {};
  if (creating || b.name !== undefined) { const n = str(b.name, 120); if (n.length < 2) throw new Bad(400, "Give the sponsor a name."); out.name = n; }
  if (b.logoUrl !== undefined) out.logoUrl = https(b.logoUrl, "The logo");
  if (b.obligations !== undefined) {
    if (!Array.isArray(b.obligations) || b.obligations.length > 30) throw new Bad(400, "Obligations is a list.");
    out.obligations = JSON.stringify(b.obligations.map((o) => { const x = (o ?? {}) as { what?: unknown; count?: unknown; stageId?: unknown }; return { what: str(x.what, 200), ...(Number(x.count) > 0 ? { count: Math.round(Number(x.count)) } : {}), ...(Number(x.stageId) > 0 ? { stageId: Number(x.stageId) } : {}) }; }).filter((o) => o.what));
  }
  return out;
}

/* ── Templates ── */

const templateView = (t: LiveTemplateRow): LiveTemplate => ({
  id: t.id, orgId: t.orgId, productionId: t.productionId || null, kind: t.kind as TemplateKind, channel: t.channel === "sms" ? "sms" : "email",
  subject: t.subject, text: t.text, version: t.version, state: t.state as LiveTemplate["state"], approvedBy: t.approvedBy, approvedAt: t.approvedAt,
  sendable: t.state === "approved", starter: t.orgId === 0, createdAt: t.createdAt, updatedAt: t.updatedAt,
});
export async function listTemplates(productionId: number, role: LiveRole): Promise<LiveTemplate[]> {
  const [p] = await db.select({ orgId: productions.orgId }).from(productions).where(eq(productions.id, productionId)).limit(1);
  const org = p?.orgId ?? 0;
  const rows = await db.select().from(liveTemplates).where(inArray(liveTemplates.orgId, org ? [0, org] : [0])).orderBy(liveTemplates.orgId, liveTemplates.kind, liveTemplates.id);
  return rows
    .filter((t) => (t.orgId === 0 ? isMv(role) && t.productionId === 0 : t.productionId === 0 || t.productionId === productionId))
    .map(templateView);
}
export async function createTemplate(who: string, productionId: number, b: Record<string, unknown>): Promise<LiveTemplate> {
  const [p] = await db.select({ orgId: productions.orgId }).from(productions).where(eq(productions.id, productionId)).limit(1);
  if (!p?.orgId) throw new Bad(400, "Give the production a client first: templates belong to the client.");
  let base: Pick<LiveTemplateRow, "kind" | "channel" | "subject" | "text"> = { kind: String(b.kind ?? ""), channel: b.channel === "sms" ? "sms" : "email", subject: str(b.subject, 200), text: str(b.text, 8000) };
  if (Number(b.fromStarterId) > 0) {
    const [st] = await db.select().from(liveTemplates).where(and(eq(liveTemplates.id, Number(b.fromStarterId)), eq(liveTemplates.orgId, 0))).limit(1);
    if (!st) throw new Bad(400, "We couldn't find that starter.");
    base = { kind: st.kind, channel: st.channel, subject: b.subject !== undefined ? base.subject : st.subject, text: b.text !== undefined ? base.text : st.text };
  }
  if (!(TEMPLATE_KINDS as readonly string[]).includes(base.kind)) throw new Bad(400, "That isn't a template kind.");
  const [t] = await db.insert(liveTemplates).values({ ...base, productionId, orgId: p.orgId, state: "draft", createdBy: who, createdAt: now(), updatedAt: now() }).returning();
  await audit(productionId, who, "template.created", "template", t.id, null, t);
  return templateView(t);
}
export async function updateTemplate(who: string, productionId: number, id: number, b: Record<string, unknown>): Promise<LiveTemplate> {
  const [p] = await db.select({ orgId: productions.orgId }).from(productions).where(eq(productions.id, productionId)).limit(1);
  const [before] = await db.select().from(liveTemplates).where(eq(liveTemplates.id, id)).limit(1);
  // Starters (org 0) are MV's own and change only by a platform release, never from a production.
  if (!before || !p?.orgId || before.orgId !== p.orgId || (before.productionId && before.productionId !== productionId)) throw new Bad(404, "We couldn't find that template.");
  const set: Partial<LiveTemplateRow> = {};
  if (b.subject !== undefined) set.subject = str(b.subject, 200);
  if (b.text !== undefined) set.text = str(b.text, 8000);
  if (!Object.keys(set).length) return templateView(before);
  // A new version: back to draft, and the old approval no longer covers it.
  const [after] = await db.update(liveTemplates).set({ ...set, version: before.version + 1, state: "draft", approvedBy: "", approvedAt: "", updatedAt: now() }).where(eq(liveTemplates.id, id)).returning();
  await audit(productionId, who, "template.updated", "template", id, before, after);
  return templateView(after);
}

/* ── Routes ── */

const send = (res: Response, p: Promise<unknown>, code = 200) => p.then((v) => res.status(code).json(v)).catch((e: unknown) => {
  if (e instanceof ProgrammeError) return void res.status(e.code).json({ message: e.message });
  console.error("LIVE programme route failed:", (e as Error).message);
  res.status(500).json({ message: "Something went wrong. Try again." });
});
const L = (req: Request) => req as LiveReq;
const body = (req: Request) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
const n = (v: unknown) => Number(v) || 0;

export function registerProgramme(app: Express): void {
  const EDIT: LiveRole[] = ["mv_producer", "mv_coordinator"];
  const WORDS: LiveRole[] = ["mv_producer", "mv_coordinator", "mv_editor"];
  const MV: LiveRole[] = ["mv_producer", "mv_coordinator", "mv_editor"];
  const P = "/api/production/productions/:id";
  const who = (req: Request) => L(req).live.email, pid = (req: Request) => L(req).productionId!, role = (req: Request) => L(req).liveRole!;

  app.get(`${P}/stages/:stageId/run-of-show`, ...requireProductionRole(), (req, res) => send(res, runOfShow(pid(req), n(req.params.stageId), role(req))));

  app.post(`${P}/sessions`, ...requireProductionRole(...EDIT), (req, res) => send(res, createSession(who(req), pid(req), role(req), body(req)), 201));
  app.patch(`${P}/sessions/:sessionId`, ...requireProductionRole(...EDIT), (req, res) => send(res, updateSession(who(req), pid(req), role(req), n(req.params.sessionId), body(req))));
  app.delete(`${P}/sessions/:sessionId`, ...requireProductionRole(...EDIT), (req, res) => send(res, removeSession(who(req), pid(req), n(req.params.sessionId))));

  app.get(`${P}/speakers`, ...requireProductionRole(), (req, res) => send(res, listSpeakers(pid(req), role(req))));
  app.post(`${P}/speakers`, ...requireProductionRole(...EDIT), (req, res) => send(res, createSpeaker(who(req), pid(req), role(req), body(req)), 201));
  app.patch(`${P}/speakers/:speakerId`, ...requireProductionRole(...EDIT), (req, res) => send(res, updateSpeaker(who(req), pid(req), role(req), n(req.params.speakerId), body(req))));
  app.delete(`${P}/speakers/:speakerId`, ...requireProductionRole(...EDIT), (req, res) => send(res, removeSpeaker(who(req), pid(req), n(req.params.speakerId))));

  app.get(`${P}/scripts`, ...requireProductionRole(), (req, res) => send(res, listScripts(pid(req), role(req), n(req.query.sessionId))));
  app.post(`${P}/scripts`, ...requireProductionRole(...WORDS), (req, res) => send(res, createScript(who(req), pid(req), body(req)), 201));
  app.patch(`${P}/scripts/:scriptId`, ...requireProductionRole(...WORDS), (req, res) => send(res, updateScript(who(req), pid(req), n(req.params.scriptId), body(req))));

  app.get(`${P}/sponsors`, ...requireProductionRole(...MV), (req, res) => send(res, (async () =>
    (await db.select().from(liveSponsors).where(and(eq(liveSponsors.productionId, pid(req)), eq(liveSponsors.removed, false))).orderBy(liveSponsors.name)).map(sponsorView))()));
  app.post(`${P}/sponsors`, ...requireProductionRole(...EDIT), (req, res) => send(res, (async () => {
    const f = sponsorFields(body(req), true);
    const [s] = await db.insert(liveSponsors).values({ ...f, name: f.name!, productionId: pid(req), createdBy: who(req), createdAt: now(), updatedAt: now() }).returning();
    await audit(pid(req), who(req), "sponsor.created", "sponsor", s.id, null, s);
    return sponsorView(s);
  })(), 201));
  app.patch(`${P}/sponsors/:sponsorId`, ...requireProductionRole(...EDIT), (req, res) => send(res, (async () => {
    const [before] = await db.select().from(liveSponsors).where(and(eq(liveSponsors.id, n(req.params.sponsorId)), eq(liveSponsors.productionId, pid(req)), eq(liveSponsors.removed, false))).limit(1);
    if (!before) throw new Bad(404, "We couldn't find that sponsor.");
    const f = sponsorFields(body(req), false);
    if (!Object.keys(f).length) return sponsorView(before);
    const [after] = await db.update(liveSponsors).set({ ...f, updatedAt: now() }).where(eq(liveSponsors.id, before.id)).returning();
    await audit(pid(req), who(req), "sponsor.updated", "sponsor", before.id, before, after);
    return sponsorView(after);
  })()));
  app.delete(`${P}/sponsors/:sponsorId`, ...requireProductionRole(...EDIT), (req, res) => send(res, (async () => {
    const [before] = await db.select().from(liveSponsors).where(and(eq(liveSponsors.id, n(req.params.sponsorId)), eq(liveSponsors.productionId, pid(req)), eq(liveSponsors.removed, false))).limit(1);
    if (!before) throw new Bad(404, "We couldn't find that sponsor.");
    await db.update(liveSponsors).set({ removed: true, updatedAt: now() }).where(eq(liveSponsors.id, before.id));
    await audit(pid(req), who(req), "sponsor.removed", "sponsor", before.id, before, { removed: true });
    return { ok: true };
  })()));

  app.get(`${P}/templates`, ...requireProductionRole(...MV, "client_admin"), (req, res) => send(res, listTemplates(pid(req), role(req))));
  app.post(`${P}/templates`, ...requireProductionRole(...MV), (req, res) => send(res, createTemplate(who(req), pid(req), body(req)), 201));
  app.patch(`${P}/templates/:templateId`, ...requireProductionRole(...MV), (req, res) => send(res, updateTemplate(who(req), pid(req), n(req.params.templateId), body(req))));
}
