import type { SocialAccount } from "@shared/schema";
import { PlatformIcon, platformBackground, formatFollowers } from "@/components/SocialIcons";
import { ExternalLink } from "lucide-react";

// The dashboard's answer to "what am I connected to?" — one chip per account,
// showing the avatar the platform actually has, its network badge, and the
// handle. Managing them happens on Integrations; this is only the readout.

export function ConnectedAccountsStrip({
  accounts,
  onManage,
  className = "",
}: {
  accounts: SocialAccount[];
  onManage?: () => void;
  className?: string;
}) {
  if (accounts.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">
          Connected accounts <span className="font-normal text-muted-foreground">({accounts.length})</span>
        </p>
        {onManage && (
          <button
            type="button"
            onClick={onManage}
            className="text-xs font-semibold text-primary hover:underline"
            data-testid="button-manage-integrations"
          >
            Manage
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => (
          <a
            key={`${a.platform}-${a.username}`}
            href={a.url || undefined}
            target={a.url ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="group flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:border-primary/40 hover:shadow-sm"
            data-testid={`chip-social-${a.platform}`}
          >
            <span className="relative shrink-0">
              {a.image ? (
                <img src={a.image} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  {(a.displayName || a.username || "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              {/* The network badge rides the avatar, so the platform is
                  readable at a glance without a second row of labels. */}
              <span
                className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-card"
                style={{ background: platformBackground(a.platform) }}
              >
                <PlatformIcon platform={a.platform} className="h-2.5 w-2.5" />
              </span>
            </span>

            <span className="min-w-0">
              <span className="block max-w-[13rem] truncate text-sm font-medium leading-tight text-foreground">
                {a.displayName || a.username}
              </span>
              <span className="block truncate text-xs leading-tight text-muted-foreground">
                {a.followers != null ? `${formatFollowers(a.followers)} followers` : a.username ? `@${a.username.replace(/^@/, "")}` : "Connected"}
              </span>
            </span>

            {a.url && (
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
