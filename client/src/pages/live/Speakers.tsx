import { useState } from "react";
import { Plus } from "lucide-react";
import { notYet, TEMPLATE_KIND_LABEL, useAddSpeaker, usePatchSpeaker, usePatchTemplate, useRequestApproval, useSpeakers, useTemplates, type LiveTemplate, type Production, type Speaker } from "./api";
import { Btn, C, Card, Face, Field, FONT_COND, Input, Pill, SayIt, TextArea, type Tone } from "./ui";

/**
 * Speakers and Messages, under Run of Show (phase 2). Speakers: headshot, bio and how to say the name, each sent to
 * the client for approval. Messages: the templates Alex may send; only approved ones are marked sendable.
 */

const APPROVAL: Record<Speaker["approval"], [string, Tone]> = {
  none: ["Not sent", "muted"], pending: ["With the client", "info"], approved: ["✓ Approved", "ok"], changes_requested: ["Changes asked", "bad"], withdrawn: ["Not sent", "muted"],
};

export function Speakers({ p }: { p: Production }) {
  const q = useSpeakers(p.id);
  const canEdit = p.can.edit;
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const list = q.data ?? [];
  if (notYet(q.error)) return <Card><p className="text-[13.5px]" style={{ color: C.muted }}>Speakers open here once the run of show is switched on.</p></Card>;
  return (
    <div className="flex flex-col gap-3" data-testid="live-speakers">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13.5px]" style={{ color: C.muted }}>{q.isLoading ? "Loading…" : `${list.length} speaker${list.length === 1 ? "" : "s"}. Alex fills in what she can from each guest brief; nothing she finds is used until MV accepts it.`}</p>
        {canEdit && <Btn className="ml-auto" onClick={() => setEditing("new")} data-testid="speakers-add"><Plus className="h-4 w-4" aria-hidden />Add speaker</Btn>}
      </div>
      {editing === "new" && <Card><SpeakerForm pid={p.id} onDone={() => setEditing(null)} /></Card>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {list.map((s) => (
          <Card key={s.id} testId={`speaker-${s.id}`}>
            {editing === s.id ? <SpeakerForm pid={p.id} s={s} onDone={() => setEditing(null)} /> : <SpeakerCard p={p} s={s} onEdit={canEdit ? () => setEditing(s.id) : undefined} />}
          </Card>
        ))}
      </div>
    </div>
  );
}

function SpeakerCard({ p, s, onEdit }: { p: Production; s: Speaker; onEdit?: () => void }) {
  const send = useRequestApproval(p.id);
  const [label, tone] = s.changedSinceApproval && s.approval === "approved" ? ["Changed since approved", "warn" as Tone] : APPROVAL[s.approval];
  const canSend = !!onEdit && s.approval !== "pending" && (s.approval !== "approved" || s.changedSinceApproval) && !!s.bio;
  const missing = [!s.bio && "bio", !s.photoUrl && "headshot"].filter(Boolean).join(" and ");
  return (
    <div className="flex gap-3">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <Face name={s.name} photoUrl={s.cutoutUrl || s.photoUrl} size={56} />
        {s.cutoutUrl && <span className="text-[11px]" style={{ color: C.muted }}>Cutout</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 truncate text-[15px] font-semibold">{s.name}</p>
          <Pill tone={tone}>{label}</Pill>
        </div>
        {(s.title || s.company) && <p className="truncate text-[12.5px]" style={{ color: C.muted }}>{[s.title, s.company].filter(Boolean).join(", ")}</p>}
        <p className="mt-1 line-clamp-3 text-[13.5px] leading-snug" style={{ color: s.bio ? C.ink : C.muted }}>{s.bio || `No bio yet.`}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SayIt text={s.pronunciationText} audioUrl={s.pronunciationAudioUrl} />
          {missing && <span className="text-[12.5px]" style={{ color: "#ff8a80" }}>Needs a {missing}</span>}
          <span className="text-[12.5px]" style={{ color: C.muted }}>{s.sessionIds.length ? `On ${s.sessionIds.length} session${s.sessionIds.length === 1 ? "" : "s"}` : "On no session yet"}</span>
        </div>
        {onEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn small onClick={onEdit} data-testid={`speaker-edit-${s.id}`}>Edit</Btn>
            {canSend && <Btn small disabled={send.isPending} onClick={() => send.mutate({ subjectType: "speaker", subjectId: s.id, version: s.version })} data-testid={`speaker-send-${s.id}`}>{send.isPending ? "Sending…" : "Send to client"}</Btn>}
            {send.error && <span className="text-[12.5px]" style={{ color: "#ff8a80" }}>{send.error.message}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function SpeakerForm({ pid, s, onDone }: { pid: number; s?: Speaker; onDone: () => void }) {
  const add = useAddSpeaker(pid), patch = usePatchSpeaker(pid);
  const [f, setF] = useState({ name: s?.name ?? "", title: s?.title ?? "", company: s?.company ?? "", bio: s?.bio ?? "", photoUrl: s?.photoUrl ?? "", pronunciationText: s?.pronunciationText ?? "", email: s?.email ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const busy = add.isPending || patch.isPending;
  const err = add.error ?? patch.error;
  const urlOk = !f.photoUrl || /^https:\/\//.test(f.photoUrl);
  const ok = f.name.trim().length >= 2 && urlOk;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (!ok) return; const b = { ...f, name: f.name.trim() }; if (s) patch.mutate({ ...b, speakerId: s.id }, { onSuccess: onDone }); else add.mutate(b, { onSuccess: onDone }); }} data-testid="speaker-form">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Name"><Input value={f.name} onChange={set("name")} placeholder="Speaker's name" autoFocus maxLength={120} /></Field>
        <Field label="Job title"><Input value={f.title} onChange={set("title")} placeholder="Their job title" /></Field>
        <Field label="Organization"><Input value={f.company} onChange={set("company")} placeholder="Where they work" /></Field>
      </div>
      <Field label="Bio"><TextArea rows={3} value={f.bio} onChange={set("bio")} maxLength={4000} placeholder="Two or three sentences, as the host would read them" /></Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Headshot link"><Input value={f.photoUrl} onChange={set("photoUrl")} placeholder="https://" /></Field>
        <Field label="How to say the name"><Input value={f.pronunciationText} onChange={set("pronunciationText")} placeholder="Sounded out, stress in capitals" /></Field>
        <Field label="Email (MV only)"><Input type="email" value={f.email} onChange={set("email")} placeholder="Their email" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn primary type="submit" disabled={!ok || busy}>{busy ? "Saving…" : s ? "Save" : "Add speaker"}</Btn>
        <Btn onClick={onDone}>Cancel</Btn>
        <span className="text-[12.5px]" style={{ color: err || !urlOk ? "#ff8a80" : C.muted }}>{err?.message ?? (!urlOk ? "Headshot links start with https://." : s && s.approval !== "none" ? "Saving a change means the client approves this speaker again." : "")}</span>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ messages (templates) */

const TSTATE: Record<LiveTemplate["state"], [string, Tone]> = {
  draft: ["Draft", "muted"], pending: ["Waiting for approval", "info"], approved: ["Approved", "ok"], changes_requested: ["Changes asked", "bad"], retired: ["Replaced", "muted"],
};

export function Messages({ p }: { p: Production }) {
  const q = useTemplates(p.id);
  const all = q.data ?? [];
  const own = all.filter((t) => !t.starter && t.state !== "retired");
  const starters = all.filter((t) => t.starter);
  if (notYet(q.error)) return <Card><p className="text-[13.5px]" style={{ color: C.muted }}>Messages open here once the run of show is switched on.</p></Card>;
  return (
    <div className="flex flex-col gap-3" data-testid="live-messages">
      <p className="text-[13.5px]" style={{ color: C.muted }}>Alex sends only approved messages, and nothing goes out while sending is switched off. Each one is approved for its exact text.</p>
      <Card title={`For ${p.org?.name ?? "this client"}`}>
        {own.length ? own.map((t) => <TemplateRow key={t.id} p={p} t={t} />) : <p className="text-[13.5px]" style={{ color: C.muted }}>{q.isLoading ? "Loading…" : "None yet. They start from MV's blank starters below."}</p>}
      </Card>
      {starters.length > 0 && (
        <Card title="MV's blank starters">
          <p className="text-[13px]" style={{ color: C.muted }}>{starters.map((t) => TEMPLATE_KIND_LABEL[t.kind]).join(" · ")}</p>
        </Card>
      )}
    </div>
  );
}

function TemplateRow({ p, t }: { p: Production; t: LiveTemplate }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: t.subject, text: t.text });
  const patch = usePatchTemplate(p.id);
  const send = useRequestApproval(p.id);
  const [label, tone] = TSTATE[t.state];
  const mv = p.myRole.startsWith("mv_");
  return (
    <div className="border-b py-2 last:border-b-0" style={{ borderColor: C.line }} data-testid={`template-${t.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{TEMPLATE_KIND_LABEL[t.kind]} <span className="font-normal" style={{ color: C.muted }}>· {t.channel === "sms" ? "Text" : "Email"} · v{t.version}</span></p>
          <p className="truncate text-[12.5px]" style={{ color: C.muted }}>{t.subject || t.text || "Empty"}</p>
        </div>
        {t.sendable && <Pill tone="ok">✓ Sendable</Pill>}
        {!t.sendable && <Pill tone={tone}>{label}</Pill>}
        {mv && <Btn small onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</Btn>}
        {mv && (t.state === "draft" || t.state === "changes_requested") && t.text && (
          <Btn small disabled={send.isPending} onClick={() => send.mutate({ subjectType: "template", subjectId: t.id, version: t.version })}>{send.isPending ? "Sending…" : "Send for approval"}</Btn>
        )}
      </div>
      {open && (
        <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); patch.mutate({ templateId: t.id, ...f }, { onSuccess: () => setOpen(false) }); }}>
          {t.channel === "email" && <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>}
          <Field label="Text"><TextArea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
          <p className="text-[12px]" style={{ color: C.muted }}>Fill-ins: {"{{Speaker_Name}} {{Session_Title}} {{Session_Time}} {{Stage}} {{Production}} {{Call_Time}}"}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Btn primary type="submit" disabled={patch.isPending}>{patch.isPending ? "Saving…" : "Save"}</Btn>
            <span className="text-[12.5px]" style={{ color: patch.error ? "#ff8a80" : C.muted }}>{patch.error?.message ?? (t.state === "approved" ? "Saving makes it a draft again: it needs a new approval before Alex can send it." : "")}</span>
          </div>
        </form>
      )}
      {send.error && <p className="mt-1 text-[12.5px]" style={{ color: "#ff8a80" }}>{send.error.message}</p>}
    </div>
  );
}
