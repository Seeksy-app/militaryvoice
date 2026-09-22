import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  MonitorPlay,
  ListOrdered,
  Users,
  Handshake,
  Megaphone,
  Mail,
  Contact,
  DollarSign,
  Settings2,
  CalendarDays,
  DoorOpen,
  PanelLeftClose,
  PanelLeftOpen, Film,} from "lucide-react";

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
      { key: "clips", label: "Recordings & clips", icon: Film },
    ],
  },
  {
    title: "Who's in it",
    items: [
      { key: "signups", label: "Podcasters", icon: Users },
      { key: "sponsors", label: "Sponsors", icon: Handshake },
      { key: "team", label: "Team", icon: Contact },
    ],
  },
  {
    title: "Getting an audience",
    items: [
      { key: "promotion", label: "Promotion", icon: Megaphone },
      { key: "social", label: "Social calendar", icon: CalendarDays },
      { key: "crm", label: "CRM", icon: Mail },
    ],
  },
  {
    title: "The event itself",
    items: [
      { key: "finances", label: "Finances", icon: DollarSign },
      { key: "setup", label: "Event details", icon: Settings2 },
    ],
  },
];

export const TOP_GROUPS: { title: string; items: AdminSection[] }[] = [
  {
    title: "",
    items: [
      { key: "events", label: "Events", icon: CalendarDays },
      { key: "rooms", label: "Rooms", icon: DoorOpen },
      // Contacts live in the event's CRM now — one CRM, not one per level.
      { key: "team", label: "Team", icon: Contact },
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

      <div className="flex flex-col gap-4">
        {groups.map((g, gi) => (
          <div key={g.title || gi}>
            {g.title && !collapsed && (
              <div className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground/70">
                {g.title}
              </div>
            )}
            {/* Collapsed, the heading becomes a rule: the grouping is still
                visible, it just stops taking a line to say so. */}
            {g.title && collapsed && gi > 0 && <div className="mx-2 mb-1.5 h-px bg-border" />}
            <div className="flex flex-col gap-0.5">
              {g.items.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChange(key)}
                  title={collapsed ? label : undefined}
                  className={`flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors ${
                    collapsed ? "justify-center px-0" : "px-2.5"
                  } ${
                    value === key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  data-testid={`tab-admin-${key}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={`mt-4 flex items-center gap-2.5 rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${
          collapsed ? "w-full justify-center" : "px-2.5"
        }`}
        data-testid="button-admin-nav-collapse"
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        {!collapsed && "Collapse"}
      </button>
    </nav>
  );
}
