import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, Info, Loader2, Phone, PhoneCall, Plane, X } from "lucide-react";
import type { TravelerStatus } from "@shared/militaryFares";
import { AIRPORTS, airlineName, airlineSite, airportName, checkedOn, deskOf, membershipLabel, perkTags, truePrice, type Perk } from "@/lib/travelPerks";

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
type SearchResponse = { searchId: number; cached: boolean; searchesLeft: number | null; query: Query; results: Result[]; perks?: Perk[]; callsLive: boolean };
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
  const [sort, setSort] = useState<"deal" | "price">("deal");
  const [bags, setBags] = useState(1);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const search = useMutation({
    mutationFn: (q: Query) => call<SearchResponse>("POST", "/api/travel/search", q),
    onSuccess: () => { setAll(false); setEditing(false); setOpenRow(null); },
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
  const statusPills = (cls: string) => (
    <div className={cls} role="radiogroup" aria-label="I'm">
      {(["veteran", "active"] as const).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => pickStatus(s)} className={`rounded-lg px-2 py-1.5 text-center text-[13px] font-semibold leading-tight transition-colors sm:whitespace-nowrap sm:rounded-full sm:px-3 sm:py-1 ${status === s ? "bg-[#053877] text-white dark:bg-white dark:text-[#053877]" : "text-foreground/70 hover:bg-muted"}`} data-testid={`travel-status-${s}`}>
          {s === "veteran" ? "Veteran or retiree" : "Active duty, Guard or Reserve"}
        </button>
      ))}
    </div>
  );
  const row = (x: (typeof priced)[number]) => <FlightRow key={x.r.i} r={x.r} searchedFrom={trip!.from} status={trip!.status} phoneFare={x.phone} call={x.call} tp={x.tp} open={openRow === x.r.i} onOpen={() => setOpenRow(openRow === x.r.i ? null : x.r.i)} />;

  return (
    <section className="mx-auto max-w-[960px] pb-16 pt-1" data-testid="travel">
      <datalist id="mv-airports">{AIRPORTS.map(([c, n]) => <option key={c} value={`${n} (${c})`} />)}</datalist>
      <div className="mb-4">
        <h1 className="text-[28px] font-semibold tracking-tight" style={HEAD}>Travel</h1>
        <p className="text-[14px] text-muted-foreground text-balance">Your military fares and perks for a trip, airline by&nbsp;airline.</p>
      </div>

      {/* The trip: who you are, then where and when. Once searched it folds to one line, with who you are beside it. */}
      {!editing && trip ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5" data-testid="travel-trip-folded">
            <Plane className="h-5 w-5 shrink-0 text-[#053877] dark:text-white" />
            <button type="button" onClick={() => setEditing(true)} className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-[15px] font-semibold">{airportName(trip.from)} ({trip.from}) → {airportName(trip.to)} ({trip.to})</span>
              <span className="block truncate text-xs text-muted-foreground">{ymdNice(trip.depart)}{trip.return ? ` – ${ymdNice(trip.return)}` : " · one way"} · 1 person</span>
            </button>
            {statusPills("hidden gap-1 rounded-full bg-muted/60 p-0.5 sm:flex")}
            <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-sm font-semibold text-[#053877] dark:text-white" data-testid="travel-change">Change</button>
          </div>
          {statusPills("mt-2 grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1 sm:hidden")}
        </>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className={`${!editing && trip ? "hidden" : ""} rounded-2xl border border-border bg-card p-2 shadow-sm`} data-testid="travel-trip">
        {statusPills("mb-2 grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1 sm:flex sm:bg-transparent sm:p-0 sm:px-1 sm:pt-0.5")}
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

      {trip && !search.isPending && results.length > 0 && <Benefits results={results} perks={data?.perks ?? []} status={trip.status} />}

      {/* What came back from the calls, or the offer to make them. */}
      {trip && !search.isPending && results.length > 0 && (pending.length > 0 || finished.length > 0 || (trip.status === "active" && toCall.length > 0)) && (
        <div className="mt-3">
          {pending.length > 0 ? (
            <Waiting calls={pending} live={callsLive} />
          ) : finished.length > 0 ? (
            <CallReport calls={finished} trip={trip} results={results} />
          ) : (
            <CallOffer airlines={toCall.map((r) => airlineName(r.iata, r.airline))} live={callsLive} pending={askCalls.isPending} error={askCalls.error ? (askCalls.error as Error).message : ""} onCall={() => askCalls.mutate(toCall.map((r) => ({ searchId: data!.searchId, i: r.i })))} />
          )}
        </div>
      )}

      {trip && !search.isPending && (
        <div className="mt-3 rounded-2xl border border-border bg-card" data-testid="travel-results">
          <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground text-balance">
              {results.length ? <><b className="text-foreground">{results.length} {results.length === 1 ? "flight" : "flights"} found.</b> Comparing fares and military benefits to find your best travel&nbsp;value.</> : <b className="text-foreground">No flights found.</b>}
            </p>
            {results.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <div className="flex rounded-full bg-muted/70 p-0.5 text-[12px] font-semibold" role="radiogroup" aria-label="Sort">
                  {(["deal", "price"] as const).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={sort === s} onClick={() => setSort(s)} className={`whitespace-nowrap rounded-full px-3 py-1 ${sort === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid={`travel-sort-${s}`}>{s === "deal" ? "Best deal for you" : "Lowest price"}</button>
                  ))}
                </div>
                <label className="relative flex items-center rounded-full border border-border text-[12px] font-semibold">
                  <span className="sr-only">Checked bags</span>
                  <select value={bags} onChange={(e) => setBags(Number(e.target.value))} className="appearance-none bg-transparent py-1 pl-3 pr-7 outline-none" data-testid="travel-bags">
                    <option value={0}>No checked bags</option><option value={1}>1 checked bag</option><option value={2}>2 checked bags</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 h-3 w-3" />
                </label>
              </div>
            )}
          </div>
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground text-balance">No flights came back for those days. Try a day either side, or a nearby&nbsp;airport.</p>
          ) : (
            <>
              <div className="divide-y divide-border">{shownKnown.map(row)}</div>
              {shownUnknown.length > 0 && (
                <>
                  <p className={`border-b border-border bg-muted/40 px-4 py-1.5 text-[12px] font-medium text-muted-foreground ${shownKnown.length ? "border-t" : ""}`}>Bag fees aren't listed for these airlines yet, so they're sorted by&nbsp;fare</p>
                  <div className="divide-y divide-border">{shownUnknown.map(row)}</div>
                </>
              )}
            </>
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

function Tag({ tone, children }: { tone: "green" | "grey" | "amber"; children: React.ReactNode }) {
  const c = tone === "green" ? "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
    : tone === "amber" ? "bg-[#FFF3D6] text-[#7a4f00] ring-[#F0A71F]/50 dark:bg-[#F0A71F]/10 dark:text-[#F0A71F]"
    : "bg-muted text-muted-foreground ring-border";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${c}`}>{children}</span>;
}

/**
 * Your benefits (Andrew, 26 Nov): only for the status picked, only airlines in the results (plus up to two standouts
 * the server sends, Breeze and Avelo, for veterans), each with its benefit, how to claim it and where we checked.
 */
function Benefits({ results, perks, status }: { results: Result[]; perks: Perk[]; status: TravelerStatus }) {
  const seen = new Map<string, Perk>();
  for (const r of results) if (r.perk && !seen.has(r.iata)) seen.set(r.iata, r.perk);
  const has = (p: Perk) => { const t = perkTags(p, status); return !!t && (t.phone || !!t.fare || !!t.bags); };
  const here = Array.from(seen.values()).filter(has);
  const away = status === "veteran" ? perks.filter((p) => !seen.has(p.iata) && has(p)).slice(0, 2) : [];
  const nothing = Array.from(seen.values()).filter((p) => p.flying && !has(p)).map((p) => airlineName(p.iata, p.airline));
  if (!here.length && !away.length && !nothing.length) return null;
  return (
    <div className="mt-4 rounded-2xl border border-[#c7d7f2] bg-gradient-to-br from-[#eef4ff] to-card p-3 sm:p-4 dark:border-white/10 dark:from-white/5" data-testid="travel-benefits">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-2">
        <h2 className="shrink-0 text-[15px] font-semibold" style={HEAD}>Your benefits</h2>
        <p className="text-[13px] text-muted-foreground text-balance">{status === "active" ? "Military" : "Veteran"} travel benefits vary by airline. Some offer discounted fares, others offer vacation-package savings or free baggage. We'll show what's confirmed and how to claim&nbsp;it.</p>
      </div>
      {here.length + away.length > 0 && (
        <BenefitStrip count={here.length + away.length}>
          {[...here.map((p) => ({ p, away: false })), ...away.map((p) => ({ p, away: true }))].map(({ p, away: off }) => {
            const t = perkTags(p, status)!;
            const site = airlineSite(p.iata);
            return (
              <div key={p.iata} className="flex w-[220px] shrink-0 flex-col rounded-xl border border-border bg-card p-3 sm:w-auto sm:min-w-[210px] sm:flex-1 sm:basis-0" data-testid={`benefit-${p.iata}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><p className="text-[15px] font-bold">{airlineName(p.iata, p.airline)}</p>{off && <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Not on this route</span>}</div>
                <p className="mt-1 text-[13px] font-medium text-emerald-700 dark:text-emerald-400 text-balance">{[t.phone ? "Military fare by phone" : t.fare, t.bags].filter(Boolean).join(" · ")}</p>
                {p.claim?.line && <p className="mt-1 text-[12px] text-foreground/80 text-balance"><span className="font-semibold">How to claim:</span> {p.claim.line}{membershipLabel(p.claim.membership) && <span className="ml-1 inline-block rounded-full bg-[#eef4ff] px-1.5 py-px text-[11px] font-semibold text-[#053877] dark:bg-white/10 dark:text-white">{membershipLabel(p.claim.membership)}</span>}</p>}
                {p.bookingUrl && <a href={p.bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-auto pt-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline">Checked {checkedOn(p.lastVerified)} · {site ?? "the airline's page"}</a>}
              </div>
            );
          })}
        </BenefitStrip>
      )}
      {nothing.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">No {status === "veteran" ? "veteran" : "military"} benefit on {list(nothing)}.</p>}
    </div>
  );
}

/** The benefit cards in one row: they share the width when they fit; otherwise the row scrolls sideways, with a fade and an arrow on whichever side has more. */
function BenefitStrip({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [count]);
  const go = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 240, behavior: "smooth" });
  const arrow = "absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-[#053877] shadow-sm hover:bg-muted dark:text-white";
  return (
    <div className="relative -mx-3 mt-3 sm:-mx-4">
      <div ref={ref} className="flex gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4" data-testid="benefit-strip">{children}</div>
      {more.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[#eef4ff] to-transparent dark:from-[#0b1424]" />}
      {more.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card to-transparent" />}
      {more.left && <button type="button" onClick={() => go(-1)} className={`${arrow} left-1`} aria-label="Show earlier benefits"><ChevronLeft className="h-4 w-4" /></button>}
      {more.right && <button type="button" onClick={() => go(1)} className={`${arrow} right-1`} aria-label="Show more benefits" data-testid="benefit-more"><ChevronRight className="h-4 w-4" /></button>}
    </div>
  );
}

function FlightRow({ r, searchedFrom, status, phoneFare, call: c, tp, open, onOpen }: { r: Result; searchedFrom: string; status: TravelerStatus; phoneFare: number | null; call?: CallView; tp: ReturnType<typeof truePrice> | null; open: boolean; onOpen: () => void }) {
  const name = airlineName(r.iata, r.airline);
  const site = airlineSite(r.iata);
  const desk = deskOf(r.iata);
  const t = perkTags(r.perk, status);
  const o = r.outbound;
  const stops = o.stops === 0 ? "Nonstop" : `${o.stops} ${o.stops === 1 ? "stop" : "stops"}${o.layovers?.length ? `, ${o.layovers.map((l) => l.airport).join(", ")}` : ""}`;
  const fromOther = o.departure_airport && o.departure_airport !== searchedFrom ? `From ${o.departure_airport} · ` : "";
  const nextDay = o.arrival_time.slice(0, 10) > o.departure_time.slice(0, 10);
  const fare = phoneFare ?? r.price;
  // The fare tag: what we heard on a call, else the phone-only fare, else a real discount, else none. Never a guessed price.
  const quoted = c?.status === "done" && c.report?.available === "yes" ? c.report.militaryFare : null;
  const fareTag = c?.status === "done"
    ? quoted != null ? <Tag tone={phoneFare != null ? "green" : "grey"}>Military fare {money(quoted)} by phone</Tag>
      : <Tag tone="grey">{c.report?.available === "no" ? "No military fare here" : "Airline couldn't say"}</Tag>
    : c?.status === "failed" ? <Tag tone="grey">We couldn't get an answer</Tag>
    : c ? <Tag tone="amber"><Phone className="h-3 w-3" /> We're asking for the military fare</Tag>
    : t?.phone ? <Tag tone="amber"><Phone className="h-3 w-3" /> Call for military price</Tag>
    : t?.fare ? <Tag tone="green">{t.fare}</Tag>
    : <Tag tone="grey">No fare discount</Tag>;
  const priceLabel = phoneFare != null ? "By phone" : !tp ? "" : tp.total == null ? "Bag fee not listed" : tp.total !== fare ? "With your bags" : tp.lines.some((l) => l.free) && t?.member ? "With paid WeSalute+" : tp.lines.some((l) => l.free) ? "Bags included" : r.inbound ? "Round trip" : "One way";
  return (
    <div className="relative flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-testid={`flight-${r.iata}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Tile code={r.iata} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold">{name}</p>
          <p className="whitespace-nowrap text-[13px] tabular-nums">{clock(o.departure_time)} → {clock(o.arrival_time)}{nextDay ? <sup className="ml-0.5 text-[10px] text-muted-foreground">+1</sup> : null}</p>
          <p className="truncate text-xs text-muted-foreground">{fromOther}{stops}{o.duration_minutes ? ` · ${dur(o.duration_minutes)}` : ""}</p>
        </div>
      </div>
      {/* Two tags, never one mixed line: the fare, then the bags. */}
      <div className="flex flex-wrap gap-1.5 sm:w-[300px] sm:shrink-0">
        {t ? <>{fareTag}<Tag tone={t.bags ? "green" : "grey"}>{t.bags ?? "No free bags"}</Tag></> : <Tag tone="grey">{r.perk && !r.perk.flying ? "Not flying" : `${name}'s military rules aren't in our list yet`}</Tag>}
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <button type="button" onClick={onOpen} disabled={!tp} aria-expanded={open} className="min-w-[84px] text-left leading-tight sm:text-right" data-testid={`price-${r.iata}`}>
          <span className="block whitespace-nowrap text-lg font-bold tabular-nums">{fare == null ? "—" : tp?.total != null ? money(tp.total) : <>{money(fare)}<span className="text-[13px] font-semibold text-muted-foreground"> + bags</span></>}</span>
          {priceLabel && <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-[#053877] underline decoration-dotted underline-offset-2 dark:text-white">{priceLabel} <Info className="h-3 w-3" /></span>}
        </button>
        {phoneFare != null && desk ? (
          <a href={`tel:${desk.tel}`} className="inline-flex w-[204px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700"><Phone className="h-3.5 w-3.5" /> {desk.phone}</a>
        ) : r.perk?.phoneOnly && status !== "active" && desk ? (
          <a href={`tel:${desk.tel}`} className="inline-flex w-[204px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold text-[#053877] hover:bg-muted dark:text-white" data-testid={`book-${r.iata}`}><Phone className="h-3.5 w-3.5" /> Book by phone {desk.phone}</a>
        ) : (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-[204px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold text-[#053877] hover:bg-muted dark:text-white" data-testid={`book-${r.iata}`}>
            Book on {site ?? "the airline's site"} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {open && tp && (
        <div className="z-20 rounded-xl border border-border bg-card p-3 text-[13px] shadow-lg sm:absolute sm:right-[228px] sm:top-[calc(100%-6px)] sm:w-[340px]" role="dialog" aria-label={`${name}: your price`} data-testid={`price-detail-${r.iata}`}>
          <div className="flex items-start justify-between gap-2"><p className="font-semibold">{name}: your price and benefits</p><button type="button" onClick={onOpen} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button></div>
          <dl className="mt-2 space-y-1">
            {tp.lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l.label}{l.label === "Fare" && phoneFare != null ? " (military, by phone)" : ""}</dt><dd className={`font-medium tabular-nums ${l.free ? "text-emerald-700 dark:text-emerald-400" : l.value === "Fee not listed" ? "text-muted-foreground" : ""}`}>{l.value}</dd></div>)}
            <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>Your price</dt><dd className="tabular-nums">{tp.total != null ? money(tp.total) : `${money(fare!)} + bags`}</dd></div>
          </dl>
          {tp.note && <p className="mt-1 text-[11px] text-muted-foreground">{tp.note}</p>}
          {t && (t.fare || t.bags || t.phone) ? (
            <p className="mt-2 flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><span><b>For {status === "veteran" ? "veterans and retirees" : "active duty, Guard and Reserve"}:</b> {[t.phone ? "military fare by phone" : t.fare, t.bags].filter(Boolean).join(" · ")}</span></p>
          ) : t ? <p className="mt-2 text-muted-foreground">No {status === "veteran" ? "veteran" : "military"} benefit on {name}.</p> : null}
          {r.perk?.claim?.line && t && (t.fare || t.bags || t.phone) && <p className="mt-1 pl-5"><b>How to claim:</b> {r.perk.claim.line}{membershipLabel(r.perk.claim.membership) ? ` (${membershipLabel(r.perk.claim.membership)})` : ""}</p>}
          {r.perk?.stacking && !/^Not (stated|applicable)\.?$/i.test(r.perk.stacking.trim()) && (t?.fare || t?.bags) && <p className="mt-1 pl-5 text-muted-foreground"><b className="text-foreground">Combines with:</b> {r.perk.stacking}</p>}
          {r.perk?.bookingUrl && <a href={r.perk.bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block pl-5 text-[11px] text-muted-foreground underline">Checked {checkedOn(r.perk.lastVerified)} · {site ?? "the airline's page"}</a>}
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
