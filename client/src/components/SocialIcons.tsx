import type { SocialAccount, SocialPlatform } from "@shared/schema";

// Brand glyphs as plain paths so we don't depend on lucide having every
// network. All drawn on a 24x24 box, currentColor fill.
const PATHS: Record<SocialPlatform, string> = {
  instagram:
    "M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1.1.4 2.2.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1.1.4-2.2.4-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1.1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1.1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2M12 0C8.7 0 8.3 0 7.1.1 5.8.1 4.9.3 4.1.6c-.8.3-1.5.7-2.2 1.4C1.2 2.7.8 3.4.5 4.2.2 5 .1 5.8.1 7.1 0 8.3 0 8.7 0 12s0 3.7.1 4.9c.1 1.3.3 2.1.6 2.9.3.8.7 1.5 1.4 2.2.7.7 1.4 1.1 2.2 1.4.8.3 1.6.5 2.9.6C8.3 24 8.7 24 12 24s3.7 0 4.9-.1c1.3-.1 2.1-.3 2.9-.6.8-.3 1.5-.7 2.2-1.4.7-.7 1.1-1.4 1.4-2.2.3-.8.5-1.6.6-2.9.1-1.2.1-1.6.1-4.9s0-3.7-.1-4.9c-.1-1.3-.3-2.1-.6-2.9-.3-.8-.7-1.5-1.4-2.2C21.3 1.2 20.6.8 19.8.5 19 .2 18.2.1 16.9.1 15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.9 1.4 1.4 0 0 0 0-2.9z",
  tiktok:
    "M12.5 0h4.1c.3 2.4 1.7 4.4 4 5.2v4.1c-1.5 0-3-.5-4.3-1.3v7.2A7.6 7.6 0 1 1 9.3 7.6c.4 0 .8 0 1.2.1v4.2a3.5 3.5 0 1 0 2 3.2V0z",
  youtube:
    "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z",
  x: "M18.2 2h3.4l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.4l7.9-9.1L1 2h7l4.8 6.4L18.2 2zm-1.2 18h1.9L7.1 3.9H5.1L17 20z",
  linkedin:
    "M20.4 20.4h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2.1 2.1 0 1 1 0-4.1 2.1 2.1 0 0 1 0 4.1zM7.1 20.4H3.6V9h3.5v11.4zM22.2 0H1.8C.8 0 0 .8 0 1.7v20.5c0 1 .8 1.8 1.8 1.8h20.4c1 0 1.8-.8 1.8-1.8V1.7C24 .8 23.2 0 22.2 0z",
  facebook:
    "M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z",
  threads:
    "M12.2 24C8.4 24 5.6 22.7 3.8 20.2 2.2 18 1.4 15 1.4 12 1.4 9 2.2 6 3.8 3.8 5.6 1.3 8.4 0 12.2 0c3.5 0 6.3 1.2 8 3.5.9 1.2 1.5 2.6 1.8 4.2l-2.6.7c-.3-1.2-.7-2.2-1.4-3.1-1.2-1.6-3.2-2.5-5.8-2.5-2.9 0-5 .9-6.3 2.7-1.2 1.7-1.8 4-1.8 6.5s.6 4.8 1.8 6.5c1.3 1.8 3.4 2.7 6.3 2.7 2.6 0 4.3-.6 5.5-2 .8-.9 1.2-2 1.1-3.1-.1-1.4-1-2.5-2.4-3.2-.2 2-.9 3.5-2.1 4.5-1 .8-2.3 1.2-3.7 1.1-1.2-.1-2.3-.5-3.1-1.2-.9-.8-1.4-1.9-1.3-3.1.1-2.3 2.1-3.9 5-4.1 1.1-.1 2.2 0 3.2.2 0-.9-.3-1.6-.8-2.1-.6-.6-1.4-.9-2.4-.9-1.4 0-2.5.6-3.2 1.7L6.1 7.6c1.2-1.9 3.1-2.9 5.6-2.9 1.8 0 3.3.6 4.4 1.7 1 1 1.6 2.4 1.7 4.1l.1.7c1.2.5 2.2 1.2 2.9 2.1.9 1.1 1.4 2.5 1.4 4 0 1.8-.7 3.6-2 5-1.7 1.8-4.1 2.7-7 2.7h-1zm-.1-10.6h-.4c-1.7.1-2.5.8-2.5 1.6 0 .4.2.8.5 1 .4.4 1 .6 1.7.6.8 0 1.5-.2 2-.6.6-.5 1-1.4 1.2-2.4-.8-.2-1.7-.3-2.5-.2z",
};

const LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  threads: "Threads",
};

export const ALL_PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "youtube", "x", "linkedin", "facebook", "threads"];

export function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: SocialPlatform; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={PATHS[platform]} />
    </svg>
  );
}

export function platformLabel(p: SocialPlatform): string {
  return LABELS[p];
}

export function parseSocialAccounts(json: string | null | undefined): SocialAccount[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface RowProps {
  accounts: SocialAccount[];
  size?: "sm" | "md";
  className?: string;
}

/** Compact icon row for public cards. Renders nothing when there's nothing to show. */
export function SocialIconRow({ accounts, size = "sm", className = "" }: RowProps) {
  if (!accounts.length) return null;
  const dim = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} data-testid="social-icon-row">
      {accounts.map((a) => {
        const title = `${platformLabel(a.platform)}${a.username ? ` · @${a.username}` : ""}`;
        const cls = `inline-flex ${dim} items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary`;
        return a.url ? (
          <a
            key={a.platform}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            aria-label={title}
            className={cls}
            onClick={(e) => e.stopPropagation()}
          >
            <PlatformIcon platform={a.platform} className={icon} />
          </a>
        ) : (
          <span key={a.platform} title={title} aria-label={title} className={cls}>
            <PlatformIcon platform={a.platform} className={icon} />
          </span>
        );
      })}
    </div>
  );
}
