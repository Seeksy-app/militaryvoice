import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ZoomConnect, ImportLink } from "@/components/ZoomConnect";
import { LiveSettings, StreamInBlock } from "@/components/LiveSettings";
import { PodcastStatsRows, useHostedHere } from "@/components/PodcastStats";
import { platformLabel, formatFollowers, ALL_PLATFORMS } from "@/components/SocialIcons";
import { BrandMark, BrandGroup } from "@/components/BrandMark";
import type { ProfileRow, SocialAccount } from "@shared/schema";
import { Check, ChevronDown, Headphones, Link2, Radio, RefreshCw, Share2, Video, Webhook } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * Integrations as lists you read down: your social accounts, where your
 * episodes come from, and going out live. It used to be cards and tiles in
 * no particular order, with the YouTube live connector buried at the foot.
 */
export function IntegrationsScreen({
  social,
  profile,
  onConnectSocial,
  connecting,
  onRefreshSocial,
  refreshing,
  onOpenPodcastStats,
  youtubeLocked,
}: {
  social?: { configured: boolean; accounts: SocialAccount[] };
  profile?: ProfileRow | null;
  onConnectSocial: () => void;
  connecting: boolean;
  onRefreshSocial: () => void;
  refreshing: boolean;
  onOpenLibrary: () => void;
  /** Podcast analytics, where the numbers from this section show up. */
  onOpenPodcastStats: () => void;
  youtubeLocked: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#import-link");
  const accounts = social?.accounts ?? [];
  const { ready: hostedReady, hosted: hostedHere } = useHostedHere();
  return (
    <section className="mt-6" data-testid="integrations-screen">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Link2 className="h-4 w-4" /> Integrations
      </h2>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">Everything MilitaryVoices.ai connects to, in one list. Connect once; disconnect any time.</p>

      {/* Two halves by direction (Andrew, 24 Nov: "that's coming in. The other ones are going out"). */}
      <Overline>Going out</Overline>
      {social?.configured && (
        <Group
          id="section-social-accounts"
          icon={<Share2 className="h-4 w-4" />}
          title="Social media"
          line="Where your clips and episodes post, and the follow buttons on your card in the lineup."
          action={
            <div className="flex items-center gap-1">
              {accounts.length > 0 && (
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={onRefreshSocial} disabled={refreshing} data-testid="button-social-refresh">
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8 gap-1 rounded-full px-3 text-xs" onClick={onConnectSocial} disabled={connecting} data-testid="button-social-connect">
                {connecting ? "Opening…" : accounts.length ? "Manage accounts" : "Connect accounts"}
              </Button>
            </div>
          }
        >
          {ALL_PLATFORMS.map((platform) => {
            const a = accounts.find((x) => x.platform === platform);
            const handle = a ? (a.username && !/^\d+$/.test(a.username) ? `@${a.username}` : a.displayName || platformLabel(platform)) : "";
            const followers = a ? formatFollowers(a.followers) : null;
            return (
              <Row
                key={platform}
                testId={`row-social-${platform}`}
                icon={
                  // Each network's own mark in its own colours (Andrew, 22 Nov: "use all the right icon branding").
                  a?.image ? (
                    <span className="relative">
                      <img src={a.image} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover ring-1 ring-border" />
                      <span className="absolute -bottom-1 -right-1"><BrandMark brand={platform} tile className="h-3 w-3" tileClassName="h-5 w-5 rounded-full ring-2 ring-card" /></span>
                    </span>
                  ) : (
                    <BrandMark brand={platform} tile className="h-5 w-5" tileClassName="h-10 w-10 rounded-xl" />
                  )
                }
                name={platformLabel(platform)}
                // LinkedIn's handle is the page it posts as (Upload-Post's pin; switch it under Manage accounts).
                line={a ? <><span className="font-medium text-foreground">{handle}</span>{followers ? ` · ${followersText(a.followers)}` : ""}</> : "Not connected"}
                right={
                  // Connected or Connect, nothing else: disconnecting and switching live under Manage accounts
                  // (Andrew, 23 Nov: the ↗ "always makes me think that's where I would go to manage").
                  a ? (
                    <Connected />
                  ) : (
                    <Button variant="outline" size="sm" className="h-8 rounded-full px-3.5 text-xs" onClick={onConnectSocial} disabled={connecting}>Connect</Button>
                  )
                }
              />
            );
          })}
        </Group>
      )}

      {/* Live streaming, under social media: both go out (Andrew, 24 Nov, regroup mockup "Yes, build it"). */}
      <div id="section-going-out-live" className="mb-8 scroll-mt-24" data-testid="section-going-out-live">
        <div className="mb-2.5">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground"><Radio className="h-4 w-4" /> Live streaming</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">Where your live shows go. Pick them per show when you go live; your Radio slot goes to your YouTube too.</p>
        </div>
        <LiveSettings />
      </div>

      <Overline>Coming in</Overline>
      {/* Every way a show made somewhere else lands in the Library, together: Zoom, StreamYard/Restream/OBS, Zapier.
          Upload a video left this page: it's the Upload button in the Library (Andrew, 24 Nov: "not an integration"). */}
      <Group
        id="section-content"
        icon={<Video className="h-4 w-4" />}
        title="Recordings"
        line="Shows you make somewhere else land in your Library, ready for Pōstify."
      >
        <ZoomConnect row />
        <StreamInBlock />
        <div id="import-link" className="scroll-mt-24">
          <Row
            testId="row-import-link"
            icon={<IconTile icon={Webhook} />}
            name="Zapier"
            line="Or any app that can send a video's link. Each one comes into your Library."
            right={
              <Button variant="outline" size="sm" className="h-8 gap-1 rounded-full px-3.5 text-xs" onClick={() => setLinkOpen((v) => !v)} aria-expanded={linkOpen} data-testid="button-import-link-toggle">
                {linkOpen ? "Hide" : "Set up"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${linkOpen ? "rotate-180" : ""}`} />
              </Button>
            }
          >
            {linkOpen && <div className="mt-4"><ImportLink bare /></div>}
          </Row>
        </div>
      </Group>

      {/* Only for shows hosted somewhere else (20 Nov 2026). Once a show is hosted with us its numbers are
          counted here already; numbers brought in before the move stay in Podcast analytics. */}
      {hostedReady && !hostedHere && <Group
        id="section-podcast-stats"
        icon={<Headphones className="h-4 w-4" />}
        title="Podcast stats"
        line="Your downloads and streams, in Podcast analytics, with where your show fits among MilitaryVoices podcasts. Only you see your numbers."
        after={
          <button type="button" onClick={onOpenPodcastStats} className="mt-1 text-sm font-semibold text-primary hover:underline" data-testid="link-see-podcast-stats">
            See your numbers in Podcast analytics →
          </button>
        }
      >
        <PodcastStatsRows Row={Row} onOpenStats={onOpenPodcastStats} />
      </Group>}

    </section>
  );
}

/** "1 follower", "2 followers", "1.2K followers". */
function followersText(n?: number): string {
  const f = formatFollowers(n);
  return f ? `${f} follower${n === 1 ? "" : "s"}` : "";
}

/** "Going out" / "Coming in": the page's two halves. */
function Overline({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-2 text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;
}

function Group({ id, icon, title, line, after, action, children }: { id?: string; icon: ReactNode; title: string; line: string; /** A link under the intro line. */ after?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="mb-8 scroll-mt-24" data-testid={id}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">{icon} {title}</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{line}</p>
          {after}
        </div>
        {action}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{children}</div>
    </div>
  );
}

function Row({ icon, name, line, right, children, testId }: { icon: ReactNode; name: string; line: ReactNode; right: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="px-5 py-3.5" data-testid={testId}>
      <div className="flex items-center gap-3.5">
        <span className="flex w-12 shrink-0 justify-center">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <div className="truncate text-sm text-muted-foreground">{line}</div>
        </div>
        <div className="shrink-0">{right}</div>
      </div>
      {children}
    </div>
  );
}

function Connected() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Connected</span>;
}
