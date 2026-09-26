import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ZoomConnect, ImportLink } from "@/components/ZoomConnect";
import { ConnectYoutube } from "@/components/ConnectYoutube";
import { AudienceConsent } from "@/components/AudienceConsent";
import { PlatformIcon, platformLabel, platformBackground, formatFollowers, ALL_PLATFORMS } from "@/components/SocialIcons";
import type { ProfileRow, SocialAccount } from "@shared/schema";
import { Check, ChevronDown, ExternalLink, Link2, Radio, RefreshCw, Share2, Upload, Video, Webhook } from "lucide-react";

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
  youtubeLocked,
}: {
  social?: { configured: boolean; accounts: SocialAccount[] };
  profile?: ProfileRow | null;
  onConnectSocial: () => void;
  connecting: boolean;
  onRefreshSocial: () => void;
  refreshing: boolean;
  onOpenLibrary: () => void;
  youtubeLocked: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#import-link");
  const accounts = social?.accounts ?? [];
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
                  a?.image ? (
                    <span className="relative">
                      <img src={a.image} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover ring-1 ring-border" />
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-card" style={{ background: platformBackground(platform) }}>
                        <PlatformIcon platform={platform} className="h-3 w-3" />
                      </span>
                    </span>
                  ) : (
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${a ? "" : "opacity-50"}`} style={{ background: platformBackground(platform) }}>
                      <PlatformIcon platform={platform} className="h-4.5 w-4.5" />
                    </span>
                  )
                }
                name={platformLabel(platform)}
                line={a ? <><span className="font-medium text-foreground">{handle}</span>{followers ? ` · ${followers} followers` : ""}</> : "Not connected"}
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
      {social?.configured && accounts.length > 0 && profile && <div className="-mt-3 mb-8"><AudienceConsent profile={profile} /></div>}

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
            icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF4F00] text-white"><Webhook className="h-5 w-5" /></span>}
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
          icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877] dark:text-[#8ab4f8]"><Upload className="h-5 w-5" /></span>}
          name="Upload a video"
          line="MP4, MOV or WebM, up to 2GB, straight into your Library."
          right={<Button variant="outline" size="sm" className="h-8 rounded-full px-3.5 text-xs" onClick={onOpenLibrary}>Open Library</Button>}
        />
      </Group>

      <Group
        id="section-going-out-live"
        icon={<Radio className="h-4 w-4" />}
        title="Live streaming"
        line="Optional. Your slot airs on MilitaryVoices.ai either way; this sends it to your own channel too. YouTube is the only one we can send to directly."
      >
        <ConnectYoutube row locked={youtubeLocked} lockedReason="Claim a time slot first — the event is full at the moment." />
      </Group>
    </section>
  );
}

function Group({ id, icon, title, line, action, children }: { id?: string; icon: ReactNode; title: string; line: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="mb-8 scroll-mt-24" data-testid={id}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">{icon} {title}</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{line}</p>
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
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <p className="truncate text-sm text-muted-foreground">{line}</p>
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
