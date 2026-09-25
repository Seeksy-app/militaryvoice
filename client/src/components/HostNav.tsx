import type { ComponentType } from "react";
import { LayoutDashboard, UserRound, CalendarDays, Link2, Users, Mail, Contact, MonitorPlay, Lock, LifeBuoy, Mic2, Compass, BarChart3, Wand2, ChevronsUpDown, LogOut, Library, Share2 } from "lucide-react";
import { Link } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type HostScreen = "dashboard" | "editProfile" | "events" | "integrations" | "promotion" | "greenroom" | "recordings" | "contacts" | "pro" | "cohost" | "analytics" | "postify" | "social";

interface Item {
  key: HostScreen;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  /** A door that is not open yet: shown, greyed, and it opens the Pro page. */
  locked?: boolean;
  feature?: string;
  /** A page rather than a screen: the help hub. */
  href?: string;
  /** A small word after the label, e.g. "Beta". */
  tag?: string;
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
  feature,
  proOpen = false,
  cohostHours = 0,
  account,
}: {
  /** The person, at the foot of the column: where Profile and Sign out live, as in most apps. */
  account?: { name: string; email: string; photo: string; onSignOut: () => void };
  screen: HostScreen;
  /** Hours they hold at the desk as co-host; the door shows when there are any. */
  cohostHours?: number;
  eventsCount: number;
  contactsCount: number;
  pathFor: (s: HostScreen) => string;
  onGo: (s: HostScreen, feature?: string) => void;
  /** Which Pro door is open, when the Pro page is the screen. */
  feature?: string;
  /** Whether the Pro doors open at all. They are shown to everyone and open
   *  only for the organisers' own account until the previews are worth it. */
  proOpen?: boolean;
}) {
  const groups: { title: string; items: Item[] }[] = [
    // Most-used first. Promotion lives inside Events (it's about an event);
    // Profile and Integrations live in the account card at the foot.
    {
      title: "Your show",
      items: [
        { key: "dashboard", label: "Dashboard", hint: "Your card and slot", icon: LayoutDashboard },
        { key: "events", label: "Events", hint: "Your show, your time, and promoting it", icon: CalendarDays, badge: eventsCount || undefined },
        ...(cohostHours > 0 ? [{ key: "cohost" as const, label: "Co-host dashboard", hint: `Your ${cohostHours} ${cohostHours === 1 ? "hour" : "hours"} at the desk`, icon: Mic2 }] : []),
      ],
    },
    {
      title: "Content",
      items: [
        { key: "recordings", label: "Library", hint: "Your episodes: studio sessions, uploads and clean episodes", icon: Library },
        { key: "postify", label: "Pōstify", hint: "Clips and a clean episode, from any episode", icon: Wand2, tag: "Beta" },
        { key: "social", label: "Social", hint: "Post and schedule to your accounts", icon: Share2 },
      ],
    },
    {
      title: "Audience",
      items: [
        { key: "analytics", label: "Your analytics", hint: "What a sponsor sees about you", icon: BarChart3 },
        ...(contactsCount > 0 ? [{ key: "contacts" as const, label: "Contacts", hint: `${contactsCount} asked for a reminder`, icon: Users }] : []),
      ],
    },
    // Pro is one quiet line until it opens. Three greyed doors with locks were
    // three more things to read on a page that already asked too much.
    {
      title: "Coming soon",
      items: proOpen
        ? [
            { key: "pro", label: "Email campaigns", hint: "Write to your listeners", icon: Mail, locked: true, feature: "campaigns" },
            { key: "pro", label: "Contacts CRM", hint: "Everyone who found you", icon: Contact, locked: true, feature: "crm" },
            { key: "pro", label: "Your own studio", hint: "Stream and record, any day", icon: MonitorPlay, locked: true, feature: "studio" },
          ]
        : [{ key: "pro", label: "Pro tools", hint: "Email campaigns, a contacts CRM and your own studio — after the Marathon", icon: Lock, locked: true, feature: "campaigns" }],
    },
    {
      title: "Help",
      items: [
        { key: "dashboard", label: "Discovery", hint: "Find guests, creators and speakers", icon: Compass, href: "/discover" },
        { key: "dashboard", label: "Help", hint: "Search the help, or ask Alex", icon: LifeBuoy, href: "/help" },
      ],
    },
  ];

  const accountItems: Item[] = [
    { key: "editProfile", label: "Profile", hint: "About you", icon: UserRound },
    { key: "integrations", label: "Integrations", hint: "Connected accounts", icon: Link2 },
  ];

  const link = (it: Item, compact: boolean) => {
    const Icon = it.icon;
    if (it.href) {
      return (
        <Link
          key={`href-${it.href}`}
          href={it.href}
          title={compact ? undefined : it.hint}
          className={compact
            ? "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#053877]/[0.06] px-3 py-1.5 text-sm font-medium text-foreground"
            : "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-white/75 transition-colors hover:bg-white/10 hover:text-white"}
          data-testid={`nav-host-help`}
        >
          <Icon className={`h-4 w-4 shrink-0 ${compact ? "text-[#053877]" : "text-white/60"}`} />
          <span className="min-w-0 flex-1 text-[14.5px] font-medium">{it.label}</span>
        </Link>
      );
    }
    const active = it.locked ? screen === "pro" && (feature ?? "campaigns") === it.feature : screen === it.key || (it.key === "events" && (screen === "promotion" || screen === "greenroom"));
    const inert = !!it.locked && !proOpen;
    return (
      <a
        key={`${it.key}-${it.feature ?? ""}`}
        href={inert ? undefined : it.locked ? `${pathFor("pro")}#${it.feature}` : pathFor(it.key)}
        aria-disabled={inert || undefined}
        onClick={(e) => {
          if (inert) { e.preventDefault(); return; }
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onGo(it.key, it.feature);
        }}
        aria-current={active ? "page" : undefined}
        // The hint moved to the tooltip: a second grey line under every item
        // doubled the words in the column and made it hard to find anything.
        title={compact ? undefined : inert ? "Coming after the Marathon" : it.hint}
        className={
          compact
            ? `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${
                active ? "bg-[#053877] text-white" : it.locked ? "bg-muted text-muted-foreground" : "bg-[#053877]/[0.06] text-foreground"
              }`
            : `relative flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                active
                  ? "bg-white/[0.12] text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[#F0A71F]"
                  : it.locked
                    ? `text-white/40 ${proOpen ? "hover:bg-white/10" : "cursor-default"}`
                    : "text-white/75 hover:bg-white/10 hover:text-white"
              }`
        }
        data-testid={`nav-host-${it.key}${it.feature ? `-${it.feature}` : ""}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${compact ? (active ? "text-white" : it.locked ? "text-muted-foreground/70" : "text-[#053877]") : active ? "text-[#F0A71F]" : it.locked ? "text-white/35" : "text-white/60"}`} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14.5px] font-medium">
          {it.label}
          {it.badge != null && (
            <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none ${compact ? (active ? "bg-white text-[#053877]" : "bg-[#053877] text-white") : "bg-[#F0A71F] text-[#1a1200]"}`} data-testid="badge-host-events-count">
              {it.badge}
            </span>
          )}
          {it.tag && (
            <span className={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide ${compact ? "bg-[#F0A71F]/20 text-[#8a5a00]" : "bg-[#F0A71F]/20 text-[#F0A71F]"}`}>{it.tag}</span>
          )}
          {it.locked && compact && <Lock className="h-3 w-3 opacity-60" />}
        </span>
      </a>
    );
  };

  return (
    <>
      {/* Phone: one scrolling strip. */}
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Dashboard sections">
        {/* No account card on a phone: Profile and Integrations join the strip. */}
        {[...groups.flatMap((g) => g.items), ...accountItems].map((it) => link(it, true))}
      </nav>
      {/* Desktop: the column. */}
      <nav className="sticky top-6 hidden self-start lg:block lg:min-h-[calc(100vh-10rem)]" aria-label="Dashboard sections">
        {/* Navy, the same as the command card beside it, so the page reads
            as one dark frame with the work in the middle. */}
        <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-5 rounded-2xl bg-[#04102b] p-3 shadow-sm">
          {groups.map((g) => {
            const items = g.items;
            return (
              // What isn't live yet sits apart from what is: a gap and a rule above it.
              <div key={g.title} className={g.title === "Help" ? "mt-auto" : g.title === "Coming soon" ? "mt-6 border-t border-white/10 pt-6" : undefined}>
                <p className="mb-1.5 px-3 text-xs font-extrabold uppercase tracking-[0.14em] text-white">{g.title}</p>
                <div className="flex flex-col gap-0.5">{items.map((it) => link(it, false))}</div>
              </div>
            );
          })}
          {account && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`-mt-2 flex w-full items-center gap-2.5 rounded-xl border border-white/10 p-2 text-left transition-colors hover:bg-white/10 ${screen === "editProfile" || screen === "integrations" ? "bg-white/[0.12]" : ""}`}
                  data-testid="nav-host-account"
                >
                  {account.photo ? (
                    <img src={account.photo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">{account.name.trim().charAt(0).toUpperCase()}</span>
                  )}
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-semibold text-white">{account.name}</span>
                    <span className="block truncate text-[11px] text-white/50">Account settings</span>
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/40" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-[216px]">
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{account.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onGo("editProfile")} className="gap-2" data-testid="account-profile"><UserRound className="h-4 w-4" /> Profile</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onGo("integrations")} className="gap-2" data-testid="account-integrations"><Link2 className="h-4 w-4" /> Integrations</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={account.onSignOut} className="gap-2" data-testid="account-signout"><LogOut className="h-4 w-4" /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>
    </>
  );
}
