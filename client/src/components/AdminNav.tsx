import { useEffect, useState } from "react";
import { BarChart3, ChevronDown, LayoutDashboard, MonitorPlay, ListOrdered, Users, Handshake, Megaphone, Mail, Contact, DollarSign, Settings2, CalendarDays, DoorOpen, PanelLeftClose, PanelLeftOpen, Film, Compass, BookOpen, BadgeCheck, BookUser, Activity, MessagesSquare, ClipboardList, NotebookPen, Smartphone, KanbanSquare, Building2 } from "lucide-react";

// The admin's nav, down the left.
//
// It was ten tabs across the top, which is two more than a tab bar can carry
// before it stops being a row you read and becomes a row you hunt. Ten items
// down a column read fine — a column has room for the group headings that turn
// a list into a map, and every item keeps the same x-position, so muscle memory
// works. The cost is width, and it is a real cost on the run of show and the
// CRM, so the rail collapses to icons and remembers that you collapsed it.
//
// On a phone it is a scrolling strip instead: a sidebar on a 390px screen is
// just a wall. That rendering also fixed something — the old mobile tab bar
// showed five of the ten and buried the rest inside Overview.

export interface AdminSection {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
}

/** Grouped by what you came to do, not by what the data happens to be. */
export const EVENT_GROUPS: { title: string; items: AdminSection[] }[] = [
  {
    title: "The show",
    items: [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      { key: "studio", label: "Studio", icon: MonitorPlay },
      { key: "run", label: "Run of show", icon: ListOrdered },
      { key: "greenroom", label: "Green room chat", icon: MessagesSquare },
      { key: "clips", label: "Recordings & clips", icon: Film },
    ],
  },
  {
    title: "Who's in it",
    items: [
      { key: "signups", label: "Podcasters", icon: Users },
      { key: "sponsors", label: "Sponsors", icon: Handshake },
      { key: "team", label: "Team", icon: Contact },
      { key: "texts", label: "Texts", icon: Smartphone },
      { key: "survey", label: "Survey", icon: ClipboardList },
    ],
  },
  {
    title: "Getting an audience",
    items: [
      { key: "promotion", label: "Promotion", icon: Megaphone },
      { key: "magazine", label: "Magazine", icon: BookOpen },
      { key: "social", label: "Social calendar", icon: CalendarDays },
      { key: "crm", label: "CRM", icon: Mail },
    ],
  },
  {
    title: "The event itself",
    items: [
      { key: "finances", label: "Finances", icon: DollarSign },
      { key: "aar", label: "AAR", icon: NotebookPen },
      { key: "setup", label: "Event details", icon: Settings2 },
      // Not the event's, but needed from wherever you are.
      { key: "health", label: "System health", icon: Activity },
    ],
  },
];

// Grouped like the members' nav (8 Oct): a few headings you can fold, not thirteen in a row.
export const TOP_GROUPS: { title: string; items: AdminSection[] }[] = [
  { title: "", items: [{ key: "overview", label: "Overview", icon: LayoutDashboard }] },
  {
    title: "People",
    items: [
      // The platform's CRM: every member and everyone tied to us, with Mail; each event keeps its own too.
      { key: "crm", label: "CRM & mail", icon: Mail },
      { key: "directory", label: "Member Directory", icon: BookUser },
      { key: "verified", label: "Verified", icon: BadgeCheck },
      // Brands, agencies and event organizers: accounts with teams of their own.
      { key: "orgs", label: "Organizations", icon: Building2 },
    ],
  },
  {
    title: "Events & studio",
    items: [
      { key: "events", label: "Events", icon: CalendarDays },
      { key: "rooms", label: "Rooms", icon: DoorOpen },
    ],
  },
  {
    title: "Growth",
    items: [
      { key: "analytics", label: "Analytics", icon: BarChart3 },
      { key: "discovery", label: "Discovery", icon: Compass },
      { key: "projects", label: "Projects", icon: KanbanSquare },
    ],
  },
  {
    title: "Running it",
    items: [
      { key: "team", label: "Team", icon: Contact },
      { key: "finances", label: "Finances", icon: DollarSign },
      { key: "aar", label: "AAR", icon: NotebookPen },
      { key: "health", label: "System health", icon: Activity },
    ],
  },
];

/** The keys each level owns, so a URL slug is checked against the level it
 *  actually lands in — /admin/rooms with an event open must not blank the page. */
const keysOf = (groups: { items: AdminSection[] }[]) =>
  new Set(groups.flatMap((g) => g.items.map((i) => i.key)));
export const EVENT_SECTION_KEYS = keysOf(EVENT_GROUPS);
export const TOP_SECTION_KEYS = keysOf(TOP_GROUPS);

export function AdminNav({
  groups,
  value,
  onChange,
  isMobile,
  header,
}: {
  groups: { title: string; items: AdminSection[] }[];
  value: string;
  onChange: (key: string) => void;
  isMobile: boolean;
  /** Rendered above the list on desktop — the "← All events" link. */
  header?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("mv_admin_nav") === "icons");
  // Which headings are folded, remembered like the members' nav.
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("mv_admin_folded") || "[]"); } catch { return []; } });
  const fold = (t: string) => setClosed((c) => { const next = c.includes(t) ? c.filter((x) => x !== t) : [...c, t]; try { localStorage.setItem("mv_admin_folded", JSON.stringify(next)); } catch { /* fine */ } return next; });
  useEffect(() => {
    localStorage.setItem("mv_admin_nav", collapsed ? "icons" : "full");
  }, [collapsed]);

  if (isMobile) {
    return (
      <nav
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Admin sections"
      >
        {groups.flatMap((g) => g.items).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              value === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-admin-${key}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav
      className={`sticky top-4 shrink-0 self-start ${collapsed ? "w-[3.75rem]" : "w-[13.5rem]"}`}
      aria-label="Admin sections"
    >
      {header && !collapsed && <div className="mb-3">{header}</div>}

      <div className="flex flex-col">
        {groups.map((g, gi) => {
          const folded = !!g.title && !collapsed && closed.includes(g.title) && !g.items.some((i) => i.key === value);
          return (
            <div key={g.title || gi} className={gi ? "mt-2 border-t border-border pt-2" : ""}>
              {/* Headings like the members' nav: sentence case, and they fold (never over the page you're on). */}
              {g.title && !collapsed && (
                <button type="button" onClick={() => fold(g.title)} aria-expanded={!folded} className="flex w-full items-center justify-between rounded-full px-4 py-1.5 text-left text-[13px] font-medium text-foreground/80 hover:bg-muted" data-testid={`admin-group-${g.title}`}>
                  {g.title} <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${folded ? "-rotate-90" : ""}`} />
                </button>
              )}
              {!folded && (
                <div className="flex flex-col gap-0.5">
                  {g.items.map(({ key, label, icon: Icon }) => {
                    const on = value === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onChange(key)}
                        title={collapsed ? label : undefined}
                        className={`flex items-center gap-3 rounded-full py-2 text-left text-[14px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#053877]/30 ${collapsed ? "justify-center px-0" : "px-4"} ${
                          on ? "bg-[#053877]/[0.12] font-semibold text-[#053877] dark:bg-white/[0.14] dark:text-white" : "text-foreground/75 hover:bg-muted hover:text-foreground"
                        }`}
                        data-testid={`tab-admin-${key}`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${on ? "text-[#053877] dark:text-white" : "text-muted-foreground"}`} />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={`mt-3 flex items-center gap-3 rounded-full border-t border-border py-2 pt-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${
          collapsed ? "w-full justify-center" : "px-4"
        }`}
        data-testid="button-admin-nav-collapse"
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        {!collapsed && "Collapse"}
      </button>
    </nav>
  );
}
