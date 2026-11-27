import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGet, adminSend } from "@/lib/adminApi";

/**
 * Track R, Packet R-B (Andrew OK'd the mockup, 26 Nov): the events MilitaryVoices.ai runs (Radio, the Marathon studio,
 * each LIVE production), picked from the admin top bar and listed in Admin → MV events. Member events and personal
 * studios never appear here. The Marathon is one MV event, not the template, so a new MV event starts blank.
 *
 * Shapes from server/mvEvents.ts (Podcasting, 9585e087). Until GET /api/admin/mv-events answers, Admin keeps today's
 * Events screen and shows no picker.
 */
export type MvProgram = "marathon" | "radio" | "live" | "";
export type MvStatus = "live" | "upcoming" | "past";
export type MvEventStudio = { id: number; name: string };
export type MvEventDay = { id: number; name: string; startAt: string; endAt: string; status: MvStatus; studios: MvEventStudio[] };
export type MvEventEntry = {
  /** For Radio, the first day's id; every admin call needs a real day, so open one with openId(). */
  id: number;
  name: string;
  program: MvProgram;
  slug: string;
  startAt: string;
  endAt: string;
  status: MvStatus;
  visible: boolean;
  featured: boolean;
  studios: MvEventStudio[];
  days?: MvEventDay[];
};
export type MvEventsResponse = { events: MvEventEntry[]; fallbacks: unknown[]; counts?: unknown };

/** Creating an MV event waits on POST /api/admin/mv-events (Podcasting's commit b). Off hides "New MV event". */
export const CREATE_ON = false;

/** The event id to open: the entry's own, or for Radio today's day if it's on, else the next one, else the last. */
export function openId(e: MvEventEntry): number {
  const days = (e.days ?? []).slice().sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
  if (!days.length) return e.id;
  return (days.find((d) => d.status === "live") ?? days.find((d) => d.status === "upcoming") ?? days[days.length - 1]).id;
}

const KEY = ["/api/admin/mv-events"] as const;
const PICK = "mv_admin_pick";

export function useMvEvents(enabled = true) {
  return useQuery<MvEventsResponse, Error>({ queryKey: KEY, queryFn: () => adminGet<MvEventsResponse>("/api/admin/mv-events"), enabled, retry: false, staleTime: 60_000 });
}

/** The event the picker shows: the one in the address, else the last one picked, else the featured one (day one = today). */
export function pickedEvent(events: MvEventEntry[], inAddress: number | null): MvEventEntry | null {
  const own = (id: number) => events.find((e) => e.id === id || e.days?.some((d) => d.id === id)) ?? null;
  if (inAddress) return own(inAddress);
  let last = 0;
  try { last = Number(localStorage.getItem(PICK)) || 0; } catch { /* private window */ }
  return (last ? own(last) : null) ?? events.find((e) => e.featured) ?? events[0] ?? null;
}

const TAG: Record<string, [string, string]> = {
  live: ["LIVE", "bg-[#3a7be0]/15 text-[#2d63b8] dark:text-[#8db6f0]"],
  radio: ["RADIO", "bg-[#1a9e5f]/15 text-[#15834f] dark:text-[#6fe0a2]"],
  marathon: ["MARATHON", "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#f2c95e]"],
  "": ["EVENT", "bg-muted text-muted-foreground"],
};
export function ProgramTag({ program }: { program: MvProgram }) {
  const [label, cls] = TAG[program] ?? TAG[""];
  return <span className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${cls}`}>{label}</span>;
}
function LiveSite() {
  return <span className="ml-1.5 inline-flex shrink-0 rounded-md bg-[#F0A71F] px-1.5 py-0.5 text-[11px] font-bold text-[#1a1200]">Live site</span>;
}

/** Dates are read in Eastern time, where MV events run. */
const ET = "America/New_York";
function parts(iso: string) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "short", day: "numeric", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, wd: p.weekday, key: `${p.year}-${p.month}-${p.day}` };
}
/** "Mon, Oct 5", "Nov 16–20", "Jul 24–27, 2027" (the year only when it isn't this one, or `year` asks for it). */
export function mvDates(e: { startAt: string; endAt: string }, year = false) {
  if (!e.startAt || Number.isNaN(Date.parse(e.startAt))) return "Dates not set";
  const a = parts(e.startAt);
  // An event that ends at midnight belongs to the day before.
  const b = parts(e.endAt && Date.parse(e.endAt) > Date.parse(e.startAt) ? new Date(Date.parse(e.endAt) - 1).toISOString() : e.startAt);
  const y = year || b.y !== parts(new Date().toISOString()).y ? `, ${b.y}` : "";
  if (a.key === b.key) return `${a.wd}, ${a.m} ${a.d}${y}`;
  if (a.m === b.m && a.y === b.y) return `${a.m} ${a.d}–${b.d}${y}`;
  return `${a.m} ${a.d} – ${b.m} ${b.d}${y}`;
}
const STATUS: Record<MvStatus, string> = { live: "On now", upcoming: "Upcoming", past: "Done" };
export const mvStatus = (e: { status: MvStatus; visible?: boolean }) => `${STATUS[e.status] ?? e.status}${e.visible === false ? " · Hidden" : ""}`;
const dayLabel = (d: MvEventDay) => {
  const a = parts(d.startAt);
  return `${a.wd}, ${a.m} ${a.d}`;
};
const timeRange = (d: MvEventDay) => {
  const f = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "\u202f").toLowerCase();
  return `${f(d.startAt)}–${f(d.endAt)} ET`;
};

/** "Event: The Podcast Marathon ▾" in the admin top bar. Picking one opens its dashboard and is remembered. */
export function MvEventPicker({ events, current, day, platform = true, onOpen, onAll }: { events: MvEventEntry[]; current: MvEventEntry | null; day?: number | null; platform?: boolean; onOpen: (id: number) => void; onAll: (create?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const choose = (e: MvEventEntry) => {
    try { localStorage.setItem(PICK, String(e.id)); } catch { /* fine */ }
    setOpen(false);
    onOpen(openId(e));
  };
  // On one of Radio's days, say which.
  const onDay = current?.days && current.days.length > 1 ? current.days.find((d) => d.id === day) : undefined;
  return (
    <div ref={box} className="relative min-w-0" data-testid="mv-event-picker">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}
        className={`flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-semibold shadow-sm hover:bg-muted ${open ? "border-primary ring-2 ring-primary/25" : "border-border"}`}>
        <span className="font-medium text-muted-foreground">Event:</span>
        <span className="min-w-0 truncate">{current?.name ?? "Pick an event"}{onDay ? ` · ${dayLabel(onDay)}` : ""}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div role="listbox" className="fixed inset-x-3 top-24 z-50 rounded-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-10 sm:w-[min(640px,calc(100vw-2rem))] border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">MV events</p>
          {events.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">No MV events yet.</p>}
          {events.map((e) => (
            <button key={e.id} type="button" role="option" aria-selected={current?.id === e.id} onClick={() => choose(e)}
              className={`grid w-full grid-cols-[84px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted sm:grid-cols-[84px_minmax(0,1fr)_130px_96px] ${current?.id === e.id ? "bg-muted" : ""}`}
              data-testid={`mv-pick-${e.id}`}>
              <ProgramTag program={e.program} />
              <span className="flex min-w-0 items-center font-semibold"><span className="truncate">{e.name}</span>{e.featured && <LiveSite />}</span>
              <span className="hidden whitespace-nowrap text-[12.5px] text-muted-foreground sm:block">{mvDates(e)}{e.days && e.days.length > 1 ? ` · ${e.days.length} days` : ""}</span>
              <span className="hidden whitespace-nowrap text-[12.5px] text-muted-foreground sm:block">{mvStatus(e)}</span>
            </button>
          ))}
          {platform && <div className="mt-1 flex justify-between border-t border-border px-2.5 pb-1 pt-2 text-sm font-semibold">
            <button type="button" className="text-primary hover:underline" onClick={() => { setOpen(false); onAll(); }}>All MV events →</button>
            {CREATE_ON && <button type="button" className="text-primary hover:underline" onClick={() => { setOpen(false); onAll(true); }}>+ New MV event</button>}
          </div>}
        </div>
      )}
    </div>
  );
}

/** Admin → MV events: one compact table. Radio is one row that opens to its days. */
export function MvEventsList({ onOpen, startCreating = false }: { onOpen: (id: number) => void; startCreating?: boolean }) {
  const q = useMvEvents();
  const [creating, setCreating] = useState(CREATE_ON && startCreating);
  const [openDays, setOpenDays] = useState<number | null>(null);
  useEffect(() => { if (CREATE_ON && startCreating) setCreating(true); }, [startCreating]);
  const rows = q.data?.events ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="mv-events">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-2xl font-bold tracking-tight">MV events</h2>
        <span className="text-sm text-muted-foreground">Events MilitaryVoices.ai runs, each with its own studio.</span>
        {CREATE_ON && !creating && <Button size="sm" className="ml-auto gap-1.5" onClick={() => setCreating(true)} data-testid="mv-new"><Plus className="h-3.5 w-3.5" /> New MV event</Button>}
      </div>
      {creating && <NewMvEvent onDone={(id) => { setCreating(false); if (id) onOpen(id); }} />}
      {q.isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : q.error ? (
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{q.error.message}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {["Program", "Event", "Dates", "Studio", "Status", ""].map((h, i) => <th key={i} className="px-3 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-muted-foreground">No MV events yet.</td></tr>}
              {rows.map((e) => {
                const many = (e.days?.length ?? 0) > 1;
                return [
                  <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/50" data-testid={`mv-row-${e.id}`}>
                    <td className="px-3 py-2"><ProgramTag program={e.program} /></td>
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center">{e.name}{e.featured && <LiveSite />}</span>
                      {many && (
                        <button type="button" className="ml-2 text-xs font-normal text-muted-foreground hover:text-foreground" onClick={() => setOpenDays(openDays === e.id ? null : e.id)} aria-expanded={openDays === e.id}>
                          {openDays === e.id ? "▴" : "▾"} {e.days!.length} days
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{mvDates(e, true)}</td>
                    <td className="px-3 py-2">{e.studios.length ? e.studios.map((s) => s.name).join(", ") : <span className="text-muted-foreground">Not set up yet</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2">{mvStatus(e)}</td>
                    <td className="px-3 py-2 text-right"><button type="button" className="whitespace-nowrap font-semibold text-primary hover:underline" onClick={() => onOpen(openId(e))} data-testid={`mv-open-${e.id}`}>Open →</button></td>
                  </tr>,
                  openDays === e.id && e.days?.map((d) => (
                    <tr key={`${e.id}-${d.id}`} className="border-b border-border bg-muted/30 text-[12.5px] text-muted-foreground">
                      <td />
                      <td className="px-3 py-1.5">{dayLabel(d)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{timeRange(d)}</td>
                      <td className="px-3 py-1.5">{d.studios.map((x) => x.name).join(", ")}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{mvStatus(d)}</td>
                      <td className="px-3 py-1.5 text-right"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(d.id)}>Open →</button></td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12.5px] text-muted-foreground">Member events and personal studios aren't listed here; they stay in each creator's own account. "Live site" marks the event the public home page promotes.</p>
    </div>
  );
}

/** New events are generic (Andrew, 26 Nov): no Marathon choice here; the Marathon studio keeps its own entry. */
const PROGRAMS: [MvProgram, string][] = [["live", "LIVE"], ["radio", "Radio"], ["", "Other"]];

/** A new MV event starts blank: no slots and no Marathon settings. Alex still runs the run of show (Andrew, 26 Nov). */
function NewMvEvent({ onDone }: { onDone: (id: number | null) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", program: "live" as MvProgram, startsOn: "", endsOn: "" });
  const bad = !!f.startsOn && !!f.endsOn && f.endsOn < f.startsOn;
  const create = useMutation<MvEventEntry, Error>({
    mutationFn: async () => (await adminSend("POST", "/api/admin/mv-events", { ...f, name: f.name.trim(), endsOn: f.endsOn || f.startsOn, timezone: ET })).json(),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ["/api/admin/events"] }); onDone(openId(r)); },
  });
  const ok = f.name.trim().length >= 2 && !!f.startsOn && !bad;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) create.mutate(); }} className="rounded-xl border border-primary/40 bg-card p-3" data-testid="mv-new-form">
      <p className="text-sm font-bold">New MV event</p>
      <p className="mb-2.5 mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid="mv-new-alex">
        <img src="/alex.jpg" alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" aria-hidden />
        Starts blank. Alex runs the run of show, emails, confirmations and guest media.
      </p>
      <div className="grid grid-cols-2 items-end gap-2.5 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <label className="col-span-2 flex flex-col gap-1 md:col-span-1"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</span>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name it" maxLength={120} autoFocus data-testid="mv-new-name" /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Program</span>
          <select value={f.program} onChange={(e) => setF({ ...f, program: e.target.value as MvProgram })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid="mv-new-program">
            {PROGRAMS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">First day</span>
          <Input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last day</span>
          <Input type="date" value={f.endsOn} min={f.startsOn || undefined} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></label>
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => onDone(null)}>Cancel</Button>
          <Button type="submit" size="sm" className="h-9" disabled={!ok || create.isPending} data-testid="mv-new-create">{create.isPending ? "Creating…" : "Create"}</Button>
        </div>
      </div>
      {(bad || create.error) && <p className="mt-2 text-[13px] text-destructive">{bad ? "The last day is before the first." : create.error?.message}</p>}
    </form>
  );
}
