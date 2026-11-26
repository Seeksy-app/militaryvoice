import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, Clock, ExternalLink, Info, Loader2, Phone, PhoneCall, Plane, Sparkles } from "lucide-react";
import type { TravelerStatus } from "@shared/militaryFares";
import { AIRPORTS, airlineName, airlineSite, airportName, deskOf, perkLine, type Perk } from "@/lib/travelPerks";

// Travel (Andrew, 26 Nov 2026: "ok. build it", from the mockup in .shots/travel-mock): a trip and the creator's
// status, flights from the server's Parallel search (server/creatorTravel.ts) with each airline's perk for them, and
// "Have us call" for airlines whose military fare is phone-only. Calls go out only while the server's gate is on
// (callsLive); until then a request is saved and the page says so. We never book or pay.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const SHOWN = 8;
const CALLS_AT_ONCE = 3; // the server's calls a day

// What the server sends (server/creatorTravel.ts).
type Leg = { departure_airport: string; departure_time: string; arrival_airport: string; arrival_time: string; duration_minutes: number; stops: number; layovers: { airport: string }[] };
type Result = { i: number; price: number | null; url: string; iata: string; airline: string; flights: string[]; outbound: Leg; inbound: Leg | null; perk: Perk | null; canCall: boolean };
type Query = { from: string; to: string; depart: string; return: string; status: TravelerStatus };
type SearchResponse = { searchId: number; cached: boolean; searchesLeft: number | null; query: Query; results: Result[]; callsLive: boolean };
type Report = { available: "yes" | "no" | "unknown"; militaryFare: number | null; difference: number | null; conditions: string; summary: string };
export type CallView = { id: number; iata: string; airline: string; traveler: TravelerStatus; flight: { from: string; to: string; depart: string; return: string; flights: string[] }; webPrice: number | null; status: "waiting" | "calling" | "done" | "failed"; report: Report | null; error: string; createdAt: string; updatedAt: string };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const ymdShort = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");
export const ymdNice = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const clock = (t: string) => { const m = /(\d{2}):(\d{2})$/.exec(t); if (!m) return t; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`; };
const dur = (m: number | null | undefined) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const tripKey = (t: { from: string; to: string; depart: string; return: string }) => `${t.from}|${t.to}|${t.depart}|${t.return || ""}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const sameFlights = (a: string[], b: string[]) => a.join() === b.join();

/** "Tampa (TPA)", "tpa" or "Tampa" → TPA. */
function codeOf(v: string): string {
  const s = v.trim();
  const paren = /\(([A-Za-z]{3})\)\s*$/.exec(s);
  if (paren) return paren[1].toUpperCase();
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  const lower = s.toLowerCase();
  const hit = AIRPORTS.find(([, n]) => n.toLowerCase() === lower) ?? (lower.length >= 3 ? AIRPORTS.find(([, n]) => n.toLowerCase().startsWith(lower)) : undefined);
  return hit ? hit[0] : "";
}
const label = (code: string) => (code ? `${airportName(code)} (${code})` : "");

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { message?: string }).message || "Something went wrong. Try again.");
  return j as T;
}

/** The phone fare that beats the web price on a finished call, else null. */
function phoneWin(c: CallView | undefined): number | null {
  if (!c || c.status !== "done" || c.report?.available !== "yes") return null;
  const fare = c.report.militaryFare;
  return fare != null && c.webPrice != null && fare < c.webPrice ? fare : null;
}

export function Travel({ serviceStatus }: { serviceStatus?: string | null }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TravelerStatus>(() => (/active|guard|reserve/i.test(serviceStatus ?? "") ? "active" : "veteran"));
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [leave, setLeave] = useState("");
  const [back, setBack] = useState("");
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(true);

  const search = useMutation({
    mutationFn: (q: Query) => call<SearchResponse>("POST", "/api/travel/search", q),
    onSuccess: () => { setAll(false); setEditing(false); },
  });
  const calls = useQuery<{ calls: CallView[]; callsLive: boolean }>({
    queryKey: ["/api/travel/calls"],
    queryFn: () => call("GET", "/api/travel/calls"),
    refetchInterval: (q) => {
      const cs = q.state.data?.calls ?? [];
      return cs.some((c) => c.status === "calling") ? 15_000 : cs.some((c) => c.status === "waiting") && q.state.data?.callsLive ? 60_000 : false;
    },
  });
  // One request per airline worth a call: the cheapest flight each one showed.
  const askCalls = useMutation({
    mutationFn: async (picks: { searchId: number; i: number }[]) => {
      for (const p of picks) await call("POST", "/api/travel/calls", p);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["/api/travel/calls"] }),
  });

  const from = codeOf(fromText);
  const to = codeOf(toText);
  const formError = !from && fromText.trim().length >= 3 ? "Pick From from the list, or type its 3-letter code." : !to && toText.trim().length >= 3 ? "Pick To from the list, or type its 3-letter code." : from && from === to ? "From and To are the same airport." : "";
  const ready = !!from && !!to && !!leave && from !== to;
  const go = () => { if (ready) search.mutate({ from, to, depart: leave, return: back, status }); };
  // The server ties perks and calls to the status searched, so a switch searches again (from its 30-minute store).
  const pickStatus = (s: TravelerStatus) => { setStatus(s); const q = search.data?.query; if (q && q.status !== s && !search.isPending) search.mutate({ ...q, status: s }); };

  const data = search.data;
  const trip = data?.query;
  const results = useMemo(() => [...(data?.results ?? [])].sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9)), [data]);
  const allCalls = calls.data?.calls ?? [];
  const callsLive = data?.callsLive ?? calls.data?.callsLive ?? false;
  // This trip's calls: the newest per airline (the server lists newest first).
  const tripCalls = useMemo(() => {
    if (!trip) return [] as CallView[];
    const k = tripKey(trip);
    const by = new Map<string, CallView>();
    for (const c of allCalls) if (tripKey(c.flight) === k && c.traveler === trip.status && !by.has(c.iata)) by.set(c.iata, c);
    return Array.from(by.values());
  }, [allCalls, trip]);
  const toCall = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((r) => r.canCall && !seen.has(r.iata) && seen.add(r.iata)).slice(0, CALLS_AT_ONCE);
  }, [results]);
  const pending = tripCalls.filter((c) => c.status === "waiting" || c.status === "calling");
  const finished = tripCalls.filter((c) => c.status === "done" || c.status === "failed");
  // A phone fare that beats the web price moves its flight to its new place in the list.
  const rows = useMemo(() => {
    const byIata = new Map(tripCalls.map((c) => [c.iata, c]));
    return results
      .map((r) => {
        const c = byIata.get(r.iata);
        const mine = c && sameFlights(c.flight.flights, r.flights) ? c : undefined;
        return { r, call: mine, phone: phoneWin(mine) };
      })
      .sort((a, b) => (a.phone ?? a.r.price ?? 1e9) - (b.phone ?? b.r.price ?? 1e9));
  }, [results, tripCalls]);

  // Other trips asked about, one line each.
  const otherTrips = useMemo(() => {
    const k = trip ? tripKey(trip) : "";
    const groups = new Map<string, CallView[]>();
    for (const c of allCalls) { const key = tripKey(c.flight); if (key === k) continue; groups.set(key, [...(groups.get(key) ?? []), c]); }
    return Array.from(groups.values()).slice(0, 3);
  }, [allCalls, trip]);

  const showTrip = (f: CallView["flight"], s: TravelerStatus) => {
    setFromText(label(f.from)); setToText(label(f.to)); setLeave(f.depart); setBack(f.return); setStatus(s);
    search.mutate({ from: f.from, to: f.to, depart: f.depart, return: f.return, status: s });
  };

  return (
    <section className="mx-auto max-w-[920px] pb-16 pt-1" data-testid="travel">
      <datalist id="mv-airports">{AIRPORTS.map(([c, n]) => <option key={c} value={`${n} (${c})`} />)}</datalist>
      <div className="mb-4">
        <h1 className="text-[28px] font-semibold tracking-tight" style={HEAD}>Travel</h1>
        <p className="text-[14px] text-muted-foreground text-balance">Your military fares and perks for a trip, airline by&nbsp;airline.</p>
      </div>

      {/* The trip: who you are, then where and when. On a phone, once searched, it folds to one line. */}
      {!editing && trip ? (
        <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left md:hidden" data-testid="travel-trip-folded">
          <Plane className="h-5 w-5 shrink-0 text-[#053877] dark:text-white" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-semibold">{airportName(trip.from)} → {airportName(trip.to)}</span>
            <span className="block truncate text-xs text-muted-foreground">{ymdShort(trip.depart)}{trip.return ? ` – ${ymdShort(trip.return)}` : " · one way"} · {trip.status === "active" ? "Active duty" : "Veteran"}</span>
          </span>
          <span className="text-sm font-semibold text-[#053877] dark:text-white">Change</span>
        </button>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className={`${!editing && trip ? "hidden md:block" : ""} rounded-2xl border border-border bg-card p-2 shadow-sm`} data-testid="travel-trip">
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1 sm:flex sm:bg-transparent sm:p-0 sm:px-1 sm:pt-0.5" role="radiogroup" aria-label="I'm">
          {(["veteran", "active"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => pickStatus(s)} className={`rounded-lg px-2 py-1.5 text-center text-[13px] font-semibold leading-tight transition-colors sm:whitespace-nowrap sm:rounded-full sm:px-3 sm:py-1 ${status === s ? "bg-[#053877] text-white dark:bg-white dark:text-[#053877]" : "text-foreground/70 hover:bg-muted"}`} data-testid={`travel-status-${s}`}>
              {s === "veteran" ? "Veteran or retiree" : "Active duty, Guard or Reserve"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:items-stretch">
          <Box label="From" className="col-span-2 md:flex-1"><input list="mv-airports" aria-label="From" value={fromText} onChange={(e) => setFromText(e.target.value)} onBlur={() => from && setFromText(label(from))} placeholder="City or airport" className="w-full bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground" data-testid="travel-from" /></Box>
          <button type="button" aria-label="Swap From and To" onClick={() => { setFromText(toText); setToText(fromText); }} className="hidden items-center px-0.5 text-muted-foreground hover:text-foreground md:flex"><ArrowLeftRight className="h-4 w-4" /></button>
          <Box label="To" className="col-span-2 md:flex-1"><input list="mv-airports" aria-label="To" value={toText} onChange={(e) => setToText(e.target.value)} onBlur={() => to && setToText(label(to))} placeholder="City or airport" className="w-full bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground" data-testid="travel-to" /></Box>
          <Box label="Leave" className="md:w-[150px]"><input type="date" aria-label="Leave" min={todayEt()} value={leave} onChange={(e) => { setLeave(e.target.value); if (back && e.target.value > back) setBack(""); }} className="w-full bg-transparent text-[15px] font-semibold outline-none" data-testid="travel-leave" /></Box>
          <Box label="Back (optional)" className="md:w-[150px]"><input type="date" aria-label="Back" min={leave || todayEt()} value={back} onChange={(e) => setBack(e.target.value)} className="w-full bg-transparent text-[15px] font-semibold outline-none" data-testid="travel-back" /></Box>
          <button type="submit" disabled={!ready || search.isPending} className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-[#053877] px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-50 md:py-0" data-testid="travel-find">
            {search.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Finding flights</> : "Find flights"}
          </button>
        </div>
        {(formError || search.error) && <p className="px-2 pb-1 pt-2 text-[13px] font-medium text-[#b42318]">{formError || (search.error as Error).message}</p>}
      </form>

      {search.isPending && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-10 text-center text-[14px] text-muted-foreground text-balance" data-testid="travel-loading">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Finding flights and each airline's perk for you. This can take up to half a&nbsp;minute.
        </div>
      )}

      {/* What came back from the calls, or the offer to make them. */}
      {trip && !search.isPending && results.length > 0 && (
        <div className="mt-4">
          {pending.length > 0 ? (
            <Waiting calls={pending} live={callsLive} />
          ) : finished.length > 0 ? (
            <CallReport calls={finished} trip={trip} />
          ) : trip.status === "active" && toCall.length > 0 ? (
            <CallOffer airlines={toCall.map((r) => airlineName(r.iata, r.airline))} live={callsLive} pending={askCalls.isPending} error={askCalls.error ? (askCalls.error as Error).message : ""} onCall={() => askCalls.mutate(toCall.map((r) => ({ searchId: data!.searchId, i: r.i })))} />
          ) : trip.status === "veteran" ? (
            <VeteranNote results={results} />
          ) : null}
        </div>
      )}

      {trip && !search.isPending && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card" data-testid="travel-results">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
            <span><b className="text-foreground">{results.length} {results.length === 1 ? "flight" : "flights"}</b> · cheapest first · {trip.return ? "round trip" : "one way"}, 1 person</span>
            <span className="hidden sm:inline">Perks checked Nov 25 on each airline's own site</span>
          </div>
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground text-balance">No flights came back for those days. Try a day either side, or a nearby&nbsp;airport.</p>
          ) : (
            <div className="divide-y divide-border">
              {(all ? rows : rows.slice(0, SHOWN)).map(({ r, phone, call: c }) => <FlightRow key={r.i} r={r} searchedFrom={trip.from} status={trip.status} phoneFare={phone} call={c} />)}
            </div>
          )}
          {!all && results.length > SHOWN && (
            <button type="button" onClick={() => setAll(true)} className="w-full border-t border-border py-2.5 text-[13px] font-semibold text-[#053877] hover:bg-muted dark:text-white">Show all {results.length} flights</button>
          )}
        </div>
      )}

      {!trip && !search.isPending && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="travel-how">
          {[
            { t: "Your perk on every flight", d: "Free bags, WeSalute codes and military fares, for your status, airline by airline." },
            { t: "We call when it's phone-only", d: "Some military fares aren't online. We ask the airline and tell you if it beats the web price." },
            { t: "You book with the airline", d: "Every flight links to the airline's own site or phone line. We never book or pay for you." },
          ].map((x) => (
            <div key={x.t} className="rounded-2xl border border-border bg-card px-4 py-3 sm:py-4">
              <p className="text-[15px] font-semibold text-balance">{x.t}</p>
              <p className="mt-1 text-[13px] text-muted-foreground text-balance">{x.d}</p>
            </div>
          ))}
        </div>
      )}

      {otherTrips.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold text-muted-foreground">Trips we've called about</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {otherTrips.map((g) => {
              const f = g[0].flight;
              const open = g.some((c) => c.status === "waiting" || c.status === "calling");
              const best = bestOf(g);
              const past = f.depart < todayEt();
              return (
                <button key={g[0].id} type="button" disabled={past} onClick={() => showTrip(f, g[0].traveler)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent">
                  <Plane className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{airportName(f.from)} → {airportName(f.to)} · {ymdNice(f.depart)}</span>
                  <span className={`shrink-0 text-[12px] font-semibold ${open ? "text-[#8a5a00] dark:text-[#F0A71F]" : best ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    {open ? (callsLive ? "Calling" : "Saved") : best ? `${best.airline} ${money(best.fare)} by phone` : "Web fare is better"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-[12px] text-muted-foreground text-balance">{trip ? <>You book with the airline. We never book or pay for you, and fares can change until you&nbsp;do.</> : <>Fares can change until you&nbsp;book.</>}</p>
    </section>
  );
}

function Box({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col rounded-xl border border-border bg-background px-3 py-1.5 focus-within:border-[#053877] ${className ?? ""}`}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Tile({ code }: { code: string }) {
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#053877] text-[12px] font-bold text-white dark:bg-white/15">{code}</span>;
}

function FlightRow({ r, searchedFrom, status, phoneFare, call: c }: { r: Result; searchedFrom: string; status: TravelerStatus; phoneFare: number | null; call?: CallView }) {
  const name = airlineName(r.iata, r.airline);
  const site = airlineSite(r.iata);
  const desk = deskOf(r.iata);
  const perk = perkLine(r.perk);
  const after = perk?.pct && r.price != null ? Math.round(r.price * (1 - perk.pct / 100)) : null;
  const o = r.outbound;
  const stops = o.stops === 0 ? "Nonstop" : `${o.stops} ${o.stops === 1 ? "stop" : "stops"}${o.layovers?.length ? `, ${o.layovers.map((l) => l.airport).join(", ")}` : ""}`;
  const fromOther = o.departure_airport && o.departure_airport !== searchedFrom ? `From ${o.departure_airport} · ` : "";
  const nextDay = o.arrival_time.slice(0, 10) > o.departure_time.slice(0, 10);
  let note = "";
  let tone: "win" | "done" | "ask" = "ask";
  if (c?.status === "done") {
    tone = phoneFare != null ? "win" : "done";
    note = phoneFare != null && r.price != null ? `Military fare by phone: ${money(r.price - phoneFare)} less` : c.report?.available === "no" ? "We asked: no military fare here" : c.report?.available === "unknown" ? "We asked: they couldn't say" : "We asked: the web fare is better";
  } else if (c?.status === "failed") { tone = "done"; note = "We couldn't get an answer"; }
  else if (c) note = "We're asking about the military fare";
  else if (r.canCall) note = "Military fare by phone only";
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-testid={`flight-${r.iata}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Tile code={r.iata} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold">{name}</p>
          <p className="whitespace-nowrap text-[13px] tabular-nums">{clock(o.departure_time)} → {clock(o.arrival_time)}{nextDay ? <sup className="ml-0.5 text-[10px] text-muted-foreground">+1</sup> : null}</p>
          <p className="truncate text-xs text-muted-foreground">{fromOther}{stops}{o.duration_minutes ? ` · ${dur(o.duration_minutes)}` : ""}</p>
        </div>
      </div>
      <div className="min-w-0 sm:w-[290px] sm:shrink-0">
        {perk ? (
          <p className="flex items-start gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{perk.text}{after != null ? <span className="text-muted-foreground">: about {money(after)}</span> : null}</span></p>
        ) : (
          <p className="text-[13px] text-muted-foreground">No {status === "active" ? "military" : "veteran"} perk on {name}</p>
        )}
        {note && <p className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${tone === "win" ? "font-semibold text-emerald-700 dark:text-emerald-400" : tone === "done" ? "font-semibold text-muted-foreground" : "text-[#8a5a00] dark:text-[#F0A71F]"}`}>{tone === "ask" && <Phone className="h-3 w-3" />}{note}</p>}
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <p className="w-16 text-right leading-tight"><span className="block text-lg font-bold tabular-nums">{phoneFare != null ? money(phoneFare) : r.price != null ? money(r.price) : "—"}</span><span className="text-[11px] text-muted-foreground">{phoneFare != null ? "by phone" : r.inbound ? "round trip" : "one way"}</span></p>
        {phoneFare != null && desk ? (
          <a href={`tel:${desk.tel}`} className="inline-flex w-[196px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700"><Phone className="h-3.5 w-3.5" /> {desk.phone}</a>
        ) : (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-[196px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold text-[#053877] hover:bg-muted dark:text-white" data-testid={`book-${r.iata}`}>
            Book on {site ?? "the airline's site"} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function CallOffer({ airlines, live, onCall, pending, error }: { airlines: string[]; live: boolean; onCall: () => void; pending: boolean; error: string }) {
  const many = airlines.length > 1;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#F0A71F]/50 bg-[#FFF8E8] p-4 sm:flex-row sm:items-center dark:bg-[#F0A71F]/10" data-testid="travel-call-offer">
      <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0A71F]/25 text-[#8a5a00] sm:flex"><PhoneCall className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-balance">{list(airlines)} {many ? "have military fares" : "has a military fare"} you can only get by&nbsp;phone</p>
        <p className="text-[13px] text-muted-foreground text-balance">Our automated caller asks {many ? "each one" : "them"} for your flight's military fare and tells you here if it beats the web price. It never books, pays or gives your details.{live ? "" : " We'll save your trip and call once it's switched on."}</p>
        {error && <p className="mt-1 text-[13px] font-medium text-[#b42318]">{error}</p>}
      </div>
      <button type="button" onClick={onCall} disabled={pending} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60" data-testid="travel-call">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />} Have us call
      </button>
    </div>
  );
}

function Waiting({ calls, live }: { calls: CallView[]; live: boolean }) {
  const names = list([...calls].sort((a, b) => (a.webPrice ?? 1e9) - (b.webPrice ?? 1e9)).map((c) => airlineName(c.iata, c.airline)));
  const calling = calls.some((c) => c.status === "calling");
  const on = calling || live;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4" data-testid="travel-waiting">
      {calling ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#053877] dark:text-white" /> : <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#053877] dark:text-white" />}
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-balance">{on ? `We're calling ${names}` : `Saved: we'll call ${names}`}</p>
        <p className="text-[13px] text-muted-foreground text-balance">{on ? "What they quote shows up here, usually within a few minutes. Some desks are open weekdays only." : "Our automated caller isn't switched on yet. Your trip is saved, and what they quote shows up here once it's on."}</p>
      </div>
    </div>
  );
}

function bestOf(calls: CallView[]): { airline: string; iata: string; fare: number; web: number } | null {
  let best: { airline: string; iata: string; fare: number; web: number } | null = null;
  for (const c of calls) {
    const fare = phoneWin(c);
    if (fare == null || c.webPrice == null) continue;
    if (!best || c.webPrice - fare > best.web - best.fare) best = { airline: airlineName(c.iata, c.airline), iata: c.iata, fare, web: c.webPrice };
  }
  return best;
}

function CallReport({ calls, trip }: { calls: CallView[]; trip: Query }) {
  const best = bestOf(calls);
  const desk = best ? deskOf(best.iata) : null;
  const bestCall = best ? calls.find((c) => c.iata === best.iata) : undefined;
  const others = calls.filter((c) => c.iata !== best?.iata);
  const last = calls.map((c) => c.updatedAt || c.createdAt).sort().pop() ?? "";
  const when = last ? new Date(last).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  const n = calls.length;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-card ${best ? "border-emerald-300 dark:border-emerald-500/40" : "border-border"}`} data-testid="travel-report">
      <div className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center ${best ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-muted/40"}`}>
        <span className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-full sm:flex ${best ? "bg-emerald-600 text-white" : "bg-muted text-foreground"}`}>{best ? <Sparkles className="h-5 w-5" /> : <Info className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${best ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>We called {n} {n === 1 ? "airline" : "airlines"}{when ? ` · ${when}` : ""}</p>
          {best ? (
            <>
              <p className="text-[17px] font-semibold text-balance" style={HEAD}>{best.airline} military fare {money(best.fare)} vs {money(best.web)} online. You save&nbsp;{money(best.web - best.fare)}.</p>
              <p className="text-[13px] text-muted-foreground text-balance">
                Ask for "the military fare for personal travel"{bestCall?.flight.flights.length ? ` on ${list(bestCall.flight.flights)}` : ""}, {ymdNice(trip.depart)}{trip.return ? `, back ${ymdNice(trip.return)}` : ""}.{bestCall?.report?.conditions ? ` ${bestCall.report.conditions}` : " Have your military ID ready."}
              </p>
            </>
          ) : (
            <p className="text-[17px] font-semibold text-balance" style={HEAD}>The web fare is better. Book&nbsp;online.</p>
          )}
        </div>
        {best && desk && (
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
            <a href={`tel:${desk.tel}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white"><PhoneCall className="h-4 w-4" /> Call {best.airline}: {desk.phone}</a>
            <span className="text-center text-[12px] text-muted-foreground sm:text-right">Open {desk.hours}</span>
          </div>
        )}
      </div>
      {others.length > 0 && (
        <div className="grid divide-y divide-border text-[13px] sm:grid-cols-2 sm:divide-y-0 [&>*:nth-child(odd)]:sm:border-r [&>*]:border-border">
          {others.map((c) => <p key={c.id} className="flex items-center gap-2 px-4 py-2.5"><Tile code={c.iata} /><span>{callLine(c)}</span></p>)}
        </div>
      )}
    </div>
  );
}

/** One airline's answer in plain words: "Delta: military fare $441, online $429. The web fare is better." */
export function callLine(c: CallView): React.ReactNode {
  const name = airlineName(c.iata, c.airline);
  const fare = c.report?.militaryFare ?? null;
  const web = c.webPrice != null ? <> Book online at&nbsp;{money(c.webPrice)}.</> : null;
  const win = phoneWin(c);
  return (
    <>
      <b>{name}:</b>{" "}
      {c.status === "failed" ? <>we couldn't get an answer.{web}</>
        : c.report?.available === "no" ? <>no military fare on this flight.{web}</>
        : win != null && c.webPrice != null ? <>military fare {money(win)} vs {money(c.webPrice)} online. <span className="font-semibold">You save {money(c.webPrice - win)}.</span></>
        : fare != null && c.webPrice != null ? <>military fare {money(fare)}, online {money(c.webPrice)}. <span className="font-semibold">The web fare is better.</span></>
        : <>they couldn't say.{web}</>}
    </>
  );
}

function VeteranNote({ results }: { results: Result[] }) {
  const byIata = Array.from(new Map(results.map((r) => [r.iata, r])).values());
  const none = byIata.filter((r) => !perkLine(r.perk)).map((r) => airlineName(r.iata, r.airline));
  const some = byIata.filter((r) => !!perkLine(r.perk)).map((r) => airlineName(r.iata, r.airline));
  if (!none.length) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4" data-testid="travel-honest">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#053877] dark:text-white" />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-balance">{list(none)} {none.length === 1 ? "doesn't" : "don't"} discount flights for&nbsp;veterans</p>
        <p className="text-[13px] text-muted-foreground text-balance">
          So there's nothing for us to call about: book the lowest web fare.
          {some.length ? ` ${list(some)} ${some.length === 1 ? "has" : "have"} a perk for you, shown on the flight.` : " Avelo takes 15% off with a free WeSalute code, and Allegiant gives 2 free bags for your DD-214, where they fly."}
        </p>
      </div>
    </div>
  );
}
