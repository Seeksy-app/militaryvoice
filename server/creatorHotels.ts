import type { Express, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { travelCalls, travelSearches, type TravelCallRow } from "../shared/schema.js";
import type { TravelerStatus } from "../shared/militaryFares.js";
import { hotelBrandOf, hotelByKey, hotelPerkFor, MILITARY_HOTELS, MILITARY_HOTELS_VERIFIED, type MilitaryHotelPerk } from "../shared/militaryHotels.js";
import { CACHE_MS, CALLS_A_DAY, HttpError, callsLive, dayStart, emailOf, now, parallelKey, placeCall, refresh, registerCallKind } from "./creatorTravel.js";

/**
 * Hotels on the Travel page (Andrew, 26 Nov 2026: "Add hotels. Most hotels have mil discounts but have to call").
 * Same pattern as flights (server/creatorTravel.ts): a signed-in creator searches hotels (Parallel's Hotels API, ~$5
 * per 1,000 searches), each result carries its brand's military rate for their status, and where the rate is only
 * quoted by phone, "Have us call" saves a request. The assistant rings the property (its number from Parallel Places,
 * ~$1 per 1,000) or the brand's central reservations, asks for the military rate for the exact dates and room, and we
 * write the report: military rate against the online price.
 *
 * HARD GATE (shared with flights): nothing rings unless travel:calls is "on", and while travel:test-number is set every
 * call rings that number instead. A real hotel call needs Andrew's own go.
 */

const PARALLEL_HOTELS = "https://api.parallel.ai/v1/hotels/search";
const PARALLEL_PLACES = "https://api.parallel.ai/v1/places/search";
const HOTEL_SEARCHES_A_DAY = 25;

type Offer = { seller?: string; url?: string; price_per_night?: number; total_price?: number; currency?: string; free_cancellation?: boolean };
type ParallelHotel = {
  url?: string; url_kind?: "property_website" | "booking_page"; name?: string; property_type?: string; address?: string;
  latitude?: number; longitude?: number; hotel_class?: number; rating?: "fair" | "good" | "great" | "excellent";
  images?: string[]; price_per_night?: number; total_price?: number; currency?: string; free_cancellation?: boolean;
  offers?: Offer[]; amenities?: string[]; check_in_time?: string; check_out_time?: string;
};

export type HotelQuery = {
  location: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  status: TravelerStatus;
  sort: "relevance" | "price" | "rating";
  /** Nightly price before taxes and fees, USD; 0 = no limit. */
  maxPrice: number;
};
export type HotelOffer = { seller: string; url: string; pricePerNight: number | null; totalPrice: number | null; freeCancellation: boolean | null };
export type HotelResult = {
  /** Index in this search; "Have us call" sends it back with the searchId. */
  i: number;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Star class 1–5, or null. */
  hotelClass: number | null;
  rating: "fair" | "good" | "great" | "excellent" | null;
  /** The cheapest offer, USD: nightly before taxes and fees, and the whole stay as the seller lists it. */
  pricePerNight: number | null;
  totalPrice: number | null;
  freeCancellation: boolean | null;
  url: string;
  /** property_website: the hotel's own site; booking_page: a booking site's page for these dates. */
  urlKind: "property_website" | "booking_page";
  offers: HotelOffer[];
  amenities: string[];
  checkInTime: string;
  checkOutTime: string;
  /** One photo, only on a fresh search (photo links expire, so we don't keep them); null on a cached one. */
  image: string | null;
  /** The brand matched from the name ("Marriott Bonvoy"), or null. */
  brand: string | null;
  perk: MilitaryHotelPerk | null;
  /** This traveler qualifies and the brand quotes its military rate by phone: show "Have us call". */
  canCall: boolean;
};
export type HotelSearchResponse = {
  searchId: number;
  cached: boolean;
  searchesLeft: number | null;
  query: HotelQuery;
  nights: number;
  results: HotelResult[];
  /** The perk of every brand in the results, for this status. */
  perks: MilitaryHotelPerk[];
  notes: string[];
  verified: string;
  callsLive: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nightsOf = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};

function readQuery(body: unknown): HotelQuery {
  const b = (body ?? {}) as Record<string, unknown>;
  // `where` and `guests` are accepted too (UI/UX's names).
  const location = String(b.location ?? b.where ?? "").replace(/\s+/g, " ").trim();
  const checkIn = String(b.checkIn ?? "").trim();
  const checkOut = String(b.checkOut ?? "").trim();
  if (location.length < 2 || location.length > 200) throw new HttpError(400, "Type a city, neighborhood or address, like \"San Diego\" or \"near the convention center, Orlando\".");
  const today = now().slice(0, 10);
  if (!DAY.test(checkIn) || checkIn < today) throw new HttpError(400, "Pick a check-in date from today on.");
  if (!DAY.test(checkOut) || checkOut <= checkIn) throw new HttpError(400, "Check-out has to be after check-in.");
  if (nightsOf(checkIn, checkOut) > 30) throw new HttpError(400, "Search up to 30 nights at a time.");
  const adults = int(b.adults ?? b.guests, 1, 16, 1);
  const rooms = Math.min(int(b.rooms, 1, 8, 1), adults);
  const sort = b.sort === "price" || b.sort === "rating" ? b.sort : "relevance";
  const maxPrice = Math.max(0, Math.round(Number(b.maxPrice) || 0));
  return { location, checkIn, checkOut, adults, rooms, status: b.status === "active" ? "active" : "veteran", sort, maxPrice };
}
const keyOf = (q: HotelQuery) => `hotel:${q.location.toLowerCase()}|${q.checkIn}|${q.checkOut}|${q.adults}|${q.rooms}|${q.sort}|${q.maxPrice}`;

async function searchParallel(q: HotelQuery): Promise<ParallelHotel[]> {
  if (!parallelKey()) throw new HttpError(503, "Hotel search isn't switched on yet.");
  const r = await fetch(PARALLEL_HOTELS, {
    method: "POST",
    headers: { "x-api-key": parallelKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      location: q.location,
      check_in_date: q.checkIn,
      check_out_date: q.checkOut,
      adults: q.adults,
      ...(q.rooms > 1 ? { rooms: q.rooms } : {}),
      // Military rates are a hotel thing; vacation rentals don't have them.
      property_types: ["hotel"],
      ...(q.maxPrice ? { max_price: q.maxPrice } : {}),
      sort: q.sort,
      currency: "USD",
      advanced_settings: { max_results: 30 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 400);
    console.error("Parallel hotels:", r.status, text);
    if (r.status === 422 || r.status === 400) throw new HttpError(400, "We couldn't search that stay. Check the place and dates.");
    if (r.status === 429) throw new HttpError(429, "Lots of people are searching right now. Try again in a minute.");
    throw new HttpError(502, "Hotel search didn't answer. Try again in a minute.");
  }
  const j = (await r.json()) as { results?: ParallelHotel[] };
  return Array.isArray(j.results) ? j.results : [];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const usd = (v: unknown, cur?: string) => (cur && cur !== "USD" ? null : num(v));

export function shape(raw: ParallelHotel[], q: HotelQuery, fresh: boolean): HotelResult[] {
  return raw.flatMap((h, i): HotelResult[] => {
    if (!h?.name) return [];
    const brand = hotelBrandOf(h.name);
    const perk = brand ? hotelPerkFor(brand, q.status) : null;
    return [{
      i,
      name: String(h.name),
      address: String(h.address ?? ""),
      latitude: num(h.latitude),
      longitude: num(h.longitude),
      hotelClass: num(h.hotel_class),
      rating: h.rating ?? null,
      pricePerNight: usd(h.price_per_night, h.currency),
      totalPrice: usd(h.total_price, h.currency),
      freeCancellation: typeof h.free_cancellation === "boolean" ? h.free_cancellation : null,
      url: String(h.url ?? ""),
      urlKind: h.url_kind === "property_website" ? "property_website" : "booking_page",
      offers: (h.offers ?? []).filter((o) => o.url && o.seller).slice(0, 5).map((o) => ({
        seller: String(o.seller), url: String(o.url), pricePerNight: usd(o.price_per_night, o.currency), totalPrice: usd(o.total_price, o.currency),
        freeCancellation: typeof o.free_cancellation === "boolean" ? o.free_cancellation : null,
      })),
      amenities: (h.amenities ?? []).map(String).slice(0, 12),
      checkInTime: String(h.check_in_time ?? ""),
      checkOutTime: String(h.check_out_time ?? ""),
      image: fresh ? (h.images ?? []).find((u) => /^https:\/\//.test(u)) ?? null : null,
      brand: brand?.brand ?? null,
      perk,
      canCall: !!perk?.phoneOnly,
    }];
  });
}

function perksAndNotes(results: HotelResult[], status: TravelerStatus) {
  const seen = new Set(results.map((r) => r.perk?.key).filter(Boolean));
  const perks = MILITARY_HOTELS.filter((h) => seen.has(h.key)).map((h) => hotelPerkFor(h, status));
  const notes = [
    "Prices are the lowest online offers we found, before taxes and fees per night. Military rates are set by each hotel, so they can be higher or lower than online.",
    "Bring the ID the hotel asks for to check-in. Military rates usually need it.",
  ];
  return { perks, notes };
}

async function searchesToday(email: string): Promise<number> {
  const rows = await db.select({ id: travelSearches.id }).from(travelSearches)
    .where(and(eq(travelSearches.ownerEmail, email), eq(travelSearches.kind, "hotel"), gte(travelSearches.createdAt, dayStart())));
  return rows.length;
}

/** Stored without photos: their links expire. */
const storable = (raw: ParallelHotel[]) => raw.map(({ images: _images, ...h }) => h);

async function search(email: string, q: HotelQuery, admin: boolean): Promise<HotelSearchResponse> {
  const used = await searchesToday(email);
  if (!admin && used >= HOTEL_SEARCHES_A_DAY) throw new HttpError(429, `You've run today's ${HOTEL_SEARCHES_A_DAY} hotel searches. They come back tomorrow.`);
  const key = keyOf(q);
  const since = new Date(Date.now() - CACHE_MS).toISOString();
  const [hit] = await db.select().from(travelSearches)
    .where(and(eq(travelSearches.key, key), eq(travelSearches.kind, "hotel"), eq(travelSearches.error, ""), gte(travelSearches.createdAt, since)))
    .orderBy(desc(travelSearches.createdAt)).limit(1);
  let raw: ParallelHotel[];
  let cached = false;
  if (hit?.results) {
    raw = JSON.parse(hit.results) as ParallelHotel[];
    cached = true;
  } else {
    try {
      raw = await searchParallel(q);
    } catch (err) {
      await db.insert(travelSearches).values({ ownerEmail: email, kind: "hotel", key, query: JSON.stringify(q), error: (err as Error).message.slice(0, 300), createdAt: now() });
      throw err;
    }
  }
  const [row] = await db.insert(travelSearches).values({ ownerEmail: email, kind: "hotel", key, query: JSON.stringify(q), results: JSON.stringify(storable(raw)), cached, createdAt: now() }).returning();
  const results = shape(raw, q, !cached);
  return {
    searchId: row.id,
    cached,
    searchesLeft: admin ? null : Math.max(0, HOTEL_SEARCHES_A_DAY - used - 1),
    query: q,
    nights: nightsOf(q.checkIn, q.checkOut),
    results,
    ...perksAndNotes(results, q.status),
    verified: MILITARY_HOTELS_VERIFIED,
    callsLive: await callsLive(),
  };
}

// ---- "Have us call" for hotels ------------------------------------------------------------------------------------

type CallStay = { name: string; address: string; location: string; checkIn: string; checkOut: string; nights: number; adults: number; rooms: number; pricePerNight: number | null; totalPrice: number | null };
type CallTarget = { phone: string; who: "property" | "brand"; name: string };
export type HotelCallReport = {
  /** yes: they quoted a military rate; no: there isn't one for these dates; unknown: we couldn't find out. */
  available: "yes" | "no" | "unknown";
  /** USD a night before taxes, as quoted. */
  militaryPerNight: number | null;
  militaryTotal: number | null;
  /** militaryPerNight minus the online nightly price (negative = cheaper), when both are known. */
  difference: number | null;
  conditions: string;
  summary: string;
};
export type HotelCallView = {
  id: number;
  brand: string;
  hotel: string;
  traveler: TravelerStatus;
  stay: CallStay;
  /** Who we ring: the hotel itself, or the brand's central reservations. */
  calling: "property" | "brand";
  /** The hotel's (or brand's) number, for "Call to book the rate we found". Never the test number. */
  phone: string | null;
  onlinePerNight: number | null;
  status: "waiting" | "calling" | "done" | "failed";
  report: HotelCallReport | null;
  error: string;
  createdAt: string;
  updatedAt: string;
};

function viewOf(c: TravelCallRow): HotelCallView {
  let report: HotelCallReport | null = null;
  try { report = c.report ? (JSON.parse(c.report) as HotelCallReport) : null; } catch { report = null; }
  let target: Partial<CallTarget> = {};
  try { target = c.target ? (JSON.parse(c.target) as CallTarget) : {}; } catch { target = {}; }
  const stay = JSON.parse(c.flight) as CallStay;
  return {
    id: c.id,
    brand: hotelByKey(c.iata)?.brand || c.iata,
    hotel: stay.name,
    traveler: c.traveler === "active" ? "active" : "veteran",
    stay,
    calling: target.who === "brand" ? "brand" : "property",
    phone: target.phone || null,
    onlinePerNight: stay.pricePerNight,
    status: (["waiting", "calling", "done", "failed"].includes(c.status) ? c.status : "waiting") as HotelCallView["status"],
    report,
    error: c.error,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const spokenDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function callPrompt(c: TravelCallRow, stay: CallStay, target: CallTarget) {
  const who = c.traveler === "active" ? "an active-duty U.S. service member" : "a U.S. military veteran";
  const place = target.who === "property" ? `the ${stay.name}` : `${target.name} central reservations, about the ${stay.name}${stay.address ? ` at ${stay.address}` : ""}`;
  const party = `${stay.adults} adult${stay.adults > 1 ? "s" : ""}${stay.rooms > 1 ? `, ${stay.rooms} rooms` : ", one room"}`;
  const greeting = `Hi, I'm an automated assistant calling on behalf of a traveler who's ${who}. I'm not booking today, just asking about a rate. Is this the right place to ask about a military rate?`;
  const prompt = `You are an automated phone assistant for MilitaryVoices.ai. You are calling ${place} on behalf of one traveler, ${who}, traveling for personal reasons (a conference or speaking trip). Your one job is to learn whether the hotel has a military rate for one exact stay, and what it costs.

The stay: the ${stay.name}, checking in ${spokenDate(stay.checkIn)} and checking out ${spokenDate(stay.checkOut)} (${stay.nights} night${stay.nights > 1 ? "s" : ""}), ${party}, a standard room.${stay.pricePerNight ? ` The lowest price online is $${stay.pricePerNight.toFixed(0)} a night before taxes.` : ""}

How to run the call:
- If you reach a phone menu, choose the options for reservations or a new booking. Wait on hold if you have to.
- When a person answers, say you're an automated assistant calling for a traveler who is ${who}, and that you're asking about a rate, not booking.${target.who === "brand" ? ` Make sure they look up this exact hotel: the ${stay.name}${stay.address ? `, ${stay.address}` : ""}.` : ""}
- Ask: is there a military rate for these exact dates and a standard room, and what is it per night before taxes? Read the dates slowly. Then ask what it comes to in total with taxes, if they can say.
- If there is one, ask what the traveler needs to show at check-in (for example a military ID or DD-214) and whether it can be cancelled. Repeat the nightly rate back to confirm it.
- If there isn't one, ask once whether any other military or government discount applies for this traveler, then thank them.
- Then say thank you and goodbye, and end the call. Keep it short and polite.

Never, under any circumstances:
- Give, invent or confirm any name, date of birth, phone number, email, address, card number, military or DoD ID number, loyalty number or any other personal detail. If they need any of these to quote a rate, say the traveler will call back themselves, thank them and end the call.
- Book, hold, pay for, cancel or change anything, or accept any terms.
- Pretend to be a human or to be the traveler. If asked, say you're an automated assistant.
- Discuss anything other than this rate.`;
  return { greeting, prompt };
}

async function writeReport(c: TravelCallRow, transcript: string): Promise<HotelCallReport> {
  const stay = JSON.parse(c.flight) as CallStay;
  const online = stay.pricePerNight;
  const client = new Anthropic();
  const out = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 600,
    system: `You read the transcript of a phone call in which an automated assistant asked a hotel whether a military rate exists for one stay (${stay.nights} night${stay.nights > 1 ? "s" : ""}) and what it costs. Answer ONLY from what the hotel's agent said in the transcript; never guess. Reply with one JSON object and nothing else: {"available": "yes" | "no" | "unknown", "militaryPerNight": number or null (the nightly military rate before taxes the agent quoted, in US dollars), "militaryTotal": number or null (the total for the stay the agent quoted, if they gave one), "conditions": string (what to show at check-in, cancellation, anything else the agent said about the rate; empty if none), "summary": string (one or two plain sentences for the traveler, e.g. "The hotel has a military rate of $139 a night, $20 less than online. Show your military ID at check-in.")}.${online ? ` The lowest online price was $${online.toFixed(2)} a night before taxes.` : ""}`,
    messages: [{ role: "user", content: `Transcript:\n\n${transcript.slice(0, 30_000)}` }],
  });
  const text = out.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<HotelCallReport>;
  const available = j.available === "yes" || j.available === "no" ? j.available : "unknown";
  const money = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v * 100) / 100 : null);
  const militaryPerNight = money(j.militaryPerNight);
  return {
    available,
    militaryPerNight,
    militaryTotal: money(j.militaryTotal),
    difference: militaryPerNight !== null && online !== null ? Math.round((militaryPerNight - online) * 100) / 100 : null,
    conditions: String(j.conditions ?? "").slice(0, 600),
    summary: String(j.summary ?? "").slice(0, 400),
  };
}

registerCallKind("hotel", {
  plan(c) {
    let target: CallTarget | null = null;
    try { target = JSON.parse(c.target) as CallTarget; } catch { target = null; }
    if (!target?.phone) return { error: "No number to call for this hotel." };
    const stay = JSON.parse(c.flight) as CallStay;
    return { to: target.phone, ...callPrompt(c, stay, target), vars: { hotel: stay.name, brand: hotelByKey(c.iata)?.brand || c.iata } };
  },
  report: writeReport,
  view: viewOf,
});

/** US/Canada numbers only, as E.164 ("+1…"); anything else isn't rung. */
function e164(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  if (/^\+1\d{10}$/.test(d)) return d;
  const digits = d.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "hotel", "inn", "suites", "by"].includes(w)));

/** The hotel's own number, from Parallel Places: the place at (or right by) the hotel whose name matches. */
async function propertyPhone(h: HotelResult): Promise<string> {
  if (!parallelKey()) return "";
  const near = h.latitude !== null && h.longitude !== null;
  const r = await fetch(PARALLEL_PLACES, {
    method: "POST",
    headers: { "x-api-key": parallelKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      query: h.name.slice(0, 200),
      ...(near ? { latitude: h.latitude, longitude: h.longitude, max_distance_km: 1 } : { location: (h.address || h.name).slice(0, 200) }),
      mode: "fast",
      advanced_settings: { max_results: 5 },
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r?.ok) return "";
  const j = (await r.json().catch(() => ({}))) as { results?: { name?: string; phone?: string; distance_km?: number }[] };
  const want = words(h.name);
  for (const p of j.results ?? []) {
    const got = words(String(p.name ?? ""));
    const shared = Array.from(want).filter((w) => got.has(w)).length;
    const close = !near || (typeof p.distance_km === "number" && p.distance_km <= 0.5);
    // Most of the hotel's distinctive words, at the hotel: the same property, not a sister hotel down the road.
    if (close && want.size && shared / want.size >= 0.6) {
      const phone = e164(String(p.phone ?? ""));
      if (phone) return phone;
    }
  }
  return "";
}

/** One result of one of their searches, re-shaped from the stored row. */
async function resultOf(email: string, searchId: number, i: number): Promise<{ q: HotelQuery; res: HotelResult }> {
  const [s] = await db.select().from(travelSearches).where(and(eq(travelSearches.id, searchId), eq(travelSearches.ownerEmail, email), eq(travelSearches.kind, "hotel"))).limit(1);
  if (!s?.results) throw new HttpError(404, "Search again, then pick the hotel.");
  const q = JSON.parse(s.query) as HotelQuery;
  const raw = (JSON.parse(s.results) as ParallelHotel[])[i];
  const res = raw ? shape([raw], q, false)[0] : undefined;
  if (!res) throw new HttpError(404, "Search again, then pick the hotel.");
  return { q, res };
}

/** Who to ring for this hotel: its own line (Parallel Places), else its brand's central reservations. */
async function targetFor(res: HotelResult): Promise<CallTarget | null> {
  const own = await propertyPhone(res);
  if (own) return { phone: own, who: "property", name: res.name };
  const brand = res.perk ? hotelByKey(res.perk.key) : undefined;
  const central = e164(brand?.central_reservations_phone ?? "");
  return central && brand ? { phone: central, who: "brand", name: brand.brand } : null;
}
const phoneLookups = new Map<string, { at: number; t: CallTarget | null }>();

async function requestCall(email: string, searchId: number, i: number): Promise<HotelCallView> {
  const { q, res } = await resultOf(email, searchId, i);
  if (!res.perk) throw new HttpError(400, "We don't have a military rate on file for this hotel's brand.");
  if (!res.perk.eligible) throw new HttpError(400, `${res.perk.brand}'s military rate isn't for ${q.status === "active" ? "active duty" : "veterans"}.`);
  if (!res.canCall) throw new HttpError(400, `${res.perk.brand} shows its military rate online. Book it there.`);
  const calls = await db.select({ id: travelCalls.id }).from(travelCalls).where(and(eq(travelCalls.ownerEmail, email), gte(travelCalls.createdAt, dayStart())));
  if (calls.length >= CALLS_A_DAY) throw new HttpError(429, `You've asked for today's ${CALLS_A_DAY} calls. Ask again tomorrow.`);
  const target = await targetFor(res);
  if (!target) throw new HttpError(400, "We couldn't find a number for this hotel. Call it yourself and ask for the military rate.");
  const stay: CallStay = {
    name: res.name, address: res.address, location: q.location, checkIn: q.checkIn, checkOut: q.checkOut,
    nights: nightsOf(q.checkIn, q.checkOut), adults: q.adults, rooms: q.rooms, pricePerNight: res.pricePerNight, totalPrice: res.totalPrice,
  };
  let [row] = await db.insert(travelCalls).values({
    ownerEmail: email,
    searchId,
    kind: "hotel",
    iata: res.perk.key,
    traveler: q.status,
    flight: JSON.stringify(stay),
    webPriceCents: res.totalPrice ? Math.round(res.totalPrice * 100) : 0,
    target: JSON.stringify(target),
    createdAt: now(),
    updatedAt: now(),
  }).returning();
  if (await callsLive()) row = await placeCall(row.id).catch(() => row);
  return viewOf(row);
}

// ---- Routes -------------------------------------------------------------------------------------------------------

export function registerCreatorHotels(app: Express, requireHostSession: RequestHandler) {
  const send = (res: import("express").Response, err: unknown) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ message: err.message });
    console.error("Hotels:", (err as Error)?.message);
    res.status(500).json({ message: "Something went wrong. Try again in a minute." });
  };

  /** Signed in: search hotels; each result carries its brand's military rate for the traveler's status. */
  app.post("/api/travel/hotels/search", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const email = emailOf(req);
      res.json(await search(email, readQuery(req.body), await storage.isAdminEmail(email)));
    } catch (err) { send(res, err); }
  });

  /** Every brand's military rate for a status (the page can show them before any search). */
  app.get("/api/travel/hotels/perks", requireHostSession, (req, res) => {
    const status: TravelerStatus = req.query.status === "active" ? "active" : "veteran";
    res.json({ status, perks: MILITARY_HOTELS.map((h) => hotelPerkFor(h, status)), notes: perksAndNotes([], status).notes, verified: MILITARY_HOTELS_VERIFIED });
  });

  /** "Have us call" on one hotel of one of their searches. */
  app.post("/api/travel/hotels/calls", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const searchId = Number(req.body?.searchId);
      const i = Number(req.body?.i);
      if (!Number.isInteger(searchId) || !Number.isInteger(i) || i < 0) throw new HttpError(400, "Pick a hotel first.");
      res.status(201).json(await requestCall(emailOf(req), searchId, i));
    } catch (err) { send(res, err); }
  });

  /**
   * The number to ring for one hotel of one of their searches, for "Book by phone": the hotel's own line (looked up
   * on Parallel Places when asked, ~$1 per 1,000, never for the whole list) or its brand's central reservations.
   * { phone: "+1…" | null, who: "property" | "brand" | null, name }. Remembered for 30 minutes.
   */
  app.get("/api/travel/hotels/phone", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const email = emailOf(req);
      const searchId = Number(req.query.searchId);
      const i = Number(req.query.i);
      if (!Number.isInteger(searchId) || !Number.isInteger(i) || i < 0) throw new HttpError(400, "Pick a hotel first.");
      const k = `${email}|${searchId}|${i}`;
      let hit = phoneLookups.get(k);
      if (!hit || Date.now() - hit.at > CACHE_MS) {
        const { res: r } = await resultOf(email, searchId, i);
        hit = { at: Date.now(), t: await targetFor(r) };
        if (phoneLookups.size > 2000) phoneLookups.clear();
        phoneLookups.set(k, hit);
      }
      res.json({ phone: hit.t?.phone ?? null, who: hit.t?.who ?? null, name: hit.t?.name ?? "" });
    } catch (err) { send(res, err); }
  });

  /** Their hotel call requests, newest first; a call that's under way is checked on the way out. */
  app.get("/api/travel/hotels/calls", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const rows = await db.select().from(travelCalls).where(and(eq(travelCalls.ownerEmail, emailOf(req)), eq(travelCalls.kind, "hotel"))).orderBy(desc(travelCalls.createdAt)).limit(20);
      const fresh = await Promise.all(rows.map((c) => refresh(c).catch(() => c)));
      res.json({ calls: fresh.map(viewOf), callsLive: await callsLive() });
    } catch (err) { send(res, err); }
  });
}
