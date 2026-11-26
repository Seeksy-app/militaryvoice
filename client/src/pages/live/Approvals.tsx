import { useLive } from "./LiveApp";
import { ROLE_LABEL, useApprovals, useDecide, type Approval } from "./api";
import { C, Card, FONT_COND, fmtWhen, Pill } from "./ui";

/**
 * One inbox for everything waiting on an approval. In phase 1 the table exists but nothing feeds it yet; the client
 * approves content (in their portal), so MV see the list here, with buttons only on rows addressed to them (`mine`).
 */
export default function Approvals() {
  const { current } = useLive();
  const q = useApprovals(current?.id ?? null);
  const rows = q.data ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="live-approvals">
      <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Approvals</h1>
      <Card>
        {rows.length ? rows.map((a) => <ApprovalRow key={a.id} a={a} />) : (
          <p className="text-[13.5px]" style={{ color: C.muted }}>{q.isLoading ? "Loading…" : "Nothing is waiting. Run of show, scripts and clips arrive here from phase 2, and the client approves them in their portal."}</p>
        )}
      </Card>
    </div>
  );
}

const STATE: Record<Approval["state"], [string, "warn" | "ok" | "muted"]> = {
  pending: ["Waiting", "warn"], approved: ["Approved", "ok"], changes_requested: ["Changes asked", "muted"], withdrawn: ["Withdrawn", "muted"],
};

/** Here (navy) and in the client portal (light). Approve / Ask for changes only when the server says it's mine to decide. */
export function ApprovalRow({ a, light = false }: { a: Approval; light?: boolean }) {
  const act = useDecide();
  const [label, tone] = STATE[a.state];
  const muted = light ? "#4f5d72" : C.muted;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 text-[13.5px] last:border-b-0 ${light ? "border-[#dde3ec]" : ""}`} style={light ? undefined : { borderColor: C.line }}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{a.summary} <span className="font-normal" style={{ color: muted }}>v{a.version}</span></p>
        <p className="truncate text-[12.5px]" style={{ color: muted }}>For {ROLE_LABEL[a.approverRole]} · asked by {a.requestedBy}{a.decidedAt ? ` · ${fmtWhen(a.decidedAt)}` : ""}</p>
      </div>
      {a.mine ? (
        <div className="flex gap-2">
          <button type="button" disabled={act.isPending}
            className={`h-8 rounded-md border px-3 text-[13px] font-semibold ${light ? "border-[#dde3ec] hover:bg-[#f3f5f9]" : "hover:bg-white/5"}`} style={light ? undefined : { borderColor: C.line }}
            onClick={() => { const note = window.prompt("What should change?") ?? ""; if (note.trim()) act.mutate({ id: a.id, decision: "changes_requested", note }); }}>Ask for changes</button>
          <button type="button" disabled={act.isPending}
            className="h-8 rounded-md px-3 text-[13px] font-semibold" style={light ? { background: "#0b2447", color: "#fff" } : { background: C.gold, color: "#0b2447" }}
            onClick={() => act.mutate({ id: a.id, decision: "approved" })}>Approve</button>
        </div>
      ) : light ? <span className="text-[12.5px] font-semibold" style={{ color: muted }}>{label}</span> : <Pill tone={tone}>{label}</Pill>}
      {act.error && <span className="basis-full text-[12px]" style={{ color: light ? "#b42318" : "#ff8a80" }}>{act.error.message}</span>}
    </div>
  );
}
