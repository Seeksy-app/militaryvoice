import type { SocialAccount } from "@shared/schema";
import { PlatformIcon, platformBackground, formatFollowers } from "@/components/SocialIcons";
import { ExternalLink } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

// The dashboard's answer to "what am I connected to?" — one chip per account,
// showing the avatar the platform actually has, its network badge, and the
// handle. Managing them happens on Integrations; this is only the readout.

export function ConnectedAccountsStrip({
  accounts,
  onManage,
  className = "",
  extra,
  extraCount = 0,
}: {
  accounts: SocialAccount[];
  onManage?: () => void;
  className?: string;
  /** More connections after the social accounts: the podcast host's downloads. */
  extra?: React.ReactNode;
  extraCount?: number;
}) {
  // One row on a computer (8 Oct: ten accounts took three rows and pushed the
  // SmartLink and Next steps below the fold); "Show all" opens the rest.
  const row = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [accounts.length, extraCount]);
  if (accounts.length + extraCount === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">
          Connected accounts <span className="font-normal text-muted-foreground">({accounts.length + extraCount})</span>
        </p>
        <span className="flex items-center gap-3">
        {(more || open) && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="hidden text-xs font-semibold text-muted-foreground hover:text-foreground sm:inline" data-testid="button-accounts-more">
            {open ? "Show fewer" : `Show all ${accounts.length + extraCount}`}
          </button>
        )}
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
        </span>
      </div>

      {/* On a phone: one row that scrolls sideways, each account its picture and followers. */}
      <div ref={row} className={`-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden ${open ? "sm:overflow-visible" : "sm:max-h-[3.4rem] sm:overflow-hidden"}`}>
        {accounts.map((a) => (
          <a
            key={`${a.platform}-${a.username}`}
            href={a.url || undefined}
            target={a.url ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 transition-colors hover:border-primary/40 hover:shadow-sm sm:gap-2.5 sm:px-3 sm:py-2"
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
              <span className="hidden max-w-[13rem] truncate text-sm font-medium leading-tight text-foreground sm:block">
                {a.displayName || a.username}
              </span>
              <span className="block truncate text-xs font-semibold leading-tight text-foreground sm:font-normal sm:text-muted-foreground">
                {a.followers != null ? <>{formatFollowers(a.followers)}<span className="hidden sm:inline"> followers</span></> : a.username ? `@${a.username.replace(/^@/, "")}` : "Connected"}
              </span>
            </span>

            {a.url && (
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </a>
        ))}
        {extra}
      </div>
    </div>
  );
}
