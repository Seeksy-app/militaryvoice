import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Search, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchHelp } from "@/lib/helpIndex";

/** Open Alex's chat from anywhere, with a question already typed. */
export function askAlex(question = "") {
  window.dispatchEvent(new CustomEvent("mv:ask-alex", { detail: { question } }));
}

/**
 * The strip at the top of every help page: a search box for helping
 * yourself, and Alex for when the search doesn't have it. The search runs
 * over the help index in the browser; there is nothing to wait for.
 */
export function HelpSearch({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => (q.trim() ? searchHelp(q).slice(0, compact ? 4 : 8) : []), [q, compact]);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="help-search">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && results.length === 0) askAlex(q.trim()); }}
            autoFocus={autoFocus}
            placeholder="Search help — YouTube, sign in, your slot, the green room…"
            className="h-11 pl-10 text-base"
            data-testid="help-search-input"
          />
        </div>
        <Button type="button" onClick={() => askAlex(q.trim())} className="h-11 shrink-0 gap-2 rounded-full bg-[#053877] px-4 text-white hover:bg-[#0a4a99]" data-testid="help-ask-alex">
          <img src="/alex.jpg" alt="" className="-ml-1.5 h-7 w-7 rounded-full object-cover ring-2 ring-white/30" />
          Ask Alex
        </Button>
      </div>
      {q.trim() && (
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {results.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Nothing in the help for that yet.</span>
              <button type="button" onClick={() => askAlex(q.trim())} className="font-medium text-[#053877] hover:underline">Ask Alex instead →</button>
            </div>
          ) : (
            results.map((r) => {
              const inner = (
                <>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{r.title}</span>
                    <span className="block text-xs text-muted-foreground">{r.summary}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              );
              const cls = "flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent";
              // Help articles open here; the dashboard and the rest open in a new tab.
              return r.href.startsWith("/help/") || r.href.startsWith("/faq") ? (
                <Link key={r.href + r.title} href={r.href} className={cls} data-testid={`help-result-${r.href}`}>{inner}</Link>
              ) : (
                <a key={r.href + r.title} href={r.href} target="_blank" rel="noreferrer" className={cls} data-testid={`help-result-${r.href}`}>{inner}</a>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
