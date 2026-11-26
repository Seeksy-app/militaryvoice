// Which brand logo files we hold in client/public/logos/ (Andrew, 26 Nov 2026: real logos beside factual perk info,
// local copies from Wikimedia Commons, sources in client/public/logos/SOURCES.json). A brand not listed shows its name.
const AIRLINE = new Set<string>(["AA", "AS", "B6", "DL", "F9", "G4", "HA", "MX", "NK", "UA", "WN", "XP"]);
// Only Delta and American have a square mark on Commons; the rest show their initials in the circle.
const AIRLINE_MARK = new Set<string>(["AA", "DL"]);
const HOTEL = new Set<string>(["best-western", "choice", "disney", "drury", "extended-stay", "hilton", "hyatt", "ihg", "loews", "marriott", "motel-6", "radisson", "red-roof", "wyndham"]);

export const airlineLogo = (iata: string) => (AIRLINE.has(iata) ? `/logos/airlines/${iata}.svg` : null);
export const airlineMark = (iata: string) => (AIRLINE_MARK.has(iata) ? `/logos/airlines/${iata}-mark.svg` : null);
export const hotelLogo = (key: string) => (HOTEL.has(key) ? `/logos/hotels/${key}.svg` : null);
