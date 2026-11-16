import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAdminAuth } from "@/lib/admin-auth";
import { adminGet } from "@/lib/adminApi";

// The producer's run of show for MilitaryVoices Radio: every half hour of the week, what is in it (LIVE or
// VOD), whether the station's intro and outro wrap it, and where the clock is right now. Admins only.
// Data: /api/admin/radio/ros (server/booth.ts). It follows the same clock the broadcast does.

type Row = {
  slot: number; span: number; startAtUtc: string; endAtUtc: string; kind: "live" | "vod" | "replay" | "open";
  show: string; host: string; note?: string; signupId?: number; intro: boolean; outro: boolean; introMin?: number; outroMin?: number;
  onAirAtUtc?: string; offAirAtUtc?: string; introAudio?: boolean; outroAudio?: boolean; durationSec: number; warning: string; opensAtUtc?: string;
};
type Day = { eventId: number; name: string; startAtUtc: string; endAtUtc: string; status: string; recording: boolean; inRoom: { name: string; signupId: number }[]; rows: Row[] };
type Ros = { now: string; days: Day[] };

const ET = "America/New_York";
const hm = (iso: string | number) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const dayShort = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "short" });
const dayLong = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "long", day: "numeric" });
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const mins = (sec: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

/** LIVE or VOD, the two things the producer needs to see at a glance. Open time shows OPEN. */
function Kind({ r }: { r: Row }) {
  if (r.kind === "live") return <span className="inline-flex w-16 justify-center rounded bg-[#ED1C24] px-2 py-1 text-xs font-black tracking-wider text-white">LIVE</span>;
  if (r.kind === "vod") return <span className="inline-flex w-16 justify-center rounded bg-[#1d6fe0] px-2 py-1 text-xs font-black tracking-wider text-white">VOD</span>;
  if (r.kind === "replay") return <span className="inline-flex w-16 justify-center rounded bg-[#1d6fe0]/45 px-2 py-1 text-xs font-black tracking-wider text-white">VOD</span>;
  return <span className="inline-flex w-16 justify-center rounded bg-white/10 px-2 py-1 text-xs font-black tracking-wider text-white/60">OPEN</span>;
}

/** Where a row is on the clock: before it, in its intro, on air (live, or the file playing), in its outro, or done. */
function phaseOf(r: Row, now: number): { name: string; leftMs: number } | null {
  const start = Date.parse(r.startAtUtc), end = Date.parse(r.endAtUtc);
  if (now < start || now >= end) return null;
  if (r.kind === "live" || r.kind === "vod") {
    const on = Date.parse(r.onAirAtUtc!), off = Date.parse(r.offAirAtUtc!);
    if (now < on) return { name: "INTRO", leftMs: on - now };
    if (now < off) return { name: r.kind === "live" ? "LIVE" : "PLAYING", leftMs: off - now };
    return { name: "OUTRO", leftMs: end - now };
  }
  return { name: r.kind === "replay" ? "PLAYING" : "OPEN", leftMs: end - now };
}

export default function RadioROS() {
  const { isAuthenticated, isLoading } = useAdminAuth();
  const { data, error } = useQuery<Ros>({ queryKey: ["/api/admin/radio/ros"], queryFn: () => adminGet<Ros>("/api/admin/radio/ros"), enabled: isAuthenticated, refetchInterval: 15_000 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { document.title = "Radio run of show · MilitaryVoices"; }, []);

  const days = data?.days ?? [];
  // The day on air, else the next one, else the last.
  const auto = useMemo(() => {
    const on = days.findIndex((d) => now >= Date.parse(d.startAtUtc) - 3600_000 && now < Date.parse(d.endAtUtc));
    if (on >= 0) return on;
    const next = days.findIndex((d) => Date.parse(d.startAtUtc) > now);
    return next >= 0 ? next : Math.max(0, days.length - 1);
  }, [days.length, Math.floor(now / 600_000)]);
  const [picked, setPicked] = useState<number | null>(null);
  const di = picked ?? auto;
  const day = days[di];

  // Now and next, across the whole week.
  const flat = useMemo(() => days.flatMap((d) => d.rows.map((r) => ({ d, r }))), [days]);
  const cur = flat.find(({ r }) => now >= Date.parse(r.startAtUtc) && now < Date.parse(r.endAtUtc));
  const nxt = flat.find(({ r }) => Date.parse(r.startAtUtc) > now && (!cur || r !== cur.r));
  const curPhase = cur ? phaseOf(cur.r, now) : null;
  const stationOn = days.some((d) => now >= Date.parse(d.startAtUtc) && now < Date.parse(d.endAtUtc));

  const rowRef = useRef<HTMLTableRowElement>(null);
  const [scrolledFor, setScrolledFor] = useState("");
  useEffect(() => {
    const key = `${di}-${cur?.r.slot ?? "x"}`;
    if (rowRef.current && scrolledFor !== key) { rowRef.current.scrollIntoView({ block: "center", behavior: "smooth" }); setScrolledFor(key); }
  }, [di, cur?.r.slot, data]);

  if (isLoading) return <div className="min-h-screen bg-[#05070f] p-8 text-white">Loading…</div>;
  if (!isAuthenticated) return <div className="min-h-screen bg-[#05070f] p-8 text-white"><p className="text-xl font-bold">Radio run of show</p><p className="mt-2 text-white/70">Sign in to the admin first.</p><Link href="/admin" className="mt-4 inline-block rounded-full bg-[#F0A71F] px-5 py-2 font-bold text-[#1a1200]">Open the admin</Link></div>;

  const counts = (d: Day) => ({ live: d.rows.filter((r) => r.kind === "live").length, vod: d.rows.filter((r) => r.kind === "vod").length, replay: d.rows.filter((r) => r.kind === "replay").length, open: d.rows.filter((r) => r.kind === "open").length });
  const inRoomNow = (d: Day, r: Row) => r.signupId ? d.inRoom.some((p) => p.signupId === r.signupId) : false;
  const dayIsOn = (d: Day) => now >= Date.parse(d.startAtUtc) - 3600_000 && now < Date.parse(d.endAtUtc);

  return (
    <div className="min-h-screen bg-[#05070f] text-white" data-testid="radio-ros">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#05070f]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/logo-wave.png" alt="" className="h-6 w-auto" />
            <h1 className="text-lg font-black tracking-tight">MilitaryVoices Radio · Run of show</h1>
          </div>
          <span className={`rounded px-2.5 py-1 text-xs font-black tracking-wider ${stationOn ? "bg-[#ED1C24] text-white" : "bg-white/10 text-white/70"}`}>{stationOn ? "ON AIR" : "OFF AIR"}</span>
          <span className="font-mono text-2xl font-bold tabular-nums">{new Date(now).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", second: "2-digit" })} <span className="text-sm font-semibold text-white/55">ET</span></span>
          {day && dayIsOn(day) && <span className={`text-xs font-bold ${day.recording ? "text-[#4ade80]" : "text-[#F0A71F]"}`}>{day.recording ? "● Recording" : "○ Not recording"}</span>}
          <a href="/radio" target="_blank" rel="noreferrer" className="ml-auto text-sm font-semibold text-white/70 hover:text-white">Open the listener page</a>
        </div>
        {/* NOW and NEXT */}
        <div className="mx-auto grid max-w-7xl gap-3 px-4 pb-3 md:grid-cols-[1.6fr_1fr]">
          <div className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10" data-testid="ros-now">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/50">Now</p>
            {cur ? (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <Kind r={cur.r} />
                <span className="min-w-0 flex-1 truncate text-xl font-bold">{cur.r.show || "Open time"}{cur.r.host ? <span className="font-medium text-white/70"> · {cur.r.host}</span> : null}</span>
                {curPhase && <span className={`rounded px-2.5 py-1 text-sm font-black tracking-wider ${curPhase.name === "LIVE" ? "bg-[#ED1C24]" : curPhase.name === "PLAYING" ? "bg-[#1d6fe0]" : curPhase.name === "INTRO" || curPhase.name === "OUTRO" ? "bg-[#F0A71F] text-[#1a1200]" : "bg-white/10"}`}>{curPhase.name} {mmss(curPhase.leftMs)}</span>}
              </div>
            ) : <p className="mt-1 text-lg text-white/65">{stationOn ? "Between items" : "The station is off air."}</p>}
          </div>
          <div className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10" data-testid="ros-next">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/50">Next</p>
            {nxt ? (
              <div className="mt-1 flex items-start gap-3">
                <Kind r={nxt.r} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{nxt.r.show || "Open time"}</p>
                  <p className="font-mono text-sm tabular-nums text-white/75">{dayShort(nxt.r.startAtUtc)} {hm(nxt.r.startAtUtc)} · in {mmss(Date.parse(nxt.r.startAtUtc) - now)}</p>
                </div>
              </div>
            ) : <p className="mt-1 text-white/60">Nothing more this week.</p>}
          </div>
        </div>
        {/* Day tabs */}
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3">
          {days.map((d, i) => {
            const c = counts(d);
            return (
              <button key={d.eventId} type="button" onClick={() => setPicked(i)} className={`shrink-0 rounded-lg px-4 py-2 text-left text-sm ring-1 ${i === di ? "bg-white text-[#05070f] ring-white" : "bg-white/[0.06] text-white ring-white/10 hover:bg-white/10"}`} data-testid={`ros-day-${d.eventId}`}>
                <span className="block font-black">{dayShort(d.startAtUtc)} {new Date(d.startAtUtc).toLocaleDateString("en-US", { timeZone: ET, month: "numeric", day: "numeric" })}</span>
                <span className={`block text-[11px] font-semibold ${i === di ? "text-[#05070f]/70" : "text-white/55"}`}>{c.live} live · {c.vod + c.replay} VOD{c.open ? ` · ${c.open} open` : ""}</span>
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        {error && <p className="mb-3 rounded-lg bg-[#ED1C24]/20 p-3 text-sm">Couldn't load the run of show: {(error as Error).message}</p>}
        {day && (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-black">{dayLong(day.startAtUtc)}</h2>
              <p className="text-xs text-white/55">All times Eastern. Every booking has a 3-minute intro and a 3-minute outro around it; replays in open time have none. Refreshes every 15 seconds.</p>
            </div>
            <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead className="bg-white/[0.07] text-left text-[11px] uppercase tracking-[0.14em] text-white/55">
                  <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Show</th><th className="px-3 py-2 text-center">Intro</th><th className="px-3 py-2 text-center">Outro</th><th className="px-3 py-2">Length</th><th className="px-3 py-2">Check</th></tr>
                </thead>
                <tbody>
                  {day.rows.map((r) => {
                    const start = Date.parse(r.startAtUtc), end = Date.parse(r.endAtUtc);
                    const isNow = now >= start && now < end;
                    const past = end <= now;
                    const ph = isNow ? phaseOf(r, now) : null;
                    const soon = r.kind === "live" && !past && now >= start - 70 * 60_000;
                    const here = inRoomNow(day, r);
                    return (
                      <tr key={`${r.slot}`} ref={isNow ? rowRef : undefined} className={`border-t border-white/10 ${isNow ? "bg-[#F0A71F]/15 outline outline-2 -outline-offset-2 outline-[#F0A71F]" : r.kind === "live" ? "bg-[#ED1C24]/[0.06]" : ""} ${past ? "opacity-45" : ""}`} data-testid={`ros-row-${r.slot}`}>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono font-bold tabular-nums">{hm(r.startAtUtc)}<span className="text-white/45">{r.span > 1 ? ` – ${hm(r.endAtUtc)}` : ""}</span></td>
                        <td className="px-3 py-2.5"><Kind r={r} /></td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold">{r.show || <span className="text-white/45">Open: station card until booked</span>}</p>
                          {(r.host || r.note) && <p className="text-xs text-white/60">{r.host}{r.note ? ` · ${r.note.length > 90 ? r.note.slice(0, 90).trimEnd() + "…" : r.note}` : ""}{r.kind === "replay" ? " · replay filling open time" : ""}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-center">{r.intro ? (r.introAudio ? <span className="font-bold text-[#4ade80]">✓ <span className="text-xs font-medium text-white/55">{r.introMin ?? 3}m</span></span> : <span className="text-xs font-bold text-[#F0A71F]" title="The card shows, but no voice clip is made yet">card only</span>) : <span className="text-white/30">—</span>}</td>
                        <td className="px-3 py-2.5 text-center">{r.outro ? (r.outroAudio ? <span className="font-bold text-[#4ade80]">✓ <span className="text-xs font-medium text-white/55">{r.outroMin ?? 3}m</span></span> : <span className="text-xs font-bold text-[#F0A71F]" title="The card shows, but no voice clip is made yet">card only</span>) : <span className="text-white/30">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-white/70">{r.kind === "live" ? `${Math.round((Date.parse(r.offAirAtUtc!) - Date.parse(r.onAirAtUtc!)) / 60000)} min live` : r.durationSec ? mins(r.durationSec) : ""}</td>
                        <td className="px-3 py-2.5 text-xs">
                          {ph && <span className="mr-2 rounded bg-white/10 px-2 py-0.5 font-bold">{ph.name} {mmss(ph.leftMs)}</span>}
                          {r.warning && <span className="rounded bg-[#ED1C24]/25 px-2 py-0.5 font-bold text-[#ff8a8f]">{r.warning}</span>}
                          {soon && dayIsOn(day) && (here ? <span className="font-bold text-[#4ade80]">● In the booth</span> : <span className="font-bold text-[#F0A71F]">○ Not in the booth yet{r.opensAtUtc ? ` · opens ${hm(r.opensAtUtc)}` : ""}</span>)}
                          {r.kind === "live" && r.signupId && <><a href={`/booth/${r.signupId}?watch=1`} target="_blank" rel="noreferrer" className="ml-2 font-bold text-[#F0A71F] underline hover:text-white" data-testid={`ros-watch-${r.signupId}`}>Watch booth</a><a href={`/booth/${r.signupId}`} target="_blank" rel="noreferrer" className="ml-2 text-white/50 underline hover:text-white">booth</a></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!day && !error && <p className="text-white/60">Loading the week…</p>}
      </main>
    </div>
  );
}
