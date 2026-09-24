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

type FooterLink = { href: string; label: string; external?: boolean };

export function SiteFooter({ slug, note }: { slug?: string; /** A small line above the copyright, e.g. the roadmap note on About. */ note?: string } = {}) {
  const agendaHref = slug ? `/event/${slug}/agenda` : "/agenda";
  const scheduleHref = slug ? `/event/${slug}/schedule` : "/schedule";

  // The whole site, in three columns, on every page.
  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: "The Podcast Marathon",
      links: [
        { href: "/#podcasters", label: "Podcasters", external: true },
        { href: "/#listeners", label: "Listeners", external: true },
        { href: scheduleHref, label: "Schedule" },
        { href: agendaHref, label: "Agenda" },
        { href: "/prepare", label: "Podcaster guide" },
        { href: "/sponsor", label: "Sponsors" },
      ],
    },
    {
      title: "Platform",
      links: [
        { href: "/discover", label: "Discovery" },
        { href: "/directory", label: "Directory" },
        { href: "/events", label: "Events" },
        { href: "/watchfloor", label: "Studio" },
        { href: "/platform", label: "About Us" },
      ],
    },
    {
      title: "Help",
      links: [
        { href: "/faq", label: "FAQ" },
        { href: "/help", label: "Help centre" },
        { href: "mailto:hello@militaryvoices.ai", label: "Contact", external: true },
        { href: "/host/dashboard", label: "Sign in" },
      ],
    },
  ];

  return (
    <footer className="text-white" style={{ backgroundColor: NAVY }} data-testid="site-footer">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          {/* Always the dark-ground lockup: this band is navy in both themes,
              so the theme-swapping one puts near-black letters on navy. */}
          <LogoLockupOnDark className="h-12 w-auto shrink-0 self-start" />
          <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3">
            {columns.map((c) => (
              <nav key={c.title} aria-label={c.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">{c.title}</p>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-white/65">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href} className="transition-colors hover:text-white">{l.label}</a>
                      ) : (
                        <Link href={l.href} className="transition-colors hover:text-white">{l.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/15 pt-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p>© {new Date().getFullYear()} MilitaryVoices.ai. All rights reserved.</p>
            {note && <p className="mt-1 text-white/40">{note}</p>}
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="transition-colors hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-white">
              Terms &amp; Conditions
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
