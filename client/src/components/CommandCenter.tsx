import { ArrowRight, CalendarDays, Check, Link2, Mic2, Mail, Shield } from "lucide-react";
import { resolveUploadUrl } from "@/lib/queryClient";
import { StudioIcon } from "@/components/GreenRoomButton";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

type Screen = "editProfile" | "promotion" | "integrations" | "events" | "contacts";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The top of the dashboard, in three layers.
 *
 * A short dark card — who you are, what day it is, the two numbers promotion
 * produces. Four cards under it that each go somewhere: the green room, your
 * accounts, your slot, the co-host hours. Then the white page begins with
 * what is left to do. The first version put all of that on the dark card
 * and it was a wall; the slot time appeared twice and the greeting once too
 * often.
 */
export function CommandCenter({
  firstName,
  photoUrl,
  podcastName,
  email,
  serviceLine,
  eventName,
  eventStartUtc,
  stats,
  onGo,
}: {
  firstName: string;
  photoUrl: string;
  podcastName: string;
  email: string;
  serviceLine: string;
  eventName: string;
  eventStartUtc: string;
  stats: { key: string; value: string; label: string; screen: Screen; muted?: boolean }[];
  onGo: (screen: Screen) => void;
}) {
  const now = new Date();
  const daysToGo = Math.max(0, Math.ceil((Date.parse(eventStartUtc) - now.getTime()) / 86_400_000));
  return (
    <section className="relative overflow-hidden rounded-2xl bg-[#04102b] px-5 pb-12 pt-5 text-white sm:px-7 sm:pt-6" data-testid="command-center">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/[0.07]" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-8 -top-8 h-72 w-72 rounded-full border border-white/[0.07]" aria-hidden="true" />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        {/* Who this is, once: the avatar and the show up here beside the
            greeting, so the page below can get on with the slot. */}
        <div className="flex min-w-0 items-center gap-4">
          {photoUrl ? (
            <img src={resolveUploadUrl(photoUrl)} alt={podcastName} className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-white/15 sm:h-24 sm:w-24" />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl font-bold sm:h-24 sm:w-24">{(podcastName || firstName).slice(0, 1)}</span>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#F0A71F]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F0A71F]" /> Your command center
            </p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl" style={HEADLINE_FONT}>
              {greeting(now)}, {firstName} 👋
            </h2>
            <p className="mt-1 text-sm text-white/85">
              <span className="font-semibold text-white">{podcastName}</span>
              {" · "}
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              {" · "}
              {daysToGo === 0 ? `${eventName} is today` : `${daysToGo} day${daysToGo === 1 ? "" : "s"} to ${eventName}`}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75">
              <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-[#F0A71F]" /> {email}</span>
              {serviceLine && <span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[#F0A71F]" /> {serviceLine}</span>}
            </p>
          </div>
        </div>
        {/* Bright on purpose: the first cut used quarter-strength white and the
            numbers vanished into the navy. */}
        {stats.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onGo(s.screen)}
                className="flex items-baseline gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-left transition-colors hover:bg-white/20"
                data-testid={`stat-${s.key}`}
              >
                <span className={`text-2xl font-bold tabular-nums ${s.muted ? "text-white" : "text-[#F0A71F]"}`} style={HEADLINE_FONT}>{s.value}</span>
                <span className="text-sm text-white">{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Four doors, overlapping the bottom of the dark card so the two read as one
 * piece rather than a block and a row.
 */
export function QuickCards({
  greenRoomHref,
  accountsCount,
  slotLabel,
  cohost,
  onGo,
  onCohost,
}: {
  greenRoomHref: string | null;
  accountsCount: number;
  slotLabel: string | null;
  cohost: { open: number; mine: number; total: number } | null;
  onGo: (screen: Screen) => void;
  onCohost: () => void;
}) {
  const cards: { key: string; title: string; body: string; icon: React.ReactNode; onClick?: () => void; href?: string; accent?: boolean }[] = [
    {
      key: "green-room",
      title: "Green room",
      body: greenRoomHref ? "Check camera, mic and lighting. Open any time." : "Opens once you hold a slot.",
      icon: <StudioIcon className="h-10 w-10" />,
      href: greenRoomHref ?? undefined,
      accent: true,
    },
    {
      key: "accounts",
      title: accountsCount > 0 ? `${accountsCount} account${accountsCount === 1 ? "" : "s"} connected` : "Connect your accounts",
      body: accountsCount > 0 ? "Follow buttons on your card; we post your promo cards for you." : "Follow buttons on your card, and we post your promo cards for you.",
      icon: <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877]"><Link2 className="h-5 w-5" /></span>,
      onClick: () => onGo("integrations"),
    },
    {
      key: "events",
      title: slotLabel ? slotLabel : "Pick your slot",
      body: slotLabel ? "Your show, your time, what you're bringing." : "Take a time on the schedule and set your show up.",
      icon: <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877]"><CalendarDays className="h-5 w-5" /></span>,
      onClick: () => onGo("events"),
    },
    {
      key: "cohost",
      title: cohost && cohost.mine > 0 ? `You're co-hosting ${cohost.mine} hour${cohost.mine === 1 ? "" : "s"}` : "Co-host opportunities",
      body: cohost ? `${cohost.open} of ${cohost.total} hours still open on the main stage with Alex or Riccoh.` : "Take an hour on the main stage between shows.",
      icon: <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877]"><Mic2 className="h-5 w-5" /></span>,
      onClick: onCohost,
    },
  ];
  return (
    <div className="relative z-10 -mt-8 grid gap-3 px-3 sm:grid-cols-2 sm:px-5 xl:grid-cols-4" data-testid="quick-cards">
      {cards.map((c) => {
        const inner = (
          <>
            {c.icon}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-card-foreground">{c.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{c.body}</span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        );
        const cls = `flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors ${
          c.accent ? "border-[#F0A71F] hover:bg-[#F0A71F]/10" : "border-border hover:border-[#053877]/40 hover:bg-[#053877]/[0.03]"
        }`;
        return c.href ? (
          <a key={c.key} href={c.href} target="_blank" rel="noreferrer" className={cls} data-testid={`quick-${c.key}`}>{inner}</a>
        ) : (
          <button key={c.key} type="button" onClick={c.onClick} className={cls} data-testid={`quick-${c.key}`}>{inner}</button>
        );
      })}
    </div>
  );
}

/**
 * What is still outstanding before the day, on the white page. The prep
 * nudge, live: the same things the email asks for, each a link to where it
 * is done. Only what is left — a list of gaps is a plan.
 */
export function TodoStrip({
  todos,
  onGo,
}: {
  todos: { key: string; label: string; screen: Screen; optional?: boolean }[];
  onGo: (screen: Screen) => void;
}) {
  const required = todos.filter((t) => !t.optional);
  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid="todo-strip">
      {required.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4" /> You're all set — nothing left to do before the day.
        </p>
      ) : (
        <p className="text-sm font-semibold text-foreground">
          Before the day <span className="ml-1.5 font-normal text-muted-foreground">· {required.length} to do</span>
        </p>
      )}
      {todos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {todos.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onGo(t.screen)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                t.optional
                  ? "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  : "border-[#F0A71F] bg-[#F0A71F]/10 text-foreground hover:bg-[#F0A71F]/20"
              }`}
              data-testid={`todo-${t.key}`}
            >
              {t.label} <ArrowRight className="h-3.5 w-3.5 opacity-70" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
