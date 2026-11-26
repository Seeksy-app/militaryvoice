import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CalendarDays, Check, ChevronDown, ChevronsUp, Clock, ExternalLink, Info, Loader2, Luggage, MapPin, Phone, PhoneCall, Plane, PlaneLanding, PlaneTakeoff, Search, ShieldCheck, Tag as TagIcon, Users, X } from "lucide-react";
import type { TravelerStatus } from "@shared/militaryFares";
import { AIRPORTS, airlineColor, airlineName, airlineSite, airportName, checkedOn, deskOf, membershipLabel, perkTags, truePrice, type Perk } from "@/lib/travelPerks";
import { TravelSky } from "@/components/TravelSky";

// Travel (Andrew, 26 Nov 2026): a trip and the creator's status, flights from the server's Parallel search
// (server/creatorTravel.ts) with each airline's perk for them, and "Have us call" for airlines whose military fare is
// phone-only. Calls go out only while the server's gate is on (callsLive); until then a request is saved and the page
// says so. We never book or pay. The look follows Andrew's target (exports/travel-andrew-target.webp, 26 Nov); the
// words and numbers are ours, from shared/militaryFares.ts.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const SHOWN = 8;
const CALLS_AT_ONCE = 3; // the server's calls a day
const GOLD = "#F0A71F";

// What the server sends (server/creatorTravel.ts).
type Leg = { departure_airport: string; departure_time: string; arrival_airport: string; arrival_time: string; duration_minutes: number; stops: number; layovers: { airport: string }[] };
type Result = { i: number; price: number | null; url: string; iata: string; airline: string; flights: string[]; outbound: Leg; inbound: Leg | null; perk: Perk | null; canCall: boolean };
type Query = { from: string; to: string; depart: string; return: string; status: TravelerStatus };
type SearchResponse = { searchId: number; cached: boolean; searchesLeft: number | null; query: Query; results: Result[]; perks?: Perk[]; callsLive: boolean };
type Report = { available: "yes" | "no" | "unknown"; militaryFare: number | null; difference: number | null; conditions: string; summary: string };
export type CallView = { id: number; iata: string; airline: string; traveler: TravelerStatus; flight: { from: string; to: string; depart: string; return: string; flights: string[] }; webPrice: number | null; status: "waiting" | "calling" | "done" | "failed"; report: Report | null; error: string; createdAt: string; updatedAt: string };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const ymdLong = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
export const ymdNice = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const clock = (t: string) => { const m = /(\d{2}):(\d{2})$/.exec(t); if (!m) return t; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`; };
const dur = (m: number | null | undefined) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "");
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const tripKey = (t: { from: string; to: string; depart: string; return: string }) => `${t.from}|${t.to}|${t.depart}|${t.return || ""}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const sameFlights = (a: string[], b: string[]) => a.join() === b.join();
const whoFor = (s: TravelerStatus) => (s === "veteran" ? "veterans and retirees" : "active duty, Guard and Reserve");

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
  const [sort, setSort] = useState<"deal" | "price">("deal");
  const [bags, setBags] = useState(1);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const search = useMutation({
    mutationFn: (q: Query) => call<SearchResponse>("POST", "/api/travel/search", q),
    onSuccess: () => { setAll(false); setOpenRow(null); },
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

  // Best deal for you (Andrew, 26 Nov): fare + the bags they'd pay for − the ones they get free. A fee we don't have
  // keeps a flight out of that order; those come after, by fare, under a line that says why.
  const priced = useMemo(() => rows.map((x) => ({ ...x, tp: x.r.price != null ? truePrice(x.phone ?? x.r.price, x.r.perk, bags, trip!.status) : null })), [rows, bags]);
  const known = sort === "deal" ? priced.filter((x) => x.tp?.total != null).sort((a, b) => a.tp!.total! - b.tp!.total!) : priced;
  const unknown = sort === "deal" ? priced.filter((x) => x.tp?.total == null) : [];
  const shownKnown = all ? known : known.slice(0, SHOWN);
  const shownUnknown = all ? unknown : unknown.slice(0, Math.max(0, SHOWN - known.length));
  const row = (x: (typeof priced)[number], best = false) => <FlightRow key={x.r.i} r={x.r} best={best} searchedFrom={trip!.from} status={trip!.status} phoneFare={x.phone} call={x.call} tp={x.tp} bags={bags} open={openRow === x.r.i} onOpen={() => setOpenRow(openRow === x.r.i ? null : x.r.i)} />;
  const searched = trip && !search.isPending;

  return (
    <section className="mx-auto max-w-[1120px] pb-16 pt-1" data-testid="travel">
      <datalist id="mv-airports">{AIRPORTS.map(([c, n]) => <option key={c} value={`${n} (${c})`} />)}</datalist>

      {/* The title on a light sky, then the trip on a raised white card. */}
      <div className="relative overflow-hidden rounded-3xl px-3 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-7">
        <TravelSky />
        <div className="relative flex items-center gap-3 sm:gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#053877] text-white shadow-[0_6px_16px_-6px_rgba(5,56,119,0.6)] sm:h-[68px] sm:w-[68px]"><Luggage className="h-7 w-7 sm:h-8 sm:w-8" /></span>
          <span className="h-12 w-[3px] shrink-0 rounded-full sm:h-16" style={{ background: GOLD }} />
          <div className="min-w-0">
            <h1 className="text-[34px] font-bold leading-none tracking-tight text-[#0b1b33] sm:text-[46px] dark:text-white" style={HEAD}>Travel</h1>
            <p className="mt-1.5 text-[14px] leading-snug text-[#24324a] text-balance sm:text-[18px] dark:text-white/80">Compare flights and military travel benefits in one&nbsp;place.</p>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); go(); }} className="relative mt-5 rounded-2xl border border-white/70 bg-card p-3 shadow-[0_14px_34px_-16px_rgba(5,56,119,0.45)] sm:mt-7 sm:p-4 dark:border-white/10" data-testid="travel-trip">
          <div className="grid grid-cols-2 gap-2 sm:flex" role="radiogroup" aria-label="I'm">
            {(["veteran", "active"] as const).map((s) => {
              const on = status === s;
              const Icon = s === "veteran" ? Users : ChevronsUp;
              return (
                <button key={s} type="button" role="radio" aria-checked={on} onClick={() => pickStatus(s)} className={`flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-[13px] font-semibold leading-tight transition-colors sm:justify-start sm:px-5 sm:text-[15px] ${on ? "border-[#053877] bg-[#053877] text-white shadow-[0_0_0_2px_#F0A71F]" : "border-border bg-card text-foreground hover:bg-muted"}`} data-testid={`travel-status-${s}`}>
                  <Icon className={`h-4 w-4 shrink-0 sm:h-5 sm:w-5 ${on ? "text-[#F0A71F]" : "text-[#053877] dark:text-white"}`} />
                  <span className="text-left sm:whitespace-nowrap">{s === "veteran" ? "Veteran or retiree" : "Active duty, Guard or Reserve"}</span>
                </button>
              );
            })}
          </div>
          {/* One row on a wide screen; From–To over the dates on a narrower one; stacked on a phone. */}
          <div className="mt-3 flex flex-col gap-2 xl:flex-row xl:items-stretch">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch xl:min-w-0 xl:flex-1">
              <Field label="From" icon={MapPin} className="sm:min-w-0 sm:flex-1"><input list="mv-airports" aria-label="From" value={fromText} onChange={(e) => setFromText(e.target.value)} onBlur={() => from && setFromText(label(from))} placeholder="City or airport" className="w-full min-w-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground" data-testid="travel-from" /></Field>
              <button type="button" aria-label="Swap From and To" onClick={() => { setFromText(toText); setToText(fromText); }} className="hidden h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-border bg-card text-foreground hover:bg-muted sm:flex"><ArrowLeftRight className="h-4 w-4" /></button>
              <Field label="To" icon={MapPin} className="sm:min-w-0 sm:flex-1"><input list="mv-airports" aria-label="To" value={toText} onChange={(e) => setToText(e.target.value)} onBlur={() => to && setToText(label(to))} placeholder="City or airport" className="w-full min-w-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground" data-testid="travel-to" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch">
              <DateField label="Depart" aria="Leave" value={leave} min={todayEt()} onChange={(v) => { setLeave(v); if (back && v > back) setBack(""); }} testid="travel-leave" />
              <DateField label="Return" aria="Back" hint="Optional" value={back} min={leave || todayEt()} onChange={setBack} onClear={() => setBack("")} testid="travel-back" />
              <button type="submit" disabled={!ready || search.isPending} className="col-span-2 flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-6 py-3 text-[16px] font-bold text-[#1a1200] shadow-[0_6px_14px_-6px_rgba(240,167,31,0.9)] transition-colors hover:brightness-95 disabled:opacity-60 sm:flex-1 sm:py-0 xl:flex-none" style={{ background: GOLD }} data-testid="travel-find">
                {search.isPending ? <><Loader2 className="h-5 w-5 animate-spin" /> Finding flights</> : <><Search className="h-5 w-5" strokeWidth={2.5} /> Find Flights</>}
              </button>
            </div>
          </div>
          {(formError || search.error) && <p className="px-1 pt-2 text-[13px] font-medium text-[#b42318]">{formError || (search.error as Error).message}</p>}
        </form>
      </div>

      <div className="mt-3 flex items-start gap-3 rounded-xl border border-[#c7d7f2] bg-[#e8f0fd] px-4 py-3 dark:border-white/10 dark:bg-white/5" data-testid="travel-banner">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#0b1b33] dark:text-white" />
        <p className="text-[14px] font-medium leading-snug text-[#0b1b33] text-balance dark:text-white">{status === "active" ? "Military" : "Veteran"} travel benefits vary by airline. Some offer discounted fares, others offer vacation-package savings or free baggage. We'll show what's confirmed and how to claim&nbsp;it.</p>
      </div>

      {search.isPending && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-10 text-center text-[14px] text-muted-foreground text-balance" data-testid="travel-loading">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Finding flights and each airline's perk for you. This can take up to half a&nbsp;minute.
        </div>
      )}

      {searched && results.length > 0 && <Benefits results={results} perks={data?.perks ?? []} status={trip.status} />}

      {/* What came back from the calls, or the offer to make them. */}
      {searched && results.length > 0 && (pending.length > 0 || finished.length > 0 || (trip.status === "active" && toCall.length > 0)) && (
        <div className="mt-4">
          {pending.length > 0 ? (
            <Waiting calls={pending} live={callsLive} />
          ) : finished.length > 0 ? (
            <CallReport calls={finished} trip={trip} results={results} />
          ) : (
            <CallOffer airlines={toCall.map((r) => airlineName(r.iata, r.airline))} live={callsLive} pending={askCalls.isPending} error={askCalls.error ? (askCalls.error as Error).message : ""} onCall={() => askCalls.mutate(toCall.map((r) => ({ searchId: data!.searchId, i: r.i })))} />
          )}
        </div>
      )}

      {searched && (
        <div className="mt-4 rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(16,24,40,0.05)]" data-testid="travel-results">
          <div className="flex flex-col gap-2 px-4 pb-3 pt-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-[20px] font-bold" style={HEAD}>Flight Results</h2>
              <p className="text-[13px] text-muted-foreground text-balance">{results.length ? <>{results.length} {results.length === 1 ? "flight" : "flights"} found. Comparing fares and military benefits to find your best travel&nbsp;value.</> : "No flights found."}</p>
            </div>
            {results.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">Sort by:</span>
                <Select label="Sort" value={sort} onChange={(v) => setSort(v as "deal" | "price")} testid="travel-sort" options={[["deal", "Best deal for you"], ["price", "Lowest price"]]} />
                <Select label="Checked bags" value={String(bags)} onChange={(v) => setBags(Number(v))} testid="travel-bags" options={[["0", "No checked bags"], ["1", "1 checked bag"], ["2", "2 checked bags"]]} />
              </div>
            )}
          </div>
          {results.length === 0 ? (
            <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground text-balance">No flights came back for those days. Try a day either side, or a nearby&nbsp;airport.</p>
          ) : (
            <div className="pb-2">
              {shownKnown.length > 0 && sort === "deal" && <div className="px-2 pb-2 sm:px-3">{row(shownKnown[0], true)}</div>}
              <div className="divide-y divide-border border-t border-border">{(sort === "deal" ? shownKnown.slice(1) : shownKnown).map((x) => row(x))}</div>
              {shownUnknown.length > 0 && (
                <>
                  <p className="border-y border-border bg-muted/40 px-4 py-1.5 text-[12px] font-medium text-muted-foreground sm:px-5">Bag fees aren't listed for these airlines yet, so they're sorted by&nbsp;fare</p>
                  <div className="divide-y divide-border">{shownUnknown.map((x) => row(x))}</div>
                </>
              )}
            </div>
          )}
          {!all && results.length > SHOWN && (
            <button type="button" onClick={() => setAll(true)} className="w-full rounded-b-2xl border-t border-border py-2.5 text-[13px] font-semibold text-[#053877] hover:bg-muted dark:text-white">Show all {results.length} flights</button>
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

function Field({ label, icon: Icon, className, children }: { label: string; icon: typeof MapPin; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col rounded-xl border border-border bg-background px-3 py-2 focus-within:border-[#053877] focus-within:ring-1 focus-within:ring-[#053877] ${className ?? ""}`}>
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-[#0b1b33] dark:text-white" />{children}</span>
    </label>
  );
}

/** A date box that reads "Dec 1, 2026"; the real date input sits on top, invisible, so any tap opens the picker. */
function DateField({ label, aria, hint, value, min, onChange, onClear, testid }: { label: string; aria: string; hint?: string; value: string; min: string; onChange: (v: string) => void; onClear?: () => void; testid: string }) {
  return (
    <label className="relative flex min-w-0 flex-col rounded-xl border border-border bg-background px-3 py-2 focus-within:border-[#053877] focus-within:ring-1 focus-within:ring-[#053877] sm:w-[168px] sm:shrink-0">
      <span className="text-[12px] font-medium text-muted-foreground">{label}{hint && !value ? <span className="font-normal"> · {hint}</span> : null}</span>
      <span className="mt-0.5 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-[#0b1b33] dark:text-white" />
        <span className={`truncate text-[16px] ${value ? "font-semibold" : "text-muted-foreground"}`}>{value ? ymdLong(value) : "Add date"}</span>
      </span>
      <input type="date" aria-label={aria} min={min} value={value} onChange={(e) => onChange(e.target.value)} onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* older browsers open it themselves */ } }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-testid={testid} />
      {value && onClear && <button type="button" onClick={(e) => { e.preventDefault(); onClear(); }} aria-label={`Clear ${label}`} className="absolute right-2 top-2 z-10 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
    </label>
  );
}

function Select({ label, value, onChange, options, testid }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testid: string }) {
  return (
    <label className="relative flex items-center rounded-lg border border-border bg-card text-[13px] font-semibold">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent py-1.5 pl-3 pr-8 outline-none" data-testid={testid}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5" />
    </label>
  );
}

/** A round badge in the airline's colour with its two-letter code (no logo). */
export function Tile({ code }: { code: string }) {
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white shadow-sm" style={{ background: airlineColor(code) }}>{code}</span>;
}

/** A tag in Andrew's grey-pill style; a confirmed benefit gets a green tick, a phone-only fare a phone. */
function Tag({ tone, children }: { tone: "green" | "grey" | "amber"; children: React.ReactNode }) {
  const c = tone === "green" ? "bg-[#ecf7f0] text-[#14532d] ring-[#bfe3cc] dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
    : tone === "amber" ? "bg-[#FFF3D6] text-[#7a4f00] ring-[#F0A71F]/50 dark:bg-[#F0A71F]/10 dark:text-[#F0A71F]"
    : "bg-[#f1f4f9] text-foreground/75 ring-[#e3e8f0] dark:bg-white/5 dark:ring-white/10";
  const Icon = tone === "green" ? Check : tone === "amber" ? Phone : Info;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 ${c}`}><Icon className="h-3.5 w-3.5 shrink-0" />{children}</span>;
}

/**
 * Verified Military Benefits by Airline (Andrew, 26 Nov): only for the status picked, only airlines in the results
 * (plus up to two standouts the server sends, Breeze and Avelo, for veterans). Each card: the name in the airline's
 * colour, a gold rule, the benefit, how to claim it and where we checked.
 */
function Benefits({ results, perks, status }: { results: Result[]; perks: Perk[]; status: TravelerStatus }) {
  // On a phone, three cards then "Show all", so the flights aren't six cards down.
  const [more, setMore] = useState(false);
  const seen = new Map<string, Perk>();
  for (const r of results) if (r.perk && !seen.has(r.iata)) seen.set(r.iata, r.perk);
  const has = (p: Perk) => { const t = perkTags(p, status); return !!t && (t.phone || !!t.fare || !!t.bags); };
  const here = Array.from(seen.values()).filter(has);
  const away = status === "veteran" ? perks.filter((p) => !seen.has(p.iata) && has(p)).slice(0, 2) : [];
  const nothing = Array.from(seen.values()).filter((p) => p.flying && !has(p)).map((p) => airlineName(p.iata, p.airline));
  if (!here.length && !away.length && !nothing.length) return null;
  const cards = [...here.map((p) => ({ p, off: false })), ...away.map((p) => ({ p, off: true }))];
  const newest = cards.map((c) => c.p.lastVerified ?? "").sort().pop();
  return (
    <div className="mt-5" data-testid="travel-benefits">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h2 className="flex items-center gap-2 text-[19px] font-bold sm:text-[20px]" style={HEAD}><TagIcon className="h-5 w-5 shrink-0 -scale-x-100" style={{ color: GOLD }} /> Verified Military Benefits by&nbsp;Airline</h2>
        {newest && <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" style={{ color: GOLD }} /> Benefits are based on each airline's published program (checked {checkedOn(newest)}).</p>}
      </div>
      {cards.length > 0 && (
        <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ p, off }, k) => {
            const t = perkTags(p, status)!;
            const site = airlineSite(p.iata);
            const name = airlineName(p.iata, p.airline);
            return (
              <div key={p.iata} className={`${k >= 3 && !more ? "hidden md:flex" : "flex"} items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]`} data-testid={`benefit-${p.iata}`}>
                <span className="w-[96px] shrink-0 text-center text-[18px] font-extrabold leading-[1.05] tracking-tight" style={{ color: airlineColor(p.iata), ...HEAD }}>{name}</span>
                <span className="h-11 w-[2px] shrink-0 self-center rounded-full" style={{ background: GOLD }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="text-[14px] font-bold">{name}</p>{off && <span className="whitespace-nowrap rounded-full bg-muted px-2 py-px text-[11px] font-medium text-muted-foreground">Not on this route</span>}</div>
                  <p className="text-[13px] leading-snug text-foreground/80">{[t.phone ? "Military fare by phone" : t.fare, t.bags].filter(Boolean).join(" · ")}</p>
                  {p.claim?.line && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground"><span className="font-semibold text-foreground/80">How to claim:</span> {p.claim.line}{membershipLabel(p.claim.membership) && <span className="ml-1 inline-block rounded-full bg-[#eef4ff] px-1.5 py-px text-[10.5px] font-semibold text-[#053877] dark:bg-white/10 dark:text-white">{membershipLabel(p.claim.membership)}</span>}</p>}
                  {p.bookingUrl && <a href={p.bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">Source: {site ?? "the airline's page"}</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {cards.length > 3 && !more && <button type="button" onClick={() => setMore(true)} className="mt-2 w-full rounded-xl border border-border bg-card py-2 text-[13px] font-semibold text-[#053877] md:hidden dark:text-white">Show all {cards.length} airlines</button>}
      {nothing.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">No {status === "veteran" ? "veteran" : "military"} benefit on {list(nothing)}.</p>}
    </div>
  );
}

function LegLine({ icon: Icon, leg, prefix }: { icon: typeof PlaneTakeoff; leg: Leg; prefix?: string }) {
  const stops = leg.stops === 0 ? "Nonstop" : `${leg.stops} ${leg.stops === 1 ? "stop" : "stops"}${leg.layovers?.length ? `, ${leg.layovers.map((l) => l.airport).join(", ")}` : ""}`;
  const nextDay = leg.arrival_time.slice(0, 10) > leg.departure_time.slice(0, 10);
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 leading-tight">
        <p className="whitespace-nowrap text-[14px] font-semibold tabular-nums">{clock(leg.departure_time)} – {clock(leg.arrival_time)}{nextDay ? <sup className="ml-0.5 text-[10px] text-muted-foreground">+1</sup> : null}</p>
        <p className="truncate text-[12px] text-muted-foreground">{prefix}{stops}{leg.duration_minutes ? ` • ${dur(leg.duration_minutes)}` : ""}</p>
      </div>
    </div>
  );
}

function FlightRow({ r, best, searchedFrom, status, phoneFare, call: c, tp, bags, open, onOpen }: { r: Result; best: boolean; searchedFrom: string; status: TravelerStatus; phoneFare: number | null; call?: CallView; tp: ReturnType<typeof truePrice> | null; bags: number; open: boolean; onOpen: () => void }) {
  const name = airlineName(r.iata, r.airline);
  const site = airlineSite(r.iata);
  const desk = deskOf(r.iata);
  const t = perkTags(r.perk, status);
  const o = r.outbound;
  const fromOther = o.departure_airport && o.departure_airport !== searchedFrom ? `From ${o.departure_airport} · ` : "";
  const fare = phoneFare ?? r.price;
  const pop = useRef<HTMLDivElement>(null);
  // Close the popover on a click anywhere else or Escape.
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (pop.current && !pop.current.contains(e.target as Node)) onOpen(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onOpen(); };
    const id = setTimeout(() => document.addEventListener("click", off), 0);
    document.addEventListener("keydown", esc);
    return () => { clearTimeout(id); document.removeEventListener("click", off); document.removeEventListener("keydown", esc); };
  }, [open, onOpen]);
  // The fare tag: what we heard on a call, else the phone-only fare, else a real discount, else none. Never a guessed price.
  const quoted = c?.status === "done" && c.report?.available === "yes" ? c.report.militaryFare : null;
  const fareTag = c?.status === "done"
    ? quoted != null ? <Tag tone={phoneFare != null ? "green" : "grey"}>Military fare {money(quoted)} by phone</Tag>
      : <Tag tone="grey">{c.report?.available === "no" ? "No military fare here" : "Airline couldn't say"}</Tag>
    : c?.status === "failed" ? <Tag tone="grey">We couldn't get an answer</Tag>
    : c ? <Tag tone="amber">We're asking for the military fare</Tag>
    : t?.phone ? <Tag tone="amber">Call for military price</Tag>
    : t?.fare ? <Tag tone="green">{t.fare}</Tag>
    : <Tag tone="grey">No {status === "veteran" ? "veteran" : "military"} fare discount</Tag>;
  const freeBags = !!tp?.lines.some((l) => l.free);
  const sub = phoneFare != null ? "military fare, by phone" : !tp ? "" : tp.total == null ? "+ bags (fee not listed)" : tp.total !== fare && bags > 0 ? `with ${bags} ${bags === 1 ? "bag" : "bags"}` : freeBags && t?.member ? "bags free with WeSalute+" : freeBags ? "bags included" : "";
  const button = "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold sm:w-[214px] sm:flex-none sm:shrink-0 sm:px-4 sm:text-[14px]";
  return (
    <div className={`relative px-4 py-3.5 sm:px-5 ${best ? "rounded-2xl border-2 bg-[#fffdf7] dark:bg-[#F0A71F]/5" : ""}`} style={best ? { borderColor: GOLD } : undefined} data-testid={`flight-${r.iata}`}>
      {best && <span className="absolute -top-2.5 left-4 rounded-full px-2 py-px text-[11px] font-bold text-[#1a1200]" style={{ background: GOLD }}>Best deal for you</span>}
      {/* Wide: the airline, its legs, the price and the button on one line, the two tags under the legs. Phone: stacked. */}
      <div className="grid gap-3 lg:grid-cols-[150px_minmax(0,1fr)_auto] lg:gap-x-5 lg:gap-y-2.5">
        <div className="flex items-center gap-3 lg:row-span-2 lg:self-center">
          <Tile code={r.iata} />
          <p className="min-w-0 text-[16px] font-bold leading-tight">{name}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-8 lg:col-start-2 lg:row-start-1 lg:flex-col lg:gap-1.5 lg:self-center">
          <LegLine icon={PlaneTakeoff} leg={o} prefix={fromOther} />
          {r.inbound && <LegLine icon={PlaneLanding} leg={r.inbound} />}
        </div>
        {/* Two tags, never one mixed line: the fare, then the bags. Then the full story behind one link. */}
        <div className="flex flex-wrap items-center gap-1.5 lg:col-span-2 lg:col-start-2 lg:row-start-2">
          {t ? <>{fareTag}<Tag tone={t.bags ? "green" : "grey"}>{t.bags ?? "No free bags"}</Tag></> : <Tag tone="grey">{r.perk && !r.perk.flying ? "Not flying" : `${name}'s military rules aren't in our list yet`}</Tag>}
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-expanded={open} className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-foreground/80 hover:text-foreground" data-testid={`baggage-${r.iata}`}>
            <Luggage className="h-4 w-4" /> Baggage &amp; eligibility <Info className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 sm:gap-4 lg:col-start-3 lg:row-start-1 lg:justify-end lg:self-center">
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} disabled={!tp} className="shrink-0 text-left leading-tight sm:min-w-[96px] lg:w-[160px] lg:border-l lg:border-border lg:pl-5" data-testid={`price-${r.iata}`}>
            <span className="block whitespace-nowrap text-[26px] font-bold tabular-nums" style={HEAD}>{fare == null ? "—" : money(tp?.total ?? fare)}</span>
            <span className="block whitespace-nowrap text-[13px] text-muted-foreground">{r.inbound ? "round trip" : "one way"}</span>
            {sub && <span className="block whitespace-nowrap text-[11.5px] font-medium text-[#053877] dark:text-white/80">{sub}</span>}
          </button>
          {phoneFare != null && desk ? (
            <a href={`tel:${desk.tel}`} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}><Phone className="h-4 w-4" /> {desk.phone}</a>
          ) : r.perk?.phoneOnly && status !== "active" && desk ? (
            <a href={`tel:${desk.tel}`} className={`${button} border-2 border-[#c7d7f2] text-[#053877] hover:bg-[#eef4ff] dark:text-white`} data-testid={`book-${r.iata}`}><Phone className="h-4 w-4" /> Book by phone {desk.phone}</a>
          ) : (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className={`${button} border-2 border-[#c7d7f2] text-[#053877] hover:bg-[#eef4ff] dark:text-white`} data-testid={`book-${r.iata}`}>
              Book on {site ?? "the airline's site"} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
      {open && (
        <div ref={pop} onClick={(e) => e.stopPropagation()} className="z-20 mt-3 rounded-xl border border-border bg-card p-4 text-[13px] shadow-[0_16px_40px_-12px_rgba(11,27,51,0.35)] lg:absolute lg:left-[170px] lg:top-[calc(100%-6px)] lg:mt-0 lg:w-[400px]" role="dialog" aria-label={`Baggage and eligibility: ${name}`} data-testid={`price-detail-${r.iata}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-[14px] font-bold"><Luggage className="h-4 w-4" /> Baggage &amp; Eligibility – {name}</p>
            <button type="button" onClick={onOpen} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
            <li><b>Military fare:</b> {quoted != null ? `${money(quoted)} by phone, quoted on our call.` : t?.phone ? "by phone only, for active duty, Guard and Reserve. It isn't online." : t?.fare ? `${t.fare}.` : `none for ${whoFor(status)}.`}</li>
            <li><b>Free baggage:</b> {t?.bags ? `${t.bags}.` : `none for ${whoFor(status)}.`}{r.perk?.bagFees && (r.perk.bagFees.first != null || r.perk.bagFees.second != null) ? ` Standard fees: ${r.perk.bagFees.first != null ? `${money(r.perk.bagFees.first)} first bag` : ""}${r.perk.bagFees.first != null && r.perk.bagFees.second != null ? ", " : ""}${r.perk.bagFees.second != null ? `${money(r.perk.bagFees.second)} second` : ""}.` : r.perk ? " Standard bag fees aren't listed yet." : ""}</li>
            <li><b>Who it's for:</b> this is what {name} offers {whoFor(status)}. {status === "veteran" ? "Active duty" : "Veterans"} can get something different; switch above to see it.</li>
            {r.perk?.claim?.line && t && (t.fare || t.bags || t.phone) && <li><b>How to claim:</b> {r.perk.claim.line}{membershipLabel(r.perk.claim.membership) ? ` (${membershipLabel(r.perk.claim.membership)})` : ""}.</li>}
            {r.perk?.stacking && !/^Not (stated|applicable)\.?$/i.test(r.perk.stacking.trim()) && (t?.fare || t?.bags) && <li><b>Combines with:</b> {r.perk.stacking}</li>}
          </ul>
          {tp && (
            <dl className="mt-3 space-y-1 rounded-lg bg-muted/50 px-3 py-2">
              {tp.lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l.label}{l.label === "Fare" && phoneFare != null ? " (military, by phone)" : ""}</dt><dd className={`font-medium tabular-nums ${l.free ? "text-emerald-700 dark:text-emerald-400" : l.value === "Fee not listed" ? "text-muted-foreground" : ""}`}>{l.value}</dd></div>)}
              <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>Your price</dt><dd className="tabular-nums">{tp.total != null ? money(tp.total) : `${money(fare!)} + bags`}</dd></div>
            </dl>
          )}
          {tp?.note && <p className="mt-1.5 text-[11px] text-muted-foreground">{tp.note}</p>}
          {r.perk?.bookingUrl && <a href={r.perk.bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 block text-[11px] text-muted-foreground underline">Source: {site ?? "the airline's page"}{r.perk.lastVerified ? `, checked ${checkedOn(r.perk.lastVerified)}` : ""}</a>}
        </div>
      )}
    </div>
  );
}

function CallOffer({ airlines, live, onCall, pending, error }: { airlines: string[]; live: boolean; onCall: () => void; pending: boolean; error: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#F0A71F]/60 bg-[#FFF8E8] p-4 sm:flex-row sm:items-center dark:bg-[#F0A71F]/10" data-testid="travel-call-offer">
      <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#1a1200] sm:flex"><PhoneCall className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold text-balance" style={HEAD}>We'll call {list(airlines)} for your military fare and tell you what they&nbsp;quote.</p>
        <p className="text-[13px] text-muted-foreground text-balance">Their military fares aren't online. Our automated caller asks for your flight and reports back here. It never books, pays or gives your&nbsp;details.{live ? "" : " We'll save your trip and call once it's switched on."}</p>
        {error && <p className="mt-1 text-[13px] font-medium text-[#b42318]">{error}</p>}
      </div>
      <button type="button" onClick={onCall} disabled={pending} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#053877] px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-60" data-testid="travel-call">
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

/**
 * What the calls came back with (Andrew, 26 Nov): once a real quote exists, the online fare beside the military fare,
 * and an honest verdict. Our first test call quoted $465 against $129 online, so "the online fare is cheaper" is as
 * likely as a saving.
 */
function CallReport({ calls, trip, results }: { calls: CallView[]; trip: Query; results: Result[] }) {
  const best = bestOf(calls);
  const quoted = calls.filter((c) => c.status === "done" && c.report?.available === "yes" && c.report.militaryFare != null && c.webPrice != null);
  // The one to show side by side: the saving if there is one, else the closest quote.
  const shown = best ? calls.find((c) => c.iata === best.iata) : [...quoted].sort((a, b) => (a.report!.militaryFare! - a.webPrice!) - (b.report!.militaryFare! - b.webPrice!))[0];
  const desk = best ? deskOf(best.iata) : null;
  const others = calls.filter((c) => c.id !== shown?.id);
  const last = calls.map((c) => c.updatedAt || c.createdAt).sort().pop() ?? "";
  const when = last ? new Date(last).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  const n = calls.length;
  const name = shown ? airlineName(shown.iata, shown.airline) : "";
  const flight = shown ? results.find((r) => r.iata === shown.iata && sameFlights(r.flights, shown.flight.flights)) ?? results.find((r) => r.iata === shown.iata) : undefined;
  const freeBags = !!perkTags(flight?.perk, trip.status)?.bags;
  const web = shown?.webPrice ?? null;
  const mil = shown?.report?.militaryFare ?? null;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="travel-report">
      <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">We called {n} {n === 1 ? "airline" : "airlines"}{when ? ` · ${when}` : ""}</p>
      {shown && web != null && mil != null ? (
        <div className="flex flex-col gap-3 p-4 pt-2 sm:flex-row sm:items-center">
          <div className="grid flex-1 grid-cols-2 gap-2">
            {[
              { k: "web", label: `${name} online`, v: web, win: !best, sub: best ? "Public web fare" : freeBags ? "Cheaper · bags free with your ID" : "Cheaper" },
              { k: "mil", label: `${name} military fare, by phone`, v: mil, win: !!best, sub: best ? `You save ${money(web - mil)}` : "What the airline quoted" },
            ].map((x) => (
              <div key={x.k} className={`rounded-xl px-3 py-2 ${x.win ? "border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border border-border bg-muted/40"}`} data-testid={`report-${x.k}`}>
                <p className={`text-[12px] font-semibold ${x.win ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>{x.label}</p>
                <p className={`text-[26px] font-bold leading-tight tabular-nums ${x.win ? "" : "text-foreground/70"}`}>{money(x.v)}</p>
                <p className={`text-[12px] ${x.win ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>{x.sub}</p>
              </div>
            ))}
          </div>
          <div className="sm:w-[270px]">
            {best ? (
              <>
                <p className="text-[17px] font-semibold text-balance" style={HEAD}>The military fare is cheaper. Call {name} to book&nbsp;it.</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground text-balance">Ask for "the military fare for personal travel"{shown.flight.flights.length ? ` on ${list(shown.flight.flights)}` : ""}, {ymdNice(trip.depart)}{trip.return ? `, back ${ymdNice(trip.return)}` : ""}.{shown.report?.conditions ? ` ${shown.report.conditions}` : " Have your military ID ready."}</p>
                {desk && <a href={`tel:${desk.tel}`} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white"><PhoneCall className="h-4 w-4" /> Call {name}: {desk.phone}</a>}
                {desk?.hours && <p className="mt-1 text-center text-[12px] text-muted-foreground">Open {desk.hours}</p>}
              </>
            ) : (
              <>
                <p className="text-[17px] font-semibold text-balance" style={HEAD}>The online fare is cheaper. Book online{freeBags ? " and use your free bags" : ""}.</p>
                {flight?.url && <a href={flight.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white">Book on {airlineSite(shown.iata) ?? "the airline's site"} <ExternalLink className="h-3.5 w-3.5" /></a>}
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="px-4 pb-3 pt-1 text-[17px] font-semibold text-balance" style={HEAD}>No airline quoted a military fare for these flights. Book the online&nbsp;fare.</p>
      )}
      {others.length > 0 && (
        <div className="grid divide-y divide-border border-t border-border text-[13px] sm:grid-cols-2 sm:divide-y-0 [&>*:nth-child(odd)]:sm:border-r [&>*]:border-border">
          {others.map((c) => <p key={c.id} className="px-4 py-2.5">{callLine(c)}</p>)}
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
