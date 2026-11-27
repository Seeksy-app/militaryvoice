import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useLive } from "./LiveApp";
import { canManageAlex, notYet, useActivity, useAlexQueue, useAlexState, useDecideAlex, useMembers, type AlexKind, type AlexProposal, type AuditEntry } from "./api";
import { shortWho } from "./Approvals";
import { ApproveBtn, Btn, C, Card, Chips, FONT_COND, LinkBtn, Pill, SayIt, TextArea, type Tone } from "./ui";

/**
 * Alex (phase 2, the approved mockup of 27 Nov): what she has drafted, waiting for MV to approve, edit or reject;
 * her jobs on this production; and the activity timeline with people and Alex side by side. Nothing she drafts is
 * used until a person approves it, and she never approves anything herself.
 */

const KIND: Record<AlexKind, [string, Tone]> = {
  bio: ["Bio", "alex"], headshot: ["Headshot", "alex"], pronunciation: ["How to say it", "alex"], intro: ["Intro", "alex"], sponsor_read: ["Sponsor read", "alex"], missing_info: ["Missing info", "bad"],
};
type Filter = "all" | "bio" | "headshot" | "intro" | "missing_info";
const inFilter = (f: Filter, k: AlexKind) => f === "all" || k === f || (f === "headshot" && k === "pronunciation") || (f === "intro" && k === "sponsor_read");

export default function Alex() {
  const { current } = useLive();
  const pid = current?.id ?? null;
  const q = useAlexQueue(pid);
  const [f, setF] = useState<Filter>("all");
  const list = q.data ?? [];
  const n = (x: Filter) => list.filter((a) => inFilter(x, a.kind)).length;
  const rows = list.filter((a) => inFilter(f, a.kind));
  return (
    <div className="flex flex-col gap-3" data-testid="live-alex">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Alex's drafts</h1>
        <Chips<Filter> items={[
          { key: "all", label: "All", n: n("all") }, { key: "bio", label: "Bios", n: n("bio") }, { key: "headshot", label: "Headshots", n: n("headshot") },
          { key: "intro", label: "Intros", n: n("intro") }, { key: "missing_info", label: "Missing info", n: n("missing_info") },
        ]} value={f} onChange={setF} />
        <p className="text-[13px] lg:ml-auto" style={{ color: C.muted }}>Nothing she drafts is used until you approve it.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section className="overflow-hidden rounded-lg border" style={{ background: C.card, borderColor: C.line }} data-testid="alex-queue">
          {rows.length ? rows.map((a) => <Proposal key={a.id} a={a} pid={pid!} />) : (
            <p className="px-3.5 py-4 text-[13.5px]" style={{ color: C.muted }}>
              {q.isLoading ? "Loading…" : notYet(q.error) ? "Alex's drafts show here once her phase 2 jobs are switched on." : q.error ? q.error.message : f === "all" ? "Nothing waiting. When a speaker or session is added, Alex drafts what's missing and it shows here." : "Nothing of this kind is waiting."}
            </p>
          )}
        </section>
        <div className="flex flex-col gap-3">
          <Jobs />
          <Activity />
        </div>
      </div>
    </div>
  );
}

function Proposal({ a, pid }: { a: AlexProposal; pid: number }) {
  const act = useDecideAlex(pid);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.proposed.text ?? a.proposed.pronunciationText ?? "");
  const [label, tone] = KIND[a.kind];
  const editable = a.kind !== "missing_info" && a.kind !== "headshot";
  const decide = (decision: "accept" | "reject", edited?: string) => act.mutate({ actionId: a.id, decision, ...(edited !== undefined ? { edited } : {}) });
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-b px-3.5 py-3 last:border-b-0 md:flex-nowrap" style={{ borderColor: C.line }} data-testid={`alex-${a.id}`}>
      <span className="w-[104px] shrink-0"><Pill tone={tone}>{label}</Pill></span>
      <div className="min-w-0 flex-1 basis-full md:basis-auto">
        {a.kind === "headshot" ? (
          <>
            <p className="text-[14.5px] font-semibold">{a.title}</p>
            <div className="mt-1.5 flex items-center gap-2.5">
              <Thumb url={a.proposed.photoUrl} word="Photo" />
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: C.muted }} aria-hidden />
              <Thumb url={a.proposed.cutoutUrl} word="Cutout" checker />
            </div>
            <div className="mt-1.5"><SayIt text={a.proposed.pronunciationText ?? ""} audioUrl={a.proposed.pronunciationAudioUrl} /></div>
          </>
        ) : (
          <>
            <p className="text-[14.5px] font-semibold">{a.title}</p>
            {editing ? (
              <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus className="mt-1" />
            ) : (
              <p className="mt-0.5 text-[13.5px] leading-snug">{a.kind === "intro" || a.kind === "sponsor_read" ? `"${a.proposed.text}"` : a.proposed.text}</p>
            )}
          </>
        )}
        {a.source && <p className="mt-1 text-[12.5px]" style={{ color: C.muted }}>{a.source}</p>}
        {act.error && <p className="mt-1 text-[12.5px]" style={{ color: "#ff8a80" }}>{act.error.message}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-start gap-2">
        {editing ? (
          <>
            <ApproveBtn disabled={act.isPending || !text.trim()} onClick={() => decide("accept", text.trim())}>Save and approve</ApproveBtn>
            <Btn small className="!h-8" onClick={() => { setEditing(false); setText(a.proposed.text ?? ""); }}>Cancel</Btn>
          </>
        ) : (
          <>
            <ApproveBtn disabled={act.isPending} onClick={() => decide("accept")} data-testid={`alex-approve-${a.id}`}>Approve</ApproveBtn>
            {editable && <Btn small className="!h-8" onClick={() => setEditing(true)} data-testid={`alex-edit-${a.id}`}>Edit</Btn>}
            <Btn small className="!h-8" disabled={act.isPending} onClick={() => decide("reject")} data-testid={`alex-reject-${a.id}`}>Reject</Btn>
          </>
        )}
      </div>
    </div>
  );
}

function Thumb({ url, word, checker = false }: { url?: string; word: string; checker?: boolean }) {
  const bg = checker ? { backgroundImage: "repeating-conic-gradient(#1d3a63 0 25%, #12345f 0 50%)", backgroundSize: "10px 10px" } : { background: C.active };
  return url
    ? <img src={url} alt={word} className="h-14 w-14 shrink-0 rounded-md object-cover" style={bg} />
    : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-[11.5px]" style={{ ...bg, color: C.muted }}>{word}</span>;
}

function Jobs() {
  const { current } = useLive();
  const members = useMembers(current?.id ?? null);
  const st = useAlexState(current?.id ?? null);
  const alex = members.data?.find((m) => m.ai);
  const jobs = alex?.status === "removed" ? [] : alex?.jobs ?? [];
  const on = (...j: string[]) => j.some((x) => (jobs as string[]).includes(x));
  const s = st.data;
  const rows: [string, string, string, boolean | null][] = [
    ["Writer", "bios, intros, reads", on("headshots", "intros") ? "On" : "Off", on("headshots", "intros")],
    ["Coordinator", `daily ${s?.coordinatorAt ?? "8 am"}`, on("confirmations", "run_of_show") ? "On" : "Off", on("confirmations", "run_of_show")],
    ["Emails", s ? `${s.held} held` : "", s ? (s.send ? "Sending on" : "Sending off") : "…", s ? s.send : null],
    ["Voice", "approved scripts", s ? (s.voice ? "On" : "Off") : "…", s ? s.voice : null],
  ];
  return (
    <Card title="Her jobs" action={current && canManageAlex(current) ? <LinkBtn small href="/crew">Change</LinkBtn> : undefined} testId="alex-jobs">
      {alex?.status === "removed" && <p className="mb-1 text-[13px]" style={{ color: "#f0c050" }}>Alex is off this production.</p>}
      {rows.map(([k, sub, v, ok]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: C.line }}>
          <span className="min-w-0 truncate"><b>{k}</b> <span style={{ color: C.muted }}>{sub}</span></span>
          <Pill tone={ok ? "ok" : "muted"}>{v}</Pill>
        </div>
      ))}
    </Card>
  );
}

type Who = "all" | "alex" | "people";
function Activity() {
  const { current } = useLive();
  const q = useActivity(current?.can.audit ? current.id : null);
  const [w, setW] = useState<Who>("all");
  const rows = (q.data ?? []).filter((a) => w === "all" || (w === "alex" ? a.actor === "alex" : a.actor !== "alex")).slice(0, 30);
  return (
    <Card title="Activity" action={<Chips<Who> items={[{ key: "all", label: "All" }, { key: "alex", label: "Alex" }, { key: "people", label: "People" }]} value={w} onChange={setW} />} testId="alex-activity">
      {!current?.can.audit ? <p className="text-[13.5px]" style={{ color: C.muted }}>MV producers and coordinators see the activity log.</p>
        : rows.length ? rows.map((a) => <ActivityRow key={a.id} a={a} />)
        : <p className="text-[13.5px]" style={{ color: C.muted }}>{q.isLoading ? "Loading…" : "Nothing yet."}</p>}
    </Card>
  );
}

function ActivityRow({ a }: { a: AuditEntry }) {
  const alex = a.actor === "alex";
  const mv = /@militaryvoices?\.ai$/i.test(a.who);
  const [letter, bg] = alex ? ["A", "#b9a6f5"] : a.actor === "script" ? ["S", "#c9d3e2"] : mv ? ["P", "#c9d3e2"] : ["C", "#e0b23a"];
  const who = alex ? "" : a.actor === "script" ? "Automatic: " : mv ? `${shortWho(a.who)} ` : "Client ";
  const d = new Date(a.at);
  const t = d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const what = !alex && a.actor !== "script" ? a.what.charAt(0).toLowerCase() + a.what.slice(1) : a.what;
  return (
    <div className="flex items-center gap-2.5 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: C.line }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: bg, color: "#0b2447" }} aria-label={alex ? "Alex" : undefined}>{letter}</span>
      <span className="min-w-0 flex-1 truncate" title={`${a.who}: ${a.what}`}>{who}{what}</span>
      <span className="shrink-0 text-[12.5px] tabular-nums" style={{ color: C.muted }}>{t}</span>
    </div>
  );
}
