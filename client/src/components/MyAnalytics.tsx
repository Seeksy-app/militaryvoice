import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Share2, BarChart3, Link2 } from "lucide-react";
import { CreatorProfileSections, type Profile } from "@/components/CreatorProfileSections";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { KnowYourWorth } from "@/components/KnowYourWorth";
import { usePodcastSources } from "@/components/PodcastStats";

/**
 * A podcaster's own analytics, in their dashboard: the same profile panel a
 * brand sees in Discovery, about them. Share, not "Add to list" — this is
 * theirs to send to a sponsor.
 */
interface Mine {
  none?: boolean;
  platform?: string;
  handle?: string;
  partial?: string;
  profile?: Profile;
  card?: { name: string; picture: string; verified?: { show: string } | null; branch?: string } | null;
}

const compact = (n: number | null | undefined) =>
  n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

export function MyAnalytics({ onConnect }: { onConnect: () => void }) {
  const { toast } = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const q = useQuery<Mine>({
    queryKey: ["/api/host/my-analytics"],
    queryFn: async () => (await apiRequest("GET", "/api/host/my-analytics")).json(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  // Their connected accounts (followers per platform) for Know your worth, and their own photo as the fallback picture.
  const podSources = usePodcastSources();
  const social = useQuery<{ accounts?: { platform: string; username?: string; followers?: number }[] }>({ queryKey: ["/api/host/social"], queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(), staleTime: 5 * 60_000 });
  const mine = useQuery<{ photoUrl?: string }>({ queryKey: ["/api/host/profile"], queryFn: async () => (await apiRequest("GET", "/api/host/profile")).json(), staleTime: 5 * 60_000 });
  const [picFailed, setPicFailed] = useState<string[]>([]);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }
  if (q.error || q.data?.none || !q.data?.profile) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center" data-testid="my-analytics-empty">
        <BarChart3 className="mx-auto h-8 w-8 text-[#053877]" />
        <p className="mt-3 font-semibold text-foreground">Connect the account you post from</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          We read your Instagram, YouTube or TikTok and show you what a sponsor sees: real reach, audience quality, who's watching and where.
        </p>
        <Button className="mt-4 gap-1.5 rounded-full" onClick={onConnect}><Link2 className="h-4 w-4" /> Connect accounts</Button>
      </div>
    );
  }

  const d = q.data;
  const p = d.profile!;
  const id = p.identity;
  const share = async () => {
    const url = `${window.location.origin}/discover?creator=${encodeURIComponent(`${d.platform}:${d.handle}`)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Send it to a sponsor — anyone can open it." });
    } catch {
      toast({ title: "Copy this link", description: url });
    }
  };

  const toolbar = (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-6 py-2.5 backdrop-blur">
      <span className="text-sm font-semibold text-foreground">Your analytics</span>
      <span className="text-sm text-muted-foreground">· what a sponsor sees</span>
      <Button size="sm" variant="ghost" onClick={() => void share()} className="ml-auto h-8 gap-1.5 rounded-lg bg-muted/70 font-medium" data-testid="my-analytics-share">
        <Share2 className="h-4 w-4" /> Share
      </Button>
    </div>
  );
  // The index's picture links expire after a day or so; when it won't load, their own MilitaryVoices photo stands in.
  const pictures = [id.picture, d.card?.picture, mine.data?.photoUrl].filter((u): u is string => !!u).map((u) => (u.startsWith("/api/") ? u : resolveUploadUrl(u)));
  const picture = pictures.find((u) => !picFailed.includes(u)) ?? "";
  const header = (
    <div className="border-b-8 border-muted/60 bg-card px-6 py-6 sm:px-8">
      <div className="flex items-start gap-5">
        {picture ? (
          <img key={picture} src={picture} alt="" onError={() => setPicFailed((f) => [...f, picture])} className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-[#F0A71F] ring-offset-2 ring-offset-background" />
        ) : (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#053877] text-2xl font-bold text-white ring-2 ring-[#F0A71F] ring-offset-2 ring-offset-background">{(id.name || d.handle || "?").slice(0, 1).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight text-balance">{id.name || d.card?.name || d.handle}</span>
            <BadgeCheck className="h-5 w-5 text-[#F0A71F]" />
            <span className="text-sm text-[#2563eb]">@{d.handle}</span>
          </div>
          {id.bio && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{id.bio}</p>}
          <p className="mt-2 text-sm"><b className="font-semibold">{compact(id.followers)}</b> <span className="text-muted-foreground">followers</span></p>
          {d.card?.verified?.show && (
            <span className="mt-3 inline-flex items-center gap-1 rounded-md border border-[#F0A71F]/50 bg-[#F0A71F]/10 px-2 py-0.5 text-xs font-medium text-[#8a5a00]">
              <BadgeCheck className="h-3.5 w-3.5" /> Verified on MilitaryVoices · {d.card.verified.show}
            </span>
          )}
          {d.partial && <p className="mt-2 text-xs text-muted-foreground">Your audience numbers are still being read — check back later.</p>}
        </div>
      </div>
    </div>
  );

  // Every connected account, with the full audience data on the one the index read.
  const s = p.signals as { engagementRate?: number | null; realPct?: number | null; topCountry?: { name: string; pct: number } | null };
  const usPct = s.topCountry?.name === "United States" ? s.topCountry.pct : (p.audiences?.followers?.countries ?? []).find((c: { name: string }) => c.name === "United States")?.pct ?? null;
  const main = { platform: d.platform ?? "", handle: d.handle, followers: id.followers ?? 0, engagementRate: s.engagementRate ?? null, medianViews: p.content?.reelsMedianViews ?? null, realPct: s.realPct ?? null, usPct, likesPerPost: p.content?.likesMedian ?? null };
  const others = (social.data?.accounts ?? []).filter((x) => x.platform !== main.platform && (x.followers ?? 0) > 0).map((x) => ({ platform: x.platform, handle: x.username, followers: x.followers ?? 0 }));
  // The podcast's own rate: downloads for a typical recent episode (the median of the last ten that have any).
  const pod = podSources.map((src) => {
    const counts = (src.data?.episodes ?? []).slice().sort((x, y) => y.published.localeCompare(x.published)).slice(0, 10).map((e) => e.count).filter((n) => n > 0).sort((x, y) => x - y);
    return counts.length ? { name: src.showName || "Your podcast", perEpisode: counts[Math.floor(counts.length / 2)] } : null;
  }).filter(Boolean).sort((x, y) => y!.perEpisode - x!.perEpisode)[0] ?? null;
  const worth = <KnowYourWorth accounts={[main, ...others]} podcast={pod} />;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm" data-testid="my-analytics">
      <div ref={scroller} className="max-h-[calc(100vh-9rem)] overflow-y-auto">
        <CreatorProfileSections
          profile={p}
          toolbar={toolbar}
          header={<>{header}{worth}</>}
          cardEngagement={null}
          scrollRoot={scroller}
          onOpenCreator={() => {}}
          similar={null}
          own
        />
      </div>
    </div>
  );
}
