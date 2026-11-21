import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Coins } from "lucide-react";
import { ADDONS, CREDIT_PACKS, DEFAULT_OVERAGE_CAP_CENTS, FREE_DISCOVERY, OVERAGE_CAP_CHOICES, PLANS, SHORT_VIDEO_SEC, cents, episodeCredits } from "@shared/tokens";

/**
 * What uses credits (21 Nov 2026, for the (i) beside every credits balance). Every number comes from
 * shared/tokens.ts, and every rule from where the server charges (routes.ts chargeCredits and its callers,
 * discovery.ts), so the page can't drift from what we take. Social posting and guest search aren't here
 * on purpose: how those get paid is still being decided.
 */
export default function HelpCredits() {
  useEffect(() => {
    document.title = "What uses credits — MilitaryVoices.ai help";
  }, []);
  const scale = PLANS.creator, pro = PLANS.pro, disc = ADDONS.discovery;
  const anim = (n: number) => episodeCredits({ captions: "animated" }, n);
  const classic = (n: number) => episodeCredits({ captions: "classic" }, n);
  const caps = OVERAGE_CAP_CHOICES.map((c) => (c === 0 ? "off" : cents(c)));

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Your account"
        title="What uses credits"
        lead={<>Credits pay for the work Pōstify and Discovery do for you. Your SmartLink, podcast hosting and Ask my show are free, always.</>}
        toc={[["#what", "What a credit is"], ["#list", "Everything that uses credits"], ["#free", "What's free"], ["#back", "When you get credits back"], ["#plans", "Credits each month"], ["#more", "Getting more"], ["#balance", "Seeing your balance"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="what" title="What a credit is">
          <p>A credit is how we count work that costs us to make, like cutting and captioning clips. Your plan gives you credits, and you can buy more. Credits come off only when you start something, never for looking around.</p>
        </HelpSection>

        <HelpSection n={2} id="list" title="Everything that uses credits">
          <HelpSub>Pōstify an episode</HelpSub>
          <p className="mt-2">One price covers every clip in all three shapes (tall, square and wide) and the clean episode.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Animated captions:</strong> 2 credits a clip. That's {anim(scale.clipsPerEpisode)} credits on {scale.name} ({scale.clipsPerEpisode} clips) and {anim(pro.clipsPerEpisode)} on {pro.name} ({pro.clipsPerEpisode} clips).</li>
            <li><strong>Classic captions:</strong> 1 credit a clip, plus 1 for the clean episode. That's {classic(scale.clipsPerEpisode)} on {scale.name} and {classic(pro.clipsPerEpisode)} on {pro.name}.</li>
            <li><strong>A short video</strong> ({SHORT_VIDEO_SEC / 60} minutes or less) is one clip: {anim(1)} credits with either caption style.</li>
          </ul>
          <p className="mt-3">Credits come off when you press Start. If something goes wrong and you press Try again, that costs nothing more.</p>

          <HelpSub>More clips from an episode</HelpSub>
          <p className="mt-2">Another set of clips from an episode that's done, none overlapping the ones you have: 2 credits a clip with animated captions, 1 with Classic. The clean episode isn't charged again.</p>

          <HelpSub>A clip you mark yourself</HelpSub>
          <p className="mt-2">Pick the start and end in the Viewer and make it a clip: 1 credit for each shape you choose, so 1 to 3.</p>

          <HelpSub>Cleaning an episode again</HelpSub>
          <p className="mt-2">1 credit.</p>

          <HelpSub>Discovery: full profiles and contact emails</HelpSub>
          <p className="mt-2">Each month you get some free. After that, each full creator profile or contact email is 1 credit. Once you've paid for one, it's free to open again, and a contact email is only charged when we find one to show you.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>With {scale.name} or {pro.name}:</strong> {FREE_DISCOVERY.searches} searches, {FREE_DISCOVERY.lookups} full profiles and {FREE_DISCOVERY.reveals} contact emails a month.</li>
            <li><strong>With {disc.name}</strong> ({cents(disc.cents)} a month): {disc.searches} searches, {disc.lookups} full profiles and {disc.reveals} contact emails a month.</li>
          </ul>
          <p className="mt-3">Searches never use credits. When this month's run out, they're back on the 1st.</p>
        </HelpSection>

        <HelpSection n={3} id="free" title="What's free">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Your first Pōstify episode</strong>, up to 90 minutes.</li>
            <li><strong>Editing your clips:</strong> changing the text and the music.</li>
            <li><strong>Your SmartLink, podcast hosting and Ask my show.</strong></li>
            <li><strong>Asking Alex</strong>, or your own AI guide, how to do something.</li>
          </ul>
        </HelpSection>

        <HelpSection n={4} id="back" title="When you get credits back">
          <p>If an episode has no talking in it (music only, or a silent screen share), there's nothing for Pōstify to clip. Your credits for it come back on their own, once.</p>
        </HelpSection>

        <HelpSection n={5} id="plans" title="Credits each month">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>{scale.name}</strong>, {cents(scale.cents)} a month: {scale.credits} credits a month. Paying yearly ({cents(scale.yearCents)}), the year's {scale.credits * 12} credits come the day you pay.</li>
            <li><strong>{pro.name}</strong>, {cents(pro.cents)} a month, paid every three months ({cents(pro.quarterCents)}): {pro.credits} credits a month, so {pro.credits * 3} arrive with each payment.</li>
          </ul>
          <p className="mt-3">Unused credits carry over while you're on a plan.</p>
        </HelpSection>

        <HelpSection n={6} id="more" title="Getting more">
          <HelpSub>Credit packs</HelpSub>
          <p className="mt-2">Buy them once, no plan needed. Credits you buy don't run out.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {CREDIT_PACKS.map((p) => <li key={p.key}><strong>{p.tokens} credits</strong> for ${p.price}</li>)}
          </ul>
          <HelpSub>Extra credits on your plan</HelpSub>
          <p className="mt-2">If you run out on {scale.name} paid monthly or on {pro.name}, Pōstify carries on and the extra credits go on your next bill: {cents(scale.overageCents)} each on {scale.name}, {cents(pro.overageCents)} on {pro.name}.</p>
          <p className="mt-3">You set a limit, so a bill never surprises you. It starts at {cents(DEFAULT_OVERAGE_CAP_CENTS)} a month, and you can pick {caps.join(", ")}. Change it in Pōstify, under Plan. When you reach it, Pōstify waits for next month's credits or a pack.</p>
          <HelpNote>Yearly plans and free trials don't add extras: top up with a pack instead.</HelpNote>
        </HelpSection>

        <HelpSection n={7} id="balance" title="Seeing your balance">
          <p>Your credits left show at the top of Pōstify and in <strong>Plan &amp; billing</strong> (press your photo, top right). For plans and billing, see <Link href="/help/account" className="font-medium text-primary hover:underline">Your plan, credits, and what you deleted</Link>.</p>
        </HelpSection>

        <HelpContact n={8} />

        <HelpCta icon={Coins} text="Your credits, plan and packs are in one place." label="Open Plan & billing" href="/host/dashboard/billing" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
