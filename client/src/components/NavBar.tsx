import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Moon, Sun, LogIn, LayoutDashboard, Menu, Headphones } from "lucide-react";
import { LogoLockup } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/theme";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { ProfileRow } from "@shared/schema";

function scrollToAnchor(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  const hash = href.split("#")[1];
  if (!hash) return;
  const el = document.getElementById(hash);
  if (el) {
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.pushState(null, "", href);
  }
  // else: fall through to native navigation (different page)
}

// Section anchors live on the landing page.
const LINKS: { href: string; label: string; anchor?: boolean }[] = [
  { href: "/#podcasters", label: "Podcasters", anchor: true },
  { href: "/#listeners", label: "Listeners", anchor: true },
  { href: "/agenda", label: "Agenda" },
  { href: "/faq", label: "FAQ" },
  { href: "/platform", label: "About Us" },
];

export function NavBar() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  // Signed-in podcasters see "Dashboard" instead of "Sign in". 401 → null.
  const { data: me } = useQuery<ProfileRow | null>({
    queryKey: ["/api/host/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 60_000,
  });
  const signedIn = me !== null && me !== undefined;

  // The green room is only a link if there's a room to walk into — which means
  // holding a slot on an event. Shown greyed rather than hidden for anyone
  // signed in without one, so it reads as "not yet" rather than "not for you".
  // Shares the cache with the dashboard's own copy — same key, same fetcher —
  // so on any page that already asks for it this costs nothing, and elsewhere
  // it is one request that stands for five minutes.
  const { data: myEvents } = useQuery<{ slotIndex: number | null; event: { slug: string; isFeatured: boolean } }[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
    enabled: signedIn,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const booked = (myEvents ?? []).find((e) => e.slotIndex != null);
  const greenRoomHref = booked
    ? booked.event.isFeatured === false && booked.event.slug
      ? `/event/${booked.event.slug}/studio`
      : "/studio"
    : "";

  const linkCls = (active: boolean) =>
    `whitespace-nowrap rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors hover-elevate ${
      active ? "text-primary" : "text-muted-foreground"
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
        <Link href="/" className="shrink-0" data-testid="link-home-logo">
          <LogoLockup />
        </Link>

        {/* Desktop links */}
        <nav className="hidden items-center gap-3 lg:flex xl:gap-5" aria-label="Primary">
          {LINKS.map((link) => {
            const active = !link.anchor && (location === link.href || (location.startsWith("/event/") && location.endsWith(link.href)));
            return link.anchor ? (
              <a key={link.href} href={link.href} onClick={(e) => scrollToAnchor(e, link.href)} className={linkCls(false)} data-testid={`link-nav-${link.label.toLowerCase()}`}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className={linkCls(active)} data-testid={`link-nav-${link.label.toLowerCase()}`}>
                {link.label}
              </Link>
            );
          })}
          <Link href="/sponsor" className={linkCls(location === "/sponsor")} data-testid="link-nav-sponsors">
            Sponsors
          </Link>
          {signedIn &&
            (greenRoomHref ? (
              <Link
                href={greenRoomHref}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#F0A71F] px-3 py-1.5 text-[15px] font-semibold text-[#1a1200] transition-colors hover:bg-[#f7b73a]"
                data-testid="link-nav-green-room"
              >
                <Headphones className="h-3.5 w-3.5" /> Green room
              </Link>
            ) : (
              <span
                className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[15px] font-medium text-muted-foreground/50"
                title="Take a time on an event and your green room opens here"
                data-testid="link-nav-green-room-off"
              >
                <Headphones className="h-3.5 w-3.5" /> Green room
              </span>
            ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Link href="/host/dashboard" data-testid="link-nav-signin">
            <Button
              size="sm"
              variant={location.startsWith("/host") ? "default" : "outline"}
              className="gap-1.5 rounded-full"
            >
              {signedIn ? <LayoutDashboard className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
              <span>{signedIn ? "Dashboard" : "Sign in"}</span>
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          {/* Mobile menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" data-testid="button-nav-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {LINKS.map((link) =>
                link.anchor ? (
                  <DropdownMenuItem key={link.href} asChild>
                    <a href={link.href} onClick={(e) => scrollToAnchor(e, link.href)}>{link.label}</a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={link.href} asChild>
                    <Link href={link.href}>{link.label}</Link>
                  </DropdownMenuItem>
                ),
              )}
              <DropdownMenuSeparator />
              {signedIn && greenRoomHref && (
                <DropdownMenuItem asChild>
                  <Link href={greenRoomHref}>Green room</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link href="/sponsor">Sponsors</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/events">All events</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
