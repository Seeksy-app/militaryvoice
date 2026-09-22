import { Link } from "wouter";
import { ArrowRight, Youtube, KeyRound, CalendarDays, Headphones, Mic2, Users, HelpCircle } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { HelpSearch, askAlex } from "@/components/HelpSearch";
import { HELP_INDEX } from "@/lib/helpIndex";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const ICONS: Record<string, typeof Youtube> = {
  "/help/youtube": Youtube,
  "/host/dashboard": KeyRound,
  "/schedule": CalendarDays,
  "/prepare": Headphones,
  "/sponsors": Mic2,
  "/agenda": CalendarDays,
  "/faq": HelpCircle,
};

/**
 * The help, in one place: search at the top, Alex beside it, every topic
 * underneath in two groups — for podcasters on the lineup, and for anyone.
 */
export default function HelpIndex() {
  const podcasters = HELP_INDEX.filter((e) => e.audience === "podcasters");
  const everyone = HELP_INDEX.filter((e) => e.audience === "everyone");
  const Card = ({ e }: { e: (typeof HELP_INDEX)[number] }) => {
    const Icon = ICONS[e.href.split("#")[0]] ?? HelpCircle;
    return (
      <Link href={e.href} className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-[#053877]/40" data-testid={`help-card-${e.href}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877]"><Icon className="h-4.5 w-4.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{e.title}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{e.summary}</span>
        </span>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  };
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Help</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>How can we help?</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
          Search the help, or ask Alex. She answers now, and gets you to a person when she can't.
        </p>
        <div className="mt-6">
          <HelpSearch autoFocus />
        </div>

        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-bold" style={HEADLINE_FONT}><Users className="h-5 w-5 text-[#053877]" /> For podcasters on the lineup</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{podcasters.map((e) => <Card key={e.title} e={e} />)}</div>
        </section>
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-bold" style={HEADLINE_FONT}><HelpCircle className="h-5 w-5 text-[#053877]" /> For everyone</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{everyone.map((e) => <Card key={e.title} e={e} />)}</div>
        </section>

        <section className="mt-12 rounded-2xl bg-[#04102b] p-6 text-white sm:p-8">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <img src="/alex.jpg" alt="Alex" className="h-16 w-16 rounded-full object-cover ring-4 ring-[#F0A71F]/40" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold" style={HEADLINE_FONT}>Didn't find it? Ask Alex.</p>
              <p className="text-sm text-white/75">She knows the day, the site and your dashboard. If it needs a person, she'll hand you to one and someone emails you back.</p>
            </div>
            <button type="button" onClick={() => askAlex()} className="rounded-full bg-[#F0A71F] px-5 py-2.5 text-sm font-semibold text-[#1a1200] hover:brightness-105" data-testid="help-ask-alex-bottom">Ask Alex</button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
