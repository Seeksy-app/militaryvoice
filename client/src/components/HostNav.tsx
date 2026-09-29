import { useToast } from "@/hooks/use-toast";
import { useState, type ComponentType, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LogoLockup } from "@/components/Logo";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { GetTheApp } from "@/components/GetTheApp";
import { LayoutDashboard, Plus, Podcast, Clapperboard, Film, Upload, Globe, ChevronRight, ChevronDown, UserRound, CalendarDays, Link2, Users, Mail, Contact, MonitorPlay, Lock, LifeBuoy, Mic2, Compass, BarChart3, Wand2, ChevronsUpDown, LogOut, Library, Share2, Headphones, PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, Check, MoreHorizontal, BadgeCheck, CreditCard, Trash2, Video, Radio } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationsMenuItem } from "@/components/Notifications";
import { Link } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type HostScreen = "dashboard" | "editProfile" | "events" | "integrations" | "promotion" | "greenroom" | "recordings" | "contacts" | "pro" | "cohost" | "analytics" | "postify" | "social" | "discovery" | "verified" | "podcast" | "page" | "billing" | "trash" | "studio";

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
  /** Not built yet: a click says when, and goes nowhere. */
  soon?: string;
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
  admin,
  collapsed = false,
  onToggle,
  credits,
  create,
}: {
  /** + Create, at the top of the column: wraps the trigger in the Dashboard's Create menu. */
  create?: (trigger: React.ReactElement) => ReactNode;
  /** Their credit balance: the column's version and the rail's. */
  credits?: { column: ReactNode; rail: ReactNode };
  /** Folded to a rail of icons (names on hover), with the button that opens it again. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** The admin's Back to admin / View as, under the mark (only ever passed for an admin). */
  admin?: ReactNode;
  /** The person, at the foot of the column: where Profile and Sign out live, as in most apps.
   *  `admin` is the admin's own items (Back to admin, View as), at the top of that menu. */
  account?: { name: string; email: string; photo: string; onSignOut: () => void; admin?: ReactNode };
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
  const { toast } = useToast();
  const groups: { title: string; items: Item[] }[] = [
    // Most-used first. Promotion lives inside Events (it's about an event);
    // Profile lives in the account card at the foot; Integrations is in both.
    {
      title: "Your show",
      items: [
        { key: "dashboard", label: "Dashboard", hint: "Your home base: your events, your audience and what to do next", icon: LayoutDashboard },
        { key: "page", label: "SmartLink", hint: "Your SmartLink at militaryvoices.ai/you: your podcast, links, messages from listeners, and a media kit for brands", icon: Globe },
        { key: "events", label: "Events", hint: "The events you're part of: your show, your time slot and how to promote it", icon: CalendarDays, badge: eventsCount || undefined },
        ...(cohostHours > 0 ? [{ key: "cohost" as const, label: "Co-host dashboard", hint: `The ${cohostHours} ${cohostHours === 1 ? "hour" : "hours"} you're co-hosting at the desk, and who's on with you`, icon: Mic2 }] : []),
      ],
    },
    {
      title: "Content",
      items: [
        { key: "studio", label: "Rooms", hint: "Quick, like Zoom: hop in with guests, record it or don't, and go live", icon: Video },
        { key: "pro", feature: "studio", label: "Studio", hint: "The full marathon studio for your own show: scenes, layouts, lower thirds and a producer console. Coming Oct 5th.", icon: MonitorPlay, tag: "Oct 5", soon: "Studio is coming Oct 5th" },
        { key: "recordings", label: "Library", hint: "Every episode in one place: studio recordings, uploads, Zoom calls and cleaned-up versions", icon: Library },
        { key: "postify", label: "Pōstify", hint: "Create short clips from your video podcast, and clean up the full episode", icon: Wand2, tag: "Beta" },
        { key: "podcast", label: "Podcast", hint: "Host your show: your RSS feed for Apple and Spotify, episodes, and downloads sponsors trust", icon: Podcast },
        { key: "social", label: "Social", hint: "Post and schedule your clips to all your social accounts from one calendar", icon: Share2 },
      ],
    },
    {
      title: "Audience",
      items: [
        { key: "analytics", label: "Your analytics", hint: "Your followers, reach and engagement as sponsors see them, and what to charge", icon: BarChart3 },
        { key: "discovery", label: "Discovery", hint: "Search military and veteran creators to find guests, partners and sponsors", icon: Compass },
        { key: "verified", label: "Verified creators", hint: "Creators on MilitaryVoices we know personally, each one checked by our team", icon: BadgeCheck },
        ...(contactsCount > 0 ? [{ key: "contacts" as const, label: "Contacts", hint: `${contactsCount} ${contactsCount === 1 ? "person wants" : "people want"} to hear from you`, icon: Users }] : []),
      ],
    },
    // Pro is one quiet line until it opens. Three greyed doors with locks were
    // three more things to read on a page that already asked too much.
    {
      title: "Coming soon",
      // One quiet line: what's coming shouldn't take the space of what's here.
      items: [{ key: "pro", label: "Pro tools", hint: "Email campaigns, a contacts CRM and your own studio, coming after the Marathon", icon: Lock, locked: true, feature: "campaigns", tag: "Soon" }],
    },
    {
      title: "Help",
      items: [
        { key: "dashboard", label: "Help", hint: "Search the help articles, or ask Alex, our assistant", icon: LifeBuoy, href: "/help" },
      ],
    },
  ];

  const greenRoomItem: Item = { key: "greenroom", label: "Green room", hint: "Join the studio for your slot, and check your camera and mic first", icon: Headphones };
  const accountItems: Item[] = [
    { key: "editProfile", label: "Profile", hint: "Your photo, bio and service details that listeners and sponsors see", icon: UserRound },
  ];

  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("mv_nav_folded") || "[]"); } catch { return []; } });
  const fold = (t: string) => setClosed((c) => { const n = c.includes(t) ? c.filter((x) => x !== t) : [...c, t]; try { localStorage.setItem("mv_nav_folded", JSON.stringify(n)); } catch { /* fine */ } return n; });

  const rawLink = (it: Item, compact: boolean) => {
    const Icon = it.icon;
    if (it.href) {
      return (
        <Link
          key={`href-${it.href}`}
          href={it.href}
          className={compact
            ? "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#053877]/[0.06] px-3 py-1.5 text-sm font-medium text-foreground"
            : "flex items-center gap-3 rounded-full px-4 py-2 text-left text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"}
          data-testid={`nav-host-help`}
        >
          <Icon className={`h-4 w-4 shrink-0 ${compact ? "text-[#053877]" : "text-muted-foreground"}`} />
          <span className="min-w-0 flex-1 text-[14px] font-medium">{it.label}</span>
        </Link>
      );
    }
    const active = it.soon ? false : it.locked ? screen === "pro" && (feature ?? "campaigns") === it.feature : screen === it.key || (it.key === "events" && (screen === "promotion" || (screen === "greenroom" && !compact)));
    const inert = !!it.locked && !proOpen;
    return (
      <a
        key={`${it.key}-${it.feature ?? ""}`}
        href={inert || it.soon ? undefined : it.locked ? `${pathFor("pro")}#${it.feature}` : pathFor(it.key)}
        aria-disabled={inert || undefined}
        onClick={(e) => {
          if (it.soon) { e.preventDefault(); toast({ title: it.soon, description: "The full marathon studio for your own show. Until then, Rooms has you covered for recording and going live." }); return; }
          if (inert) { e.preventDefault(); return; }
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
            : `relative flex items-center gap-3 rounded-full px-4 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#053877]/30 ${
                active
                  ? "bg-[#053877]/[0.12] font-semibold text-[#053877] dark:bg-white/[0.14] dark:text-white"
                  : it.locked
                    ? `text-muted-foreground ${proOpen ? "hover:bg-muted" : "cursor-default"}`
                    : "text-foreground/75 hover:bg-muted hover:text-foreground"
              }`
        }
        data-testid={`nav-host-${it.key}${it.feature ? `-${it.feature}` : ""}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${compact ? (active ? "text-white" : it.locked ? "text-muted-foreground/70" : "text-[#053877]") : active ? "text-[#053877] dark:text-white" : "text-muted-foreground"}`} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-medium">
          {it.label}
          {it.badge != null && (
            <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none ${compact ? (active ? "bg-white text-[#053877]" : "bg-[#053877] text-white") : "bg-[#F0A71F] text-[#1a1200]"}`} data-testid="badge-host-events-count">
              {it.badge}
            </span>
          )}
          {it.tag && (
            <span className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-semibold leading-4 ${it.locked ? "bg-muted text-muted-foreground" : "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]"}`}>{it.tag}</span>
          )}
          {it.locked && compact && <Lock className="h-3 w-3 opacity-60" />}
        </span>
      </a>
    );
  };
  // The hint on hover, as the app's own tooltip to the right (the browser's grey title box read as broken).
  const link = (it: Item, compact: boolean) => {
    const el = rawLink(it, compact);
    if (compact) return el;
    const tip = !!it.locked && !proOpen ? "Coming after the Marathon" : it.hint;
    return (
      <Tooltip key={`tip-${it.key}-${it.feature ?? it.href ?? ""}`} delayDuration={350}>
        <TooltipTrigger asChild>{el}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} className="max-w-[16rem] text-balance text-xs">{tip}</TooltipContent>
      </Tooltip>
    );
  };

  // The account menu: the admin's way back and View as first (only for an admin), then the person's own.
  const accountMenu = (side: "top" | "right") => account && <AccountMenuContent account={account} onGo={onGo} side={side} />;
  const avatar = (size: string) => account && (account.photo ? (
    <img src={account.photo} alt="" className={`${size} shrink-0 rounded-full object-cover ring-1 ring-border`} />
  ) : (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground`}>{account.name.trim().charAt(0).toUpperCase()}</span>
  ));

  return (
    <>
      {/* Phone: a tab bar at the bottom, as phone apps have it. The four things
          used most, and More for the rest (a sheet from the bottom). */}
      <PhoneTabs
        screen={screen}
        onGo={onGo}
        pathFor={pathFor}
        more={[...groups.flatMap((g) => g.items).flatMap((it) => (it.key === "events" ? [it, greenRoomItem] : [it]))].filter((it) => !it.soon && (it.href || !PHONE_TABS.some((t) => t.key === it.key)))}
        badge={eventsCount}
        proOpen={proOpen}
      />
      {/* Desktop, folded: a rail of the same icons, names on hover, and the button that opens it. */}
      {collapsed ? (
        <nav key="rail" className="sticky top-16 hidden h-[calc(100vh-4rem)] self-start overflow-y-auto border-r border-border bg-card lg:block" aria-label="Dashboard sections">
          <div className="flex min-h-full w-[72px] flex-col items-center gap-1 py-3">
            {account && (
              <CreatePostMenu onGo={onGo}>
                <button type="button" aria-label="Create post" title="Create post" className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#053877] text-white shadow-md hover:bg-[#0a4a99]" data-testid="nav-rail-create-post"><Plus className="h-5 w-5" /></button>
              </CreatePostMenu>
            )}
            {groups.flatMap((g) => g.items).map((it) => {
              const Icon = it.icon;
              const active = screen === it.key || (it.key === "events" && (screen === "promotion" || screen === "greenroom"));
              return (
                <RailButton key={`r-${it.key}-${it.feature ?? ""}-${it.href ?? ""}`} tip={it.label} active={active} href={it.href} onClick={it.href ? undefined : () => onGo(it.key, it.feature)} testid={`nav-rail-${it.key}`}>
                  <Icon className="h-5 w-5" />
                </RailButton>
              );
            })}
          </div>
        </nav>
      ) : (
      /* Desktop: the column. Keyed apart from the rail: sharing DOM left a rail icon behind in it. */
      <nav key="column" className="sticky top-16 hidden h-[calc(100vh-4rem)] self-start overflow-y-auto border-r border-border bg-card lg:block" aria-label="Dashboard sections">
        {/* Like Search Console: flush to the edge, no card; what you're working on at the top; the page you're on as a pill. */}
        <div className="flex min-h-full flex-col px-3 py-3">
          {account && (
            <a
              href={pathFor("page")}
              onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onGo("page"); }}
              className="mb-2 flex items-center gap-3 rounded-2xl border border-border px-3 py-2.5 transition-colors hover:bg-muted"
              data-testid="nav-show"
            >
              {avatar("h-8 w-8")}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold text-foreground">{account.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">Your SmartLink</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </a>
          )}
          {account && (
            <CreatePostMenu onGo={onGo}>
              <button type="button" className="mb-3 inline-flex w-fit items-center gap-2 self-start rounded-2xl bg-[#053877] py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#0a4a99] hover:shadow-lg" data-testid="nav-create-post"><Plus className="h-5 w-5" /> Create post</button>
            </CreatePostMenu>
          )}
          {admin && <div className="mb-1 px-1">{admin}</div>}
          {groups.filter((g) => g.title !== "Coming soon" && g.title !== "Help").map((g, i) => {
            const foldable = g.title !== "Your show";
            const folded = foldable && closed.includes(g.title);
            return (
              <div key={g.title} className={i ? "mt-2 border-t border-border pt-2" : ""}>
                {foldable && (
                  <button type="button" onClick={() => fold(g.title)} aria-expanded={!folded} className="flex w-full items-center justify-between rounded-full px-4 py-1.5 text-left text-[13px] font-medium text-foreground/80 hover:bg-muted" data-testid={`nav-group-${g.title.toLowerCase()}`}>
                    {g.title} <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${folded ? "-rotate-90" : ""}`} />
                  </button>
                )}
                {!folded && <div className="flex flex-col gap-0.5">{g.items.map((it) => link(it, false))}</div>}
              </div>
            );
          })}
          <div className="mt-auto border-t border-border pt-2">
            <div className="flex flex-col gap-0.5">
              {groups.filter((g) => g.title === "Coming soon" || g.title === "Help").flatMap((g) => g.items).map((it) => link(it, false))}
              <GetTheApp variant="navLight" />
            </div>
            <p className="px-4 pb-1 pt-3 text-xs text-muted-foreground"><a href="/privacy" className="hover:text-foreground">Privacy</a><span className="mx-2">·</span><a href="/terms" className="hover:text-foreground">Terms</a></p>
          </div>
        </div>
      </nav>
      )}
    </>
  );
}

const PHONE_TABS: { key: HostScreen; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "dashboard", label: "Home", icon: LayoutDashboard },
  { key: "recordings", label: "Library", icon: Library },
  { key: "postify", label: "Pōstify", icon: Wand2 },
  { key: "social", label: "Social", icon: Share2 },
];

/** The phone's tab bar, fixed to the bottom above the home indicator, and its More sheet. */
function PhoneTabs({ screen, onGo, pathFor, more, badge, proOpen }: { screen: HostScreen; onGo: (s: HostScreen, feature?: string) => void; pathFor: (s: HostScreen) => string; more: Item[]; badge: number; proOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const inTabs = PHONE_TABS.some((t) => t.key === screen);
  const tab = (active: boolean) => `flex flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-semibold ${active ? "text-[#F0A71F]" : "text-white/70"}`;
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#04102b] pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Dashboard sections" data-testid="phone-tabs">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {PHONE_TABS.map((t) => (
            <a key={t.key} href={pathFor(t.key)} onClick={(e) => { e.preventDefault(); onGo(t.key); }} aria-current={screen === t.key ? "page" : undefined} className={tab(screen === t.key)} data-testid={`phone-tab-${t.key}`}>
              <t.icon className="h-5 w-5" /> {t.label}
            </a>
          ))}
          <button type="button" onClick={() => setOpen(true)} className={`relative ${tab(!inTabs)}`} data-testid="phone-tab-more">
            <MoreHorizontal className="h-5 w-5" /> More
            {badge > 0 && <span className="absolute right-[calc(50%-18px)] top-1.5 h-2 w-2 rounded-full bg-[#F0A71F]" aria-hidden />}
          </button>
        </div>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
          <SheetTitle className="px-2 text-base">More</SheetTitle>
          <div className="mt-2 grid grid-cols-1 gap-0.5">
            {more.map((it) => {
              const inert = !!it.locked && !proOpen;
              const go = () => { if (inert) return; setOpen(false); if (it.href) window.location.href = it.href; else onGo(it.key, it.feature); };
              return (
                <button key={`${it.key}-${it.feature ?? it.href ?? ""}`} type="button" onClick={go} disabled={inert} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left ${screen === it.key ? "bg-[#053877]/[0.08]" : "hover:bg-muted"} disabled:opacity-50`} data-testid={`phone-more-${it.key}${it.feature ? `-${it.feature}` : ""}`}>
                  <it.icon className="h-5 w-5 shrink-0 text-[#053877] dark:text-[#8fb5e8]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[15px] font-medium">{it.label}{it.badge != null && <span className="rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{it.badge}</span>}{it.locked && <Lock className="h-3.5 w-3.5 opacity-60" />}</span>
                    <span className="line-clamp-2 block text-xs text-muted-foreground">{inert ? "Coming after the Marathon" : it.hint}</span>
                  </span>
                </button>
              );
            })}
            <div className="px-3"><GetTheApp variant="sheet" /></div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export interface Account { name: string; email: string; photo: string; onSignOut: () => void; admin?: ReactNode }

/** The account menu: the admin's items first (only for an admin), then the person's own. Used by the nav and the phone's header. */
export function AccountMenuContent({ account, onGo, side = "top", align }: { account: Account; onGo: (s: HostScreen) => void; side?: "top" | "right" | "bottom"; align?: "start" | "end" }) {
  return (
    <DropdownMenuContent side={side} align={align ?? (side === "top" ? "start" : "end")} className="w-[232px]">
      {account.admin}
      <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{account.email}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onGo("editProfile")} className="gap-2" data-testid="account-profile"><UserRound className="h-4 w-4" /> Profile</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onGo("integrations")} className="gap-2" data-testid="account-integrations"><Link2 className="h-4 w-4" /> Integrations</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onGo("billing")} className="gap-2" data-testid="account-billing"><CreditCard className="h-4 w-4" /> Plan &amp; billing</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onGo("trash")} className="gap-2" data-testid="account-trash"><Trash2 className="h-4 w-4" /> Recently deleted</DropdownMenuItem>
      <NotificationsMenuItem />
      <DropdownMenuSeparator />
      <Appearance />
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={account.onSignOut} className="gap-2" data-testid="account-signout"><LogOut className="h-4 w-4" /> Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  );
}

/** Their picture, or the first letter of their name. */
/** The person's picture (or initial). `light` for a light background (the computer's top bar); dark is the phone's navy header. */
export function AccountAvatar({ account, size = "h-9 w-9", light = false }: { account: Account; size?: string; light?: boolean }) {
  return account.photo ? (
    <img src={account.photo} alt="" className={`${size} shrink-0 rounded-full object-cover ring-1 ${light ? "ring-border" : "ring-white/20"}`} />
  ) : (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full text-xs font-bold ${light ? "bg-[#053877] text-white" : "bg-white/10 text-white"}`}>{account.name.trim().charAt(0).toUpperCase()}</span>
  );
}

/** Light, dark, or whatever this device is set to: in the account menu, out of the column's way. */
function Appearance() {
  const { mode, setMode } = useTheme();
  const opts: { m: ThemeMode; icon: typeof Sun; label: string }[] = [
    { m: "light", icon: Sun, label: "Light" },
    { m: "dark", icon: Moon, label: "Dark" },
    { m: "auto", icon: Monitor, label: "Match this device" },
  ];
  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
      {opts.map(({ m, icon: Icon, label }) => (
        <DropdownMenuItem key={m} onSelect={(e) => { e.preventDefault(); setMode(m); }} className="gap-2" data-testid={`theme-${m}`}>
          <Icon className="h-4 w-4" /> {label}
          {mode === m && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** One icon on the folded menu, its name on hover. */
function RailButton({ tip, onClick, href, active, testid, children }: { tip: string; onClick?: () => void; href?: string; active?: boolean; testid: string; children: ReactNode }) {
  const cls = `flex h-10 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-[#053877]/[0.12] text-[#053877] dark:bg-white/[0.14] dark:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? <Link href={href} aria-label={tip} className={cls} data-testid={testid}>{children}</Link> : <button type="button" onClick={onClick} aria-label={tip} aria-current={active ? "page" : undefined} className={cls} data-testid={testid}>{children}</button>}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[16rem] text-balance text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** + Create post, at the top of the nav (like Compose): what to post from, then Social opens with it started. */
function CreatePostMenu({ onGo, children }: { onGo: (s: HostScreen) => void; children: React.ReactElement }) {
  const start = (kind: "clips" | "episodes" | "upload") => {
    try { sessionStorage.setItem("mv_social_create", kind); } catch { /* Social still opens */ }
    window.dispatchEvent(new CustomEvent("mv-social-create", { detail: kind }));
    onGo("social");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56 rounded-xl p-1.5">
        <DropdownMenuItem onSelect={() => start("clips")} className="gap-3 rounded-lg px-3 py-2.5 text-sm" data-testid="nav-create-clip"><Clapperboard className="h-5 w-5" /> Choose a clip</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => start("episodes")} className="gap-3 rounded-lg px-3 py-2.5 text-sm" data-testid="nav-create-episode"><Film className="h-5 w-5" /> Choose an episode</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => start("upload")} className="gap-3 rounded-lg px-3 py-2.5 text-sm" data-testid="nav-create-upload"><Upload className="h-5 w-5" /> Upload new</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { window.location.href = "/room"; }} className="gap-3 rounded-lg px-3 py-2.5 text-sm" data-testid="nav-create-live"><Radio className="h-5 w-5" /> Go live</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
