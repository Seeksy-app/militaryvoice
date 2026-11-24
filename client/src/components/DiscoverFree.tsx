import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Discovery's free taste for Growth creators (Andrew, 23 Nov 2026: "B: searches too"): 3 searches and 3 full
 * profiles for life, each counted on its own. A search they've run before, its next page, or a profile they've
 * opened before costs nothing; their own profile never counts. The server keeps the count (server/discovery.ts,
 * freeState); this file shows it, and the one upgrade card for when either runs out or they reach for something
 * that only comes with Scale (contact emails, lookalikes, lists).
 */
export type FreeState = { searches: { used: number; allowance: number; left: number }; lookups: { used: number; allowance: number; left: number }; upgrade: boolean };

const EVENT = "mv:discover-upgrade";

/** Open the upgrade card with the line that says why. */
export function openUpgrade(line: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { line } }));
}

/** A search or profile answer carries the count after it: keep the counter current without another request. */
export function noteFree(qc: QueryClient, j: { free?: FreeState | null } | null | undefined) {
  if (!j?.free) return;
  qc.setQueryData(["/api/discover/me"], (m: Record<string, unknown> | undefined) => (m ? { ...m, free: j.free } : m));
}

/** "2 of 3 searches · 3 of 3 look-ups left", with a dot per free use. */
export function FreeCounter({ free, className = "" }: { free: FreeState; className?: string }) {
  const dots = (left: number, all: number) => (
    <span className="inline-flex gap-[3px]" aria-hidden>
      {Array.from({ length: all }, (_, i) => <span key={i} className={`h-2 w-2 rounded-full ${i < left ? "bg-[#053877] dark:bg-[#8fb5e8]" : "bg-muted-foreground/25"}`} />)}
    </span>
  );
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground ${className}`} data-testid="discover-free">
      <span className="inline-flex items-center gap-1.5">{dots(free.searches.left, free.searches.allowance)}<b className="font-semibold text-foreground">{free.searches.left} of {free.searches.allowance}</b> searches</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1.5">{dots(free.lookups.left, free.lookups.allowance)}<b className="font-semibold text-foreground">{free.lookups.left} of {free.lookups.allowance}</b> look-ups left</span>
      <a href="/go/bf" className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Get unlimited</a>
    </p>
  );
}

/** The one upgrade card: Founding Members, Scale free for 30 days. Mounted once on the Discovery page. */
export function FreeUpgrade() {
  const [line, setLine] = useState<string | null>(null);
  const go = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const on = (e: Event) => setLine((e as CustomEvent<{ line: string }>).detail?.line || "Discovery comes with Scale.");
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <Dialog open={line != null} onOpenChange={(o) => !o && setLine(null)}>
      <DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); go.current?.focus(); }} className="max-w-[440px] gap-0 overflow-hidden rounded-3xl p-0" data-testid="discover-upgrade">
        <div className="bg-gradient-to-br from-[#04102b] to-[#053877] px-6 py-5 text-white">
          <span className="inline-block rounded-full bg-[#F0A71F] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-[#04102b]">Founding Members</span>
          <DialogTitle className="mt-2.5 text-balance text-[22px] font-extrabold leading-tight">See every creator with Scale</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-300">{line}</DialogDescription>
        </div>
        <ul className="space-y-2 px-6 pb-1 pt-5 text-sm">
          {["Search and open every creator's full profile", "Contact emails for sponsors and guests", "Your own profile stays free"].map((t) => (
            <li key={t} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />{t}</li>
          ))}
        </ul>
        <div className="flex items-center gap-2 px-6 pb-2 pt-4">
          <a ref={go} href="/go/bf" className="flex-1 rounded-full bg-[#F0A71F] px-4 py-2.5 text-center text-sm font-bold text-[#04102b] hover:brightness-105" data-testid="discover-upgrade-go">Start 30 days free</a>
          <button type="button" onClick={() => setLine(null)} className="px-3 py-2.5 text-sm font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Not now</button>
        </div>
        <p className="px-6 pb-5 text-xs text-muted-foreground">Founding Members get Scale free for 30 days. Cancel any&nbsp;time.</p>
      </DialogContent>
    </Dialog>
  );
}

/** What stays on the page once the card is closed: the same offer, calm, where the results or profile would be. */
export function FreeUsedUp({ line, className = "" }: { line: string; className?: string }) {
  return (
    <div className={`flex flex-col items-start gap-3 rounded-2xl border border-[#053877]/15 bg-[#053877]/[0.04] p-5 sm:flex-row sm:items-center ${className}`} data-testid="discover-used-up">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{line}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Scale opens every creator. Founding Members get it free for 30&nbsp;days.</p>
      </div>
      <a href="/go/bf" className="shrink-0 rounded-full bg-[#F0A71F] px-5 py-2.5 text-sm font-bold text-[#04102b] hover:brightness-105">Start 30 days free</a>
    </div>
  );
}

// ---- Out of credits (24 Nov) ----------------------------------------------------------------------------------------
// A Scale or Pro member past the month's profiles or contacts with no credits left: not the Founding Members card
// (they have a plan) but the credit packs and plans, the same dialog Pōstify opens.
const CREDITS_EVENT = "mv:discover-credits";
const UpgradeDialog = lazy(() => import("@/components/PostStudio").then((m) => ({ default: m.UpgradeDialog })));

/** Open the credit packs and plans. */
export function openCredits() {
  window.dispatchEvent(new CustomEvent(CREDITS_EVENT));
}

/** The credits dialog, mounted once on the Discovery page next to the upgrade card. */
export function CreditsUpgrade() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(CREDITS_EVENT, on);
    return () => window.removeEventListener(CREDITS_EVENT, on);
  }, []);
  if (!open) return null;
  return <Suspense fallback={null}><UpgradeDialog open={open} onOpenChange={setOpen} /></Suspense>;
}

/** Where the profile would be, once the dialog is closed: the same way to more credits. */
export function CreditsUsedUp({ line, className = "" }: { line: string; className?: string }) {
  return (
    <div className={`flex flex-col items-start gap-3 rounded-2xl border border-[#053877]/15 bg-[#053877]/[0.04] p-5 sm:flex-row sm:items-center ${className}`} data-testid="discover-credits-out">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{line}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Add a credit pack, or move up a plan for more credits every&nbsp;month.</p>
      </div>
      <button type="button" onClick={openCredits} className="shrink-0 rounded-full bg-[#F0A71F] px-5 py-2.5 text-sm font-bold text-[#04102b] hover:brightness-105" data-testid="discover-credits-go">Get credits</button>
    </div>
  );
}
