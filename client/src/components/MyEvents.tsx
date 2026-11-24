import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CalendarDays, CalendarPlus, Check, Copy, Download, ExternalLink, Loader2, MapPin, MonitorPlay, Plus, Users, X } from "lucide-react";
import { COMMON_ZONES, US_ZONES, SPOTLIGHT_ZONES, detectLocalTimeZone, utcToDateTimeLocalValue, dateTimeLocalToUtc, zoneLabel } from "@/lib/schedule";
import { eventDay, eventTimes, zoneShort, type EventQuestion } from "@shared/eventTime";

// Members' own events (6 Oct; reworked 24 Nov 2026, Andrew: "Yes, build free first", mockup approved).
// Creating one publishes it: its page and /events. "Just me" (one host, one time) or "A lineup" (podcasters book
// slots). Free sign-up with up to five questions of their own; paid tickets are coming. A counted link per network.

type MyEvent = {
  id: number; slug: string; name: string; tagline: string; description: string; occasion: string;
  startAtUtc: string; durationHours: number; slotMinutes: number; onAirMinutes: number; bufferMinutes: number;
  venueName: string; venueAddress: string; airport: string;
  kind: string; mode: string; timezone: string; endAtUtc: string; signupMode: string; questions: EventQuestion[]; joinUrl: string;
  review: "draft" | "pending" | "approved" | string; visible: boolean; booked: number; slots: number; registered: number;
  clicks: Record<string, number>; pageUrl: string; bookUrl: string; shareUrl: string;
};
type Booking = { id: number; hostName: string; podcastName: string; email: string; at: string };
type Registration = { id: number; name: string; email: string; src: string; at: string; answers: { q: string; a: string }[] };

const ET = "America/New_York";
const zoneOf = (e: Pick<MyEvent, "timezone">) => e.timezone || ET;
const endOf = (e: Pick<MyEvent, "startAtUtc" | "endAtUtc" | "durationHours">) => e.endAtUtc || new Date(Date.parse(e.startAtUtc) + e.durationHours * 3600000).toISOString();
const whenLine = (e: MyEvent) => `${eventDay(e.startAtUtc, zoneOf(e))} · ${eventTimes(e.startAtUtc, endOf(e), zoneOf(e))}`;
const placeLine = (e: MyEvent) => (e.mode === "person" || (!e.mode && e.venueAddress) ? [e.venueName, e.venueAddress].filter(Boolean).join(", ") : "Online");

function status(e: MyEvent) {
  if (e.review === "approved" && e.visible) return { label: "Live", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (e.review === "approved") return { label: "Taken down", tone: "bg-muted text-muted-foreground" };
  return { label: "Not published", tone: "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" };
}

/** The zones to pick from: theirs first, then the US, then the overseas ones our people are often in. */
function zoneOptions(current: string) {
  const mine = detectLocalTimeZone();
  const ids = Array.from(new Set([current, mine, ...US_ZONES.map((z) => z.id), "America/Phoenix", "Pacific/Honolulu", ...SPOTLIGHT_ZONES.map((z) => z.id), "UTC"].filter(Boolean)));
  return ids.map((id) => ({ id, label: `${COMMON_ZONES.find((z) => z.id === id)?.label ?? zoneLabel(id)} (${zoneShort(id)})` }));
}

const seg = (on: boolean) => `flex-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-center text-[13.5px] font-semibold ${on ? "bg-[#053877] text-white" : "text-muted-foreground hover:bg-muted"}`;

function EventForm({ initial, onSaved, onCancel }: { initial?: MyEvent; onSaved: (e: MyEvent) => void; onCancel?: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<"me" | "lineup">(initial ? (initial.kind === "me" ? "me" : "lineup") : "me");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [mode, setMode] = useState<"online" | "person">(initial ? (initial.mode === "person" || (!initial.mode && initial.venueAddress) ? "person" : "online") : "online");
  const [venueName, setVenueName] = useState(initial?.venueName ?? "");
  const [venueAddress, setVenueAddress] = useState(initial?.venueAddress ?? "");
  const [joinUrl, setJoinUrl] = useState(initial?.joinUrl ?? "");
  const [tz, setTz] = useState(initial?.timezone || (initial ? ET : detectLocalTimeZone()));
  const startLocal = initial ? utcToDateTimeLocalValue(new Date(initial.startAtUtc), initial.timezone || ET) : "";
  const endLocal = initial ? utcToDateTimeLocalValue(new Date(endOf(initial)), initial.timezone || ET) : "";
  const [date, setDate] = useState(startLocal.slice(0, 10));
  const [from, setFrom] = useState(startLocal.slice(11, 16));
  const [to, setTo] = useState(endLocal.slice(11, 16));
  const [slot, setSlot] = useState(initial?.slotMinutes ?? 30);
  const [signup, setSignup] = useState<"none" | "free">(initial?.signupMode === "none" ? "none" : "free");
  const [questions, setQuestions] = useState<EventQuestion[]>(initial?.questions ?? []);
  const [busy, setBusy] = useState(false);

  const setQ = (i: number, patch: Partial<EventQuestion>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const ready = name.trim() && date && from && to;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const start = dateTimeLocalToUtc(`${date}T${from}`, tz);
      let end = dateTimeLocalToUtc(`${date}T${to}`, tz);
      // Ends at or before it starts: it runs past midnight.
      if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
      const mins = Math.round((end.getTime() - start.getTime()) / 60000);
      const body = {
        kind, name, description, mode, timezone: tz, signupMode: signup,
        startAtUtc: start.toISOString(), endAtUtc: end.toISOString(), durationHours: Math.max(1, Math.ceil(mins / 60)),
        venueName: mode === "person" ? venueName : "", venueAddress: mode === "person" ? venueAddress : "",
        joinUrl: mode === "online" ? joinUrl.trim() : "",
        questions: signup === "free" ? questions.filter((q) => q.q.trim()) : [],
        ...(kind === "lineup" ? { slotMinutes: slot, onAirMinutes: Math.max(5, slot - 5), bufferMinutes: Math.min(5, slot - 5) } : {}),
      };
      const r = await apiRequest(initial ? "PUT" : "POST", initial ? `/api/host/my-events/${initial.id}` : "/api/host/my-events", body);
      onSaved((await r.json()) as MyEvent);
      toast({ title: initial ? "Saved" : "Your event is live", description: initial ? undefined : "It's on its own page and on Events. Share it below." });
    } catch (err) {
      toast({ title: "Couldn't save", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    }
    setBusy(false);
  };

  const kindCard = (k: "me" | "lineup", title: string, line: string) => (
    <button type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
      className={`flex flex-1 items-start gap-3 rounded-2xl border-2 p-3.5 text-left ${kind === k ? "border-[#053877] bg-[#053877]/[0.04] dark:border-[#8ab4f8]" : "border-border bg-card hover:border-[#053877]/40"}`} data-testid={`event-kind-${k}`}>
      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{title}</span><span className="block text-[12.5px] leading-snug text-muted-foreground">{line}</span></span>
      <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${kind === k ? "border-[#053877] bg-[#053877] shadow-[inset_0_0_0_3px_#fff] dark:border-[#8ab4f8] dark:bg-[#8ab4f8]" : "border-muted-foreground/40"}`} />
    </button>
  );

  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-x-8 gap-y-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-2 lg:p-6" data-testid="my-event-form">
      <div className="space-y-4">
        <div>
          <span className="text-[13px] font-semibold">What kind of event?</span>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="What kind of event">
            {kindCard("me", "Just me", "One host, one time")}
            {kindCard("lineup", "A lineup", "Podcasters book slots")}
          </div>
        </div>
        <div>
          <Label htmlFor="ev-name">Event name</Label>
          <Input id="ev-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Veterans Coffee & Stories" required data-testid="event-name" />
        </div>
        <div>
          <span className="text-[13px] font-semibold">Where</span>
          <div className="mt-1.5 flex max-w-[260px] rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Where it happens">
            {(["online", "person"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={seg(mode === m)} data-testid={`event-mode-${m}`}>{m === "online" ? "Online" : "In person"}</button>)}
          </div>
          {mode === "person" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="ev-venue">Venue</Label><Input id="ev-venue" className="mt-1.5" value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Hall, post or hotel" /></div>
              <div><Label htmlFor="ev-addr">Address</Label><Input id="ev-addr" className="mt-1.5" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} placeholder="Street, city, state" /></div>
            </div>
          ) : (
            <div className="mt-3">
              <Label htmlFor="ev-join">Where people join or watch</Label>
              <Input id="ev-join" type="url" className="mt-1.5" value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} placeholder="A Zoom, YouTube or studio link" data-testid="event-join" />
              <p className="mt-1 text-[11.5px] text-muted-foreground">{signup === "none" ? "It shows on your event page." : "Only people who sign up see it."}</p>
            </div>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">When</span>
            <select aria-label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} className="h-8 max-w-[220px] rounded-lg border border-border bg-background px-2 text-[12.5px]" data-testid="event-zone">
              {zoneOptions(tz).map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </div>
          <div className={`mt-1 grid gap-3 ${kind === "lineup" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            <div><Label htmlFor="ev-date" className="text-[11.5px] font-normal text-muted-foreground">Date</Label><Input id="ev-date" type="date" className="mt-0.5" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="event-date" /></div>
            <div><Label htmlFor="ev-from" className="text-[11.5px] font-normal text-muted-foreground">Starts</Label><Input id="ev-from" type="time" className="mt-0.5" value={from} onChange={(e) => setFrom(e.target.value)} required data-testid="event-from" /></div>
            <div><Label htmlFor="ev-to" className="text-[11.5px] font-normal text-muted-foreground">Ends</Label><Input id="ev-to" type="time" className="mt-0.5" value={to} onChange={(e) => setTo(e.target.value)} required data-testid="event-to" /></div>
            {kind === "lineup" && <div><Label htmlFor="ev-slot" className="text-[11.5px] font-normal text-muted-foreground">Each slot (min)</Label><Input id="ev-slot" type="number" min={10} max={240} step={5} className="mt-0.5" value={slot} onChange={(e) => setSlot(Number(e.target.value))} /></div>}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <span className="text-[13px] font-semibold">Do people sign up?</span>
          <div className="mt-1.5 flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Do people sign up">
            <button type="button" role="radio" aria-checked={signup === "none"} onClick={() => setSignup("none")} className={seg(signup === "none")} data-testid="event-signup-none">No, just show up</button>
            <button type="button" role="radio" aria-checked={signup === "free"} onClick={() => setSignup("free")} className={seg(signup === "free")} data-testid="event-signup-free">Yes, free</button>
            {/* Paid tickets are coming (Andrew via PM, 24 Nov: "build free first"). */}
            <span role="radio" aria-checked="false" aria-disabled="true" title="Paid tickets are coming soon" className="flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] font-semibold text-muted-foreground/60" data-testid="event-signup-paid">
              Paid <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground">Coming soon</span>
            </span>
          </div>
          {signup === "free" ? (
            <div className="mt-3" data-testid="event-questions">
              <div className="flex items-baseline justify-between"><span className="text-[13px] font-semibold">Questions on the sign-up form</span><span className="text-[11.5px] tabular-nums text-muted-foreground">{questions.length} of 5</span></div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">Name and email are always asked.</p>
              <div className="mt-2 space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="rounded-xl border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <Input aria-label={`Question ${i + 1}`} value={q.q} onChange={(e) => setQ(i, { q: e.target.value })} placeholder="e.g. Which branch did you serve in?" className="h-9" />
                      <select aria-label="Answer type" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as EventQuestion["type"], options: e.target.value === "choice" && q.options.length < 2 ? ["Yes", "No"] : q.options })} className="h-9 shrink-0 rounded-lg border border-border bg-background px-2 text-[12.5px]">
                        <option value="text">Short answer</option>
                        <option value="choice">Pick one</option>
                      </select>
                      <button type="button" aria-label="Remove this question" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
                    </div>
                    {q.type === "choice" && (
                      <Input aria-label="Choices" value={q.options.join(", ")} onChange={(e) => setQ(i, { options: e.target.value.split(",").map((s) => s.trimStart()) })} placeholder="Choices, with commas: Yes, No" className="mt-2 h-9 text-[13px]" />
                    )}
                  </div>
                ))}
              </div>
              {questions.length < 5 && (
                <button type="button" onClick={() => setQuestions((qs) => [...qs, { q: "", type: "text", options: [] }])} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] font-semibold text-[#053877] hover:bg-muted dark:text-[#8ab4f8]" data-testid="event-add-question">
                  <Plus className="h-3.5 w-3.5" /> Add a question
                </button>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">The page shows when and where. Nobody signs up.</p>
          )}
        </div>
        <div>
          <Label htmlFor="ev-desc">What it is</Label>
          <Textarea id="ev-desc" rows={3} className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it's for, what happens, and why it matters." />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !ready} className="h-11 gap-2 rounded-full bg-[#053877] px-6 text-white hover:bg-[#0a4a99]" data-testid="event-create">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{initial ? "Save" : "Create my event"}</Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
          {!initial && <span className="text-[12.5px] text-muted-foreground">It goes live right away, on its own page and on Events.</span>}
        </div>
      </div>
    </form>
  );
}

const NETWORKS: [string, string][] = [["LinkedIn", "linkedin"], ["Facebook", "facebook"], ["X", "x"], ["Instagram bio", "instagram"], ["Email", "email"], ["Text message", "sms"]];

function EventDetail({ ev, onBack, onChanged }: { ev: MyEvent; onBack: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState("");
  const lineupKind = ev.kind !== "me";
  const { data: lineup = [] } = useQuery<Booking[]>({ queryKey: ["/api/host/my-events", ev.id, "lineup"], queryFn: async () => (await apiRequest("GET", `/api/host/my-events/${ev.id}/lineup`)).json(), enabled: lineupKind });
  const { data: regs = [] } = useQuery<Registration[]>({ queryKey: ["/api/host/my-events", ev.id, "registrations"], queryFn: async () => (await apiRequest("GET", `/api/host/my-events/${ev.id}/registrations`)).json() });
  const st = status(ev);
  const live = ev.review === "approved";
  const publish = async () => {
    try { await apiRequest("POST", `/api/host/my-events/${ev.id}/submit`); toast({ title: "Your event is live" }); onChanged(); }
    catch (err) { toast({ title: "Couldn't publish it", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" }); }
  };
  const copy = async (t: string, key: string) => {
    try { await navigator.clipboard.writeText(t); } catch { /* shown on screen to copy by hand */ }
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };
  const clicks = Object.values(ev.clicks ?? {}).reduce((a, b) => a + b, 0);
  const days = Math.ceil((Date.parse(ev.startAtUtc) - Date.now()) / 86400000);
  const download = () => {
    const qs = Array.from(new Set(regs.flatMap((r) => r.answers.map((a) => a.q))));
    const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Name", "Email", ...qs, "Came from", "Signed up"], ...regs.map((r) => [r.name, r.email, ...qs.map((q) => r.answers.find((a) => a.q === q)?.a ?? ""), r.src, r.at.slice(0, 10)])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${ev.slug}-sign-ups.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyBtn = (key: string, text: string) => (
    <button type="button" onClick={() => void copy(text, key)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12.5px] font-semibold text-[#053877] hover:bg-muted dark:text-[#8ab4f8]" data-testid={`event-copy-${key}`}>
      {copied === key ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
    </button>
  );

  return (
    <div className="space-y-4" data-testid="my-event-detail">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> All my events</button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label === "Live" ? "● " : ""}{st.label}</span>
          <h2 className="mt-1.5 text-[28px] font-bold leading-tight tracking-tight">{ev.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {whenLine(ev)}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {placeLine(ev)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!live && <Button onClick={() => void publish()} className="rounded-full bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]" data-testid="event-publish">Publish it</Button>}
          <Button variant="outline" className="rounded-full" onClick={() => setEditing((v) => !v)} data-testid="event-edit">{editing ? "Close" : "Edit"}</Button>
          <a href={ev.pageUrl} target="_blank" rel="noreferrer"><Button className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"><ExternalLink className="h-4 w-4" /> View the page</Button></a>
        </div>
      </div>
      {editing && <EventForm initial={ev} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />}

      <div className="grid grid-cols-3 gap-3">
        {[[String(clicks), "clicks on your links"], lineupKind && ev.signupMode !== "free" ? [`${ev.booked} of ${ev.slots}`, "slots booked"] : [String(ev.registered), ev.signupMode === "free" ? "signed up" : "sign-ups (off)"], days > 1 ? [`${days} days`, "to go"] : days === 1 ? ["1 day", "to go"] : Date.parse(endOf(ev)) > Date.now() ? ["Today", "it's on"] : ["Over", "thanks for hosting"]].map(([a, b]) => (
          <div key={b} className="rounded-2xl border border-border bg-card px-4 py-3"><div className="text-2xl font-bold leading-none tabular-nums">{a}</div><div className="mt-1 text-[12.5px] text-muted-foreground">{b}</div></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <section className="min-w-0 rounded-2xl border border-border bg-card p-5" data-testid="event-share">
          <h3 className="text-lg font-bold">Share your event</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Copy the link for where you're posting it. Each one counts its own clicks.</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{ev.shareUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
            {copyBtn("link", ev.shareUrl)}
          </div>
          <ul className="mt-1 divide-y divide-border">
            {NETWORKS.map(([label, key]) => (
              <li key={key} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{label}</span>
                <span className="w-[70px] shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">{ev.clicks?.[key] ?? 0} {(ev.clicks?.[key] ?? 0) === 1 ? "click" : "clicks"}</span>
                {copyBtn(key, `${ev.shareUrl}?src=${key}`)}
              </li>
            ))}
          </ul>
        </section>

        <div className="min-w-0 space-y-4">
          {(ev.signupMode === "free" || regs.length > 0) && (
            <section className="rounded-2xl border border-border bg-card p-5" data-testid="event-registrations">
              <h3 className="text-lg font-bold">Who's signed up</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{regs.length} {regs.length === 1 ? "person" : "people"}{regs.length > 0 && <> · <button type="button" onClick={download} className="inline-flex items-center gap-1 font-semibold text-[#053877] hover:underline dark:text-[#8ab4f8]"><Download className="h-3.5 w-3.5" /> Download the list</button></>}</p>
              {regs.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">Nobody yet. Share a link and they'll show up here.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-[13px]">
                  {regs.slice(0, 50).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0"><span className="block truncate font-semibold">{r.name}</span><span className="block truncate text-[12px] text-muted-foreground">{r.email}</span></span>
                      <span className="min-w-0 truncate text-right text-muted-foreground">{r.answers.map((a) => a.a).filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {lineupKind && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-lg font-bold"><Users className="h-4 w-4" /> Who's booked</h3>
                <span className="flex gap-2">
                  {copyBtn("booking", ev.bookUrl)}
                  <a href="/studio/control"><Button size="sm" className="h-8 gap-1.5 rounded-full bg-[#15834f] text-white hover:bg-[#126e42]"><MonitorPlay className="h-3.5 w-3.5" /> Studio</Button></a>
                </span>
              </div>
              {lineup.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">Nobody yet. Copy the booking link for your podcasters.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {lineup.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0"><span className="block truncate font-medium">{b.hostName}</span><span className="block truncate text-xs text-muted-foreground">{b.podcastName} · {b.email}</span></span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(b.at).toLocaleTimeString("en-US", { timeZone: zoneOf(ev), hour: "numeric", minute: "2-digit" })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Events: the ones they run, and (when they hold a slot in one) a way into the one they are part of. */
export function MyEvents({ inCount = 0, onOpenIn }: { inCount?: number; onOpenIn?: () => void } = {}) {
  const qc = useQueryClient();
  const { data: list = [], isLoading } = useQuery<MyEvent[]>({ queryKey: ["/api/host/my-events"], queryFn: async () => (await apiRequest("GET", "/api/host/my-events")).json() });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/api/host/my-events"] });
  const open = list.find((e) => e.id === openId);
  if (open) return <EventDetail ev={open} onBack={() => setOpenId(null)} onChanged={refresh} />;
  const showForm = creating || (!isLoading && list.length === 0);
  return (
    <div className="space-y-4" data-testid="my-events">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[28px] font-bold leading-tight tracking-tight">{showForm ? "Create an event" : "Events"}</h2>
          {!showForm && <p className="mt-1 text-sm text-muted-foreground">Your events go live when you create them. Share the links, and see who signed up.</p>}
        </div>
        {!creating && list.length > 0 && <Button className="gap-2 rounded-full" onClick={() => setCreating(true)} data-testid="event-new"><CalendarPlus className="h-4 w-4" /> New event</Button>}
      </div>
      {inCount > 0 && onOpenIn && (
        <button type="button" onClick={onOpenIn} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#F0A71F]/50 bg-[#F0A71F]/[0.08] p-4 text-left transition hover:bg-[#F0A71F]/[0.14]" data-testid="my-events-in">
          <span>
            <span className="block font-semibold text-foreground">You're in {inCount === 1 ? "an event" : `${inCount} events`}</span>
            <span className="block text-sm text-muted-foreground">Your time slot, your show details and how to promote it.</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-[#053877] dark:text-[#8fb5e8]">Open</span>
        </button>
      )}
      {showForm && <EventForm onSaved={(e) => { setCreating(false); refresh(); setOpenId(e.id); }} onCancel={list.length ? () => setCreating(false) : undefined} />}
      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((e) => {
            const st = status(e);
            const clicks = Object.values(e.clicks ?? {}).reduce((a, b) => a + b, 0);
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setOpenId(e.id)} className="flex h-full w-full flex-col rounded-2xl border border-border bg-card p-5 text-left transition hover:border-[#053877]/50" data-testid={`my-event-${e.id}`}>
                  <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
                  <span className="mt-2 text-lg font-semibold">{e.name}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{whenLine(e)}</span>
                  <span className="mt-2 text-xs text-muted-foreground">{e.kind !== "me" && e.signupMode !== "free" ? `${e.booked} of ${e.slots} slots booked` : `${e.registered} signed up`} · {clicks} {clicks === 1 ? "click" : "clicks"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
