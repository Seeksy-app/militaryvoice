import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

// The Marathon, after the day: this year's award and the keepsake magazine,
// at the top of /marathon. The sponsors are thanked further down the page.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const GOLD = "#F0A71F";

export function MarathonRecap() {
  return (
    <section className="border-b border-border bg-[#eef2fa] dark:bg-[#07112e]" data-testid="marathon-recap">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-14 sm:px-6">
        {/* This year's award. */}
        <div className="overflow-hidden rounded-2xl bg-[#000741] text-white shadow-sm ring-1 ring-black/5" data-testid="marathon-award">
          <div className="grid items-center md:grid-cols-[1.1fr_1.2fr_0.7fr]">
            <img src="/home/onair-rachel.jpg" alt="Rachel Oswalt, live on National Military Podcast Day" className="aspect-video h-full w-full object-cover md:aspect-auto" loading="lazy" />
            <div className="p-6 md:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>2026 Excellence in Storytelling</p>
              <h2 className="mt-3 text-balance text-2xl font-bold sm:text-3xl" style={HEAD}>Rachel Oswalt</h2>
              <p className="mt-2 text-pretty text-white/80">Host of <span className="font-semibold text-white">Your Story Doesn't End Here</span>, the military mental health podcast. Chosen out of every show on National Military Podcast Day 2026.</p>
            </div>
            <div className="flex justify-center bg-[#0b1650] p-5">
              <img src="/email/award-storytelling-2026.jpg" alt="The 2026 Excellence in Storytelling plaque, presented to Rachel Oswalt" className="max-h-60 w-auto rounded-md shadow-xl" loading="lazy" />
            </div>
          </div>
        </div>
        {/* The keepsake magazine. */}
        <div className="grid items-center gap-6 overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 dark:bg-[#0d1838] md:grid-cols-[auto_1fr]">
          <img src="/home/voices-cover.jpg" alt="VOICES of the Military, the keepsake magazine cover" className="mx-auto max-h-64 w-auto -rotate-2 rounded-md shadow-xl" loading="lazy" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8a5a00]">The keepsake magazine</p>
            <h2 className="mt-2 text-balance text-2xl font-bold text-foreground sm:text-3xl" style={HEAD}>VOICES of the Military</h2>
            <p className="mt-2 text-pretty text-muted-foreground">Every show from the day in one keepsake edition, with a player for each episode. Out this Friday.</p>
            <Link href="/keepsake"><Button className="mt-4 bg-[#F0A71F] font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="button-recap-keepsake"><BookOpen className="mr-2 h-4 w-4" />Get your free digital copy</Button></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
