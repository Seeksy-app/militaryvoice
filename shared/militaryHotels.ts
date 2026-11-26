import type { TravelerStatus } from "./militaryFares.js";

/**
 * Military hotel rates by brand, and military lodging (Travel page, Andrew 26 Nov 2026: "Add hotels. Most hotels have
 * mil discounts but have to call"). Typed copy of the PM's research, read from each brand's own pages on 2026-11-26
 * (exports/military-hotels/military-hotels.json; never import exports/). Third-party sources are marked "(third-party)"
 * in `sources`; gaps say "Not stated" or "couldn't verify", never a guess. Not booking advice: rates are set per hotel.
 *
 * The hotel search attaches the brand whose `match` names appear (as whole words) in the property's name, after
 * `match_exclude` rules a name out; `match_start` names must begin the name ("Hilton Chicago", never "Hilton Head").
 * PM's rules (26 Nov): the rate and "Have us call" follow `eligible` for the traveler's status; an empty `eligible`
 * (MGM, Studio 6) shows "Ask the hotel", never a rate; low confidence gets a quieter "Reported; confirm with the hotel"
 * with its source; codes from third-party sources say so; no central number means we only ring the hotel's own line.
 */
export type HotelEligibility = "active_duty" | "guard_reserve" | "veterans" | "retirees" | "dependents" | "dod_civilians";
export type Membership = "none" | "free" | "paid" | "either";
export type MilitaryHotel = {
  /** Our key for the brand family. Stored on call rows, so never rename one. */
  key: string;
  brand: string;
  kind: string;
  /** Distinctive names that identify a property as this brand, matched as whole words in its name. */
  match: string[];
  /** Names that rule a property out first ("Hilton Head", "Holiday Inn Club Vacations"). */
  match_exclude: string[];
  /** Names that must start the property's name ("Hilton " for "Hilton Chicago"). */
  match_start?: string[];
  /** The military rate in a few words, e.g. "15% or more off Standard Rate", "varies by hotel". */
  rate: string;
  /** Empty = the brand doesn't say who qualifies: show "Ask the hotel", never a rate. */
  eligible: HotelEligibility[];
  veterans_note: string;
  how_to_book: string;
  /** The military rate is only quoted by phone (or at the desk). */
  phone_only: boolean;
  /** E.164, or "" when the pages didn't give one (then calls ring only the hotel's own line). */
  central_reservations_phone: string;
  id_needed: string;
  /** The rate code to type online ("" for none). */
  rate_code: string;
  /** A military-only stay perk the brand publishes ("" for none). */
  stay_perk: string;
  /** How to claim it, one short line (written from how_to_book). */
  claim: string;
  /** What to say when this status doesn't qualify, instead of a flat "none" (Marriott for veterans). */
  none_line?: string;
  membership: Membership;
  /** The code comes from third-party sites, not the brand's own page (Hyatt MILVET, Great Wolf HEROES). */
  code_third_party: boolean;
  restrictions: string;
  stacking: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  last_verified: string;
};

export const MILITARY_HOTELS_VERIFIED = "2026-11-26";
export const MILITARY_HOTELS: MilitaryHotel[] = [
  {
    "key": "marriott",
    "brand": "Marriott Bonvoy (Government & Military rate)",
    "kind": "chain",
    "match": [
      "JW Marriott",
      "Ritz-Carlton",
      "St. Regis",
      "The Luxury Collection",
      "W Hotel",
      "Marriott Hotel",
      "Marriott Marquis",
      "Marriott Resort",
      "Sheraton",
      "Westin",
      "Le Meridien",
      "Le Méridien",
      "Renaissance Hotel",
      "Autograph Collection",
      "Tribute Portfolio",
      "Delta Hotels",
      "Gaylord Opryland",
      "Gaylord Palms",
      "Gaylord Texan",
      "Gaylord National",
      "Gaylord Rockies",
      "Gaylord Pacific",
      "Courtyard by Marriott",
      "Four Points by Sheraton",
      "SpringHill Suites",
      "Fairfield Inn",
      "Fairfield by Marriott",
      "AC Hotel",
      "Aloft",
      "Moxy",
      "Residence Inn",
      "TownePlace Suites",
      "Element by Westin",
      "City Express by Marriott",
      "StudioRes",
      "Design Hotels"
    ],
    "match_exclude": [
      "Marriott Vacation Club",
      "Sheraton Vacation Club",
      "Westin Vacation Club"
    ],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty"
    ],
    "veterans_note": "Not stated. Marriott's help article names only active-duty members (plus government employees with government ID). It does not say veterans, retirees or dependents qualify. Some hotels' Rate Details may allow more; check per hotel.",
    "how_to_book": "Online: on marriott.com pick 'Government & Military' in the Special Rates menu, then read 'Rate Details' for that hotel. In the app, tick 'Government & Military' or type code GOV.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Active-duty government or military ID at check-in (CAC, travel orders or a government travel card are also listed as qualifying documents).",
    "rate_code": "GOV",
    "stay_perk": "",
    "none_line": "No published veteran rate. Retirees can ask the hotel whether they qualify for Government & Military.",
    "claim": "Pick 'Government & Military' on marriott.com, or code GOV in the app",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Subject to availability; eligibility is set per hotel in 'Rate Details'. No published percentage. No military stay perk stated. The separate 15% 'Military & First Responder' rate page (deals.marriott.com/militaryfirstresponderrate) now redirects to the Marriott home page, so treat it as gone. Central phone not stated on the pages read.",
    "stacking": "Not stated.",
    "sources": [
      "https://help.marriott.com/s/article/marriott-government-rates-eligibility",
      "https://www.marriott.com (Special Rates menu shows 'Government & Military', checked 2026-11-26)"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "hilton",
    "brand": "Hilton (Military Family Rate)",
    "kind": "chain",
    "match": [
      "Waldorf Astoria",
      "Conrad Hotel",
      "Conrad Hotels",
      "LXR Hotels",
      "Signia by Hilton",
      "Hilton Hotel",
      "Hilton Resort",
      "by Hilton",
      "Curio Collection",
      "Tapestry Collection",
      "Canopy by Hilton",
      "Motto by Hilton",
      "Graduate by Hilton",
      "DoubleTree",
      "Embassy Suites",
      "Hilton Garden Inn",
      "Hampton Inn",
      "Homewood Suites",
      "Home2 Suites",
      "Tru by Hilton",
      "Spark by Hilton",
      "LivSmart Studios"
    ],
    "match_exclude": [
      "Hilton Head"
    ],
    "match_start": [
      "Hilton "
    ],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Partly. The offer page says 'retired Veterans' and their families; reserve and retired members are covered. Veterans who did not retire are not named, so treat them as not eligible unless the hotel says so.",
    "how_to_book": "Call 1-800-HONORS and ask for the 'Military Family Rate' (the offer page's booking route). Hilton's Government & Military page also links 'Check Family Rates' online.",
    "phone_only": false,
    "central_reservations_phone": "+18004458667",
    "id_needed": "Current, valid U.S. or Canadian military ID at check-in.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Book online under Family Rates, or call 1-800-HONORS and ask for the Military Family Rate.",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Leisure stays only, not official travel (official travel uses the separate government per diem rate). Participating hotels only; blackout dates, deposit, cancellation and early-departure rules may apply. Not for existing reservations or groups. No military stay perk stated. Full-service 'Hilton <City>' names need a starts-with rule, and never match 'Hilton Head'.",
    "stacking": "Cannot be combined with other select promotions, discounts or offers.",
    "sources": [
      "https://www.hilton.com/en/offers/military-rate-2000000074/",
      "https://hilton.com/en/p/government-military-rates"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "ihg",
    "brand": "IHG Hotels & Resorts (Government/Military rate)",
    "kind": "chain",
    "match": [
      "InterContinental",
      "Kimpton",
      "Regent Hotel",
      "Six Senses",
      "Vignette Collection",
      "voco",
      "Hotel Indigo",
      "Crowne Plaza",
      "EVEN Hotel",
      "Holiday Inn",
      "Holiday Inn Express",
      "Holiday Inn Resort",
      "Staybridge Suites",
      "Candlewood Suites",
      "avid hotel",
      "Atwell Suites",
      "Garner Hotel",
      "Iberostar Beachfront",
      "Noted Collection"
    ],
    "match_exclude": [
      "Holiday Inn Club Vacations"
    ],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans",
      "retirees"
    ],
    "veterans_note": "Yes. IHG's help page says the rate is for 'active duty, veteran, or retired military personnel', for official or leisure travel depending on the hotel's policy.",
    "how_to_book": "Online: on ihg.com or the IHG One Rewards app choose 'Government/Military' in the Rate Preference menu. No code needed.",
    "phone_only": false,
    "central_reservations_phone": "+18778343613",
    "id_needed": "Valid government or military ID, or official travel orders. Without it the hotel charges its Best Flexible Rate.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Pick 'Government/Military' in the rate menu on ihg.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Availability, discount and leisure use vary by hotel. Direct IHG channels only, not third-party sites. Dependents not stated. No military stay perk stated. IHG Army Hotels on post are a separate entry.",
    "stacking": "Not stated. Most government/military rates earn IHG One Rewards points and elite night credits (shown at booking).",
    "sources": [
      "https://www.ihg.com/content/us/en/customer-care/main/planning/corporate-negotiated-rate"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "hyatt",
    "brand": "Hyatt (Veteran and Military Rate)",
    "kind": "chain",
    "match": [
      "Park Hyatt",
      "Grand Hyatt",
      "Hyatt Regency",
      "Hyatt Centric",
      "Hyatt Place",
      "Hyatt House",
      "Hyatt Studios",
      "Hyatt Select",
      "Caption by Hyatt",
      "Destination by Hyatt",
      "Unbound Collection by Hyatt",
      "JdV by Hyatt",
      "Andaz",
      "Alila",
      "Thompson Hotel",
      "Hyatt"
    ],
    "match_exclude": [
      "Hyatt Vacation Club",
      "Hyatt Ziva",
      "Hyatt Zilara"
    ],
    "rate": "10-15% off standard rate",
    "eligible": [
      "active_duty",
      "veterans",
      "dependents"
    ],
    "veterans_note": "Yes, per Hyatt's own page as shown in search results: 'U.S. veterans, active-duty armed service members and their immediate family members' at participating U.S. hotels. The page could not be opened directly (it blocks automated reading), so this is medium confidence.",
    "how_to_book": "Online on hyatt.com with the Special Offer Code. Code MILVET comes from third-party guides; Hyatt's page itself could not be read.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Third-party reprints of the terms: valid veteran/military ID, DD-214 or other documented proof of service at check-in.",
    "rate_code": "MILVET",
    "stay_perk": "",
    "claim": "Code MILVET on hyatt.com (the code comes from third-party guides)",
    "membership": "none",
    "code_third_party": true,
    "restrictions": "Participating U.S. hotels only. Third-party reports (2018 launch) say up to 2 rooms per stay. Code and ID rules come from third-party sources, not a page read today. No military stay perk stated. Central phone not stated on pages read. Hyatt Inclusive Collection resorts run a separate up-to-7% military offer (third-party), not included here.",
    "stacking": "Not stated. Third-party guides say the stay earns World of Hyatt points.",
    "sources": [
      "https://www.hyatt.com/info/veterans (blocked to automated reading; text seen in search index)",
      "https://onemileatatime.com/hyatt-military-veteran-rate/ (third-party)",
      "https://www.franchising.com/news/20181029_hyatt_announces_new_initiatives_to_elevate_support.html (third-party, 2018)"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "wyndham",
    "brand": "Wyndham Hotels & Resorts (Military discount)",
    "kind": "chain",
    "match": [
      "Wyndham",
      "Wyndham Grand",
      "Wyndham Garden",
      "Dolce Hotels",
      "Registry Collection",
      "Trademark Collection",
      "TRYP by Wyndham",
      "Wingate by Wyndham",
      "Hawthorn Suites",
      "WaterWalk",
      "ECHO Suites",
      "AmericInn",
      "Baymont",
      "Days Inn",
      "Dazzler",
      "Howard Johnson",
      "Microtel",
      "Ramada",
      "Super 8",
      "Travelodge"
    ],
    "match_exclude": [
      "Caesars",
      "Wyndham Destinations",
      "Club Wyndham",
      "WorldMark"
    ],
    "rate": "15% or more off Standard Rate",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Yes. 'Members of the United States or Canadian military with active, reserve, veteran or retired status' and/or their spouses.",
    "how_to_book": "Online with rate code SML (wyndhamhotels.com, app) or call the military priority line.",
    "phone_only": false,
    "central_reservations_phone": "+18554645739",
    "id_needed": "Valid military identification at check-in.",
    "rate_code": "SML",
    "stay_perk": "Instant Wyndham Rewards Gold status after confirming military status",
    "claim": "Code SML on wyndhamhotels.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Participating U.S. and Canada hotels. New bookings only, no groups; credit card to hold; cancel by 4 p.m. local time on arrival day; blackout dates and room-type exclusions vary by hotel; subject to availability. Excludes Caesars co-branded Trademark hotels and HotelREZ-operated Registry/Trademark hotels. No points at ECHO Suites.",
    "stacking": "Cannot be combined with any other special rates, discounts, coupons, promotions or offers. The separate military bonus (3,000 points for a stay booked Oct 20-Dec 7, 2026 and completed by Dec 31, 2026) combines only with registration-based bonus-point promotions.",
    "sources": [
      "https://www.wyndhamhotels.com/wyndham-rewards/military"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "la-quinta",
    "brand": "La Quinta by Wyndham (Military discount)",
    "kind": "chain",
    "match": [
      "La Quinta"
    ],
    "match_exclude": [],
    "rate": "15% or more off Standard Rate",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Yes. 'Members of the United States or Canadian military with active, reserve, veteran or retired status' and/or their spouses.",
    "how_to_book": "Online with rate code SML (wyndhamhotels.com, app) or call the military priority line.",
    "phone_only": false,
    "central_reservations_phone": "+18554645739",
    "id_needed": "Valid military identification at check-in.",
    "rate_code": "SML",
    "stay_perk": "Instant Wyndham Rewards Gold status after confirming military status",
    "claim": "Code SML on wyndhamhotels.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Same Wyndham military terms (La Quinta is on Wyndham's participating list). New bookings only, no groups; credit card to hold; blackout dates and room-type exclusions may apply; subject to availability. A third-party listing still shows an older 12%, but La Quinta's own page says at least 15%.",
    "stacking": "Cannot be combined with any other special rates, discounts, coupons, promotions or offers. The separate military bonus (3,000 points for a stay booked Oct 20-Dec 7, 2026 and completed by Dec 31, 2026) combines only with registration-based bonus-point promotions.",
    "sources": [
      "https://www.wyndhamhotels.com/en-uk/laquinta/hotel-deals/military",
      "https://www.wyndhamhotels.com/wyndham-rewards/military"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "choice",
    "brand": "Choice Hotels (Military/Veterans Leisure rate)",
    "kind": "chain",
    "match": [
      "Comfort Inn",
      "Comfort Suites",
      "Quality Inn",
      "Quality Suites",
      "Sleep Inn",
      "Clarion",
      "Clarion Pointe",
      "Cambria Hotel",
      "Ascend Hotel Collection",
      "Ascend Collection",
      "MainStay Suites",
      "Suburban Studios",
      "WoodSpring Suites",
      "Everhome Suites",
      "Econo Lodge",
      "Rodeway Inn"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Yes. 'Military personnel, veterans, their dependents and members of several government/military oriented associations' get the leisure rate.",
    "how_to_book": "Online: choose 'Military/Veterans (Leisure)' in the Rate menu on choicehotels.com. You must be a Choice Privileges member (free). Official travel uses 'Government/Military (Official Business Travel)', plan code SGM.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Not stated on the page. The eligible person must occupy the room.",
    "rate_code": "",
    "stay_perk": "Limited-time Gold Elite status when you add military status to a Choice Privileges account",
    "claim": "Join Choice Privileges free, then pick 'Military/Veterans (Leisure)'",
    "membership": "free",
    "code_third_party": false,
    "restrictions": "Choice Privileges membership required; subject to availability; participating hotels. No percentage published on the page (2021 press release: up to 12%; third-party flyer reports up to 20%; not verified today). Central phone not stated on pages read.",
    "stacking": "Not stated. Earns Choice Privileges points or airline rewards.",
    "sources": [
      "https://www.choicehotels.com/deals/government-and-military-rates",
      "https://www.choicehotels.com/choice-privileges/cp-military",
      "https://media.choicehotels.com/2021-10-08-Choice-Privileges-Launches-New-Leisure-Benefit-For-Military-Members"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "radisson",
    "brand": "Radisson (U.S. brands, booked through Choice Hotels)",
    "kind": "chain",
    "match": [
      "Radisson",
      "Radisson Blu",
      "Radisson RED",
      "Radisson Individuals",
      "Radisson Collection",
      "Radisson Inn & Suites",
      "Country Inn & Suites",
      "Park Inn by Radisson"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Likely yes, through Choice's Military/Veterans (Leisure) rate. Radisson Americas brands are Choice brands bookable on choicehotels.com since 2023. radissonhotels.com itself shows no military rate.",
    "how_to_book": "Online on choicehotels.com with the 'Military/Veterans (Leisure)' rate (Choice Privileges member).",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Not stated.",
    "rate_code": "",
    "stay_perk": "Limited-time Choice Privileges Gold Elite status (Choice program)",
    "claim": "Join Choice Privileges free, then pick 'Military/Veterans (Leisure)' on choicehotels.com",
    "membership": "free",
    "code_third_party": false,
    "restrictions": "U.S./Americas Radisson hotels only. Radisson hotels outside the Americas belong to Radisson Hotel Group and are not covered. Whether every Radisson-brand hotel takes the Choice military rate was not confirmed hotel by hotel. No percentage published. A third-party WeSalute+ (paid) offer of up to 15% exists (not verified today).",
    "stacking": "Not stated.",
    "sources": [
      "https://www.choicehotels.com/about/brands",
      "https://www.choicehotels.com/deals/government-and-military-rates",
      "https://www.hospitalitynet.org/news/4117500.html (third-party: 2023 integration news)"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "best-western",
    "brand": "Best Western Hotels & Resorts (Government/Military rate)",
    "kind": "chain",
    "match": [
      "Best Western",
      "Best Western Plus",
      "Best Western Premier",
      "Executive Residency by Best Western",
      "Aiden by Best Western",
      "Sadie Best Western",
      "Vib Best Western",
      "GLo Best Western",
      "SureStay",
      "WorldHotels"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans",
      "dod_civilians"
    ],
    "veterans_note": "Yes, per Best Western's page as quoted in search results: 'military personnel and civilian military personnel including veterans'. The page blocks automated reading and search data dates it as old, so medium confidence.",
    "how_to_book": "Online: pick 'Government/Military' in the Rates menu on bestwestern.com.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Official identification card or work orders at check-in (per the brand page as quoted in search results).",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Pick 'Government/Military' on bestwestern.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Rate varies by participating hotel; no percentage published (third-party guides say about 10%). Retirees and dependents are not named. SureStay and WorldHotels coverage not stated. No military stay perk stated. Central phone not stated on pages read.",
    "stacking": "Not stated.",
    "sources": [
      "https://www.bestwestern.com/en_US/offers/hotel-discounts/military-discounts.html (blocked to automated reading; text seen in search index)",
      "https://upgradedpoints.com/travel/hotels/military-hotel-discounts/ (third-party)"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "omni",
    "brand": "Omni Hotels & Resorts (Government and Military rates)",
    "kind": "chain",
    "match": [
      "Omni Hotel",
      "Omni Resort",
      "Omni Hotels & Resorts",
      "Omni "
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans",
      "retirees"
    ],
    "veterans_note": "Yes, if they can show a Veteran ID card: 'Military members (active, retired or able to present Veteran ID card)'. This is the federal per diem government rate.",
    "how_to_book": "Online through each Omni hotel's 'Government and Military Rates' offer page (the offer applies in the booking box).",
    "phone_only": false,
    "central_reservations_phone": "+18884446664",
    "id_needed": "Valid ID at check-in; veterans need a Veteran ID card.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Book the hotel's 'Government and Military Rates' offer; veterans need a Veteran ID card",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Federal government per diem rates, based on availability. Maximum 2 rooms per eligible person. Some Omni pages also mention a separate 15% leisure discount for verified GovX members (third-party, not verified today). Phone number comes from Omni property pages via search. No military stay perk stated.",
    "stacking": "Not stated on the Dallas page; other Omni pages say not combinable with other savings and not for groups or conventions.",
    "sources": [
      "https://www.omnihotels.com/hotels/dallas/specials/government-rates"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "red-roof",
    "brand": "Red Roof (Government/Military rate)",
    "kind": "chain",
    "match": [
      "Red Roof Inn",
      "Red Roof PLUS",
      "Red Roof"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans"
    ],
    "veterans_note": "Yes. The page offers the discount to 'active-duty military personnel and veterans'.",
    "how_to_book": "Online: select 'Government/Military' in the rate plan menu on redroof.com, or call.",
    "phone_only": false,
    "central_reservations_phone": "+18007337663",
    "id_needed": "Not stated on the page (third-party: military or veteran ID).",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Pick 'Government/Military' on redroof.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "The page's only stated percentage is a Veterans Day promotion (up to 15%, Oct 13-Nov 13, 2025) that has ended; the page has not been updated. The year-round percentage is not stated (Red Roof sponsored content says typically 10%). A separate WeSalute (paid) 15% offer exists (not verified today). No military stay perk stated.",
    "stacking": "The promotion 'may not be combined with any other discount or offer'.",
    "sources": [
      "https://www.redroof.com/deals/national-deals/government-and-military",
      "https://taskandpurpose.com/sponsored-content/red-roof-is-the-premier-military-lodging-partner/ (sponsored, third-party)"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "motel-6",
    "brand": "Motel 6 (G6 Hospitality military discount)",
    "kind": "chain",
    "match": [
      "Motel 6"
    ],
    "match_exclude": [],
    "rate": "up to 10% off best available rate",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Yes. Veterans are named, with veteran ID card or DD-214 accepted. American Legion members also qualify.",
    "how_to_book": "Online: select the military rate at checkout on motel6.com or the My6 app.",
    "phone_only": false,
    "central_reservations_phone": "+18008999841",
    "id_needed": "Active-duty ID, veteran ID card, DD Form 214, retired military ID, or American Legion card at check-in.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Pick the military rate at checkout on motel6.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Participating locations in the U.S. and Canada. Spouses and dependents qualify when traveling with the eligible member. The old URL motel6.com/en/military-discount.html now 404s; current page is /deals/military-discount-5933/. No military stay perk stated (pets stay free is for everyone).",
    "stacking": "Not stated.",
    "sources": [
      "https://www.motel6.com/deals/military-discount-5933/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "studio-6",
    "brand": "Studio 6 (G6 Hospitality)",
    "kind": "chain",
    "match": [
      "Studio 6"
    ],
    "match_exclude": [],
    "rate": "couldn't verify",
    "eligible": [],
    "veterans_note": "Couldn't verify. The Motel 6 military page does not name Studio 6.",
    "how_to_book": "Ask at the front desk or call; online military rate for Studio 6 not confirmed.",
    "phone_only": true,
    "central_reservations_phone": "+18008999841",
    "id_needed": "Not stated.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Ask the front desk; a military rate isn't confirmed",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Not stated. Listed so Studio 6 hotels are not wrongly given the Motel 6 rate.",
    "stacking": "Not stated.",
    "sources": [
      "https://www.motel6.com/deals/military-discount-5933/",
      "https://www.motel6.com/"
    ],
    "confidence": "low",
    "last_verified": "2026-11-26"
  },
  {
    "key": "sonesta",
    "brand": "Sonesta (Veteran and military discount)",
    "kind": "chain",
    "match": [
      "Sonesta",
      "Royal Sonesta",
      "Sonesta Select",
      "Sonesta ES Suites",
      "Sonesta Simply Suites"
    ],
    "match_exclude": [],
    "rate": "15%",
    "eligible": [
      "active_duty",
      "retirees"
    ],
    "veterans_note": "Not clearly. The page text says 'Active duty and retired military personnel'; it calls it a 'veteran and military discount' but does not say non-retired veterans qualify.",
    "how_to_book": "Not stated on the page. Ask the hotel or call.",
    "phone_only": true,
    "central_reservations_phone": "",
    "id_needed": "Not stated.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Call the hotel and ask for the military rate",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Participating U.S. and Canada hotels. Booking method, ID, restrictions and which Sonesta brands participate are not stated. Phone not stated on the page. No military stay perk stated.",
    "stacking": "Not stated.",
    "sources": [
      "https://www.sonesta.com/military-discount-hotels"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "extended-stay",
    "brand": "Extended Stay America (Government & Military rate)",
    "kind": "chain",
    "match": [
      "Extended Stay America"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans",
      "dod_civilians"
    ],
    "veterans_note": "Yes. Terms say 'Available to U.S. federal government employees, military personnel and veterans.'",
    "how_to_book": "Online: select 'Government & Military' in the Special Rate menu on extendedstayamerica.com.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Valid identification at check-in, or the rate goes up to best available rate.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Pick 'Government & Military' on extendedstayamerica.com",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "All three ESA brands, 650+ locations. No percentage published. For official travel of 31+ consecutive nights ESA honors the DoD Flat Rate Policy (at or below 75% of per diem, based on availability). Phone not found on the page. No military stay perk stated (free breakfast and weekly housekeeping are for all guests at some brands).",
    "stacking": "Not stated.",
    "sources": [
      "https://www.extendedstayamerica.com/special-offers/military-government-rates"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "drury",
    "brand": "Drury Hotels (Government and military rates)",
    "kind": "chain",
    "match": [
      "Drury Inn",
      "Drury Plaza",
      "Drury Suites",
      "Drury Hotel",
      "Pear Tree Inn"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans",
      "retirees"
    ],
    "veterans_note": "Yes, with a Veteran ID card: 'military members (active, retired or able to present Veteran ID card)'.",
    "how_to_book": "Not spelled out: the page says use the hotel search for rates; no military rate option is named. Call 800-DRURYINN to ask.",
    "phone_only": true,
    "central_reservations_phone": "+18003787946",
    "id_needed": "Valid government identification at check-in.",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Call 800-DRURYINN and ask for the government rate",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Government per diem rates ('Government travelers and military personnel receive per diem rates'). 10+ rooms go through government sales. No leisure military discount stated on Drury's own page (a coupon site claims 10%; not verified). No military stay perk stated.",
    "stacking": "Not stated.",
    "sources": [
      "https://www.druryhotels.com/government"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "loews",
    "brand": "Loews Hotels (property offers only)",
    "kind": "chain",
    "match": [
      "Loews"
    ],
    "match_exclude": [],
    "rate": "varies by hotel",
    "eligible": [
      "active_duty",
      "veterans"
    ],
    "veterans_note": "At Loews Coronado Bay Resort, yes ('active duty, veterans'). No chain-wide Loews military rate was found.",
    "how_to_book": "Ask the hotel or call; offers are per property.",
    "phone_only": true,
    "central_reservations_phone": "",
    "id_needed": "Valid ID at check-in (Coronado Bay offer).",
    "rate_code": "",
    "stay_perk": "$20 discounted self-parking (Loews Coronado Bay Resort only)",
    "claim": "Ask the hotel; offers vary by property",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Only the Coronado Bay Resort offer was verified: up to 15% off Loews Best Flexible Rate. No chain-wide program. Validity dates not stated; rates can change without notice. Central phone not stated.",
    "stacking": "Not stated.",
    "sources": [
      "https://www.loewshotels.com/coronado-bay-resort/specials/military-appreciation-offer"
    ],
    "confidence": "low",
    "last_verified": "2026-11-26"
  },
  {
    "key": "mgm",
    "brand": "MGM Resorts (Military/First Responders/Nurses Discount)",
    "kind": "casino_resort",
    "match": [
      "Bellagio",
      "ARIA Resort",
      "Vdara",
      "MGM Grand",
      "Signature at MGM Grand",
      "Mandalay Bay",
      "Park MGM",
      "NoMad Las Vegas",
      "New York-New York",
      "Luxor Hotel",
      "Luxor Las Vegas",
      "Excalibur Hotel",
      "Cosmopolitan of Las Vegas",
      "Borgata",
      "Beau Rivage Resort",
      "MGM National Harbor",
      "MGM Springfield",
      "MGM Northfield",
      "Empire City Casino"
    ],
    "match_exclude": [],
    "rate": "up to 40% off room rates",
    "eligible": [],
    "veterans_note": "Couldn't verify. MGM's offers page lists the discount but shows no eligibility details. Older MGM program coverage (2017-2020, third-party) included veterans and spouses.",
    "how_to_book": "Online through the offer on mgmresorts.com/offers (offer details panel gives no code).",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Not stated (third-party: government ID, DD-214 or spouse ID).",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Ask the hotel; MGM doesn't publish who qualifies",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Eligibility, participating resorts, ID and terms were not visible on the offers page. Older code ZMILTRT (MOAA, 2020) is stale and not used. Resort match list is MGM's portfolio, not a confirmed participation list. Central phone not stated.",
    "stacking": "Not stated.",
    "sources": [
      "https://www.mgmresorts.com/offers/",
      "https://www.moaa.org/content/publications-and-media/news-articles/2020-news-articles/stay,-play,-and-save-in-las-vegas/ (third-party, 2020)"
    ],
    "confidence": "low",
    "last_verified": "2026-11-26"
  },
  {
    "key": "caesars",
    "brand": "Caesars Entertainment (military hotel discount via ID.me)",
    "kind": "casino_resort",
    "match": [
      "Caesars Palace",
      "Flamingo Las Vegas",
      "Harrah's",
      "Horseshoe Casino",
      "Horseshoe Las Vegas",
      "Horseshoe Hotel",
      "Nobu Hotel Las Vegas",
      "Paris Las Vegas",
      "Planet Hollywood",
      "Vanderpump Hotel",
      "The LINQ",
      "Tropicana Atlantic City",
      "Tropicana Laughlin",
      "Eldorado Resort",
      "Silver Legacy",
      "Circus Circus Reno",
      "Caesars Atlantic City",
      "Caesars Republic"
    ],
    "match_exclude": [],
    "rate": "up to 25% off lowest available rate",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Yes. Active duty, veterans, spouses and dependents, Guard, Reserves, retirees and surviving spouses (U.S. and Canada), verified through ID.me.",
    "how_to_book": "Online: verify with ID.me in the Discount Codes section on caesars.com, then book.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "ID.me military verification at booking; check-in ID not stated. Must be 21+.",
    "rate_code": "",
    "stay_perk": "Caesars Rewards Salute card (sign up in person): automatic Platinum status, with free self and valet parking at many destinations",
    "claim": "Verify with ID.me on caesars.com, then book",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Room rate only; select room types; limited availability; blackout dates apply; Caesars Rewards participating U.S. hotels. Not with Caesars Rewards member offers, packages or add-on promotions. Central phone not stated.",
    "stacking": "Not with Caesars Rewards loyalty offers, room packages, or promotions with show tickets, food or resort credits.",
    "sources": [
      "https://www.caesars.com/deals/military-discounts",
      "https://www.caesars.com/myrewards/promotions/caesars-rewards-salute-card"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "great-wolf",
    "brand": "Great Wolf Lodge (Howling Heroes)",
    "kind": "resort",
    "match": [
      "Great Wolf Lodge"
    ],
    "match_exclude": [],
    "rate": "varies by lodge and date",
    "eligible": [
      "active_duty",
      "veterans",
      "retirees"
    ],
    "veterans_note": "Third-party sources say active duty, retirees and veterans qualify. Great Wolf's own page only says 'first responders, including military'.",
    "how_to_book": "Online from the Howling Heroes page on greatwolf.com; code HEROES per third-party sources.",
    "phone_only": false,
    "central_reservations_phone": "",
    "id_needed": "Verification at booking; staff may ask for ID at check-in (third-party).",
    "rate_code": "HEROES",
    "stay_perk": "",
    "claim": "Code HEROES on greatwolf.com (the code comes from third-party sites)",
    "membership": "none",
    "code_third_party": true,
    "restrictions": "Room rate only; select dates and lodges; one guest 21+ per room. Percentage not on the brand page (third-party claims 25-40%). Code and eligibility from third-party sources. Central phone not stated.",
    "stacking": "Third-party: cannot be combined with other promotions or codes.",
    "sources": [
      "https://www.greatwolf.com/deals/heroes",
      "https://themilitarywallet.com/great-wolf-lodges-military-discount/ (third-party)"
    ],
    "confidence": "low",
    "last_verified": "2026-11-26"
  },
  {
    "key": "disney",
    "brand": "Walt Disney World resort hotels (Military Salute room discount)",
    "kind": "resort",
    "match": [
      "Disney's",
      "Walt Disney World Swan",
      "Walt Disney World Dolphin"
    ],
    "match_exclude": [],
    "rate": "varies by resort and date",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Couldn't verify on Disney's site. Third-party sources say non-retired veterans do not qualify (100% disabled veterans possibly).",
    "how_to_book": "Call Disney resort reservations or book through a base ticket office (third-party).",
    "phone_only": true,
    "central_reservations_phone": "+14079395277",
    "id_needed": "Valid military ID at check-in; the military member or spouse must stay in the room (third-party).",
    "rate_code": "",
    "stay_perk": "",
    "claim": "Call Disney at 407-939-5277 for the Military Salute rate",
    "membership": "none",
    "code_third_party": false,
    "restrictions": "Disney's military room offer page could not be found (404). Third-party: renewed through 2026, 'up to' discounts that shrink as rooms sell, blackout dates including Nov 22-28 and Dec 19-31, 2026. Swan and Dolphin are Marriott-run and may not take the Disney offer; matched here only so they are not missed. Not combinable with Shades of Green.",
    "stacking": "Not stated.",
    "sources": [
      "https://disneyworld.disney.go.com/ (phone from site footer)",
      "https://www.militarydisneytips.com/blog/disney-military-discounts/how-disney-armed-forces-salute-room-discounts-work/ (third-party)",
      "https://touringplans.com/blog/frequently-asked-questions-disney-military-salute-discount/ (third-party)"
    ],
    "confidence": "low",
    "last_verified": "2026-11-26"
  }
];

/** On-base lodging, AFRC resorts and the Armed Forces Vacation Club: not matched to search results, shown as their own card. */
export type MilitaryLodging = {
  key: string;
  name: string;
  kind: string;
  rate: string;
  eligible: HotelEligibility[];
  /** Which veterans can stay: "all", "some" (Purple Heart, former POW, service-connected, caregivers, per the note), or "retirees" only. */
  veterans: "all" | "some" | "retirees";
  /** false = this program doesn't take the 2018 expanded-access group even though some veterans qualify (Edelweiss). */
  expanded_access?: boolean;
  veterans_note: string;
  how_to_book: string;
  /** E.164, or "". */
  reservations_phone: string;
  id_needed: string;
  restrictions: string;
  stacking: string;
  stay_perk: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  last_verified: string;
};
export const MILITARY_LODGING: MilitaryLodging[] = [
  {
    "key": "army-hotels",
    "name": "IHG Army Hotels (on-post Army lodging)",
    "kind": "military_lodging",
    "rate": "government lodging rates; retirees save up to 20%",
    "eligible": [
      "active_duty",
      "retirees",
      "dod_civilians",
      "dependents"
    ],
    "veterans": "retirees",
    "veterans_note": "Not stated for veterans in general. The page lists active duty and families, DoD employees, contractors and retirees, and also says there are 'special rates for active-duty military, retirees, veterans, and their families'. Expanded-access veterans (Purple Heart, POW, service-connected) are not mentioned on the page.",
    "how_to_book": "Online on ihg.com/armyhotels (pick installation and travel type) or call 1-877-711-TEAM.",
    "reservations_phone": "+18777118326",
    "id_needed": "Installation access rules apply at each post (DoD ID or approved access).",
    "restrictions": "On-post hotels: getting on post is the real gate. Retiree savings 'based on availability'.",
    "stacking": "Not stated.",
    "stay_perk": "",
    "sources": [
      "https://www.ihg.com/armyhotels/hotels/us/en/reservation",
      "https://army.dodlodging.net/"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "navy-lodge",
    "name": "Navy Lodge (NEXCOM)",
    "kind": "military_lodging",
    "rate": "varies by location",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "some",
    "veterans_note": "Only some veterans: '0-100% Disabled Veterans, Caregivers', Medal of Honor recipients, former POWs and Purple Heart recipients (plus TAMP/VSI/SSB separatees). Other veterans are not listed.",
    "how_to_book": "Online on navy-lodge.com or call 24/7.",
    "reservations_phone": "+18006289466",
    "id_needed": "Current ID; orders if on official travel.",
    "restrictions": "Authorized patrons only; sponsors must be present to check in sponsored guests. Pet friendly.",
    "stacking": "Not applicable.",
    "stay_perk": "",
    "sources": [
      "https://www.navy-lodge.com/Resources/FAQs",
      "https://www.navy-lodge.com/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "navy-gateway",
    "name": "Navy Gateway Inns & Suites (NGIS)",
    "kind": "military_lodging",
    "rate": "government lodging rates",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "retirees",
      "dod_civilians"
    ],
    "veterans": "retirees",
    "veterans_note": "Not stated on the page (it lists active duty, reservists, retirees, NAF/DoD civilians and sponsored guests; details in its 'Who May Stay' policy, not read).",
    "how_to_book": "Online at ngis.dodlodging.net or call.",
    "reservations_phone": "+18336447378",
    "id_needed": "Not stated.",
    "restrictions": "On-base; installation access required.",
    "stacking": "Not applicable.",
    "stay_perk": "",
    "sources": [
      "https://ngis.dodlodging.net/"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "air-force-inns",
    "name": "Air Force Inns",
    "kind": "military_lodging",
    "rate": "government lodging rates",
    "eligible": [
      "active_duty",
      "retirees",
      "dod_civilians"
    ],
    "veterans": "retirees",
    "veterans_note": "Not stated on the page (lists active duty, retirees, NAF or DoD civilian employees and sponsored guests).",
    "how_to_book": "Online at af.dodlodging.net or call (CONUS number).",
    "reservations_phone": "+18882356343",
    "id_needed": "Not stated.",
    "restrictions": "On-base; installation access required.",
    "stacking": "Not applicable.",
    "stay_perk": "",
    "sources": [
      "https://af.dodlodging.net/",
      "https://www.dodlodging.net/"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-26"
  },
  {
    "key": "marine-corps",
    "name": "Marine Corps lodging (Inns of the Corps / Marine Corps Transient Housing)",
    "kind": "military_lodging",
    "rate": "government lodging rates",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "some",
    "veterans_note": "Only some veterans, at Priority Two (limited basis): service-connected disabled veterans, former POWs, Purple Heart and Medal of Honor recipients, and primary caregivers. Other veterans are not listed.",
    "how_to_book": "Call the 24/7 reservation center or book online.",
    "reservations_phone": "+18884097829",
    "id_needed": "Not stated.",
    "restrictions": "Priority One is official travel (unlimited as rooms allow); Priority Two (non-duty, retirees, expanded-access veterans) and Priority Three (leisure) are limited basis.",
    "stacking": "Not applicable.",
    "stay_perk": "",
    "sources": [
      "http://innsofthecorps.com/index.html"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "hale-koa",
    "name": "Hale Koa Hotel (AFRC, Honolulu)",
    "kind": "afrc",
    "rate": "rate category by rank/status",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "some",
    "veterans_note": "Some veterans: Purple Heart, former POW, VA service-connected (any rating) veterans and primary family caregivers; honorably discharged 100% service-connected veterans. Other veterans are not listed.",
    "how_to_book": "Online at halekoa.com or call.",
    "reservations_phone": "+18003676027",
    "id_needed": "Category ID (CAC, DD 2, DD 1173, DD 2765, etc.). Expanded-access veterans: VHIC showing PURPLE HEART, FORMER POW or SERVICE CONNECTED plus REAL ID or U.S. passport. Caregivers: VA Office of Community Care letter plus REAL ID or passport.",
    "restrictions": "Sponsors may book up to 2 extra rooms for non-eligible guests at Category III rate (no discounts) and must be present. Survivor families get 50% off their own room. Current and retired DoD civilians eligible.",
    "stacking": "Survivor discount cannot be combined with other offers.",
    "stay_perk": "",
    "sources": [
      "https://www.halekoa.com/about-hale-koa-hotel/eligibility",
      "https://www.halekoa.com/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "shades-of-green",
    "name": "Shades of Green (AFRC, Walt Disney World)",
    "kind": "afrc",
    "rate": "rate category by rank/status",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "some",
    "veterans_note": "Some veterans year-round (Purple Heart, former POW, VA service-connected veterans, primary family caregivers, 100% service-connected). All honorably discharged veterans in January and September only ('Salute to Our Veterans', Category III rate, DD-214 accepted).",
    "how_to_book": "Online at shadesofgreen.org or call (same-day bookings by phone).",
    "reservations_phone": "+18885932242",
    "id_needed": "Category ID. Expanded-access veterans: VHIC showing PURPLE HEART, FORMER POW or SERVICE CONNECTED (one page version also allows HEC form H623A) plus REAL ID or passport. Caregivers: VA letter plus REAL ID or passport. Salute veterans: DD-214.",
    "restrictions": "Sponsors may book up to 3 rooms for guests at Category III rate. 'Salute to Our Veterans' is subject to availability, January and September only. Page dated 18 Nov 2026.",
    "stacking": "Survivor 50% discount applies to the survivor's room only; not stackable with Disney Salute room discounts (third-party).",
    "stay_perk": "",
    "sources": [
      "https://www.shadesofgreen.org/about-shades-green/eligibility",
      "https://www.shadesofgreen.org/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "edelweiss",
    "name": "Edelweiss Lodge and Resort (AFRC, Garmisch, Germany)",
    "kind": "afrc",
    "rate": "rate category by rank/status",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "some",
    "expanded_access": false,
    "veterans_note": "Only 100% service-connected honorably discharged veterans. The 2018 expanded-access group (Purple Heart, POW, other service-connected veterans, caregivers) is excluded: the authorization 'currently does not include the Edelweiss Lodge and Resort'.",
    "how_to_book": "Online at edelweisslodgeandresort.com or call the German reservations number.",
    "reservations_phone": "",
    "id_needed": "Valid DoD CAC or accompanied by an authorized sponsor; category ID. Guests from outside Europe file AE Form 190-16F for installation access.",
    "restrictions": "Overseas (Germany). Retired DoD civilians excluded. US-dialed number is German (011-49-8821-9440), so no US/Canada number listed.",
    "stacking": "Not applicable.",
    "stay_perk": "",
    "sources": [
      "https://www.edelweisslodgeandresort.com/your-stay/eligibility",
      "https://www.edelweisslodgeandresort.com/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "dragon-hill",
    "name": "Dragon Hill Lodge (AFRC, Seoul, Korea)",
    "kind": "afrc",
    "rate": "rate category by rank/status",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "some",
    "veterans_note": "Some veterans: Purple Heart, former POW, VA service-connected veterans and caregivers (VHIC or VA letter plus REAL ID/passport); 100% service-connected veterans.",
    "how_to_book": "Online at dragonhilllodge.com; questions to Reservations@DragonHillLodge.com.",
    "reservations_phone": "",
    "id_needed": "Category ID; expanded-access veterans need VHIC or VA letter plus REAL ID or passport. Yongsan base access rules (DBIDS) apply.",
    "restrictions": "Overseas (Korea); base access paperwork needed. Phone not listed on the page.",
    "stacking": "Not applicable.",
    "stay_perk": "",
    "sources": [
      "https://www.dragonhilllodge.com/about-dragon-hill-lodge/eligibility"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  },
  {
    "key": "afvc",
    "name": "Armed Forces Vacation Club (AFVC)",
    "kind": "vacation_club",
    "rate": "weekly resort units from $379 (Last Minute Vacations); hotels up to 25% off",
    "eligible": [
      "active_duty",
      "guard_reserve",
      "veterans",
      "retirees",
      "dependents",
      "dod_civilians"
    ],
    "veterans": "all",
    "veterans_note": "Yes, all veterans: membership is free to 'all current, veterans, and retired members' of the military, Guard and Reserves, plus Gold Star families, DoD civilians (current or retired), AUSA members and immediate family.",
    "how_to_book": "Join free online at afvclub.com, then book; or call.",
    "reservations_phone": "+18007249988",
    "id_needed": "Not stated on the pages read (eligibility verified at sign-up).",
    "restrictions": "Resort weeks (7 nights) plus resort fees and taxes; Short Stays also offered. Paid Premium tier claims up to 60% off hotels. $70 off first 7-night booking for new members. Veterans Holidays is now part of AFVC.",
    "stacking": "Not stated.",
    "stay_perk": "",
    "sources": [
      "https://www.afvclub.com/new-member-welcome",
      "https://www.afvclub.com/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-26"
  }
];

/** The 2018 Act, in effect since 1 Jan 2020, that opened MWR lodging to some veterans. */
export const LODGING_EXPANDED_ACCESS = {
  "title": "Purple Heart, former POWs, service-connected veterans and caregivers",
  "summary": "Since 2020, Purple Heart recipients, former POWs, veterans with any VA service-connected rating, and VA family caregivers can use many on-base lodges and resorts. Bring a VA health card marked PURPLE HEART, FORMER POW or SERVICE CONNECTED (caregivers: your VA letter) and a photo ID.",
  "note": "Only these veterans: Purple Heart recipients, former POWs, and veterans with a VA service-connected disability rating (0-90% under this Act; 100% were already eligible), plus VA-designated primary family caregivers. Covers MWR retail activities including 'recreational lodging/resorts'. Other veterans are not covered.",
  "idNeeded": "VA Veteran Health Identification Card showing PURPLE HEART, FORMER POW or SERVICE CONNECTED (plus REAL ID or passport at most sites). Caregivers: VA Office of Community Care eligibility letter. Without a VHIC there is no in-person base access, but online exchanges and American Forces Travel still work.",
  "sources": [
    "https://www.dodlodging.net/documents/Patron_Expansion_FAQs.pdf (DoD FAQ, current as of Nov 2019)",
    "https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/101511p.pdf (DoDI 1015.11; blocked, seen via search summary)",
    "https://www.shadesofgreen.org/about-shades-green/eligibility",
    "https://www.halekoa.com/about-hale-koa-hotel/eligibility"
  ],
  "restrictions": "Not every lodging program takes this group: Edelweiss Lodge excludes it; Army, Air Force and NGIS pages don't say. Overseas sites follow SOFA/host-nation rules. DoD charges new users a small fee for card payments. DoD Instruction 1015.11 (23 Jan 2023), the current lodging policy, could not be opened (blocked); its contents here come only from a search summary.",
  "since": "2020-01-01"
};

const norm = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** The brand a property belongs to: excluded names first, then the longest `match` (or `match_start`) name found. */
export function hotelBrandOf(propertyName: string): MilitaryHotel | undefined {
  const n = norm(propertyName);
  let best: { h: MilitaryHotel; len: number } | undefined;
  for (const h of MILITARY_HOTELS) {
    if (h.match_exclude.some((x) => norm(x).trim() && n.includes(norm(x)))) continue;
    const hits = [
      ...h.match.map(norm).filter((k) => k.trim() && n.includes(k)),
      ...(h.match_start ?? []).map(norm).filter((k) => k.trim() && n.startsWith(k)),
    ];
    for (const k of hits) if (!best || k.length > best.len) best = { h, len: k.length };
  }
  return best?.h;
}
export const hotelByKey = (key: string) => MILITARY_HOTELS.find((h) => h.key === key);

/** "veteran" on the page means veteran or retiree; "active" means active duty, Guard or Reserve. */
export function hotelEligible(h: { eligible: HotelEligibility[] }, status: TravelerStatus): boolean {
  const want: HotelEligibility[] = status === "active" ? ["active_duty", "guard_reserve"] : ["veterans", "retirees"];
  return want.some((w) => h.eligible.includes(w));
}

/** The first source as a bare URL. */
const sourceUrl = (sources: string[]) => sources.map((s) => s.trim().split(/\s+/)[0]).find((u) => /^https?:\/\//.test(u)) ?? "";

/**
 * What a traveler of this status gets at this brand. `tag`: "call" = a military rate quoted by phone; "online" = one
 * that books online (code or rate menu); "ask" = the brand doesn't say who qualifies, so show "Ask the hotel" and never
 * a rate; "none" = not for this status.
 */
export function hotelPerkFor(h: MilitaryHotel, status: TravelerStatus) {
  const ask = h.eligible.length === 0;
  const eligible = !ask && hotelEligible(h, status);
  const tag: "call" | "online" | "ask" | "none" = ask ? "ask" : !eligible ? "none" : h.phone_only ? "call" : "online";
  const quiet = h.confidence === "low";
  return {
    key: h.key,
    brand: h.brand,
    tag,
    eligible,
    rate: eligible ? h.rate : "",
    phoneOnly: eligible && h.phone_only,
    code: eligible ? h.rate_code : "",
    codeThirdParty: eligible && !!h.rate_code && h.code_third_party,
    stayPerk: eligible ? h.stay_perk : "",
    claim: eligible || ask ? { line: h.claim, membership: h.membership } : null,
    /** tag "none" only: the line to show instead of a flat "No military rate" ("" = use that). */
    noneLine: tag === "none" ? h.none_line ?? "" : "",
    /** The brand's central reservations, for travelers who ring themselves; null when the pages gave none. */
    reservationsPhone: h.central_reservations_phone || null,
    /** Low confidence: show the quieter line and link the source. */
    quiet,
    confidenceNote: quiet ? "Reported; confirm with the hotel" : "",
    source: sourceUrl(h.sources),
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

/** One military lodging program for this status: "yes", "some" (only some veterans; read the note) or "no". */
export function lodgingFor(l: MilitaryLodging, status: TravelerStatus) {
  const forYou: "yes" | "some" | "no" = status === "active" ? (hotelEligible(l, "active") ? "yes" : "no") : l.veterans === "all" ? "yes" : "some";
  return {
    key: l.key,
    name: l.name,
    kind: l.kind,
    rate: l.rate,
    forYou,
    /** Which veterans can stay: "all", "some" (the expanded-access group) or "retirees" only. */
    veterans: l.veterans,
    /** Show the "Who qualifies" (expanded-access) box on this program: "some" programs, except Edelweiss. */
    expandedAccess: l.veterans === "some" && l.expanded_access !== false,
    veteransNote: l.veterans_note,
    howToBook: l.how_to_book,
    reservationsPhone: l.reservations_phone || null,
    idNeeded: l.id_needed,
    restrictions: l.restrictions,
    stayPerk: l.stay_perk,
    source: sourceUrl(l.sources),
    confidence: l.confidence,
    lastVerified: l.last_verified,
  };
}
export type MilitaryLodgingView = ReturnType<typeof lodgingFor>;
