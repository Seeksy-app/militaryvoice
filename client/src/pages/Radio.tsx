import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Radio as RadioIcon } from "lucide-react";

// MilitaryVoices Radio for listeners: tune in. The live player (the same
// picture and sound the broadcast sends out, /dx/program?listen=1), what's on
// now and next, where else to watch, and the way in for podcasters
// (/radio/book). Server: /api/radio in server/booth.ts.

type Booking = { id: number; show: string; host: string; photo: string; about: string; startAtUtc: string; endAtUtc: string };
type Radio = { day: { eventId: number; name: string; startAtUtc: string; endAtUtc: string } | null; onAir: boolean; youtube: string; liveone: string; bookings: Booking[] };

const ET = "America/New_York";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "long", day: "numeric" });

/** The program at 1920 wide, scaled into whatever width it's given. */
function Player() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1920);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10">
      <iframe title="MilitaryVoices Radio, live" src="/dx/program?listen=1" allow="autoplay" className="absolute left-0 top-0 origin-top-left border-0" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }} />
    </div>
  );
}

export default function RadioPage() {
  const { data } = useQuery<Radio>({ queryKey: ["/api/radio"], refetchInterval: 60_000 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const shared = useMemo(() => Number(new URLSearchParams(window.location.search).get("show")) || 0, []);
  const day = data?.day;
  const live = !!day && now >= Date.parse(day.startAtUtc) && now < Date.parse(day.endAtUtc);
  const list = data?.bookings ?? [];
  const current = list.find((b) => now >= Date.parse(b.startAtUtc) && now < Date.parse(b.endAtUtc));
  const sharedShow = list.find((b) => b.id === shared);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <section className="relative overflow-hidden bg-[#000741] text-white" style={{ background: "radial-gradient(ellipse 70% 120% at 82% 50%, #0d3a8a 0%, #05175a 40%, #000741 75%)" }}>
        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="flex items-center gap-3 text-sm font-extrabold uppercase tracking-[0.2em]"><img src="/logo-wave.png" alt="" className="h-6 w-auto" /> MilitaryVoices</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-[-0.03em] sm:text-7xl">MilitaryVoices <span className="text-[#F0A71F]">Radio</span></h1>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#ED1C24] px-3.5 py-1 text-xs font-black uppercase tracking-[0.18em]"><span className="h-2 w-2 rounded-full bg-white" /> Live From Anywhere</p>
            <p className="mt-5 max-w-lg text-xl font-bold leading-snug [text-wrap:pretty]">The live station for military and veteran voices, weekdays 7 am – 10 pm ET.</p>
            {live && current ? (
              <p className="mt-5 text-base text-white/85" data-testid="radio-now"><span className="font-bold text-[#F0A71F]">On air now:</span> {current.show}, with {current.host}</p>
            ) : day ? (
              <p className="mt-5 text-base text-white/85" data-testid="radio-next"><span className="font-bold text-[#F0A71F]">{live ? "On air now" : "Next on air"}:</span> {live ? "Live From Anywhere" : `${dayLabel(day.startAtUtc)} at ${hm(day.startAtUtc)} ET`}</p>
            ) : null}
            {(data?.youtube || data?.liveone) && (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-white/70">Also live on</span>
                {data?.youtube && <a href={data.youtube} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 px-3 py-1 font-semibold hover:bg-white/20">YouTube</a>}
                {data?.liveone && <a href={data.liveone} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 px-3 py-1 font-semibold hover:bg-white/20">LiveOne</a>}
              </p>
            )}
          </div>
          {live ? <Player /> : (
            <div className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl bg-white/[0.06] p-8 text-center ring-1 ring-white/10" data-testid="radio-off-air">
              <RadioIcon className="h-10 w-10 text-[#F0A71F]" />
              <p className="mt-4 text-2xl font-black">{day ? `On air ${dayLabel(day.startAtUtc)}` : "Coming soon"}</p>
              {day && <p className="mt-1 text-white/75">From {hm(day.startAtUtc)} ET. The player starts here when the station's on.</p>}
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {sharedShow && (
          <div className="mb-6 flex items-center gap-4 rounded-2xl border-2 border-[#F0A71F] bg-[#fff7e6] p-4 dark:bg-[#F0A71F]/10" data-testid="radio-shared">
            {sharedShow.photo && <img src={sharedShow.photo} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />}
            <p className="text-sm"><span className="block text-base font-bold">{sharedShow.show}</span>with {sharedShow.host} · live {dayLabel(sharedShow.startAtUtc)} at {hm(sharedShow.startAtUtc)} ET. Tune in right here.</p>
          </div>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{day ? (live ? "Today's lineup" : `Lineup · ${dayLabel(day.startAtUtc)}`) : "Lineup"}</h2>
            <p className="text-sm text-muted-foreground">All times Eastern. Every show is live, with the station's intro and outro around it.</p>
          </div>
          <a href="/radio/book" className="inline-flex h-10 items-center rounded-full bg-[#F0A71F] px-5 text-sm font-bold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="radio-book">Podcasters: book your slot</a>
        </div>
        {list.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">The lineup is filling up. Check back soon, or book a slot for your own show.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
            {list.map((b) => {
              const isNow = current?.id === b.id && live;
              const past = Date.parse(b.endAtUtc) <= now;
              return (
                <li key={b.id} className={`flex items-center gap-4 p-4 ${isNow ? "bg-[#ED1C24]/5" : ""} ${b.id === shared ? "ring-2 ring-inset ring-[#F0A71F]" : ""} ${past ? "opacity-60" : ""}`} data-testid={`radio-slot-${b.id}`}>
                  <span className="w-24 shrink-0 text-sm font-bold tabular-nums">{hm(b.startAtUtc)}</span>
                  {b.photo ? <img src={b.photo} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="h-11 w-11 shrink-0 rounded-full bg-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{b.show}</span>
                    <span className="block truncate text-sm text-muted-foreground">with {b.host}{b.about ? ` · ${b.about}` : ""}</span>
                  </span>
                  {isNow && <span className="rounded-full bg-[#ED1C24] px-2.5 py-1 text-xs font-bold text-white">On air</span>}
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
