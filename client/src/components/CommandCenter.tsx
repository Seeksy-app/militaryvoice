import { Link } from "wouter";
import { ArrowRight, ArrowUp, CalendarDays, Check, ListOrdered, Share2, Sparkles } from "lucide-react";
import { useState } from "react";
import { resolveUploadUrl } from "@/lib/queryClient";
import { StudioIcon } from "@/components/GreenRoomButton";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

type Screen = "editProfile" | "promotion" | "integrations" | "events" | "contacts";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The top of the dashboard: who you are, and one box to ask for anything.
 *
 * Light, like the page under it (28 Oct, after Clay's home): the navy slab it
 * used to be made every block below it shout too. The email and service line
 * went with it; they're on the Profile.
 */
export function CommandCenter({
  firstName,
  photoUrl,
  podcastName,
  actions,
}: {
  /** Top right: Show me around, Sign out. */
  actions?: React.ReactNode;
  firstName: string;
  photoUrl: string;
  podcastName: string;
  email?: string;
  serviceLine?: string;
  eventName?: string;
  eventStartUtc?: string;
}) {
  const now = new Date();
  const [askText, setAskText] = useState("");
  return (
    <section className="pt-2" data-testid="command-center">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {photoUrl ? (
            <img src={resolveUploadUrl(photoUrl)} alt={podcastName} className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-lg font-bold text-[#053877]">{(podcastName || firstName).slice(0, 1)}</span>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl" style={HEADLINE_FONT}>{greeting(now)}, {firstName}</h1>
            <p className="truncate text-sm text-muted-foreground">{podcastName}{podcastName ? " · " : ""}{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          </div>
        </div>
        {actions}
      </div>
      {/* One box to ask for anything (after Clay's home): Alex answers, or takes them there. */}
      <form
        className="mt-5 flex max-w-3xl items-center gap-2 rounded-2xl border border-border bg-card p-1.5 pl-4 shadow-sm focus-within:border-[#053877]/50"
        onSubmit={(e) => {
          e.preventDefault();
          const q = askText.trim();
          if (!q) return;
          window.dispatchEvent(new CustomEvent("mv:ask-alex", { detail: { question: q, send: true } }));
          setAskText("");
        }}
        data-testid="dashboard-ask"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-[#F0A71F]" />
        <input value={askText} onChange={(e) => setAskText(e.target.value)} placeholder="Ask Alex anything, or say what you'd like to do…" className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" aria-label="Ask Alex" />
        <button type="submit" aria-label="Ask" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-white hover:bg-[#0a4a99]"><ArrowUp className="h-4 w-4" /></button>
      </form>
    </section>
  );
}

/**
 * Small doors in a row: the slot, the green room, the accounts, the co-host
 * hours. Four cards took a third of the screen to say four words; a row of
 * icons says them in a line, and the accounts — the part worth looking at —
 * get the space instead.
 */
export function QuickDoors({
  greenRoomHref,
  slotLabel,
  shareUrl,
  agendaHref,
  onGo,
}: {
  greenRoomHref: string | null;
  slotLabel: string | null;
  /** The podcaster's own share page, copied with one tap. */
  shareUrl: string | null;
  agendaHref: string;
  onGo: (screen: Screen) => void;
}) {
  const [copied, setCopied] = useState(false);
  const doors: { key: string; label: string; icon: React.ReactNode; onClick?: () => void; href?: string; to?: string; accent?: boolean }[] = [
    { key: "slot", label: slotLabel ?? "Pick your slot", icon: <CalendarDays className="h-4 w-4" />, onClick: () => onGo("events") },
    ...(greenRoomHref ? [{ key: "green-room", label: "Green room", icon: <StudioIcon className="h-6 w-6 rounded-md" tone="green" />, href: greenRoomHref, accent: true }] : []),
    // Manage lives in the corner of the accounts strip already; the door
    // that earns its place is the one that gets the show in front of people.
    ...(shareUrl
      ? [{ key: "share", label: copied ? "Link copied" : "Share link", icon: copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Share2 className="h-4 w-4" />, onClick: () => {
          navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => onGo("promotion"));
        } }]
      : [{ key: "promotion", label: "Promotion", icon: <Share2 className="h-4 w-4" />, onClick: () => onGo("promotion") }]),
    // The whole day, as the public sees it. Co-hosting has its own card
    // below, so it does not need a door up here.
    { key: "agenda", label: "Full agenda", icon: <ListOrdered className="h-4 w-4" />, to: agendaHref },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid="quick-doors">
      {doors.map((d) => {
        const cls = `inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
          d.accent ? "border-emerald-600 bg-white text-foreground hover:bg-emerald-50 dark:bg-card" : "border-border bg-card text-foreground hover:border-[#053877]/40 hover:bg-[#053877]/[0.04]"
        }`;
        const inner = (<>{d.icon}<span>{d.label}</span></>);
        return d.to ? (
          <Link key={d.key} href={d.to} className={cls} data-testid={`door-${d.key}`}>{inner}</Link>
        ) : d.href ? (
          <a key={d.key} href={d.href} target="_blank" rel="noreferrer" className={cls} data-testid={`door-${d.key}`}>{inner}</a>
        ) : (
          <button key={d.key} type="button" onClick={d.onClick} className={cls} data-testid={`door-${d.key}`}>{inner}</button>
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
  eventStartUtc,
  eventName,
  title = "Before the day",
}: {
  todos: { key: string; label: string; screen: Screen; optional?: boolean }[];
  onGo: (screen: Screen) => void;
  eventStartUtc?: string;
  eventName?: string;
  /** The heading over the list. */
  title?: string;
}) {
  const required = todos.filter((t) => !t.optional);
  // The countdown lives with the list of what is left, where it means
  // something, rather than after the date in the header.
  const daysToGo = eventStartUtc ? Math.max(0, Math.ceil((Date.parse(eventStartUtc) - Date.now()) / 86_400_000)) : null;
  const countdown = daysToGo == null ? null : daysToGo === 0 ? `${eventName ?? "The day"} is today` : `${daysToGo} day${daysToGo === 1 ? "" : "s"} to go`;
  return (
    <div className="h-full rounded-2xl border border-border bg-card p-5" data-testid="todo-strip">
      {countdown && (
        <p className="mb-2 text-2xl font-bold tabular-nums tracking-tight text-[#053877]" data-testid="text-days-to-go">{countdown}</p>
      )}
      {required.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4" /> You're all set — nothing left to do.
        </p>
      ) : (
        <p className="text-sm font-semibold text-foreground">
          {title} <span className="ml-1.5 font-normal text-foreground/80">· {required.length} to do</span>
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
                  ? "border-border text-foreground/80 hover:border-foreground/40 hover:text-foreground"
                  : "border-[#053877] bg-[#053877]/[0.06] text-foreground hover:bg-[#053877]/[0.12]"
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
