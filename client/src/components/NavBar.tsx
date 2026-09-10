import { Link, useLocation } from "wouter";
import { Moon, Sun, ShieldCheck } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

const LINKS = [
  { href: "/", label: "Schedule" },
  { href: "/agenda", label: "Agenda" },
];

export function NavBar() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-primary" data-testid="link-home-logo">
          <LogoMark className="h-7 w-7" />
          <Wordmark className="text-lg text-foreground" />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
          {LINKS.map((link) => {
            const active = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                data-testid={`link-nav-${link.label.toLowerCase()}`}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover-elevate ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            href="/admin"
            data-testid="link-nav-admin"
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover-elevate ${
              location === "/admin" ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Host</span>
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
        </nav>
      </div>
    </header>
  );
}
