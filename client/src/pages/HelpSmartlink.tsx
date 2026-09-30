import { useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Globe } from "lucide-react";
import { INTRO_VOICES } from "@shared/bio";

/**
 * SmartLink: the Hero top's sliders and the talking intro. The labels are
 * BioBuilder.tsx's; the voices come from shared/bio.ts, so a new voice shows
 * here on its own.
 */
export default function HelpSmartlink() {
  useEffect(() => {
    document.title = "Your SmartLink — MilitaryVoices.ai help";
  }, []);
  const marines = INTRO_VOICES.filter((v) => ["Brock", "Sarge", "Jerry"].includes(v.id));

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · SmartLink"
        title="Your SmartLink: the top of your page and your talking intro"
        lead={<>Your SmartLink is your page at militaryvoices.ai/you: your podcast, your links, and a way for listeners to reach you. It's free. Press <strong>SmartLink</strong> in the menu to edit it; the phone beside the editor shows your changes as you make them.</>}
        toc={[["#hero", "The Hero top"], ["#intro", "Your talking intro"], ["#voices", "Picking a voice"], ["#fans", "Email your fans"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="hero" title="The Hero top">
          <p>Hero puts your photo right across the top of your page, with your name over it.</p>
          <HelpStep k="a">Open the <strong>Design</strong> tab. Under <strong>Layout</strong>, in <strong>Top of the page</strong>, pick <strong>Hero</strong>.</HelpStep>
          <HelpStep k="b">With a photo on your page, four sliders appear under it:</HelpStep>
          <ul className="mt-3 list-disc space-y-2 pl-12">
            <li><strong>Name size</strong>: smaller or bigger.</li>
            <li><strong>Name position</strong>: moves your name, and what's under it, up or down the photo.</li>
            <li><strong>Photo position</strong>: moves the photo up or down, if it cuts off a head.</li>
            <li><strong>Photo size</strong>: zooms in. The photo always fills the top.</li>
          </ul>
          <HelpStep k="c">Not happy? Press <strong>Reset</strong> to put them all back.</HelpStep>
          <HelpNote>Your photo or logo already says your name? Turn off <strong>Show my name</strong>.</HelpNote>
        </HelpSection>

        <HelpSection n={2} id="intro" title="Your talking intro">
          <p>Your profile photo, saying hello to everyone who opens your page. It sits in a bubble; visitors tap it to hear you. Up to 45 seconds.</p>
          <HelpStep k="a">Open the <strong>Profile</strong> tab and add a clear profile photo of your face, looking at the camera.</HelpStep>
          <HelpStep k="b">Find <strong>Your talking intro</strong>. Choose <strong>In my voice</strong> and press <strong>Record my hello</strong>, or <strong>Type it, pick a voice</strong>.</HelpStep>
          <HelpStep k="c">Press <strong>Make my talking intro</strong>. It takes a few minutes; keep working, even on another tab.</HelpStep>
          <HelpStep k="d">When it's ready, it's on your page. Use the switch to turn it off or on, tap a spot on the little phone under <strong>Where it goes</strong> to move it, and pick <strong>What the bubble says</strong>.</HelpStep>
          <p className="mt-3">Want a different one? Press <strong>Make a new one</strong>.</p>
        </HelpSection>

        <HelpSection n={3} id="voices" title="Picking a voice">
          <p>With <strong>Type it, pick a voice</strong>, type what you'd like to say, choose <strong>Man's voice</strong> or <strong>Woman's voice</strong>, then pick one from the list. Press <strong>Hear it</strong> for a sample first.</p>
          <HelpSub>Marine voices</HelpSub>
          <p className="mt-2">Three voices were picked for this community:</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {marines.map((v) => <li key={v.id}><strong>{v.id}</strong>: {v.note}.</li>)}
          </ul>
          <p className="mt-3">They're under Man's voice, with the others.</p>
        </HelpSection>

        <HelpSection n={4} id="fans" title="Email your fans">
          <p>Everyone who signs up with the <strong>Stay in touch</strong> block on your SmartLink is on your list, and you can write to them.</p>
          <HelpStep k="a">In the menu, under <strong>Audience</strong>, press <strong>Email your fans</strong>. It shows how many fans have signed up.</HelpStep>
          <HelpStep k="b">Press <strong>New email</strong>. Start from a personal note, an announcement or a newsletter, or press <strong>Or have SI write it</strong> and say what it's about.</HelpStep>
          <HelpStep k="c">Add blocks (text, heading, picture, button, callout, divider) and watch the email on the right, on a phone or a computer. Press <strong>Send me a test</strong> to see it in your own inbox.</HelpStep>
          <HelpStep k="d">Press <strong>Review &amp; send</strong>, then <strong>Send now</strong> or <strong>Schedule</strong>.</HelpStep>
          <HelpNote>It comes from <strong>Your show via MilitaryVoices.ai</strong>, and replies come to you. Your SmartLink's cover picture sits at the top. You can send one email a day, and every fan can unsubscribe from your emails in one click. People who only asked for a reminder of your show aren't on this list.</HelpNote>
        </HelpSection>

        <HelpContact n={5} />

        <HelpCta icon={Globe} text="Edit your page and see it change on the phone beside it." label="Open my SmartLink" href="/host/dashboard/page" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
