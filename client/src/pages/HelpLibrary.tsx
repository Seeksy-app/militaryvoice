import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Library } from "lucide-react";

/**
 * The Library: episodes and clips in one place. The labels are the real
 * ones in RecordingsScreen.tsx, MyRecordings.tsx and ClipsLibrary.tsx.
 */
export default function HelpLibrary() {
  useEffect(() => {
    document.title = "Your Library — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Your Library"
        title="Your Library: every episode and every clip"
        lead={<>Everything you record or upload lands in your Library: your room's recordings, your Marathon slot, videos you upload, Zoom calls, and the clean and edited episodes Pōstify makes. Your clips live here too.</>}
        toc={[["#top", "The counts at the top"], ["#tabs", "Episodes and Clips"], ["#versions", "Clean, Edited, Original"], ["#episode", "What you can do with an episode"], ["#clips", "Scheduled or Posted"], ["#delete", "Deleting"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="top" title="The counts at the top">
          <p>Press <strong>Library</strong> in the menu. Across the top you'll see your Library at a glance. The ones with an arrow are buttons:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Episodes →</strong> shows your episodes.</li>
            <li><strong>Clips made →</strong> shows every clip.</li>
            <li><strong>Posts sent →</strong> opens your calendar on the Social screen.</li>
            <li><strong>Hours recorded</strong> and <strong>Time saved</strong> (what Pōstify took out of your clean episodes) are just to know.</li>
          </ul>
          <p className="mt-3">To add a video, drop it on the upload box beside them. Record on Zoom? Connect Zoom and your recordings come in by themselves. See <Link href="/help/zoom" className="font-medium text-primary hover:underline">Zoom recordings</Link>.</p>
        </HelpSection>

        <HelpSection n={2} id="tabs" title="Episodes and Clips">
          <p>Two tabs show the same Library two ways: <strong>Episodes</strong> and <strong>Clips</strong>, each with how many.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Episodes</strong>: each episode as a card. A badge says <strong>Clips ready</strong> or <strong>Clean episode</strong> when Pōstify has made them.</li>
            <li>Under an episode's name, <strong>4 clips →</strong> (or however many) opens the Clips tab with just that episode's clips.</li>
            <li><strong>Clips</strong>: every clip, newest first, with the episode it came from. Use the box at the top to see <strong>All episodes</strong> or one.</li>
          </ul>
        </HelpSection>

        <HelpSection n={3} id="versions" title="Clean, Edited, Original">
          <p>Once Pōstify has worked on an episode, its card has a switch with each version:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Clean</strong>: ums, false starts and dead air taken out.</li>
            <li><strong>Edited</strong>: your latest edit from Pōstify, with your trims, cuts, music, intro and outro. It shows first when there is one.</li>
            <li><strong>Original</strong>: the episode as it was recorded. Nothing ever changes it.</li>
          </ul>
          <p className="mt-3">Made more than one edit? The ones before your latest wait under <strong>Earlier edits</strong>, each by when you made it. Pick one to play it or download it.</p>
        </HelpSection>

        <HelpSection n={4} id="episode" title="What you can do with an episode">
          <p>Press <strong>⋯</strong> on an episode's card. What you do applies to the version showing.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Download</strong> the version you're looking at.</li>
            <li><strong>Pōstify it</strong> makes clips and a clean episode. Once made, it reads <strong>Clips in Pōstify</strong>. See <Link href="/help/postify" className="font-medium text-primary hover:underline">Pōstify help</Link>.</li>
            <li><strong>Rename</strong> it.</li>
            <li><strong>Add to my podcast</strong> makes it an episode of your show. Nothing goes to your podcast until you do this. No show yet? It reads <strong>Start my podcast</strong>.</li>
            <li><strong>Post it</strong> sends the whole episode to YouTube. Other apps get its clips (see below).</li>
            <li><strong>Move to folder</strong>, or make a <strong>New folder…</strong>.</li>
            <li><strong>Delete</strong>, for uploads, Zoom imports and Pōstify's copies.</li>
          </ul>
          <HelpNote>A whole episode goes to YouTube only. For Instagram, TikTok, Facebook and LinkedIn, post its clips: short videos do better there, and Instagram only takes videos up to 15 minutes.</HelpNote>
        </HelpSection>

        <HelpSection n={5} id="clips" title="Scheduled or Posted">
          <p>On the Clips tab, each clip shows where it stands:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li><strong>Scheduled</strong> (navy): waiting in your queue to go out.</li>
            <li><strong>Posted</strong> (green): it's out.</li>
            <li>No badge: ready, not posted yet.</li>
          </ul>
          <p className="mt-3">Each clip card works just like in Pōstify. Press <strong>Post</strong> to send it, or <strong>⋯</strong> to download it, copy its caption, trim it, edit its title, or delete it.</p>
        </HelpSection>

        <HelpSection n={6} id="delete" title="Deleting">
          <HelpStep k="a">Press <strong>⋯</strong>, then <strong>Delete</strong>. It's there for videos you uploaded or brought in from Zoom, and for Pōstify's copies.</HelpStep>
          <HelpStep k="b">Deleting an episode takes its clean copy and its clips with it. They move to <strong>Recently deleted</strong>.</HelpStep>
          <HelpStep k="c">Changed your mind? You have 15 days to put it back. See <Link href="/help/account#deleted" className="font-medium text-primary hover:underline">Recently deleted</Link>.</HelpStep>
          <p className="mt-3">Deleting one version (a clean or edited copy) leaves the original and its clips alone.</p>
        </HelpSection>

        <HelpContact n={7} />

        <HelpCta icon={Library} text="Your episodes, clips and versions are all in your Library." label="Open my Library" href="/host/dashboard/library" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
