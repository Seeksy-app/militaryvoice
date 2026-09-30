import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Podcast } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const CONTACT = "hello@militaryvoices.ai";

/**
 * Hosting a podcast here, for the apps: how the feed reaches Apple and
 * Spotify, what they need first, listing, unlisting, and moving hosts with a
 * 301. The labels are the real ones on the Podcast screen (PodcastHosting.tsx).
 */
export default function HelpPodcast() {
  useEffect(() => {
    document.title = "Your podcast in Apple and Spotify — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Your podcast"
        title="Your podcast in Apple Podcasts, Spotify and every app"
        lead={<>When you host your show here, MilitaryVoices.ai keeps its <strong>feed</strong>: one web address, listed in your Podcast screen, that every app reads. You give it to Apple and Spotify once. After that, each new episode you publish reaches them on its own, usually within the hour.</>}
        toc={[["#how", "How it reaches the apps"], ["#ready", "Before the apps will take it"], ["#list", "Listing your show"], ["#youtube", "Your episodes on YouTube"], ["#unlist", "Taking it down"], ["#move", "Moving hosts (the 301)"], ["#support", "Help and contact"]]}
      >
        <Section n={1} id="how" title="How it reaches the apps">
          <p>Podcast apps don't take uploads. They read your show's <strong>RSS feed</strong>, a list of your episodes that we publish at an address like <code className="rounded bg-muted px-1.5 py-0.5 text-sm">militaryvoices.ai/feed/your-show</code>. You'll find yours at the top of your Podcast screen; press it to copy it.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Apple Podcasts</strong> and <strong>Spotify</strong> each need you to submit the feed once, in their own sites (steps below).</li>
            <li>Most other apps (Overcast, Pocket Casts, Castro, Podcast Addict and more) find your show through Apple's directory by themselves.</li>
            <li>From then on, publish on MilitaryVoices and every app picks the episode up. Nothing to send again.</li>
            <li>Every play is counted here as a download, once per listener a day with bots left out: the way sponsors count.</li>
          </ul>
        </Section>

        <Section n={2} id="ready" title="Before the apps will take it">
          <p>Apple and Spotify turn a feed away if it's missing any of these. The yellow box on your Podcast screen lists what's left; tap an item and it takes you to where you add it.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>A show name</strong> and <strong>a description</strong> of a sentence or two: what it's about, who it's for, who hosts it. <em>Show details → Description</em>.</li>
            <li><strong>Cover art</strong>: a square JPG or PNG, 1400 to 3000 pixels on a side. Press the cover art square to add it.</li>
            <li><strong>An owner email</strong>, confirmed with the 6-digit code we send it. Apple and Spotify send their own confirmation there.</li>
            <li><strong>A category</strong>, in Show details.</li>
            <li><strong>One published episode</strong>. <em>New episode</em> → upload the audio (or pick a clean episode from your Library) → Publish.</li>
          </ul>
        </Section>

        <Section n={3} id="list" title="Listing your show">
          <p className="font-semibold text-foreground">Apple Podcasts</p>
          <Step k="a" text={<>On your Podcast screen, open your show's <em>Directories</em> tab. When the list at the top is done, press <strong>List it</strong> beside Apple Podcasts: your feed is copied and Apple's page opens. Sign in with your Apple ID.</>} />
          <Step k="b" text={<>Choose to add a new show with an <strong>RSS feed</strong>, and paste your feed address.</>} />
          <Step k="c" text={<>Check the details and submit. Apple reviews it, usually within a few days, and emails the owner email.</>} />
          <Step k="d" text={<>Once it's live, paste your show's Apple link under Apple Podcasts in <em>Directories</em> and press <strong>It's live</strong>, so your page and SmartLink link to it.</>} />

          <p className="mt-6 font-semibold text-foreground">Spotify</p>
          <Step k="a" text={<>Press <strong>List it</strong> beside Spotify in <em>Directories</em> (or go to creators.spotify.com) and sign in.</>} />
          <Step k="b" text={<>Choose to add a podcast you already host somewhere else, and paste your feed address.</>} />
          <Step k="c" text={<>Spotify emails a code to your owner email. Enter it, check the details, and submit. It's usually live within hours.</>} />
          <Step k="d" text={<>Paste the Spotify link under Spotify in <em>Directories</em> and press <strong>It's live</strong>. YouTube Music, Amazon Music, iHeartRadio, Pocket Casts and Podcast Index are listed there the same way.</>} />
        </Section>

        <Section n={4} id="youtube" title="Your episodes on YouTube">
          <p>An episode made from a video (an MP4 you upload, or a Library recording) can go to your YouTube channel too, with its title, notes and picture. Connect your channel once on the <strong>Social</strong> screen.</p>
          <p className="mt-5 font-semibold text-foreground">Choose once, for each show</p>
          <Step k="a" text={<>Open your show on the Podcast screen. Find <strong>Your episodes as videos on YouTube</strong>.</>} />
          <Step k="b" text={<>Under <strong>When I publish an episode with video</strong>, pick <strong>Ask me each time</strong> or <strong>Always post it to YouTube</strong>.</>} />
          <Step k="c" text={<>Pick <strong>Public</strong> or <strong>Unlisted</strong> (only people with the link can see it). We remember both.</>} />

          <p className="mt-6 font-semibold text-foreground">When you publish</p>
          <p className="mt-2">The publish window has an <strong>Also post it to YouTube</strong> box, ticked for you on Always. Leave it ticked to post it, or untick it. An episode set for later goes to YouTube when it goes out.</p>

          <p className="mt-6 font-semibold text-foreground">The YouTube list</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>Each video episode says where it stands: on YouTube, going when it's out, not on YouTube, or why it didn't post.</li>
            <li><strong>Post now</strong> sends one that isn't there yet.</li>
            <li><strong>Not this one</strong> keeps an episode off YouTube, even on Always. <strong>Undo</strong> brings it back.</li>
          </ul>

          <p className="mt-6 font-semibold text-foreground">Never the same video twice</p>
          <p className="mt-2">Your Library and your podcast know about each other. If you already posted a recording to YouTube from your Library, publishing it as a podcast episode won't post it again, and the publish window tells you when it went. It works the other way too. Want it there twice on purpose? <strong>Post again</strong> asks you first.</p>
        </Section>

        <Section n={5} id="unlist" title="Taking it down">
          <p>The apps keep a show listed for as long as they can read its feed, so take it down in the apps first, then here.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Apple Podcasts:</strong> in Podcasts Connect, open your show and remove it from Apple Podcasts. It disappears within about a day.</li>
            <li><strong>Spotify:</strong> in Spotify for Creators, open your show's settings and remove it from Spotify, or ask Spotify's support to.</li>
            <li><strong>Here:</strong> on your Podcast screen, <em>Delete this show</em>. Its feed stops, so any app still reading it drops the show.</li>
          </ul>
          <p className="mt-3">Just want one episode gone? Open it on your Podcast screen and press <strong>Delete</strong>. It leaves your feed, and the apps drop it the next time they check. Deleting it here doesn't take it off YouTube; remove it in YouTube Studio if you posted it there.</p>
          <p className="mt-3">Deleted the wrong one? An episode, or a whole show with its episodes, waits in <strong>Recently deleted</strong> in your account menu for 15 days. <strong>Put it back</strong> and it returns as the same episode, in your feed again. See <Link href="/help/account#deleted" className="font-medium text-primary hover:underline">Recently deleted</Link>.</p>
        </Section>

        <Section n={6} id="move" title="Moving hosts (the 301)">
          <p>Your listeners follow your feed's address. When a show moves, the old address has to <strong>forward</strong> to the new one with a <strong>301 redirect</strong>, so every app moves over by itself and nobody has to subscribe again.</p>

          <p className="mt-5 font-semibold text-foreground">Moving your show here</p>
          <Step k="a" text={<>On your Podcast screen, paste your current feed address to import the show. Every episode comes over with its own ID, so no app plays one twice.</>} />
          <Step k="b" text={<>At your old host, find <strong>Redirect feed</strong> (sometimes <strong>Move to a new host</strong>), paste your new MilitaryVoices feed address and save.</>} />
          <Step k="c" text={<>Back here, press <strong>Check the redirect</strong>. When it says forwarding works, you're done: Apple and Spotify move over as each checks in, usually within a few days. Keep your old host's account until they have.</>} />

          <p className="mt-6 font-semibold text-foreground">Moving your show away</p>
          <Step k="a" text={<>Set up the show at your new host first.</>} />
          <Step k="b" text={<>Here, open <em>Show details</em> and paste the new host's feed into <strong>Moving to another host?</strong>. Your feed then sends every app a 301 to the new address, and tells Apple the new one too.</>} />
          <Step k="c" text={<>Leave it in place for at least four weeks before deleting the show here, so every app has time to follow.</>} />
        </Section>

        <Section n={7} id="support" title="Help and contact">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Email us:</strong>{" "}<a href={`mailto:${CONTACT}`} className="font-medium text-primary hover:underline">{CONTACT}</a>. A person reads every message and writes back.</li>
            <li><strong>Search the help, or ask Alex:</strong>{" "}<Link href="/help" className="font-medium text-primary hover:underline">militaryvoices.ai/help</Link>.</li>
          </ul>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-[#F0A71F]"><Podcast className="h-5 w-5" /></span>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">Your feed, your episodes and your downloads are on your Podcast screen.</p>
          <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
            <Link href="/host/dashboard/podcast">Open my Podcast screen <ArrowRight className="h-4 w-4" /></Link>
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

function Step({ k, text }: { k: string; text: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-xs font-bold text-[#1a1200]">{k}</span>
      <span className="min-w-0 flex-1">{text}</span>
    </p>
  );
}
