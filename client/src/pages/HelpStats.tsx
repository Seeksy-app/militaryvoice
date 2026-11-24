import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { BarChart3 } from "lucide-react";

/**
 * Bring your numbers in from elsewhere (Andrew, 24 Nov 2026). Only what the
 * app does today: the Spotify for Creators CSV upload and the Buzzsprout key,
 * both in PodcastStats.tsx. Labels are that file's and IntegrationsScreen's.
 */
export default function HelpStats() {
  useEffect(() => {
    document.title = "Bring your podcast stats in — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Podcast stats"
        title="Bring your podcast stats in"
        lead={<>Put your Spotify plays and your Buzzsprout history beside the downloads we count, so you see your whole show in one place. Only you see your numbers.</>}
        toc={[["#plays", "Spotify: plays, not downloads"], ["#export", "Export from Spotify"], ["#upload", "Upload the files"], ["#buzzsprout", "Buzzsprout"], ["#other", "Other hosts"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="plays" title="Spotify: plays, not downloads">
          <p>Looking for a downloads number in Spotify for Creators? There isn't one. Spotify shows <strong>plays</strong>.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Spotify keeps its own copy of each episode and plays it from there, so its plays never reach your podcast host, us included.</li>
            <li>That's why your Spotify numbers come in as an upload: Spotify doesn't share them with anyone.</li>
            <li>Our <strong>Downloads</strong> count every other app: Apple Podcasts, Overcast, Pocket Casts and the rest.</li>
          </ul>
        </HelpSection>

        <HelpSection n={2} id="export" title="Export your numbers from Spotify">
          <HelpStep k="a">Sign in at <a href="https://creators.spotify.com" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">creators.spotify.com</a>, open your show and choose <strong>Analytics</strong>.</HelpStep>
          <HelpStep k="b">On <strong>Plays</strong>, press <strong>Export</strong>.</HelpStep>
          <HelpStep k="c">Do the same on <strong>Episodes</strong>, and on <strong>Audience</strong> (age, gender, location).</HelpStep>
          <HelpStep k="d">Each one saves a CSV file to your computer, usually in Downloads. Leave them as they are: no need to open them.</HelpStep>
        </HelpSection>

        <HelpSection n={3} id="upload" title="Upload the files">
          <p><strong>Your show is hosted with us:</strong></p>
          <HelpStep k="a">In your menu, under <strong>Podcast</strong>, press <strong>Analytics</strong>.</HelpStep>
          <HelpStep k="b">Choose the <strong>Spotify</strong> tab and press <strong>Upload CSVs</strong>.</HelpStep>
          <HelpStep k="c">Pick all the files at once. We tell you which ones we read.</HelpStep>
          <p className="mt-5"><strong>Your show is hosted somewhere else:</strong></p>
          <HelpStep k="a">Open your account menu and press <strong>Integrations</strong>.</HelpStep>
          <HelpStep k="b">Under <strong>Podcast stats</strong>, on Spotify, press <strong>Upload CSVs</strong> and pick all the files at once.</HelpStep>
          <HelpStep k="c">Press <strong>See your numbers in Podcast analytics</strong>.</HelpStep>
          <HelpNote>Spotify's numbers don't update on their own. Export and upload again about once a month: we let you know when it's time, and the button says <strong>Update</strong>.</HelpNote>
        </HelpSection>

        <HelpSection n={4} id="buzzsprout" title="Buzzsprout">
          <p>Buzzsprout connects with a key, and its numbers then update on their own.</p>
          <HelpStep k="a">In Buzzsprout, open <strong>Profile → API</strong> and copy your API token.</HelpStep>
          <HelpStep k="b">Here, open your account menu, press <strong>Integrations</strong>, and under <strong>Podcast stats</strong> press <strong>Connect</strong> on Buzzsprout.</HelpStep>
          <HelpStep k="c">Paste the token. With more than one show in Buzzsprout, add the podcast's ID too: the number in its Buzzsprout address.</HelpStep>
          <p className="mt-3">We read your download numbers only, and keep the token encrypted.</p>
          <HelpNote>Moved your show here from Buzzsprout? <strong>Analytics</strong> asks you to <strong>Bring in your Buzzsprout history</strong>. Press <strong>Add Buzzsprout</strong> and paste the same token, and every episode's plays from before the move join your numbers. Bringing in Buzzsprout's apps, devices and locations is coming soon.</HelpNote>
        </HelpSection>

        <HelpSection n={5} id="other" title="Other hosts">
          <p>Hosted with someone other than Buzzsprout? Connecting more hosts is coming. Once your show moves here, we count every download ourselves from the first day. See <Link href="/help/podcast#move" className="font-medium text-primary hover:underline">moving your podcast here</Link>.</p>
        </HelpSection>

        <HelpContact n={6} />

        <HelpCta icon={BarChart3} text="Your downloads, plays and listens are in Analytics, under Podcast." label="Open my Analytics" href="/host/dashboard/podcast-analytics" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
