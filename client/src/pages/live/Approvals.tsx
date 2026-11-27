import { useState } from "react";
import { useLive } from "./LiveApp";
import { ROLE_LABEL, sideOf, useApprovals, useDecide, type Approval } from "./api";
import { ApproveBtn, Btn, C, Card, Chips, FONT_COND, fmtWhen, Pill, Tabs, TextArea, type Tone } from "./ui";

/**
 * One inbox for everything waiting on an approval (phase 2, the approved mockup of 27 Nov): what's mine to decide,
 * what's with the client, and what's done. Buttons only on rows the server says are mine (`mine`).
 */

const TYPES: { key: string; label: string; tone: Tone; match: (t: string) => boolean }[] = [
  { key: "all", label: "All", tone: "muted", match: () => true },
  { key: "run_of_show", label: "Run of show", tone: "info", match: (t) => t === "run_of_show" || t === "session" },
  { key: "speaker", label: "Speakers", tone: "ok", match: (t) => t === "speaker" },
  { key: "script", label: "Scripts", tone: "alex", match: (t) => t === "script" },
  { key: "template", label: "Emails", tone: "warn", match: (t) => t === "template" },
  { key: "go_no_go", label: "Go / no-go", tone: "bad", match: (t) => t === "go_no_go" },
];
const typeOf = (t: string) => TYPES.slice(1).find((x) => x.match(t));
const TYPE_ONE: Record<string, string> = { run_of_show: "Run of show", session: "Run of show", speaker: "Speaker", script: "Script", template: "Email", go_no_go: "Go / no-go", asset: "Clip" };
const DONE: Record<Approval["state"], [string, Tone]> = { pending: ["Waiting", "warn"], approved: ["✓ Approved", "ok"], changes_requested: ["Changes asked", "bad"], withdrawn: ["Replaced", "muted"] };
/** "producer@" for our own people; the client's full address stays as it is. */
export const shortWho = (e: string) => (/@militaryvoices?\.ai$/i.test(e) ? e.replace(/@.*/, "@") : e);
const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type Tab = "mine" | "others" | "done";

export default function Approvals() {
  const { current } = useLive();
  const q = useApprovals(current?.id ?? null);
  const all = q.data ?? [];
  const [tab, setTab] = useState<Tab>("mine");
  const [type, setType] = useState("all");
  const groups: Record<Tab, Approval[]> = {
    mine: all.filter((a) => a.mine),
    others: all.filter((a) => a.state === "pending" && !a.mine),
    done: all.filter((a) => a.state !== "pending"),
  };
  const rows = groups[tab].filter((a) => TYPES.find((t) => t.key === type)!.match(a.subjectType));
  const empty = { mine: "Nothing is waiting for you.", others: "Nothing is with the client.", done: "Nothing decided yet." }[tab];
  return (
    <div className="flex flex-col gap-3" data-testid="live-approvals">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Approvals</h1>
        <Tabs<Tab> items={[
          { key: "mine", label: `Waiting for you · ${groups.mine.length}` },
          { key: "others", label: `Waiting for the client · ${groups.others.length}` },
          { key: "done", label: `Done · ${groups.done.length}` },
        ]} value={tab} onChange={setTab} testId="approvals-tabs" />
        <div className="md:ml-auto"><Chips items={TYPES.map((t) => ({ key: t.key, label: t.label }))} value={type} onChange={setType} /></div>
      </div>

      <section className="overflow-hidden rounded-lg border" style={{ background: C.card, borderColor: C.line }}>
        <div className="hidden h-9 items-center gap-3 border-b px-3 text-[12px] font-semibold uppercase md:grid" style={{ ...GRID, borderColor: C.line, color: C.muted, fontFamily: FONT_COND, letterSpacing: ".08em" }}>
          <span>Type</span><span>What</span><span>Asked by</span><span>When</span><span />
        </div>
        {rows.length ? rows.map((a) => <InboxRow key={a.id} a={a} />) : (
          <p className="px-3 py-4 text-[13.5px]" style={{ color: C.muted }}>{q.isLoading ? "Loading…" : q.error ? q.error.message : empty}</p>
        )}
      </section>

      <Card title="Who decides">
        {[
          ["Run of show, speakers and scripts", "MV reviews, then the client approves"],
          ["Emails", "MV approves the exact text, and the client too when it goes in their name"],
          ["Go / no-go", "MV"],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-x-3 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: C.line }}>
            <span>{k}</span><span style={{ color: C.muted }}>{v}</span>
          </div>
        ))}
      </Card>
      <p className="text-[13px]" style={{ color: C.muted }}>Nobody approves their own item, and Alex never approves. Editing an approved item sends it back here.</p>
    </div>
  );
}

const GRID = { gridTemplateColumns: "130px minmax(0,1fr) 150px 90px 290px" };

function InboxRow({ a }: { a: Approval }) {
  const t = typeOf(a.subjectType);
  const [label, tone] = DONE[a.state];
  const sub = a.state === "pending"
    ? `For ${sideOf(a.approverRole) === "client" ? "the client" : ROLE_LABEL[a.approverRole]}`
    : `${label.replace("✓ ", "")} by ${shortWho(a.decidedBy)}${a.note ? `: ${a.note}` : ""}`;
  return (
    <div className="border-b last:border-b-0" style={{ borderColor: C.line }} data-testid={`approval-${a.id}`}>
      <Decide a={a} render={(buttons, note) => (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 md:grid md:min-h-[54px]" style={GRID}>
            <span><Pill tone={t?.tone ?? "muted"}>{TYPE_ONE[a.subjectType] ?? a.subjectType}</Pill></span>
            <div className="min-w-0 basis-full md:basis-auto">
              <p className="truncate text-[14.5px] font-semibold">{a.summary}</p>
              <p className="truncate text-[12.5px]" style={{ color: C.muted }}>{sub}</p>
            </div>
            <span className="text-[13px]" style={{ color: C.muted }}>{shortWho(a.requestedBy)}</span>
            <span className="text-[13px]" style={{ color: C.muted }}>{when(a.decidedAt || a.createdAt)}</span>
            <span className="ml-auto flex justify-end gap-2 md:ml-0">{a.mine ? buttons : a.state !== "pending" && <Pill tone={tone}>{label}</Pill>}</span>
          </div>
          {note && <div className="px-3 pb-3 md:pl-[155px]">{note}</div>}
        </>
      )} />
    </div>
  );
}

/**
 * Approve / Request changes for one approval, with the note box opening in place (navy here, light in the portal).
 * `render` places the buttons and the note box.
 */
export function Decide({ a, light = false, render }: { a: Approval; light?: boolean; render: (buttons: React.ReactNode, note: React.ReactNode) => React.ReactNode }) {
  const act = useDecide();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const outline = light ? "inline-flex h-8 items-center whitespace-nowrap rounded-md border border-[#c9d3e2] bg-white px-3 text-[13px] font-semibold text-[#0d1b2e] hover:bg-[#f3f5f9] disabled:opacity-50" : "";
  const buttons = (
    <>
      <ApproveBtn disabled={act.isPending} onClick={() => act.mutate({ id: a.id, decision: "approved" })} data-testid={`approve-${a.id}`}>Approve</ApproveBtn>
      {light
        ? <button type="button" className={outline} disabled={act.isPending} onClick={() => setOpen(true)} data-testid={`changes-${a.id}`}>Request changes</button>
        : <Btn small className="!h-8 !px-3 !text-[13px]" disabled={act.isPending} onClick={() => setOpen(true)} data-testid={`changes-${a.id}`}>Request changes</Btn>}
    </>
  );
  const note = (open || act.error) && (
    <div className="flex flex-col gap-2">
      {open && (
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (text.trim()) act.mutate({ id: a.id, decision: "changes_requested", note: text.trim() }, { onSuccess: () => setOpen(false) }); }}>
          {light
            ? <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="What should change?" className="min-w-0 flex-1 rounded-md border border-[#c9d3e2] bg-white px-2.5 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#1f4f8f]/30" />
            : <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="What should change?" className="flex-1" />}
          <div className="flex gap-2">
            {light
              ? <button type="submit" disabled={!text.trim() || act.isPending} className="h-9 whitespace-nowrap rounded-md bg-[#0b2447] px-3.5 text-[13.5px] font-semibold text-white hover:bg-[#132e57] disabled:opacity-50">Send note</button>
              : <Btn primary type="submit" disabled={!text.trim() || act.isPending}>Send note</Btn>}
            {light ? <button type="button" className={`${outline} !h-9`} onClick={() => setOpen(false)}>Cancel</button> : <Btn onClick={() => setOpen(false)}>Cancel</Btn>}
          </div>
        </form>
      )}
      {act.error && <span className="text-[12.5px]" style={{ color: light ? "#b42318" : "#ff8a80" }}>{act.error.message}</span>}
    </div>
  );
  return <>{render(buttons, note)}</>;
}

/** The portal's light row (ClientPortal's Approvals tab). */
export function ApprovalRow({ a, light = false }: { a: Approval; light?: boolean }) {
  const [label] = DONE[a.state];
  const muted = light ? "#4f5d72" : C.muted;
  return (
    <div className={`border-b py-2 text-[13.5px] last:border-b-0 ${light ? "border-[#dde3ec]" : ""}`} style={light ? undefined : { borderColor: C.line }}>
      <Decide a={a} light={light} render={(buttons, note) => (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{a.summary}</p>
              <p className="truncate text-[12.5px]" style={{ color: muted }}>{TYPE_ONE[a.subjectType] ?? a.subjectType} · sent {fmtWhen(a.createdAt)}{a.note ? ` · your note: ${a.note}` : ""}</p>
            </div>
            {a.mine ? <div className="flex gap-2">{buttons}</div> : <span className="text-[12.5px] font-semibold" style={{ color: muted }}>{label}</span>}
          </div>
          {note && <div className="mt-2">{note}</div>}
        </>
      )} />
    </div>
  );
}
