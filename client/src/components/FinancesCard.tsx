import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Slider } from "@/components/ui/slider";
import type { PublicEvent } from "@shared/schema";
import { PLANS } from "@shared/tokens";
import { Calculator, TrendingUp, AlertTriangle, Film, ChevronRight, Receipt, Plus, Trash2, Save } from "lucide-react";

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
  // The clip worker: a 2 vCPU / 4 GB box running ffmpeg. Held up for the day
  // itself plus a day of catch-up, because the last slot's clips are cut after
  // the last slot ends.
  workerPerHour: 0.09, workerHours: 48,
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
  /** This line moves with how many people watch. Everything else does not. */
  audience?: boolean;
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

  // Rendering the clips. Each segment is downloaded once and cut into wide,
  // vertical and square, which is ffmpeg time on a machine we rent by the
  // hour — the same work whether one person watched or a hundred thousand.
  const clipWorker = RATE.workerPerHour * RATE.workerHours;

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
    { label: "Connection minutes", note: `${Math.round(connMin).toLocaleString()} used · 150,000 included`, cost: connOver, big: connOver > 60, audience: true },
    { label: "Data transfer", note: `${Math.round(dataGb).toLocaleString()} GB · 250 GB included`, cost: dataOver, big: dataOver > 60, audience: true },
    { label: "Transcode", note: `${transMin.toLocaleString()} min · 600 included`, cost: transOver },
    { label: "Deepgram captions", note: `${(2 * minutes).toLocaleString()} stream-minutes, live`, cost: deepgram },
    { label: "Claude clip selection", note: `${slots} segments read and cut`, cost: claude },
    { label: "Clip rendering", note: `${RATE.workerHours} h of worker time · ffmpeg, three aspect ratios`, cost: clipWorker },
    { label: "Supabase Pro", note: "the plan itself", cost: RATE.supaPro, fixed: true },
    { label: "Cloudflare R2", note: `${Math.round(recGb)} GB of recordings · egress free`, cost: r2 },
    { label: "Supabase storage", note: `${Math.round(clipGb)} GB of clips · 8 GB included`, cost: storage },
    { label: "Supabase egress", note: `${Math.round(egressGb).toLocaleString()} GB served · 250 GB included`, cost: egress, audience: true },
    { label: "Upload-Post", note: "posting and social analytics · 25 profiles", cost: RATE.uploadPost, fixed: true },
    { label: "Vercel Pro", note: "the site and the API", cost: RATE.vercel, fixed: true },
    { label: "Resend", note: "the whole email cadence", cost: RATE.resend, fixed: true },
  ];
  const total = lines.reduce((n, l) => n + l.cost, 0);
  const fixed = lines.filter((l) => l.fixed).reduce((n, l) => n + l.cost, 0);
  // The split that actually decides the price of a show: recording, captioning
  // and cutting cost the same for an empty room as for a full one. Only the
  // three `audience` lines move, and only for people watching on our own page.
  const audience = lines.filter((l) => l.audience).reduce((n, l) => n + l.cost, 0);
  return { lines, total, fixed, variable: total - fixed, audience, flat: total - audience, slots, prerecGb };
}

// What one creator costs us a month, per plan (cost basis from Sep 2026
// bills; see the pricing-model notes). Clips run on our own renderer, so an
// episode's clips are ~$1.10 (4 clips) to ~$1.40 (6). The plan numbers come
// from shared/tokens.ts, so this can't drift from what's on sale.
const COST = {
  episode4: 1.1, // transcribe, pick moments, render 4 clips in three shapes, clean episode
  episode6: 1.4,
  uploadPost: 1.96, // $147 a month across 75 profiles, once they connect socials
  base: 1.0, // SmartLink, podcast hosting and storage, Ask my show's ~100 answers
  stripe: (price: number) => price * 0.029 + 0.3,
  studioHour: 1.7, // recording egress and calls
  liveHour: 1.2, // streaming out on top
};
const scaleEpisodes = PLANS.creator.credits / 8; // 8 credits an animated 4-clip episode
const proEpisodes = PLANS.pro.credits / 12; // 12 credits an animated 6-clip episode
const TIERS = [
  {
    name: "Growth", price: 0, cost: COST.base + COST.uploadPost,
    costNote: "free for good; the first Pōstify episode (~$1.10) once",
    bullets: ["SmartLink, podcast hosting, Ask my show", "Discovery: 10 contact emails a month", "Events with an SI co-host", "First episode of clips free"],
  },
  {
    name: PLANS.creator.name, price: PLANS.creator.cents / 100, pick: false,
    cost: scaleEpisodes * COST.episode4 + COST.uploadPost + COST.base + COST.stripe(PLANS.creator.cents / 100),
    costNote: `if all ${PLANS.creator.credits} credits are used (~${scaleEpisodes.toFixed(1)} episodes)`,
    bullets: [`${PLANS.creator.credits} credits a month`, `${PLANS.creator.clipsPerEpisode} clips an episode, every shape`, "Clean episode, posting and scheduling", "No MilitaryVoices bar on the SmartLink"],
  },
  {
    name: PLANS.pro.name, price: PLANS.pro.cents / 100, pick: true,
    cost: proEpisodes * COST.episode6 + COST.uploadPost + COST.base + COST.stripe(PLANS.pro.cents / 100),
    costNote: `if all ${PLANS.pro.credits} credits are used (~${proEpisodes.toFixed(1)} episodes)`,
    bullets: [`${PLANS.pro.credits} credits a month`, `${PLANS.pro.clipsPerEpisode} clips an episode, every shape`, "Clean episode, posting and scheduling", "No MilitaryVoices bar on the SmartLink"],
  },
];

export function FinancesCard({ event }: { event: PublicEvent }) {
  return (
    <div className="flex flex-col gap-8">
      <ActualCosts eventId={event.id} eventName={event.name} />

      <ProductionCosts eventId={event.id} />

    </div>
  );
}

/**
 * The platform owner's money, not any one event's: what the platform costs to
 * keep running each month, and what to charge (plans and running events for
 * others). Lives in the platform admin; an event's Finances shows only that
 * event's own costs.
 */
export function PlatformFinances() {
  return (
    <div className="flex flex-col gap-8">
      <ActualCosts scope="platform" eventName="the platform" starting={PLATFORM_STARTING} />

      {/* ---------------------------------------------------------- what to charge */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
          <TrendingUp className="h-4 w-4" /> The plans, and what each one costs us
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The three plans on the pricing page, with what one creator costs us a month at the most. Growth is the way in and
          costs a couple of dollars; the paid plans carry it. Monthly prices; yearly is two months free.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => {
            const margin = t.price ? Math.round(((t.price - t.cost) / t.price) * 100) : 0;
            return (
              <div
                key={t.name}
                className={`flex flex-col rounded-2xl border bg-card p-5 ${t.pick ? "border-2 border-[#F0A71F]" : "border-border"}`}
              >
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="mt-1 text-3xl font-bold tabular-nums">
                  {t.price ? `$${t.price}` : "Free"}
                  {t.price ? <span className="text-sm font-medium text-muted-foreground"> / month</span> : null}
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm text-muted-foreground">
                  {t.bullets.map((b) => (
                    <li key={b}>· {b}</li>
                  ))}
                </ul>
                <div className="mt-4 border-t border-border pt-3 text-xs tabular-nums text-muted-foreground">
                  costs up to {usd(t.cost)}{t.price ? <> · <span className="font-semibold text-emerald-700 dark:text-emerald-400">{margin}% margin</span></> : null}
                  <span className="mt-0.5 block">{t.costNote}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* The decision still open: Studio hours. The pricing notes put 4 hours in
            Scale and 10 plus live streaming in Pro; at today's rates that's the
            line that moves margin most, so it's shown before it's sold. */}
        <div className="mt-4 rounded-r-xl border-l-4 border-[#F0A71F] bg-[#F0A71F]/10 p-4 text-sm">
          <span className="font-semibold">Before Studio hours go into the plans:</span> 4 hours in Scale adds about{" "}
          {usd(4 * COST.studioHour)} a month (margin to{" "}
          {Math.round(((TIERS[1].price - TIERS[1].cost - 4 * COST.studioHour) / TIERS[1].price) * 100)}%), and 10 hours with
          live streaming in Pro adds about {usd(10 * (COST.studioHour + COST.liveHour))} (margin to{" "}
          {Math.round(((TIERS[2].price - TIERS[2].cost - 10 * (COST.studioHour + COST.liveHour)) / TIERS[2].price) * 100)}%).
          Extra hours at $2 each cover their cost.
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
                ["Sponsored marathon", "Everything, plus sponsor integration and a post-event report.", "$10,000", "~$1,100", "89%"],
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
          Cost excludes people. A produced event is a producer awake for the whole day, which is the real line item and the
          one to price properly before saying yes to a second booking.
        </p>
      </section>
    </div>
  );
}

type ProductionShow = {
  signupId: number; podcaster: string; show: string; onLineup: boolean;
  episode: string; episodeMinutes: number; clips: number; cutLabel: string;
  items: { label: string; note: string; cost: number }[]; total: number;
};

/**
 * What cutting the sent-in episodes cost: one row per show, opening to its
 * line items. Estimated from each file's length and size at published rates.
 */
export function ProductionCosts({ eventId }: { eventId: number }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const { data } = useQuery<{ shows: ProductionShow[]; total: number }>({
    queryKey: ["/api/admin/production-costs", eventId],
    queryFn: () => adminGet(`/api/admin/production-costs?eventId=${eventId}`),
  });
  const shows = data?.shows ?? [];
  const cents = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : usd(n));
  return (
    <section data-testid="production-costs">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Film className="h-4 w-4" /> Clips and editing
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        What it cost to fit each sent-in episode to its slot and cut its clips. Open a show for the line items.
      </p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        {shows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No episodes cut yet.</p>
        ) : (
          shows.map((s) => {
            const isOpen = !!open[s.signupId];
            return (
              <div key={s.signupId} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [s.signupId]: !o[s.signupId] }))}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/40"
                  aria-expanded={isOpen}
                  data-testid={`production-row-${s.signupId}`}
                >
                  <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.podcaster} · {s.show}
                      {!s.onLineup && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">off the lineup</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.episode || "Episode"} · {s.episodeMinutes} min · {s.clips} clips
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-sm">{cents(s.total)}</span>
                </button>
                {isOpen && (
                  <div className="bg-muted/20 pb-2">
                    {s.cutLabel && <p className="px-12 pt-1 text-xs text-muted-foreground">On air: {s.cutLabel.replace(/^.*\(broadcast cut,?\s*/, "broadcast cut, ").replace(/\)$/, "")}</p>}
                    {s.items.map((it) => (
                      <div key={it.label} className="flex items-start gap-3 px-12 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{it.label}</span>
                          <span className="block text-xs text-muted-foreground">{it.note}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">{it.cost === 0 ? "included" : cents(it.cost)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        {shows.length > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3 text-sm font-semibold">
            <span>{shows.length} episodes · {shows.reduce((n, s) => n + s.clips, 0)} clips</span>
            <span className="tabular-nums">{usd(data?.total ?? 0)}</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Estimated from each file's length and size: Scribe at $0.40 an hour of audio, Claude Opus 5 at $5 / $25 per million tokens, Sonnet 5 at $2 / $10, R2 at $0.015 a GB a month. Rendering runs on the VPS we already pay for.
      </p>
    </section>
  );
}


// ---------------------------------------------------------------------------
// What the event actually cost: a ledger kept by hand, each line marked as a
// real charge, an estimate, or "enter" (a bill we know exists but haven't
// read the amount of). Starts from what we know as of 6 Oct 2026.
// ---------------------------------------------------------------------------

type Actual = { group: string; label: string; note: string; amount: number; status: "actual" | "estimate" | "enter" };

// Only what this event itself cost: usage on the day and its own purchases.
// The platform's monthly plans (Render, Upload-Post, LiveKit, Supabase,
// Vercel, Resend) and its domains aren't the event's, so they aren't here.
/** The platform's own running costs (Sep–Oct 2026 bills), for the platform admin's Finances. */
const PLATFORM_STARTING: Actual[] = [
  { group: "Monthly plans", label: "Render worker (clips)", note: "4 CPU / 8 GB (4c-8g), cuts every clip", amount: 175, status: "actual" },
  { group: "Monthly plans", label: "Upload-Post", note: "75 profiles: posting, scheduling, analytics", amount: 147, status: "actual" },
  { group: "Monthly plans", label: "LiveKit Ship", note: "the plan; usage over the allowance is billed on top", amount: 50, status: "actual" },
  { group: "Monthly plans", label: "Supabase Pro", note: "database and file storage", amount: 25, status: "actual" },
  { group: "Monthly plans", label: "Vercel Pro", note: "the site and the API", amount: 20, status: "actual" },
  { group: "Monthly plans", label: "Resend", note: "every email", amount: 20, status: "actual" },
  { group: "Monthly plans", label: "SimpleTexting", note: "show-day texts, 500 a month (from Oct 2026)", amount: 39, status: "estimate" },
  { group: "Bought once", label: "Creatomate credits", note: "10,000 credits bought 25 Sep (before our own renderer)", amount: 0, status: "enter" },
  { group: "From the bank (Mercury)", label: "Telnyx", note: "15 Sep (account since suspended)", amount: 10, status: "actual" },
  { group: "From the bank (Mercury)", label: "GoDaddy", note: "25 Sep $13.19 and 30 Sep $2.19", amount: 15.38, status: "actual" },
];

const STARTING_ACTUALS: Actual[] = [
  { group: "Show-day usage", label: "Anthropic API", note: "topped up on show day (clip picks, Alex)", amount: 60, status: "actual" },
  { group: "Show-day usage", label: "Vercel usage over the plan", note: "on show day, about $15 of usage beyond the plan", amount: 15, status: "estimate" },
  { group: "Show-day usage", label: "LiveKit usage over the plan", note: "connection minutes and egress for 16 hours: read it from LiveKit billing", amount: 0, status: "enter" },
  { group: "Show-day usage", label: "ElevenLabs top-up", note: "voices for Alex's intros and spots; topped up on show day", amount: 0, status: "enter" },
  { group: "Show-day usage", label: "LiveAvatar credits", note: "Alex's video avatar; ran out on show day", amount: 0, status: "enter" },
  { group: "Show-day usage", label: "Cloudflare R2 storage", note: "about 45 GB: the day's recordings, the on-demand and every show's cut", amount: 0.7, status: "estimate" },
  { group: "Awards", label: "Excellence in Storytelling plaque", note: "9×12 walnut-finish plaque, full-colour brass plate with the NMPD logo, engraved", amount: 65, status: "estimate" },
  { group: "Awards", label: "Plaque shipping", note: "insured UPS Ground or USPS Priority, anywhere in the US, 2–5 days", amount: 18, status: "estimate" },
];

const STATUS_STYLE: Record<Actual["status"], string> = {
  actual: "border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  estimate: "border-[#F0A71F]/60 bg-[#F0A71F]/10 text-[#8a5f00] dark:text-[#F0A71F]",
  enter: "border-destructive/40 bg-destructive/10 text-destructive",
};
const STATUS_LABEL: Record<Actual["status"], string> = { actual: "Actual", estimate: "Estimate", enter: "Enter amount" };

function ActualCosts({ eventId = 0, eventName, scope = "event", starting = STARTING_ACTUALS }: { eventId?: number; eventName: string; scope?: "event" | "platform"; starting?: Actual[] }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ lines: Actual[] | null }>({
    queryKey: ["/api/admin/finance-actuals", scope, eventId],
    queryFn: () => adminGet(`/api/admin/finance-actuals?${scope === "platform" ? "scope=platform" : `eventId=${eventId}`}`),
  });
  const [lines, setLines] = useState<Actual[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    setLines(data.lines && data.lines.length ? data.lines : starting);
    setDirty(!(data.lines && data.lines.length));
  }, [data]);

  const edit = (i: number, patch: Partial<Actual>) => { setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l))); setDirty(true); };
  const remove = (i: number) => { setLines((ls) => ls.filter((_, k) => k !== i)); setDirty(true); };
  const add = () => { setLines((ls) => [...ls, { group: "Other", label: "", note: "", amount: 0, status: "actual" }]); setDirty(true); };
  const save = async () => {
    setSaving(true);
    await adminSend("PUT", "/api/admin/finance-actuals", { ...(scope === "platform" ? { scope } : { eventId }), lines });
    await qc.invalidateQueries({ queryKey: ["/api/admin/finance-actuals", scope, eventId] });
    setSaving(false);
    setDirty(false);
  };

  const sum = (f: (l: Actual) => boolean) => lines.filter(f).reduce((n, l) => n + (Number(l.amount) || 0), 0);
  const total = sum(() => true);
  const actual = sum((l) => l.status === "actual");
  const estimate = sum((l) => l.status === "estimate");
  const missing = lines.filter((l) => l.status === "enter").length;
  const groups = Array.from(new Set(lines.map((l) => l.group)));

  return (
    <section data-testid="finance-actuals">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Receipt className="h-4 w-4" /> {scope === "platform" ? "What the platform costs each month" : `What ${eventName} actually cost`}
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {scope === "platform"
          ? "The plans and services that keep MilitaryVoices.ai running, whatever the events. Each event's own costs are under that event's Finances. Change any amount or mark it actual once the bill is in; red lines are bills we know about but haven't read yet."
          : "Only this event's own costs: usage on the day and what was bought for it, like the award. The platform's monthly plans are in the platform admin, under Finances. Change any amount or mark it actual once the bill is in; red lines are bills we know about but haven't read yet."}
      </p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g}>
                    <tr className="bg-muted/40"><td colSpan={4} className="px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{g}</td></tr>
                    {lines.map((l, i) => l.group !== g ? null : (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="w-full px-5 py-2">
                          <input value={l.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder="What" className="w-full bg-transparent font-medium outline-none" />
                          <input value={l.note} onChange={(e) => edit(i, { note: e.target.value })} placeholder="Note" className="w-full bg-transparent text-xs text-muted-foreground outline-none" />
                        </td>
                        <td className="px-2 py-2">
                          <select value={l.status} onChange={(e) => edit(i, { status: e.target.value as Actual["status"] })} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[l.status]}`} aria-label="Actual or estimate">
                            {(["actual", "estimate", "enter"] as const).map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <span className="inline-flex items-center rounded-lg border border-border px-2 py-1 tabular-nums">$<input type="number" step="0.01" min="0" value={l.amount} onChange={(e) => edit(i, { amount: Number(e.target.value) })} className="w-20 bg-transparent text-right outline-none" aria-label={`Amount for ${l.label}`} /></span>
                        </td>
                        <td className="pr-4"><button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${l.label}`}><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-foreground">
                  <td className="px-5 py-3 font-semibold">Total so far</td>
                  <td />
                  <td className="px-2 py-3 text-right text-base font-semibold tabular-nums" data-testid="finance-actual-total">{usd(total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          {[["Actual", usd(actual), "real charges and plan prices"], ["Estimates", usd(estimate), "until the bills come in"], ["Still to enter", String(missing), missing === 1 ? "bill to read" : "bills to read"]].map(([k, v, n]) => (
            <div key={k} className="bg-card p-4"><div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{k}</div><div className="mt-0.5 text-xl font-bold tabular-nums">{v}</div><div className="text-xs text-muted-foreground">{n}</div></div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#053877] hover:underline dark:text-[#9cc2ff]"><Plus className="h-4 w-4" /> Add a line</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#000741] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" data-testid="button-save-actuals"><Save className="h-4 w-4" />{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </div>
    </section>
  );
}
