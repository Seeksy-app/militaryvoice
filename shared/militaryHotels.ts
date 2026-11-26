import type { TravelerStatus } from "./militaryFares.js";

/**
 * Military hotel rates by brand (Travel page, Andrew 26 Nov 2026: "Add hotels. Most hotels have mil discounts but have
 * to call"). Typed copy of the PM's research (exports/military-hotels/military-hotels.json; never import exports/).
 * Not booking advice: rates are set per property and change. The hotel search attaches the brand whose `match` names
 * appear in the property's name; "Have us call" rings the property (number from Parallel Places) or, failing that,
 * the brand's central reservations.
 */
export type HotelEligibility = "active_duty" | "reserve" | "national_guard" | "dependents" | "veterans" | "retirees" | "dod_civilians";
export type MilitaryHotel = {
  /** Our key for the brand family, e.g. "marriott". Stored on call rows, so never rename one. */
  key: string;
  brand: string;
  /** Names that identify a property as this brand, matched as whole words in the property's name ("Courtyard", "Residence Inn"). */
  match: string[];
  /** The military rate in a few words, e.g. "Varies by hotel, often 10–15% off". */
  rate: string;
  eligible: HotelEligibility[];
  veterans_note: string;
  how_to_book: string;
  /** The military rate is only quoted by phone (or at the desk), so "Have us call" helps. */
  phone_only: boolean;
  /** E.164, or "" when there isn't one we trust. */
  central_reservations_phone: string;
  id_needed: string;
  /** The rate code to type when the military rate books online ("" or absent when there isn't one). */
  rate_code?: string;
  /** A stay perk that comes with the rate (late checkout, upgrade, parking); "" or absent for none. */
  stay_perk?: string;
  restrictions: string;
  stacking: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  last_verified: string;
};

export const MILITARY_HOTELS_VERIFIED = "";
export const MILITARY_HOTELS: MilitaryHotel[] = [];

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** The brand a property belongs to, by the longest `match` name found as whole words in its name. */
export function hotelBrandOf(propertyName: string): MilitaryHotel | undefined {
  const n = norm(propertyName);
  let best: { h: MilitaryHotel; len: number } | undefined;
  for (const h of MILITARY_HOTELS) {
    for (const m of h.match) {
      const k = norm(m);
      if (k.trim() && n.includes(k) && (!best || k.length > best.len)) best = { h, len: k.length };
    }
  }
  return best?.h;
}
export const hotelByKey = (key: string) => MILITARY_HOTELS.find((h) => h.key === key);

/** Whether this traveler qualifies: "veteran" on the page means veteran or retiree; "active" means active duty, Guard or Reserve. */
export function hotelEligible(h: MilitaryHotel, status: TravelerStatus): boolean {
  const want: HotelEligibility[] = status === "active" ? ["active_duty", "reserve", "national_guard"] : ["veterans", "retirees"];
  return want.some((w) => h.eligible.includes(w));
}

/** What a traveler of this status gets at this brand, and whether only a call gets the rate. */
export function hotelPerkFor(h: MilitaryHotel, status: TravelerStatus) {
  const eligible = hotelEligible(h, status);
  return {
    key: h.key,
    brand: h.brand,
    eligible,
    rate: eligible ? h.rate : "",
    phoneOnly: eligible && h.phone_only,
    code: eligible ? (h.rate_code ?? "").trim() : "",
    stayPerk: eligible ? (h.stay_perk ?? "").trim() : "",
    /** The brand's central reservations, for travelers who ring themselves. */
    reservationsPhone: h.central_reservations_phone || null,
    howToBook: h.how_to_book,
    idNeeded: h.id_needed,
    restrictions: h.restrictions,
    stacking: h.stacking,
    veteransNote: h.veterans_note,
    confidence: h.confidence,
    lastVerified: h.last_verified,
  };
}
export type MilitaryHotelPerk = ReturnType<typeof hotelPerkFor>;
