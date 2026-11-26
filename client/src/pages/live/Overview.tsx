import { Link } from "wouter";
import { AlertTriangle, Info } from "lucide-react";
import { useLive } from "./LiveApp";
import { assignable, sideOf, STATUS_LABEL, useApprovals, useAudit, useMembers, useStages, type Member } from "./api";
import { LinkBtn, C, Card, Coming, FONT_COND, fmtRange, fmtWhen, Row } from "./ui";

/**
 * Production Command home: "are we OK right now?" for the picked production. Phase 1 fills status, people,
 * approvals and recent changes from real rows; on now, coming up and tech readiness say which phase brings them.
 */
export default function Overview() {
  const { current, side, isAdmin } = useLive();
  const stageQ = useStages(current?.id ?? null);
  const members = useMembers(current?.id ?? null);
  const approvals = useApprovals(side === "mv" ? current?.id ?? null : null);
  const audit = useAudit(current?.can.audit ? current.id : null);

  if (!current) {
    return (
      <Card title="No productions yet">
        <p className="text-[14px]" style={{ color: C.muted }}>A production is one engagement: a client, dates, venues and stages, and the people on it.</p>
        {isAdmin && <LinkBtn primary className="mt-3" href="/events/new">New production</LinkBtn>}
      </Card>
    );
  }

  const people = (members.data ?? []).filter((m) => m.status !== "removed");
  const bySide = (s: "mv" | "crew" | "client") => people.filter((m) => sideOf(m.role) === s);
  const unsent = people.filter((m) => m.status === "invited").length;
  const stages = stageQ.data ?? [];
  const pending = (approvals.data ?? []).filter((a) => a.state === "pending");

  const alerts: { tone: "warn" | "info"; text: string; href?: string; go?: string }[] = [];
  if (current.can.stages && stageQ.data && !stages.length) alerts.push({ tone: "warn", text: "No stage yet. A production needs at least one stage before crew can be booked.", href: `/events/${current.id}`, go: "Add a stage" });
  if (unsent) alerts.push({ tone: "info", text: `${unsent} invite${unsent === 1 ? "" : "s"} saved, not sent. Invites go out when they're switched on.`, href: "/crew", go: "See people" });

  return (
    <div className="flex flex-col gap-3" data-testid="live-overview">
      {alerts.map((a) => (
        <div key={a.text} className="flex items-center gap-2.5 rounded-md border-l-[3px] px-3 py-2 text-[13.5px]" style={{ borderColor: a.tone === "warn" ? "#f0c050" : "#8db6f0", background: a.tone === "warn" ? "rgba(240,192,80,.10)" : "rgba(141,182,240,.10)" }}>
          {a.tone === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#f0c050]" aria-hidden /> : <Info className="h-4 w-4 shrink-0 text-[#8db6f0]" aria-hidden />}
          <span className="min-w-0 flex-1">{a.text}</span>
          {a.href && <Link href={a.href} className="shrink-0 font-semibold hover:underline" style={{ color: a.tone === "warn" ? "#f0c050" : "#8db6f0" }}>{a.go}</Link>}
        </div>
      ))}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="Event status" action={current.can.edit ? <LinkBtn small href={`/events/${current.id}`}>Edit</LinkBtn> : undefined} testId="live-card-status">
          <p className="mb-1 line-clamp-2 text-balance text-[20px] font-semibold leading-tight" style={{ fontFamily: FONT_COND }}>{current.name}</p>
          <Row label="Stage of work">{STATUS_LABEL[current.status]}</Row>
          <Row label="Dates">{fmtRange(current.startsOn, current.endsOn)}</Row>
          {side !== "crew" && <Row label="Client">{current.org?.name ?? "Not set"}</Row>}
          <Row label="Stages">{stages.length ? stages.map((s) => s.name + (s.venue ? `, ${s.venue.name}` : "")).join(" · ") : "None yet"}</Row>
        </Card>

        <Card title={side === "crew" ? "Your crew" : "People"} action={<LinkBtn small href="/crew">{assignable(current).length ? "Manage" : "Open"}</LinkBtn>} testId="live-card-people">
          {side === "crew" ? (
            <PeopleRows rows={bySide("crew")} />
          ) : (
            <>
              <Row label="MilitaryVoices.ai">{count(bySide("mv"))}</Row>
              <Row label="Crew">{count(bySide("crew"))}</Row>
              <Row label="Client">{count(bySide("client"))}</Row>
            </>
          )}
        </Card>

        {side === "mv" ? (
          <Card title="Waiting on approval" action={<LinkBtn small href="/approvals">Open</LinkBtn>} testId="live-card-approvals">
            {pending.length ? pending.slice(0, 4).map((a) => <Row key={a.id} label={a.summary}>v{a.version}</Row>) : <p className="text-[13.5px]" style={{ color: C.muted }}>Nothing is waiting. Run of show, scripts and clips arrive here from phase 2.</p>}
          </Card>
        ) : (
          <Card title="On-site crew control">
            <Coming what="Cameras, cues and connections for the stage" phase={3} />
          </Card>
        )}

        <Card title="On now"><Coming what="The session on air, time left, who's on stage" phase={3} /></Card>
        <Card title="Coming up"><Coming what="Next sessions from the run of show" phase={2} /></Card>
        <Card title="Tech readiness"><Coming what="Feeds, destinations and recording" phase={3} /></Card>
      </div>

      {current.can.audit && (
        <Card title="Recent changes" testId="live-card-audit">
          {(audit.data ?? []).slice(0, 4).map((r) => <Row key={r.id} label={`${r.what} · ${r.who}`}>{fmtWhen(r.at)}</Row>)}
          {!audit.data?.length && <p className="text-[13.5px]" style={{ color: C.muted }}>{audit.isLoading ? "Loading…" : "No changes yet."}</p>}
        </Card>
      )}
    </div>
  );
}

const count = (rows: Member[]) => {
  const inv = rows.filter((m) => m.status === "invited").length;
  return rows.length ? `${rows.length}${inv ? ` (${inv} invited)` : ""}` : "None yet";
};

function PeopleRows({ rows }: { rows: Member[] }) {
  if (!rows.length) return <p className="text-[13.5px]" style={{ color: C.muted }}>No one yet.</p>;
  return <>{rows.slice(0, 4).map((m) => <Row key={m.id} label={m.name || m.email}>{m.status === "invited" ? "Invited" : "Active"}</Row>)}</>;
}
