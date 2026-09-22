import { useMemo, useState } from "react";
import { Eye, Plus, Search, Upload, Mail, RefreshCw, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The CRM as a podcaster would have it, filled with sample data.
 *
 * Same five doors as the event admin's — Contacts, Lists, Campaigns,
 * Replies, Activity — built from the same pieces, so what they tab through
 * here is what they get. Nothing talks to a server; every number is made up
 * and says so, with a watermark on every page. It replaces the screenshots
 * the Pro pages used to show, which were blurry and could not be clicked.
 */
type Tab = "contacts" | "lists" | "campaigns" | "replies" | "activity";
type CampaignSub = "campaigns" | "automation" | "templates";

const DAY = 86_400_000;
const ago = (days: number, hour = 9) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 3, 0, 0);
  return d;
};

const CONTACTS = [
  { name: "Maria Lopez", email: "maria.lopez@example.com", source: "reminder", sends: 6, last: 2 },
  { name: "Darnell Price", email: "dprice@example.com", source: "reminder", sends: 6, last: 2 },
  { name: "Kim Nakamura", email: "kim.n@example.com", source: "imported", sends: 4, last: 9 },
  { name: "Luis Ortega", email: "luis.ortega@example.com", source: "reminder", sends: 5, last: 2 },
  { name: "Ava Thompson", email: "ava.t@example.com", source: "imported", sends: 3, last: 16 },
  { name: "Sgt. Mike Reyes", email: "mreyes@example.com", source: "reminder", sends: 6, last: 2 },
  { name: "Jordan Blake", email: "jordan.blake@example.com", source: "imported", sends: 2, last: 23 },
  { name: "Priya Shah", email: "priya@example.com", source: "reminder", sends: 6, last: 2 },
  { name: "Tom Whitaker", email: "tom.w@example.com", source: "imported", sends: 4, last: 9 },
  { name: "Elena Petrov", email: "elena.p@example.com", source: "reminder", sends: 1, last: 1 },
  { name: "Chris Adebayo", email: "c.adebayo@example.com", source: "reminder", sends: 5, last: 2 },
  { name: "Hannah Kim", email: "hannah.kim@example.com", source: "imported", sends: 4, last: 9 },
];

const LISTS = [
  { title: "Asked for a reminder", sub: "Everyone who tapped Remind me on your card", count: 48, kind: "system" },
  { title: "Imported contacts", sub: "Your list from CSV — not on the reminder list", count: 85, kind: "import" },
  { title: "Opened the last episode email", sub: "Custom list · built from opens", count: 31, kind: "custom" },
  { title: "Clicked to the live show", sub: "Custom list · built from clicks", count: 9, kind: "custom" },
];

const CAMPAIGNS = [
  { subject: "New episode: The night we almost didn't make it home", when: ago(2), to: "Asked for a reminder", n: 48, delivered: 47, opened: 29, clicked: 11 },
  { subject: "I'm live Monday at 4 PM — here's the link", when: ago(9), to: "Both lists", n: 133, delivered: 130, opened: 71, clicked: 23 },
  { subject: "Three clips from last week's show", when: ago(16), to: "Opened the last episode email", n: 31, delivered: 31, opened: 22, clicked: 14 },
];

const SCHEDULED = { subject: "Recap + the clip everyone shared", when: new Date(Date.now() + 3 * DAY), to: "Both lists", n: 133 };

const AUTOMATION = [
  { step: "Welcome", when: "The moment someone asks for a reminder", subject: "You're on the list — here's what's coming", status: "On", sent: 48 },
  { step: "New episode", when: "When you publish an episode", subject: "New episode: {{Episode_Title}}", status: "On", sent: 214 },
  { step: "Show-day reminder", when: "One hour before you go live", subject: "I'm on in an hour", status: "On", sent: 41 },
  { step: "Follow-up", when: "Two days after a live show", subject: "Missed it? The replay and the clips", status: "Off", sent: 0 },
];

const TEMPLATES = [
  { name: "New episode", note: "Title, one line on the guest, the link" },
  { name: "Going live", note: "Time in their zone, the watch link, one ask" },
  { name: "Clips drop", note: "Three vertical clips, captioned, one tap to share" },
];

const REPLIES = [
  {
    from: "Maria Lopez", email: "maria.lopez@example.com", subject: "Re: New episode: The night we almost didn't make it home", when: ago(1, 14),
    body: "That episode hit home. My dad was at Khe Sanh and never talked about it. Is there a way to hear the full interview with your guest?",
    summary: "Asks where to hear the full interview", ack: true, status: "drafted" as const, from_: "you",
    draft: "Maria,\n\nThank you — that means a lot. The full interview is the episode itself, about 52 minutes; the clip was the first ten. It's at the link below, and the replay of Monday's live show goes up Wednesday.\n\nIf your dad ever wants to tell his story, this show is a good place for it.\n\n",
  },
  {
    from: "Tom Whitaker", email: "tom.w@example.com", subject: "Re: I'm live Monday at 4 PM — here's the link", when: ago(8, 10),
    body: "Will there be a replay? I'm on shift Monday.",
    summary: "Asks whether there will be a replay", ack: true, status: "sent" as const, from_: "you",
    draft: "Tom,\n\nYes — the replay is up within a day at the same link, and the clips land on the channel by Wednesday.\n\n",
  },
];

function Watermark() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl" aria-hidden="true">
        <div className="absolute -left-1/4 top-1/2 w-[150%] -translate-y-1/2 -rotate-[18deg] select-none whitespace-nowrap text-center text-[120px] font-black uppercase tracking-[0.3em] text-[#053877]/[0.05]">
          demo · demo · demo
        </div>
      </div>
      <span className="absolute right-3 top-3 z-20 rounded-full bg-[#F0A71F] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#1a1200] shadow" data-testid="pro-demo-badge">
        Demo · sample data
      </span>
    </>
  );
}

export function ProCrmDemo({ initialTab = "contacts" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sub, setSub] = useState<CampaignSub>("campaigns");
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "reminder" | "imported">("all");
  const [open, setOpen] = useState<number | null>(0);
  const [mode, setMode] = useState<"sends" | "contacts">("sends");

  const waiting = REPLIES.filter((r) => r.status === "drafted").length;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "contacts", label: "Contacts" },
    { id: "lists", label: "Lists" },
    { id: "campaigns", label: "Campaigns" },
    { id: "replies", label: "Replies", badge: waiting || undefined },
    { id: "activity", label: "Activity" },
  ];

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => CONTACTS.filter((c) => (source === "all" || c.source === source) && (!needle || c.name.toLowerCase().includes(needle) || c.email.includes(needle))),
    [needle, source],
  );
  const counts = { all: 133, reminder: 48, imported: 85 };
  const totals = CAMPAIGNS.reduce((a, c) => ({ emails: a.emails + c.n, delivered: a.delivered + c.delivered, opened: a.opened + c.opened, clicked: a.clicked + c.clicked }), { emails: 0, delivered: 0, opened: 0, clicked: 0 });
  const pct = (n: number) => `${Math.round((n / totals.delivered) * 100)}%`;
  const fmt = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6" data-testid="pro-crm-demo">
      <Watermark />
      <div className="relative">
        {/* The five doors, as the admin has them. */}
        <div className="mb-6 flex overflow-x-auto border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`pro-crm-tab-${t.id}`}
            >
              {t.label}
              {t.badge != null && <span className="rounded-full bg-[#053877] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{t.badge}</span>}
            </button>
          ))}
        </div>

        {/* ── Contacts ── */}
        {tab === "contacts" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="w-64 pl-8" />
                </div>
                <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
                  {([["all", "Everyone"], ["reminder", "Asked for a reminder"], ["imported", "Imported"]] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setSource(k)} className={`rounded-md px-3 py-1.5 font-medium transition-colors ${source === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      {label} <span className="opacity-70">{counts[k]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Import CSV</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Who</th>
                    <th className="px-4 py-2 font-semibold">From</th>
                    <th className="px-4 py-2 font-semibold">Emails</th>
                    <th className="px-4 py-2 font-semibold">Last email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((c) => (
                    <tr key={c.email} className="hover:bg-accent/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.source === "reminder" ? "bg-[#053877]/10 text-[#053877]" : "bg-muted text-muted-foreground"}`}>
                          {c.source === "reminder" ? "Asked for a reminder" : "Imported"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{c.sends}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{ago(c.last).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Showing {shown.length} of {counts[source]}</p>
            </div>
          </div>
        )}

        {/* ── Lists ── */}
        {tab === "lists" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Select a list to view or email its contacts</p>
              <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New list</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {LISTS.map((l) => (
                <Card key={l.title} className="hover:border-primary/40">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold">{l.title}</p>
                        <p className="text-sm text-muted-foreground">{l.sub}</p>
                      </div>
                      <p className="text-3xl font-bold tabular-nums text-[#053877]">{l.count}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex gap-2">
                        {l.kind === "import" && <Button size="sm" variant="outline" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Import CSV</Button>}
                        <Button size="sm" variant="outline" className="gap-1.5"><Mail className="h-3.5 w-3.5" /> Email list</Button>
                      </div>
                      <span className="text-sm text-muted-foreground">{l.kind === "custom" ? "Delete" : "View ›"}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Campaigns ── */}
        {tab === "campaigns" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-muted p-1">
                {([["campaigns", "Campaigns"], ["automation", "Automation"], ["templates", "Templates"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setSub(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${sub === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {sub === "campaigns" && <Button size="sm" className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"><Plus className="h-3.5 w-3.5" /> Write an email</Button>}
            </div>

            {sub === "campaigns" && (
              <>
                <p className="text-sm text-muted-foreground">{CAMPAIGNS.length} campaigns · one email, one send</p>
                <div className="rounded-xl border border-dashed border-[#053877]/40 bg-[#053877]/[0.03] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{SCHEDULED.subject}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Scheduled · {fmt(SCHEDULED.when)} · {SCHEDULED.to} · {SCHEDULED.n} recipients</p>
                    </div>
                    <Badge variant="secondary" className="text-[11px]">Scheduled</Badge>
                  </div>
                </div>
                {CAMPAIGNS.map((c) => (
                  <div key={c.subject} className="rounded-xl border border-border px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.subject}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{fmt(c.when)} · {c.to} · {c.n} recipients</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-md p-1.5 text-muted-foreground"><Eye className="h-4 w-4" /></span>
                        <Badge className="text-[11px]">Sent</Badge>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <span className="text-muted-foreground">📬 {c.delivered} delivered</span>
                      <span className="text-blue-600 dark:text-blue-400">👁 {c.opened} opened</span>
                      <span className="text-green-600 dark:text-green-400">🔗 {c.clicked} clicked</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {sub === "automation" && (
              <>
                <p className="text-sm text-muted-foreground">Everything a listener receives, in the order it reaches them. Written once.</p>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {AUTOMATION.map((a, i) => (
                    <div key={a.step} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#053877]/10 text-xs font-bold text-[#053877]">{i + 1}</span>
                        <div>
                          <p className="text-sm font-semibold">{a.step} <span className="ml-1 font-normal text-muted-foreground">· {a.when}</span></p>
                          <p className="text-xs text-muted-foreground">"{a.subject}" · {a.sent} sent</p>
                        </div>
                      </div>
                      <Badge variant={a.status === "On" ? "default" : "secondary"} className="text-[11px]">{a.status}</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sub === "templates" && (
              <>
                <p className="text-sm text-muted-foreground">{TEMPLATES.length} templates · copy to start a campaign or an automation step from</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {TEMPLATES.map((t) => (
                    <div key={t.name} className="rounded-xl border border-border p-4">
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t.note}</p>
                      <Button size="sm" variant="outline" className="mt-3">Use this</Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Replies ── */}
        {tab === "replies" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Everything that came back. Alex acknowledges each one on arrival; you send the answer.</p>
            <div className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <p className="text-sm font-semibold">
                  Replies <span className="ml-2 rounded-full bg-[#053877] px-2 py-0.5 text-[11px] font-bold text-white">{waiting} needs a person</span>
                </p>
              </div>
              <div className="divide-y divide-border">
                {REPLIES.map((r, i) => (
                  <div key={r.email} className="px-4 py-3">
                    <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-start justify-between gap-3 text-left">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium"><span className="mr-1.5">📥</span>{r.from}<span className="ml-2 font-normal text-muted-foreground">{r.subject}</span></p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.summary}</p>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                        <div>{r.when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                        <div className="mt-0.5">
                          <span className="mr-2 text-emerald-700 dark:text-emerald-400">⚡ Alex acknowledged</span>
                          {r.status === "sent" ? <span className="text-emerald-700 dark:text-emerald-400">✓ Answered by you</span> : "Question · a person still owes a reply"}
                        </div>
                      </div>
                    </button>
                    {open === i && (
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg bg-muted/40 p-3 text-sm">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">They wrote</p>
                          <p>{r.body}</p>
                          <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alex acknowledged, automatically</p>
                          <p className="text-xs text-muted-foreground">Hi {r.from.split(" ")[0]}, thank you for contacting us. Your message is very important to us. If this doesn't answer your question, reply to this email and someone will reach out shortly. — Alex, AI help desk</p>
                        </div>
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{r.status === "sent" ? "Sent by you" : "Human follow-up · draft, written for you"}</p>
                          <textarea readOnly value={`${r.draft}Your name`} rows={8} className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
                          {r.status !== "sent" && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Button size="sm" className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Send</Button>
                              <Button size="sm" variant="ghost">Rewrite</Button>
                              <Button size="sm" variant="ghost">No follow-up needed</Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Activity ── */}
        {tab === "activity" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
                {([["sends", "By email"], ["contacts", "By contact"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-md px-3 py-1.5 font-medium transition-colors ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sync</Button>
            </div>
            {mode === "sends" ? (
              <>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
                  {[
                    { label: "sends", value: CAMPAIGNS.length + AUTOMATION.filter((a) => a.sent > 0).length, note: "campaigns and automatic" },
                    { label: "emails", value: totals.emails + AUTOMATION.reduce((a, b) => a + b.sent, 0), note: "delivered to inboxes" },
                    { label: "opened", value: totals.opened, note: `${pct(totals.opened)} of tracked` },
                    { label: "clicked", value: totals.clicked, note: `${pct(totals.clicked)} of tracked` },
                  ].map((f) => (
                    <div key={f.label} className="bg-background px-4 py-3">
                      <div className="text-2xl font-bold tabular-nums tracking-tight">{f.value.toLocaleString()}</div>
                      <div className="text-xs font-medium">{f.label}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{f.note}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  {CAMPAIGNS.map((c) => (
                    <div key={c.subject} className="rounded-xl border border-border px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{c.subject}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{fmt(c.when)} · {c.to} · {c.n} recipients</p>
                        </div>
                        <Badge className="text-[11px]">Sent</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        <span className="text-muted-foreground">📬 {c.delivered} delivered</span>
                        <span className="text-blue-600 dark:text-blue-400">👁 {c.opened} opened</span>
                        <span className="text-green-600 dark:text-green-400">🔗 {c.clicked} clicked</span>
                      </div>
                    </div>
                  ))}
                  {AUTOMATION.filter((a) => a.sent > 0).map((a) => (
                    <div key={a.step} className="rounded-xl border border-border px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{a.subject}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{a.step} · {a.sent} so far</p>
                        </div>
                        <Badge variant="secondary" className="text-[11px]">Automatic</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {CONTACTS.slice(0, 8).map((c) => (
                  <div key={c.email} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{c.sends}</p>
                      <p className="text-[11px] text-muted-foreground">emails · last {ago(c.last).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-[#F0A71F]" /> Every name and number on this page is made up. Yours fill in when Pro opens.
        </p>
      </div>
    </div>
  );
}
