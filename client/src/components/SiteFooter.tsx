import { Link } from "wouter";
import { LogoLockupOnDark } from "@/components/Logo";

// The footer, on every public page.
//
// It used to live inline in the homepage and nowhere else, which meant the
// privacy policy and the terms were reachable from exactly one page on the
// site — not a good look for anything, and a real problem for the OAuth
// verification, where the reviewer is told to find them from any page.
//
// It is navy on every page, in both themes, on purpose: it is the one band
// that should read as the end of the document regardless of what colour the
// section above it happens to be.

const NAVY = "#000741";

export function SiteFooter({ slug, product }: { slug?: string; product?: "discovery" }) {
  const agendaHref = slug ? `/event/${slug}/agenda` : "/agenda";
  const scheduleHref = slug ? `/event/${slug}/schedule` : "/schedule";

  // Discovery is its own product: its footer points at the product, not the event.
  const links = product === "discovery" ? [
    { href: "/discover", label: "Discovery" },
    { href: "/platform", label: "About MilitaryVoices" },
    { href: "/help", label: "Help" },
  ] : [
    { href: "/#podcasters", label: "Podcasters", external: true },
    { href: "/#listeners", label: "Listeners", external: true },
    { href: scheduleHref, label: "Schedule" },
    { href: agendaHref, label: "Agenda" },
    { href: "/prepare", label: "Podcaster guide" },
    { href: "/faq", label: "FAQ" },
    { href: "/watchfloor", label: "Studio" },
    { href: "/sponsor", label: "Sponsor" },
    { href: "/host/dashboard", label: "Sign in" },
  ];

  return (
    <footer className="text-white" style={{ backgroundColor: NAVY }} data-testid="site-footer">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          {/* Always the dark-ground lockup: this band is navy in both themes,
              so the theme-swapping one puts near-black letters on navy. */}
          <LogoLockupOnDark className="h-12 w-auto shrink-0 self-start" />
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/65">
            {links.map((l) =>
              l.external ? (
                <a key={l.label} href={l.href} className="transition-colors hover:text-white">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href} className="transition-colors hover:text-white">
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-white/15 pt-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} MilitaryVoices.ai. All rights reserved.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/help" className="transition-colors hover:text-white">
              Help
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-white">
              Terms &amp; Conditions
            </Link>
            <a href="mailto:hello@militaryvoices.ai" className="transition-colors hover:text-white">
              Contact
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
