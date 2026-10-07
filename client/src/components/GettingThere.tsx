import { useState } from "react";
import { ArrowRight, BedDouble, ExternalLink, Loader2, Luggage, MapPin, Plane, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Getting there (7 Oct): on an in-person event's page, what flying in costs
// from the visitor's airport (Google Flights, arriving the day before), the
// military travel perks airlines and hotels offer, and hotels near the venue.
// Google only has public fares; military fares and bag allowances are the
// airlines' own, so we link to each one's terms rather than guess at them.

type Fares = {
  from: string; to: string; outbound: string; inbound: string;
  lowest: number | null; typical: [number, number] | null; level: string;
  options: { airline: string; price: number; stops: number; minutes: number; departs: string }[];
  googleUrl: string;
};

/** Each airline's own words on military travel. Delta's page is linked directly; the rest search their own site, so the link is always current. */
const AIRLINES: { name: string; url: string }[] = [
  { name: "Alaska", url: "https://www.google.com/search?q=site%3Aalaskaair.com+military+baggage" },
  { name: "American", url: "https://www.google.com/search?q=site%3Aaa.com+military+baggage" },
  { name: "Delta", url: "https://www.delta.com/us/en/baggage/additional-baggage-information/military-baggage" },
  { name: "JetBlue", url: "https://www.google.com/search?q=site%3Ajetblue.com+military+baggage" },
  { name: "Southwest", url: "https://www.google.com/search?q=site%3Asouthwest.com+military+baggage" },
  { name: "United", url: "https://www.google.com/search?q=site%3Aunited.com+military+baggage" },
];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const hrs = (m: number) => (m ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : "");
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function GettingThere({ eventId, venueName, venueAddress, airport, startAtUtc, durationHours }: {
  eventId: number; venueName: string; venueAddress: string; airport: string; startAtUtc: string; durationHours: number;
}) {
  const [from, setFrom] = useState(() => { try { return localStorage.getItem("mv_home_airport") ?? ""; } catch { return ""; } });
  const [fares, setFares] = useState<Fares | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; googleUrl?: string } | null>(null);
  const place = [venueName, venueAddress].filter(Boolean).join(", ");
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  const start = new Date(startAtUtc);
  const checkIn = new Date(start.getTime() - 24 * 3600_000).toISOString().slice(0, 10);
  const checkOut = new Date(start.getTime() + (durationHours + 24) * 3600_000).toISOString().slice(0, 10);
  const hotelsUrl = `https://www.google.com/travel/search?q=${encodeURIComponent(`hotels near ${place}`)}&checkin=${checkIn}&checkout=${checkOut}`;

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = from.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) { setError({ message: "Enter your airport's three-letter code, like DFW or SAN." }); return; }
    setBusy(true); setError(null); setFares(null);
    try { localStorage.setItem("mv_home_airport", code); } catch { /* fine */ }
    try {
      const r = await fetch(`/api/events/${eventId}/fares?from=${code}`);
      const d = await r.json();
      if (!r.ok) setError(d); else setFares(d as Fares);
    } catch {
      setError({ message: "Couldn't reach Google Flights just now." });
    }
    setBusy(false);
  };

  return (
    <section id="getting-there" className="scroll-mt-16 border-b border-border" data-testid="getting-there">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a5a00] dark:text-[#F0A71F]">Getting there</p>
        <h2 className="mt-2 text-balance text-3xl font-bold text-foreground sm:text-4xl" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>Join us in person</h2>
        <a href={mapUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-start gap-2 text-base text-foreground/80 hover:text-foreground hover:underline" data-testid="getting-there-map">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#053877] dark:text-[#9cc2ff]" /> {place}
        </a>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* Fares (when the event has an airport) */}
          {airport ? <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold"><Plane className="h-5 w-5 text-[#053877] dark:text-[#9cc2ff]" /> Flights into {airport}</h3>
            <p className="mt-1 text-sm text-muted-foreground">Round trip, arriving the day before and flying home the day after.</p>
            <form onSubmit={(e) => void look(e)} className="mt-4 flex gap-2">
              <Input value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} maxLength={3} placeholder="Your airport: DFW" aria-label="Your home airport's three-letter code" className="h-11 w-44 text-base uppercase" data-testid="fares-from" />
              <Button type="submit" disabled={busy} className="h-11 gap-2 rounded-full bg-[#053877] px-5 text-white hover:bg-[#0a4a99]" data-testid="fares-go">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check fares"}</Button>
            </form>
            {error && (
              <p className="mt-3 text-sm text-red-600">{error.message} {error.googleUrl && <a href={error.googleUrl} target="_blank" rel="noreferrer" className="font-semibold underline">Search Google Flights</a>}</p>
            )}
            {fares && (
              <div className="mt-5" data-testid="fares-result">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  {fares.lowest && <p><span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">From</span><span className="text-3xl font-bold tabular-nums">{money(fares.lowest)}</span></p>}
                  {fares.typical && <p className="text-sm text-muted-foreground">Usually {money(fares.typical[0])} to {money(fares.typical[1])}</p>}
                  {fares.level && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${fares.level === "low" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : fares.level === "high" ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-muted text-muted-foreground"}`}>Prices are {fares.level} right now</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{fares.from} to {fares.to}, {dayLabel(fares.outbound)} to {dayLabel(fares.inbound)}</p>
                {fares.options.length > 0 && (
                  <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
                    {fares.options.map((o, i) => (
                      <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{o.airline}</span>
                        <span className="hidden text-muted-foreground sm:inline">{o.stops === 0 ? "Nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}{o.minutes ? ` · ${hrs(o.minutes)}` : ""}</span>
                        <span className="font-semibold tabular-nums">{money(o.price)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!fares.options.length && !fares.lowest && <p className="mt-3 text-sm text-muted-foreground">Google didn't find flights for those days.</p>}
                <a href={fares.googleUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">See them all on Google Flights <ArrowRight className="h-4 w-4" /></a>
                <p className="mt-2 text-xs text-muted-foreground">Public fares from Google Flights, per person. Military fares, if your airline has them, are on its own site or by phone.</p>
              </div>
            )}
          </div> : <div />}

          <div className="space-y-6">
            {/* Military perks */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-[#053877] dark:text-[#9cc2ff]" /> Flying military</h3>
              <p className="mt-1 text-sm text-muted-foreground"><Luggage className="mr-1 inline h-4 w-4" />Most major US airlines waive bag fees for active-duty service members, and some offer military fares. Terms differ by airline, and some apply only on orders, so check yours before you book.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {AIRLINES.map((a) => (
                  <a key={a.name} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm hover:border-[#053877]/40">{a.name} <ExternalLink className="h-3 w-3 text-muted-foreground" /></a>
                ))}
              </div>
            </div>
            {/* Hotels */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 font-semibold"><BedDouble className="h-5 w-5 text-[#053877] dark:text-[#9cc2ff]" /> Hotels nearby</h3>
              <p className="mt-1 text-sm text-muted-foreground">Many hotel chains have a military rate: ask for it, and bring your ID.</p>
              <a href={hotelsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">Hotels near the venue <ArrowRight className="h-4 w-4" /></a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
