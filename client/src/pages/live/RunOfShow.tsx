import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { GripVertical, Plus, X } from "lucide-react";
import { useLive } from "./LiveApp";
import {
  notYet, SESSION_KIND_LABEL, SESSION_KINDS, useAddSession, useApprovals, useDeleteSession, usePatchSession, useRequestApproval, useRunOfShow, useSpeakers, useStages,
  type RunOfShow as Ros, type Session, type SessionInput, type SessionKind, type Speaker,
} from "./api";
import { Btn, C, Card, clockIn, dayIn, dayTab, daysBetween, Face, Field, FONT_COND, FONT_MONO, hmIn, Input, Pill, readTime, Select, Tabs, TextArea, zonedIso, type Tone } from "./ui";
import { Messages, Speakers } from "./Speakers";

/**
 * Run of Show (phase 2, the approved mockup of 27 Nov): a stage's day of sessions, the version the client approved,
 * and what changed since. MV edit, add and drag to move; crew read it. The console keeps the approved version.
 */
export default function RunOfShow({ view = "" }: { view?: string }) {
  const { current } = useLive();
  const canEdit = !!current?.can.edit;
  const views = [{ key: "", label: "Sessions" }, { key: "speakers", label: "Speakers" }, ...(current && current.myRole.startsWith("mv_") ? [{ key: "messages", label: "Messages" }] : [])];
  return (
    <div className="flex flex-col gap-3" data-testid="live-ros">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Run of show</h1>
        <nav className="flex gap-3 text-[14px] font-semibold" aria-label="Run of show">
          {views.map((v) => (
            <Link key={v.key} href={`/run-of-show${v.key ? `/${v.key}` : ""}`} className="border-b-2 pb-0.5" style={view === v.key ? { borderColor: C.gold, color: "#fff" } : { borderColor: "transparent", color: C.muted }}>{v.label}</Link>
          ))}
        </nav>
      </div>
      {!current ? <Card><p className="text-[13.5px]" style={{ color: C.muted }}>Pick a production first.</p></Card>
        : view === "speakers" ? <Speakers p={current} />
        : view === "messages" ? <Messages p={current} />
        : <Sessions pid={current.id} tz={current.timezone} startsOn={current.startsOn} endsOn={current.endsOn} canEdit={canEdit} />}
    </div>
  );
}

const STATE_CHIP: Record<Ros["state"], string> = { draft: "not sent", in_review: "with the client", approved: "approved", changes_requested: "changes asked", changes_pending: "not sent" };

function Sessions({ pid, tz, startsOn, endsOn, canEdit }: { pid: number; tz: string; startsOn: string; endsOn: string; canEdit: boolean }) {
  const stagesQ = useStages(pid);
  const stages = stagesQ.data ?? [];
  const [stagePick, setStage] = useState<number | null>(null);
  const stageId = stagePick && stages.some((s) => s.id === stagePick) ? stagePick : stages[0]?.id ?? null;
  const q = useRunOfShow(pid, stageId);
  const spk = useSpeakers(pid);
  const approvals = useApprovals(canEdit ? pid : null);
  const ros = q.data;
  const speakers = useMemo(() => new Map((spk.data ?? []).map((s) => [s.id, s])), [spk.data]);

  const days = useMemo(() => Array.from(new Set(daysBetween(startsOn, endsOn).concat((ros?.sessions ?? []).map((x) => dayIn(x.startsAt, tz))))).sort(), [startsOn, endsOn, ros, tz]);
  const [dayPick, setDay] = useState("");
  // Today when it's a show day, else the first day with something the client will see.
  const today = dayIn(new Date().toISOString(), tz);
  const firstBusy = (days.includes(today) ? today : undefined)
    ?? days.find((d) => ros?.sessions.some((x) => !x.mvOnly && dayIn(x.startsAt, tz) === d))
    ?? days.find((d) => ros?.sessions.some((x) => dayIn(x.startsAt, tz) === d)) ?? days[0] ?? "";
  const day = days.includes(dayPick) ? dayPick : firstBusy;
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const send = useRequestApproval(pid);

  if (stagesQ.isLoading) return <Loading />;
  if (!stages.length) return <Card><p className="text-[13.5px]" style={{ color: C.muted }}>No stage yet. {canEdit && <Link href={`/events/${pid}`} className="font-semibold hover:underline" style={{ color: C.gold }}>Add a stage</Link>}</p></Card>;

  const all = (ros?.sessions ?? []).filter((x) => dayIn(x.startsAt, tz) === day);
  const changed = new Set([...(ros?.changes.added ?? []), ...(ros?.changes.changed ?? [])]);
  const rows = onlyChanges ? all.filter((x) => changed.has(x.id)) : all;
  const nChanges = ros ? ros.changes.added.length + ros.changes.changed.length + ros.changes.removed.length : 0;
  const sendable = !!ros && canEdit && ["draft", "changes_pending", "changes_requested"].includes(ros.state) && ros.sessions.some((x) => !x.mvOnly);
  const asked = ros?.state === "changes_requested" ? approvals.data?.find((a) => a.id === ros.approvalId) : undefined;
  const lastEnd = all.filter((x) => !x.mvOnly).at(-1)?.endsAt;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {stages.length > 1 && <Tabs items={stages.map((s) => ({ key: s.id, label: s.name }))} value={stageId!} onChange={(k) => { setStage(k); setEditing(null); }} testId="ros-stages" />}
        {days.length > 0 && <Tabs items={days.map((d) => ({ key: d, label: dayTab(d) }))} value={day} onChange={(k) => { setDay(k); setEditing(null); }} testId="ros-days" />}
        <div className="ml-auto flex items-center gap-2">
          {ros && <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: "rgba(240,192,80,.14)", color: "#f0c050" }} data-testid="ros-version">v{ros.version} · {STATE_CHIP[ros.state]}</span>}
          {canEdit && ros && <Btn onClick={() => setEditing("new")} data-testid="ros-add"><Plus className="h-4 w-4" aria-hidden />Add session</Btn>}
          {canEdit && ros && (
            <Btn primary disabled={!sendable || send.isPending} data-testid="ros-send"
              title={ros.state === "in_review" ? "It's with the client now." : ros.state === "approved" ? "Nothing has changed since the client approved it." : undefined}
              onClick={() => send.mutate({ subjectType: "run_of_show", subjectId: ros.stageId })}>
              {send.isPending ? "Sending…" : ros.state === "in_review" ? "With the client" : "Send to client"}
            </Btn>
          )}
        </div>
      </div>
      {send.error && <p className="text-[13px]" style={{ color: "#ff8a80" }}>{send.error.message}</p>}

      {ros && asked && (
        <Banner tone="bad"><b>The client asked for changes to v{asked.version}:</b> {asked.note || "no note"}</Banner>
      )}
      {ros && ros.approvedVersion && nChanges > 0 && (
        <Banner tone="warn" action={<button type="button" className="font-semibold hover:underline" style={{ color: C.gold }} onClick={() => setOnlyChanges(!onlyChanges)} data-testid="ros-see-changes">{onlyChanges ? "Show the whole day" : "See what changed"}</button>}>
          <b>{nChanges} change{nChanges === 1 ? "" : "s"} since the client approved v{ros.approvedVersion}:</b>{" "}
          {[
            ...ros.changes.changed.map((id) => ros.sessions.find((x) => x.id === id)?.title).filter(Boolean).map((t) => `${t} changed`),
            ...ros.changes.added.map((id) => ros.sessions.find((x) => x.id === id)?.title).filter(Boolean).map((t) => `${t} added`),
            ...ros.changes.removed.map((r) => `${r.title} removed`),
          ].join(" · ")}
        </Banner>
      )}

      {q.isLoading ? <Loading /> : notYet(q.error) ? (
        <Card><p className="text-[13.5px]" style={{ color: C.muted }}>The run of show opens here once it's switched on for this production.</p></Card>
      ) : q.error ? (
        <Card><p className="text-[13.5px]" style={{ color: "#ff8a80" }}>{q.error.message}</p></Card>
      ) : ros && (
        <section className="overflow-hidden rounded-lg border" style={{ background: C.card, borderColor: C.line }} data-testid="ros-table">
          <div className="hidden h-9 items-center gap-3 border-b px-3 text-[12px] font-semibold uppercase md:grid" style={{ ...GRID, borderColor: C.line, color: C.muted, fontFamily: FONT_COND, letterSpacing: ".08em" }}>
            <span /><span>Time</span><span>Session</span><span>Kind</span><span>Speakers</span><span>State</span><span />
          </div>
          {editing === "new" && (
            <SessionForm pid={pid} tz={tz} stageId={ros.stageId} day={day} days={days} speakers={spk.data ?? []} startAfter={lastEnd} onDone={() => setEditing(null)} />
          )}
          {rows.length ? (
            <Rows rows={rows} all={all} ros={ros} tz={tz} speakers={speakers} canEdit={canEdit} pid={pid} editing={editing} setEditing={setEditing}
              form={(x) => <SessionForm pid={pid} tz={tz} stageId={ros.stageId} day={day} days={days} speakers={spk.data ?? []} session={x} onDone={() => setEditing(null)} />} />
          ) : editing !== "new" && (
            <p className="px-3 py-4 text-[13.5px]" style={{ color: C.muted }}>{onlyChanges ? "No changes on this day." : `Nothing on ${day ? dayTab(day) : "this day"} yet.`}{canEdit && !onlyChanges && " Add the first session."}</p>
          )}
        </section>
      )}

      {ros && (
        <p className="flex items-start gap-2 text-[13px]" style={{ color: C.muted }} data-testid="ros-console-note">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ros.approvedVersion ? "#5fd08f" : "#7f90ab" }} aria-hidden />
          <span>
            {ros.approvedVersion
              ? <>The stage studio's console runs <b style={{ color: C.ink }}>v{ros.approvedVersion}</b>, the last version the client approved{ros.version > ros.approvedVersion ? `, until they approve v${ros.version}` : ""}.</>
              : "Nothing is approved yet, so the stage studio's console has no run of show from here."}
            {canEdit && " Drag ⠿ to move a session."}
          </span>
        </p>
      )}
    </>
  );
}

const GRID = { gridTemplateColumns: "18px 104px minmax(0,1fr) 110px minmax(150px,200px) 168px 52px" };

function Rows({ rows, all, ros, tz, speakers, canEdit, pid, editing, setEditing, form }: {
  rows: Session[]; all: Session[]; ros: Ros; tz: string; speakers: Map<number, Speaker>; canEdit: boolean; pid: number;
  editing: number | "new" | null; setEditing: (x: number | null) => void; form: (x: Session) => ReactNode;
}) {
  const patch = usePatchSession(pid);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [err, setErr] = useState("");

  // Drop A on B: A takes B's place, and the sessions between them close up, each keeping its length.
  const move = async (from: number, to: number) => {
    const list = all.filter((x) => !x.mvOnly);
    const a = list.findIndex((x) => x.id === from), b = list.findIndex((x) => x.id === to);
    if (a < 0 || b < 0 || a === b) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const order = [...list]; const [m] = order.splice(a, 1); order.splice(b, 0, m);
    let t = Date.parse(list[lo].startsAt);
    setErr("");
    try {
      for (const x of order.slice(lo, hi + 1)) {
        const len = Date.parse(x.endsAt) - Date.parse(x.startsAt);
        const startsAt = new Date(t).toISOString(), endsAt = new Date(t + len).toISOString();
        if (startsAt !== x.startsAt) await patch.mutateAsync({ sessionId: x.id, startsAt, endsAt });
        t += len;
      }
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      {err && <p className="border-b px-3 py-2 text-[13px]" style={{ borderColor: C.line, color: "#ff8a80" }}>{err}</p>}
      {rows.map((x) => {
        const [label, tone] = rowState(x, ros, speakers);
        const sub = subline(x);
        const dragOk = canEdit && !x.mvOnly;
        const people = x.people;
        return (
          <div key={x.id} className="border-b last:border-b-0" style={{ borderColor: C.line }}>
            <div
              draggable={dragOk}
              onDragStart={(e) => { setDrag(x.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={(e) => { if (drag && dragOk) { e.preventDefault(); setOver(x.id); } }}
              onDragLeave={() => setOver((o) => (o === x.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (drag) void move(drag, x.id); setDrag(null); setOver(null); }}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 md:grid md:min-h-[50px] md:py-1.5"
              style={{
                ...GRID,
                background: over === x.id ? "rgba(224,178,58,.10)" : tone === "warn" ? "rgba(240,192,80,.035)" : undefined,
                opacity: drag === x.id ? 0.5 : x.status === "cancelled" ? 0.6 : 1,
              }}
              data-testid={`ros-row-${x.id}`}
            >
              <span className="hidden md:block" style={{ color: "#5b6f8f", cursor: dragOk ? "grab" : "default" }} aria-hidden>{dragOk && <GripVertical className="h-4 w-4" />}</span>
              <span className="w-[92px] shrink-0 whitespace-nowrap text-[13.5px] tabular-nums md:w-auto" style={{ fontFamily: FONT_MONO }}>{clockIn(x.startsAt, tz)}–{clockIn(x.endsAt, tz)}</span>
              <div className="min-w-0 flex-1 basis-[calc(100%-110px)] md:basis-auto">
                <p className={`line-clamp-2 text-[14.5px] font-semibold leading-snug ${x.status === "cancelled" ? "line-through" : ""}`}>{x.title}</p>
                {sub && <p className="truncate text-[12.5px]" style={{ color: C.muted }}>{sub}</p>}
              </div>
              <span className="text-[13px] md:text-[13.5px]" style={{ color: C.muted }}>{SESSION_KIND_LABEL[x.kind]}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
                {people.length ? (
                  <>
                    <span className="flex shrink-0 -space-x-1">{people.slice(0, 3).map((p) => <Face key={p.speakerId} name={p.name} photoUrl={p.photoUrl} size={24} />)}</span>
                    <span className="truncate">{people[0].name}{people.length > 1 ? ` +${people.length - 1}` : ""}</span>
                  </>
                ) : <span style={{ color: C.muted }}>None</span>}
              </span>
              <span><Pill tone={tone}>{label}</Pill></span>
              <span className="ml-auto md:ml-0 md:text-right">
                {canEdit && <Btn small onClick={() => setEditing(editing === x.id ? null : x.id)} data-testid={`ros-edit-${x.id}`}>{editing === x.id ? "Close" : "Edit"}</Btn>}
              </span>
            </div>
            {editing === x.id && form(x)}
          </div>
        );
      })}
    </>
  );
}

/** What the State column says, most urgent first. */
function rowState(x: Session, ros: Ros, speakers: Map<number, Speaker>): [string, Tone] {
  if (x.status === "cancelled") return ["Cancelled", "muted"];
  if (x.mvOnly) return ["MV and crew only", "info"];
  if (x.scripts.some((s) => s.state === "draft" && s.draftedBy === "alex")) return ["✦ Alex draft", "alex"];
  if (x.people.some((p) => { const s = speakers.get(p.speakerId); return s && !s.bio && !s.photoUrl; })) return ["! No bio or photo", "bad"];
  if (ros.approvedVersion && ros.changes.added.includes(x.id)) return [`New since v${ros.approvedVersion}`, "warn"];
  if (ros.approvedVersion && x.changedSinceApproval) return [`Changed since v${ros.approvedVersion}`, "warn"];
  if (ros.state === "in_review") return ["With the client", "info"];
  if (ros.approvedVersion) return [`✓ Approved v${ros.approvedVersion}`, "ok"];
  return [x.status === "draft" ? "Draft" : "Not sent", "muted"];
}

const SCRIPT_WORD = { intro: "Intro", transition: "Transition", sponsor_read: "Sponsor read", outro: "Outro" } as const;
function subline(x: Session) {
  if (x.scripts.length) return x.scripts.map((s) => `${SCRIPT_WORD[s.kind]} by ${s.draftedBy === "alex" ? "Alex" : "MV"} · ${readTime(s.text)}`).join(" · ");
  if (x.mvOnly && x.notes) return x.notes.split("\n")[0];
  return "";
}

function Banner({ tone, children, action }: { tone: "warn" | "bad"; children: ReactNode; action?: ReactNode }) {
  const c = tone === "warn" ? "#f0c050" : "#ff8a80";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-[3px] px-3 py-2 text-[13.5px]" style={{ borderColor: c, background: tone === "warn" ? "rgba(240,192,80,.08)" : "rgba(255,120,110,.08)" }} data-testid={`ros-banner-${tone}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}

const Loading = () => <Card><p className="text-[13.5px]" style={{ color: C.muted }}>Loading…</p></Card>;

/* ------------------------------------------------------------------ add / edit a session */

function SessionForm({ pid, tz, stageId, day, days, speakers, session, startAfter, onDone }: {
  pid: number; tz: string; stageId: number; day: string; days: string[]; speakers: Speaker[]; session?: Session; startAfter?: string; onDone: () => void;
}) {
  const add = useAddSession(pid), patch = usePatchSession(pid), del = useDeleteSession(pid);
  const start0 = session ? hmIn(session.startsAt, tz) : startAfter ? hmIn(startAfter, tz) : "09:00";
  const end0 = session ? hmIn(session.endsAt, tz) : addMinutes(start0, 30);
  const [f, setF] = useState({
    title: session?.title ?? "", kind: (session?.kind ?? "presentation") as SessionKind, day: session ? dayIn(session.startsAt, tz) : day,
    start: start0, end: end0, status: session?.status ?? "draft", mvOnly: session?.mvOnly ?? false, notes: session?.notes ?? "",
    people: (session?.people ?? []).map((p) => ({ speakerId: p.speakerId, role: p.role })),
  });
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }));
  const busy = add.isPending || patch.isPending || del.isPending;
  const error = add.error ?? patch.error ?? del.error;
  const okTime = f.end > f.start;
  const ok = f.title.trim().length > 0 && okTime && !!f.day;
  const save = () => {
    const b: SessionInput = {
      title: f.title.trim(), kind: f.kind, status: f.status, mvOnly: f.mvOnly, notes: f.notes,
      startsAt: zonedIso(f.day, f.start, tz), endsAt: zonedIso(f.day, f.end, tz), people: f.people,
    };
    if (session) patch.mutate({ ...b, sessionId: session.id }, { onSuccess: onDone });
    else add.mutate({ ...b, stageId }, { onSuccess: onDone });
  };
  const left = speakers.filter((s) => !f.people.some((p) => p.speakerId === s.id));
  return (
    <form className="flex flex-col gap-3 border-b px-3 py-3" style={{ borderColor: C.line, background: C.head }} onSubmit={(e) => { e.preventDefault(); if (ok) save(); }} data-testid="ros-form">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_140px_140px_124px_124px_130px]">
        <div className="col-span-2 md:col-span-1"><Field label="Session"><Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Session title" autoFocus maxLength={160} /></Field></div>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => set("kind", e.target.value as SessionKind)}>{SESSION_KINDS.map((k) => <option key={k} value={k}>{SESSION_KIND_LABEL[k]}</option>)}</Select></Field>
        <Field label="Day"><Select value={f.day} onChange={(e) => set("day", e.target.value)}>{days.map((d) => <option key={d} value={d}>{dayTab(d)}</option>)}</Select></Field>
        <Field label="Starts"><Input type="time" value={f.start} onChange={(e) => { const len = minutes(f.end) - minutes(f.start); setF((x) => ({ ...x, start: e.target.value, end: addMinutes(e.target.value, Math.max(len, 5)) })); }} /></Field>
        <Field label="Ends"><Input type="time" value={f.end} onChange={(e) => set("end", e.target.value)} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => set("status", e.target.value as Session["status"])}><option value="draft">Draft</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></Select></Field>
      </div>
      <div>
        <p className="mb-1 text-[12px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>On stage</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {f.people.map((p, i) => {
            const s = speakers.find((x) => x.id === p.speakerId);
            return (
              <span key={p.speakerId} className="inline-flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-1.5 text-[13px]" style={{ borderColor: C.line }}>
                <Face name={s?.name ?? "?"} photoUrl={s?.photoUrl} size={22} />
                {s?.name ?? "Speaker"}
                <select value={p.role} onChange={(e) => set("people", f.people.map((y, j) => (j === i ? { ...y, role: e.target.value as typeof p.role } : y)))} className="bg-transparent text-[12.5px] outline-none" style={{ color: C.muted, colorScheme: "dark" }} aria-label={`${s?.name ?? "Speaker"}'s role`}>
                  {(["speaker", "moderator", "host", "performer"] as const).map((r) => <option key={r} value={r} style={{ background: C.bg }}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                </select>
                <button type="button" onClick={() => set("people", f.people.filter((_, j) => j !== i))} aria-label={`Take ${s?.name ?? "them"} off`} className="rounded-full p-0.5 hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
              </span>
            );
          })}
          {left.length > 0 && (
            <select value="" onChange={(e) => e.target.value && set("people", [...f.people, { speakerId: Number(e.target.value), role: "speaker" }])} className="h-8 rounded-full border bg-transparent px-2.5 text-[13px] outline-none" style={{ borderColor: C.line, color: C.muted, colorScheme: "dark" }} aria-label="Add a speaker" data-testid="ros-form-add-person">
              <option value="" style={{ background: C.bg }}>+ Add a speaker</option>
              {left.map((s) => <option key={s.id} value={s.id} style={{ background: C.bg }}>{s.name}</option>)}
            </select>
          )}
          <Link href="/run-of-show/speakers" className="text-[12.5px] font-semibold hover:underline" style={{ color: "#8db6f0" }}>New speaker</Link>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <Field label="MV notes (the client never sees these)"><TextArea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} /></Field>
        <label className="flex h-9 items-center gap-2 text-[13.5px]"><input type="checkbox" checked={f.mvOnly} onChange={(e) => set("mvOnly", e.target.checked)} className="h-4 w-4 accent-[#e0b23a]" />MV and crew only</label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn primary type="submit" disabled={!ok || busy} data-testid="ros-form-save">{busy ? "Saving…" : session ? "Save" : "Add session"}</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
        {session && <Btn className="ml-auto" disabled={busy} onClick={() => { if (window.confirm(`Remove ${session.title}? It leaves the console at the next approval.`)) del.mutate(session.id, { onSuccess: onDone }); }}>Remove session</Btn>}
        <span className="basis-full text-[12.5px]" style={{ color: error ? "#ff8a80" : C.muted }}>
          {error?.message ?? (!okTime ? "It has to end after it starts." : session && !session.mvOnly ? "Saving a change means the client approves this day again." : "")}
        </span>
      </div>
    </form>
  );
}

const minutes = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const addMinutes = (hm: string, n: number) => { const t = Math.min(minutes(hm) + n, 23 * 60 + 59); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
