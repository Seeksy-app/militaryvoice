import { useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarClock, CheckCircle2, Film, FolderOpen, Loader2, MoreHorizontal, Podcast, Scissors, Share2, ShieldCheck, Sparkles, Video, Wand2 } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * Why connect Zoom: the story of a Zoom recording on MilitaryVoices, from the
 * meeting to clips, the podcast and social. The how-to (and the Zoom
 * Marketplace documentation) is /help/zoom; this page sells the idea and
 * points there. The pictures are drawn here, not screenshots, so they never
 * show anyone's real account. Their labels are the real ones: ZoomConnect.tsx,
 * MyRecordings.tsx and PostStudio.tsx's "Edit text and captions".
 */
export default function HelpZoomStory() {
  useEffect(() => {
    document.title = "What Zoom adds to MilitaryVoices — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Zoom"
        title="Your Zoom calls, turned into episodes and clips on their own"
        lead={<>Plenty of shows are already recorded on Zoom. Connect it once, and every cloud recording comes into your MilitaryVoices Library by itself. From there it's a few presses to clips with captions, a clean episode on your podcast, and posts on every app. No downloading, no uploading, no editing software.</>}
        toc={[["#flow", "From meeting to everywhere"], ["#connect", "Connect once"], ["#library", "It lands in your Library"], ["#postify", "Pōstify does the editing"], ["#captions", "Make the captions yours"], ["#share", "Out to your podcast and social"], ["#private", "Your Zoom stays yours"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="flow" title="From meeting to everywhere">
          <p>Here's the whole journey. You do the talking; the rest happens on MilitaryVoices.</p>
          <Figure caption="One recording, and everything it becomes. The only steps you take are the presses in gold.">
            <FlowPicture />
          </Figure>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            <Win icon={CalendarClock} title="Hours back each week" text="No downloading the file, finding it, and uploading it again." />
            <Win icon={Scissors} title="Clips you'd pay an editor for" text="Short vertical clips with captions, from every call." />
            <Win icon={Share2} title="More people hear you" text="The same talk on your podcast, YouTube, Instagram, TikTok, Facebook and LinkedIn." />
          </ul>
        </HelpSection>

        <HelpSection n={2} id="connect" title="Connect once">
          <p>In your dashboard, open <strong>Integrations</strong> and press <strong>Connect Zoom</strong> on the Zoom card. Zoom asks you to approve; press <strong>Allow</strong> and you're back with the card saying <strong>Connected as</strong> and your Zoom email.</p>
          <Figure caption="The Zoom card in Integrations once it's connected.">
            <ZoomCardPicture />
          </Figure>
          <p className="mt-4">That's the only setup. The switch, <strong>Bring each new cloud recording into my Library on its own</strong>, is on from the start. Want every screen step by step? See <Link href="/help/zoom" className="font-medium text-primary hover:underline">bringing your Zoom recordings into your Library</Link>.</p>
          <HelpNote>It works with Zoom <strong>cloud</strong> recordings. In your Zoom meeting, press <strong>Record</strong>, then <strong>Record to the cloud</strong>. Recordings saved on your computer can be uploaded to your Library yourself.</HelpNote>
        </HelpSection>

        <HelpSection n={3} id="library" title="It lands in your Library">
          <p>When Zoom finishes processing a recording (it emails you when it's ready), we copy it into your Library. It says <strong>Importing from Zoom…</strong> for a few minutes, then it's ready to play, and we email you that it's there.</p>
          <Figure caption="A Zoom recording arriving in the Library, and ready a few minutes later.">
            <LibraryPicture />
          </Figure>
          <p className="mt-4">Connected after some calls you already had? Press <strong>Import past recordings</strong> on the Zoom card. You'll see the last 30 days, and <strong>Import</strong> brings in the ones you want.</p>
        </HelpSection>

        <HelpSection n={4} id="postify" title="Pōstify does the editing">
          <p>On the recording in your Library, press <strong>⋯</strong> and choose <strong>Pōstify it</strong>. Pōstify, our SI editor, watches the whole call and gives you:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Short clips</strong> of the best moments, each with a title and word-by-word captions, in vertical for Reels, TikTok and Shorts and wide for YouTube and LinkedIn.</li>
            <li><strong>A clean episode</strong> with the ums and dead air taken out. Your original is never changed.</li>
          </ul>
          <Figure caption="Clips Pōstify cut from one Zoom call: a title band, your show's name and captions that follow the words.">
            <ClipsPicture />
          </Figure>
          <p className="mt-4">You can still trim, cut out a section, or add music, an intro and an outro. See <Link href="/help/postify" className="font-medium text-primary hover:underline">Pōstify: edit and post</Link>.</p>
        </HelpSection>

        <HelpSection n={5} id="captions" title="Make the captions yours">
          <p>Zoom calls often have names, slides or a shared screen at the bottom of the picture. If the captions sit on top of something, move them.</p>
          <Figure caption="Edit text and captions: a bigger size, and the captions moved to the top.">
            <CaptionEditorPicture />
          </Figure>
          <p className="mt-4">On a clip, press <strong>⋯</strong> and choose <strong>Edit text and captions</strong>. Make them bigger or smaller with <strong>Size</strong>, and under <strong>Where they sit</strong> pick <strong>Top</strong>, <strong>Middle</strong>, <strong>Lower third</strong> or <strong>Bottom</strong>, or slide them exactly where you want. <strong>Back to the usual</strong> puts them back.</p>
        </HelpSection>

        <HelpSection n={6} id="share" title="Out to your podcast and social">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Your podcast:</strong> press <strong>⋯</strong> on the episode and choose <strong>Add to my podcast</strong>. It goes to Apple Podcasts, Spotify and the rest through your feed.</li>
            <li><strong>Social:</strong> press <strong>Post</strong> on a clip, tick your accounts (Instagram, TikTok, Facebook, LinkedIn, YouTube), and choose <strong>Now</strong>, <strong>Next open slot</strong> or <strong>Pick a time</strong>. Everything you've scheduled is on the <strong>Social</strong> calendar.</li>
          </ul>
          <p className="mt-3">Nothing goes out until you press the button.</p>
        </HelpSection>

        <HelpSection n={7} id="private" title="Your Zoom stays yours">
          <div className="flex gap-4 rounded-2xl border border-border bg-card p-5">
            <IconTile icon={ShieldCheck} />
            <ul className="min-w-0 flex-1 list-disc space-y-1.5 pl-5 text-sm">
              <li>We only <strong>read</strong> your cloud recordings. We never change, move or delete anything in Zoom.</li>
              <li>We copy the meeting's video, nothing else: no chat, contacts or calendar.</li>
              <li>Press <strong>Disconnect</strong> on the Zoom card any time and the connection is deleted at once.</li>
            </ul>
          </div>
          <p className="mt-3">The full detail is in <Link href="/help/zoom#data" className="font-medium text-primary hover:underline">what we access and store</Link>.</p>
        </HelpSection>

        <HelpContact n={8} />

        <HelpCta icon={Video} text="It takes a minute. Your next Zoom call comes in on its own." label="Connect Zoom" href="/host/dashboard/integrations" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}

/** A picture with its caption, framed like a screenshot. */
function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="mt-5">
      <div className="overflow-hidden rounded-2xl border border-border bg-[#EEF2F8] p-4 sm:p-6 dark:bg-[#0b1626]" aria-hidden="true">{children}</div>
      <figcaption className="mt-2 text-sm text-muted-foreground [text-wrap:pretty]">{caption}</figcaption>
    </figure>
  );
}

function Win({ icon, title, text }: { icon: typeof Video; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-border bg-card p-4">
      <IconTile icon={icon} size="sm" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground [text-wrap:balance]">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
      </div>
    </li>
  );
}

/** Zoom → Library → Pōstify → podcast, social, YouTube, a clean episode. */
function FlowPicture() {
  const step = (icon: typeof Video, title: string, sub: string, press?: string) => (
    <div className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-white p-3 text-center shadow-sm dark:bg-[#12233b]">
      <IconTile icon={icon} />
      <p className="mt-2 text-sm font-bold text-[#053877] dark:text-white">{title}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
      {press && <span className="mt-2 rounded-full bg-[#F0A71F] px-2.5 py-0.5 text-[11px] font-bold text-[#053877]">{press}</span>}
    </div>
  );
  const arrow = <ArrowRight className="hidden h-5 w-5 shrink-0 self-center text-[#053877]/50 sm:block dark:text-white/50" />;
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {step(Video, "Zoom", "You record to the cloud", "Record")}
        {arrow}
        {step(FolderOpen, "Library", "Comes in on its own")}
        {arrow}
        {step(Wand2, "Pōstify", "Clips and a clean episode", "Pōstify it")}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[[Podcast, "Your podcast"], [Share2, "Social apps"], [Film, "YouTube"], [Sparkles, "Clean episode"]].map(([I, t]) => {
          const Icon = I as typeof Video;
          return (
            <div key={t as string} className="flex items-center gap-2 rounded-xl border border-[#053877]/15 bg-white/70 px-3 py-2 text-xs font-semibold text-[#053877] dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} /> {t as string}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The Zoom card in Integrations, connected, with a stand-in email. */
function ZoomCardPicture() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <IconTile icon={Video} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Zoom</p>
          <p className="truncate text-xs text-muted-foreground">Connected as <span className="font-medium text-foreground">host@yourshow.com</span></p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
        <p className="text-xs font-medium text-foreground">Bring each new cloud recording into my Library on its own</p>
        <span className="relative h-5 w-9 shrink-0 rounded-full bg-[#053877]"><span className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white" /></span>
      </div>
      <div className="mt-3 flex gap-2">
        <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground">Import past recordings</span>
        <span className="rounded-full px-3 py-1 text-xs font-semibold text-muted-foreground">Disconnect</span>
      </div>
    </div>
  );
}

/** Two Library rows: one importing, one ready for Pōstify. */
function LibraryPicture() {
  const row = (title: string, meta: string, ready: boolean) => (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#053877] to-[#0a4a99]">
        <div className="grid h-10 w-20 grid-cols-2 gap-0.5 opacity-80">
          <span className="rounded-sm bg-white/25" /><span className="rounded-sm bg-white/15" /><span className="rounded-sm bg-white/15" /><span className="rounded-sm bg-white/25" />
        </div>
        <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 text-[9px] font-bold text-white">ZOOM</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{meta}</p>
        {ready ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00] dark:text-[#F0A71F]"><Wand2 className="h-3 w-3" /> Pōstify it</span>
        ) : (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Importing from Zoom…</span>
        )}
      </div>
      <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-2.5">
      {row("The Ready Room · Oct 2", "Just now · 48 min", false)}
      {row("The Ready Room · Sep 25", "1 week ago · 52 min", true)}
    </div>
  );
}

/** Vertical clips like Pōstify's: navy title band, show name in gold, captions. */
function ClipsPicture() {
  const clip = (title: string, words: [string, string], tone: string, wide = false) => (
    <div className={`relative overflow-hidden rounded-xl bg-[#1d1d1f] shadow-md ${wide ? "aspect-video" : "aspect-[9/16]"}`}>
      <div className="absolute inset-x-0 top-0 bg-[#06204a] px-2 pb-1.5 pt-2 text-center">
        <p className="text-[11px] font-bold leading-tight text-white [text-wrap:balance]">{title}</p>
        <p className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.18em] text-[#F0A71F]">The Ready Room</p>
      </div>
      <div className={`absolute inset-x-0 bottom-0 top-[22%] bg-gradient-to-b ${tone}`}>
        <div className="absolute left-1/2 top-[30%] h-[34%] w-[46%] -translate-x-1/2 rounded-[45%] bg-white/10" />
        <div className="absolute bottom-0 left-1/2 h-[30%] w-[78%] -translate-x-1/2 rounded-t-[50%] bg-white/10" />
      </div>
      <p className="absolute inset-x-0 bottom-[22%] text-center text-[13px] font-black uppercase leading-tight tracking-tight text-white [text-shadow:0_2px_4px_rgba(0,0,0,.8)]">
        {words[0]} <span className="text-[#F0A71F]">{words[1]}</span>
      </p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {clip("Why I almost didn't enlist", ["Best decision", "I made"], "from-[#3a4a5c] to-[#1f2833]")}
      {clip("The call that changed my career", ["Nobody tells", "you this"], "from-[#4b3d33] to-[#231c17]")}
      {clip("What vets need to hear", ["You are not", "alone"], "from-[#2f4a42] to-[#16241f]")}
    </div>
  );
}

/** The caption editor: Size slider and the placement choices, with a preview. */
function CaptionEditorPicture() {
  return (
    <div className="mx-auto grid max-w-xl gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[150px_minmax(0,1fr)]">
      <div className="relative mx-auto aspect-[9/16] w-[150px] overflow-hidden rounded-lg bg-gradient-to-b from-[#3a4a5c] to-[#1f2833]">
        <div className="absolute inset-x-0 top-0 bg-[#06204a] py-1.5 text-center text-[9px] font-bold text-white">Why I almost didn't enlist</div>
        <p className="absolute inset-x-0 top-[24%] text-center text-[15px] font-black uppercase leading-tight text-white [text-shadow:0_2px_4px_rgba(0,0,0,.8)]">Best decision <span className="text-[#F0A71F]">I made</span></p>
        <div className="absolute bottom-0 inset-x-0 h-[22%] bg-black/40 px-2 pt-2 text-[8px] text-white/80">Name · title on the Zoom screen</div>
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">Edit text and captions</p>
        <div className="mt-3 flex items-center justify-between text-xs"><span className="font-medium">Size</span><span className="tabular-nums text-muted-foreground">130%</span></div>
        <div className="relative mt-2 h-1.5 rounded-full bg-muted"><div className="absolute inset-y-0 left-0 w-[58%] rounded-full bg-[#053877]" /><span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-[#053877] bg-white" style={{ left: "calc(58% - 8px)" }} /></div>
        <p className="mt-4 text-xs font-medium">Where they sit</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Top", "Middle", "Lower third", "Bottom"].map((p) => (
            <span key={p} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${p === "Top" ? "border-[#053877] bg-[#053877] text-white" : "border-border text-foreground"}`}>{p}</span>
          ))}
        </div>
        <p className="mt-3 text-xs font-semibold text-[#053877] dark:text-white">Back to the usual</p>
      </div>
    </div>
  );
}
