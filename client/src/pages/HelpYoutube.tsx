import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Youtube, ArrowLeft } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * Sending your slot to your own YouTube — the whole walkthrough.
 *
 * The email that points here says three sentences; the pictures live here,
 * because three warning screenshots in an inbox read like a warning. This
 * page is also where the help widget and the green-room co-host send people.
 */
export default function HelpYoutube() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Going out live"
        title="Your slot on your own YouTube, too"
        lead={<>Your slot airs on The Podcast Marathon either way. Connect your channel once and it goes out there as well — live, to your audience, at the same time. No stream key to find. Five minutes, start to finish.</>}
        toc={[["#connect", "Connect your channel"], ["#verified", "Get past Google's warning"], ["#choose", "Choose what goes to your channel"], ["#before", "Before the day"]]}
      >
        {/* Thirty seconds of the real thing, before the words. Served through
            the media door so the file lives with the rest of the library. */}
        <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-sm" data-testid="help-youtube-video">
          <video controls playsInline preload="metadata" poster="/help-youtube-poster.jpg?v=2" src="/api/studio/media/18" className="aspect-video w-full">
            Your browser can't play this video. The steps below cover the same ground.
          </video>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">45 seconds: the whole connection, start to finish.</p>

        <Section n={1} id="connect" title="Connect your channel">
          <p>
            Sign in to your dashboard, open <strong>Integrations</strong>, and press <strong>Connect YouTube</strong>. Use
            the Google account that owns your channel.
          </p>
          <Shot src="/email/connect-youtube.png" alt="The Going out live card on the Integrations page, with the Connect YouTube button" />
          <div className="mt-4">
            <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
              <Link href="/host/dashboard/integrations">Open Integrations <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </Section>

        <Section n={2} id="verified" title="Get past Google's warning">
          <p>
            Google shows <strong>"Google hasn't verified this app"</strong>. That's us — our verification with Google is in
            review and hasn't come back yet. The permission only lets us open a live broadcast on your channel at your booked
            time; we can't post, edit or read anything else. Three presses get you through it.
          </p>
          <Step k="a" text={<>Press <strong>Advanced</strong>.</>} src="/email/google-1.png" alt="Google's warning screen: press Advanced" />
          <Step
            k="b"
            text={<>Press <strong>Go to Military Voice (unsafe)</strong>. It isn't — that word is Google's default wording until the review is done.</>}
            src="/email/google-2.png"
            alt="Press Go to Military Voice"
          />
          <Step k="c" text={<>Press <strong>Continue</strong>.</>} src="/email/google-3.png" alt="Press Continue on the permission screen" />
        </Section>

        <Section n={3} id="choose" title="Choose what goes to your channel">
          <p>
            Straight after connecting, the card asks one question: <strong>just my segment</strong>, or{" "}
            <strong>the entire show</strong>.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Just my segment</strong> — when your slot comes up, the producer opens a broadcast on your channel and
              your audience watches you there. Nothing else appears on your channel.
            </li>
            <li>
              <strong>The entire show</strong> — all sixteen hours, first show to last, on your channel too. A broadcast is
              scheduled on your channel for 7:00 AM Eastern on 5 October and starts when we do. YouTube keeps a recording of
              the first twelve hours of a live stream, so the replay on your channel ends around 7 PM even though the stream
              runs to 11.
            </li>
          </ul>
          <p className="mt-3">You can change your answer any time from the same card.</p>
        </Section>

        <Section n={4} id="before" title="Before the day">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Live streaming has to be switched on for your channel.</strong> YouTube asks for a verified phone number
              and takes up to 24 hours the first time you enable it — do it this week, not on the day. In YouTube Studio:
              Create → Go live.
            </li>
            <li>
              <strong>YouTube is the only place we can send to directly.</strong> Facebook, LinkedIn and X don't allow it
              without a third-party tool. Reply to any email from us and we'll set one up with you.
            </li>
            <li>
              <strong>Something not working?</strong> Reply to any email from us, or ask Alex in the green room on the day.
            </li>
          </ul>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-5">
          <Youtube className="h-6 w-6 text-[#FF0000]" />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">Ready? It takes about five minutes.</p>
          <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
            <Link href="/host/dashboard/integrations">Connect my YouTube <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}

function Section({ n, title, children, id }: { n: number; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="mt-12 scroll-mt-6" id={id}>
      <h2 className="flex items-center gap-3 text-xl font-bold" style={HEADLINE_FONT}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{n}</span>
        {title}
      </h2>
      <div className="mt-3 text-base leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

function Shot({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="mt-4 w-full rounded-xl border border-border" loading="lazy" />;
}

function Step({ k, text, src, alt }: { k: string; text: React.ReactNode; src: string; alt: string }) {
  return (
    <div className="mt-5">
      <p>
        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#F0A71F] text-xs font-bold text-[#1a1200]">{k}</span>
        {text}
      </p>
      <Shot src={src} alt={alt} />
    </div>
  );
}
