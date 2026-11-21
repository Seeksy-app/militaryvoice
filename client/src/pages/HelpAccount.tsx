import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { CreditCard } from "lucide-react";
import { ADDONS, CREDIT_PACKS, FREE_DISCOVERY, PLANS, cents } from "@shared/tokens";

/**
 * The account menu's Plan & billing and Recently deleted. Prices and
 * allowances come from shared/tokens.ts, so this page can't drift from what
 * we charge; the labels are PlanBilling.tsx's and RecentlyDeleted.tsx's.
 */
export default function HelpAccount() {
  useEffect(() => {
    document.title = "Plan, billing and Recently deleted — MilitaryVoices.ai help";
  }, []);
  const pack = CREDIT_PACKS.find((p) => "popular" in p) ?? CREDIT_PACKS[0];
  const pro = ADDONS.discovery;

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Your account"
        title="Your plan, credits, and what you deleted"
        lead={<>Two things live in your account menu (press your photo, top right): <strong>Plan &amp; billing</strong> and <strong>Recently deleted</strong>.</>}
        toc={[["#free", "Growth: what's free"], ["#plans", "Pōstify plans"], ["#credits", "Credits"], ["#discovery", "Discovery Pro"], ["#manage", "Manage billing"], ["#deleted", "Recently deleted"], ["#team", "Co-hosts and your team"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="free" title="Growth: what's free">
          <p>Growth is the free plan. Your SmartLink, podcast hosting and Ask my show are free, always, and your first Pōstify episode is free too. Discovery comes with Scale and Pro; for brands and event planners it's free.</p>
        </HelpSection>

        <HelpSection n={2} id="plans" title="Pōstify plans">
          <p>A plan gives you credits every month for clips and clean episodes.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>{PLANS.creator.name}</strong>, {cents(PLANS.creator.cents)} a month: {PLANS.creator.credits} credits a month, {PLANS.creator.clipsPerEpisode} clips an episode.</li>
            <li><strong>{PLANS.pro.name}</strong>, {cents(PLANS.pro.cents)} a month: {PLANS.pro.credits} credits a month, {PLANS.pro.clipsPerEpisode} clips an episode.</li>
            <li>Both take the MilitaryVoices.ai bar off your SmartLink.</li>
          </ul>
          <HelpStep k="a">Open the account menu and press <strong>Plan &amp; billing</strong>.</HelpStep>
          <HelpStep k="b">Press <strong>Upgrade to {PLANS.creator.name}</strong> or <strong>Upgrade to {PLANS.pro.name}</strong>. Checkout is secure, by Stripe.</HelpStep>
          <p className="mt-3">Paying yearly gets two months free: choose <strong>Yearly</strong> in Pōstify's <strong>Pick a plan</strong> window. Cancel any time.</p>
        </HelpSection>

        <HelpSection n={3} id="credits" title="Credits">
          <p>Credits pay for clips, clean episodes, and contact emails past your monthly ones. Credits you buy don't run out.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>An episode</strong> in Pōstify: 8 credits (12 on {PLANS.pro.name}) for every clip in all three shapes with animated captions, and the clean episode. Classic captions: 5 (7 on {PLANS.pro.name}).</li>
            <li><strong>Music and text edits</strong> are included.</li>
            <li><strong>A contact email</strong> in Discovery, past your monthly ones: 1 credit. Once paid for, it's free to see again.</li>
          </ul>
          <p className="mt-3">Everything that uses a credit, and how many: <Link href="/help/credits" className="font-medium text-primary hover:underline">What uses credits</Link>.</p>
          <p className="mt-3">To top up, press <strong>Buy {pack.tokens} credits · ${pack.price}</strong> in Plan &amp; billing. On a monthly plan, if you run out, extra credits go on your next bill, up to a limit you set in Pōstify.</p>
        </HelpSection>

        <HelpSection n={4} id="discovery" title="Discovery Pro">
          <p>Discovery comes with Scale and Pro (and is free for brands and event planners), with a taste each month: {FREE_DISCOVERY.searches} searches, {FREE_DISCOVERY.lookups} full creator profiles and {FREE_DISCOVERY.reveals} contact emails. <strong>{pro.name}</strong> raises that to {pro.searches} searches, {pro.lookups} full profiles and {pro.reveals} contact emails a month, and includes Verified creators, for {cents(pro.cents)} a month. It searches 800M+ creator profiles across 6 platforms. It comes with the {PLANS.pro.name} plan, and you don't need a Pōstify plan to buy it on its own. Verified creators (everyone MilitaryVoices knows, with real numbers) comes with the {PLANS.pro.name} plan, or is {cents(ADDONS.verified.cents)} a month on its own.</p>
          <HelpStep k="a">In Plan &amp; billing, press <strong>Add {pro.name}</strong>.</HelpStep>
          <HelpStep k="b">Once it's on, the same card shows how many contact emails you have left this month, and <strong>Manage</strong>.</HelpStep>
          <p className="mt-3">Past your monthly contact emails or full profiles, each one is 1 credit, and once you've paid for one it's free to open again. See <Link href="/help/guests" className="font-medium text-primary hover:underline">Book a guest, or be one</Link>.</p>
        </HelpSection>

        <HelpSection n={5} id="manage" title="Manage billing">
          <p>On a plan, Plan &amp; billing shows your plan, your credits a month and when it renews. Press <strong>Manage billing</strong> to open Stripe's secure billing page: change your card, see your invoices, or cancel.</p>
          <p className="mt-3">If a payment didn't go through, your plan says so. Update your card in Manage billing.</p>
        </HelpSection>

        <HelpSection n={6} id="deleted" title="Recently deleted">
          <p>Anything you delete waits here for 15 days, so you can put it back just as it was. After that it's gone for good.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Library episodes</strong>, with their clean and edited copies and their clips.</li>
            <li><strong>Clips</strong>. They go back with their episode.</li>
            <li><strong>Podcast episodes</strong>. A published one returns to your feed as the same episode.</li>
            <li><strong>Whole podcasts</strong>, with their episodes. The feed comes back on.</li>
            <li><strong>Files</strong> you've uploaded.</li>
          </ul>
          <HelpStep k="a">Open the account menu and press <strong>Recently deleted</strong>. Each item shows how many days it has left.</HelpStep>
          <HelpStep k="b">Press <strong>Put it back</strong>. It's back where it was.</HelpStep>
          <p className="mt-3">Want it gone now? Press <strong>Delete now</strong>. That can't be undone.</p>
          <HelpNote>Deleting a podcast episode takes it out of your feed, and the apps drop it on their next check. It doesn't take it off YouTube: if you posted it there, remove it in YouTube Studio.</HelpNote>
        </HelpSection>

        <HelpSection n={7} id="team" title="Co-hosts and your team">
          <p>Your co-hosts don't need an account. They join your show on a link, the same way a guest does.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Your Radio show:</strong> in your Radio show, press <strong>Copy guest link</strong>, next to your show name, and send it to them. The same button is there before it opens.</li>
            <li><strong>Your studio:</strong> in your studio, press <strong>Invite guests</strong> at the top to copy your link, and send it. They open it, type their name, and come in.</li>
            <li><strong>Zoom:</strong> they join your Zoom meeting as usual. The recording comes into your Library from your own Zoom account.</li>
          </ul>
          <HelpSub>Can my team share one account?</HelpSub>
          <p className="mt-2">Not with their own logins yet. An account belongs to one email address, and each sign-in sends a 6-digit code to that address. If your team uses a shared show email, everyone who reads it can sign in. Separate team logins are on our list; if you need one now, write to us.</p>
        </HelpSection>

        <HelpContact n={8} />

        <HelpCta icon={CreditCard} text="Your plan, credits and Discovery Pro are in one place." label="Open Plan & billing" href="/host/dashboard/billing" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
