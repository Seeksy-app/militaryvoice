import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Moon, Sun, LogIn, LayoutDashboard, Menu, Bookmark } from "lucide-react";
import { LogoLockup, LogoLockupOnDark } from "@/components/Logo";
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
  { href: "/events", label: "Events" },
  { href: "/discover", label: "Discovery" },
  { href: "/directory", label: "Directory" },
  { href: "/faq", label: "FAQ" },
  { href: "/platform", label: "About Us" },
];

/**
 * Discovery is its own MilitaryVoices product, not a page of the event: on it
 * the bar carries the product's links, and "Sign in" is the Discovery account.
 */
const DISCOVERY_LINKS: { href: string; label: string; anchor?: boolean }[] = [
  // One platform now: the way back to the events sits beside the tools.
  { href: "/events", label: "Events" },
  { href: "/discover", label: "Discovery" },
  { href: "/directory", label: "Directory" },
  { href: "/platform", label: "About MilitaryVoices" },
];

export function NavBar({ product, account, tone = "light", bare = false }: { product?: "discovery"; account?: { label: string; onClick: () => void; icon?: "saved" | "signin" }; /** "dark": sits on a navy band (the homepage), white type, the dark logo. */ tone?: "light" | "dark"; /** Inside a band that already carries the logo: no logo, not sticky. */ bare?: boolean } = {}) {
  const dark = tone === "dark";
  const [location] = useLocation();
  const links = product === "discovery" ? DISCOVERY_LINKS : LINKS;
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
    dark
      ? `whitespace-nowrap rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors ${active ? "text-[#F0A71F]" : "text-white/75 hover:text-white"}`
      : `whitespace-nowrap rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors hover-elevate ${
          active ? "text-primary" : "text-muted-foreground"
        }`;

  return (
    <header className={bare ? "relative z-40 border-t border-white/10 text-white" : dark ? "sticky top-0 z-40 bg-[#030b1f]/95 text-white backdrop-blur" : "sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur"}>
      <div className={`mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6 ${bare ? "lg:px-10" : ""}`}>
        {!bare && (
          <Link href="/" className="shrink-0" data-testid="link-home-logo">
            {dark ? <LogoLockupOnDark className="h-14 lg:h-[72px]" /> : <LogoLockup />}
          </Link>
        )}

        {/* Desktop links */}
        <nav className={`hidden items-center gap-3 lg:flex xl:gap-5 ${bare ? "-ml-2.5" : ""}`} aria-label="Primary">
          {links.map((link) => {
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
          {product !== "discovery" && (
            <Link href="/sponsor" className={linkCls(location === "/sponsor")} data-testid="link-nav-sponsors">
              Sponsors
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-1.5">
          {account ? (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={account.onClick} data-testid="link-nav-account">
                {account.icon === "saved" ? <Bookmark className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
                <span>{account.label}</span>
              </Button>
              {/* Signed in: the account's own home is one click away from any tool. */}
              {signedIn && (
                <Link href="/host/dashboard" data-testid="link-nav-signin">
                  <Button size="sm" className="gap-1.5 rounded-full">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Dashboard</span>
                  </Button>
                </Link>
              )}
            </>
          ) : (
            <Link href="/host/dashboard" data-testid="link-nav-signin">
              <Button
                size="sm"
                variant={location.startsWith("/host") ? "default" : "outline"}
                className={dark ? "gap-1.5 rounded-full border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white" : "gap-1.5 rounded-full"}
              >
                {signedIn ? <LayoutDashboard className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
                <span>{signedIn ? "Dashboard" : "Sign in"}</span>
              </Button>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={dark ? "text-white hover:bg-white/10 hover:text-white" : undefined}
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          {/* Mobile menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={`lg:hidden ${dark ? "text-white hover:bg-white/10 hover:text-white" : ""}`} aria-label="Open menu" data-testid="button-nav-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {links.map((link) =>
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
              {product !== "discovery" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/sponsor">Sponsors</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/events">All events</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
