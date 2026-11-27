import { ALEX_EMAIL, CLIENT_CONTENT_SUBJECTS, CLIENT_ROLES, LIVE_TEST_REVIEWER, MV_ROLES, type Approval, type AuditEntry, type LiveRole, type LiveTemplate, type Production, type RunOfShow, type Script, type Session, type Speaker, TEMPLATE_KINDS, TEMPLATE_KIND_LABEL } from "@shared/live";
import type { AlexProposal, AlexState, Db } from "./api";

/**
 * Phase 2's half of the dev mock (?mock=admin|client|crew): sessions, speakers, scripts, templates, approvals and
 * Alex's queue for production 1, answered from memory. Only api.ts's mock calls it, and a production build drops both.
 * Sample people are invented; none is a real person.
 */

type Ros = Omit<RunOfShow, "sessions" | "stageName" | "timezone" | "productionId" | "stageId">;
export type Db2 = { sessions: Session[]; speakers: Speaker[]; scripts: Script[]; templates: LiveTemplate[]; ai: AlexProposal[]; ros: Record<number, Ros>; alex: AlexState };

const T = (day: string, hm: string) => new Date(`${day}T${hm}:00-05:00`).toISOString(); // July in Chicago: UTC-5
const NOW = () => new Date().toISOString();
const NOV26 = "2026-11-26T20:10:00.000Z";

function speaker(id: number, name: string, title: string, company: string, bio: string, say = ""): Speaker {
  return { id, productionId: 1, name, title, company, bio, photoUrl: "", cutoutUrl: "", links: [], pronunciationText: say, pronunciationAudioUrl: "", email: "", phone: "", version: 1, approval: "none", changedSinceApproval: false, sessionIds: [], createdAt: NOV26, updatedAt: NOV26 };
}

export function seedPhase2(): Db2 & { approvals: Approval[]; audit: AuditEntry[] } {
  const speakers = [
    speaker(301, "Dana Whitfield", "Executive Director", "Sample Veterans Alliance", "Dana leads the alliance's work with employers and opens each year's convention.", ""),
    speaker(302, "Marcus Bell", "Founder", "Sample Logistics Co.", "An Army veteran and founder of a veteran-owned logistics firm, Marcus speaks on turning service skills into a second career."),
    speaker(303, "Priya Natarajan", "Program Lead", "Sample Workforce Fund", "", "PREE-yah nah-tah-RAH-jun"),
    speaker(304, "Tom Okafor", "Head of Hiring", "Sample Health Network", "", "oh-KAH-for"),
    speaker(305, "Lee Ramos", "Career Coach", "", "Lee coaches transitioning service members through their first civilian job search."),
    speaker(306, "Jordan Hale", "", "", ""),
  ];
  speakers[0].approval = "approved";
  speakers[1].approval = "pending";
  speakers[1].changedSinceApproval = true;
  const day = "2027-07-25";
  let id = 400;
  const s = (stageId: number, d: string, a: string, b: string, title: string, kind: Session["kind"], people: [number, Session["people"][number]["role"]][], o: Partial<Session> = {}): Session => {
    const startsAt = T(d, a), endsAt = T(d, b);
    return {
      id: ++id, productionId: 1, stageId, startsAt, endsAt, durationMinutes: Math.ceil((+new Date(endsAt) - +new Date(startsAt)) / 60000), title, kind, status: "confirmed", sort: 0, mvOnly: false, notes: "",
      people: people.map(([sid, role]) => { const p = speakers.find((x) => x.id === sid)!; return { speakerId: sid, name: p.name, role, photoUrl: p.photoUrl, cutoutUrl: p.cutoutUrl }; }),
      scripts: [], version: 2, changedSinceApproval: false, createdAt: NOV26, updatedAt: NOV26, ...o,
    };
  };
  const sessions = [
    s(41, "2027-07-24", "16:00", "18:00", "Tech rehearsal", "other", [], { mvOnly: true, notes: "Full crew, cameras and the sponsor loop." }),
    s(41, day, "09:00", "09:15", "Doors and walk-in music", "other", []),
    s(41, day, "09:15", "09:30", "Opening remarks", "ceremony", [[301, "host"]], { changedSinceApproval: true, version: 3 }),
    s(41, day, "09:30", "10:15", "Keynote: Service after service", "keynote", [[302, "speaker"]]),
    s(41, day, "10:15", "10:30", "Break and sponsor read", "break", []),
    s(41, day, "10:30", "11:15", "Panel: Building a second career", "panel", [[303, "speaker"], [304, "speaker"], [305, "moderator"]], { changedSinceApproval: true, version: 3 }),
    s(41, day, "11:15", "12:00", "Fireside chat", "fireside", [[306, "speaker"]]),
    s(41, day, "12:00", "13:00", "Lunch", "break", []),
    s(41, day, "12:45", "13:00", "Stage reset", "other", [], { mvOnly: true, notes: "Swap the lectern for two chairs." }),
    s(41, day, "13:00", "13:45", "Workshop: Telling your story on air", "presentation", [[302, "speaker"]], { changedSinceApproval: true, version: 1, status: "draft" }),
    s(41, "2027-07-26", "09:00", "09:45", "Morning keynote", "keynote", [[305, "speaker"]], { status: "draft", version: 1, changedSinceApproval: true }),
    s(42, day, "10:00", "11:00", "Employer roundtable", "panel", [[304, "moderator"]], { version: 1 }),
  ];
  for (const x of sessions) for (const p of x.people) speakers.find((y) => y.id === p.speakerId)!.sessionIds.push(x.id);
  const sc = (sessionId: number, kind: Script["kind"], text: string, state: Script["state"], draftedBy = "alex"): Script =>
    ({ id: sessionId * 10, productionId: 1, sessionId, kind, sponsorId: kind === "sponsor_read" ? 701 : null, text, audioUrl: "", version: 1, state, draftedBy, createdAt: NOV26, updatedAt: NOV26 });
  const scripts = [
    sc(403, "intro", "Good morning, and welcome to the Exhibit Hall Stage. To open our day, please welcome Dana Whitfield, Executive Director of the Sample Veterans Alliance.", "draft"),
    sc(404, "intro", "Our keynote speaker served twenty years in the Army and then built a logistics company from one truck. Please welcome Marcus Bell.", "approved"),
    sc(405, "sponsor_read", "This break is brought to you by Sample Sponsor Co., proud to hire those who served.", "draft"),
  ];
  for (const x of scripts) sessions.find((y) => y.id === x.sessionId)!.scripts.push(x);
  const starter = (i: number, kind: LiveTemplate["kind"]): LiveTemplate => ({
    id: 800 + i, orgId: 0, productionId: null, kind, channel: kind === "call_time" ? "sms" : "email", subject: kind === "call_time" ? "" : TEMPLATE_KIND_LABEL[kind], text: "", version: 1, state: "approved", approvedBy: "", approvedAt: NOV26, sendable: false, starter: true, createdAt: NOV26, updatedAt: NOV26,
  });
  const templates: LiveTemplate[] = [
    { ...starter(20, "call_time"), id: 820, orgId: 501, productionId: 1, starter: false, subject: "", text: "Hi {{Speaker_Name}}, your call time for {{Session_Title}} on {{Stage}} is {{Call_Time}}. Reply here if anything changes.", state: "approved", approvedBy: "MV Admin", sendable: true },
    { ...starter(21, "reminder"), id: 821, orgId: 501, productionId: 1, starter: false, subject: "Your session at {{Production}}", text: "Hi {{Speaker_Name}}, a reminder that {{Session_Title}} is at {{Session_Time}} on {{Stage}}.", state: "pending", approvedBy: "", approvedAt: "", sendable: false },
    { ...starter(22, "missing_info"), id: 822, orgId: 501, productionId: 1, starter: false, subject: "A few details for {{Production}}", text: "Hi {{Speaker_Name}}, could you send a short bio and a headshot for {{Session_Title}}?", state: "draft", approvedBy: "", approvedAt: "", sendable: false },
    ...TEMPLATE_KINDS.map((k, i) => starter(i, k)),
  ];
  const ap = (aid: number, subjectType: string, subjectId: number, version: number, summary: string, approverRole: LiveRole, state: Approval["state"] = "pending", at = "2026-11-27T19:44:00.000Z", decidedBy = ""): Approval =>
    ({ id: aid, productionId: 1, subjectType, subjectId, version, summary, requestedBy: "producer@militaryvoices.ai", approverRole, state, decidedBy, decidedAt: decidedBy ? at : "", note: "", createdAt: at, mine: false });
  const approvals = [
    ap(901, "template", 821, 1, "\"Your session\" reminder · v1", "mv_admin", "pending", "2026-11-27T19:38:00.000Z"),
    ap(902, "go_no_go", 41, 1, "Go / no-go · Sat Jul 25 · Exhibit Hall Stage", "mv_admin", "pending", "2026-11-27T19:20:00.000Z"),
    ap(903, "run_of_show", 42, 1, "Sat Jul 25 · Main Hall · v1", "client_reviewer", "pending", "2026-11-27T18:10:00.000Z"),
    ap(904, "speaker", 302, 1, "Marcus Bell · bio, headshot, how to say it", "client_reviewer", "pending", NOV26),
    ap(905, "script", 4040, 1, "Keynote intro · 0:12 read", "client_reviewer", "pending", NOV26),
    ap(906, "run_of_show", 41, 2, "Sat Jul 25 · Exhibit Hall Stage · v2", "client_reviewer", "approved", NOV26, LIVE_TEST_REVIEWER),
    ap(907, "speaker", 301, 1, "Dana Whitfield · bio", "client_reviewer", "approved", NOV26, LIVE_TEST_REVIEWER),
  ];
  const al = (aid: number, kind: AlexProposal["kind"], subjectType: AlexProposal["subjectType"], subjectId: number, title: string, proposed: AlexProposal["proposed"], source: string, min: number): AlexProposal =>
    ({ id: aid, productionId: 1, kind, subjectType, subjectId, title, proposed, source, state: "proposed", createdAt: new Date(Date.parse("2026-11-27T20:02:00Z") - min * 60000).toISOString() });
  const ai = [
    al(1, "bio", "speaker", 302, "Marcus Bell · Keynote", { text: "An Army veteran and founder of a veteran-owned logistics firm, Marcus speaks on turning service skills into a second career, and hires veterans first." }, "From the guest brief: their site and LinkedIn", 0),
    al(2, "headshot", "speaker", 303, "Priya Natarajan · Panel", { photoUrl: "", cutoutUrl: "", pronunciationText: "PREE-yah nah-tah-RAH-jun" }, "From the guest brief: their organization's team page", 1),
    al(3, "intro", "script", 4030, "Opening remarks · 0:12 read", { text: scripts[0].text }, "Drafted when the session was made. Her voice is made only after this is approved.", 3),
    al(4, "bio", "speaker", 304, "Tom Okafor · Panel", { text: "A Marine Corps veteran who now leads hiring at a regional hospital network, Tom helps veterans turn their service record into a résumé." }, "From the guest brief: their LinkedIn", 9),
    al(5, "missing_info", "speaker", 306, "Jordan Hale · Fireside chat", { text: "No bio or photo, and the guest brief found nothing. Approve to ask them with the \"Missing information\" email." }, "Held until sending is switched on.", 362),
  ];
  const A = (aid: number, what: string, at: string, actor: "alex" | "person" = "alex", who = ALEX_EMAIL): AuditEntry =>
    ({ id: aid, productionId: 1, who, what, subjectType: "speaker", subjectId: null, before: null, after: null, at, actor, aiActionId: actor === "alex" ? aid : null });
  const audit = [
    A(60, "Drafted Marcus Bell's bio", "2026-11-27T20:02:00.000Z"),
    A(59, "Cut out Priya Natarajan's headshot", "2026-11-27T20:01:00.000Z"),
    A(58, "Moved Panel: Building a second career to 10:30", "2026-11-27T19:40:00.000Z", "person", "producer@militaryvoices.ai"),
    A(57, "Flagged Jordan Hale: no bio or photo", "2026-11-27T14:00:00.000Z"),
    A(56, "Approved the run of show v2 for Exhibit Hall Stage", NOV26, "person", LIVE_TEST_REVIEWER),
    A(55, "Sent the run of show v2 to the client", NOV26, "person", "producer@militaryvoices.ai"),
  ];
  return {
    sessions, speakers, scripts, templates, ai, approvals, audit,
    ros: {
      41: { version: 3, approvedVersion: 2, approvedAt: NOV26, state: "changes_pending", approvalId: 906, changes: { added: [410], changed: [403, 406], removed: [] } },
      42: { version: 1, approvedVersion: null, approvedAt: "", state: "in_review", approvalId: 903, changes: { added: [], changed: [], removed: [] } },
    },
    alex: { send: false, voice: false, held: 3, coordinatorAt: "8 am" },
  };
}

type Ctx = {
  d: Db; me: string; pid: number; v: Production; parts: string[]; qs: string; method: string; body: any;
  nf: () => never; deny: () => never; bad: (m: string) => never; log: (pid: number | null, what: string, subjectType: string, subjectId: number) => void; next: () => number;
};

const isClient = (r: LiveRole) => CLIENT_ROLES.includes(r);
const isMv = (r: LiveRole) => MV_ROLES.includes(r);

/** Whether I can decide this approval now, as the contract says (client content only by the client; never my own). */
export function mineFor(a: Approval, role: LiveRole, me: string) {
  if (a.state !== "pending" || a.requestedBy === me) return false;
  if ((CLIENT_CONTENT_SUBJECTS as readonly string[]).includes(a.subjectType)) return isClient(role) && role !== "client_viewer";
  return role === a.approverRole;
}

/** After a decision: an approved run of show becomes the console's version. */
export function afterDecide(d: Db, a: Approval) {
  if (a.subjectType === "run_of_show") {
    const r = d.ros[a.subjectId]; if (!r) return;
    if (a.state === "approved") {
      Object.assign(r, { approvedVersion: a.version, approvedAt: NOW(), state: "approved", changes: { added: [], changed: [], removed: [] } });
      for (const x of d.sessions) if (x.stageId === a.subjectId) x.changedSinceApproval = false;
    } else r.state = "changes_requested";
  }
  if (a.subjectType === "speaker") { const s = d.speakers.find((x) => x.id === a.subjectId); if (s) { s.approval = a.state; if (a.state === "approved") s.changedSinceApproval = false; } }
  if (a.subjectType === "script") { const s = d.scripts.find((x) => x.id === a.subjectId); if (s) s.state = a.state === "approved" ? "approved" : "changes_requested"; }
}

export function mockPhase2(c: Ctx): unknown {
  const { d, me, pid, v, parts, method, body, nf, deny, log } = c;
  const role = v.myRole;
  const sub = parts[2];
  const canEdit = isMv(role) && role !== "mv_editor";
  const forViewer = (x: Session): Session => (isMv(role) ? x : { ...x, notes: "", scripts: x.scripts.filter((y) => y.state === "in_review" || y.state === "approved") });
  const touch = (x: Session) => {
    const r = d.ros[x.stageId] ??= { version: 1, approvedVersion: null, approvedAt: "", state: "draft", approvalId: null, changes: { added: [], changed: [], removed: [] } };
    if (r.state === "approved" || r.state === "in_review") {
      if (r.state === "in_review") { const a = d.approvals.find((y) => y.id === r.approvalId); if (a) a.state = "withdrawn"; }
      r.version++; r.state = r.approvedVersion ? "changes_pending" : "draft";
    }
    x.version++; x.updatedAt = NOW();
    if (r.approvedVersion) { x.changedSinceApproval = true; if (!r.changes.added.includes(x.id) && !r.changes.changed.includes(x.id)) r.changes.changed.push(x.id); }
  };

  if (sub === "activity") { if (!v.can.audit) deny(); return d.audit.filter((a) => a.productionId === pid || a.productionId === null).slice(0, 200); }
  if (sub === "alex") { if (!isMv(role)) deny(); return d.alex; }
  if (sub === "approvals") {
    if (method === "GET") {
      if (CLIENT_ROLES.concat(MV_ROLES).indexOf(role) < 0) deny();
      return d.approvals.filter((a) => a.productionId === pid && (isMv(role) || (CLIENT_CONTENT_SUBJECTS as readonly string[]).includes(a.subjectType)))
        .map((a) => Object.assign(a, { mine: mineFor(a, role, me) }));
    }
    if (!canEdit) deny();
    const { subjectType, subjectId, version } = body ?? {};
    const client = (CLIENT_CONTENT_SUBJECTS as readonly string[]).includes(subjectType);
    const stage = d.stages.find((x) => x.id === subjectId);
    const summary = subjectType === "run_of_show" ? `${stage?.name ?? "Stage"} · run of show · v${version}`
      : subjectType === "speaker" ? `${d.speakers.find((x) => x.id === subjectId)?.name ?? "Speaker"} · bio, headshot, how to say it`
      : subjectType === "template" ? `${d.templates.find((x) => x.id === subjectId)?.subject || "Message"} · v${version}` : `${subjectType} · v${version}`;
    const a: Approval = { id: c.next(), productionId: pid, subjectType, subjectId, version, summary, requestedBy: me, approverRole: client ? "client_reviewer" : "mv_admin", state: "pending", decidedBy: "", decidedAt: "", note: "", createdAt: NOW(), mine: false };
    d.approvals.unshift(a);
    if (subjectType === "run_of_show" && d.ros[subjectId]) Object.assign(d.ros[subjectId], { state: "in_review", approvalId: a.id });
    if (subjectType === "speaker") { const s = d.speakers.find((x) => x.id === subjectId); if (s) s.approval = "pending"; }
    if (subjectType === "template") { const t = d.templates.find((x) => x.id === subjectId); if (t) t.state = "pending"; }
    log(pid, subjectType === "run_of_show" ? `Sent the run of show v${version} to the client` : `Asked for approval: ${summary}`, subjectType, subjectId);
    return a;
  }
  if (sub === "stages" && parts[4] === "run-of-show") {
    const stageId = Number(parts[3]);
    const stage = d.stages.find((x) => x.id === stageId && x.productionId === pid) ?? nf();
    const r = d.ros[stageId] ?? { version: 1, approvedVersion: null, approvedAt: "", state: "draft", approvalId: null, changes: { added: [], changed: [], removed: [] } };
    const sessions = d.sessions.filter((x) => x.stageId === stageId && (isMv(role) || role.startsWith("crew_") || !x.mvOnly))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.sort - b.sort).map(forViewer);
    return { productionId: pid, stageId, stageName: stage.name, timezone: v.timezone, ...r, sessions } satisfies RunOfShow;
  }
  if (sub === "sessions") {
    if (!canEdit) deny();
    const ppl = (list: { speakerId: number; role?: string }[] | undefined) => (list ?? []).map((p) => {
      const s = d.speakers.find((x) => x.id === p.speakerId) ?? nf();
      return { speakerId: s.id, name: s.name, role: (p.role ?? "speaker") as Session["people"][number]["role"], photoUrl: s.photoUrl, cutoutUrl: s.cutoutUrl };
    });
    if (method === "POST") {
      if (!body?.title?.trim()) c.bad("Give the session a title.");
      const x: Session = { id: c.next(), productionId: pid, stageId: body.stageId, startsAt: body.startsAt, endsAt: body.endsAt, durationMinutes: Math.ceil((Date.parse(body.endsAt) - Date.parse(body.startsAt)) / 60000), title: body.title.trim(), kind: body.kind ?? "other", status: body.status ?? "draft", sort: 0, mvOnly: !!body.mvOnly, notes: body.notes ?? "", people: ppl(body.people), scripts: [], version: 1, changedSinceApproval: false, createdAt: NOW(), updatedAt: NOW() };
      d.sessions.push(x);
      const r = d.ros[x.stageId]; touch(x);
      if (r?.approvedVersion) { r.changes.changed = r.changes.changed.filter((y) => y !== x.id); r.changes.added.push(x.id); }
      log(pid, `Added ${x.title}`, "session", x.id); return x;
    }
    const x = d.sessions.find((y) => y.id === Number(parts[3]) && y.productionId === pid) ?? nf();
    if (method === "DELETE") {
      d.sessions = d.sessions.filter((y) => y !== x);
      const r = d.ros[x.stageId]; if (r) { touch({ ...x }); r.changes.changed = r.changes.changed.filter((y) => y !== x.id); if (r.changes.added.includes(x.id)) r.changes.added = r.changes.added.filter((y) => y !== x.id); else if (r.approvedVersion) r.changes.removed.push({ id: x.id, title: x.title }); }
      log(pid, `Removed ${x.title}`, "session", x.id); return { ok: true };
    }
    const { people: pl, ...rest } = body ?? {};
    Object.assign(x, Object.fromEntries(Object.entries(rest).filter(([, y]) => y !== undefined)));
    if (pl) x.people = ppl(pl);
    x.durationMinutes = Math.ceil((Date.parse(x.endsAt) - Date.parse(x.startsAt)) / 60000);
    touch(x); log(pid, `Edited ${x.title}`, "session", x.id); return x;
  }
  if (sub === "speakers") {
    const hide = (s: Speaker): Speaker => (isMv(role) || role === "client_admin" ? s : { ...s, email: "", phone: "" });
    if (method === "GET") return [...d.speakers].filter((s) => s.productionId === pid).sort((a, b) => a.name.localeCompare(b.name)).map(hide);
    if (!canEdit) deny();
    if (method === "POST") { const s = speaker(c.next(), String(body?.name ?? "").trim(), body?.title ?? "", body?.company ?? "", body?.bio ?? ""); s.productionId = pid; d.speakers.push(s); log(pid, `Added speaker ${s.name}`, "speaker", s.id); return s; }
    const s = d.speakers.find((x) => x.id === Number(parts[3])) ?? nf();
    Object.assign(s, body, { version: s.version + 1, updatedAt: NOW(), changedSinceApproval: s.approval !== "none" });
    log(pid, `Edited ${s.name}`, "speaker", s.id); return s;
  }
  if (sub === "scripts") {
    if (method === "GET") return d.scripts.filter((x) => x.productionId === pid);
    if (!isMv(role)) deny();
    const x = d.scripts.find((y) => y.id === Number(parts[3])) ?? nf();
    Object.assign(x, { text: body?.text ?? x.text, version: x.version + 1, state: "draft", audioUrl: "", updatedAt: NOW() });
    log(pid, "Edited a script", "script", x.id); return x;
  }
  if (sub === "templates") {
    if (!isMv(role) && role !== "client_admin") deny();
    if (method === "GET") return d.templates.filter((t) => t.orgId === 0 || t.productionId === pid || t.productionId === null);
    if (!isMv(role)) deny();
    const t = d.templates.find((x) => x.id === Number(parts[3])) ?? nf();
    Object.assign(t, { ...body, version: t.version + 1, state: "draft", sendable: false, approvedBy: "", approvedAt: "", updatedAt: NOW() });
    log(pid, `Edited the ${TEMPLATE_KIND_LABEL[t.kind]} message`, "template", t.id); return t;
  }
  if (sub === "ai-actions") {
    if (!isMv(role)) deny();
    if (method === "GET") return d.ai.filter((x) => x.productionId === pid && x.state === "proposed");
    const x = d.ai.find((y) => y.id === Number(parts[3])) ?? nf();
    if (!canEdit && role !== "mv_editor") deny();
    x.state = body?.decision === "accept" ? "accepted" : "rejected";
    const text = body?.edited ?? x.proposed.text;
    if (x.state === "accepted") {
      const s = x.subjectType === "speaker" ? d.speakers.find((y) => y.id === x.subjectId) : null;
      if (s && x.kind === "bio") Object.assign(s, { bio: text, version: s.version + 1 });
      if (s && x.kind === "headshot") Object.assign(s, { photoUrl: x.proposed.photoUrl || s.photoUrl, cutoutUrl: x.proposed.cutoutUrl || s.cutoutUrl, pronunciationText: x.proposed.pronunciationText ?? s.pronunciationText });
      const sc = x.subjectType === "script" ? d.scripts.find((y) => y.id === x.subjectId) : null;
      if (sc) Object.assign(sc, { text, draftedBy: me });
    }
    log(pid, `${x.state === "accepted" ? (body?.edited ? "Edited and accepted" : "Accepted") : "Rejected"} Alex's ${x.kind.replace("_", " ")}: ${x.title}`, x.subjectType, x.subjectId);
    return x;
  }
  return nf();
}
