import type { ComponentType } from "react";
import { LayoutDashboard, UserRound, CalendarDays, Link2, Megaphone, Users, Film, Mail, Contact, MonitorPlay, Lock } from "lucide-react";

export type HostScreen = "dashboard" | "editProfile" | "events" | "integrations" | "promotion" | "recordings" | "contacts" | "pro";

interface Item {
  key: HostScreen;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  /** A door that is not open yet: shown, greyed, and it opens the Pro page. */
  locked?: boolean;
  feature?: string;
}

/**
 * The podcaster's nav, down the left — the same shape as the admin's.
 *
 * Six tabs across the top was already a row you hunt, and a seventh
 * (Contacts) and three doors that are not open yet (Pro) would not have fit.
 * A column has room for group headings, every item keeps its x-position, and
 * a locked item can sit in it honestly: greyed, with a lock, going to a page
 * that shows what is behind it. On a phone it is a scrolling strip.
 */
export function HostNav({
  screen,
  eventsCount,
  contactsCount,
  pathFor,
  onGo,
}: {
  screen: HostScreen;
  eventsCount: number;
  contactsCount: number;
  pathFor: (s: HostScreen) => string;
  onGo: (s: HostScreen, feature?: string) => void;
}) {
  const groups: { title: string; items: Item[] }[] = [
    {
      title: "Your show",
      items: [
        { key: "dashboard", label: "Dashboard", hint: "Your card and slot", icon: LayoutDashboard },
        { key: "editProfile", label: "Profile", hint: "About you", icon: UserRound },
        { key: "events", label: "Event settings", hint: "Your show and time", icon: CalendarDays, badge: eventsCount || undefined },
      ],
    },
    {
      title: "Getting an audience",
      items: [
        { key: "integrations", label: "Integrations", hint: "Connected accounts", icon: Link2 },
        { key: "promotion", label: "Promotion", hint: "Get people watching", icon: Megaphone },
        ...(contactsCount > 0 ? [{ key: "contacts" as const, label: "Contacts", hint: `${contactsCount} asked for a reminder`, icon: Users }] : []),
      ],
    },
    {
      title: "After the show",
      items: [{ key: "recordings", label: "Recordings & clips", hint: "Yours after the show", icon: Film }],
    },
    {
      title: "Pro · coming soon",
      items: [
        { key: "pro", label: "Email campaigns", hint: "Write to your listeners", icon: Mail, locked: true, feature: "campaigns" },
        { key: "pro", label: "Contacts CRM", hint: "Everyone who found you", icon: Contact, locked: true, feature: "crm" },
        { key: "pro", label: "Your own studio", hint: "Stream and record, any day", icon: MonitorPlay, locked: true, feature: "studio" },
      ],
    },
  ];

  const link = (it: Item, compact: boolean) => {
    const active = screen === it.key && !it.locked;
    const Icon = it.icon;
    return (
      <a
        key={`${it.key}-${it.feature ?? ""}`}
        href={it.locked ? `${pathFor("pro")}#${it.feature}` : pathFor(it.key)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onGo(it.key, it.feature);
        }}
        aria-current={active ? "page" : undefined}
        className={
          compact
            ? `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${
                active ? "bg-[#053877] text-white" : it.locked ? "bg-muted text-muted-foreground" : "bg-[#053877]/[0.06] text-foreground"
              }`
            : `flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                active
                  ? "bg-[#053877] text-white shadow-sm"
                  : it.locked
                    ? "text-muted-foreground hover:bg-muted"
                    : "text-foreground hover:bg-[#053877]/[0.06]"
              }`
        }
        data-testid={`nav-host-${it.key}${it.feature ? `-${it.feature}` : ""}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : it.locked ? "text-muted-foreground/70" : "text-[#053877]"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            {it.label}
            {it.badge != null && (
              <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none ${active ? "bg-white text-[#053877]" : "bg-[#F0A71F] text-[#1a1200]"}`} data-testid="badge-host-events-count">
                {it.badge}
              </span>
            )}
            {it.locked && <Lock className="h-3 w-3 opacity-60" />}
          </span>
          {!compact && <span className={`block text-[12px] ${active ? "text-white/75" : "text-muted-foreground"}`}>{it.hint}</span>}
        </span>
      </a>
    );
  };

  return (
    <>
      {/* Phone: one scrolling strip. */}
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Dashboard sections">
        {groups.flatMap((g) => g.items).map((it) => link(it, true))}
      </nav>
      {/* Desktop: the column. */}
      <nav className="sticky top-6 hidden self-start lg:block" aria-label="Dashboard sections">
        <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-3 shadow-sm">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{g.title}</p>
              <div className="flex flex-col gap-0.5">{g.items.map((it) => link(it, false))}</div>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
