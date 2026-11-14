import { useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Radio } from "lucide-react";

/**
 * Your MilitaryVoices Radio booth. The labels and messages are the real ones
 * in Booth.tsx; the pictures are of the booth itself (the demo booking), with
 * the page's clock moved to show each state of the top bar.
 */
function Shot({ src, alt, caption, narrow }: { src: string; alt: string; caption?: string; narrow?: boolean }) {
  return (
    <figure className="my-4">
      <img src={src} alt={alt} loading="lazy" className={`rounded-xl border border-border ${narrow ? "w-full max-w-[280px]" : "w-full"}`} />
      {caption && <figcaption className="mt-2 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

/** One state of the top bar: the picture, and what it means. */
function Bar({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <img src={`/help/booth/bar-${n}.png`} alt={title} loading="lazy" className="w-full rounded-lg border border-border" />
      <p className="mt-2 text-[15px]">{children}</p>
    </div>
  );
}

export default function HelpBooth() {
  useEffect(() => {
    document.title = "Your Radio booth — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · MilitaryVoices Radio"
        title="Your Radio booth: how to go on air"
        lead={<>Your booth is your small studio on MilitaryVoices Radio. Check your sound, watch the countdown, and talk. The station brings you on and off, so there is nothing to press to go live. It's radio, so your voice is what matters. Your camera is optional.</>}
        toc={[["#find", "Find your booth"], ["#check", "Check your sound"], ["#inside", "Inside your booth"], ["#bar", "What the top bar says"], ["#guest", "Bring a guest"], ["#tips", "Tips"], ["#trouble", "If something goes wrong"]]}
      >
        <HelpSection n={1} id="find" title="Find your booth">
          <p>Your booth opens <strong>an hour before your time</strong>. Before then, it tells you when it opens.</p>
          <HelpStep k="a">Open your reminder email and press <strong>Enter your booth</strong>. Or sign in to your dashboard with the email you booked with.</HelpStep>
          <HelpStep k="b">In the menu on the left, press <strong>Booth</strong>.</HelpStep>
          <Shot narrow src="/help/booth/menu.png" alt="The dashboard menu on the left, with Booth outlined" caption="Booth is in the menu on the left, under Events." />
          <p>Your time is also on your dashboard, under <strong>Coming up</strong>, with buttons to add it to your calendar.</p>
          <Shot src="/help/booth/coming-up.png" alt="The Coming up section of the dashboard with a MilitaryVoices Radio time" />
        </HelpSection>

        <HelpSection n={2} id="check" title="Check your sound">
          <p>Be here <strong>10 minutes before</strong> your time. The first screen is your check-in.</p>
          <Shot src="/help/booth/check-in.jpg" alt="The booth check-in: show name and time, camera preview, Microphone and Camera buttons, your name, and Enter my booth" />
          <HelpStep k="a">Press <strong>Microphone</strong> and pick the one you'll use. Headphones with a mic are best.</HelpStep>
          <HelpStep k="b">Your camera is optional. Leave it on or turn it off.</HelpStep>
          <HelpStep k="c">Check <strong>Your name</strong>, then press <strong>Enter my booth</strong>.</HelpStep>
          <HelpNote>No sound? Your browser needs your OK. Press the lock or camera icon in the address bar, allow the microphone for this site, then reload the page.</HelpNote>
        </HelpSection>

        <HelpSection n={3} id="inside" title="Inside your booth">
          <Shot src="/help/booth/inside.jpg" alt="Inside the booth: the status bar across the top, your show name, your tile, and the Microphone, Camera and Leave buttons at the bottom" />
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>The bar across the top</strong> is your clock. It counts down, then turns red when you're on air.</li>
            <li><strong>Your show name</strong> is under it. You see and hear only your own booth, never the next show warming up.</li>
            <li><strong>Microphone and Camera</strong> at the bottom turn them on or off.</li>
            <li><strong>Leave</strong> (the red button at the bottom) takes you out of the booth. You don't press it to go on air.</li>
          </ul>
        </HelpSection>

        <HelpSection n={4} id="bar" title="What the top bar says">
          <p>You don't have to do anything. The station runs on the clock, and the bar tells you where you are. In a 30-minute slot, the station's intro plays for the first 3 minutes, you're live for the next 24, and a short thank-you plays for the last 3. A 60-minute slot works the same way, with 54 minutes live. The pictures below are a 9:30 to 10:00 PM slot.</p>
          <Bar n={1} title="Countdown before your time">
            <strong>Before your time.</strong> It counts down to when you're live, and tells you when the station's intro starts and when you go live.
          </Bar>
          <Bar n={2} title="Intro playing, gold bar">
            <strong>Your time starts.</strong> A 3-minute countdown runs while the station plays a short intro on its own. The bar is gold. Get ready, you're next.
          </Bar>
          <Bar n={3} title="On air, red bar">
            <strong>You're live.</strong> The bar turns red and says <strong>ON AIR</strong>, with your time left and when you're live until. Just talk.
          </Bar>
          <Bar n={4} title="Five minutes left">
            <strong>Five minutes left.</strong> Time to head toward your close.
          </Bar>
          <Bar n={5} title="Two minutes left">
            <strong>Two minutes left.</strong> Start wrapping up.
          </Bar>
          <Bar n={6} title="Say goodbye now">
            <strong>The last 30 seconds.</strong> The bar turns white. Say your goodbye now. The station's outro is about to play.
          </Bar>
          <Bar n={7} title="Outro playing, blue bar">
            <strong>You're off air.</strong> The station plays a short thank-you. Stay as long as you like, or leave.
          </Bar>
          <Bar n={8} title="That's a wrap">
            <strong>All done.</strong> You can close the tab. Thank you!
          </Bar>
          <HelpNote>The station takes you off on the clock, so plan to finish before your time is up.</HelpNote>
        </HelpSection>

        <HelpSection n={5} id="guest" title="Bring a guest">
          <p>A guest joins with a link, with no account. In your booth, press <strong>Copy guest link</strong>, next to your show name. You'll find the same button before your booth opens.</p>
          <HelpStep k="a">Send the link to your guest by text or email.</HelpStep>
          <HelpStep k="b">They open it, check their sound, and press <strong>Enter my booth</strong>.</HelpStep>
          <p className="mt-3">Ask them to be there 10 minutes early too.</p>
        </HelpSection>

        <HelpSection n={6} id="tips" title="Tips">
          <ul className="list-disc space-y-2 pl-5">
            <li>Use headphones with a mic. They stop echo and make you sound closer.</li>
            <li>A wired connection or strong Wi-Fi is best. Close other apps that use your microphone.</li>
            <li>Pick a quiet room and silence your phone.</li>
            <li>Use an up-to-date Chrome or Safari.</li>
          </ul>
        </HelpSection>

        <HelpSection n={7} id="trouble" title="If something goes wrong">
          <HelpSub>The booth says it isn't open yet</HelpSub>
          <p className="mt-2">It opens an hour before your time. The page tells you the exact time. Come back then.</p>
          <HelpSub>You got disconnected</HelpSub>
          <p className="mt-2">You'll see <strong>You've left the booth</strong>. Press <strong>Go back in</strong>. It's there until 10 minutes after your time ends.</p>
          <HelpSub>It says to sign in</HelpSub>
          <p className="mt-2">Sign in with the same email you booked with. A guest uses the guest link they were sent instead.</p>
        </HelpSection>

        <HelpContact n={8} />

        <HelpCta icon={Radio} text="Your booth and your times are on your dashboard." label="Open my dashboard" href="/host/dashboard" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
