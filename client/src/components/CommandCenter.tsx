import type { SocialAccount } from "@shared/schema";
import { ArrowRight, CalendarClock, Link2, Pencil, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GreenRoomButton } from "@/components/GreenRoomButton";
import { PlatformIcon, platformBackground, formatFollowers } from "@/components/SocialIcons";
import { formatDateInZone, formatTimeInZone, zoneLabel } from "@/lib/schedule";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The top of the dashboard: the three things a podcaster comes back for.
 *
 * When am I on, what am I connected to, and the door to the green room —
 * on one dark card, before the profile, because the profile is what they
 * filled in once and this is what changes. Accounts that are connected show
 * with their faces and follower counts; none connected shows the way to
 * connect them rather than seven grey tiles.
 */
export function CommandCenter({
  firstName,
  eventName,
  eventStartUtc,
  slot,
  zone,
  accounts,
  socialConfigured,
  greenRoomHref,
  onGo,
}: {
  firstName: string;
  eventName: string;
  eventStartUtc: string;
  slot: { start: Date; end: Date } | null;
  zone: string;
  accounts: SocialAccount[];
  socialConfigured: boolean;
  greenRoomHref: string | null;
  onGo: (screen: "editProfile" | "promotion" | "integrations" | "events") => void;
}) {
  const now = new Date();
  const daysToGo = Math.max(0, Math.ceil((Date.parse(eventStartUtc) - now.getTime()) / 86_400_000));
  return (
    <section
      className="relative mt-6 overflow-hidden rounded-2xl bg-[#04102b] p-5 text-white sm:p-7"
      data-testid="command-center"
    >
      {/* A faint pair of rings, so the card is not a flat block of navy. */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/[0.06]" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-8 -top-8 h-72 w-72 rounded-full border border-white/[0.06]" aria-hidden="true" />

      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#F0A71F]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F0A71F]" /> Your command center
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
            {greeting(now)}, {firstName} 👋
          </h2>
          <p className="mt-1 text-sm text-white/60">
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            {" · "}
            {daysToGo === 0 ? `${eventName} is today` : `${daysToGo} day${daysToGo === 1 ? "" : "s"} to ${eventName}`}
          </p>
          {slot ? (
            <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full bg-white/[0.07] px-3.5 py-1.5 text-sm">
              <CalendarClock className="h-4 w-4 text-[#F0A71F]" />
              <span className="font-semibold tabular-nums">
                {formatDateInZone(slot.start, zone)} · {formatTimeInZone(slot.start, zone)}–{formatTimeInZone(slot.end, zone)}
              </span>
              <span className="text-white/55">{zoneLabel(zone)} · you're on air</span>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => onGo("events")}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-1.5 text-sm font-medium hover:bg-white/[0.12]"
            >
              <CalendarClock className="h-4 w-4 text-[#F0A71F]" /> No time yet — pick your slot <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {greenRoomHref && <GreenRoomButton href={greenRoomHref} testId="link-dashboard-green-room" />}
          <Button variant="outline" className="gap-1.5 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => onGo("promotion")} data-testid="button-share-card">
            <Share2 className="h-4 w-4" /> Share my card
          </Button>
          <Button variant="outline" className="gap-1.5 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => onGo("editProfile")} data-testid="button-edit-profile">
            <Pencil className="h-4 w-4" /> Edit profile
          </Button>
        </div>
      </div>

      {greenRoomHref && (
        <p className="relative mt-2 text-xs text-white/45">
          The green room is open any time — check your camera, mic and lighting. Nothing in there goes on air.
        </p>
      )}

      <div className="relative mt-6 border-t border-white/10 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Connected accounts{accounts.length > 0 && <span className="ml-1.5 font-normal text-white/50">({accounts.length})</span>}
          </p>
          {socialConfigured && (
            <button type="button" onClick={() => onGo("integrations")} className="text-sm font-semibold text-[#F0A71F] hover:underline" data-testid="button-manage-integrations">
              {accounts.length > 0 ? "Manage" : "Connect"}
            </button>
          )}
        </div>
        {accounts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {accounts.map((a) => (
              <a
                key={`${a.platform}-${a.username}`}
                href={a.url || undefined}
                target={a.url ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 transition-colors hover:bg-white/[0.1]"
                data-testid={`chip-social-${a.platform}`}
              >
                <span className="relative shrink-0">
                  {a.image ? (
                    <img src={a.image} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                      {(a.displayName || a.username || "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-[#04102b]"
                    style={{ background: platformBackground(a.platform) }}
                  >
                    <PlatformIcon platform={a.platform} className="h-2.5 w-2.5" />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[12rem] truncate text-sm font-medium leading-tight">{a.displayName || a.username}</span>
                  <span className="block truncate text-xs leading-tight text-white/50">
                    {a.followers != null ? `${formatFollowers(a.followers)} followers` : "Connected"}
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onGo("integrations")}
            className="mt-3 flex w-full flex-wrap items-center gap-3 rounded-xl border border-dashed border-white/20 px-4 py-3 text-left text-sm text-white/70 hover:border-white/40 hover:text-white"
            data-testid="button-connect-accounts"
          >
            <Link2 className="h-4 w-4 text-[#F0A71F]" />
            Nothing connected yet. Link the accounts you post from — they show as follow buttons on your card, and we can post your six promo cards for you.
            <ArrowRight className="ml-auto h-4 w-4" />
          </button>
        )}
      </div>
    </section>
  );
}
