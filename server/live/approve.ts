// Military Voices LIVE, phase 2, Packet A step 2 (Podcasting, 27 Nov 2026): sending things to the client and what an
// approval does.
//
//  - Send for approval: a run of show (subject_id = stage id), a speaker (bio, photo, pronunciation) or a script, at
//    the version it is now. An older pending request for the same thing is withdrawn.
//  - Deciding something that changed after it was sent is refused (409): the client only ever approves what they saw.
//  - Approving a run of show freezes it (a versions row, subject run_of_show) and writes the stage studio's event
//    run_of_show rows from that frozen copy (sourceKey live-session-<id>, live-script-<id>), then the console's scene
//    rail follows (syncStageScenes). Later edits raise the stage's version; the rows stay on the approved copy until
//    the next approval.
//  - A script row carries its audio once that script is approved, has audio, and is still the version that was frozen.
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../storage.js";
import {
  approvals, liveScripts, liveSessionPeople, liveSessions, liveSpeakers, runOfShow, stages, studios, versions,
  type ApprovalRow, type LiveSessionRow,
} from "../../shared/schema.js";
import { type LiveRole, type ScriptKind, sessionMinutes } from "../../shared/live.js";
import { audit, now } from "./access.js";
import { ProgrammeError, type FrozenRunOfShow } from "./programme.js";
import { isLiveRow, syncStageScenes } from "../stageConsole.js";

const Bad = ProgrammeError;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const json = <T>(raw: string, fallback: T): T => { try { const v = JSON.parse(raw || ""); return (v ?? fallback) as T; } catch { return fallback; } };
const bySchedule = (a: { startsAt: string; sort: number; id: number }, b: { startsAt: string; sort: number; id: number }) => a.startsAt.localeCompare(b.startsAt) || a.sort - b.sort || a.id - b.id;

export const REVIEW_SUBJECTS = ["run_of_show", "speaker", "script"] as const;
type ReviewSubject = (typeof REVIEW_SUBJECTS)[number];
const WORDS_ONLY: LiveRole[] = ["mv_editor"]; // MV Editor may send scripts, nothing else

/* ── What's being sent, at its current version ── */

async function current(productionId: number, subjectType: ReviewSubject, subjectId: number): Promise<{ version: number; summary: string; stageId?: number }> {
  if (subjectType === "run_of_show") {
    const [s] = await db.select().from(stages).where(and(eq(stages.id, subjectId), eq(stages.productionId, productionId))).limit(1);
    if (!s) throw new Bad(404, "We couldn't find that stage.");
    return { version: s.rosVersion, summary: `Run of show: ${s.name}`, stageId: s.id };
  }
  if (subjectType === "speaker") {
    const [s] = await db.select().from(liveSpeakers).where(and(eq(liveSpeakers.id, subjectId), eq(liveSpeakers.productionId, productionId), eq(liveSpeakers.removed, false))).limit(1);
    if (!s) throw new Bad(404, "We couldn't find that speaker.");
    return { version: s.version, summary: `Speaker: ${s.name}` };
  }
  const [x] = await db.select().from(liveScripts).where(and(eq(liveScripts.id, subjectId), eq(liveScripts.productionId, productionId), ne(liveScripts.state, "removed"))).limit(1);
  if (!x) throw new Bad(404, "We couldn't find that script.");
  const [s] = await db.select({ title: liveSessions.title }).from(liveSessions).where(eq(liveSessions.id, x.sessionId)).limit(1);
  return { version: x.version, summary: `${x.kind === "sponsor_read" ? "Sponsor read" : x.kind[0].toUpperCase() + x.kind.slice(1)}: ${s?.title ?? "a session"}` };
}

/** Check a request to send something to the client; withdraws an older pending one for the same thing. */
export async function reviewTarget(productionId: number, role: LiveRole, who: string, b: Record<string, unknown>): Promise<{ subjectType: ReviewSubject; subjectId: number; version: number; summary: string; approverRole: LiveRole }> {
  const subjectType = String(b.subjectType ?? "") as ReviewSubject;
  if (!REVIEW_SUBJECTS.includes(subjectType)) throw new Bad(400, "Send a run of show, a speaker or a script.");
  if (WORDS_ONLY.includes(role) && subjectType !== "script") throw new Bad(403, "Your role on this production can't send that.");
  const approverRole: LiveRole = b.approverRole === "client_admin" ? "client_admin" : "client_reviewer";
  const subjectId = Number(b.subjectId) || 0;
  const cur = await current(productionId, subjectType, subjectId);
  if (subjectType === "run_of_show") {
    const live = await db.select({ id: liveSessions.id }).from(liveSessions).where(and(eq(liveSessions.stageId, subjectId), ne(liveSessions.status, "removed"), eq(liveSessions.mvOnly, false))).limit(1);
    if (!live.length) throw new Bad(400, "Add a session the client can see first.");
  }
  const older = await db.update(approvals).set({ state: "withdrawn", decidedBy: who, decidedAt: now(), note: "Sent again" })
    .where(and(eq(approvals.productionId, productionId), eq(approvals.subjectType, subjectType), eq(approvals.subjectId, subjectId), eq(approvals.state, "pending"))).returning();
  for (const o of older) await audit(productionId, who, "approval.withdrawn", o.subjectType, o.subjectId, { state: "pending" }, o);
  return { subjectType, subjectId, version: cur.version, summary: str(b.summary, 200) || cur.summary, approverRole };
}

/** After a request row is made: a script goes to the client (in_review). */
export async function afterRequest(a: ApprovalRow): Promise<void> {
  if (a.subjectType === "script") await db.update(liveScripts).set({ state: "in_review", updatedAt: now() }).where(and(eq(liveScripts.id, a.subjectId), eq(liveScripts.version, a.version)));
}

/** Before a decision: null when it can be decided, else why not (it changed after it was sent). */
export async function staleReason(a: ApprovalRow): Promise<string | null> {
  if (!(REVIEW_SUBJECTS as readonly string[]).includes(a.subjectType)) return null;
  const cur = await current(a.productionId, a.subjectType as ReviewSubject, a.subjectId).catch(() => null);
  if (!cur) return "That's been removed since it was sent.";
  return cur.version === a.version ? null : "This changed after it was sent to you. It comes back to you when it's sent again.";
}

/** After a decision (the approvals row is already updated). Never throws for the console: that's logged. */
export async function afterDecision(a: ApprovalRow, by: string): Promise<void> {
  if (a.subjectType === "script") {
    await db.update(liveScripts).set({ state: a.state === "approved" ? "approved" : "changes_requested", updatedAt: now() }).where(and(eq(liveScripts.id, a.subjectId), eq(liveScripts.version, a.version)));
    if (a.state === "approved") {
      const [x] = await db.select({ sessionId: liveScripts.sessionId }).from(liveScripts).where(eq(liveScripts.id, a.subjectId)).limit(1);
      const [s] = x ? await db.select({ stageId: liveSessions.stageId }).from(liveSessions).where(eq(liveSessions.id, x.sessionId)).limit(1) : [];
      if (s) await refreshConsole(a.productionId, s.stageId, by);
    }
    return;
  }
  if (a.subjectType === "run_of_show" && a.state === "approved") {
    await freezeRunOfShow(a.productionId, a.subjectId, a.version, by);
    await refreshConsole(a.productionId, a.subjectId, by);
  }
}

/* ── Freezing ── */

/** The stage's run of show as it stands, in the frozen shape (every session that isn't removed, MV-only included: the console needs them). */
export async function snapshot(stageId: number): Promise<FrozenRunOfShow> {
  const rows = (await db.select().from(liveSessions).where(and(eq(liveSessions.stageId, stageId), ne(liveSessions.status, "removed")))).sort(bySchedule);
  if (!rows.length) return { sessions: [] };
  const ids = rows.map((r) => r.id);
  const links = await db.select().from(liveSessionPeople).where(inArray(liveSessionPeople.sessionId, ids)).orderBy(liveSessionPeople.sort, liveSessionPeople.id);
  const sp = links.length ? await db.select().from(liveSpeakers).where(inArray(liveSpeakers.id, Array.from(new Set(links.map((l) => l.speakerId))))) : [];
  const byId = new Map(sp.filter((s) => !s.removed).map((s) => [s.id, s]));
  const scripts = await db.select().from(liveScripts).where(and(inArray(liveScripts.sessionId, ids), ne(liveScripts.state, "removed"))).orderBy(liveScripts.id);
  return {
    sessions: rows.map((s: LiveSessionRow) => ({
      id: s.id, version: s.version, title: s.title, kind: s.kind, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt, sort: s.sort, mvOnly: s.mvOnly,
      people: links.filter((l) => l.sessionId === s.id && byId.has(l.speakerId)).map((l) => ({ speakerId: l.speakerId, version: byId.get(l.speakerId)!.version, name: byId.get(l.speakerId)!.name, role: l.role })),
      scripts: scripts.filter((x) => x.sessionId === s.id).map((x) => ({ id: x.id, version: x.version, kind: x.kind as ScriptKind })),
    })),
  };
}

async function freezeRunOfShow(productionId: number, stageId: number, version: number, by: string): Promise<void> {
  const [had] = await db.select({ id: versions.id }).from(versions).where(and(eq(versions.subjectType, "run_of_show"), eq(versions.subjectId, stageId), eq(versions.version, version))).limit(1);
  if (had) return;
  const data = await snapshot(stageId);
  const [v] = await db.insert(versions).values({ productionId, subjectType: "run_of_show", subjectId: stageId, version, data: JSON.stringify(data), createdBy: by, createdAt: now() }).returning();
  await audit(productionId, by, "run_of_show.frozen", "run_of_show", stageId, null, { versionId: v.id, version, sessions: data.sessions.length });
}

/* ── The stage studio's run of show (what the console follows) ── */

type LiveRow = { sourceKey: string; kind: string; title: string; notes: string; startAtUtc: string; durationMinutes: number; mediaUrl: string; mediaKind: string; mediaLabel: string };
const SCRIPT_LABEL: Record<ScriptKind, string> = { intro: "Intro", transition: "Transition", sponsor_read: "Sponsor read", outro: "Outro" };
const SCRIPT_ROW_KIND: Record<ScriptKind, string> = { intro: "Intro", transition: "Handoff", sponsor_read: "Sponsor", outro: "Custom" };
const shift = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();

/** Pure: the console rows for a frozen run of show. Cancelled sessions are left out. Scripts sit just before their
 *  session (intro, transition, sponsor read) or just before it ends (outro); `audio` gives an approved script's audio
 *  when it's still the frozen version. */
export function liveRows(frozen: FrozenRunOfShow, audio: Map<number, { version: number; url: string }>): LiveRow[] {
  const out: LiveRow[] = [];
  for (const s of frozen.sessions) {
    const starts = s.startsAt ?? "", ends = s.endsAt ?? "";
    if (s.status === "cancelled" || !starts || !ends) continue;
    const names = (s.people ?? []).map((p) => p.name).filter(Boolean);
    out.push({
      sourceKey: `live-session-${s.id}`, kind: s.kind === "break" ? "Break" : "Segment", title: s.title,
      notes: names.length ? `With ${names.join(", ")}` : "", startAtUtc: starts, durationMinutes: sessionMinutes(starts, ends),
      mediaUrl: "", mediaKind: "video", mediaLabel: "",
    });
    s.scripts.forEach((x, i) => {
      const kind = (x.kind ?? "intro") as ScriptKind;
      const a = audio.get(x.id);
      const url = a && a.version === x.version ? a.url : "";
      out.push({
        sourceKey: `live-script-${x.id}`, kind: SCRIPT_ROW_KIND[kind] ?? "Custom", title: `${SCRIPT_LABEL[kind] ?? "Script"}: ${s.title}`, notes: "",
        startAtUtc: kind === "outro" ? shift(ends, -2 + i * 0.001) : shift(starts, -1 + i * 0.001), durationMinutes: 0,
        mediaUrl: url, mediaKind: "video", mediaLabel: url ? `Alex reads the ${(SCRIPT_LABEL[kind] ?? "script").toLowerCase()}` : "",
      });
    });
  }
  return out;
}

/** Write the stage studio's live rows from the last approved copy and let the scene rail follow. Rows someone edited
 *  by hand keep their wording and media and only take the new time. Other rows on the event are left alone. */
export async function refreshConsole(productionId: number, stageId: number, by: string): Promise<{ rows: number; studioId: number | null }> {
  const [st] = await db.select().from(stages).where(eq(stages.id, stageId)).limit(1);
  const [v] = await db.select().from(versions).where(and(eq(versions.subjectType, "run_of_show"), eq(versions.subjectId, stageId))).orderBy(versions.version).then((r) => r.slice(-1));
  if (!st || !v || !st.studioId) return { rows: 0, studioId: st?.studioId || null };
  const [studio] = await db.select({ id: studios.id, eventId: studios.eventId }).from(studios).where(eq(studios.id, st.studioId)).limit(1);
  if (!studio?.eventId) return { rows: 0, studioId: st.studioId };
  const frozen = json<FrozenRunOfShow>(v.data, { sessions: [] });
  const ids = frozen.sessions.flatMap((s) => s.scripts.map((x) => x.id));
  const sc = ids.length ? await db.select({ id: liveScripts.id, version: liveScripts.version, state: liveScripts.state, audioUrl: liveScripts.audioUrl }).from(liveScripts).where(inArray(liveScripts.id, ids)) : [];
  const audio = new Map(sc.filter((x) => x.state === "approved" && x.audioUrl).map((x) => [x.id, { version: x.version, url: x.audioUrl }]));
  const want = liveRows(frozen, audio);
  const existing = await db.select().from(runOfShow).where(eq(runOfShow.eventId, studio.eventId));
  const have = new Map(existing.filter(isLiveRow).map((r) => [r.sourceKey, r]));
  const t = now();
  for (const w of want) {
    const prev = have.get(w.sourceKey);
    if (!prev) { await db.insert(runOfShow).values({ eventId: studio.eventId, sortIndex: 0, ...w, edited: false, createdAt: t }); continue; }
    const patch = prev.edited ? { startAtUtc: w.startAtUtc } : { ...w };
    await db.update(runOfShow).set(patch).where(eq(runOfShow.id, prev.id));
  }
  const keep = new Set(want.map((w) => w.sourceKey));
  for (const r of Array.from(have.values())) if (!keep.has(r.sourceKey) && !r.edited) await db.delete(runOfShow).where(eq(runOfShow.id, r.id));
  // Re-sort the event like a rebuild does: timed rows by time, untimed after.
  const all = await db.select().from(runOfShow).where(eq(runOfShow.eventId, studio.eventId));
  all.sort((a, b) => (!a.startAtUtc || !b.startAtUtc) ? (a.startAtUtc ? -1 : b.startAtUtc ? 1 : a.sortIndex - b.sortIndex) : a.startAtUtc.localeCompare(b.startAtUtc) || a.sortIndex - b.sortIndex);
  for (let i = 0; i < all.length; i++) if (all[i].sortIndex !== i) await db.update(runOfShow).set({ sortIndex: i }).where(eq(runOfShow.id, all[i].id));
  let scenes: unknown = null;
  try { scenes = await syncStageScenes(studio.id); } catch (e) { console.error("LIVE console sync failed:", (e as Error).message); }
  await audit(productionId, by, "console.updated", "run_of_show", stageId, null, { version: v.version, studioId: studio.id, rows: want.length, scenes });
  return { rows: want.length, studioId: studio.id };
}
