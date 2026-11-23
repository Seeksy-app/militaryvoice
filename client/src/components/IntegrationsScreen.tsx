import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ZoomConnect, ImportLink } from "@/components/ZoomConnect";
import { LiveSettings } from "@/components/LiveSettings";
import { PodcastStatsRows, useHostedHere } from "@/components/PodcastStats";
import { platformLabel, formatFollowers, ALL_PLATFORMS } from "@/components/SocialIcons";
import { BrandMark, BrandGroup } from "@/components/BrandMark";
import type { ProfileRow, SocialAccount } from "@shared/schema";
import { Check, ChevronDown, ExternalLink, Headphones, Link2, Loader2, Radio, RefreshCw, Share2, Upload, User, Video, Webhook } from "lucide-react";
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
  onOpenLibrary,
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

      {social?.configured && (
        <Group
          id="section-social-accounts"
          icon={<Share2 className="h-4 w-4" />}
          title="Social media"
          line="Where your clips post, and the follow buttons on your card in the lineup."
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
                line={
                  a && platform === "linkedin" ? (
                    <LinkedinPostsAs account={a} />
                  ) : a ? (
                    <><span className="font-medium text-foreground">{handle}</span>{followers ? ` · ${followersText(a.followers)}` : ""}</>
                  ) : (
                    "Not connected"
                  )
                }
                right={
                  a ? (
                    <span className="flex items-center gap-2">
                      <Connected />
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noreferrer" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${platformLabel(platform)}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" className="h-8 rounded-full px-3.5 text-xs" onClick={onConnectSocial} disabled={connecting}>Connect</Button>
                  )
                }
              />
            );
          })}
        </Group>
      )}

      {/* Right under social media: going live on YouTube is the same kind of thing, their own channel. */}
      {/* Live, all in one place (Andrew, 22 Nov: the one-place Live mockup, "Yes, build it"): where it goes, and stream in. */}
      <div id="section-going-out-live" className="mb-8 scroll-mt-24" data-testid="section-going-out-live">
        <div className="mb-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground"><Radio className="h-4 w-4" /> Live</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">Where your live shows go, and how to send one in from StreamYard or OBS. All in one place.</p>
        </div>
        <LiveSettings />
      </div>

      <Group
        id="section-content"
        icon={<Video className="h-4 w-4" />}
        title="Content"
        line="Where your episodes come from. Everything lands in your Library, ready for Pōstify."
      >
        <ZoomConnect row />
        <div id="import-link" className="scroll-mt-24">
          <Row
            testId="row-import-link"
            icon={<IconTile icon={Webhook} />}
            name="Import link"
            line="For Zapier or any app that can send a video's link. Each one comes into your Library."
            right={
              <Button variant="outline" size="sm" className="h-8 gap-1 rounded-full px-3.5 text-xs" onClick={() => setLinkOpen((v) => !v)} aria-expanded={linkOpen} data-testid="button-import-link-toggle">
                {linkOpen ? "Hide" : "Set up"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${linkOpen ? "rotate-180" : ""}`} />
              </Button>
            }
          >
            {linkOpen && <div className="mt-4"><ImportLink bare /></div>}
          </Row>
        </div>
        <Row
          testId="row-upload"
          icon={<IconTile icon={Upload} />}
          name="Upload a video"
          line="MP4, MOV or WebM, up to 2GB, straight into your Library."
          right={<Button variant="outline" size="sm" className="h-8 rounded-full px-3.5 text-xs" onClick={onOpenLibrary}>Open Library</Button>}
        />
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

type LinkedinPageOption = { id: string; name: string; picture: string; followers?: number };

/**
 * LinkedIn's line: "Posts as SmartLoads ▾ · 12 followers". One LinkedIn login
 * can run several company pages; this picks the one every LinkedIn post goes
 * out as (clips, full episodes, scheduled ones), or their personal profile.
 * It's Upload-Post's own pin, so it matches their connect page too (Andrew,
 * 23 Nov: he picked SmartLoads there and our row kept naming another page).
 */
function LinkedinPostsAs({ account }: { account: SocialAccount }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const pagesQ = useQuery<{ pages: LinkedinPageOption[]; selectedId: string | null }>({
    queryKey: ["/api/host/social/linkedin-pages"],
    queryFn: async () => (await apiRequest("GET", "/api/host/social/linkedin-pages")).json(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pick = useMutation({
    mutationFn: async (pageId: string | null) => (await apiRequest("POST", "/api/host/social/linkedin-page", { pageId })).json() as Promise<{ accounts: SocialAccount[] }>,
    onSuccess: (r, pageId) => {
      qc.setQueryData(["/api/host/social"], (old: any) => (old ? { ...old, accounts: r.accounts } : old));
      qc.setQueryData(["/api/host/social/linkedin-pages"], (old: any) => (old ? { ...old, selectedId: pageId } : old));
      const name = r.accounts.find((x) => x.platform === "linkedin")?.displayName;
      toast({ title: pageId ? `LinkedIn posts now go out as ${name ?? "that page"}.` : "LinkedIn posts now go out on your personal profile." });
    },
    onError: (e: Error) => toast({ title: "Couldn't change that", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const pages = pagesQ.data?.pages ?? [];
  const selectedId = pagesQ.data ? pagesQ.data.selectedId : account.pageId ?? null;
  const current = selectedId ? pages.find((p) => p.id === selectedId) : undefined;
  // Before the pages arrive, the row's cached name (already the pinned page, or "Personal profile").
  const name = !pagesQ.data ? account.displayName || "Personal profile" : current?.name ?? (selectedId ? account.displayName : "Personal profile");
  const followers = current ? current.followers : account.followers;
  const canPick = pages.length > 0;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="shrink-0">Posts as</span>
      {canPick ? (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mx-0.5 inline-flex min-w-0 items-center gap-0.5 rounded-md px-1 py-0.5 font-medium text-foreground underline decoration-dotted underline-offset-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`LinkedIn posts go out as ${name}. Change`}
              data-testid="button-linkedin-posts-as"
              disabled={pick.isPending}
            >
              <span className="truncate">{name}</span>
              {pick.isPending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Every LinkedIn post goes out as:</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <PageItem
              selected={!selectedId}
              picture=""
              name="Personal profile"
              note="You, on your own LinkedIn"
              onSelect={() => { if (selectedId) pick.mutate(null); }}
              testId="linkedin-page-personal"
            />
            {pages.map((p) => (
              <PageItem
                key={p.id}
                selected={p.id === selectedId}
                picture={p.picture}
                name={p.name}
                note={p.followers != null ? `Company page · ${followersText(p.followers)}` : "Company page"}
                onSelect={() => { if (p.id !== selectedId) pick.mutate(p.id); }}
                testId={`linkedin-page-${p.id.split(":").pop()}`}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="truncate font-medium text-foreground">{name}</span>
      )}
      {followers != null && <span className="hidden shrink-0 sm:inline">· {followersText(followers)}</span>}
    </span>
  );
}

function PageItem({ selected, picture, name, note, onSelect, testId }: { selected: boolean; picture: string; name: string; note: string; onSelect: () => void; testId: string }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2.5 py-2" data-testid={testId}>
      {picture ? (
        <img src={picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-md object-cover ring-1 ring-border" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><User className="h-4 w-4" /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{note}</span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </DropdownMenuItem>
  );
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
  // A tick alone on phones, so the account's name has the room (the LinkedIn page read "S…" at 390).
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-1.5 py-1 text-xs font-semibold text-emerald-700 sm:px-2.5 dark:text-emerald-400" aria-label="Connected" title="Connected"><Check className="h-3.5 w-3.5" /><span className="hidden sm:inline">Connected</span></span>;
}
