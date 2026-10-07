import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Activity, ArrowRight, CalendarDays, Inbox, Sparkles, UserPlus, Users } from "lucide-react";
import type { PublicEvent } from "@shared/schema";

// The admin's front page (6 Oct): the platform first, events as one part of
// it. How many members, who joined this week, who pays, what's waiting in the
// inbox, what's coming up, and whether everything is up.

type Person = { email: string; name: string; roles: string[]; plan: string; joinedAt: string; shows: string[] };
type Audience = { key: string; label: string; count: number };

const days = (iso: string) => (Date.now() - Date.parse(iso)) / 86400000;

function Stat({ label, value, sub, href, icon: Icon }: { label: string; value: string | number; sub?: string; href?: string; icon: typeof Users }) {
  const body = (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition hover:border-[#053877]/40">
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Icon className="h-4 w-4" /> {label}</span>
      <span className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</span>
      {sub && <span className="mt-1 text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function PlatformOverview() {
  const people = useQuery<{ people: Person[]; audiences: Audience[] }>({ queryKey: ["/api/admin/people", 0], queryFn: () => adminGet("/api/admin/people") });
  const counts = useQuery<{ needs: number; unread: number; sentToday: number }>({ queryKey: ["/api/admin/mail/counts"], queryFn: () => adminGet("/api/admin/mail/counts") });
  const events = useQuery<PublicEvent[]>({ queryKey: ["/api/admin/events"], queryFn: () => adminGet("/api/admin/events") });
  const qc = useQueryClient();
  const planner = useQuery<{ id: number; name: string; startAtUtc: string; review: string; ownerEmail: string; pageUrl: string; description: string }[]>({ queryKey: ["/api/admin/planner-events"], queryFn: () => adminGet("/api/admin/planner-events") });
  const waiting = (planner.data ?? []).filter((e) => e.review === "pending");
  const decide = async (id: number, approve: boolean) => {
    await adminSend("POST", `/api/admin/planner-events/${id}/approve`, { approve });
    void qc.invalidateQueries({ queryKey: ["/api/admin/planner-events"] });
    void qc.invalidateQueries({ queryKey: ["/api/admin/events"] });
  };
  const orgs = useQuery<{ id: number; name: string; kind: string; status: string }[]>({ queryKey: ["/api/admin/orgs"], queryFn: () => adminGet("/api/admin/orgs") });
  const orgsWaiting = (orgs.data ?? []).filter((o) => o.status === "pending");
  const health = useQuery<{ checks: { key: string; name: string; state: string; detail: string }[] }>({ queryKey: ["/api/admin/health"], queryFn: () => adminGet("/api/admin/health") });

  const aud = (k: string) => people.data?.audiences.find((a) => a.key === k)?.count ?? 0;
  const members = (people.data?.people ?? []).filter((p) => p.roles.includes("Member"));
  const fresh = members.filter((p) => p.joinedAt && days(p.joinedAt) <= 7).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
  const paying = aud("pro") + aud("scale");
  const upcoming = (events.data ?? []).filter((e) => Date.parse(e.startAtUtc) + e.durationHours * 3600_000 > Date.now()).sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  const down = (health.data?.checks ?? []).filter((c) => c.state === "down");

  return (
    <div className="max-w-6xl space-y-6" data-testid="platform-overview">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">MilitaryVoices.ai</h2>
        <p className="mt-1 text-sm text-muted-foreground">The platform at a glance. Events are one part of it, under Events.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="Members" value={aud("members")} sub={`${aud("podcasters")} podcasters · ${aud("discovery")} on Discovery`} href="/admin/crm" />
        <Stat icon={UserPlus} label="New this week" value={fresh.length} sub={fresh[0] ? `Latest: ${fresh[0].name || fresh[0].email}` : "Nobody new yet"} href="/admin/crm" />
        <Stat icon={Sparkles} label="On a paid plan" value={paying} sub={`${aud("pro")} Pro · ${aud("scale")} Scale · ${aud("growth")} on Growth`} href="/admin/finances" />
        <Stat icon={Inbox} label="Needs a reply" value={counts.data?.needs ?? "…"} sub={`${counts.data?.sentToday ?? 0} emails sent today`} href="/admin/crm" />
      </div>

      {orgsWaiting.length > 0 && (
        <Link href="/admin/orgs" className="flex items-center justify-between gap-3 rounded-2xl border-2 border-[#F0A71F]/60 bg-[#F0A71F]/10 px-5 py-4 text-sm hover:bg-[#F0A71F]/15" data-testid="overview-orgs-waiting">
          <span><span className="font-semibold">{orgsWaiting.length} {orgsWaiting.length === 1 ? "organization is" : "organizations are"} waiting for approval:</span> {orgsWaiting.slice(0, 3).map((o) => o.name).join(", ")}{orgsWaiting.length > 3 ? "…" : ""}</span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}

      {/* Event planners' events sent to us: approving makes them public and opens their studio. */}
      {waiting.length > 0 && (
        <section className="rounded-2xl border-2 border-[#F0A71F]/60 bg-[#F0A71F]/10 p-5" data-testid="overview-approvals">
          <h3 className="text-base font-semibold">Events waiting for your approval</h3>
          <ul className="mt-3 space-y-3">
            {waiting.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-card p-4">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{e.name}</span>
                  <span className="block text-xs text-muted-foreground">{new Date(e.startAtUtc).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} · by {e.ownerEmail}</span>
                  {e.description && <span className="mt-1 block text-sm text-foreground/80">{e.description.slice(0, 220)}{e.description.length > 220 ? "…" : ""}</span>}
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => void decide(e.id, true)} data-testid={`approve-${e.id}`}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(e.id, false)}>Send back</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-semibold">Joined this week</h3>
            <Link href="/admin/crm" className="text-xs font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">Everyone in CRM →</Link>
          </div>
          {fresh.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No new members in the last seven days.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {fresh.slice(0, 8).map((p) => (
                <li key={p.email} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name || p.email.split("@")[0]}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.email}{p.shows[0] ? ` · ${p.shows[0]}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.plan} · {new Date(p.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4" /> Coming up</h3>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No events scheduled. <Link href="/admin/events" className="font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">Create one</Link></p>
            ) : (
              <ul className="mt-2 space-y-2">
                {upcoming.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <Link href={`/admin/e/${e.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                      <span className="truncate font-medium">{e.name}</span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{new Date(e.startAtUtc).toLocaleDateString("en-US", { month: "short", day: "numeric" })} <ArrowRight className="h-3 w-3" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin/events" className="mt-2 inline-block text-xs font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">All events →</Link>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4" /> System</h3>
            {down.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">Everything is answering.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {down.map((c) => <li key={c.key} className="text-red-600"><span className="font-semibold">{c.name}</span> is down: {c.detail}</li>)}
              </ul>
            )}
            <Link href="/admin/health" className="mt-2 inline-block text-xs font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">System health →</Link>
          </section>
        </div>
      </div>
    </div>
  );
}
