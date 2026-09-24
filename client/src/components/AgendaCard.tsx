import { ArrowRight, Check, Mic2, Play, Radio } from "lucide-react";
import type { PublicSignup } from "@shared/schema";
import type { Marker } from "@shared/mileMarkers";
import { deriveSocialAccounts } from "@shared/socialLinks";
import { MileMarker } from "@/components/MileMarker";
import { SponsorRibbon } from "@/components/SponsorRibbon";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { resolveUploadUrl } from "@/lib/queryClient";
import { formatTimeInZone } from "@/lib/schedule";

// One booked slot, as the agenda shows it — and the home page's lineup, which
// is the same card so the two never drift apart.

/**
 * What the strip on a slot actually says. It used to read "Live" on every
 * claimed slot regardless of the clock or the format, so a pre-recorded
 * episode three weeks out announced itself as on air. Amber is reserved for
 * a show that is genuinely on right now; everything else states the format
 * or that it has been and gone.
 */
export function SlotBadge({ start, end, showFormat, now }: { start: Date; end: Date; showFormat?: string; now: number }) {
  const recorded = showFormat === "prerecorded";
  const onAir = now >= start.getTime() && now < end.getTime();
  const over = now >= end.getTime();

  if (onAir) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-[#1a1200]">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1a1200] opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1a1200]" />
        </span>
        On air
      </span>
    );
  }

  const quiet = "inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-white/85";
  if (over) {
    return (
      <span className={quiet}>
        <Check className="h-3 w-3" /> Aired
      </span>
    );
  }
  return (
    <span className={quiet}>
      {recorded ? <Play className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
      {recorded ? "Recorded" : "Live"}
    </span>
  );
}

export function AgendaCard({
  signup,
  index,
  marker,
  start,
  end,
  onAir,
  zone,
  now,
  shareText,
  onSelect,
}: {
  signup: PublicSignup;
  /** The slot index, for test ids and the agenda's deep links. */
  index: number;
  marker: Marker;
  /** The block as shown on the bar (the closing sequence runs short). */
  start: Date;
  end: Date;
  /** The on-air window under the socials; null hides it. */
  onAir: { start: Date; end: Date } | null;
  zone: string;
  now: number;
  shareText: string;
  onSelect: (signup: PublicSignup) => void;
}) {
  return (
    <div
                              data-testid={`row-agenda-${index}`}
      className="flex h-full flex-col overflow-hidden rounded-2xl border-2 border-primary/15 bg-card shadow-md transition-shadow hover:shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 bg-[#053877] px-3 py-2 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <MileMarker marker={marker} size={42} className="shrink-0" />
          <span className="whitespace-nowrap text-sm font-bold tabular-nums">
            {formatTimeInZone(start, zone)}
            <span className="text-white/60">
              {" – "}
              {formatTimeInZone(end, zone)}
            </span>
          </span>
        </div>
        <SlotBadge
          start={start}
          end={end}
          showFormat={signup.showFormat}
          now={now}
        />
      </div>

      {signup.sponsor && <SponsorRibbon sponsor={signup.sponsor} source="agenda" testId={`card-sponsor-${index}`} />}

      {(() => {
        const co = signup.coHost ?? null;
        const firstOf = (n: string) => n.trim().split(/\s+/)[0] || n;
        // The co-host's dialog is built from their profile;
        // a show name that is just their own first name
        // ("Jane ") means they never set one, so the show
        // they are on is used instead.
        const asSignup = (): PublicSignup => ({
          ...signup,
          coHost: null,
          hostName: co!.hostName,
          photoUrl: co!.photoUrl,
          podcastName:
            co!.podcastName.trim() && co!.podcastName.trim().toLowerCase() !== firstOf(co!.hostName).toLowerCase()
              ? co!.podcastName
              : signup.podcastName,
          socialLinks: co!.socialLinks,
          rssUrl: co!.rssUrl,
          youtubeUrl: co!.youtubeUrl,
          socialAccounts: co!.socialAccounts,
        });
        const avatar = (url: string, alt: string, cls: string) =>
          url ? (
            <img src={resolveUploadUrl(url)} alt={alt} className={`${cls} rounded-full object-cover`} />
          ) : (
            <div className={`${cls} flex items-center justify-center rounded-full bg-accent text-accent-foreground`}>
              <Mic2 className="h-6 w-6" />
            </div>
          );
        if (!co) {
          return (
            <button
              type="button"
              onClick={() => onSelect(signup)}
              className="flex items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40"
              data-testid={`button-profile-${index}`}
            >
              {avatar(signup.photoUrl, signup.hostName, "h-16 w-16 shrink-0 ring-4 ring-[#F0A71F]/40")}
              <span className="min-w-0">
                <span className="line-clamp-2 block font-semibold leading-tight text-card-foreground">
                  {signup.podcastName}
                </span>
                <span className="block truncate text-sm text-muted-foreground">with {signup.hostName}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  View profile <ArrowRight className="h-3 w-3" />
                </span>
              </span>
            </button>
          );
        }
        // Two people: the second sits lower and to the
        // right of the first, so the pair takes less width
        // than two full circles and both names fit beside
        // it. Each face and each name opens its own profile.
        return (
          <div className="flex items-start gap-3 p-4" data-testid={`card-profiles-${index}`}>
            <span className="relative h-[5.5rem] w-24 shrink-0">
              <button
                type="button"
                onClick={() => onSelect(signup)}
                className="absolute left-0 top-0"
                aria-label={`${signup.hostName}'s profile`}
                data-testid={`button-profile-${index}`}
              >
                {avatar(signup.photoUrl, signup.hostName, "h-16 w-16 ring-4 ring-[#F0A71F]/40")}
              </button>
              <button
                type="button"
                onClick={() => onSelect(asSignup())}
                className="absolute left-10 top-6"
                aria-label={`${co.hostName}'s profile`}
                data-testid={`button-cohost-profile-${index}`}
              >
                {avatar(co.photoUrl, co.hostName, "h-14 w-14 ring-4 ring-card")}
              </button>
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 block font-semibold leading-tight text-card-foreground">
                {signup.podcastName}
              </span>
              <span className="line-clamp-2 block text-sm text-muted-foreground">
                with {signup.hostName} & {co.hostName}
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium text-primary">
                <button type="button" onClick={() => onSelect(signup)} className="inline-flex items-center gap-1 hover:underline">
                  {firstOf(signup.hostName)}'s profile <ArrowRight className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => onSelect(asSignup())} className="inline-flex items-center gap-1 hover:underline">
                  {firstOf(co.hostName)}'s profile <ArrowRight className="h-3 w-3" />
                </button>
              </span>
            </span>
          </div>
        );
      })()}

      <div className="mt-auto flex flex-col gap-3 px-4 pb-4">
        {/* Connected accounts plus anything placeable from the links they
            pasted at signup — only five of eighteen shows have
            connected, so reading connected-only left most cards
            with no follow buttons while the profile showed them. */}
        <SocialIconRow
          accounts={deriveSocialAccounts(
            parseSocialAccounts(signup.socialAccounts),
            signup.socialLinks,
            signup.youtubeUrl,
          )}
        />
        {onAir && (
          <div className="text-xs text-muted-foreground" data-testid={`text-agenda-onair-${index}`}>
            On air {formatTimeInZone(onAir.start, zone)}–{formatTimeInZone(onAir.end, zone)}
          </div>
        )}
        <div className="border-t border-border pt-3">
          <AgendaSignupActions signup={signup} shareText={shareText} />
        </div>
      </div>
    </div>
  );
}
