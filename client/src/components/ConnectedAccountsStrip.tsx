import type { SocialAccount, SocialPlatform } from "@shared/schema";
import { PlatformIcon, platformBackground, formatFollowers, platformLabel } from "@/components/SocialIcons";
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
  ghosts,
  note,
  onConnect,
}: {
  accounts: SocialAccount[];
  onManage?: () => void;
  className?: string;
  /** More connections after the social accounts: the podcast host's downloads. */
  extra?: React.ReactNode;
  extraCount?: number;
  /** Nothing connected yet: these networks, greyed out, each one a door to connecting it.
      The first connection replaces them all with what's really connected (Andrew, 21 Nov). */
  ghosts?: SocialPlatform[];
  /** One line under the header (the free 30 days of posting). */
  note?: React.ReactNode;
  /** What a greyed-out network and the empty header's Connect do; Integrations (onManage) unless the free days are over. */
  onConnect?: () => void;
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
  const showGhosts = accounts.length === 0 && !!ghosts?.length;
  // All five networks in view: with their names when the row has room, just their logos when it doesn't
  // (the dashboard's column at 1180, a phone). Measured, so a wider screen gets the names back.
  const [tight, setTight] = useState(false);
  const [rowW, setRowW] = useState(0);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || !showGhosts) return;
    const ro = new ResizeObserver(() => setRowW((w) => (Math.abs(w - el.clientWidth) > 2 ? el.clientWidth : w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showGhosts]);
  useLayoutEffect(() => { setTight(false); }, [rowW]);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || !showGhosts || tight) return;
    if (el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4) setTight(true);
  });
  if (accounts.length + extraCount === 0 && !showGhosts) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">
          {showGhosts ? "Connect your accounts" : <>Connected accounts <span className="font-normal text-muted-foreground">({accounts.length + extraCount})</span></>}
        </p>
        <span className="flex items-center gap-3">
        {(more || open) && !showGhosts && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="hidden text-xs font-semibold text-muted-foreground hover:text-foreground sm:inline" data-testid="button-accounts-more">
            {open ? "Show fewer" : showGhosts ? "Show all" : `Show all ${accounts.length + extraCount}`}
          </button>
        )}
        {onManage && (
          <button
            type="button"
            onClick={showGhosts ? onConnect ?? onManage : onManage}
            className="text-xs font-semibold text-primary hover:underline"
            data-testid="button-manage-integrations"
          >
            {showGhosts ? "Connect" : "Manage"}
          </button>
        )}
        </span>
      </div>
      {note && <div className="-mt-1 mb-2">{note}</div>}

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
                {a.followers != null ? <>{formatFollowers(a.followers)} followers</> : a.username ? `@${a.username.replace(/^@/, "")}` : "Connected"}
              </span>
            </span>

            {a.url && (
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </a>
        ))}
        {/* What's really there (the podcast) first, then the networks still to connect. */}
        {showGhosts && extra}
        {showGhosts && ghosts!.map((p) => (
          <button
            key={p}
            type="button"
            onClick={onConnect ?? onManage}
            title={`Connect ${platformLabel(p)}. It shows as a follow button on your card, and we post your promo cards there for you.`}
            aria-label={`Connect ${platformLabel(p)}`}
            className={`group flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 py-1.5 text-left ${tight ? "px-2" : "pl-2 pr-3"} transition-colors hover:border-solid hover:border-primary/40 hover:bg-card hover:shadow-sm sm:py-2`}
            data-testid={`chip-ghost-${p}`}
          >
            {/* Greyed out until hovered: the network's own colour is the hint that it's one click away. */}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-70 grayscale transition group-hover:opacity-100 group-hover:grayscale-0 group-hover:text-white" style={{ ["--ghost-bg" as string]: platformBackground(p) }}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full group-hover:[background:var(--ghost-bg)]"><PlatformIcon platform={p} className="h-4 w-4" /></span>
            </span>
            {!tight && <span className="whitespace-nowrap text-sm font-medium text-muted-foreground group-hover:text-foreground">{platformLabel(p)}</span>}
          </button>
        ))}
        {!showGhosts && extra}
      </div>
    </div>
  );
}
