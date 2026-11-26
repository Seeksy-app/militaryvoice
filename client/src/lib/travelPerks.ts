import { MILITARY_CALL_DESKS, type TravelerStatus } from "@shared/militaryFares";

/**
 * The Travel page's helpers (26 Nov 2026). The perk itself comes from the server (perkFor in shared/militaryFares.ts,
 * attached to each result), so the research has one place to update; this only turns its short fields into one line
 * for a flight row (two tags and the true price), plus the airline's name, its own site and the desk phone.
 */
/** Engineering's perk fields (26 Nov), as perkFor returns them; null = the airline's own page doesn't say. */
export type BagFees = { first: number | null; second: number | null; note: string; source: string; verified: string };
export type Claim = { line: string; membership: "none" | "free" | "paid" | "either" };
export type Perk = {
  iata: string; airline: string; flying: boolean; fare: string; bags: string; phoneOnly: boolean;
  bookingUrl?: string; lastVerified?: string;
  /** Standard 1st/2nd checked-bag fees anyone pays, in USD. */
  bagFees?: BagFees | null;
  /** How this traveler claims it, already picked for the status searched. */
  claim?: Claim | null;
  /** What it combines with ("Not stated." when the airline doesn't say). */
  stacking?: string;
};
/** The membership badge on a claim: WeSalute is free, WeSalute+ is paid. */
export const membershipLabel = (m?: Claim["membership"]) => (m === "free" ? "Free WeSalute" : m === "paid" ? "Paid WeSalute+" : m === "either" ? "Free or paid WeSalute" : "");
const NAMES: Record<string, [string, string]> = {
  DL: ["Delta", "delta.com"], UA: ["United", "united.com"], AA: ["American", "aa.com"], AS: ["Alaska", "alaskaair.com"],
  HA: ["Hawaiian", "hawaiianairlines.com"], B6: ["JetBlue", "jetblue.com"], WN: ["Southwest", "southwest.com"],
  F9: ["Frontier", "flyfrontier.com"], G4: ["Allegiant", "allegiantair.com"], SY: ["Sun Country", "suncountry.com"],
  MX: ["Breeze", "flybreeze.com"], XP: ["Avelo", "aveloair.com"],
};
export const airlineSite = (iata: string) => NAMES[iata]?.[1];
export const airlineName = (iata: string, fallback: string) => NAMES[iata]?.[0] ?? fallback;

const NONE = /^(—|-|no|none|nothing)\b/i;
/** "2 free" → "2 free bags"; "Yes, 2 free with DD-214/VA ID" → "2 free bags with DD-214/VA ID". */
const bagsText = (b: string) => {
  const t = b.replace(/^yes,?\s*/i, "").trim();
  if (!t || NONE.test(t)) return "";
  if (/bag/i.test(t)) return t;
  if (/\bfree\b/i.test(t)) return t.replace(/\bfree\b/i, "free bags");
  return `Free bags, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
};
/**
 * The perk as two separate tags (Andrew, 26 Nov: a fare discount and a perk, never one mixed line). The fare tag is
 * only a real discount (a percentage); `phone` when the military fare is phone-only; else null = no discount. The
 * bag tag is the free bags; null = none. `freeBags` counts what the true price can take off (the low end of a range).
 */
export function perkTags(perk: Perk | null | undefined, status: TravelerStatus): { fare: string | null; phone: boolean; bags: string | null; freeBags: number; member: boolean } | null {
  if (!perk || !perk.flying) return null;
  const clean = (x: string) => x.replace(/\s*\((pages conflict|verify once)\)/gi, "").trim();
  const f = clean(perk.fare);
  const b = clean(perk.bags);
  const paid = (x: string) => x.replace(/(?<!paid )WeSalute\+/g, "paid WeSalute+");
  // "Have us call" is for active duty only; a veteran fare that books by phone or chat (JetBlue's WeSalute+) is still shown.
  const phone = perk.phoneOnly && status === "active";
  let fare: string | null = null;
  if (!phone && /\d+%/.test(f)) {
    const t = f.replace(/\s*\+\s*\d+\s*free bags/i, "").replace(/^(\d+%(?:\s*\/\s*\d+%)?)\s*/, "$1 off ");
    fare = paid(t.replace(/ off (free WeSalute)/, " off with $1").replace(/ \/ (\d+%) WeSalute\+/, ", $1 with WeSalute+")
      // "15% / 30% with WeSalute" (Avelo): the two tiers, free and paid.
      .replace(/^(\d+%)\s*\/\s*(\d+%) off with WeSalute$/, "$1 off with free WeSalute, $2 with WeSalute+")).replace(/\s+/g, " ").trim();
  }
  if (fare && perk.phoneOnly && !phone) fare += ", by phone or chat";
  const fromFare = Number(/(\d+)\s*free bags/i.exec(f)?.[1] ?? 0);
  let bags: string | null = null;
  let freeBags = 0;
  const t = b.replace(/^yes,?\s*/i, "").trim();
  if (t && !NONE.test(t)) {
    freeBags = Number(/(\d+)(?:\s*[–-]\s*\d+)?\s*free/i.exec(t)?.[1] ?? 0) || fromFare;
    let x = bagsText(b).replace("DD-214/VA ID", "DD-214 or VA ID");
    if (!/\d/.test(x) && freeBags) x = x.replace(/^Free bags,?\s*/i, `${freeBags} free bags `);
    bags = paid(x.charAt(0).toUpperCase() + x.slice(1)).replace(/\s+/g, " ").trim();
  }
  return { fare, phone, bags, freeBags, member: /WeSalute\+/.test(b) };
}

/**
 * Fare + the checked bags this traveler would pay for − the ones they get free. `total` is null when a fee they'd pay
 * isn't listed: the page says so rather than guess.
 */
export function truePrice(fare: number, perk: Perk | null | undefined, bags: number, status: TravelerStatus): { total: number | null; lines: { label: string; value: string; free?: boolean }[]; note: string } {
  const tags = perkTags(perk, status);
  const free = Math.min(bags, tags?.freeBags ?? 0);
  const lines: { label: string; value: string; free?: boolean }[] = [{ label: "Fare", value: `$${Math.round(fare).toLocaleString()}` }];
  if (free) lines.push({ label: free === 1 ? "1 checked bag" : `${free} checked bags`, value: tags?.member ? "Free with paid WeSalute+" : "Free", free: true });
  let total: number | null = fare;
  const fees = perk?.bagFees ?? null;
  for (let n = free + 1; n <= bags; n++) {
    const fee = n === 1 ? fees?.first : fees?.second;
    const label = n === 1 ? "1st bag" : "2nd bag";
    if (fee == null) { lines.push({ label, value: "Fee not listed" }); total = null; }
    else { lines.push({ label, value: `$${fee}` }); if (total != null) total += fee; }
  }
  const note = bags > free && fees ? [fees.note, fees.verified && `Checked ${checkedOn(fees.verified)}`].filter(Boolean).join(" · ") : "";
  return { total, lines, note };
}

/** "2026-11-25" → "Nov 25, 2026". */
export const checkedOn = (d?: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** The desk a creator rings themselves, as "800-325-1771", with its hours. */
export function deskOf(iata: string): { phone: string; tel: string; hours: string } | null {
  const d = MILITARY_CALL_DESKS[iata];
  if (!d) return null;
  const n = d.phone.replace(/\D/g, "").replace(/^1/, "");
  return { phone: `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`, tel: d.phone, hours: d.hours.replace("Mon–Fri", "M–F") };
}


/** US airports and metro codes for the From and To boxes (metro codes search every airport in the city). */
export const AIRPORTS: [string, string][] = [
  ["ATL", "Atlanta"], ["AUS", "Austin"], ["BNA", "Nashville"], ["BOS", "Boston"], ["BWI", "Baltimore"], ["CHI", "Chicago (all airports)"],
  ["ORD", "Chicago O'Hare"], ["MDW", "Chicago Midway"], ["CLT", "Charlotte"], ["CMH", "Columbus"], ["CVG", "Cincinnati"], ["DAL", "Dallas Love Field"],
  ["DFW", "Dallas/Fort Worth"], ["DCA", "Washington Reagan"], ["IAD", "Washington Dulles"], ["WAS", "Washington, DC (all airports)"], ["DEN", "Denver"],
  ["DTW", "Detroit"], ["ELP", "El Paso"], ["FAY", "Fayetteville / Fort Bragg"], ["FLL", "Fort Lauderdale"], ["HNL", "Honolulu"], ["HOU", "Houston Hobby"],
  ["IAH", "Houston Bush"], ["IND", "Indianapolis"], ["JAX", "Jacksonville"], ["LAS", "Las Vegas"], ["LAX", "Los Angeles"], ["MCI", "Kansas City"],
  ["MCO", "Orlando"], ["MIA", "Miami"], ["MKE", "Milwaukee"], ["MSP", "Minneapolis"], ["MSY", "New Orleans"], ["NYC", "New York (all airports)"],
  ["JFK", "New York JFK"], ["LGA", "New York LaGuardia"], ["EWR", "Newark"], ["OAK", "Oakland"], ["OKC", "Oklahoma City"], ["OMA", "Omaha"],
  ["ORF", "Norfolk"], ["PDX", "Portland, OR"], ["PHL", "Philadelphia"], ["PHX", "Phoenix"], ["PIE", "St. Pete–Clearwater"], ["PIT", "Pittsburgh"],
  ["RDU", "Raleigh-Durham"], ["RIC", "Richmond"], ["SAN", "San Diego"], ["SAT", "San Antonio"], ["SAV", "Savannah"], ["SEA", "Seattle"],
  ["SFO", "San Francisco"], ["SJC", "San Jose"], ["SLC", "Salt Lake City"], ["SMF", "Sacramento"], ["STL", "St. Louis"], ["TPA", "Tampa"],
  ["TUS", "Tucson"], ["ABQ", "Albuquerque"], ["ANC", "Anchorage"], ["BOI", "Boise"], ["BHM", "Birmingham"], ["CHS", "Charleston"],
  ["COS", "Colorado Springs"], ["GSP", "Greenville-Spartanburg"], ["ILM", "Wilmington, NC"], ["JAN", "Jackson"], ["LIT", "Little Rock"],
  ["MEM", "Memphis"], ["MYR", "Myrtle Beach"], ["PNS", "Pensacola"], ["RNO", "Reno"], ["SDF", "Louisville"], ["TUL", "Tulsa"],
  ["GRR", "Grand Rapids"], ["BUF", "Buffalo"], ["CLE", "Cleveland"], ["HVN", "New Haven"], ["ILG", "Wilmington, DE"], ["BUR", "Burbank"],
  ["SNA", "Orange County"], ["ONT", "Ontario, CA"], ["PSP", "Palm Springs"], ["SRQ", "Sarasota"], ["RSW", "Fort Myers"], ["PBI", "West Palm Beach"],
  ["ECP", "Panama City Beach"], ["VPS", "Destin / Fort Walton Beach"], ["KOA", "Kona"], ["OGG", "Maui"], ["GUM", "Guam"], ["SJU", "San Juan"],
];
export const airportName = (code: string) => AIRPORTS.find(([c]) => c === code)?.[1] ?? code;
