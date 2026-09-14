import type { SocialAccount } from "@shared/schema";
import { PlatformIcon, platformLabel, platformBackground, formatFollowers, ALL_PLATFORMS } from "@/components/SocialIcons";

interface Props {
  accounts: SocialAccount[];
  /** Called when an unconnected tile is clicked. */
  onConnect?: () => void;
  connecting?: boolean;
  className?: string;
}

/**
 * One tile per supported network. Connected: avatar with a colored network
 * badge, handle, follower count. Not connected: greyed placeholder that starts
 * the connect flow. Shared by the dashboard and the profile form.
 */
export function SocialTiles({ accounts, onConnect, connecting = false, className = "" }: Props) {
  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-7 ${className}`}>
      {ALL_PLATFORMS.map((platform) => {
        const a = accounts.find((x) => x.platform === platform);
        const brand = platformBackground(platform);
        if (!a) {
          return (
            <button
              key={platform}
              type="button"
              onClick={onConnect}
              disabled={!onConnect || connecting}
              title={`Connect ${platformLabel(platform)}`}
              className="group flex flex-col items-center rounded-xl border border-dashed border-border p-3 text-center transition-colors hover:border-primary/40 disabled:cursor-default"
              data-testid={`tile-social-${platform}`}
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full text-white opacity-45 transition-opacity group-hover:opacity-100"
                style={{ background: brand }}
              >
                <PlatformIcon platform={platform} className="h-5 w-5" />
              </span>
              <span className="mt-2 w-full truncate text-xs font-medium text-muted-foreground">{platformLabel(platform)}</span>
              <span className="whitespace-nowrap text-[12px] text-muted-foreground/70">{connecting ? "Opening…" : "Not connected"}</span>
            </button>
          );
        }
        const label = a.username && !/^\d+$/.test(a.username) ? `@${a.username}` : a.displayName || platformLabel(a.platform);
        const followers = formatFollowers(a.followers);
        const initial = (a.displayName || a.username || platformLabel(a.platform)).charAt(0).toUpperCase();
        const body = (
          <>
            <span className="relative">
              {a.image ? (
                <img src={a.image} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-border" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary ring-2 ring-border">
                  {initial}
                </span>
              )}
              <span
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-white shadow ring-2 ring-background"
                style={{ background: brand }}
              >
                <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
              </span>
            </span>
            <span className="mt-2 w-full truncate text-xs font-semibold text-card-foreground" title={label}>
              {label}
            </span>
            <span className="whitespace-nowrap text-[12px] text-muted-foreground">{followers ? `${followers} followers` : platformLabel(platform)}</span>
          </>
        );
        const cls = "flex flex-col items-center rounded-xl border border-border bg-background p-3 text-center transition-colors hover:border-primary/40";
        return a.url ? (
          <a key={platform} href={a.url} target="_blank" rel="noopener noreferrer" className={cls} data-testid={`tile-social-${platform}`}>
            {body}
          </a>
        ) : (
          <span key={platform} className={cls} data-testid={`tile-social-${platform}`}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
