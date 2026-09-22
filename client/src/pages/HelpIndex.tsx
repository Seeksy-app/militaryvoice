import { Link } from "wouter";
import { ArrowRight, ExternalLink, KeyRound, Headphones, Youtube, Radio, Handshake } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { HelpSearch, askAlex } from "@/components/HelpSearch";
import { HELP_INDEX, HELP_CATEGORIES, type HelpCategory, type HelpEntry } from "@/lib/helpIndex";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const CATEGORY_ICON: Record<HelpCategory, typeof KeyRound> = {
  lineup: KeyRound,
  showday: Headphones,
  youtube: Youtube,
  watching: Radio,
  sponsors: Handshake,
};

/** The articles people open most. Kept by hand, in the order they get asked. */
const MOST_ASKED = [
  "Send your slot to your own YouTube",
  "Sign in to your dashboard",
  "Google says the app isn't verified",
  "Live, or a recorded episode",
  "Pick or change your slot",
  "The green room on show day",
  "Your photo and your card",
  "When is it, and how do I watch?",
];

/** A help article opens here. The dashboard and the rest open in a new tab, so the help stays put. */
function HelpLink({ e, className, children }: { e: HelpEntry; className: string; children: React.ReactNode }) {
  return e.href.startsWith("/help/") ? (
    <Link href={e.href} className={className} data-testid={`help-link-${e.href}`}>{children}</Link>
  ) : (
    <a href={e.href} target="_blank" rel="noreferrer" className={className} data-testid={`help-link-${e.href}`}>{children}</a>
  );
}

/**
 * The help, in one place, laid out like a knowledge base: a dark band with
 * the search in it, the articles people open most, then a shelf for each
 * part of the day with its articles listed. Alex at the bottom for the rest.
 */
export default function HelpIndex() {
  const mostAsked = MOST_ASKED.map((t) => HELP_INDEX.find((e) => e.title === t)).filter((e): e is HelpEntry => !!e);
  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      {/* The band: one question, one box. */}
      <section className="bg-[#04102b] text-white">
        <div className="mx-auto w-full max-w-4xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#F0A71F]">Help</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>How can we help?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/75">
            Search the help, or ask Alex. She answers now, and gets you to a person when she can't.
          </p>
          <div className="mt-8 text-left">
            <HelpSearch autoFocus />
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        {/* What people open most */}
        <section className="py-12 sm:py-14">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>Most asked</h2>
          <ul className="mx-auto mt-8 grid max-w-3xl gap-x-12 gap-y-4 sm:grid-cols-2">
            {mostAsked.map((e) => (
              <li key={e.title}>
                <HelpLink e={e} className="group inline-flex items-center gap-2 text-base font-semibold text-foreground hover:text-[#053877]">
                  {e.title}
                  {e.href.startsWith("/help/") ? <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /> : <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
                </HelpLink>
              </li>
            ))}
          </ul>
        </section>

        {/* A shelf for each part of the day */}
        <section className="border-t border-border py-12 sm:py-14">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {HELP_CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICON[c.key];
              const items = HELP_INDEX.filter((e) => e.category === c.key);
              return (
                <div key={c.key} className="flex flex-col rounded-3xl border border-border bg-card p-6" data-testid={`help-category-${c.key}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#053877]/10 text-[#053877]"><Icon className="h-6 w-6" /></span>
                    <div>
                      <h3 className="text-lg font-bold leading-tight" style={HEADLINE_FONT}>{c.title}</h3>
                      <p className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "article" : "articles"}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{c.blurb}</p>
                  <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
                    {items.map((e) => (
                      <li key={e.title}>
                        <HelpLink e={e} className="group flex items-center justify-between gap-3 py-2.5 text-sm font-medium text-foreground hover:text-[#053877]">
                          <span>{e.title}</span>
                          {e.href.startsWith("/help/") ? <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" /> : <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        </HelpLink>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {/* Alex, on the shelf with the rest */}
            <div className="flex flex-col justify-between rounded-3xl bg-[#04102b] p-6 text-white" data-testid="help-category-alex">
              <div>
                <img src="/alex.jpg" alt="Alex" className="h-14 w-14 rounded-full object-cover ring-4 ring-[#F0A71F]/40" />
                <h3 className="mt-4 text-lg font-bold leading-tight" style={HEADLINE_FONT}>Didn't find it? Ask Alex.</h3>
                <p className="mt-2 text-sm text-white/75">She knows the day, the site and your dashboard. If it needs a person, she hands you to one and someone emails you back.</p>
              </div>
              <button type="button" onClick={() => askAlex()} className="mt-5 rounded-full bg-[#F0A71F] px-5 py-2.5 text-sm font-semibold text-[#1a1200] hover:brightness-105" data-testid="help-ask-alex-bottom">Ask Alex</button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
