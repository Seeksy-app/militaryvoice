import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CreditCard, Loader2, Sparkles, Search, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PLANS, ADDONS, FREE_DISCOVERY, CREDIT_PACKS, cents } from "@shared/tokens";
import { startPlanCheckout, startAddonCheckout, startTokenCheckout, openBillingPortal } from "@/lib/tokens";
import { IconTile } from "@/components/ui/icon-tile";

type Features = {
  beta: { tokens: number; payments: boolean; unlimited?: boolean };
  /** comp: a gift from us (no Stripe behind it, so no billing page to manage). */
  plan: { key: string; name: string; comp?: boolean; interval: "month" | "year"; credits: number; periodEnd: string; status: string } | null;
};
type DiscoverMe = { member: object | null; discoveryPro?: boolean; reveals: { used: number; allowance: number } | null };

const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");

/**
 * Account > Plan & billing: what they're on, what's left, and one button to
 * go up (or to Stripe's page to change or cancel). Everything paid in one place.
 */
export function PlanBilling() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const features = useQuery<Features>({ queryKey: ["/api/host/features"] });
  const me = useQuery<DiscoverMe>({ queryKey: ["/api/discover/me"] });
  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast({ title: "That didn't open", description: (e as Error).message?.replace(/^\d+:\s*/, "") || "Try again in a moment.", variant: "destructive" }); setBusy(null); }
  };
  if (features.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const plan = features.data?.plan;
  const onPlan = !!plan && ["active", "trialing", "past_due"].includes(plan.status);
  const credits = features.data?.beta.tokens ?? 0;
  const pro = !!me.data?.discoveryPro;
  const reveals = me.data?.reveals;
  const spin = (k: string) => busy === k && <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="plan-billing">
      <h1 className="text-2xl font-bold tracking-tight">Plan &amp; billing</h1>

      {/* The plan: the big one, first. */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Your plan</p>
            {/* The plan names everywhere else (6 Oct): Growth is the free one. */}
            <p className="mt-1 text-xl font-bold">{onPlan ? plan!.name : "Growth"}{onPlan && plan!.comp && <span className="ml-2 rounded-full bg-emerald-600/10 px-2 py-0.5 align-middle text-xs font-semibold text-emerald-700 dark:text-emerald-400">Gift</span>}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {onPlan && plan!.comp
                ? `${plan!.credits} credits a month, on us${plan!.periodEnd ? ` until ${day(plan!.periodEnd)}` : ""}.`
                : onPlan
                ? `${plan!.credits} credits a month${plan!.interval === "year" ? ", paid yearly" : ""}${plan!.periodEnd ? ` · renews ${day(plan!.periodEnd)}` : ""}${plan!.status === "past_due" ? " · payment didn't go through" : ""}`
                : features.data?.beta.unlimited ? "Free, always, and a tester's unlimited credits on top." : "Free, always: your SmartLink, podcast hosting and Ask my show."}
            </p>
          </div>
          {onPlan && !plan!.comp && (
            <Button variant="outline" onClick={() => void go("portal", openBillingPortal)} disabled={busy !== null} className="gap-2 rounded-full" data-testid="billing-manage">
              {spin("portal") || <CreditCard className="h-4 w-4" />} Manage billing
            </Button>
          )}
        </div>
        {!onPlan && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Object.values(PLANS).map((p) => (
              <div key={p.key} className={`flex flex-col rounded-xl border p-4 ${"popular" in p ? "border-[#053877] ring-1 ring-[#053877]/30" : "border-border"}`} data-testid={`billing-plan-${p.key}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm"><span className="text-lg font-bold">{cents(p.cents)}</span>/month</p>
                </div>
                <ul className="mt-2 flex-1 space-y-1 text-sm text-muted-foreground">
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{p.credits} credits a month for clips and clean episodes</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{p.clipsPerEpisode} clips an episode</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Take the MilitaryVoices.ai bar off your SmartLink</li>
                </ul>
                <Button onClick={() => void go(p.key, () => startPlanCheckout(p.key))} disabled={busy !== null} className="mt-4 gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid={`billing-upgrade-${p.key}`}>
                  {spin(p.key) || <Sparkles className="h-4 w-4" />} Upgrade to {p.name}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Credits: what's left, and a top-up. */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={Coins} />
          <div className="min-w-0">
            <p className="font-semibold">{credits} credit{credits === 1 ? "" : "s"}</p>
            <p className="text-sm text-muted-foreground">For clips, clean episodes and contact emails past your monthly ones. They don't run out.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => { const pk = CREDIT_PACKS.find((x) => "popular" in x) ?? CREDIT_PACKS[0]; void go("pack", () => startTokenCheckout(pk.key)); }} disabled={busy !== null} className="gap-2 rounded-full" data-testid="billing-buy-credits">
          {spin("pack")} Buy 50 credits · $35
        </Button>
      </section>

      {/* Discovery Pro: its own monthly add-on. */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={Search} />
          <div className="min-w-0">
            <p className="font-semibold">{ADDONS.discovery.name}{pro ? " · on" : ""}</p>
            <p className="text-sm text-muted-foreground">
              {pro ? `${ADDONS.discovery.reveals} contact emails a month` : `${ADDONS.discovery.reveals} contact emails a month instead of ${FREE_DISCOVERY.reveals}, for ${cents(ADDONS.discovery.cents)}/month`}
              {reveals ? ` · ${Math.max(0, reveals.allowance - reveals.used)} left this month` : ""}
            </p>
          </div>
        </div>
        {pro ? (
          <Button variant="outline" onClick={() => void go("portal-d", openBillingPortal)} disabled={busy !== null} className="gap-2 rounded-full" data-testid="billing-manage-discovery">{spin("portal-d")} Manage</Button>
        ) : (
          <Button onClick={() => void go("discovery", () => startAddonCheckout("discovery"))} disabled={busy !== null} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="billing-add-discovery">{spin("discovery")} Add {ADDONS.discovery.name}</Button>
        )}
      </section>

      <p className="text-center text-sm text-muted-foreground">Compare everything on the <a href="/pricing" className="font-medium text-[#053877] hover:underline dark:text-white">pricing page</a>.</p>
    </div>
  );
}
