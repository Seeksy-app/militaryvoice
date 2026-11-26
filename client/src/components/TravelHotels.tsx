import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, Clock, ExternalLink, Info, Loader2, MapPin, Phone, PhoneCall, Search, ShieldCheck, Star, Tag as TagIcon, Users } from "lucide-react";
import type { TravelerStatus } from "@shared/militaryFares";
import type { MilitaryHotelPerk, MilitaryLodgingView } from "@shared/militaryHotels";
import { Banner, BrandLogo, DateField, Field, GOLD, HEAD, LABEL, Select, Tag, VALUE, call, hostOf, list, money, phoneText, todayEt } from "@/components/TravelParts";
import { hotelLogo } from "@/lib/brandLogos";
import { PlaceInput, placeText } from "@/components/TravelPlaces";
import { checkedOn } from "@/lib/travelPerks";

// Hotels on the Travel page (Andrew, 26 Nov 2026: "Add hotels. Most hotels have mil discounts but have to call"),
// built from the v2 mockup he OK'd ("Go"). Search, rates and calls are Engineering's (server/creatorHotels.ts); every
// brand's military rate, its wording and the lodging programs come from shared/militaryHotels.ts, never from here.
// "Have us call" saves a request while the server's call gate is off, the same as flights. We never book or pay.

// What the server sends (server/creatorHotels.ts).
type HotelOffer = { seller: string; url: string; pricePerNight: number | null; totalPrice: number | null; freeCancellation: boolean | null };
type HotelResult = {
  i: number; name: string; address: string; hotelClass: number | null; rating: "fair" | "good" | "great" | "excellent" | null;
  pricePerNight: number | null; totalPrice: number | null; freeCancellation: boolean | null; url: string; urlKind: "property_website" | "booking_page";
  offers: HotelOffer[]; image: string | null; brand: string | null; perk: MilitaryHotelPerk | null; canCall: boolean;
};
type HotelQuery = { location: string; checkIn: string; checkOut: string; adults: number; rooms: number; status: TravelerStatus };
type HotelSearch = { searchId: number; cached: boolean; searchesLeft: number | null; query: HotelQuery; nights: number; results: HotelResult[]; callsLive: boolean };
type CallStay = { name: string; address: string; location: string; checkIn: string; checkOut: string; nights: number; adults: number; rooms: number; pricePerNight: number | null; totalPrice: number | null };
type HotelCallView = {
  id: number; brand: string; hotel: string; traveler: TravelerStatus; stay: CallStay; calling: "property" | "brand"; phone: string | null; onlinePerNight: number | null;
  status: "waiting" | "calling" | "done" | "failed";
  report: { available: "yes" | "no" | "unknown"; militaryPerNight: number | null; militaryTotal: number | null; difference: number | null; conditions: string; summary: string } | null;
  error: string; createdAt: string; updatedAt: string;
};
type Lodging = { lodging: MilitaryLodgingView[]; expandedAccess: { title: string; summary?: string; note: string; idNeeded: string }; verified: string };

const SHOWN = 8;
const BRANDS_SHOWN = 6;

/** Each brand's name as a wordmark (text in a colour, never a logo), by the dataset's key. */
const MARKS: Record<string, [string, string]> = {
  marriott: ["Marriott", "#8B1C2C"], hilton: ["Hilton", "#0B3B73"], ihg: ["IHG", "#C25B12"], hyatt: ["Hyatt", "#1A1A1A"], wyndham: ["Wyndham", "#0B5FA5"],
  "la-quinta": ["La Quinta", "#9E1B32"], choice: ["Choice Hotels", "#0B4A8F"], radisson: ["Radisson", "#1F2A44"], "best-western": ["Best Western", "#0A3D7A"],
  omni: ["Omni", "#2B3A55"], "red-roof": ["Red Roof", "#B3122E"], "motel-6": ["Motel 6", "#C8102E"], "studio-6": ["Studio 6", "#5A2D82"], sonesta: ["Sonesta", "#00557F"],
  "extended-stay": ["Extended Stay", "#004B87"], drury: ["Drury", "#7A1F2B"], loews: ["Loews", "#1A1A1A"], mgm: ["MGM Resorts", "#7A5C00"], caesars: ["Caesars", "#5C4A1E"],
  "great-wolf": ["Great Wolf", "#5B3A1E"], disney: ["Disney", "#0B4A8F"],
};
const plainName = (brand: string) => brand.replace(/\s*\(.*$/, "");
const markOf = (p: MilitaryHotelPerk) => MARKS[p.key] ?? [plainName(p.brand), "#053877"];
const OTA = /^(booking|expedia|hotels|agoda|priceline|kayak|trip|orbitz|travelocity)\.com$/;
const RATING: Record<string, string> = { fair: "Fair", good: "Good", great: "Great", excellent: "Excellent" };
const RATING_RANK: Record<string, number> = { excellent: 0, great: 1, good: 2, fair: 3 };
const shortDay = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");
const stayKey = (s: { location: string; checkIn: string; checkOut: string }) => `${s.location.toLowerCase()}|${s.checkIn}|${s.checkOut}`;

/** The rate tag in the row's words, from the brand's perk for this status. */
function rateTag(p: MilitaryHotelPerk | null, status: TravelerStatus): { tone: "amber" | "green" | "grey"; text: string } {
  if (!p) return { tone: "grey", text: "No military rate on file" };
  if (p.tag === "call") return { tone: "amber", text: "Military rate, call to book" };
  if (p.tag === "online") return { tone: "green", text: p.code ? `Military rate online, code ${p.code}${p.codeThirdParty ? " (from third-party sites)" : ""}` : "Military rate online" };
  if (p.tag === "ask") return { tone: "grey", text: "Ask the hotel" };
  // Engineering's noneLine (7a6da096) says what a traveller can still try, e.g. Marriott for veterans; else the plain none.
  return { tone: "grey", text: p.noneLine || (status === "veteran" ? "No military rate for veterans" : "No military rate for active duty") };
}
const ORDER = { call: 0, online: 1, ask: 2, none: 3 } as const;

export function useHotels(status: TravelerStatus, active: boolean) {
  const qc = useQueryClient();
  const [where, setWhere] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [rooms, setRooms] = useState(1);
  const search = useMutation({ mutationFn: (q: HotelQuery) => call<HotelSearch>("POST", "/api/travel/hotels/search", q) });
  const perks = useQuery<{ perks: MilitaryHotelPerk[]; verified: string }>({ queryKey: ["/api/travel/hotels/perks", status], queryFn: () => call("GET", `/api/travel/hotels/perks?status=${status}`), enabled: active, staleTime: 3_600_000 });
  const lodging = useQuery<Lodging>({ queryKey: ["/api/travel/hotels/lodging", status], queryFn: () => call("GET", `/api/travel/hotels/lodging?status=${status}`), enabled: active, staleTime: 3_600_000 });
  const calls = useQuery<{ calls: HotelCallView[]; callsLive: boolean }>({
    queryKey: ["/api/travel/hotels/calls"],
    queryFn: () => call("GET", "/api/travel/hotels/calls"),
    enabled: active,
    refetchInterval: (q) => {
      const cs = q.state.data?.calls ?? [];
      return cs.some((c) => c.status === "calling") ? 15_000 : cs.some((c) => c.status === "waiting") && q.state.data?.callsLive ? 60_000 : false;
    },
  });
  const ask = useMutation({
    mutationFn: (p: { searchId: number; i: number }) => call<HotelCallView>("POST", "/api/travel/hotels/calls", p),
    onSettled: () => qc.invalidateQueries({ queryKey: ["/api/travel/hotels/calls"] }),
  });
  const formError = checkIn && checkOut && checkOut <= checkIn ? "Check-out has to be after check-in." : "";
  const ready = where.trim().length >= 2 && !!checkIn && !!checkOut && checkOut > checkIn;
  const go = () => { if (ready) search.mutate({ location: where.trim(), checkIn, checkOut, adults, rooms: Math.min(rooms, adults), status }); };
  // Rates and calls follow the status searched, so a switch searches again (the server keeps the stay for 30 minutes).
  const q = search.data?.query;
  useEffect(() => {
    if (q && q.status !== status && !search.isPending) search.mutate({ ...q, status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return { where, setWhere, checkIn, setCheckIn, checkOut, setCheckOut, adults, setAdults, rooms, setRooms, search, perks, lodging, calls, ask, ready, go, formError };
}
type Hotels = ReturnType<typeof useHotels>;

/** Where, Check in, Check out, Guests · Rooms and the gold Find Hotels, in the shared search card. */
export function HotelFields({ h }: { h: Hotels; status: TravelerStatus }) {
  const next = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); h.go(); }} data-testid="hotels-trip">
      <div className="mt-3.5 flex flex-col gap-2.5 group-data-[wide=true]/travel:flex-row group-data-[wide=true]/travel:items-stretch">
        <Field label="Where" icon={MapPin} className="group-data-[wide=true]/travel:min-w-0 group-data-[wide=true]/travel:flex-1">
          <PlaceInput mode="hotel" aria="Where" value={h.where} onText={h.setWhere} onPick={(p) => h.setWhere(placeText(p))} placeholder="City, neighborhood or landmark" className="w-full min-w-0 bg-transparent text-[17px] font-bold outline-none placeholder:font-normal placeholder:text-muted-foreground sm:text-[18px]" testid="hotels-where" />
        </Field>
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-stretch">
          <DateField label="Check in" aria="Check in" value={h.checkIn} min={todayEt()} onChange={(v) => { h.setCheckIn(v); if (!h.checkOut || h.checkOut <= v) h.setCheckOut(next(v)); }} testid="hotels-in" />
          <DateField label="Check out" aria="Check out" value={h.checkOut} min={h.checkIn ? next(h.checkIn) : todayEt()} onChange={h.setCheckOut} testid="hotels-out" />
          <div className="col-span-2 flex min-w-0 flex-col justify-center rounded-xl border border-[#d5dce8] bg-white px-3.5 py-1.5 sm:min-h-[56px] sm:w-[222px] sm:shrink-0 dark:border-white/15 dark:bg-background">
            <span className={LABEL}>Guests · Rooms</span>
            <span className={`mt-0.5 flex items-center gap-2 ${VALUE}`}>
              <Users className="h-[18px] w-[18px] shrink-0 text-[#0b1b33] dark:text-white" />
              <select aria-label="Guests" value={h.adults} onChange={(e) => { const n = Number(e.target.value); h.setAdults(n); if (h.rooms > n) h.setRooms(n); }} className="shrink-0 appearance-none bg-transparent outline-none" data-testid="hotels-guests">
                {Array.from({ length: 8 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>)}
              </select>
              <span className="text-muted-foreground">·</span>
              <select aria-label="Rooms" value={h.rooms} onChange={(e) => h.setRooms(Number(e.target.value))} className="shrink-0 appearance-none bg-transparent outline-none" data-testid="hotels-rooms">
                {Array.from({ length: Math.min(4, h.adults) }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "room" : "rooms"}</option>)}
              </select>
              <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
            </span>
          </div>
          <button type="submit" disabled={!h.ready || h.search.isPending} className="col-span-2 flex items-center justify-center gap-2.5 whitespace-nowrap rounded-xl px-6 py-3.5 text-[18px] font-bold text-[#0b1b33] shadow-[0_8px_18px_-8px_rgba(240,167,31,0.95)] transition-colors hover:brightness-95 disabled:opacity-60 sm:flex-1 sm:py-0 sm:text-[19px] group-data-[wide=true]/travel:w-[178px] group-data-[wide=true]/travel:flex-none" style={{ background: GOLD }} data-testid="hotels-find">
            {h.search.isPending ? <><Loader2 className="h-5 w-5 animate-spin" /> Finding hotels</> : <><Search className="h-[22px] w-[22px]" strokeWidth={2.6} /> Find Hotels</>}
          </button>
        </div>
      </div>
      {(h.formError || h.search.error) && <p className="px-1 pt-2 text-[13px] font-medium text-[#b42318]">{h.formError || (h.search.error as Error).message}</p>}
    </form>
  );
}

export function HotelsBody({ h, status }: { h: Hotels; status: TravelerStatus }) {
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<"deal" | "price" | "rating">("deal");
  const [open, setOpen] = useState<number | null>(null);
  const [noPhone, setNoPhone] = useState<Set<number>>(new Set());
  const data = h.search.data;
  const q = data?.query;
  const searched = !!q && !h.search.isPending;
  const results = data?.results ?? [];
  const live = data?.callsLive ?? h.calls.data?.callsLive ?? false;
  useEffect(() => { setAll(false); setOpen(null); setNoPhone(new Set()); }, [data?.searchId]);

  // This stay's calls: the newest per hotel (the server lists newest first).
  const stayCalls = useMemo(() => {
    if (!q) return [] as HotelCallView[];
    const by = new Map<string, HotelCallView>();
    for (const c of h.calls.data?.calls ?? []) if (stayKey(c.stay) === stayKey(q) && c.traveler === q.status && !by.has(c.stay.name)) by.set(c.stay.name, c);
    return Array.from(by.values());
  }, [h.calls.data, q]);
  const callFor = (r: HotelResult) => stayCalls.find((c) => c.stay.name === r.name);
  /** A quoted military rate that beats the online price, else null. */
  const phoneWin = (c?: HotelCallView) => (c?.status === "done" && c.report?.available === "yes" && c.report.militaryPerNight != null && c.onlinePerNight != null && c.report.militaryPerNight < c.onlinePerNight ? c.report.militaryPerNight : null);

  const rows = useMemo(() => {
    const xs = results.map((r) => ({ r, call: callFor(r), nightly: phoneWin(callFor(r)) ?? r.pricePerNight }));
    const byPrice = (a: (typeof xs)[number], b: (typeof xs)[number]) => (a.nightly ?? 1e9) - (b.nightly ?? 1e9);
    if (sort === "rating") return [...xs].sort((a, b) => (RATING_RANK[a.r.rating ?? ""] ?? 9) - (RATING_RANK[b.r.rating ?? ""] ?? 9) || byPrice(a, b));
    return [...xs].sort(byPrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, stayCalls, sort]);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const pending = stayCalls.filter((c) => c.status === "waiting" || c.status === "calling");
  const finished = stayCalls.filter((c) => c.status === "done" || c.status === "failed");
  // The hotel to offer a call for: the best-priced one whose rate is phone-only, else any the traveler can ask about.
  const offer = rows.find((x) => x.r.canCall && x.r.perk?.tag === "call" && !x.call && !noPhone.has(x.r.i)) ?? rows.find((x) => x.r.canCall && !x.call && !noPhone.has(x.r.i));
  const askFor = (r: HotelResult) => data && h.ask.mutate({ searchId: data.searchId, i: r.i });
  const nights = data?.nights ?? 0;

  return (
    <>
      <Banner testid="hotels-banner">Most hotels have a military rate, but many only give it by phone. We can call for&nbsp;you.</Banner>

      {h.search.isPending && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-10 text-center text-[14px] text-muted-foreground text-balance" data-testid="hotels-loading">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Finding hotels and each brand's military rate for you. This can take a few&nbsp;seconds.
        </div>
      )}

      <BrandBenefits perks={h.perks.data?.perks ?? []} verified={h.perks.data?.verified ?? ""} status={status} />
      {h.lodging.data && <LodgingCard data={h.lodging.data} status={status} />}

      {searched && results.length > 0 && (pending.length > 0 || finished.length > 0 || offer) && (
        <div className="mt-4">
          {pending.length > 0 ? <Waiting calls={pending} live={live} />
            : finished.length > 0 ? <HotelReport calls={finished} results={results} q={q} />
            : offer ? <CallOffer hotel={offer.r.name} q={q} live={live} pending={h.ask.isPending} error={h.ask.error ? (h.ask.error as Error).message : ""} onCall={() => askFor(offer.r)} /> : null}
        </div>
      )}

      {searched && (
        <div className="mt-5 rounded-[20px] border border-[#dfe4ec] bg-card shadow-[0_1px_3px_rgba(16,24,40,0.05)] dark:border-white/10" data-testid="hotels-results">
          <div className="flex flex-col gap-2 px-4 pb-3.5 pt-4 sm:px-6 sm:pt-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-0.5">
              <h2 className="text-[20px] font-bold text-[#0b1b33] sm:text-[21px] dark:text-white" style={HEAD}>Hotel Results</h2>
              <p className="text-[13.5px] text-[#4a5568] text-balance dark:text-white/60">{results.length ? <>{results.length} {results.length === 1 ? "hotel" : "hotels"} found · {nights} {nights === 1 ? "night" : "nights"} · nightly price before taxes, stay total as each site lists&nbsp;it</> : "No hotels found."}</p>
            </div>
            {results.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="text-[14px] text-[#4a5568] dark:text-white/60">Sort by:</span>
                <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)} testid="hotels-sort" options={[["deal", "Best deal for you"], ["price", "Lowest price"], ["rating", "Top rated"]]} />
              </div>
            )}
          </div>
          {results.length === 0 ? (
            <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground text-balance">No hotels came back for that place and those dates. Try a nearby city or other&nbsp;dates.</p>
          ) : (
            <div className="pb-2">
              {sort === "deal" && shown[0]?.nightly != null && <div className="px-2 pb-2 sm:px-3"><HotelRow x={shown[0]} best nights={nights} status={status} searchId={data!.searchId} open={open === shown[0].r.i} onMore={() => setOpen(open === shown[0].r.i ? null : shown[0].r.i)} onAsk={askFor} asking={h.ask.isPending} noPhone={noPhone.has(shown[0].r.i)} onNoPhone={(i) => setNoPhone(new Set(noPhone).add(i))} /></div>}
              <div className="divide-y divide-border border-t border-border">
                {(sort === "deal" && shown[0]?.nightly != null ? shown.slice(1) : shown).map((x) => (
                  <HotelRow key={x.r.i} x={x} nights={nights} status={status} searchId={data!.searchId} open={open === x.r.i} onMore={() => setOpen(open === x.r.i ? null : x.r.i)} onAsk={askFor} asking={h.ask.isPending} noPhone={noPhone.has(x.r.i)} onNoPhone={(i) => setNoPhone(new Set(noPhone).add(i))} />
                ))}
              </div>
            </div>
          )}
          {!all && results.length > SHOWN && <button type="button" onClick={() => setAll(true)} className="w-full rounded-b-2xl border-t border-border py-2.5 text-[13px] font-semibold text-[#053877] hover:bg-muted dark:text-white">Show all {results.length} hotels</button>}
        </div>
      )}

      {!q && !h.search.isPending && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="hotels-how">
          {[
            { t: "Your military rate at every hotel", d: "Which brands have one for your status, the code or menu to pick, and any stay perk." },
            { t: "We call when it's by phone", d: "Many hotels only quote the military rate on the phone. We ask for your dates and report back." },
            { t: "You book with the hotel", d: "Every hotel links to its own site or the booking site. We never book or pay for you." },
          ].map((x) => (
            <div key={x.t} className="rounded-2xl border border-border bg-card px-4 py-3 sm:py-4">
              <p className="text-[15px] font-semibold text-balance">{x.t}</p>
              <p className="mt-1 text-[13px] text-muted-foreground text-balance">{x.d}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-[12px] text-muted-foreground text-balance">You book with the hotel or the site. We never book or pay for you, and rates can change until you&nbsp;do.</p>
    </>
  );
}

/** Verified Military Benefits by Hotel Brand: every brand for this status, confirmed ones first, six then "Show all". */
function BrandBenefits({ perks, verified, status }: { perks: MilitaryHotelPerk[]; verified: string; status: TravelerStatus }) {
  const [all, setAll] = useState(false);
  if (!perks.length) return null;
  const sorted = [...perks].sort((a, b) => Number(a.quiet) - Number(b.quiet) || ORDER[a.tag] - ORDER[b.tag]);
  return (
    <div className="mt-6" data-testid="hotels-benefits">
      <div className="flex flex-col gap-1 group-data-[wide=true]/travel:flex-row group-data-[wide=true]/travel:items-center group-data-[wide=true]/travel:justify-between group-data-[wide=true]/travel:gap-4">
        <h2 className="flex items-center gap-2.5 text-[19px] font-bold text-[#0b1b33] sm:text-[21px] dark:text-white" style={HEAD}><TagIcon className="h-6 w-6 shrink-0 -scale-x-100" style={{ color: GOLD }} strokeWidth={2.2} /> Verified Military Benefits by Hotel&nbsp;Brand</h2>
        {verified && <p className="flex items-start gap-2 text-[12.5px] text-[#33425a] dark:text-white/60"><ShieldCheck className="h-[18px] w-[18px] shrink-0" style={{ color: GOLD }} /><span>Benefits are based on each brand's published program <span className="whitespace-nowrap">(checked {checkedOn(verified)}).</span></span></p>}
      </div>
      <div className="mt-3.5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((p, k) => {
          const [mark, color] = markOf(p);
          const t = rateTag(p, status);
          const hide = !all && k >= BRANDS_SHOWN ? "hidden" : !all && k >= 3 ? "hidden md:flex" : "flex";
          return (
            <div key={p.key} className={`${hide} min-h-[76px] items-center gap-4 rounded-2xl border border-[#dfe4ec] bg-card px-4 py-3 shadow-[0_1px_3px_rgba(16,24,40,0.05)] dark:border-white/10 ${p.tag === "none" ? "opacity-75" : ""}`} data-testid={`hotel-benefit-${p.key}`}>
              <span className="flex w-[118px] shrink-0 items-center justify-center"><BrandLogo src={hotelLogo(p.key)} name={mark} color={color} className="h-[34px] max-w-[118px]" textClass="text-center text-[18px] font-extrabold leading-[1.05] tracking-tight text-balance" /></span>
              <span className="h-12 w-[2px] shrink-0 self-center rounded-full" style={{ background: GOLD }} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-tight text-[#0b1b33] dark:text-white">{plainName(p.brand)}</p>
                <p className="mt-0.5 text-[14px] leading-snug text-[#33425a] dark:text-white/75">{t.text}{p.rate && !/^(varies|couldn't)/i.test(p.rate) ? ` · ${p.rate}` : ""}</p>
                {p.stayPerk && <p className="mt-0.5 text-[12px] leading-snug text-emerald-800 dark:text-emerald-300">Perk: {p.stayPerk}</p>}
                {p.claim?.line && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground"><span className="font-semibold text-foreground/80">How to claim:</span> {p.claim.line}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {p.quiet && <span className="block italic">{p.confidenceNote}.</span>}
                  {p.source && <a href={p.source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Source: {hostOf(p.source)}</a>}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {sorted.length > 3 && <button type="button" onClick={() => setAll(!all)} className={`mt-2 w-full rounded-xl border border-border bg-card py-2 text-[13px] font-semibold text-[#053877] dark:text-white ${sorted.length <= BRANDS_SHOWN ? "md:hidden" : ""}`}>{all ? "Show fewer" : `Show all ${sorted.length} brands`}</button>}
    </div>
  );
}

const KIND: Record<string, string> = { military_lodging: "On-base lodging", afrc: "Armed Forces resort", vacation_club: "Vacation club" };
/** The first sentence, without its asides in brackets (the dataset's research detail stays on the source page). */
const firstSentence = (s: string) => (/^(.+?[.!?])(\s|$)/.exec(s.replace(/\s*\([^)]*\)/g, "").trim())?.[1] ?? s).trim();

/**
 * Military lodging (on base): one closed row under the brands, so the search and results stay up top. Active duty
 * sees the programs open to them; a veteran sees which take all veterans, retirees, or only the 2020 expanded-access
 * group, with a short "Who qualifies" box for that group.
 */
function LodgingCard({ data, status }: { data: Lodging; status: TravelerStatus }) {
  const [open, setOpen] = useState(false);
  const rank = (v: string) => (v === "all" ? 0 : v === "some" ? 1 : 2);
  const items = data.lodging.filter((v) => v.forYou !== "no").sort((a, b) => (status === "veteran" ? rank(a.veterans) - rank(b.veterans) : 0));
  if (!items.length) return null;
  const chip = (v: MilitaryLodgingView) =>
    status === "active" ? { t: "Open to you", c: "bg-[#ecf7f0] text-[#14532d] dark:bg-emerald-500/10 dark:text-emerald-300" }
      : v.veterans === "all" ? { t: "All veterans", c: "bg-[#ecf7f0] text-[#14532d] dark:bg-emerald-500/10 dark:text-emerald-300" }
      : v.veterans === "retirees" ? { t: "Retirees", c: "bg-[#f1f4f9] text-foreground/75 dark:bg-white/5" }
      : { t: "Some veterans", c: "bg-[#FFF3D6] text-[#7a4f00] dark:bg-[#F0A71F]/10 dark:text-[#F0A71F]" };
  const names = items.slice(0, 3).map((v) => plainName(v.name)).join(", ");
  const some = status === "veteran" && items.some((v) => v.expandedAccess);
  const ea = data.expandedAccess;
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card" data-testid="hotels-lodging">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-white"><Building2 className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold sm:text-[17px]" style={HEAD}>Military lodging (on&nbsp;base)</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">{status === "active" ? `${items.length} programs open to you` : `${items.length} programs, check who qualifies`}<span className="hidden sm:inline"> · {names}…</span></span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#053877] dark:text-white">{open ? "Hide" : "Show"} <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></span>
      </button>
      {open && (
        <div className="border-t border-border">
          {some && (
            <div className="mx-4 mt-3 rounded-xl border border-[#F0A71F]/60 bg-[#FFF8E8] px-3 py-2.5 sm:mx-5 dark:bg-[#F0A71F]/10">
              <p className="text-[13px] font-bold">Who counts as "some veterans"</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-foreground/85">{ea.summary || <>{firstSentence(ea.note)} ID to bring: {firstSentence(ea.idNeeded)}</>} Not every program takes this group, so check each&nbsp;one.</p>
            </div>
          )}
          <div className="divide-y divide-border">
            {items.map((v) => {
              const c = chip(v);
              const ph = phoneText(v.reservationsPhone);
              return (
                <div key={v.key} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5" data-testid={`lodging-${v.key}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-[14.5px] font-bold leading-tight">{v.name}</p>
                      <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${c.c}`}>{c.t}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">{KIND[v.kind] ?? "Lodging"} · {v.rate.charAt(0).toUpperCase() + v.rate.slice(1)}</p>
                    {status === "veteran" && v.veterans !== "all" && <p className="mt-0.5 text-[12px] leading-snug text-foreground/75">{v.veterans === "retirees" ? "Retirees can stay. Other veterans aren't listed, so ask before you book." : v.veteransNote}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground/80">How to book:</span> {v.howToBook} {v.source && <a href={v.source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Source: {hostOf(v.source)}</a>}</p>
                  </div>
                  {ph && v.reservationsPhone ? (
                    <a href={`tel:${v.reservationsPhone}`} className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start whitespace-nowrap rounded-full border-2 border-[#c7d7f2] px-3 py-1.5 text-[13px] font-semibold text-[#053877] hover:bg-[#eef4ff] sm:self-center dark:text-white"><Phone className="h-3.5 w-3.5" /> {ph}</a>
                  ) : v.source ? (
                    <a href={v.source} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start whitespace-nowrap rounded-full border-2 border-[#c7d7f2] px-3 py-1.5 text-[13px] font-semibold text-[#053877] hover:bg-[#eef4ff] sm:self-center dark:text-white">Book online <ExternalLink className="h-3.5 w-3.5" /></a>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground sm:px-5">On-base stays need installation access. Checked {checkedOn(data.verified)}.</p>
        </div>
      )}
    </div>
  );
}

/** A listing photo when the search has one; a drawn building in the row's colour when it doesn't (a cached search). */
function Photo({ src, seed }: { src: string | null; seed: string }) {
  const [bad, setBad] = useState(false);
  const hue = Array.from(seed).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7);
  if (src && !bad) return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-full w-full object-cover" />;
  return (
    <svg viewBox="0 0 160 120" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs><linearGradient id={`hg${hue}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={`hsl(${hue} 70% 84%)`} /><stop offset="1" stopColor={`hsl(${hue} 45% 64%)`} /></linearGradient></defs>
      <rect width="160" height="120" fill={`url(#hg${hue})`} />
      <rect x="38" y="22" width="56" height="98" rx="3" fill={`hsl(${hue} 30% 96%)`} />
      <rect x="94" y="48" width="36" height="72" rx="3" fill={`hsl(${hue} 25% 88%)`} />
      {Array.from({ length: 8 }, (_, i) => Array.from({ length: 4 }, (_, j) => <rect key={`${i}${j}`} x={44 + j * 12} y={30 + i * 11} width="7" height="6" rx="1" fill={`hsl(${hue} 40% 55%)`} opacity="0.7" />))}
    </svg>
  );
}

/** "Book by phone": the hotel's own line (or its brand's), looked up only when tapped. */
function BookByPhone({ searchId, i, onNone }: { searchId: number; i: number; onNone: (i: number) => void }) {
  const look = useMutation({ mutationFn: () => call<{ phone: string | null; who: "property" | "brand" | null; name: string }>("GET", `/api/travel/hotels/phone?searchId=${searchId}&i=${i}`), onSuccess: (r) => { if (!r.phone) onNone(i); } });
  if (look.data?.phone) return <a href={`tel:${look.data.phone}`} className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400" data-testid={`hotel-phone-${i}`}><Phone className="h-3.5 w-3.5" /> {phoneText(look.data.phone)}{look.data.who === "brand" ? " (reservations)" : ""}</a>;
  if (look.data && !look.data.phone) return <span className="text-[12px] text-muted-foreground">No number found</span>;
  return (
    <button type="button" onClick={() => look.mutate()} disabled={look.isPending} className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-[#053877] disabled:opacity-60 dark:text-white" data-testid={`hotel-book-phone-${i}`}>
      {look.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding the number…</> : <><Phone className="h-3.5 w-3.5" /> Book by phone</>}
    </button>
  );
}

type RowX = { r: HotelResult; call?: HotelCallView; nightly: number | null };
function HotelRow({ x, best, nights, status, searchId, open, onMore, onAsk, asking, noPhone, onNoPhone }: { x: RowX; best?: boolean; nights: number; status: TravelerStatus; searchId: number; open: boolean; onMore: () => void; onAsk: (r: HotelResult) => void; asking: boolean; noPhone: boolean; onNoPhone: (i: number) => void }) {
  const { r, call: c } = x;
  const p = r.perk;
  const [mark, color] = p ? markOf(p) : ["", ""];
  const t = rateTag(p, status);
  const quoted = c?.status === "done" && c.report?.available === "yes" ? c.report.militaryPerNight : null;
  const won = quoted != null && r.pricePerNight != null && quoted < r.pricePerNight;
  // What we heard on a call comes first; else the brand's rate for this status. Never a guessed price.
  const tag = c?.status === "done"
    ? quoted != null ? <Tag tone={won ? "green" : "grey"}>Military rate {money(quoted)}/night by phone</Tag> : <Tag tone="grey">{c.report?.available === "no" ? "No military rate for these dates" : "The hotel couldn't say"}</Tag>
    : c?.status === "failed" ? <Tag tone="grey">We couldn't get an answer</Tag>
    : c ? <Tag tone="amber">We're asking for the military rate</Tag>
    : <Tag tone={t.tone}>{t.text}</Tag>;
  const site = hostOf(r.url);
  const bookLabel = mark && r.urlKind === "property_website" && !OTA.test(site) ? mark : site || "the hotel's site";
  const others = r.offers.length > 1 ? r.offers.length - 1 : 0;
  return (
    <div className={`relative px-3 py-3.5 sm:px-4 ${best ? "rounded-2xl border-2 bg-[#fffdf7] dark:bg-[#F0A71F]/5" : ""}`} style={best ? { borderColor: GOLD } : undefined} data-testid={`hotel-${r.i}`}>
      {best && <span className="absolute -top-2.5 left-4 z-10 rounded-full px-2 py-px text-[11px] font-bold text-[#1a1200]" style={{ background: GOLD }}>Best deal for you</span>}
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <div className="relative h-[150px] w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:h-[118px] sm:w-[150px]"><Photo src={r.image} seed={r.name} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {mark && p && <BrandLogo src={hotelLogo(p.key)} name={mark} color={color} className="h-[18px] max-w-[90px]" textClass="text-[12px] font-extrabold" />}
              {r.hotelClass ? <span className="flex items-center gap-px" aria-label={`${r.hotelClass}-star hotel`}>{Array.from({ length: Math.round(r.hotelClass) }, (_, k) => <Star key={k} className="h-3.5 w-3.5 fill-[#F0A71F] text-[#F0A71F]" />)}</span> : null}
            </div>
            <p className="text-[17px] font-bold leading-tight">{r.name}</p>
            <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
              {r.rating && <span className="font-semibold text-foreground">{RATING[r.rating]}</span>}
              {r.address && <span className="min-w-0 truncate"><MapPin className="mr-0.5 inline h-3.5 w-3.5 -translate-y-px" />{r.address}</span>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {tag}
              {p?.stayPerk ? <Tag tone="green">{p.stayPerk}</Tag> : null}
              {r.freeCancellation && <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Free cancellation</span>}
            </div>
            {p?.quiet && <p className="mt-1 text-[11.5px] italic text-muted-foreground">{p.confidenceNote}.</p>}
          </div>
          <div className="flex items-center justify-between gap-3 sm:gap-4 lg:justify-end">
            <div className="shrink-0 leading-tight lg:w-[150px] lg:border-l lg:border-border lg:pl-5">
              <span className="block whitespace-nowrap text-[26px] font-bold tabular-nums" style={HEAD}>{won ? money(quoted!) : r.pricePerNight != null ? money(r.pricePerNight) : "—"}</span>
              <span className="block whitespace-nowrap text-[13px] text-muted-foreground">{won ? "military rate, by phone" : r.pricePerNight != null ? "a night, before taxes" : "price on the site"}</span>
              {!won && r.totalPrice != null && <span className="block whitespace-nowrap text-[11.5px] font-medium text-[#053877] dark:text-white/80">{money(r.totalPrice)} for {nights} {nights === 1 ? "night" : "nights"}</span>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1 sm:w-[214px] sm:flex-none">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] border-[#b9cbe8] bg-white px-4 py-2.5 text-[13.5px] font-bold text-[#0b3a78] shadow-[0_1px_2px_rgba(11,27,51,0.06)] hover:bg-[#eef4ff] dark:bg-transparent dark:text-white" data-testid={`hotel-book-${r.i}`}>
                <span className="truncate">Book on {bookLabel}</span> <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
                {(p?.tag === "call" || p?.phoneOnly || won) && <BookByPhone searchId={searchId} i={r.i} onNone={onNoPhone} />}
                {r.canCall && !c && !noPhone && <button type="button" onClick={() => onAsk(r)} disabled={asking} className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-[#053877] disabled:opacity-60 dark:text-white" data-testid={`hotel-call-${r.i}`}><PhoneCall className="h-3.5 w-3.5" /> Have us call</button>}
                {others > 0 && <button type="button" onClick={onMore} aria-expanded={open} className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-[#053877] dark:text-white" data-testid={`hotel-offers-${r.i}`}>{others} more {others === 1 ? "offer" : "offers"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} /></button>}
              </div>
            </div>
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border sm:ml-[166px]">
          {r.offers.map((o, k) => (
            <a key={`${o.seller}${k}`} href={o.url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-muted ${k ? "border-t border-border" : "bg-[#f6f9ff] dark:bg-white/5"}`}>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-semibold">{o.seller}{k === 0 && <span className="rounded-full bg-[#ecf7f0] px-1.5 py-px text-[11px] font-semibold text-[#14532d] dark:bg-emerald-500/10 dark:text-emerald-300">Cheapest</span>}</span>
              {o.freeCancellation != null && <span className={`hidden text-[12px] sm:inline ${o.freeCancellation ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{o.freeCancellation ? "Free cancellation" : "Non-refundable"}</span>}
              <span className="w-[70px] text-right font-semibold tabular-nums">{o.pricePerNight != null ? <>{money(o.pricePerNight)}<span className="text-[11px] font-normal text-muted-foreground">/nt</span></> : "—"}</span>
              <span className="hidden w-[64px] text-right tabular-nums text-muted-foreground sm:inline">{o.totalPrice != null ? money(o.totalPrice) : ""}</span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#053877] dark:text-white">Book <ExternalLink className="h-3 w-3" /></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function CallOffer({ hotel, q, live, onCall, pending, error }: { hotel: string; q: HotelQuery; live: boolean; onCall: () => void; pending: boolean; error: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 p-4 sm:flex-row sm:items-center sm:p-5 dark:bg-[#F0A71F]/10" style={{ borderColor: GOLD, background: "#FFF8E8" }} data-testid="hotels-call-offer">
      <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full sm:flex" style={{ background: GOLD }}><PhoneCall className="h-6 w-6 text-[#1a1200]" /></span>
      <div className="min-w-0 flex-1 text-[#0b1b33]">
        <p className="text-[17px] font-bold text-balance" style={HEAD}>We'll call the hotel and ask for the military rate for your&nbsp;dates.</p>
        <p className="mt-0.5 text-[13px] text-[#24324a] text-balance">We'll ask {hotel} for <span className="whitespace-nowrap">{shortDay(q.checkIn)} to {shortDay(q.checkOut)}</span>, {q.adults} {q.adults === 1 ? "guest" : "guests"}, {q.rooms} {q.rooms === 1 ? "room" : "rooms"}, and report back here with the rate next to the online price. Our automated caller never books, pays or gives your&nbsp;details.{live ? "" : " We'll save your request and call once calling is switched on."}</p>
        {error && <p className="mt-1 text-[13px] font-medium text-[#b42318]">{error}</p>}
      </div>
      <button type="button" onClick={onCall} disabled={pending} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#053877] px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-60" data-testid="hotels-call">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />} Have us call
      </button>
    </div>
  );
}

function Waiting({ calls, live }: { calls: HotelCallView[]; live: boolean }) {
  const names = list(calls.map((c) => c.hotel));
  const calling = calls.some((c) => c.status === "calling");
  const on = calling || live;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4" data-testid="hotels-waiting">
      {calling ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#053877] dark:text-white" /> : <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#053877] dark:text-white" />}
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-balance">{on ? `We're calling ${names}` : `Saved: we'll call ${names}`}</p>
        <p className="text-[13px] text-muted-foreground text-balance">{on ? "What they quote shows up here, usually within a few minutes." : "Our automated caller isn't switched on yet. Your request is saved, and what the hotel quotes shows up here once it's on."}</p>
      </div>
    </div>
  );
}

/** What the calls came back with: the online price beside the military rate, and an honest verdict either way. */
function HotelReport({ calls, results, q }: { calls: HotelCallView[]; results: HotelResult[]; q: HotelQuery }) {
  const quoted = calls.filter((c) => c.status === "done" && c.report?.available === "yes" && c.report.militaryPerNight != null && c.onlinePerNight != null);
  const shown = [...quoted].sort((a, b) => (a.report!.militaryPerNight! - a.onlinePerNight!) - (b.report!.militaryPerNight! - b.onlinePerNight!))[0];
  const cheaper = !!shown && shown.report!.militaryPerNight! < shown.onlinePerNight!;
  const others = calls.filter((c) => c.id !== shown?.id);
  const last = calls.map((c) => c.updatedAt || c.createdAt).sort().pop() ?? "";
  const when = last ? new Date(last).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  const n = calls.length;
  const res = shown ? results.find((r) => r.name === shown.hotel) : undefined;
  const nights = shown?.stay.nights ?? 0;
  const online = shown ? { nt: shown.onlinePerNight!, total: shown.stay.totalPrice } : null;
  const mil = shown ? { nt: shown.report!.militaryPerNight!, total: shown.report!.militaryTotal } : null;
  const save = online && mil ? (online.total != null && mil.total != null ? online.total - mil.total : (online.nt - mil.nt) * nights) : 0;
  const short = shown ? shown.hotel.split(/\s+/)[0] : "";
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="hotels-report">
      <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">We called {n} {n === 1 ? "hotel" : "hotels"}{when ? ` · ${when}` : ""}</p>
      {shown && online && mil ? (
        <div className="flex flex-col gap-3 p-4 pt-2 sm:flex-row sm:items-center">
          <div className="grid flex-1 grid-cols-2 gap-2">
            <div className={`rounded-xl px-3 py-2 ${!cheaper ? "border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border border-border bg-muted/40"}`}>
              <p className={`text-[12px] font-semibold ${!cheaper ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>{short} online</p>
              <p className={`text-[26px] font-bold leading-tight tabular-nums ${!cheaper ? "" : "text-foreground/70"}`}>{money(online.nt)}<span className="text-[13px] font-semibold">/nt</span></p>
              <p className={`text-[12px] ${!cheaper ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>{online.total != null ? `${money(online.total)} for ${nights} ${nights === 1 ? "night" : "nights"}` : "before taxes"}{!cheaper ? " · cheaper" : ""}</p>
            </div>
            <div className={`rounded-xl px-3 py-2 ${cheaper ? "border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border border-border bg-muted/40"}`}>
              <p className={`text-[12px] font-semibold ${cheaper ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>{short} military rate, by phone</p>
              <p className={`text-[26px] font-bold leading-tight tabular-nums ${cheaper ? "" : "text-foreground/70"}`}>{money(mil.nt)}<span className="text-[13px] font-semibold">/nt</span></p>
              <p className={`text-[12px] ${cheaper ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}>{mil.total != null ? `${money(mil.total)} for ${nights} ${nights === 1 ? "night" : "nights"}` : "before taxes"}{cheaper && save > 0 ? ` · you save ${money(save)}` : ""}</p>
            </div>
          </div>
          <div className="sm:w-[270px]">
            {cheaper ? (
              <>
                <p className="text-[17px] font-semibold text-balance" style={HEAD}>The military rate is cheaper. Call the hotel to book&nbsp;it.</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground text-balance">Ask for "the military rate" for <span className="whitespace-nowrap">{shortDay(q.checkIn)} to {shortDay(q.checkOut)}</span>, {q.rooms} {q.rooms === 1 ? "room" : "rooms"}.{shown.report!.conditions ? ` ${shown.report!.conditions}` : " Bring your military ID to check-in."}</p>
                {shown.phone && <a href={`tel:${shown.phone}`} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white"><PhoneCall className="h-4 w-4" /> Call {short}: {phoneText(shown.phone)}</a>}
              </>
            ) : (
              <>
                <p className="text-[17px] font-semibold text-balance" style={HEAD}>The online price is cheaper. Book&nbsp;online.</p>
                {res?.url && <a href={res.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white">Book on {hostOf(res.url) || "the hotel's site"} <ExternalLink className="h-3.5 w-3.5" /></a>}
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="px-4 pb-3 pt-1 text-[17px] font-semibold text-balance" style={HEAD}>No hotel quoted a military rate for these dates. Book the online&nbsp;price.</p>
      )}
      {others.length > 0 && (
        <div className={`grid divide-y divide-border border-t border-border text-[13px] ${others.length > 1 ? "sm:grid-cols-2 sm:divide-y-0 [&>*:nth-child(odd)]:sm:border-r [&>*]:border-border" : ""}`}>
          {others.map((c) => <p key={c.id} className="px-4 py-2.5">{hotelLine(c)}</p>)}
        </div>
      )}
    </div>
  );
}

/** One hotel's answer in plain words: "The Riverwalk Hotel: military rate $179/nt vs $172 online. The online price is better." */
function hotelLine(c: HotelCallView): React.ReactNode {
  const mil = c.report?.militaryPerNight ?? null;
  const web = c.onlinePerNight;
  return (
    <>
      <b>{c.hotel}:</b>{" "}
      {c.status === "failed" ? <>we couldn't get an answer.</>
        : c.report?.available === "no" ? <>no military rate for these dates.</>
        : mil != null && web != null ? (mil < web ? <>military rate {money(mil)}/nt vs {money(web)} online. <span className="font-semibold">You save {money(web - mil)} a night.</span></> : <>military rate {money(mil)}/nt vs {money(web)} online. <span className="font-semibold">The online price is better.</span></>)
        : <>the hotel couldn't say.</>}
    </>
  );
}
