import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Bell, CalendarDays, Check, ExternalLink, Eye, Globe, Loader2, Mic2, MousePointerClick, PenSquare, Plus, StickyNote, Tag, Trash2, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ThreadView } from "@/components/AdminMail";

/**
 * A person, all in one place: who they are to us, how they've engaged, every email both ways,
 * their bookings, SmartLink and shows, and the team's tags and notes, as one timeline.
 * Works for any email address, in Contacts or not.
 */

type Fate = { delivered: boolean; opened: boolean; clicked: boolean; bounced: boolean };
type Moment = { at: string; kind: "email-out" | "email-in" | "booking" | "cohost" | "signup" | "reminder" | "note" | "joined"; title: string; detail?: string; fate?: Fate; ok?: boolean; label?: string };
type Profile = {
  email: string; name: string; roles: string[];
  contact: { id: number; status: string; stage: string; source: string; since: string; lastEngagedAt: string } | null;
  tags: string[]; notes: { id: number; text: string; author: string; at: string }[];
  stats: { sent: number; received: number; opened: number; clicked: number; bounced: number; lastEmailedAt: string; lastOpenedAt: string; lastWroteAt: string; waiting: number };
  host: { podcast: string; hostName: string; branch: string; serviceStatus: string } | null;
  smartlink: { handle: string; url: string; name: string } | null;
  shows: { id: number; title: string; url: string; episodes: number }[];
  bookings: { id: number; podcast: string; event: string; when: string; status: string; at: string; role: "host" | "cohost" }[];
  timeline: Moment[];
};

const STAGES: [string, string][] = [["lead", "Lead"], ["engaged", "Engaged"], ["signed_up", "Signed up"], ["no_show", "No-show"], ["alumni", "Alumni"]];
const ago = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const d = Math.floor((Date.now() - t) / 86400000);
  return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`;
};
const full = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); };
const initials = (n: string, e: string) => (n || e).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

export function ContactProfile({ email, onClose }: { email: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ["/api/admin/contact-profile", email.toLowerCase()];
  const p = useQuery<Profile>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/admin/contact-profile?email=${encodeURIComponent(email)}`)).json() });
  const allTags = useQuery<{ tag: string; count: number }[]>({ queryKey: ["/api/admin/contact-tags"], queryFn: async () => (await apiRequest("GET", "/api/admin/contact-tags")).json() });
  const [tab, setTab] = useState<"timeline" | "mail" | "notes">("timeline");
  const [tagIn, setTagIn] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["/api/admin/contact-tags"] }); void qc.invalidateQueries({ queryKey: ["/api/admin/contacts"] }); };
  const setTags = async (tags: string[]) => {
    try { await apiRequest("PUT", "/api/admin/contact-profile/tags", { email, tags }); refresh(); } catch (e) { toast({ title: "Tags not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const addTag = (t: string) => { const v = t.trim().toLowerCase(); if (!v || !p.data || p.data.tags.includes(v)) return; setTagIn(""); void setTags([...p.data.tags, v]); };
  const setStage = async (stage: string) => {
    try { await apiRequest("PATCH", `/api/admin/contacts/${encodeURIComponent(email)}/lifecycle`, { stage }); refresh(); } catch (e) { toast({ title: "Not changed", description: (e as Error).message, variant: "destructive" }); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try { await apiRequest("POST", "/api/admin/contact-profile/notes", { email, text: note }); setNote(""); refresh(); } catch (e) { toast({ title: "Note not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const delNote = async (id: number) => { await apiRequest("DELETE", `/api/admin/contact-profile/notes/${id}`).catch(() => {}); refresh(); };
  const d = p.data;
  const rate = (n: number) => (d && d.stats.sent ? `${Math.round((n / d.stats.sent) * 100)}%` : "–");
  const suggestions = (allTags.data ?? []).map((t) => t.tag).filter((t) => !d?.tags.includes(t) && (!tagIn || t.includes(tagIn.toLowerCase()))).slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose} data-testid="contact-profile">
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative flex h-full w-full max-w-5xl flex-col overflow-y-auto border-l bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Who */}
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b bg-background/95 p-5 backdrop-blur">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#053877] text-lg font-bold text-white">{d ? initials(d.name, d.email) : ""}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold">{d?.name || email}</h2>
            <p className="truncate text-sm text-muted-foreground">{email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {d?.roles.map((r) => <span key={r} className="rounded-full bg-[#053877]/10 px-2 py-0.5 text-[11px] font-semibold text-[#053877] dark:text-[#8fb5e8]">{r}</span>)}
              {d?.contact ? (
                <select value={d.contact.stage} onChange={(e) => void setStage(e.target.value)} className="h-6 rounded-full border border-border bg-background px-2 text-[11px] font-semibold" aria-label="Stage">
                  {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : d && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Not in Contacts</span>}
              {!!d?.stats.waiting && <span className="rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-[11px] font-bold text-[#8a5a00] dark:text-[#F0A71F]">Waiting on a reply</span>}
            </div>
          </div>
          <Button onClick={() => setTab("mail")} className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="profile-email"><PenSquare className="h-4 w-4" /> Email them</Button>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        {p.isLoading || !d ? <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <div className="grid gap-5 p-5 lg:grid-cols-[18rem_1fr]">
            {/* What we know */}
            <aside className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[["Emails sent", String(d.stats.sent), d.stats.lastEmailedAt ? `last ${ago(d.stats.lastEmailedAt)}` : ""], ["Opened", String(d.stats.opened), rate(d.stats.opened)], ["Clicked", String(d.stats.clicked), rate(d.stats.clicked)], ["Wrote to us", String(d.stats.received), d.stats.lastWroteAt ? `last ${ago(d.stats.lastWroteAt)}` : ""]].map(([l, v, s]) => (
                  <div key={l} className="rounded-xl border p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</p><p className="mt-0.5 text-xl font-bold tabular-nums">{v}</p><p className="truncate text-[11px] text-muted-foreground">{s}</p></div>
                ))}
              </div>
              {d.stats.lastOpenedAt && <p className="text-xs text-muted-foreground">Last opened an email {ago(d.stats.lastOpenedAt)}.</p>}
              {d.stats.bounced > 0 && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{d.stats.bounced} {d.stats.bounced === 1 ? "email" : "emails"} bounced: check this address.</p>}

              {/* Tags */}
              <section className="rounded-xl border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Tag className="h-3.5 w-3.5" /> Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F]/20 py-0.5 pl-2 pr-1 text-xs font-semibold text-[#8a5a00] dark:text-[#F0A71F]">{t}<button type="button" onClick={() => void setTags(d.tags.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-black/10" aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button></span>)}
                  {!d.tags.length && <span className="text-xs text-muted-foreground">None yet.</span>}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); addTag(tagIn); }} className="mt-2 flex gap-1.5">
                  <Input value={tagIn} onChange={(e) => setTagIn(e.target.value)} placeholder="Add a tag: sponsor, vip, guest…" className="h-8 text-xs" data-testid="profile-tag" />
                  <Button type="submit" size="sm" variant="outline" className="h-8 px-2" disabled={!tagIn.trim()}><Plus className="h-3.5 w-3.5" /></Button>
                </form>
                {suggestions.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{suggestions.map((t) => <button key={t} type="button" onClick={() => addTag(t)} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-[#053877]/40 hover:text-foreground">+ {t}</button>)}</div>}
              </section>

              {/* Who they are to us */}
              {d.host && (
                <section className="rounded-xl border p-3 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Mic2 className="h-3.5 w-3.5" /> Podcaster</p>
                  <p className="font-semibold">{d.host.podcast}</p>
                  <p className="text-xs text-muted-foreground">{[d.host.hostName, d.host.branch, d.host.serviceStatus].filter(Boolean).join(" · ")}</p>
                </section>
              )}
              {(d.smartlink || d.shows.length > 0) && (
                <section className="space-y-1.5 rounded-xl border p-3 text-sm">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Globe className="h-3.5 w-3.5" /> On MilitaryVoices</p>
                  {d.smartlink && <a href={d.smartlink.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-[#053877] hover:underline dark:text-[#8fb5e8]">SmartLink: /{d.smartlink.handle} <ExternalLink className="h-3 w-3" /></a>}
                  {d.shows.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-[#053877] hover:underline dark:text-[#8fb5e8]">{s.title} · {s.episodes} ep <ExternalLink className="h-3 w-3" /></a>)}
                </section>
              )}
              {d.bookings.length > 0 && (
                <section className="rounded-xl border p-3 text-sm">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Bookings</p>
                  <ul className="space-y-1.5">{d.bookings.map((b) => <li key={`${b.role}-${b.id}`}><p className="font-medium">{b.podcast}{b.role === "cohost" ? " (co-host)" : ""}</p><p className="text-xs text-muted-foreground">{[b.event, b.when, b.status].filter(Boolean).join(" · ")}</p></li>)}</ul>
                </section>
              )}
            </aside>

            {/* What happened */}
            <section className="min-w-0">
              <div className="mb-3 flex gap-5 border-b" role="tablist">
                {([["timeline", "Timeline"], ["mail", "Emails"], ["notes", `Notes${d.notes.length ? ` (${d.notes.length})` : ""}`]] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 pb-2 text-sm font-semibold ${tab === k ? "border-[#053877] text-foreground dark:border-[#8fb5e8]" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`profile-tab-${k}`}>{l}</button>
                ))}
              </div>
              {tab === "timeline" && (
                <ol className="relative space-y-3 border-l-2 border-border pl-5" data-testid="profile-timeline">
                  {d.timeline.map((m, i) => {
                    const Icon = m.kind === "email-out" ? ArrowUpRight : m.kind === "email-in" ? ArrowDownLeft : m.kind === "booking" ? CalendarDays : m.kind === "cohost" ? Users : m.kind === "signup" ? UserPlus : m.kind === "reminder" ? Bell : m.kind === "note" ? StickyNote : Check;
                    return (
                      <li key={i} className="relative">
                        <span className={`absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-background ${m.kind === "email-in" ? "bg-[#F0A71F] text-[#1a1200]" : m.kind === "note" ? "bg-violet-500 text-white" : m.kind === "email-out" ? "bg-[#053877] text-white" : "bg-emerald-600 text-white"}`}><Icon className="h-3 w-3" /></span>
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <p className="text-sm font-medium">{m.kind === "email-in" ? `They wrote: ${m.title}` : m.kind === "note" ? "Note" : m.title}</p>
                          <span className="text-[11px] text-muted-foreground">{full(m.at)}</span>
                          {m.kind === "email-out" && (m.ok === false ? <span className="text-[11px] font-semibold text-destructive">Didn't send</span> : m.fate?.bounced ? <span className="text-[11px] font-semibold text-destructive">Bounced</span> : m.fate?.clicked ? <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600"><MousePointerClick className="h-3 w-3" /> Clicked</span> : m.fate?.opened ? <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600"><Eye className="h-3 w-3" /> Opened</span> : m.fate?.delivered ? <span className="text-[11px] font-semibold text-[#053877] dark:text-[#8fb5e8]">Delivered</span> : null)}
                        </div>
                        {m.kind === "note" ? <p className="mt-0.5 whitespace-pre-wrap text-sm">{m.title}<span className="block text-[11px] text-muted-foreground">{m.detail}</span></p>
                          : m.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.detail}</p>}
                      </li>
                    );
                  })}
                  {!d.timeline.length && <li className="text-sm text-muted-foreground">Nothing yet.</li>}
                </ol>
              )}
              {tab === "mail" && <div className="-mx-5 rounded-xl border"><ThreadView email={d.email} focus="" onChanged={refresh} /></div>}
              {tab === "notes" && (
                <div className="space-y-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="A note for the team: what they said on the phone, what they need, what's next…" data-testid="profile-note" />
                  <Button onClick={() => void addNote()} disabled={!note.trim()} className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"><StickyNote className="h-4 w-4" /> Save note</Button>
                  <ul className="space-y-2">
                    {d.notes.map((n) => (
                      <li key={n.id} className="rounded-xl border bg-violet-500/[0.04] p-3">
                        <p className="whitespace-pre-wrap text-sm">{n.text}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{n.author || "The team"} · {full(n.at)}</span><button type="button" onClick={() => void delNote(n.id)} className="ml-auto rounded p-1 hover:text-destructive" aria-label="Delete note"><Trash2 className="h-3.5 w-3.5" /></button></div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
