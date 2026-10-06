import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CalendarPlus, Copy, ExternalLink, Loader2, MonitorPlay, Send, Users } from "lucide-react";

// An event planner's events (6 Oct): create one, shape it, send it to us to
// approve, then share its page and run its studio. Drafts are private; nothing
// goes public until we've approved it.

type MyEvent = {
  id: number; slug: string; name: string; tagline: string; description: string; occasion: string;
  startAtUtc: string; durationHours: number; slotMinutes: number; onAirMinutes: number; bufferMinutes: number;
  review: "draft" | "pending" | "approved" | string; visible: boolean; booked: number; slots: number; pageUrl: string; bookUrl: string;
};
type Booking = { id: number; hostName: string; podcastName: string; email: string; at: string };

const STATUS: Record<string, { label: string; tone: string; line: string }> = {
  draft: { label: "Draft", tone: "bg-muted text-muted-foreground", line: "Only you can see it. Send it to us when it's ready." },
  pending: { label: "Waiting for approval", tone: "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]", line: "We're looking at it. You'll hear from us within a working day." },
  approved: { label: "Live", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", line: "Public, taking bookings, and your studio is open." },
};

// <input type="datetime-local"> works in the browser's own zone; the server keeps UTC.
const toLocalInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function EventForm({ initial, onSaved, onCancel }: { initial?: MyEvent; onSaved: (e: MyEvent) => void; onCancel?: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [start, setStart] = useState(initial ? toLocalInput(initial.startAtUtc) : "");
  const [hours, setHours] = useState(initial?.durationHours ?? 4);
  const [slot, setSlot] = useState(initial?.slotMinutes ?? 30);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, tagline, description, startAtUtc: new Date(start).toISOString(), durationHours: hours, slotMinutes: slot, onAirMinutes: Math.max(5, slot - 5), bufferMinutes: Math.min(5, slot - 5) };
      const r = await apiRequest(initial ? "PUT" : "POST", initial ? `/api/host/my-events/${initial.id}` : "/api/host/my-events", body);
      onSaved((await r.json()) as MyEvent);
      toast({ title: initial ? "Saved" : "Your event is created", description: initial ? undefined : "It's a private draft. Send it to us when it's ready." });
    } catch (err) {
      toast({ title: "Couldn't save", description: (err as Error).message, variant: "destructive" });
    }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4 rounded-2xl border border-border bg-card p-5" data-testid="my-event-form">
      <div>
        <Label htmlFor="ev-name">Event name</Label>
        <Input id="ev-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Veterans Day Live" required />
      </div>
      <div>
        <Label htmlFor="ev-tag">One line about it</Label>
        <Input id="ev-tag" className="mt-1.5" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="A day of stories from the people who served" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="ev-start">Starts</Label>
          <Input id="ev-start" type="datetime-local" className="mt-1.5" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="ev-hours">How long (hours)</Label>
          <Input id="ev-hours" type="number" min={1} max={48} className="mt-1.5" value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ev-slot">Each slot (minutes)</Label>
          <Input id="ev-slot" type="number" min={10} max={240} step={5} className="mt-1.5" value={slot} onChange={(e) => setSlot(Number(e.target.value))} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{Math.floor((hours * 60) / Math.max(10, slot))} slots for speakers or shows, each with five minutes for the hand-off.</p>
      <div>
        <Label htmlFor="ev-desc">What it is</Label>
        <Textarea id="ev-desc" rows={4} className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it's for, what happens, and why it matters." />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim() || !start} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{initial ? "Save" : "Create my event"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function EventDetail({ ev, onBack, onChanged }: { ev: MyEvent; onBack: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(ev.review !== "approved" && ev.booked === 0 && !ev.description);
  const { data: lineup = [] } = useQuery<Booking[]>({ queryKey: ["/api/host/my-events", ev.id, "lineup"], queryFn: async () => (await apiRequest("GET", `/api/host/my-events/${ev.id}/lineup`)).json() });
  const st = STATUS[ev.review] ?? STATUS.draft;
  const submit = async () => {
    try { await apiRequest("POST", `/api/host/my-events/${ev.id}/submit`); toast({ title: "Sent to us for approval", description: "We'll look within a working day." }); onChanged(); }
    catch (err) { toast({ title: "Couldn't send it", description: (err as Error).message, variant: "destructive" }); }
  };
  const copy = async (t: string) => { await navigator.clipboard.writeText(t); toast({ title: "Link copied" }); };
  return (
    <div className="space-y-5" data-testid="my-event-detail">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> All my events</button>
      <section className="rounded-2xl bg-[#04102b] p-6 text-white">
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">{ev.name}</h2>
        <p className="mt-1 text-sm text-white/70">{when(ev.startAtUtc)} · {ev.durationHours} hours · {ev.booked} of {ev.slots} slots booked</p>
        <p className="mt-3 text-sm text-white/80">{st.line}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {ev.review === "draft" && <Button onClick={() => void submit()} className="gap-2 bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]"><Send className="h-4 w-4" /> Send it to us to approve</Button>}
          {ev.review === "approved" && (
            <>
              <a href={ev.pageUrl} target="_blank" rel="noreferrer"><Button variant="outline" className="gap-2 border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"><ExternalLink className="h-4 w-4" /> Event page</Button></a>
              <Button variant="outline" className="gap-2 border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => void copy(ev.bookUrl)}><Copy className="h-4 w-4" /> Copy the booking link</Button>
              <a href="/studio/control"><Button className="gap-2 bg-[#15834f] text-white hover:bg-[#126e42]"><MonitorPlay className="h-4 w-4" /> Open the studio</Button></a>
            </>
          )}
          {!editing && <Button variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setEditing(true)}>Edit details</Button>}
        </div>
      </section>
      {editing && <EventForm initial={ev} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4" /> Who's booked</h3>
        {lineup.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{ev.review === "approved" ? "Nobody yet. Share the booking link with your speakers." : "Bookings open once it's approved."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {lineup.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{b.hostName}</span><span className="block truncate text-xs text-muted-foreground">{b.podcastName} · {b.email}</span></span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(b.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function MyEvents() {
  const qc = useQueryClient();
  const { data: list = [], isLoading } = useQuery<MyEvent[]>({ queryKey: ["/api/host/my-events"], queryFn: async () => (await apiRequest("GET", "/api/host/my-events")).json() });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/api/host/my-events"] });
  const open = list.find((e) => e.id === openId);
  if (open) return <EventDetail ev={open} onBack={() => setOpenId(null)} onChanged={refresh} />;
  return (
    <div className="space-y-5" data-testid="my-events">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">My events</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create an event, send it to us to approve, then share its page and run it from the studio.</p>
        </div>
        {!creating && list.length > 0 && <Button className="gap-2" onClick={() => setCreating(true)}><CalendarPlus className="h-4 w-4" /> New event</Button>}
      </div>
      {(creating || (!isLoading && list.length === 0)) && (
        <EventForm onSaved={(e) => { setCreating(false); refresh(); setOpenId(e.id); }} onCancel={list.length ? () => setCreating(false) : undefined} />
      )}
      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((e) => {
            const st = STATUS[e.review] ?? STATUS.draft;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setOpenId(e.id)} className="flex h-full w-full flex-col rounded-2xl border border-border bg-card p-5 text-left transition hover:border-[#053877]/50" data-testid={`my-event-${e.id}`}>
                  <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
                  <span className="mt-2 text-lg font-semibold">{e.name}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{when(e.startAtUtc)}</span>
                  <span className="mt-2 text-xs text-muted-foreground">{e.booked} of {e.slots} slots booked</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
