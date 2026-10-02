import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Wand2 } from "lucide-react";

/**
 * Pōstify: editing an episode, and working with its clips. The labels are
 * the real ones in PostStudio.tsx (the editor, the music window, the clip
 * menu), TrimStrip.tsx (the timeline) and PostDialog.tsx (posting).
 */
export default function HelpPostify() {
  useEffect(() => {
    document.title = "Edit episodes and clips in Pōstify — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Pōstify"
        title="Edit your episode and clips in Pōstify"
        lead={<>Pōstify makes short clips from your video and a clean episode with the ums and dead air taken out. You can also edit the episode yourself: trim the ends, take out a section, add music, an intro and an outro. Your original is never changed.</>}
        toc={[["#open", "Open an episode"], ["#trim", "Trim the start and end"], ["#split", "Take out a section"], ["#edits", "Your edits and drafts"], ["#save", "Save to Library"], ["#music", "Music for the episode"], ["#intro", "Intro and outro"], ["#clips", "Your clips"], ["#post", "Posting"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="open" title="Open an episode">
          <HelpStep k="a">Press <strong>Pōstify</strong> in the menu. Under <strong>Pick an episode</strong>, choose one.</HelpStep>
          <HelpStep k="b">Not clipped yet? Press the wand, <strong>Start Pōstify</strong>, for clips and a clean episode. Once it's done, the pencil on the card goes straight to <strong>Edit episode</strong>.</HelpStep>
          <HelpStep k="c">At the top, choose <strong>Edit episode</strong> or <strong>Make a clip</strong>. With a clean episode, pick <strong>Clean</strong> or <strong>Original</strong> to work from.</HelpStep>
          <p className="mt-3">You can also start from your Library: press <strong>⋯</strong> on an episode, then <strong>Pōstify it</strong> or <strong>Clips in Pōstify</strong>.</p>
        </HelpSection>

        <HelpSection n={2} id="trim" title="Trim the start and end">
          <p>Trim only cuts the beginning and the end: the chat before you start, and after you sign off.</p>
          <HelpStep k="a">Press <strong>Trim start &amp; end</strong> (the bracket icon) under the player.</HelpStep>
          <HelpStep k="b">Yellow handles appear at each end of the timeline. Drag the left one to where the show should begin, and the right one to where it should end. The player shows that frame as you drag.</HelpStep>
          <HelpStep k="c">Press <strong>Done</strong>.</HelpStep>
          <HelpNote>For a precise cut, zoom in on the timeline. Click a handle and the arrow keys move it a second at a time (five with Shift).</HelpNote>
        </HelpSection>

        <HelpSection n={3} id="split" title="Take out a section">
          <p>Split takes out a part in the middle: a false start, a phone call, a tech check.</p>
          <HelpStep k="a">Move the blue playhead to where the part starts. Press <strong>Split</strong> (the scissors), or the Split that pops up beside the playhead. The S key works too.</HelpStep>
          <HelpStep k="b">Move the playhead to where the part ends, and Split again.</HelpStep>
          <HelpStep k="c">It says <strong>Now click the piece to take out</strong>. Click the piece between your two splits. It's outlined, with a red <strong>Delete</strong> on it.</HelpStep>
          <HelpStep k="d">Press <strong>Delete</strong>, or the yellow <strong>Take out … · Done</strong> button. Either one takes it out.</HelpStep>
          <p className="mt-3">The <strong>Length</strong> beside the buttons shows how long the episode will be.</p>
          <HelpSub>Let SI find them</HelpSub>
          <p className="mt-2">Press the sparkle, <strong>Suggest edits</strong>. SI listens to the episode and marks tech checks, restarts and interruptions. You decide: <strong>Accept</strong>, <strong>Dismiss</strong>, or <strong>Accept all</strong>.</p>
        </HelpSection>

        <HelpSection n={4} id="edits" title="Your edits and drafts">
          <p>Under the timeline, <strong>Your edits</strong> lists what you've done in plain words, like "16 sec trimmed from the beginning" or "11 sec taken out at 12:40", with the length before and after.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Click an edit to play from there.</li>
            <li>Press its <strong>✕</strong> to undo just that one. <strong>Undo all</strong> starts over.</li>
            <li>Your work saves as you go. You'll see <strong>Draft saved</strong>.</li>
            <li><strong>Save &amp; close</strong> keeps your edits and takes you to your Library. Open the episode again to carry on where you left off. Nothing is made yet.</li>
          </ul>
        </HelpSection>

        <HelpSection n={5} id="save" title="Save to Library">
          <HelpStep k="a">When your edits are done, press <strong>Save to Library</strong>.</HelpStep>
          <HelpStep k="b">It takes a few minutes. You can close the page; it keeps going.</HelpStep>
          <HelpStep k="c">It lands in your Library as a new copy, <strong>Edited</strong>, next to your original. The original isn't touched.</HelpStep>
          <HelpNote>Nothing goes to your podcast yet. When you're happy with it, press <strong>⋯</strong> on it in your Library and choose <strong>Add to my podcast</strong>.</HelpNote>
        </HelpSection>

        <HelpSection n={6} id="music" title="Music for the episode">
          <p>Our own tracks, cleared for podcasts and YouTube.</p>
          <HelpStep k="a">In Edit episode, press <strong>Music</strong> at the bottom.</HelpStep>
          <HelpStep k="b"><strong>Where</strong>: <em>The opening</em> (first 30 seconds), <em>The close</em> (last 30 seconds), <em>The piece I picked</em> (split, then click a piece first), or <em>The whole episode</em> (quietly, all the way through).</HelpStep>
          <HelpStep k="c"><strong>How loud</strong>: <em>Under the voices</em> (soft, while people talk), or <em>Full</em> (for a part with no talking).</HelpStep>
          <HelpStep k="d">Press play to hear a <strong>Track</strong>, pick one, then press <strong>Add</strong>.</HelpStep>
          <p className="mt-3">It shows in Your edits, where you can undo it. It's mixed in when you save to your Library. Add more than one if you like: one for the opening, another for the close.</p>
        </HelpSection>

        <HelpSection n={7} id="intro" title="Intro and outro">
          <HelpStep k="a">At the left end of the timeline, press <strong>Intro</strong>. At the right end, <strong>Outro</strong>. Pick a short video (under 500MB).</HelpStep>
          <HelpStep k="b">The round button where it meets the episode sets the join: <strong>Fade</strong>, <strong>Dip to black</strong> or <strong>Cut</strong>.</HelpStep>
          <HelpStep k="c">To take one off, press the <strong>✕</strong> on it.</HelpStep>
          <p className="mt-3">We remember them for your next episode. The player shows the episode only; the intro and outro are in the copy you save.</p>
        </HelpSection>

        <HelpSection n={8} id="clips" title="Your clips">
          <p>Pōstify picks the best moments and makes each clip in vertical, square and wide. To make your own, choose <strong>Make a clip</strong>, press <strong>Start here</strong> and <strong>End here</strong>, name it, pick its shapes, and press <strong>Make clip</strong>.</p>
          <p className="mt-3">Press <strong>⋯</strong> on any clip (in Pōstify or your Library's Clips tab):</p>
          <HelpSub>Trim this clip</HelpSub>
          <p className="mt-2">Play it. Press <strong>Start here</strong> and <strong>End here</strong> at the right moments, or use the sliders. It has to be at least 5 seconds. Press <strong>Play the new version</strong> to check, then <strong>Trim the clip</strong>. Every shape is remade in about a minute.</p>
          <HelpSub>Edit text and captions</HelpSub>
          <p className="mt-2">Change the <strong>Title</strong> (the headline across the top; six words or so reads best) and the <strong>Subtitle</strong> (the smaller gold line). Stuck? Press <strong>Suggest titles</strong> for three ideas from what's said in the clip, and click one to use it.</p>
          <p className="mt-2">Under <strong>Captions</strong>, drag <strong>Size</strong> to make the words bigger or smaller, and pick <strong>Where they sit</strong>: <strong>Top</strong>, <strong>Middle</strong>, <strong>Lower third</strong> (the usual) or <strong>Bottom</strong>, or drag the slider to place them exactly. The preview beside it shows the clip as it will look. Then press <strong>Update clip</strong>; every shape is remade in about a minute.</p>
          <HelpNote>Your clip's music stays when it's remade after a trim, new text or new captions.</HelpNote>
          <p className="mt-3">The same menu has downloads for each shape, <strong>Download subtitles (.srt)</strong>, <strong>Copy the caption</strong> and <strong>Delete this clip</strong>.</p>
        </HelpSection>

        <HelpSection n={9} id="post" title="Posting">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Clips</strong> go anywhere: Instagram, TikTok, Facebook, LinkedIn, YouTube. Press <strong>Post</strong> on a clip, tick the accounts, pick the shape, write what to say, and choose <strong>Next open slot</strong>, <strong>Now</strong> or <strong>Pick a time</strong>.</li>
            <li><strong>A whole episode</strong> goes to YouTube only. Instagram takes videos up to 15 minutes, and short videos do better on the other apps. So for Instagram, TikTok, Facebook and LinkedIn, post the episode's clips: <strong>Choose clips to post →</strong> takes you to them.</li>
            <li>Nothing goes out until you press the button. Everything you've sent or scheduled is on the <strong>Social</strong> calendar.</li>
          </ul>
          <p className="mt-3">Your podcast can post episodes to YouTube too. See <Link href="/help/podcast#youtube" className="font-medium text-primary hover:underline">your episodes on YouTube</Link>.</p>
        </HelpSection>

        <HelpContact n={10} />

        <HelpCta icon={Wand2} text="Pick an episode to edit, or see the clips Pōstify made." label="Open Pōstify" href="/host/dashboard/postify" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
