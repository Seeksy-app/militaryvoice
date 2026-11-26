/**
 * Military airfares and perks (Travel page, Andrew 26 Nov 2026: "Yes, build it"). Researched from each airline's own
 * pages and verified 2026-11-25; from exports/military-fares (the PM's research). Not booking advice: prices
 * and rules change. Research from each airline's own pages (third-party sources only where noted). Not booking advice; prices and rules change. Recheck Southwest after 1 Jan 2027 and Breeze after 4 Dec 2026.
 * The flight search attaches the row for each airline it finds; `callDesk` below is where "Have us call" rings.
 */
export type MilitaryEligibility = "active_duty" | "reserve" | "national_guard" | "dependents" | "veterans" | "retirees";
export type MilitaryFareQuick = {
  active_duty_fare: string;
  veteran_fare: string;
  veteran_free_bags: string;
  active_duty_bags_personal: string;
  status: string;
};
export type MilitaryAirline = {
  airline: string;
  /** Two-letter code, as in flight numbers ("DL 123"). Empty for SATO/DTS. */
  iata: string;
  military_fares: "yes" | "no" | "unclear";
  military_fare_details: string;
  eligible: MilitaryEligibility[];
  veterans_note: string;
  verification: string;
  bags_leisure: string;
  bags_orders: string;
  other_perks: string;
  how_to_book: string;
  booking_url: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  last_verified: string;
  quick: MilitaryFareQuick;
};
export const MILITARY_FARES_VERIFIED = "2026-11-25";
export const MILITARY_AIRLINES: MilitaryAirline[] = [
  {
    "airline": "Delta Air Lines",
    "iata": "DL",
    "military_fares": "yes",
    "military_fare_details": "Delta's own pages say active-duty members get 'recognition and savings not available to civilian customers' and that there is 'a military discount on flights', but they give no percentage. You can't book it online. The current overview page says to 'message us or view worldwide phone numbers'. Delta's older military page, which is still served but redirects, says to call the Military and Government Desk at 800-325-1771 (M-F 8:30a-5:30p ET) for personal travel or travel on orders. That desk may be retired, since the current page no longer names it. Families of war-injured service members get discounted Medical Emergency fares at 800-221-1212. [Source: delta.com. Military.com gives 1-800-221-1212 for booking.]",
    "eligible": [
      "active_duty"
    ],
    "veterans_note": "Nothing. Every Delta military page is limited to 'active members' of the Army, Marine Corps, Navy, Air Force, Space Force and Coast Guard. There's no veteran fare, bag perk or WeSalute flight discount. [Delta pages + military.com, which also says the page covers active duty only]",
    "verification": "Not stated on Delta's pages. In practice this is a military ID at check-in, plus orders for the orders allowance. Delta Vacations' military offer verifies with a military email address (older Delta page).",
    "bags_leisure": "Active members on personal travel (delta.com military baggage page): Delta Main/Comfort, including Basic, 2 free bags. Premium Select 3 free. First/Delta One 3 free. Max 62 linear inches. The weight icons are 50 lb and 70 lb but they don't come through in the page text. Most likely 50 lb in Main/Comfort and 70 lb in premium cabins (inference, verify). Applies to Delta-marketed tickets, including flights operated by Aeromexico, Air France, KLM, Korean Air and Virgin Atlantic.",
    "bags_orders": "5 free bags in every cabin, up to 80 linear in and under 100 lb each (delta.com). Subject to embargoes and regional weight limits.",
    "other_perks": "Early boarding for active duty. Delta Vacations military discount: the older page says up to $300 off plus 500 bonus miles, requested by submitting a military email. Military pet travel (pets checked on PCS orders, $200). Discounted medical-emergency fares for families of war-injured members. No lounge or change-fee perk is stated.",
    "how_to_book": "Active duty only: call Delta (try 800-325-1771 first, then 800-221-1212) and ask for the military fare for personal travel. Compare it with the public fare on delta.com. Bring your military ID to the counter for the leisure bag allowance. Veterans: no Delta-specific benefit, so book public fares.",
    "booking_url": "https://www.delta.com/us/en/special-circumstances/military-travel/overview",
    "sources": [
      "https://www.delta.com/us/en/special-circumstances/military-travel/overview",
      "https://www.delta.com/us/en/baggage/checked-baggage/military-baggage-allowance",
      "https://www.delta.com/content/www/en_US/traveling-with-us/special-travel-needs/military-flights.html",
      "https://www.military.com/discounts/delta-air-lines-military-discount"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "Unpublished % (phone)",
      "veteran_fare": "Nothing",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2 free (3 in premium)",
      "status": "operating"
    }
  },
  {
    "airline": "United Airlines",
    "iata": "UA",
    "military_fares": "yes",
    "military_fare_details": "The Active-Duty Military Leisure Discount is 5% off the published base fare on select United/United Express-operated flights bought on united.com or in the app. You verify once in MileagePlus, then on the booking form under 'Choose your program' select 'Military Discount'. Eligible flights are marked with a discount indicator. Rules: the trip must start in the US, Guam, PR, USVI or Canada. The active-duty account holder must be on the itinerary, with up to 9 passengers (dependents on the same record). Basic Economy and promotional fares are excluded, it can't be combined with other discounts, and taxes and surcharges aren't discounted. [All from united.com]",
    "eligible": [
      "active_duty",
      "reserve",
      "national_guard",
      "dependents"
    ],
    "veterans_note": "No flight discount and no bag perk. Bag and boarding benefits cover active duty, Reserve/Guard only on active orders, and people discharged within 7 days of travel. The 5% leisure discount is active duty only, and Reserve/Guard aren't on the verification form. The only veteran item is a United Vacations flight+hotel package discount for 'active duty and veteran' personnel. A WeSalute 5%-off-United offer link that third-party sites cite now redirects to a generic WeSalute Travel page, so treat it as discontinued.",
    "verification": "Online: MileagePlus > My Account > Military Discount. Status is checked by ID Dataweb, a third party. If asked, upload an LES from the last 90 days or orders issued within the past year, with the name matching your MileagePlus profile. You re-verify every year. For bags: military ID at the airport (standard practice; the bag page doesn't name the document).",
    "bags_leisure": "Personal travel: 3 free bags in all cabins, 62 in, 70 lb each. Dependents get the same if they're on the same reservation. A dependent travelling alone without orders gets the normal allowance. United/United Express flights only, not Star Alliance partner segments. [united.com checked-bags page]",
    "bags_orders": "On military orders: 5 free bags, 115 in, 100 lb each. A dependent travelling on travel orders gets 2 free bags at 62 in / 70 lb. Dependents may travel alone when the trip is due to orders.",
    "other_perks": "Pre-boarding for active military. United Club access 'if there's space available and you meet the access requirements' (wording vague). Military pet program on HNL-GUM with current orders. United Vacations military discount.",
    "how_to_book": "Active duty only: (1) Sign in to MileagePlus and complete Military Discount verification (have an LES or orders ready). (2) On united.com or in the app, select 'Military Discount' under 'Choose your program'. (3) Pick a flight tagged with the discount, not Basic Economy. (4) Show military ID at check-in for 3 free bags. Veterans: no United perk.",
    "booking_url": "https://www.united.com/en/us/fly/company/company-info/military-benefits-and-discounts.html",
    "sources": [
      "https://www.united.com/en/us/fly/company/company-info/military-benefits-and-discounts.html",
      "https://www.united.com/en/us/fly/company/company-info/military-verification.html",
      "https://www.united.com/en/us/fly/baggage/checked-bags.html#militarycheckedbagpolicy",
      "https://www.wesalute.com/offer/18931-united?g=military"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "5% online (verify once)",
      "veteran_fare": "Nothing",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "3 free",
      "status": "operating"
    }
  },
  {
    "airline": "American Airlines",
    "iata": "AA",
    "military_fares": "unclear",
    "military_fare_details": "aa.com only says 'We offer government or military fares in some markets. Call Reservations for more information.' It publishes no discount amount, online search option or eligibility rules.",
    "eligible": [
      "active_duty",
      "dependents"
    ],
    "veterans_note": "No flight discount and no bag perk. Veterans, active duty and families who pay for WeSalute+ get 10% off the land portion (hotel, car and so on) of American Airlines Vacations packages that start in the 50 states. That's not airfare. [aa.com links to WeSalute; terms read on wesalute.com]",
    "verification": "Military ID at the check-in counter, plus orders for the orders allowance. Dependents on orders show a Military Dependent ID and a copy of the active orders. Boarding perk needs military ID. [aa.com]",
    "bags_leisure": "Active U.S. military on personal or leisure travel: up to 3 free bags, 50 lb and 62 in each. Only on American-marketed and American-operated itineraries, not partner-operated codeshares. 'Active' means Air Force, Army, Coast Guard, Marines, Navy, Space Force and cadets. Explicitly excluded: Reserves, National Guard, civilian military ID holders and USPHS. The rules give dependents no leisure bag perk.",
    "bags_orders": "Up to 5 free bags, 100 lb and 115 in each (126 in before 17 Apr 2024). Dependents on orders get the same with a dependent ID and a copy of the orders.",
    "other_perks": "Active-duty military with ID board in Group 1 alongside First. Pet charges waived for working military dogs on duty. Checked pets accepted for active duty on assignment. Miles for Heroes donations. No stated change-fee or lounge perk.",
    "how_to_book": "Book public fares on aa.com, or call AA Reservations to ask whether a military fare exists on your route. Active duty: show military ID at the counter for 3 free bags and at the gate for Group 1. Book only flights that American markets and operates, or the bag waiver won't apply. Veterans: there's no airfare perk, but WeSalute+ members save 10% on the land portion of AA Vacations packages.",
    "booking_url": "https://www.aa.com/web/i18n/customer-service/programs-products/military-benefits.html",
    "sources": [
      "https://www.aa.com/web/i18n/customer-service/programs-products/military-benefits.html",
      "https://www.aa.com/web/i18n/travel-info/baggage/specialty-and-sports.html#militarybags",
      "https://www.wesalute.com/offer/20281-american-airlines?g=military"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "Some markets (phone)",
      "veteran_fare": "Nothing on flights",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "3 free",
      "status": "operating"
    }
  },
  {
    "airline": "Alaska Airlines",
    "iata": "AS",
    "military_fares": "yes",
    "military_fare_details": "A special military fare 'in some markets', sold by phone only through Alaska or Hawaiian Reservations as a new ticket with instant ticketing. Normal fare rules and change fees apply. It's valid on Alaska, Hawaiian, Horizon and SkyWest-for-Alaska flights. No discount percentage is published. It doesn't apply to TDY travel or to retirees. Separately, WeSalute+ members, including veterans, get 5% off Alaska and Hawaiian fares in all fare classes, including sale fares, year-round, for up to 6 people, booked online through WeSalute's private 'WeSalute Atmos for Business' portal, and they still earn Atmos Rewards. [Fare rules: alaskaair.com. WeSalute terms: wesalute.com, linked from Alaska's benefits page]",
    "eligible": [
      "active_duty",
      "reserve",
      "dependents",
      "veterans"
    ],
    "veterans_note": "The phone military fare covers only people discharged within 7 days, who must finish travel within 7 days of discharge. It does not cover veterans in general or retirees. Veterans' real option is the paid WeSalute+ membership (plans from $9.99 per WeSalute), which gives 5% off Alaska and Hawaiian flights online. No veteran bag perk: retirees get free bags only on orders. Also Honor Flight reduced fares.",
    "verification": "Military fare: show a valid active-duty Armed Forces ID, or separation papers within 7 days of discharge. Dependents aged 10 and over show a Uniformed Services dependent ID marked 'active' at check-in. Bags and lounge: valid military ID. Veterans: WeSalute+ membership, checked by WeSalute.",
    "bags_leisure": "The pages conflict. The Alaska/Hawaiian baggage-waiver table says active duty with ID on leisure travel (no orders) gets bags 1-3 free at 70 lb and 'free up to 5 at 70 lbs., then determined by region'. Dependents without orders on the same reservation get 2 free at 50 lb (footnote: from bookings made after 14 Oct 2025; before that, dependents matched active duty). The 'Military and veteran benefits' page still says 'first 2 bags free; 5 on orders'. Treat the bag table as current (likely 5 free) and confirm.",
    "bags_orders": "Active duty and dependents on orders: up to 5 free at 70 lb, with overweight and oversize fees waived for up to 5 bags. U.S. military retirees on orders: free bags as well.",
    "other_perks": "Gate agents offer early boarding. Free change or cancel-and-refund when military orders prevent travel. Discounted Alaska Lounge day pass with military ID on paid or award tickets; free for official travel booked through SATO. 15% off inflight food for service members and families. Pet-cargo discount on PCS.",
    "how_to_book": "Active duty or Reserve on active duty: call Alaska Reservations, ask for the military fare on your route, and compare it with alaskaair.com. Veterans and everyone else: join WeSalute+ and book through its Alaska portal for 5% off, including sale fares, then add your Atmos Rewards number. Bring military ID for bags, early boarding and the lounge-pass discount.",
    "booking_url": "https://www.alaskaair.com/content/planning/military-fares",
    "sources": [
      "https://www.alaskaair.com/content/planning/military-fares",
      "https://www.alaskaair.com/content/about-us/social-responsibility/salute-to-service",
      "https://www.alaskaair.com/content/travel-info/baggage/baggage-fee-waivers-exceptions",
      "https://www.wesalute.com/get-alaska-airlines"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "Some markets (phone)",
      "veteran_fare": "5% with WeSalute+",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2–5 free (pages conflict)",
      "status": "operating"
    }
  },
  {
    "airline": "Hawaiian Airlines (Alaska Air Group)",
    "iata": "HA",
    "military_fares": "yes",
    "military_fare_details": "Same programme as Alaska. hawaiianairlines.com now serves the identical shared 'Military fares' page ('At Alaska Airlines and Hawaiian Airlines...'): phone-only military fare in some markets through Alaska or Hawaiian Reservations, valid on Hawaiian-operated flights. WeSalute+ 5% off also covers Hawaiian fares. How the merger changed things [alaskaair news releases]: single FAA operating certificate on 29 Oct 2025, then a shared Sabre reservation system on 22 Apr 2026. Hawaiian flights now carry the AS code ('operated by Alaska as Hawaiian Airlines'), loyalty is Atmos Rewards, and the military fare, bag-waiver and veteran-benefit pages are one shared Alaska/Hawaiian policy. The Hawaiian brand and website stay, but the content is Alaska's. The old Hawaiian military URL I tried (/our-services/special-services/military) now 404s. Third-party 'Hawaiian military baggage' pages describe the old, separate policy and are stale.",
    "eligible": [
      "active_duty",
      "reserve",
      "dependents",
      "veterans"
    ],
    "veterans_note": "Same as Alaska. Veterans get no fare or bag perk directly, except people discharged within 7 days on the military fare. They get 5% off Hawaiian and Alaska flights through paid WeSalute+. The 'HA' code is gone for bookings, so search Hawaiian flights as AS.",
    "verification": "Same as Alaska: active-duty Armed Forces ID or separation papers within 7 days. Dependents aged 10 and over need a dependent ID marked active. Military ID for bags. WeSalute+ membership for the veteran discount.",
    "bags_leisure": "The shared Alaska/Hawaiian waiver table, served on hawaiianairlines.com too: active duty with ID on leisure, free up to 5 bags at 70 lb. Dependents without orders on the same reservation, 2 free at 50 lb. The shared benefits page still says 2 free, so confirm.",
    "bags_orders": "Up to 5 free at 70 lb, with overweight and oversize waived up to 5 bags. Dependents on orders the same. Retirees on orders get free bags.",
    "other_perks": "Same as Alaska: early boarding, free change or refund when orders interfere, discounted lounge day pass with military ID (free on SATO official travel), 15% off inflight food. Hawaiian joined oneworld in spring 2026 per Alaska's release; that has no military effect.",
    "how_to_book": "Same as Alaska. Call Reservations for the military fare (active duty), or use WeSalute+'s Alaska portal for 5% off Hawaiian-operated flights (veterans). Show military ID at check-in.",
    "booking_url": "https://www.hawaiianairlines.com/content/planning/military-fares",
    "sources": [
      "https://www.hawaiianairlines.com/content/planning/military-fares",
      "https://www.hawaiianairlines.com/content/about-us/social-responsibility/salute-to-service",
      "https://www.hawaiianairlines.com/content/travel-info/baggage/baggage-fee-waivers-exceptions",
      "https://news.alaskaair.com/company/alaska-airlines-and-hawaiian-airlines-reach-major-integration-milestone-a-single-operating-certificate/",
      "https://news.alaskaair.com/alaska-airlines/a-technical-milestone-for-the-alaska-and-hawaiian-combination-and-what-it-means-for-your-travel/",
      "https://www.wesalute.com/get-alaska-airlines"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "Some markets (phone)",
      "veteran_fare": "5% with WeSalute+",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "Same as Alaska",
      "status": "operating"
    }
  },
  {
    "airline": "JetBlue Airways",
    "iata": "B6",
    "military_fares": "yes",
    "military_fare_details": "5% off the base fare on JetBlue-operated flights for active duty and dependents on the same reservation, for leisure or duty travel. Book by contacting JetBlue (chat or phone); it isn't an online search option. JetBlue's travel-agent page explains how it works. The fare basis contains MIL01. There's no advance-purchase rule and all fares are eligible, but the discount is tied to a single fare bucket (M, R or V) with no last-seat availability, so it can vanish on busy flights. You give the member's name, branch and rank. Excluded: JetBlue Vacations, TrueBlue awards, partner flights, and fees and taxes. [jetblue.com]",
    "eligible": [
      "active_duty",
      "dependents",
      "veterans",
      "retirees"
    ],
    "veterans_note": "Best of the six for veterans. Retirees, veterans and families who pay for WeSalute+ (formerly Veterans Advantage) get 5% off the base fare plus 2 free checked bags at 50 lb on JetBlue-operated flights. At least one traveller on the reservation must be a member at booking. Book only through JetBlue chat or phone with your WeSalute+ (VetRewards) Member ID. Not online, and not at the airport. [jetblue.com]",
    "verification": "Active duty: a valid DoD Common Access Card, plus travel orders for duty travel. Dependents travelling separately on duty trips show a Military Dependent ID. Veterans and retirees: WeSalute+ Member ID given to JetBlue support at booking.",
    "bags_leisure": "Active duty on leisure: 2 free checked bags at 50 lb, with dependents on the same reservation getting the same. WeSalute+ veterans and retirees: 2 free at 50 lb. JetBlue-operated only; partner-marketed or partner-operated segments are excepted.",
    "bags_orders": "Duty travel: up to 5 free bags at 99 lb each for the member and dependents on the same itinerary. Immediate family may be on a separate reservation if they show a dependent ID. Travel orders and CAC required.",
    "other_perks": "The 5% discount also applies on duty travel. JetBlue's page names no boarding, lounge or change-fee perk. GSA/DG government fares (refundable) are for official travel paid with a government card only.",
    "how_to_book": "Active duty: find the flight on jetblue.com, then use 'Chat with Us' or call 1-800-JETBLUE and ask for the military discount (MIL fare). Have your name, branch and rank ready, and bring your CAC to the airport. Veterans and retirees: join WeSalute+, then chat with or call JetBlue with your Member ID to book with 5% off and 2 free bags.",
    "booking_url": "https://www.jetblue.com/flying-with-us/military-customers",
    "sources": [
      "https://www.jetblue.com/flying-with-us/military-customers",
      "https://www.jetblue.com/travel-agents/government-fares"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "5% (chat/phone)",
      "veteran_fare": "5% + 2 free bags with WeSalute+",
      "veteran_free_bags": "Yes, with WeSalute+",
      "active_duty_bags_personal": "2 free",
      "status": "operating"
    }
  },
  {
    "airline": "Southwest Airlines",
    "iata": "WN",
    "military_fares": "yes",
    "military_fare_details": "Southwest has 'military fares', but they are not sold on Southwest.com. You book them by calling 1-800-I-FLY-SWA (1-800-435-9792) or at a ticket counter, and Rapid Rewards points can't be used for them. Southwest does not publish a percentage off, so compare the military fare with the public web fare (my advice, not a Southwest statement). Government fares (GVT/GST/YCA) are separate and are for official travel only. [Source: Southwest's own pages]",
    "eligible": [
      "active_duty",
      "reserve",
      "national_guard",
      "dependents"
    ],
    "veterans_note": "Nothing. Southwest's military page names veterans only for hiring, Honor Flight and Wounded Warrior partnerships. Veterans and retirees aren't eligible for military fares, the bag-fee exemption or early boarding.",
    "verification": "Show a valid Uniformed Services Active Duty ID card at the ticket counter or check-in. Dependents 12 and older need a card showing active-duty dependent status. There's no online verification.",
    "bags_leisure": "Active duty with a valid ID: the bag-policy table lists the 1st and 2nd checked bags as free on mainland flights, plus a free carry-on and personal item. The military page also exempts them from the two-piece limit and from excess, oversize and overweight fees, as long as no bag is over 100 lb or 80 linear inches (limit 20 pieces). Dependents traveling without the member pay normal fees. The exemption applies to personal trips too; it isn't tied to orders. Everyone else pays: since the April 2026 increase, bags booked on or after Apr 9, 2026 cost $45 for the first and $55 for the second (news reports, not verified on Southwest's own pages).",
    "bags_orders": "Same as personal travel; Southwest doesn't set a separate allowance for orders or PCS. People on official orders can ship firearms secured in a crate or hard-sided case (arrange it ahead with airport officials).",
    "other_perks": "Active duty with ID can board in Priority Boarding, just before Group 1. Military working-dog handlers need a DoD ID plus DD Form 1610 or PCS orders. A site banner says Rapid Rewards changes take effect Jan 1, 2027; the new 2027 bag tables have no active-duty row, so check again in January.",
    "how_to_book": "Active duty or dependent: call 1-800-435-9792, ask for the military fare and compare it with the southwest.com price. Either way, show your active-duty ID at the counter for free bags and Priority Boarding. Veterans: book on southwest.com like any customer; you get no military benefit.",
    "booking_url": "https://www.southwest.com/military-travel/",
    "sources": [
      "https://www.southwest.com/military-travel/",
      "https://support.southwest.com/helpcenter/article/southwest-military-benefits",
      "https://www.southwest.com/bagpolicy/",
      "https://fortune.com/2026/04/08/southwest-hiking-baggage-fees-again-fuel-costs-iran-war-delta-jetblue-united-bags-fly-free-policy/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "Unpublished % (phone)",
      "veteran_fare": "Nothing",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2 free + no overweight fees",
      "status": "operating"
    }
  },
  {
    "airline": "Spirit Airlines",
    "iata": "NK",
    "military_fares": "no",
    "military_fare_details": "SPIRIT NO LONGER FLIES. It shut down on Sat May 2, 2026, after a federal rescue deal fell through, and is being wound down in its second Chapter 11 case (25-11897, S.D.N.Y.). On 25 Nov 2026, spirit.com and customersupport.spirit.com don't even resolve in DNS. Before the shutdown Spirit had no military fares. [Shutdown: CBS News and other search results; DNS: my own lookup]",
    "eligible": [],
    "veterans_note": "Nothing; the airline isn't operating. Before the shutdown, its bag perk covered active duty only, never veterans.",
    "verification": "Not applicable. Before the shutdown it used ID.me on spirit.com (third-party reports; Spirit's own page can't be reached).",
    "bags_leisure": "Not applicable. Before the shutdown, active duty plus spouse and children got 2 free checked bags and a carry-on (third-party reports).",
    "bags_orders": "Not applicable.",
    "other_perks": "None. Old Spirit tickets and credits are being handled in the bankruptcy: card purchases made directly with Spirit get automatic refunds; travel-agency bookings go back to the agency; credits, vouchers and points are being decided by the court.",
    "how_to_book": "You can't. Take Spirit off any MilitaryVoices.ai travel guide or comparison.",
    "booking_url": "",
    "sources": [
      "https://www.cbsnews.com/amp/news/spirit-airlines-shutting-down-failed-rescue-deal/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "—",
      "veteran_fare": "—",
      "veteran_free_bags": "—",
      "active_duty_bags_personal": "—",
      "status": "stopped flying 2 May 2026"
    }
  },
  {
    "airline": "Frontier Airlines",
    "iata": "F9",
    "military_fares": "no",
    "military_fare_details": "Frontier's own FAQ says Frontier 'does not offer military discounts'. It offers bag waivers only. [Source: Frontier FAQ]",
    "eligible": [
      "active_duty",
      "reserve",
      "national_guard",
      "dependents"
    ],
    "veterans_note": "Nothing. Both Frontier pages cover only current service members ('serving or may be called to serve'). Veterans and retirees aren't mentioned and pay standard fees.",
    "verification": "The newer bags FAQ (last modified 11/09/2026) says to verify with ID.me in the Frontier mobile app ('Sign in with ID.me') at booking, in Manage My Booking or at check-in, and the waiver then applies automatically. The older discounts FAQ (last modified 02/20/2026) says to show a CAC or Reserve Armed Forces ID at check-in or the gate. The two conflict, so do the ID.me step and also carry your CAC.",
    "bags_leisure": "Eligible service members get 1 personal item, 1 carry-on and 2 checked bags free, with oversize and overweight fees waived on those two (bags must still be within size and weight limits). A spouse and children on the same itinerary are covered only when the service member is traveling with them. This applies to personal trips; orders aren't required.",
    "bags_orders": "Same as personal travel; Frontier doesn't publish a separate allowance for orders or PCS. A third bag or more costs the standard fee.",
    "other_perks": "Neither Frontier page mentions military early boarding.",
    "how_to_book": "Book any fare on flyfrontier.com or in the app. In the Frontier app, choose 'Sign in with ID.me' (at booking, in Manage My Booking or at check-in) and verify as active duty or Guard/Reserve. Carry your CAC to the airport as backup.",
    "booking_url": "https://faq.flyfrontier.com/help/military-personnel-bags",
    "sources": [
      "https://faq.flyfrontier.com/help/military-personnel-bags",
      "https://faq.flyfrontier.com/help/do-you-offer-military-discounts"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "None",
      "veteran_fare": "Nothing",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2 free + carry-on",
      "status": "operating"
    }
  },
  {
    "airline": "Allegiant Air",
    "iata": "G4",
    "military_fares": "no",
    "military_fare_details": "'Allegiant Honors' has no percentage-off fare. The money benefits: no change or cancellation fees for active-duty or reserve members whose orders change, and a full refund (fees included) if travel is cancelled because of orders. Separately, people visiting a service member injured in the line of duty get the lowest available fare if they travel within 90 days of the injury. [Source: Allegiant's own page]",
    "eligible": [
      "active_duty",
      "reserve",
      "national_guard",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "BEST OF THE EIGHT FOR VETERANS. Allegiant's own page names veterans: 2 free checked bags (under 99 lb each), oversize fees waived up to 115 linear inches, 1 free carry-on, 1 free personal item, 1 in-cabin pet free and priority boarding, on domestic flights, for personal travel. Proof can be a DD-214, a veteran ID card or a driver's license with a veteran mark. The current page doesn't name retirees; Allegiant's 2024 press release says 'retired military veterans' qualify, so retirees are covered as veterans.",
    "verification": "Show military ID at the airport, where an agent checks it and adds the free items. Accepted: CAC, Uniformed Services ID, DD Form 2, DD-214, DD Form 2765, a veteran ID card, or a driver's license with a veteran designation. Spouses: DD Form 1173 or 1173-1, with the sponsor on the same reservation. Children under 10 need no ID. Allegiant describes no online verification.",
    "bags_leisure": "Service members and veterans get up to 2 checked bags (under 99 lb each; the 2024 release says under 100 lb) with oversize fees waived up to 115 linear inches, 1 carry-on, 1 personal item and 1 in-cabin pet, all free. A spouse, partner or children on the same reservation get the same. Domestic flights only.",
    "bags_orders": "Same bags. With orders, active-duty and reserve members also get no change or cancel fees, and a full refund (with documents) if orders cancel the trip; this extends to family on the same reservation.",
    "other_perks": "Priority boarding for eligible travelers on the same itinerary. One in-cabin pet free. If you prepaid bags online, call Customer Care after your ID is checked to get a credit for the eligible fees.",
    "how_to_book": "Book a normal fare on allegiantair.com and don't buy bags or a carry-on. At the airport, go to the counter with your veteran or military ID (DD-214, VA card or a license with a veteran mark works) and the agent adds the free bags, pet and boarding pass. If you already paid for bags, call Customer Care for a credit.",
    "booking_url": "https://www.allegiantair.com/military-discount",
    "sources": [
      "https://www.allegiantair.com/military-discount",
      "https://ir.allegiantair.com/news/news-details/2024/Allegiant-Salutes-our-Military-Members-and-Veterans-with-Benefits-for-Passengers-and-Team-Members/default.aspx"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "None (fee waivers on orders)",
      "veteran_fare": "Free bags + priority boarding",
      "veteran_free_bags": "Yes, 2 free with DD-214/VA ID",
      "active_duty_bags_personal": "2 free + carry-on",
      "status": "operating"
    }
  },
  {
    "airline": "Sun Country Airlines",
    "iata": "SY",
    "military_fares": "no",
    "military_fare_details": "None of the suncountry.com pages I read (bags page, help center: bags & seats, flights) offers a military fare or discount. The only published benefit is free bags for active duty. [Source: Sun Country's own pages, read in a browser because the site blocks automated fetching]",
    "eligible": [
      "active_duty"
    ],
    "veterans_note": "Nothing. Sun Country's FAQ says it plainly: 'standard bag fees apply for travel companions and Veterans.'",
    "verification": "Sun Country's pages don't say how status is checked. Third-party guides (Thrifty Traveler, updated Aug 13, 2026; UpgradedPoints) say you show a valid CAC marked 'Uniformed Services' at the airport.",
    "bags_leisure": "Active U.S. military get 2 checked bags up to 100 lb each, 1 overhead carry-on and oversize fees waived on the first two checked bags. Companions and dependents pay standard fees. The page doesn't limit this to orders, so it covers personal trips.",
    "bags_orders": "Same as personal travel; Sun Country publishes no separate allowance for orders or PCS. A third bag or more costs the standard fee. For four or more bags, call Reservations.",
    "other_perks": "A Sun Country 'stories' blog post says military members can board early on scheduled flights, but the help center doesn't confirm it. Sun Country also flies military charters (a separate business, not open to the public).",
    "how_to_book": "Book any fare on suncountry.com without adding bags. At the airport, check in at the counter with your CAC and ask for the active-military bag waiver.",
    "booking_url": "https://www.suncountry.com/help-center/bags-and-seats",
    "sources": [
      "https://www.suncountry.com/help-center/bags-and-seats",
      "https://www.suncountry.com/bags-optional-services",
      "https://www.suncountry.com/help-center/flights",
      "https://thriftytraveler.com/guides/airlines/sun-country-baggage-fees/",
      "https://stories.suncountry.com/post/honoring-veterans-lisa-krieg-s-journey-from-the-u-s-air-force-to-director-of-business-intelligence"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "None",
      "veteran_fare": "Nothing",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2 free",
      "status": "operating"
    }
  },
  {
    "airline": "Breeze Airways",
    "iata": "MX",
    "military_fares": "yes",
    "military_fare_details": "15% off base fares with a free WeSalute membership. The current WeSalute offer page says: round-trip bookings only, on flybreeze.com or the Breeze app, at least 7 days before travel, entering your unique WeSalute code at booking (it can't be added afterwards). It applies to No Flex fares and the Nice/Nicer/Nicest bundles and still earns BreezePoints. Book by Dec 4, 2026 for travel through Feb 10, 2027. Breeze's own site doesn't show this offer (flybreeze.com/wesalute returns 404), so all of this comes from WeSalute's offer page, the May 27, 2025 joint press release and UpgradedPoints (updated Jun 8, 2026).",
    "eligible": [
      "active_duty",
      "reserve",
      "national_guard",
      "veterans",
      "dependents"
    ],
    "veterans_note": "Veterans (and their immediate family) get the 15% WeSalute fare discount: free WeSalute membership, round-trip, 7+ days ahead, booking deadline Dec 4, 2026. They get NO free bags: Breeze's own Military Bag Allowance page says 'Regular bag charges will apply for all veterans, retired U.S. military members, ROTC, and spouses and families of active-duty members.'",
    "verification": "Discount: WeSalute verifies your status and gives you a code. Bags: check in at the ticket counter with a valid U.S. military ID, and show it again at the gate for the free carry-on and preboarding. [Breeze's own page]",
    "bags_leisure": "Active-duty U.S. military only: 1 carry-on and 2 checked bags free, checked bags up to 99 lb and 80 linear inches with no oversize or overweight charges. Don't add bags at booking; the counter handles it. [Breeze's own page]",
    "bags_orders": "Active duty traveling on orders: 1 carry-on and up to 5 checked bags free, same 99 lb / 80 in limits. [Breeze's own page]",
    "other_perks": "Active duty showing ID at the gate get courtesy preboarding (Breeze's own page). A third-party claim of 20% off inflight food was not verified.",
    "how_to_book": "1) Join WeSalute free at wesalute.com and verify your service. 2) Get your Breeze code from the WeSalute Breeze offer. 3) On flybreeze.com or the app, book a round trip at least 7 days out and enter the code before paying. Do this by Dec 4, 2026. 4) Active duty: skip adding bags, check in at the counter with your military ID and show it again at the gate.",
    "booking_url": "https://www.flybreeze.com/support?a=Military-Bag-Allowance---id--kMKKWo06TV-v1duTa_UAdg",
    "sources": [
      "https://www.flybreeze.com/support?a=Military-Bag-Allowance---id--kMKKWo06TV-v1duTa_UAdg",
      "https://www.flybreeze.com/support?a=Baggage-Prices-and-Dimensions---id--EvTT15-VRZWup0Ivwy_VhA",
      "https://www.wesalute.com/offer/51846-breeze-airways?g=military",
      "https://www.wesalute.com/about/press-release-archive/breeze-airways-wesalute-announce-exclusive-partnership-delivering-15",
      "https://www.wesalute.com/brands/breeze-airways",
      "https://upgradedpoints.com/news/breeze-airways-military-discount/"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "15% with free WeSalute (book by 4 Dec 2026)",
      "veteran_fare": "15% with free WeSalute",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2 free (5 on orders)",
      "status": "operating"
    }
  },
  {
    "airline": "Avelo Airlines",
    "iata": "XP",
    "military_fares": "yes",
    "military_fare_details": "Avelo's own WeSalute page lists 15% off with WeSalute and 30% off with WeSalute+. The WeSalute offer page adds: basic fares only (not taxes or some carrier fees), one-way or round-trip, new bookings only, no promo code (you start the search from WeSalute's member link and the price is built in), not combinable with other promotions, savings lost if you cancel, seats limited, and travel by 12/31/2027. Blackout dates on the 15% tier include 11/25/26, 12/23/26, 12/26/26 and 1/2/27; WeSalute says the 30% tier has none. WeSalute+ costs about $5/month or more (UpgradedPoints, not confirmed by Avelo).",
    "eligible": [
      "active_duty",
      "reserve",
      "national_guard",
      "veterans",
      "retirees",
      "dependents"
    ],
    "veterans_note": "Veterans and retirees get the WeSalute fare discount (15% with free WeSalute, 30% with WeSalute+). They get NO free bags or priority boarding; Avelo limits those to active duty. Avelo's page doesn't mention family for the discount; WeSalute says WeSalute+ covers immediate family.",
    "verification": "Discount: WeSalute checks your status. Bags and boarding: show a current active-duty military ID and the documents to an Avelo customer support crewmember (at the airport).",
    "bags_leisure": "Active duty on official OR personal travel: 1 carry-on and up to 2 checked bags free (max 70 lb each), with no excess, oversize or overweight charges. On flights with a one-checked-bag limit, it's 1 checked bag plus the carry-on, and embargoes may apply on some flights. [Avelo's own pages]",
    "bags_orders": "Same as personal travel; Avelo explicitly covers 'official or personal travel' with one allowance.",
    "other_perks": "Priority boarding for active duty.",
    "how_to_book": "1) Join WeSalute (free for 15%, WeSalute+ for 30% and no blackouts) and verify. 2) Open Avelo's offer in WeSalute and start your flight search from its member link (no code to type). 3) Avoid blackout dates on the 15% tier. 4) Active duty: show your ID at the airport for free bags and priority boarding.",
    "booking_url": "https://www.aveloair.com/wesalute",
    "sources": [
      "https://www.aveloair.com/wesalute",
      "https://www.aveloair.com/?p=3899",
      "https://www.aveloair.com/optional-services",
      "https://www.wesalute.com/offer/53726-avelo-airlines",
      "https://upgradedpoints.com/news/breeze-airways-military-discount/"
    ],
    "confidence": "high",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "15% free WeSalute / 30% WeSalute+",
      "veteran_fare": "15% / 30% with WeSalute",
      "veteran_free_bags": "No",
      "active_duty_bags_personal": "2 free + carry-on",
      "status": "operating"
    }
  },
  {
    "airline": "SATO Travel / Defense Travel System",
    "iata": "",
    "military_fares": "no",
    "military_fare_details": "DTS: NO for personal travel. The Defense Travel Management Office says service members, DoD civilians, their dependents and invitational travelers 'may use DTS for local and TDY, or government-funded leave'. It is for official, government-funded travel and you need a CAC/PKI login. GSA City Pair (government) fares can't be used for personal legs. Personal days added to an official trip (DoD calls this 'Leisure in Conjunction with Official Travel', LICWO) go through the trip's official travel agency (the DoD contract travel office); you pay the extra cost yourself, and it stays out of your DTS claim (DTMO guide). SATO: YES, through its leisure arm SatoVacations (CWTSatoTravel), a regular travel agency for 'active duty members, retirees, and military families'. It books flights, packages, cruises and tours by phone at 877-698-2554 (Mon–Fri 8–5 CT), by email or through a trip-request form. It publishes no special military airfare, and veterans aren't named. [Sources: travel.dod.mil, read in a browser; SatoVacations About page]",
    "eligible": [
      "active_duty",
      "retirees",
      "dependents"
    ],
    "veterans_note": "DTS: no access (it's for current service members and DoD civilians on official travel). SatoVacations: veterans who aren't retirees aren't named among its customers, so ask before relying on it. There is no military fare benefit either way.",
    "verification": "DTS: CAC/PKI login plus an account set up by your unit's Defense Travel Administrator. SatoVacations: no eligibility check is described on its pages.",
    "bags_leisure": "Not applicable; the airline's own military policy applies.",
    "bags_orders": "Not applicable. On orders, the airline's own allowance for orders applies (for example, Breeze up to 5 checked bags).",
    "other_perks": "None for personal travel. CWTSatoTravel's 2024 Army OCONUS contract includes standalone leisure travel at some overseas locations only.",
    "how_to_book": "Personal conference trips: don't use DTS. Book directly with the airline using its military or WeSalute route above. If a speaking trip comes with official orders, book the official part in DTS and ask the travel agency to add personal days; you pay the difference. For full-service vacation booking, call SatoVacations at 877-698-2554.",
    "booking_url": "https://www.travel.dod.mil/Programs/Defense-Travel-System/",
    "sources": [
      "https://www.travel.dod.mil/Programs/Defense-Travel-System/",
      "https://www.satovacations.com/aboutUs/aboutUs.aspx",
      "https://mycwt.com/news/pr/cwtsatotravel-awarded-five-year-us-army-oconus-contract",
      "https://media.defense.gov/2022/May/11/2002995246/-1/-1/0/DoD_DTS_Best_Practices_Guide_v8.1.PDF"
    ],
    "confidence": "medium",
    "last_verified": "2026-11-25",
    "quick": {
      "active_duty_fare": "None for personal trips",
      "veteran_fare": "None",
      "veteran_free_bags": "—",
      "active_duty_bags_personal": "Airline's policy",
      "status": "official travel only"
    }
  }
];

export type TravelerStatus = "veteran" | "active";

/**
 * Airlines whose military fare is only quoted by phone (or chat), for active duty: the ones "Have us call" rings.
 * DL, B6 and WN numbers come from the research above; AA, AS and HA are the airlines' main reservations lines
 * (`checked: false`) and need a look before the first real call. Veterans have no phone-only fare anywhere.
 */
export const MILITARY_CALL_DESKS: Record<string, { phone: string; desk: string; hours: string; checked: boolean }> = {
  DL: { phone: "+18003251771", desk: "Delta Military and Government Desk (falls back to 800-221-1212)", hours: "Mon–Fri 8:30am–5:30pm ET", checked: true },
  AA: { phone: "+18004337300", desk: "American Airlines Reservations", hours: "24 hours", checked: false },
  AS: { phone: "+18002527522", desk: "Alaska Airlines Reservations", hours: "24 hours", checked: false },
  HA: { phone: "+18003675320", desk: "Hawaiian Airlines Reservations", hours: "24 hours", checked: false },
  B6: { phone: "+18005382583", desk: "JetBlue (1-800-JETBLUE)", hours: "24 hours", checked: true },
  WN: { phone: "+18004359792", desk: "Southwest Airlines", hours: "24 hours", checked: true },
};

export const airlineByIata = (iata: string): MilitaryAirline | undefined =>
  MILITARY_AIRLINES.find((a) => a.iata && a.iata === iata.trim().toUpperCase());

/** What a traveler of this status gets on this airline, in a few words, and whether only a phone call gets the fare. */
export function perkFor(a: MilitaryAirline, status: TravelerStatus) {
  const flying = a.quick.status === "operating";
  const fare = status === "active" ? a.quick.active_duty_fare : a.quick.veteran_fare;
  const bags = status === "active" ? a.quick.active_duty_bags_personal : a.quick.veteran_free_bags;
  const phoneOnly = flying && status === "active" && !!MILITARY_CALL_DESKS[a.iata];
  return {
    iata: a.iata,
    airline: a.airline,
    flying,
    fare,
    bags,
    phoneOnly,
    howToBook: a.how_to_book,
    bookingUrl: a.booking_url,
    confidence: a.confidence,
    lastVerified: a.last_verified,
  };
}
export type MilitaryPerk = ReturnType<typeof perkFor>;
