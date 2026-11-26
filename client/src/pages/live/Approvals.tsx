import { useLive } from "./LiveApp";
import { ROLE_LABEL, useApprovals, useLiveWrite, type Approval } from "./api";
import { C, Card, FONT_COND, fmtWhen, Pill } from "./ui";

/**
 * One inbox for everything waiting on an approval. In phase 1 the table exists but nothing feeds it yet; the client
 * approves content (in their portal), so MV see the list here without Approve buttons.
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

/** Used here (read-only) and in the client portal (with Approve / Ask for changes when `decide`). */
export function ApprovalRow({ a, decide = false, light = false, me = "" }: { a: Approval; decide?: boolean; light?: boolean; me?: string }) {
  const act = useLiveWrite<{ id: number; state: "approved" | "changes_requested"; note: string }>("POST", (b) => `/approvals/${b.id}/decide`);
  const [label, tone] = STATE[a.state];
  // Nobody approves their own change.
  const mine = !!me && a.requested_by === me;
  const muted = light ? "#4f5d72" : C.muted;
  return (
    <div className={`flex items-center gap-3 border-b py-2 text-[13.5px] last:border-b-0 ${light ? "border-[#dde3ec]" : ""}`} style={light ? undefined : { borderColor: C.line }}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{a.title} <span className="font-normal" style={{ color: muted }}>v{a.version}</span></p>
        <p className="truncate text-[12.5px]" style={{ color: muted }}>For {ROLE_LABEL[a.approver_role]} · asked by {a.requested_by}{a.decided_at ? ` · ${fmtWhen(a.decided_at)}` : ""}</p>
      </div>
      {decide && a.state === "pending" && !mine ? (
        <>
          <button type="button" className="h-8 rounded-md border border-[#dde3ec] px-3 text-[13px] font-semibold hover:bg-[#f3f5f9]" disabled={act.isPending}
            onClick={() => { const note = window.prompt("What should change?") ?? ""; if (note.trim()) act.mutate({ id: a.id, state: "changes_requested", note }); }}>Ask for changes</button>
          <button type="button" className="h-8 rounded-md bg-[#0b2447] px-3 text-[13px] font-semibold text-white hover:bg-[#132e57]" disabled={act.isPending}
            onClick={() => act.mutate({ id: a.id, state: "approved", note: "" })}>Approve</button>
        </>
      ) : light ? <span className="text-[12.5px] font-semibold" style={{ color: muted }}>{label}</span> : <Pill tone={tone}>{label}</Pill>}
      {act.error && <span className="text-[12px] text-[#b42318]">{act.error.message}</span>}
    </div>
  );
}
