import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
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
