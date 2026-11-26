import { MILITARY_CALL_DESKS, type TravelerStatus } from "@shared/militaryFares";

/**
 * The Travel page's helpers (26 Nov 2026). The perk itself comes from the server (perkFor in shared/militaryFares.ts,
 * attached to each result), so the research has one place to update; this only turns its short fields into one line
 * for a flight row, plus the airline's name, its own site and the desk phone.
 */
export type Perk = { iata: string; airline: string; flying: boolean; fare: string; bags: string; phoneOnly: boolean };
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
 * One line from the server's perk: the fare (left out when it's phone-only, which the row says on its own) and the
 * bags (left out when the fare already speaks of bags). `pct` is the first percentage, for "about $X".
 */
export function perkLine(perk: Perk | null | undefined): { text: string; pct?: number } | null {
  if (!perk || !perk.flying) return null;
  const fare = perk.phoneOnly || NONE.test(perk.fare.trim()) || /\(phone\)/i.test(perk.fare) ? "" : perk.fare.trim();
  const bags = /bag/i.test(fare) ? "" : bagsText(perk.bags);
  // Notes meant for us, not the traveler, come off.
  const text = [fare, bags].filter(Boolean).join(" · ").replace(/\s*\((pages conflict|verify once)\)/gi, "");
  if (!text) return null;
  const pct = fare ? Number(/(\d+(?:\.\d+)?)%/.exec(fare)?.[1]) || undefined : undefined;
  return { text: text.charAt(0).toUpperCase() + text.slice(1), pct };
}

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
