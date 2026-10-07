// Getting there (7 Oct 2026): for an in-person event, what flying in costs.
// A visitor gives their home airport; we ask Google Flights (through SerpApi or
// SearchApi, whichever key we hold) for round trips arriving the day before and
// leaving the day after, and show the going rate, whether today's prices are
// low or high, and the cheapest few. Google only has public fares: military
// fares and bag allowances are the airlines' own, linked beside it on the page.
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";

const now = () => new Date().toISOString();
const HOURS = 3600_000;
const clean = (v?: string) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const serpKey = () => clean(process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY);
const searchKey = () => clean(process.env.SEARCHAPI_API_KEY || process.env.SEARCH_API_KEY || process.env.SEARCHAPI_KEY);

export type FareOption = { airline: string; price: number; stops: number; minutes: number; departs: string };
export type Fares = {
  from: string; to: string; outbound: string; inbound: string;
  lowest: number | null; typical: [number, number] | null; level: string;
  options: FareOption[]; googleUrl: string; provider: string;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Google Flights' own page for the same search, for booking or a closer look. */
export function googleFlightsUrl(from: string, to: string, outbound: string, inbound: string) {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights to ${to} from ${from} on ${outbound} through ${inbound}`)}&curr=USD`;
}

function readFlights(body: Record<string, any>): Pick<Fares, "lowest" | "typical" | "level" | "options"> {
  const all = [...(body.best_flights ?? []), ...(body.other_flights ?? [])] as Record<string, any>[];
  const options: FareOption[] = all
    .filter((f) => Number(f.price) > 0)
    .map((f) => {
      const legs = (f.flights ?? []) as Record<string, any>[];
      return {
        airline: Array.from(new Set(legs.map((l) => String(l.airline ?? "")).filter(Boolean))).join(" + ") || "—",
        price: Number(f.price),
        stops: Math.max(0, legs.length - 1),
        minutes: Number(f.total_duration ?? 0),
        departs: String(legs[0]?.departure_airport?.time ?? ""),
      };
    })
    .sort((a, b) => a.price - b.price)
    .slice(0, 4);
  const pi = (body.price_insights ?? {}) as Record<string, any>;
  const range = Array.isArray(pi.typical_price_range) ? pi.typical_price_range
    : pi.typical_price_range ? [pi.typical_price_range.low_price, pi.typical_price_range.high_price] : null;
  return {
    lowest: Number(pi.lowest_price) || options[0]?.price || null,
    typical: range && Number(range[0]) && Number(range[1]) ? [Number(range[0]), Number(range[1])] : null,
    level: String(pi.price_level ?? ""),
    options,
  };
}

async function askGoogleFlights(from: string, to: string, outbound: string, inbound: string): Promise<{ body: Record<string, any>; provider: string }> {
  // SerpApi first (the key we hold today), then SearchApi; a key in the wrong slot still works.
  const keys = Array.from(new Set([serpKey(), searchKey()].filter(Boolean)));
  if (!keys.length) throw Object.assign(new Error("Fares aren't set up yet."), { status: 503 });
  let last = "";
  for (const k of keys) {
    const serp = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ engine: "google_flights", departure_id: from, arrival_id: to, outbound_date: outbound, return_date: inbound, currency: "USD", hl: "en", gl: "us", api_key: k })}`, { signal: AbortSignal.timeout(40_000) }).catch(() => null);
    if (serp?.ok) return { body: (await serp.json()) as Record<string, any>, provider: "serpapi" };
    if (serp) last = `${serp.status}`;
    const sa = await fetch(`https://www.searchapi.io/api/v1/search?${new URLSearchParams({ engine: "google_flights", departure_id: from, arrival_id: to, outbound_date: outbound, return_date: inbound, flight_type: "round_trip", currency: "USD" })}`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(40_000) }).catch(() => null);
    if (sa?.ok) return { body: (await sa.json()) as Record<string, any>, provider: "searchapi" };
    if (sa) last = `${sa.status}`;
  }
  throw Object.assign(new Error(`Couldn't get fares right now${last ? ` (${last})` : ""}.`), { status: 502 });
}

/** Fares from one airport to the event's, cached half a day (each look-up is a paid search). */
export async function faresFor(from: string, to: string, outbound: string, inbound: string): Promise<Fares> {
  const key = `flights:${from}:${to}:${outbound}:${inbound}`;
  const [hit] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, key));
  if (hit && Date.now() - Date.parse(hit.createdAt) < 12 * HOURS) return JSON.parse(hit.payload) as Fares;
  const { body, provider } = await askGoogleFlights(from, to, outbound, inbound);
  const out: Fares = { from, to, outbound, inbound, ...readFlights(body), googleUrl: googleFlightsUrl(from, to, outbound, inbound), provider };
  await db.insert(discoveryCache).values({ key, payload: JSON.stringify(out), createdAt: now() })
    .onConflictDoUpdate({ target: discoveryCache.key, set: { payload: JSON.stringify(out), createdAt: now() } });
  return out;
}

const hits = new Map<string, number[]>();
/** A fair share per visitor: fares cost us a search each (cache hits are free). */
function throttled(ip: string): boolean {
  const t = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => t - x < HOURS);
  recent.push(t);
  hits.set(ip, recent);
  return recent.length > 12;
}

export function registerTravel(app: Express) {
  /** Fares to an in-person event from the visitor's airport: arrive the day before, leave the day after. */
  app.get("/api/events/:id/fares", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const ev = await storage.getEventById(Number(req.params.id));
    if (!ev || ev.visible === false || !ev.airport) return res.status(404).json({ message: "This event has no airport set." });
    const from = String(req.query.from ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from)) return res.status(400).json({ message: "Enter your airport's three-letter code, like SAN or DFW." });
    const to = ev.airport.toUpperCase();
    if (from === to) return res.status(400).json({ message: "That's the airport the event is at." });
    const start = new Date(ev.startAtUtc);
    const end = new Date(start.getTime() + ev.durationHours * HOURS);
    const outbound = ymd(new Date(start.getTime() - 24 * HOURS));
    const inbound = ymd(new Date(end.getTime() + 24 * HOURS));
    if (Date.parse(outbound) < Date.now() - 24 * HOURS) return res.status(410).json({ message: "This event has already happened." });
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const cacheKey = `flights:${from}:${to}:${outbound}:${inbound}`;
    const [cached] = await db.select({ key: discoveryCache.key }).from(discoveryCache).where(eq(discoveryCache.key, cacheKey));
    if (!cached && throttled(ip)) return res.status(429).json({ message: "That's a lot of searches. Try again in a little while, or search Google Flights directly.", googleUrl: googleFlightsUrl(from, to, outbound, inbound) });
    try {
      res.json(await faresFor(from, to, outbound, inbound));
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ message: (e as Error).message, googleUrl: googleFlightsUrl(from, to, outbound, inbound) });
    }
  });
}
