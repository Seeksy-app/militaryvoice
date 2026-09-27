import { useState } from "react";
import { ChevronDown, DollarSign } from "lucide-react";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";
import { worthFor, isWorthPlatform, type WorthInput } from "@/lib/worth";

const money = (n: number) => `$${n.toLocaleString()}`;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n));

/**
 * Know your worth: a rate for each kind of sponsored post, per platform, in
 * the layout creators know from Social Bluebook: a tab per account, then the
 * suggested price with a low and a high. `accounts` are the connected ones;
 * the one with full audience data (the analytics account) carries its
 * engagement, views, real followers and US share into its rates.
 */
export function KnowYourWorth({ accounts }: { accounts: (WorthInput & { handle?: string; likesPerPost?: number | null })[] }) {
  const list = accounts.filter((a) => isWorthPlatform(a.platform) && a.followers > 0).sort((a, b) => b.followers - a.followers);
  const [pick, setPick] = useState(0);
  const [how, setHow] = useState(false);
  if (!list.length) return null;
  const a = list[Math.min(pick, list.length - 1)];
  const w = worthFor(a);
  if (!w) return null;
  return (
    <section className="border-b-8 border-muted/60 bg-card px-6 py-6 sm:px-8" data-testid="know-your-worth">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><DollarSign className="h-5 w-5 text-emerald-600" /> Know your worth</h2>
        <span className="text-sm text-muted-foreground">what to ask a brand for one sponsored post</span>
      </div>

      {/* A tab per account. */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]" role="tablist">
        {list.map((x, i) => (
          <button key={`${x.platform}-${i}`} type="button" role="tab" aria-selected={i === pick} onClick={() => setPick(i)} className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${i === pick ? "border-[#053877] text-foreground dark:border-white" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`worth-tab-${x.platform}`}>
            <PlatformIcon platform={x.platform as SocialPlatform} className="h-4 w-4" /> {platformLabel(x.platform as SocialPlatform)}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {a.handle && <span className="font-semibold">@{a.handle.replace(/^@/, "")}</span>}
        <span className="rounded-full bg-[#053877]/[0.08] px-2.5 py-0.5 text-xs font-semibold text-[#053877] dark:bg-white/10 dark:text-white">{w.tier}</span>
        <span><b className="tabular-nums">{compact(a.followers)}</b> <span className="text-muted-foreground">followers</span></span>
        {a.engagementRate != null && <span><b className="tabular-nums">{a.engagementRate.toFixed(2)}%</b> <span className="text-muted-foreground">engagement</span></span>}
        {a.likesPerPost != null && <span><b className="tabular-nums">{compact(Math.round(a.likesPerPost))}</b> <span className="text-muted-foreground">likes per post</span></span>}
      </div>

      <div className={`grid gap-3 ${w.deliverables.length >= 3 ? "sm:grid-cols-3" : w.deliverables.length === 2 ? "sm:grid-cols-2" : "sm:max-w-sm"}`}>
        {w.deliverables.map((d) => (
          <div key={d.key} className="rounded-2xl border border-border bg-background p-4 text-center" data-testid={`worth-${w.platform}-${d.key}`}>
            <p className="text-sm font-semibold">{d.label}</p>
            <p className="text-xs text-muted-foreground">{d.hint}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{money(d.mid)}</p>
            {d.high > d.low ? (
              <div className="mt-2 flex justify-center gap-6 text-xs">
                <span><span className="text-muted-foreground">Low</span> <b className="tabular-nums">{money(d.low)}</b></span>
                <span><span className="text-muted-foreground">High</span> <b className="tabular-nums">{money(d.high)}</b></span>
              </div>
            ) : <p className="mt-2 text-xs text-muted-foreground">A starting point at this size</p>}
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setHow((v) => !v)} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" aria-expanded={how} data-testid="worth-how">
        How we work it out <ChevronDown className={`h-3.5 w-3.5 transition-transform ${how ? "rotate-180" : ""}`} />
      </button>
      {how && (
        <div className="mt-2 rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <p>We start from what sponsors typically pay creators of your size on {platformLabel(w.platform as SocialPlatform)}, per 1,000 followers, then adjust for how your audience behaves:</p>
          <ul className="mt-1.5 space-y-0.5">
            {w.factors.map((f) => (
              <li key={f.label}><b className="text-foreground">{f.label}</b> ×{f.value.toFixed(2)}: {f.why}</li>
            ))}
          </ul>
          <p className="mt-1.5">Low and high are 20% either side. Packages of several posts usually go for less per post; usage rights, exclusivity and a quick turnaround add to it. It's a starting point for the conversation, not a quote.</p>
        </div>
      )}
    </section>
  );
}
