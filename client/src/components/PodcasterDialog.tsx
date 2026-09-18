import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { deriveSocialAccounts, isPlainWebsite } from "@shared/socialLinks";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { resolveUploadUrl, apiRequest } from "@/lib/queryClient";
import type { PublicSignup } from "@shared/schema";
import { formatDateInZone, formatTimeInZone, zoneLabel } from "@/lib/schedule";
import { Mic2, Globe, Youtube, Radio, PlayCircle, CalendarClock } from "lucide-react";

interface LatestEpisode {
  title: string;
  audioUrl: string;
  pubDate: string;
  durationLabel: string;
}

interface Props {
  signup: PublicSignup | null;
  onAirStart?: Date;
  onAirEnd?: Date;
  zone: string;
  shareText?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function toHref(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}
function linkLabel(v: string): string {
  return v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** Bio popup for a podcaster on the agenda: photo, links, latest episode, actions. */
export function PodcasterDialog({ signup, onAirStart, onAirEnd, zone, shareText, open, onOpenChange }: Props) {
  const { data: episode, isLoading: episodeLoading } = useQuery<LatestEpisode | null>({
    queryKey: ["/api/signups", signup?.id ?? 0, "latest-episode"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signups/${signup!.id}/latest-episode`);
      return res.json();
    },
    enabled: open && !!signup?.id && !!signup?.rssUrl,
    staleTime: 10 * 60 * 1000,
  });

  if (!signup) return null;
  const socials = deriveSocialAccounts(
    parseSocialAccounts(signup.socialAccounts),
    signup.socialLinks,
    signup.youtubeUrl,
  );
  // A pasted Instagram link is now an Instagram button, so showing it again as
  // a generic globe beside it is the same link twice.
  const showWebsite = !!signup.socialLinks && isPlainWebsite(signup.socialLinks);
  const hasLinks = !!(signup.socialLinks || signup.rssUrl || signup.youtubeUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-lg" data-testid="dialog-podcaster">
        {/* header */}
        <div className="relative overflow-hidden bg-[#053877] px-6 pb-6 pt-7 text-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#F0A71F] opacity-25 blur-3xl"
          />
          <div className="relative flex items-start gap-4">
            {signup.photoUrl ? (
              <img
                src={resolveUploadUrl(signup.photoUrl)}
                alt={signup.hostName}
                className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-[#F0A71F]/50"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Mic2 className="h-8 w-8" />
              </div>
            )}
            <div className="min-w-0 pt-1">
              <DialogHeader className="space-y-0 text-left">
                <DialogTitle
                  className="text-xl font-bold leading-tight text-white"
                  style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
                >
                  {signup.podcastName}
                </DialogTitle>
                <DialogDescription className="text-sm text-white/75">
                  with {signup.hostName}
                  {signup.numPeople > 1 && " and co-host"}
                </DialogDescription>
              </DialogHeader>
              {onAirStart && onAirEnd && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 tabular-nums text-xs font-semibold">
                  <CalendarClock className="h-3 w-3 text-[#F0A71F]" />
                  {formatDateInZone(onAirStart, zone)} · {formatTimeInZone(onAirStart, zone)}–{formatTimeInZone(onAirEnd, zone)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-6 pb-6">
          {signup.showFormat === "prerecorded" && (
            <Badge variant="outline" className="w-fit gap-1 border-primary/40 font-normal text-primary">
              <PlayCircle className="h-3 w-3" /> Pre-recorded episode
            </Badge>
          )}

          {/* latest episode player */}
          {signup.rssUrl && (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Radio className="h-3.5 w-3.5 text-primary" /> Latest episode
              </div>
              {episodeLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : episode ? (
                <>
                  <p className="text-sm font-medium leading-snug text-card-foreground">{episode.title}</p>
                  {(episode.pubDate || episode.durationLabel) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {episode.pubDate ? new Date(episode.pubDate).toLocaleDateString() : ""}
                      {episode.pubDate && episode.durationLabel ? " · " : ""}
                      {episode.durationLabel}
                    </p>
                  )}
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio controls preload="none" src={episode.audioUrl} className="mt-3 w-full" data-testid="audio-latest-episode" />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Couldn't load the feed right now.{" "}
                  <a href={toHref(signup.rssUrl)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Open it directly
                  </a>
                  .
                </p>
              )}
            </div>
          )}

          {/* follow */}
          {(socials.length > 0 || hasLinks) && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Follow the show</div>
              <SocialIconRow accounts={socials} size="md" variant="filled" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {showWebsite && (
                  <a
                    href={toHref(signup.socialLinks)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-elevate"
                  >
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    <span className="truncate">{linkLabel(signup.socialLinks)}</span>
                  </a>
                )}
                {signup.youtubeUrl && !socials.some((a) => a.platform === "youtube") && (
                  <a
                    href={toHref(signup.youtubeUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-elevate"
                  >
                    <Youtube className="h-3.5 w-3.5 text-[#FF0000]" /> YouTube
                  </a>
                )}
              </div>
            </div>
          )}

          {/* reminder / share */}
          <div className="border-t border-border pt-4">
            <AgendaSignupActions signup={signup} shareText={shareText ?? signup.podcastName} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
