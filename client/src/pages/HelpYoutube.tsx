import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Youtube } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * Going live on your own YouTube, too: by stream key since 22 Nov 2026 (Andrew: "Yes, one connection").
 * No Google sign-in, no warning screens: paste the channel's stream key once in Integrations or in the studio's Go live.
 */
export default function HelpYoutube() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Going out live"
        title="Your show on your own YouTube, too"
        lead={<>Your Radio slot and your studio shows air on MilitaryVoices.ai either way. Paste your YouTube stream key once and they go out live on your channel as well, at the same time. Two minutes, start to finish.</>}
        toc={[["#key", "Copy your stream key"], ["#paste", "Paste it once"], ["#title", "The title on YouTube"], ["#before", "Before the day"]]}
      >
        <Section n={1} id="key" title="Copy your stream key">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Open <strong>YouTube Studio</strong> with the account that owns your channel.</li>
            <li>Press <strong>Create</strong>, then <strong>Go live</strong>, then the <strong>Stream</strong> tab.</li>
            <li>Copy the <strong>stream key</strong> (the default one, not a new one).</li>
            <li>Turn on <strong>Auto-start</strong>, so the stream goes live on your channel by itself when we start sending.</li>
          </ol>
          <p className="mt-3">Keep the key to yourself: anyone with it can stream to your channel.</p>
        </Section>

        <Section n={2} id="paste" title="Paste it once">
          <p>
            In your dashboard, open <strong>Integrations</strong>, find <strong>YouTube Live</strong>, paste the key and press{" "}
            <strong>Save key</strong>. You can also paste it in your studio's <strong>Go live</strong> window. It's the same key in
            both places, so you only do this once.
          </p>
          <div className="mt-4">
            <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
              <Link href="/host/dashboard/integrations">Open Integrations <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
          <p className="mt-4">
            After that: in your studio, press <strong>Go live</strong> and pick <strong>YouTube</strong>. On the Radio, your channel
            goes live while your segment is on air and stops when it's over.
          </p>
        </Section>

        <Section n={3} id="title" title="The title on YouTube">
          <p>
            With a stream key, YouTube uses your channel's default title and description for the live video. Set them in YouTube
            Studio under <strong>Go live → Stream → Edit</strong>. You can rename the video afterwards, as with any upload.
          </p>
        </Section>

        <Section n={4} id="before" title="Before the day">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Live streaming has to be switched on for your channel.</strong> YouTube asks for a verified phone number
              and takes up to 24 hours the first time you enable it, so do it ahead of time, not on the day. In YouTube Studio:
              Create → Go live.
            </li>
            <li>
              <strong>Facebook, LinkedIn or another site?</strong> In the studio's Go live, press <strong>Add a key</strong> and
              paste that site's streaming key the same way.
            </li>
            <li>
              <strong>Something not working?</strong> Ask Alex, or reply to any email from us.
            </li>
          </ul>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-5">
          <Youtube className="h-6 w-6 text-[#FF0000]" />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">Ready? It takes about two minutes.</p>
          <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
            <Link href="/host/dashboard/integrations">Add my stream key <ArrowRight className="h-4 w-4" /></Link>
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
