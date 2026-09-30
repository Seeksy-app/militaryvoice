import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Mic2 } from "lucide-react";
import { ADDONS, FREE_DISCOVERY } from "@shared/tokens";

/**
 * Book a guest and Be a guest: the two tabs on each show on the Podcast
 * screen, with Discovery underneath. The labels are DiscoverPodcasts.tsx's.
 */
export default function HelpGuests() {
  useEffect(() => {
    document.title = "Book a guest, or be one — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Guests"
        title="Book a guest, or be one"
        lead={<>Two tabs on your show find people to have on, and shows to go on. They search Discovery for you. Discovery is free, and it's added for you with your first search.</>}
        toc={[["#book", "Book a guest"], ["#email", "Find their email"], ["#pitch", "Be a guest"], ["#saved", "Search and Saved"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="book" title="Book a guest">
          <HelpStep k="a">Press <strong>Podcast</strong> in the menu, open your show, and choose the <strong>Book a guest</strong> tab.</HelpStep>
          <HelpStep k="b">Search by a topic they're known for, or a name. People who've been guests on podcasts come up, the most-booked first.</HelpStep>
          <HelpStep k="c">Open someone. Under <strong>Book them</strong>:</HelpStep>
          <ul className="mt-3 list-disc space-y-2 pl-12">
            <li><strong>Invite to my show</strong> puts them on your Marathon slot's guest list. They get their own link into your green room: nothing to sign up for.</li>
            <li><strong>Find their email</strong> (below).</li>
            <li><strong>Save to Guests</strong> keeps them for later.</li>
          </ul>
        </HelpSection>

        <HelpSection n={2} id="email" title="Find their email">
          <p><strong>Find their email</strong> looks a person up by their X account. Each one uses a contact email from your month:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>{FREE_DISCOVERY.reveals} a month free, or {ADDONS.discovery.reveals} with {ADDONS.discovery.name}.</li>
            <li>Used them all? Each one after that is <strong>1 credit</strong>. Once you've paid for one, it's free to see again.</li>
            <li>No X account on file for them? The button is greyed out.</li>
          </ul>
          <p className="mt-3">See <Link href="/help/account#credits" className="font-medium text-primary hover:underline">credits and {ADDONS.discovery.name}</Link>.</p>
        </HelpSection>

        <HelpSection n={3} id="pitch" title="Be a guest">
          <HelpStep k="a">On your show, choose the <strong>Be a guest</strong> tab.</HelpStep>
          <HelpStep k="b">Search what you'd talk about: leadership, transition, faith. You'll see podcasts that have guests and put out an episode in the last 90 days.</HelpStep>
          <HelpStep k="c">Open one to see its host and how to reach them.</HelpStep>
          <HelpStep k="d">Under <strong>Pitch yourself</strong>, say what you'd talk about (or leave it and we'll suggest), then press <strong>Write my pitch</strong>. SI writes it from your SmartLink and your show.</HelpStep>
          <HelpStep k="e">Read it and change anything. Press <strong>Open in my email</strong> to send it from your own email, or <strong>Copy</strong>. <strong>Write another</strong> gives you a fresh one.</HelpStep>
          <HelpNote>No email for a show? Paste your pitch into their website's contact form, or send it to them on social.</HelpNote>
        </HelpSection>

        <HelpSection n={4} id="saved" title="Search and Saved">
          <p>At the top of both tabs, switch between <strong>Search</strong> and what you've saved: <strong>Saved guests</strong> on Book a guest, <strong>Saved shows</strong> on Be a guest.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Open one to pick up where you left off.</li>
            <li>Press its <strong>✕</strong> to take it off the list.</li>
          </ul>
          <p className="mt-3">Your saved guests are in Discovery too, under Saved.</p>
        </HelpSection>

        <HelpContact n={5} />

        <HelpCta icon={Mic2} text="Book a guest and Be a guest are tabs on your show." label="Open my Podcast screen" href="/host/dashboard/podcast" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
