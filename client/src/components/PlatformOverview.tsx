import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Activity, ArrowRight, CalendarDays, ClipboardList, Film, Inbox, MessageSquare, Sparkles, UserPlus, Users } from "lucide-react";
import type { PublicEvent } from "@shared/schema";

// The admin's front page (6 Oct; redone 8 Oct around what Andrew checks): who's
// waiting on a reply, then this week's texts, surveys and clips, new events,
// members, and whether everything is up.

type Person = { email: string; name: string; roles: string[]; plan: string; joinedAt: string; shows: string[] };
type Audience = { key: string; label: string; count: number };
type Overview = {
  texts: { sent: number; delivered: number; failed: number; replies: number; optOuts: number; optOutsWeek: number };
  survey: { invited: number; done: number; week: number };
  clips: { week: number; episodes: number; posted: number; scheduled: number };
  newEvents: { id: number; name: string; startAtUtc: string; createdAt: string; review: string; visible: boolean }[];
  waiting: { id: number; fromName: string; fromEmail: string; subject: string; summary: string; receivedAt: string; toAddr: string; ackAt: string }[];
};
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

const days = (iso: string) => (Date.now() - Date.parse(iso)) / 86400000;

function Stat({ label, value, sub, href, icon: Icon, hot = false }: { label: string; value: string | number; sub?: string; href?: string; icon: typeof Users; hot?: boolean }) {
  const body = (
    <div className={`flex h-full flex-col rounded-2xl border p-5 transition hover:border-[#053877]/40 ${hot ? "border-[#F0A71F]/70 bg-[#F0A71F]/10" : "border-border bg-card"}`}>
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
  const ov = useQuery<Overview>({ queryKey: ["/api/admin/overview"], queryFn: () => adminGet("/api/admin/overview"), refetchInterval: 60_000 });
  const featuredId = (events.data ?? []).find((e) => (e as PublicEvent & { isFeatured?: boolean }).isFeatured)?.id ?? 1;
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
        <p className="mt-1 text-sm text-muted-foreground">Who's waiting on you, and the week in numbers.</p>
      </div>

      {/* The week: replies owed first, then texts, survey and clips. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Inbox} label="Needs a reply" value={ov.data?.waiting.length ?? counts.data?.needs ?? "…"} sub={`${counts.data?.sentToday ?? 0} emails sent today`} href="/admin/crm" hot={(ov.data?.waiting.length ?? 0) > 0} />
        <Stat icon={MessageSquare} label="Texts this week" value={ov.data?.texts.sent ?? "…"} sub={ov.data ? `${ov.data.texts.delivered} delivered · ${ov.data.texts.failed} failed · ${ov.data.texts.replies} replies · ${ov.data.texts.optOuts} opted out${ov.data.texts.optOutsWeek ? ` (${ov.data.texts.optOutsWeek} new)` : ""}` : undefined} href={`/admin/e/${featuredId}/texts`} />
        <Stat icon={ClipboardList} label="Survey" value={ov.data ? `${ov.data.survey.done} of ${ov.data.survey.invited}` : "…"} sub={ov.data ? `${ov.data.survey.invited ? Math.round((ov.data.survey.done / ov.data.survey.invited) * 100) : 0}% answered · ${ov.data.survey.week} this week` : undefined} href={`/admin/e/${featuredId}/survey`} />
        <Stat icon={Film} label="Clips this week" value={ov.data?.clips.week ?? "…"} sub={ov.data ? `from ${ov.data.clips.episodes} ${ov.data.clips.episodes === 1 ? "episode" : "episodes"} · ${ov.data.clips.posted} posted · ${ov.data.clips.scheduled} scheduled` : undefined} href={`/admin/e/${featuredId}/clips`} />
      </div>

      {/* Get back to: everyone who wrote in and hasn't had a person's reply, oldest first. */}
      <section className="rounded-2xl border border-border bg-card p-5" data-testid="overview-waiting">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Inbox className="h-4 w-4" /> Get back to</h3>
          <Link href="/admin/crm" className="text-xs font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">All mail →</Link>
        </div>
        {!ov.data ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : ov.data.waiting.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Nobody's waiting on a reply.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {ov.data.waiting.map((m) => (
              <li key={m.id}>
                <Link href={`/admin/crm?with=${encodeURIComponent(m.fromEmail)}&focus=in-${m.id}`} className="flex items-start justify-between gap-3 rounded-lg px-1 py-2.5 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.fromName || m.fromEmail}<span className="font-normal text-muted-foreground"> · {m.subject || "(no subject)"}</span></span>
                    <span className="block truncate text-xs text-muted-foreground">{m.summary || m.fromEmail}{m.toAddr === "Help chat" ? " · from the Help chat" : ""}{m.ackAt ? " · Alex replied first" : ""}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(m.receivedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

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
            <h3 className="flex items-center gap-2 text-base font-semibold"><UserPlus className="h-4 w-4" /> Joined this week</h3>
            <Link href="/admin/crm" className="text-xs font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">Everyone in CRM →</Link>
          </div>
          {/* The members at a glance (these were three tiles up top). */}
          <p className="mt-1 text-xs text-muted-foreground"><Users className="mr-1 inline h-3.5 w-3.5" />{aud("members")} members · {fresh.length} new this week · <Link href="/admin/finances" className="hover:underline"><Sparkles className="mr-0.5 inline h-3.5 w-3.5" />{paying} on a paid plan ({aud("pro")} Pro, {aud("scale")} Scale)</Link></p>
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
            <h3 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4" /> Events</h3>
            {/* New in the last 30 days, with where each stands. */}
            {(ov.data?.newEvents ?? []).length > 0 && (
              <>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">New</p>
                <ul className="mt-1 space-y-1">
                  {ov.data!.newEvents.map((e) => (
                    <li key={e.id}>
                      <Link href={`/admin/e/${e.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                        <span className="truncate font-medium">{e.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{e.review === "pending" ? "Waiting for you" : e.visible ? "Live" : "Hidden"} · added {ago(e.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Coming up</p>
              </>
            )}
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
