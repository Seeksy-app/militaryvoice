import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipsLibrary } from "@/components/ClipsLibrary";
import { apiRequest } from "@/lib/queryClient";
import type { ClipRow, HostPostRow, RecordingRow } from "@shared/schema";
import { Wand2 } from "lucide-react";

// Pōstify → Clips (Andrew, 26 Nov: "put clips under Postify… like you do analytics with Podcast"): every clip they've
// made, newest first, with Post, Trim and the title on each card. Moved out of the Library, which is their media now.
// ?ep=<recording> opens one recording's clips.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

export function ClipsScreen() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [episode, setEpisode] = useState<number | null>(Number(q.get("ep")) || null);
  const { data: clips, isLoading } = useQuery<ClipRow[]>({ queryKey: ["/api/host/clips"], queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json() });
  const { data: posts } = useQuery<HostPostRow[]>({ queryKey: ["/api/host/posts"], queryFn: async () => (await apiRequest("GET", "/api/host/posts")).json() });
  const { data: recordings } = useQuery<RecordingRow[]>({ queryKey: ["/api/host/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json() });
  const n = clips?.length ?? 0;
  return (
    <section className="mt-4" data-testid="clips-screen">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight" style={HEAD}>Clips</h1>
          <p className="text-[14px] text-muted-foreground text-balance">{n ? `${n} ${n === 1 ? "clip" : "clips"} Pōstify made from your recordings. Post one, trim it or change its title.` : "The short clips Pōstify makes from your recordings show up here."}</p>
        </div>
        <a href="/host/dashboard/postify" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#053877] px-4 text-[14px] font-semibold text-white hover:bg-[#0a4aa0]" data-testid="clips-make"><Wand2 className="h-4 w-4" /> Make clips</a>
      </div>
      {isLoading ? null : <ClipsLibrary clips={clips ?? []} posts={posts ?? []} recordings={recordings ?? []} episode={episode} onEpisode={setEpisode} />}
    </section>
  );
}
