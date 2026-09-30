import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { HelpSearch } from "@/components/HelpSearch";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * A help article across the whole frame: the article down the left, and
 * search and "On this page" in a column that stays beside it as you scroll.
 * A single narrow column left most of a desktop screen empty.
 */
export function HelpArticle({ eyebrow, title, lead, toc, children }: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  toc: [string, string][];
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
      <Link href="/help" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary" data-testid="link-help-back">
        <ArrowLeft className="h-4 w-4" /> All help
      </Link>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      <h1 className="mt-2 max-w-4xl text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl lg:text-5xl" style={HEADLINE_FONT}>{title}</h1>
      <p className="mt-4 max-w-4xl text-lg text-muted-foreground">{lead}</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
        <div className="min-w-0 [&>section:first-child]:mt-0">{children}</div>
        <aside className="order-first lg:order-none">
          <div className="flex flex-col gap-4 lg:sticky lg:top-24">
            <HelpSearch compact />
            <nav className="rounded-2xl border border-border bg-card p-5 text-sm" aria-label="On this page" data-testid="help-contents">
              <p className="font-semibold text-foreground">On this page</p>
              <ol className="mt-2 flex flex-col gap-1.5">
                {toc.map(([href, label], i) => (
                  <li key={href}>
                    <a href={href} className="font-medium text-primary hover:underline">{i + 1}. {label}</a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </aside>
      </div>
    </main>
  );
}

/** A numbered part of an article, with its anchor for "On this page". */
export function HelpSection({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) {
  return (
    <section className="mt-12 scroll-mt-6" id={id}>
      <h2 className="flex items-center gap-3 text-xl font-bold [text-wrap:balance]" style={HEADLINE_FONT}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{n}</span>
        {title}
      </h2>
      <div className="mt-3 text-base leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

/** One step, lettered in gold: a, b, c. */
export function HelpStep({ k, children }: { k: string; children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-xs font-bold text-[#1a1200]">{k}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/** A small heading inside a section, for a second list of steps. */
export function HelpSub({ children }: { children: ReactNode }) {
  return <p className="mt-6 font-semibold text-foreground">{children}</p>;
}

/** A quiet tip under the steps. */
export function HelpNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

/** The card at the foot of an article: where to go to do it. */
export function HelpCta({ icon: Icon, text, label, href }: { icon: ComponentType<{ className?: string }>; text: string; label: string; href: string }) {
  return (
    <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-[#F0A71F]"><Icon className="h-5 w-5" /></span>
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{text}</p>
      <Link href={href} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#053877] px-5 text-sm font-medium text-white hover:bg-[#0a4a99]">
        {label} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** The last section of every article: who to ask. */
export function HelpContact({ n }: { n: number }) {
  return (
    <HelpSection n={n} id="support" title="Help and contact">
      <ul className="list-disc space-y-2 pl-5">
        <li><strong>Email us:</strong>{" "}<a href="mailto:hello@militaryvoices.ai" className="font-medium text-primary hover:underline">hello@militaryvoices.ai</a>. A person reads every message and writes back.</li>
        <li><strong>Search the help, or ask Alex:</strong>{" "}<Link href="/help" className="font-medium text-primary hover:underline">militaryvoices.ai/help</Link>.</li>
      </ul>
    </HelpSection>
  );
}
