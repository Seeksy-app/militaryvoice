import type { Express, Request, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { travelCalls, travelSearches, type TravelCallRow } from "../shared/schema.js";
import { airlineByIata, MILITARY_AIRLINES, MILITARY_CALL_DESKS, MILITARY_FARES_VERIFIED, perkFor, type MilitaryPerk, type TravelerStatus } from "../shared/militaryFares.js";

/**
 * Travel (Andrew, 26 Nov 2026: "Yes, build it"). Creators fly a lot (conferences, speaking), so a signed-in creator
 * searches flights here and sees each airline's military perk for their status beside the price. Where an airline only
 * quotes its military fare by phone, "Have us call" saves a request; an assistant (ElevenLabs Agents, over our own
 * Twilio number; Andrew 26 Nov: "Use another provider" than Synthflow) rings that airline,
 * asks for the military fare on the exact flight, hangs up and we write the report: military fare against web price.
 *
 * HARD GATE: no call to any airline is placed until Andrew OKs one test call. Calls go out only while the setting
 * travel:calls is "on" (off by default) and ELEVENLABS_AGENTS_API_KEY, ELEVENLABS_TRAVEL_AGENT_ID and
 * ELEVENLABS_TRAVEL_PHONE_ID are set. While travel:test-number
 * holds a number, every call rings that number instead of the airline (for a rehearsal with someone playing the desk).
 *
 * Flights come from Parallel's Flights API (search only, ~$5 per 1,000 searches, 120 a minute). An identical search
 * within 30 minutes reuses the stored answer; each account gets SEARCHES_A_DAY searches a day (admins unlimited).
 */

const PARALLEL_FLIGHTS = "https://api.parallel.ai/v1/flights/search";
const ELEVEN = "https://api.elevenlabs.io";
const CACHE_MS = 30 * 60_000;
const SEARCHES_A_DAY = 25;
const CALLS_A_DAY = 3;
const now = () => new Date().toISOString();
const dayStart = () => `${now().slice(0, 10)}T00:00:00.000Z`;

const parallelKey = () =>
  ["PARALLEL_API_KEY", "PARALLEL_AI_API_KEY", "PARALLELAI_API_KEY", "PARALLEL_KEY"].map((n) => (process.env[n] || "").trim()).find(Boolean) || "";
// A key of its own with ElevenAgents read + write, so the Alex/TTS key (ELEVENLABS_API_KEY, no Agents permission)
// stays as it is. The agent is the travel caller; the phone id is our Twilio number as imported into ElevenAgents.
// The agent and phone ids aren't secret: POST /api/admin/travel/setup makes the agent and finds the number, and keeps
// both in site settings (travel:agent-id, travel:phone-id); the env vars, if set, win.
const agentsKey = () => (process.env.ELEVENLABS_AGENTS_API_KEY || "").trim();
let ids = { agent: "", phone: "" };
async function loadIds() {
  ids = {
    agent: (process.env.ELEVENLABS_TRAVEL_AGENT_ID || "").trim() || ((await storage.getSetting("travel:agent-id").catch(() => null)) || "").trim(),
    phone: (process.env.ELEVENLABS_TRAVEL_PHONE_ID || "").trim() || ((await storage.getSetting("travel:phone-id").catch(() => null)) || "").trim(),
  };
  return ids;
}
const travelAgent = () => ids.agent;
const travelPhone = () => ids.phone;
const agentsReady = () => !!agentsKey() && !!travelAgent() && !!travelPhone();

export async function callsOn(): Promise<boolean> {
  return (await storage.getSetting("travel:calls").catch(() => null)) === "on";
}
async function testNumber(): Promise<string> {
  const n = ((await storage.getSetting("travel:test-number").catch(() => null)) || "").replace(/[^\d+]/g, "");
  return /^\+\d{10,15}$/.test(n) ? n : "";
}
/** Whether "Have us call" places a call now, or only saves the request. */
async function callsLive(): Promise<boolean> {
  await loadIds();
  return (await callsOn()) && agentsReady();
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const emailOf = (req: Request) => String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();

// ---- Flight search ------------------------------------------------------------------------------------------------

type Segment = { airline?: string; flight_number?: string; departure_airport?: string; departure_time?: string; arrival_airport?: string; arrival_time?: string; duration_minutes?: number; aircraft?: string; cabin?: string; overnight?: boolean };
export type FlightLeg = { departure_airport: string; departure_time: string; arrival_airport: string; arrival_time: string; duration_minutes: number; stops: number; segments: Segment[]; layovers: { airport: string; duration_minutes: number; overnight?: boolean }[] };
type ParallelResult = { url?: string; price?: number; outbound?: FlightLeg; inbound?: FlightLeg };

export type TravelQuery = { from: string; to: string; depart: string; return: string; status: TravelerStatus };
export type TravelResult = {
  /** Index in this search; "Have us call" sends it back with the searchId. */
  i: number;
  /** Total in USD for one adult (the round-trip total for a round trip), or null when none is listed. */
  price: number | null;
  url: string;
  /** The airline flying the first segment: its code, as in flight numbers. */
  iata: string;
  airline: string;
  flights: string[];
  outbound: FlightLeg;
  inbound: FlightLeg | null;
  perk: MilitaryPerk | null;
  /** Active duty, and this airline quotes its military fare only by phone: show "Have us call". */
  canCall: boolean;
};
export type TravelSearchResponse = {
  searchId: number;
  cached: boolean;
  searchesLeft: number | null;
  query: TravelQuery;
  results: TravelResult[];
  /** The perk of every airline in the results, for this status, plus the WeSalute-only airlines worth knowing. */
  perks: MilitaryPerk[];
  notes: string[];
  verified: string;
  /** false: "Have us call" saves the request and we call later; true: it calls now. */
  callsLive: boolean;
};

const IATA = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function readQuery(body: unknown): TravelQuery {
  const b = (body ?? {}) as Record<string, unknown>;
  const from = String(b.from ?? "").trim().toUpperCase();
  const to = String(b.to ?? "").trim().toUpperCase();
  const depart = String(b.depart ?? "").trim();
  const ret = String(b.return ?? "").trim();
  const status: TravelerStatus = b.status === "active" ? "active" : "veteran";
  if (!IATA.test(from) || !IATA.test(to)) throw new HttpError(400, "Use the three-letter airport codes, like DCA or SAN.");
  if (from === to) throw new HttpError(400, "Pick two different airports.");
  const today = now().slice(0, 10);
  if (!DAY.test(depart) || depart < today) throw new HttpError(400, "Pick a departure date from today on.");
  if (ret && (!DAY.test(ret) || ret < depart)) throw new HttpError(400, "The return date has to be on or after the departure date.");
  return { from, to, depart, return: ret, status };
}
const keyOf = (q: TravelQuery) => `${q.from}-${q.to}-${q.depart}-${q.return || "oneway"}`;
const carrierOf = (leg?: FlightLeg) => String(leg?.segments?.[0]?.flight_number ?? "").trim().slice(0, 2).toUpperCase();

async function searchParallel(q: TravelQuery): Promise<ParallelResult[]> {
  if (!parallelKey()) throw new HttpError(503, "Flight search isn't switched on yet.");
  const r = await fetch(PARALLEL_FLIGHTS, {
    method: "POST",
    headers: { "x-api-key": parallelKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ origins: [q.from], destinations: [q.to], departure_date: q.depart, ...(q.return ? { return_date: q.return } : {}), advanced_settings: { max_results: 20 } }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 400);
    console.error("Parallel flights:", r.status, text);
    if (r.status === 422 || r.status === 400) throw new HttpError(400, "We couldn't search that trip. Check the airports and dates.");
    if (r.status === 429) throw new HttpError(429, "Lots of people are searching right now. Try again in a minute.");
    throw new HttpError(502, "Flight search didn't answer. Try again in a minute.");
  }
  const j = (await r.json()) as { results?: ParallelResult[] };
  return Array.isArray(j.results) ? j.results : [];
}

export function shape(raw: ParallelResult[], q: TravelQuery): TravelResult[] {
  const out: TravelResult[] = [];
  raw.forEach((r, i) => {
    if (!r?.outbound?.segments?.length) return;
    const iata = carrierOf(r.outbound);
    if (iata === "NK") return; // Spirit stopped flying on 2 May 2026
    const a = airlineByIata(iata);
    const perk = a ? perkFor(a, q.status) : null;
    out.push({
      i,
      price: typeof r.price === "number" ? r.price : null,
      url: String(r.url ?? ""),
      iata,
      airline: a?.airline || String(r.outbound.segments[0].airline ?? iata),
      flights: [...r.outbound.segments, ...(r.inbound?.segments ?? [])].map((s) => String(s.flight_number ?? "")).filter(Boolean),
      outbound: r.outbound,
      inbound: r.inbound ?? null,
      perk,
      // phoneOnly is also true for veterans on JetBlue (WeSalute+ books by phone or chat), but that's a fixed 5%,
      // so there's nothing for us to ask: "Have us call" stays active duty only.
      canCall: q.status === "active" && !!perk?.phoneOnly,
    });
  });
  return out;
}

function perksAndNotes(results: TravelResult[], status: TravelerStatus) {
  const seen = new Set(results.map((r) => r.iata));
  // The WeSalute airlines (Breeze, Avelo) rarely show up in a search but can be the best deal for veterans.
  for (const extra of ["MX", "XP"]) seen.add(extra);
  const perks = MILITARY_AIRLINES.filter((a) => a.iata && seen.has(a.iata) && a.quick.status === "operating").map((a) => perkFor(a, status));
  const notes = [
    "Prices are the airlines' public web fares. Military fares and perks change, so check with the airline before you book.",
    "The Defense Travel System (DTS) is for official travel only. Book personal and speaking trips with the airline.",
    "Spirit stopped flying on 2 May 2026.",
  ];
  if (status === "veteran") notes.unshift("Most airlines have no veteran fare. WeSalute (free or WeSalute+) unlocks the veteran discounts on Breeze, Avelo, JetBlue, Alaska and Hawaiian.");
  return { perks, notes };
}

async function searchesToday(email: string): Promise<number> {
  const rows = await db.select({ id: travelSearches.id }).from(travelSearches).where(and(eq(travelSearches.ownerEmail, email), gte(travelSearches.createdAt, dayStart())));
  return rows.length;
}

async function search(email: string, q: TravelQuery, admin: boolean): Promise<TravelSearchResponse> {
  const used = await searchesToday(email);
  if (!admin && used >= SEARCHES_A_DAY) throw new HttpError(429, `You've run today's ${SEARCHES_A_DAY} flight searches. They come back tomorrow.`);
  const key = keyOf(q);
  const since = new Date(Date.now() - CACHE_MS).toISOString();
  const [hit] = await db.select().from(travelSearches)
    .where(and(eq(travelSearches.key, key), eq(travelSearches.error, ""), gte(travelSearches.createdAt, since)))
    .orderBy(desc(travelSearches.createdAt)).limit(1);
  let raw: ParallelResult[];
  let cached = false;
  if (hit?.results) {
    raw = JSON.parse(hit.results) as ParallelResult[];
    cached = true;
  } else {
    try {
      raw = await searchParallel(q);
    } catch (err) {
      await db.insert(travelSearches).values({ ownerEmail: email, key, query: JSON.stringify(q), error: (err as Error).message.slice(0, 300), createdAt: now() });
      throw err;
    }
  }
  const [row] = await db.insert(travelSearches).values({ ownerEmail: email, key, query: JSON.stringify(q), results: JSON.stringify(raw), cached, createdAt: now() }).returning();
  const results = shape(raw, q);
  return {
    searchId: row.id,
    cached,
    searchesLeft: admin ? null : Math.max(0, SEARCHES_A_DAY - used - 1),
    query: q,
    results,
    ...perksAndNotes(results, q.status),
    verified: MILITARY_FARES_VERIFIED,
    callsLive: await callsLive(),
  };
}

// ---- "Have us call" -----------------------------------------------------------------------------------------------

type CallFlight = { from: string; to: string; depart: string; return: string; flights: string[]; outbound: FlightLeg; inbound: FlightLeg | null; cabin: string };
export type TravelCallReport = {
  /** yes: they quoted a military fare; no: there isn't one on this flight; unknown: we couldn't find out. */
  available: "yes" | "no" | "unknown";
  militaryFare: number | null;
  /** militaryFare minus the web price (negative = cheaper), when both are known. */
  difference: number | null;
  conditions: string;
  summary: string;
};
export type TravelCallView = {
  id: number;
  iata: string;
  airline: string;
  traveler: TravelerStatus;
  flight: CallFlight;
  webPrice: number | null;
  /** waiting: saved, the call hasn't gone out yet; calling; done; failed. */
  status: "waiting" | "calling" | "done" | "failed";
  report: TravelCallReport | null;
  error: string;
  createdAt: string;
  updatedAt: string;
};

function viewOf(c: TravelCallRow): TravelCallView {
  let report: TravelCallReport | null = null;
  try { report = c.report ? (JSON.parse(c.report) as TravelCallReport) : null; } catch { report = null; }
  return {
    id: c.id,
    iata: c.iata,
    airline: airlineByIata(c.iata)?.airline || c.iata,
    traveler: c.traveler === "veteran" ? "veteran" : "active",
    flight: JSON.parse(c.flight) as CallFlight,
    webPrice: c.webPriceCents ? c.webPriceCents / 100 : null,
    status: (["waiting", "calling", "done", "failed"].includes(c.status) ? c.status : "waiting") as TravelCallView["status"],
    report,
    error: c.error,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const spoken = (leg: FlightLeg) => leg.segments.map((s) => `${s.flight_number} from ${s.departure_airport} at ${String(s.departure_time ?? "").slice(11)} to ${s.arrival_airport}`).join(", then ");
const spokenDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What the assistant says and does. Everything personal stays off the call. */
function callPrompt(airline: string, f: CallFlight, webPrice: number | null) {
  const trip = `${spokenDate(f.depart)}: ${spoken(f.outbound)}${f.inbound && f.return ? `; returning ${spokenDate(f.return)}: ${spoken(f.inbound)}` : ""}`;
  const greeting = `Hi, I'm an automated assistant calling on behalf of a traveler who's an active-duty U.S. service member. I'm not booking today, just asking about a fare. Is this the right place to ask about military fares?`;
  const prompt = `You are an automated phone assistant for MilitaryVoices.ai. You are calling ${airline} reservations on behalf of one traveler, an active-duty U.S. service member traveling for personal reasons (a conference or speaking trip, not on orders). Your one job is to learn whether ${airline} has a military fare on one exact itinerary, and what it costs.

The itinerary, one adult, ${f.cabin || "economy"}: ${trip}.${webPrice ? ` The public web price is $${webPrice.toFixed(2)} total.` : ""}

How to run the call:
- If you reach a phone menu, choose the options for reservations, a new booking or a live agent. Wait on hold if you have to.
- When a person answers, say you're an automated assistant calling for a traveler who is an active-duty service member, and that you're asking about a fare, not booking.
- Ask: is there a military fare for personal travel on exactly these flights, and what is the total price? Read the flight numbers, dates and airports slowly.
- If there is one, ask what the traveler needs to qualify and show (for example a military ID at check-in), and whether it has different change rules or bags. Repeat the price back to confirm it.
- If there isn't one, ask once whether any other military discount applies, then thank them.
- Then say thank you and goodbye, and end the call. Keep it short and polite.

Never, under any circumstances:
- Give, invent or confirm any name, date of birth, phone number, email, address, card number, military or DoD ID number, frequent-flyer number or any other personal detail. If they need any of these to quote a fare, say the traveler will call back themselves, thank them and end the call.
- Book, hold, pay for, cancel or change anything, or accept any terms.
- Pretend to be a human or to be the traveler. If asked, say you're an automated assistant.
- Discuss anything other than this fare.`;
  return { greeting, prompt };
}

async function eleven(path: string, init?: RequestInit) {
  return fetch(`${ELEVEN}${path}`, { ...init, headers: { "xi-api-key": agentsKey(), "Content-Type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
}

/** Rings the airline (or the test number). Refuses unless calls are switched on: the hard gate. */
export async function placeCall(id: number): Promise<TravelCallRow> {
  if (!(await callsOn())) throw new HttpError(409, "Calls are switched off (travel:calls isn't \"on\").");
  await loadIds();
  if (!agentsReady()) throw new HttpError(503, "ElevenAgents isn't set up: ELEVENLABS_AGENTS_API_KEY, or the travel agent or phone number (POST /api/admin/travel/setup).");
  // Claim the row so two requests can't ring twice.
  const [c] = await db.update(travelCalls).set({ status: "calling", updatedAt: now() }).where(and(eq(travelCalls.id, id), eq(travelCalls.status, "waiting"))).returning();
  if (!c) throw new HttpError(409, "That call isn't waiting.");
  const desk = MILITARY_CALL_DESKS[c.iata];
  const to = (await testNumber()) || desk?.phone || "";
  const fail = async (why: string) => {
    const [row] = await db.update(travelCalls).set({ status: "failed", error: why.slice(0, 300), updatedAt: now() }).where(eq(travelCalls.id, c.id)).returning();
    return row;
  };
  if (!to) return fail("No number to call for this airline.");
  const f = JSON.parse(c.flight) as CallFlight;
  const airline = airlineByIata(c.iata)?.airline || c.iata;
  const { greeting, prompt } = callPrompt(airline, f, c.webPriceCents ? c.webPriceCents / 100 : null);
  try {
    // ElevenAgents outbound call over our imported Twilio number. The per-call prompt and first message are
    // conversation overrides, which the agent must allow (Security tab: System prompt, First message).
    const r = await eleven("/v1/convai/twilio/outbound-call", {
      method: "POST",
      body: JSON.stringify({
        agent_id: travelAgent(),
        agent_phone_number_id: travelPhone(),
        to_number: to,
        conversation_initiation_client_data: {
          conversation_config_override: { agent: { first_message: greeting, prompt: { prompt } } },
          dynamic_variables: { airline, flights: f.flights.join(", "), travel_call_id: String(c.id) },
        },
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string; detail?: unknown };
    const callId = String(j.conversation_id ?? "");
    if (!r.ok || !j.success || !callId) {
      const why = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j.message ?? "");
      return fail(`ElevenLabs didn't start the call (${r.status} ${why.slice(0, 200)}).`);
    }
    const [row] = await db.update(travelCalls).set({ callId, calledNumber: to, updatedAt: now() }).where(eq(travelCalls.id, c.id)).returning();
    return row;
  } catch (err) {
    return fail(`Couldn't reach ElevenLabs: ${(err as Error).message}`);
  }
}

type ElevenConversation = {
  status?: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript?: { role?: "user" | "agent"; message?: string | null; time_in_call_secs?: number }[];
  metadata?: { call_duration_secs?: number; termination_reason?: string; cost_fiat?: number };
};

/** A call that's ringing or ended: read it from ElevenLabs and, once it's over, write the report. */
async function refresh(c: TravelCallRow): Promise<TravelCallRow> {
  if (c.status !== "calling" || !c.callId || !agentsKey()) return c;
  const r = await eleven(`/v1/convai/conversations/${encodeURIComponent(c.callId)}`).catch(() => null);
  if (!r?.ok) return c;
  const call = (await r.json().catch(() => ({}))) as ElevenConversation;
  const status = String(call.status ?? "");
  if (status !== "done" && status !== "failed") return c;
  // "user" is whoever picked up: the airline's agent (or its phone menu).
  const turns = (call.transcript ?? []).filter((t) => (t.message ?? "").trim());
  const transcript = turns.map((t) => `${t.role === "agent" ? "assistant" : "airline"}: ${String(t.message).trim()}`).join("\n");
  const durationSec = Math.round(Number(call.metadata?.call_duration_secs) || 0);
  const airlineSpoke = turns.some((t) => t.role === "user");
  if (status !== "done" || !airlineSpoke || transcript.trim().length < 40) {
    const reason = String(call.metadata?.termination_reason ?? "").trim();
    const why = status === "done" ? "The call ended before anyone answered the question." : `The call didn't go through${reason ? ` (${reason.slice(0, 120)})` : ""}.`;
    const [row] = await db.update(travelCalls).set({ status: "failed", transcript, durationSec, error: why, updatedAt: now() }).where(eq(travelCalls.id, c.id)).returning();
    return row;
  }
  const report = await writeReport(c, transcript).catch((err) => {
    console.error("Travel report:", (err as Error).message);
    return null;
  });
  const [row] = await db.update(travelCalls).set({
    status: report ? "done" : "failed",
    report: report ? JSON.stringify(report) : "",
    error: report ? "" : "We made the call but couldn't write up the answer.",
    transcript,
    durationSec,
    updatedAt: now(),
  }).where(eq(travelCalls.id, c.id)).returning();
  return row;
}

async function writeReport(c: TravelCallRow, transcript: string): Promise<TravelCallReport> {
  const web = c.webPriceCents ? c.webPriceCents / 100 : null;
  const client = new Anthropic();
  const out = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 600,
    system: `You read the transcript of a phone call in which an automated assistant asked an airline whether a military fare exists on one itinerary and what it costs. Answer ONLY from what the airline's agent said in the transcript; never guess. Reply with one JSON object and nothing else: {"available": "yes" | "no" | "unknown", "militaryFare": number or null (the total price the agent quoted for the military fare, in US dollars), "conditions": string (who qualifies, what to show, change rules or bags, as the agent said them; empty if none), "summary": string (one or two plain sentences for the traveler, e.g. "Delta quoted a military fare of $412, $38 less than the web price. Bring your military ID to check-in.")}.${web ? ` The public web price was $${web.toFixed(2)}.` : ""}`,
    messages: [{ role: "user", content: `Transcript:\n\n${transcript.slice(0, 30_000)}` }],
  });
  const text = out.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<TravelCallReport>;
  const available = j.available === "yes" || j.available === "no" ? j.available : "unknown";
  const militaryFare = typeof j.militaryFare === "number" && j.militaryFare > 0 ? Math.round(j.militaryFare * 100) / 100 : null;
  return {
    available,
    militaryFare,
    difference: militaryFare !== null && web !== null ? Math.round((militaryFare - web) * 100) / 100 : null,
    conditions: String(j.conditions ?? "").slice(0, 600),
    summary: String(j.summary ?? "").slice(0, 400),
  };
}

async function requestCall(email: string, searchId: number, i: number): Promise<TravelCallView> {
  const [s] = await db.select().from(travelSearches).where(and(eq(travelSearches.id, searchId), eq(travelSearches.ownerEmail, email))).limit(1);
  if (!s?.results) throw new HttpError(404, "Search again, then pick the flight.");
  const q = JSON.parse(s.query) as TravelQuery;
  const raw = (JSON.parse(s.results) as ParallelResult[])[i];
  const res = raw ? shape([raw], q)[0] : undefined;
  if (!res) throw new HttpError(404, "Search again, then pick the flight.");
  if (!res.canCall) throw new HttpError(400, q.status === "active" ? `${res.airline} doesn't quote military fares by phone. Book it online.` : "Phone-only military fares are for active duty.");
  const calls = await db.select({ id: travelCalls.id }).from(travelCalls).where(and(eq(travelCalls.ownerEmail, email), gte(travelCalls.createdAt, dayStart())));
  if (calls.length >= CALLS_A_DAY) throw new HttpError(429, `You've asked for today's ${CALLS_A_DAY} calls. Ask again tomorrow.`);
  const flight: CallFlight = { from: q.from, to: q.to, depart: q.depart, return: q.return, flights: res.flights, outbound: res.outbound, inbound: res.inbound, cabin: String(res.outbound.segments[0]?.cabin ?? "Economy") };
  let [row] = await db.insert(travelCalls).values({
    ownerEmail: email,
    searchId,
    iata: res.iata,
    traveler: q.status,
    flight: JSON.stringify(flight),
    webPriceCents: res.price ? Math.round(res.price * 100) : 0,
    createdAt: now(),
    updatedAt: now(),
  }).returning();
  if (await callsLive()) row = await placeCall(row.id).catch(() => row);
  return viewOf(row);
}

// ---- Routes -------------------------------------------------------------------------------------------------------

export function registerCreatorTravel(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  const send = (res: import("express").Response, err: unknown) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ message: err.message });
    console.error("Travel:", (err as Error)?.message);
    res.status(500).json({ message: "Something went wrong. Try again in a minute." });
  };

  /** Signed in: search flights; each result carries the airline's perk for the traveler's status. */
  app.post("/api/travel/search", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const email = emailOf(req);
      res.json(await search(email, readQuery(req.body), await storage.isAdminEmail(email)));
    } catch (err) { send(res, err); }
  });

  /** The airline perks on their own (the page can show them before any search). */
  app.get("/api/travel/perks", requireHostSession, async (req, res) => {
    const status: TravelerStatus = req.query.status === "active" ? "active" : "veteran";
    const perks = MILITARY_AIRLINES.filter((a) => a.iata && a.quick.status === "operating").map((a) => perkFor(a, status));
    res.json({ status, perks, notes: perksAndNotes([], status).notes, verified: MILITARY_FARES_VERIFIED });
  });

  /** "Have us call" on one result of one of their searches. */
  app.post("/api/travel/calls", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const searchId = Number(req.body?.searchId);
      const i = Number(req.body?.i);
      if (!Number.isInteger(searchId) || !Number.isInteger(i) || i < 0) throw new HttpError(400, "Pick a flight first.");
      res.status(201).json(await requestCall(emailOf(req), searchId, i));
    } catch (err) { send(res, err); }
  });

  /** Their call requests, newest first; a call that's under way is checked on the way out. */
  app.get("/api/travel/calls", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const rows = await db.select().from(travelCalls).where(eq(travelCalls.ownerEmail, emailOf(req))).orderBy(desc(travelCalls.createdAt)).limit(20);
      const fresh = await Promise.all(rows.map((c) => refresh(c).catch(() => c)));
      res.json({ calls: fresh.map(viewOf), callsLive: await callsLive() });
    } catch (err) { send(res, err); }
  });

  // ---- Admin: the gate, and the one test call -----------------------------------------------------------------
  app.get("/api/admin/travel", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    await schemaIsReady();
    await loadIds();
    const calls = await db.select().from(travelCalls).orderBy(desc(travelCalls.createdAt)).limit(30);
    const searches = await db.select({ id: travelSearches.id, cached: travelSearches.cached }).from(travelSearches).where(gte(travelSearches.createdAt, dayStart()));
    // Read-only look at ElevenAgents: whether the Agents key can read, and the numbers labelled for travel (the
    // workspace is shared, so others' numbers are only counted, never listed).
    let agents: { read: boolean | null; error: string; travelNumbers: { id: string; label: string; last4: string; provider: string; assigned: boolean }[]; otherNumbers: number } = { read: null, error: "", travelNumbers: [], otherNumbers: 0 };
    if (agentsKey()) {
      const r = await eleven("/v1/convai/phone-numbers").catch(() => null);
      if (!r) agents = { ...agents, read: false, error: "Couldn't reach ElevenLabs." };
      else if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: { message?: string } | string };
        agents = { ...agents, read: false, error: (typeof j.detail === "string" ? j.detail : j.detail?.message ?? `HTTP ${r.status}`).slice(0, 200) };
      } else {
        const list = ((await r.json().catch(() => [])) as { phone_number_id?: string; label?: string; provider?: string; phone_number?: string; assigned_agent?: unknown }[]) ?? [];
        const ours = list.filter((n) => /\btravel\b/i.test(n.label ?? ""));
        agents = {
          read: true,
          error: "",
          travelNumbers: ours.map((n) => ({ id: String(n.phone_number_id ?? ""), label: String(n.label ?? ""), last4: String(n.phone_number ?? "").replace(/\D/g, "").slice(-4), provider: String(n.provider ?? ""), assigned: !!n.assigned_agent })),
          otherNumbers: list.length - ours.length,
        };
      }
    }
    res.json({
      callsOn: await callsOn(),
      agents,
      testNumber: (await testNumber()) ? "set" : "",
      configured: { parallel: !!parallelKey(), agentsKey: !!agentsKey(), travelAgent: !!travelAgent(), travelPhone: !!travelPhone() },
      today: { searches: searches.length, paidSearches: searches.filter((s) => !s.cached).length },
      calls: calls.map((c) => ({ ...viewOf(c), who: c.ownerEmail.replace(/^(.).*@/, "$1***@"), durationSec: c.durationSec, calledNumber: c.calledNumber ? "set" : "" })),
    });
  });

  /**
   * One-time setup, after the Agents key is in and the Twilio number is imported in ElevenAgents: makes the travel
   * agent (if there isn't one) with the overrides it needs and a 25-minute cap (airline hold times), and picks the
   * imported number (the one labelled "travel", else the only one). Places no call. Body: { phoneId? } to choose.
   */
  app.post("/api/admin/travel/setup", requireAdmin, async (req, res) => {
    try {
      if (!agentsKey()) throw new HttpError(503, "ELEVENLABS_AGENTS_API_KEY isn't set.");
      await loadIds();
      let agent = travelAgent();
      if (!agent) {
        const r = await eleven("/v1/convai/agents/create", {
          method: "POST",
          body: JSON.stringify({
            name: "MilitaryVoices travel caller",
            conversation_config: {
              agent: {
                language: "en",
                first_message: "Hi, I'm an automated assistant calling on behalf of a traveler. I'm not booking today, just asking about a fare.",
                prompt: { prompt: "You are an automated phone assistant for MilitaryVoices.ai asking an airline about one fare. Each call brings its own instructions. Never give any personal detail, and never book, pay or agree to anything." },
              },
              conversation: { max_duration_seconds: 1500 },
            },
            platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true, prompt: { prompt: true } } } } },
          }),
        });
        const j = (await r.json().catch(() => ({}))) as { agent_id?: string; detail?: unknown };
        if (!r.ok || !j.agent_id) throw new HttpError(502, `ElevenLabs didn't make the agent (${r.status} ${JSON.stringify(j.detail ?? "").slice(0, 200)}).`);
        agent = j.agent_id;
        await storage.setSetting("travel:agent-id", agent);
      }
      const want = String(req.body?.phoneId ?? "").trim();
      let phone = want || travelPhone();
      const list = await eleven("/v1/convai/phone-numbers");
      const numbers = list.ok ? ((await list.json().catch(() => [])) as { phone_number_id?: string; label?: string; provider?: string; phone_number?: string }[]) : [];
      // The ElevenLabs workspace is shared with other projects' agents and numbers: pick ours by its label only.
      if (!phone) phone = numbers.find((n) => /\btravel\b/i.test(n.label ?? ""))?.phone_number_id ?? "";
      if (phone && !numbers.some((n) => n.phone_number_id === phone)) throw new HttpError(400, "That number isn't in ElevenAgents.");
      if (phone) await storage.setSetting("travel:phone-id", phone);
      await loadIds();
      res.json({
        agent: !!travelAgent(),
        phone: !!travelPhone(),
        // Only ours by name; the shared workspace's other numbers are only counted.
        number: numbers.filter((n) => n.phone_number_id === travelPhone()).map((n) => ({ id: n.phone_number_id, label: n.label, last4: String(n.phone_number ?? "").replace(/\D/g, "").slice(-4) }))[0] ?? null,
        otherNumbers: numbers.filter((n) => n.phone_number_id !== travelPhone()).length,
        ready: agentsReady(),
        callsOn: await callsOn(),
      });
    } catch (err) { send(res, err); }
  });

  /** Places one waiting call. Still refuses unless travel:calls is "on". */
  app.post("/api/admin/travel/calls/:id/place", requireAdmin, async (req, res) => {
    try {
      await schemaIsReady();
      res.json(viewOf(await placeCall(Number(req.params.id))));
    } catch (err) { send(res, err); }
  });

  /** Reads one call back from ElevenLabs now (and writes the report if it has ended), with the transcript. */
  app.get("/api/admin/travel/calls/:id", requireAdmin, async (req, res) => {
    try {
      await schemaIsReady();
      const [c] = await db.select().from(travelCalls).where(eq(travelCalls.id, Number(req.params.id))).limit(1);
      if (!c) throw new HttpError(404, "No such call.");
      const row = await refresh(c);
      res.json({ ...viewOf(row), transcript: row.transcript, durationSec: row.durationSec });
    } catch (err) { send(res, err); }
  });
}
