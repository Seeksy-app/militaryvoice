import { useEffect, useState } from "react";
import { BadgeCheck, Wand2, Type as TypeIcon, AtSign, Search, SlidersHorizontal, Plus, Share2, Users, ChevronDown, Bookmark } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";
import { CAST, type CastKey } from "./fakeCamera";

// Discovery, as a picture: the search bar with AI search typing its question,
// the results table as the real page lays it out, and one creator's profile
// opened over it. Sample people and sample numbers — the shape is the product's.

type Row = {
  key: CastKey;
  platform: SocialPlatform;
  followers: string;
  growth: number[];
  growthPct: string;
  er: string;
  quality: number;
  country: string;
  verified?: string;
  handle?: string;
  branch: string;
};

const ROWS: Row[] = [
  { key: "marcus", platform: "youtube", followers: "184K", growth: [3, 4, 4, 6, 7, 9, 12], growthPct: "+18.4%", er: "4.82%", quality: 91, country: "🇺🇸 United States", verified: "The Long Watch", branch: "Army" },
  { key: "andre", platform: "instagram", followers: "96.2K", growth: [4, 5, 5, 6, 6, 8, 9], growthPct: "+11.2%", er: "6.10%", quality: 88, country: "🇺🇸 United States", verified: "After the Uniform", branch: "Marine Corps" },
  { key: "dana", platform: "instagram", followers: "52.7K", growth: [5, 5, 6, 6, 7, 7, 8], growthPct: "+7.9%", er: "5.34%", quality: 86, country: "🇺🇸 United States", handle: "homefronthour", branch: "Navy spouse" },
  { key: "kim", platform: "tiktok", followers: "241K", growth: [2, 3, 5, 6, 8, 11, 13], growthPct: "+24.6%", er: "8.75%", quality: 79, country: "🇺🇸 United States", handle: "kimrowe.usaf", branch: "Air Force" },
  { key: "sofia", platform: "youtube", followers: "38.9K", growth: [6, 6, 6, 7, 7, 7, 8], growthPct: "+3.1%", er: "3.96%", quality: 84, country: "🇨🇦 Canada", handle: "sofiareyes", branch: "Army Reserve" },
];

const QUERY = "Army and Marine veterans who talk about life after service";

function Spark({ points }: { points: number[] }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 56},${18 - ((p - min) / Math.max(1, max - min)) * 16}`).join(" ");
  return (
    <svg viewBox="0 0 56 20" className="h-5 w-14" aria-hidden="true">
      <polyline points={d} fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Types the question out, pauses, and starts again — as the real page's demo does. */
function useTyped(text: string) {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let i = 0;
    let hold = 0;
    const t = setInterval(() => {
      if (i < text.length) setN(++i);
      else if (++hold > 60) { i = 0; hold = 0; setN(0); }
    }, 55);
    return () => clearInterval(t);
  }, [text]);
  return text.slice(0, n);
}

export function DiscoverySearchMock() {
  const typed = useTyped(QUERY);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_40px_80px_-40px_rgba(5,56,119,0.45)]" aria-hidden="true">
      {/* Search bar */}
      <div className="border-b border-border bg-gradient-to-b from-[#f5f7fc] to-card p-3 dark:from-[#0b1433] sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { icon: Wand2, label: "AI search", on: true },
            { icon: TypeIcon, label: "Keywords in bio" },
            { icon: AtSign, label: "Username" },
          ].map(({ icon: Icon, label, on }) => (
            <span key={label} className={`${label === "Username" ? "hidden sm:inline-flex" : "inline-flex"} items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-[#053877] text-white" : "text-muted-foreground"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 shadow-sm">
          <span className="hidden items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-medium sm:inline-flex">
            <PlatformIcon platform="instagram" className="h-3.5 w-3.5" /> All platforms <ChevronDown className="h-3 w-3" />
          </span>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {typed}
            <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
          </span>
          <span className="hidden rounded-lg bg-[#F0A71F] px-3 py-1.5 text-xs font-semibold text-[#1a1200] sm:inline">Search</span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"><SlidersHorizontal className="h-3 w-3" /> Filters</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#F0A71F]/50 bg-[#F0A71F]/10 px-2 py-0.5 font-medium text-[#8a5a00] dark:text-[#F0A71F]"><BadgeCheck className="h-3 w-3" /> Verified military</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">Audience in US ≥ 60%</span>
          <span className="hidden rounded-full border border-border px-2 py-0.5 text-muted-foreground sm:inline">10K–500K followers</span>
          <span className="hidden rounded-full border border-border px-2 py-0.5 text-muted-foreground md:inline">Credibility ≥ 75</span>
        </div>
      </div>

      {/* Results */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground lg:pr-12">
        <span><span className="font-semibold text-foreground">1,284</span> creators match</span>
        <span className="inline-flex items-center gap-1 rounded-lg bg-[#2563eb] px-2 py-1 font-medium text-white"><Plus className="h-3 w-3" /> Add 3 to list</span>
      </div>
      <table className="w-full text-sm">
        <thead className="border-y border-border bg-muted/40 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
          <tr>
            <th className="py-2 pl-4 pr-2 text-left font-medium">Creator</th>
            <th className="px-2 py-2 text-right font-medium">Followers</th>
            <th className="hidden px-2 py-2 text-left font-medium md:table-cell">Growth</th>
            <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">ER %</th>
            <th className="hidden py-2 pl-2 pr-4 text-right font-medium sm:table-cell lg:pr-12">Quality</th>
            <th className="hidden py-2 pl-2 pr-4 text-left font-medium md:table-cell lg:hidden">Aud. country</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ROWS.map((r, i) => {
            const p = CAST[r.key];
            return (
              <tr key={r.key} className={i < 3 ? "bg-[#053877]/[0.035] dark:bg-white/[0.03]" : ""}>
                <td className="py-2.5 pl-4 pr-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <img src={p.face} alt="" loading="lazy" className={`h-9 w-9 shrink-0 rounded-full object-cover ${r.verified ? "ring-2 ring-[#F0A71F] ring-offset-2 ring-offset-card" : ""}`} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1">
                        <span className="truncate font-medium">{p.name}</span>
                        {r.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#F0A71F]" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{r.verified ?? `@${r.handle}`} · {r.branch}</span>
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums">
                  <span className="inline-flex items-center gap-1.5"><PlatformIcon platform={r.platform} className="h-3.5 w-3.5" /> {r.followers}</span>
                </td>
                <td className="hidden whitespace-nowrap px-2 py-2.5 md:table-cell">
                  <span className="inline-flex items-center gap-2"><Spark points={r.growth} /><span className="text-xs tabular-nums text-muted-foreground">{r.growthPct}</span></span>
                </td>
                <td className="hidden whitespace-nowrap px-2 py-2.5 text-right tabular-nums sm:table-cell">{r.er}</td>
                <td className="hidden whitespace-nowrap py-2.5 pl-2 pr-4 text-right tabular-nums text-muted-foreground sm:table-cell lg:pr-12">{r.quality}/100</td>
                <td className="hidden whitespace-nowrap py-2.5 pl-2 pr-4 text-xs md:table-cell lg:hidden">{r.country}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ label, pct, color = "#053877" }: { label: string; pct: number; color?: string }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 text-xs">
      <span className="truncate">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></span>
      <span className="text-right tabular-nums text-muted-foreground">{pct}%</span>
    </li>
  );
}

export function CreatorProfileMock() {
  const p = CAST.marcus;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_40px_80px_-30px_rgba(3,11,31,0.55)]" aria-hidden="true">
      <div className="relative h-16 bg-[linear-gradient(120deg,#000741,#053877_60%,#0a4a99)]">
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[10px] font-semibold text-[#1a1200]"><BadgeCheck className="h-3 w-3" /> Verified on MilitaryVoices</span>
      </div>
      <div className="relative px-4 pb-4">
        <div className="flex items-end gap-3">
          <img src={p.face} alt="" className="-mt-8 h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-card" />
          <div className="min-w-0 pt-2">
            <p className="flex items-center gap-1 truncate text-base font-semibold">{p.name} <BadgeCheck className="h-4 w-4 text-[#F0A71F]" /></p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><PlatformIcon platform="youtube" className="h-3 w-3" /> The Long Watch · Army</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-border">
          {[
            ["Followers", "184K", ""],
            ["Engagement", "4.82%", "text-emerald-600 dark:text-emerald-400"],
            ["Credibility", "91%", "text-emerald-600 dark:text-emerald-400"],
            ["Real reach", "142K", ""],
          ].map(([l, v, c]) => (
            <div key={l} className="-mb-px -mr-px border-b border-r border-border px-3 py-2">
              <p className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{l}</p>
              <p className={`text-lg font-semibold tabular-nums tracking-tight ${c}`}>{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Audience</p>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-full">
          <span className="bg-[#053877]" style={{ width: "68%" }} />
          <span className="bg-[#F0A71F]" style={{ width: "32%" }} />
        </div>
        <p className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>68% men</span><span>32% women</span></p>
        <ul className="mt-2.5 flex flex-col gap-1.5">
          <Bar label="United States" pct={78} />
          <Bar label="Canada" pct={6} />
          <Bar label="Ages 25–34" pct={41} color="#F0A71F" />
          <Bar label="Ages 35–44" pct={29} color="#F0A71F" />
        </ul>
        <div className="mt-3.5 flex items-center gap-1.5">
          <span className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#2563eb] py-1.5 text-xs font-medium text-white"><Bookmark className="h-3.5 w-3.5" /> Add to list</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs"><Share2 className="h-3.5 w-3.5" /> Share</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs"><Users className="h-3.5 w-3.5" /> 12 lookalikes</span>
        </div>
      </div>
    </div>
  );
}
