import type { ReactNode } from "react";
import { notYet, SESSION_KIND_LABEL, useApprovals, useRunOfShow, useSpeakers, useStages, type Approval, type Production, type RunOfShow, type Speaker, type Stage } from "./api";
import { Decide } from "./Approvals";
import { clockIn, dayIn, dayTab, Face, fmtDay, FONT_COND, readTime, SayIt } from "./ui";

/**
 * The client portal's "Run of show to approve" and "Speaker bios to approve" (phase 2, light). The server leaves out
 * MV-only sessions, Alex's drafts and MV notes for clients; we filter again so nothing internal can show here.
 */

const INK = "#0d1b2e", MUTED = "#4f5d72", LINE = "#dde3ec";

function Box({ title, right, children, testId }: { title: ReactNode; right?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="min-w-0 rounded-lg border bg-white p-3.5" style={{ borderColor: LINE }} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: MUTED }}>{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}
const Changed = ({ children = "Changed since you approved" }: { children?: ReactNode }) =>
  <span className="whitespace-nowrap rounded-full bg-[#fdf1d6] px-2 py-0.5 text-[11.5px] font-semibold text-[#8a5a00]">{children}</span>;
const Note = ({ children }: { children: ReactNode }) => <p className="text-[13.5px]" style={{ color: MUTED }}>{children}</p>;

export function PortalSchedule({ p }: { p: Production }) {
  const stages = useStages(p.id);
  const approvals = useApprovals(p.id);
  if (stages.isLoading) return <Box title="Run of show"><Note>Loading…</Note></Box>;
  if (!stages.data?.length) return <Box title="Run of show"><Note>Your stage is being set up. The run of show comes here for your OK.</Note></Box>;
  return <div className="flex flex-col gap-3">{stages.data.map((s) => <StageDay key={s.id} p={p} stage={s} approvals={approvals.data ?? []} />)}</div>;
}

function StageDay({ p, stage, approvals }: { p: Production; stage: Stage; approvals: Approval[] }) {
  const q = useRunOfShow(p.id, stage.id);
  const r = q.data;
  if (q.isLoading) return <Box title={stage.name}><Note>Loading…</Note></Box>;
  if (notYet(q.error) || !r) return <Box title={stage.name}><Note>{q.error && !notYet(q.error) ? q.error.message : "Your run of show comes here once the sessions are in."}</Note></Box>;
  const pending = approvals.find((a) => a.state === "pending" && a.subjectType === "run_of_show" && a.subjectId === stage.id);
  const sessions = r.sessions.filter((x) => !x.mvOnly);
  const days = Array.from(new Set(sessions.map((x) => dayIn(x.startsAt, r.timezone)))).sort();
  const changed = new Set([...r.changes.added, ...r.changes.changed]);
  const body = (buttons?: ReactNode, note?: ReactNode) => (
    <Box title={`Run of show to approve · ${stage.name}`} testId={`portal-ros-${stage.id}`} right={buttons}>
      {note && <div className="mb-2">{note}</div>}
      <p className="mb-2 text-[13.5px]" style={{ color: INK }} data-testid={`portal-ros-state-${stage.id}`}>{stateLine(r, pending)}</p>
      {r.changes.removed.length > 0 && r.approvedVersion && (
        <p className="mb-2 text-[13px]" style={{ color: MUTED }}>Taken out since you approved: {r.changes.removed.map((x) => x.title).join(", ")}.</p>
      )}
      {days.length ? days.map((d) => (
        <div key={d} className="mb-2 last:mb-0">
          <p className="border-b pb-1 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>{dayTab(d)}</p>
          {sessions.filter((x) => dayIn(x.startsAt, r.timezone) === d).map((x) => {
            const scripts = x.scripts.filter((s) => s.state === "in_review" || s.state === "approved");
            return (
              <div key={x.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b py-2 text-[13.5px] last:border-b-0" style={{ borderColor: LINE, background: r.approvedVersion && changed.has(x.id) ? "#fffaf0" : undefined }}>
                <span className="w-[92px] shrink-0 tabular-nums" style={{ color: MUTED }}>{clockIn(x.startsAt, r.timezone)}–{clockIn(x.endsAt, r.timezone)}</span>
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold ${x.status === "cancelled" ? "line-through" : ""}`}>{x.title} <span className="font-normal" style={{ color: MUTED }}>· {SESSION_KIND_LABEL[x.kind]}</span></p>
                  {x.people.length > 0 && <p className="text-[12.5px]" style={{ color: MUTED }}>{x.people.map((pp) => pp.name).join(", ")}</p>}
                  {scripts.map((s) => (
                    <details key={s.id} className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
                      <summary className="cursor-pointer font-semibold text-[#1f4f8f]">{s.kind === "sponsor_read" ? "Sponsor read" : s.kind[0].toUpperCase() + s.kind.slice(1)} · {readTime(s.text)}</summary>
                      <p className="mt-1 whitespace-pre-line" style={{ color: INK }}>{s.text}</p>
                    </details>
                  ))}
                </div>
                {r.approvedVersion && changed.has(x.id) && <Changed>{r.changes.added.includes(x.id) ? "New since you approved" : undefined}</Changed>}
              </div>
            );
          })}
        </div>
      )) : <Note>No sessions yet.</Note>}
    </Box>
  );
  return pending?.mine ? <Decide a={pending} light render={(b, n) => body(<div className="flex gap-2">{b}</div>, n)} /> : body();
}

function stateLine(r: RunOfShow, pending?: Approval) {
  const when = r.approvedAt ? ` on ${fmtDay(r.approvedAt.slice(0, 10))}` : "";
  if (pending) return pending.mine ? `Version ${pending.version} is waiting for your OK.` : `Version ${pending.version} is with your reviewer.`;
  if (r.state === "changes_requested") return "You asked for changes. The MilitaryVoices.ai team is on it and will send a new version.";
  if (r.state === "changes_pending") return `Changed since you approved version ${r.approvedVersion}. The MilitaryVoices.ai team sends the new version for your OK; until then the stage runs version ${r.approvedVersion}.`;
  if (r.state === "approved") return `You approved version ${r.approvedVersion}${when}.`;
  return "Being put together. It comes here for your OK.";
}

export function PortalSpeakers({ p }: { p: Production }) {
  const q = useSpeakers(p.id);
  const approvals = useApprovals(p.id);
  const list = q.data ?? [];
  if (q.isLoading) return <Box title="Speaker bios to approve"><Note>Loading…</Note></Box>;
  if (notYet(q.error) || !list.length) return <Box title="Speaker bios to approve"><Note>Speakers come here with their bios, photos and how to say their names, for your OK.</Note></Box>;
  const waiting = list.filter((s) => approvals.data?.some((a) => a.mine && a.subjectType === "speaker" && a.subjectId === s.id)).length;
  return (
    <Box title="Speaker bios to approve" right={<span className="text-[13px]" style={{ color: MUTED }}>{waiting ? `${waiting} waiting for your OK` : "Nothing waiting for you"}</span>} testId="portal-speakers">
      <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
        {list.map((s) => <SpeakerRow key={s.id} s={s} a={approvals.data?.find((a) => a.state === "pending" && a.subjectType === "speaker" && a.subjectId === s.id)} />)}
      </div>
    </Box>
  );
}

function SpeakerRow({ s, a }: { s: Speaker; a?: Approval }) {
  const status = a?.mine ? null
    : a ? <span className="text-[12.5px] font-semibold" style={{ color: MUTED }}>With your reviewer</span>
    : s.approval === "approved" && s.changedSinceApproval ? <Changed />
    : s.approval === "approved" ? <span className="text-[12.5px] font-semibold text-[#1d7a46]">✓ You approved</span>
    : s.approval === "changes_requested" ? <span className="text-[12.5px] font-semibold" style={{ color: MUTED }}>You asked for changes</span>
    : null;
  return (
    <div className="flex gap-3 border-b py-3 md:[&:nth-last-child(-n+2)]:border-b-0" style={{ borderColor: LINE }} data-testid={`portal-speaker-${s.id}`}>
      <Face name={s.name} photoUrl={s.cutoutUrl || s.photoUrl} size={48} ring="#fff" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 truncate text-[15px] font-semibold">{s.name}</p>
          {status}
        </div>
        {(s.title || s.company) && <p className="text-[12.5px]" style={{ color: MUTED }}>{[s.title, s.company].filter(Boolean).join(", ")}</p>}
        <p className="mt-1 text-[13.5px] leading-snug" style={{ color: s.bio ? INK : MUTED }}>{s.bio || "Bio on its way."}</p>
        <div className="mt-1"><SayIt text={s.pronunciationText} audioUrl={s.pronunciationAudioUrl} light /></div>
        {a?.mine && <Decide a={a} light render={(b, note) => <div className="mt-2 flex flex-col gap-2"><div className="flex gap-2">{b}</div>{note}</div>} />}
      </div>
    </div>
  );
}
