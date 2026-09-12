import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Moon, Sun, LogIn, LayoutDashboard, Menu } from "lucide-react";
import { LogoLockup } from "@/components/Logo";
import { SponsorDialog } from "@/components/SponsorDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/theme";
import { getQueryFn } from "@/lib/queryClient";
import type { ProfileRow } from "@shared/schema";

// Section anchors live on the landing page; plain <a> so the browser handles
// the scroll (same page) or the full navigation (other pages).
const LINKS: { href: string; label: string; anchor?: boolean }[] = [
  { href: "/#podcasters", label: "Podcasters", anchor: true },
  { href: "/#listeners", label: "Listeners", anchor: true },
  { href: "/schedule", label: "Schedule" },
  { href: "/agenda", label: "Agenda" },
  { href: "/faq", label: "FAQ" },
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

  const linkCls = (active: boolean) =>
    `rounded-md px-3 py-2 text-sm font-medium transition-colors hover-elevate ${active ? "text-primary" : "text-muted-foreground"}`;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0" data-testid="link-home-logo">
          <LogoLockup />
        </Link>

        {/* Desktop links */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((link) => {
            const active = !link.anchor && (location === link.href || (location.startsWith("/event/") && location.endsWith(link.href)));
            return link.anchor ? (
              <a key={link.href} href={link.href} className={linkCls(false)} data-testid={`link-nav-${link.label.toLowerCase()}`}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className={linkCls(active)} data-testid={`link-nav-${link.label.toLowerCase()}`}>
                {link.label}
              </Link>
            );
          })}
          <SponsorDialog>
            <button type="button" className={linkCls(false)} data-testid="link-nav-sponsors">
              Sponsors
            </button>
          </SponsorDialog>
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
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" data-testid="button-nav-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {LINKS.map((link) =>
                link.anchor ? (
                  <DropdownMenuItem key={link.href} asChild>
                    <a href={link.href}>{link.label}</a>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={link.href} asChild>
                    <Link href={link.href}>{link.label}</Link>
                  </DropdownMenuItem>
                ),
              )}
              <DropdownMenuSeparator />
              <SponsorDialog>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Sponsors</DropdownMenuItem>
              </SponsorDialog>
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
