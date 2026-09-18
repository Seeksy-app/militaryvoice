import { useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import type { PublicEvent } from "@shared/schema";
import { Calculator, TrendingUp, AlertTriangle } from "lucide-react";

// What the event costs to run, and what to charge afterwards.
//
// Every rate is published pricing, read on 17 September 2026, and every total
// is arithmetic you can check — the same model as scripts/event-costs.mjs, so
// the page and the script can't drift into disagreeing with each other.
//
// The whole bill turns on one number nobody knows yet: how many people watch
// on our own page at once. So that number is a control, not an assumption.

const RATE = {
  ship: 50, connInc: 150_000, connOver: 0.0005,
  dataInc: 250, dataOver: 0.12,
  transInc: 600, transOver: 0.02,
  deepgram: 0.0048,
  claudeIn: 5 / 1e6, claudeOut: 25 / 1e6,
  supaPro: 25, storeInc: 8, storeOver: 0.125, egIncl: 250, egCached: 0.03,
  r2PerGb: 0.015,
  vercel: 20, resend: 20, uploadPost: 50,
};
const VIEWER_MBPS = 1.3;
const RTMP_MBPS = 3.5;
const DESTINATIONS = 3;
const mbPerMin = (mbps: number) => (mbps * 60) / 8;

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

interface Line {
  label: string;
  note: string;
  cost: number;
  fixed?: boolean;
  big?: boolean;
}

function model(viewers: number, hours: number, slotMin: number, prerecorded: number) {
  const minutes = hours * 60;
  const slots = Math.max(1, Math.floor(minutes / slotMin));

  const connMin = 2 * minutes + 2 * minutes + viewers * minutes;
  const connOver = Math.max(0, connMin - RATE.connInc) * RATE.connOver;

  const viewerGb = (viewers * minutes * mbPerMin(VIEWER_MBPS)) / 1024;
  const rtmpGb = (DESTINATIONS * minutes * mbPerMin(RTMP_MBPS)) / 1024;
  const dataGb = viewerGb + rtmpGb;
  const dataOver = Math.max(0, dataGb - RATE.dataInc) * RATE.dataOver;

  const transMin = minutes + slots * slotMin;
  const transOver = Math.max(0, transMin - RATE.transInc) * RATE.transOver;

  const deepgram = 2 * minutes * RATE.deepgram;
  const claude = slots * (7000 * RATE.claudeIn + 2500 * RATE.claudeOut);

  const recGb = (slots * slotMin * mbPerMin(VIEWER_MBPS)) / 1024;
  const clipGb = (slots * 4 * 3 * 8) / 1024;
  const r2 = recGb * RATE.r2PerGb;
  const storage = Math.max(0, clipGb - RATE.storeInc) * RATE.storeOver;
  // Pre-recorded segments play from storage to every viewer's own browser.
  const prerecGb = (prerecorded * slotMin * viewers * mbPerMin(VIEWER_MBPS)) / 1024;
  const egressGb = prerecGb + clipGb;
  const egress = Math.max(0, egressGb - RATE.egIncl) * RATE.egCached;

  const lines: Line[] = [
    { label: "LiveKit Ship", note: "the plan itself", cost: RATE.ship, fixed: true },
    { label: "Connection minutes", note: `${Math.round(connMin).toLocaleString()} used · 150,000 included`, cost: connOver, big: connOver > 60 },
    { label: "Data transfer", note: `${Math.round(dataGb).toLocaleString()} GB · 250 GB included`, cost: dataOver, big: dataOver > 60 },
    { label: "Transcode", note: `${transMin.toLocaleString()} min · 600 included`, cost: transOver },
    { label: "Deepgram captions", note: `${(2 * minutes).toLocaleString()} stream-minutes, live`, cost: deepgram },
    { label: "Claude clip selection", note: `${slots} segments read and cut`, cost: claude },
    { label: "Supabase Pro", note: "the plan itself", cost: RATE.supaPro, fixed: true },
    { label: "Cloudflare R2", note: `${Math.round(recGb)} GB of recordings · egress free`, cost: r2 },
    { label: "Supabase storage", note: `${Math.round(clipGb)} GB of clips · 8 GB included`, cost: storage },
    { label: "Supabase egress", note: `${Math.round(egressGb).toLocaleString()} GB served · 250 GB included`, cost: egress },
    { label: "Upload-Post", note: "posting and social analytics · 25 profiles", cost: RATE.uploadPost, fixed: true },
    { label: "Vercel Pro", note: "the site and the API", cost: RATE.vercel, fixed: true },
    { label: "Resend", note: "the whole email cadence", cost: RATE.resend, fixed: true },
  ];
  const total = lines.reduce((n, l) => n + l.cost, 0);
  const fixed = lines.filter((l) => l.fixed).reduce((n, l) => n + l.cost, 0);
  return { lines, total, fixed, variable: total - fixed, slots, prerecGb };
}

const TIERS = [
  { name: "Keep the lights on", price: 19, cost: 8.09, bullets: ["2 hours live a month", "Your studio stays yours", "Archive and clips stay up", "1 destination"] },
  { name: "Watchfloor", price: 49, cost: 30.19, pick: true, bullets: ["6 hours live a month", "Clips on every episode", "Guests get their own recording", "3 destinations · your logo"] },
  { name: "Network", price: 349, cost: 187.38, bullets: ["25 hours, unlimited shows", "8 destinations · 5 seats", "Per-host dashboards", "Priority clip turnaround"] },
];

export function FinancesCard({ event }: { event: PublicEvent }) {
  const [viewers, setViewers] = useState(100);
  const hours = event.durationHours || 24;
  const slotMin = event.slotMinutes || 30;
  // Matches the current booking pattern; a rough input, and it only moves the
  // storage-egress line.
  const [prerecorded, setPrerecorded] = useState(13);

  const m = useMemo(() => model(viewers, hours, slotMin, prerecorded), [viewers, hours, slotMin, prerecorded]);
  const perViewer = useMemo(() => {
    const step = model(viewers + 10, hours, slotMin, prerecorded);
    return Math.max(0, (step.total - m.total) / 10);
  }, [viewers, hours, slotMin, prerecorded, m.total]);

  return (
    <div className="flex flex-col gap-8">
      {/* ------------------------------------------------------------ the model */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
          <Calculator className="h-4 w-4" /> What {event.name} costs to run
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Published rates, read 17 September 2026. The whole bill turns on one number: how many people watch on our own
          page at once. Everyone watching on YouTube instead is free.
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums" data-testid="finance-viewers">{viewers.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">average concurrent viewers on the watch page</span>
            </div>
            <Slider
              className="mt-4"
              min={10}
              max={600}
              step={10}
              value={[viewers]}
              onValueChange={([v]) => setViewers(v)}
              data-testid="slider-finance-viewers"
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
              <span>10</span><span>150</span><span>300</span><span>450</span><span>600</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {m.lines.map((l) => (
                  <tr key={l.label} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      {l.fixed && (
                        <span className="mr-2 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          fixed
                        </span>
                      )}
                      {l.label}
                      <span className="block text-xs text-muted-foreground">{l.note}</span>
                    </td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${l.big ? "font-semibold text-destructive" : ""}`}>
                      {usd(l.cost)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-foreground">
                  <td className="px-5 py-3 font-semibold">Total for the month of the event</td>
                  <td className="px-5 py-3 text-right text-base font-semibold tabular-nums" data-testid="finance-total">
                    {usd(m.total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
            {[
              ["Fixed monthly", usd0(m.fixed), "plans we pay anyway"],
              ["Caused by the event", usd0(m.variable), "usage on top"],
              ["Per podcast slot", usd(m.variable / m.slots), `${m.slots} slots`],
            ].map(([k, v, n]) => (
              <div key={k} className="bg-card p-4">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{k}</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums">{v}</div>
                <div className="text-xs text-muted-foreground">{n}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-r-xl border-l-4 border-[#F0A71F] bg-[#F0A71F]/10 p-4 text-sm">
          <p>
            <span className="font-semibold">The lever.</span> A viewer on YouTube costs nothing — the feed out to
            YouTube, X and Twitch is flat whether four people watch or forty thousand. A viewer on our own page costs
            about <span className="font-semibold tabular-nums">{usd(perViewer)}</span> for the day. Point the promotion
            at YouTube and the bill stops moving.
          </p>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" />
          <span>
            Pre-recorded segments play from storage to every viewer separately — about{" "}
            <span className="tabular-nums">{Math.round(m.prerecGb).toLocaleString()} GB</span> across {prerecorded}{" "}
            recorded slots at this audience. The money is small; object storage not being a video CDN is the part worth
            rehearsing before the day. Every minute of show is also transcoded twice, once for the broadcast and once
            for the recording — the single biggest saving available is one egress doing both.
          </span>
        </div>
      </section>

      {/* ---------------------------------------------------------- what to charge */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
          <TrendingUp className="h-4 w-4" /> What to charge for the rest of the year
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Priced in hours, because hours are what cost. "Unlimited streaming" is what the competition sells and these
          rates don't support it honestly — a podcaster doing 25 hours a month costs $187 to serve.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => {
            const margin = Math.round(((t.price - t.cost) / t.price) * 100);
            return (
              <div
                key={t.name}
                className={`flex flex-col rounded-2xl border bg-card p-5 ${t.pick ? "border-2 border-[#F0A71F]" : "border-border"}`}
              >
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="mt-1 text-3xl font-bold tabular-nums">
                  ${t.price}
                  <span className="text-sm font-medium text-muted-foreground"> / month</span>
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm text-muted-foreground">
                  {t.bullets.map((b) => (
                    <li key={b}>· {b}</li>
                  ))}
                </ul>
                <div className="mt-4 border-t border-border pt-3 text-xs tabular-nums text-muted-foreground">
                  costs {usd(t.cost)} · <span className="font-semibold text-emerald-700 dark:text-emerald-400">{margin}% margin</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-r-xl border-l-4 border-[#F0A71F] bg-[#F0A71F]/10 p-4 text-sm">
          <span className="font-semibold">Half price for verified veteran-owned shows and registered nonprofits</span>,
          permanently, stated on the pricing page rather than hidden behind a code. It is the only pricing decision here
          that anyone will repeat to someone else.
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-5 py-3 font-medium">Running an event for someone else</th>
                <th className="px-5 py-3 text-right font-medium">Price</th>
                <th className="px-5 py-3 text-right font-medium">Our cost</th>
                <th className="px-5 py-3 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Self-serve event", "Platform only. They run their own control room.", "$1,500", "~$250", "83%"],
                ["Produced event", "We staff the studio, build the rail, cut the clips, hand over the archive.", "$5,000", "~$600", "88%"],
                ["Sponsored 24-hour marathon", "Everything, plus sponsor integration and a post-event report.", "$10,000", "~$1,100", "89%"],
              ].map(([name, note, price, cost, margin]) => (
                <tr key={name} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    {name}
                    <span className="block text-xs text-muted-foreground">{note}</span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{price}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{cost}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{margin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cost excludes people. A produced event is a producer awake for 24 hours, which is the real line item and the
          one to price properly before saying yes to a second booking.
        </p>
      </section>
    </div>
  );
}
