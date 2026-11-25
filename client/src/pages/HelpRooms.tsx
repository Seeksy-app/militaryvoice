import { useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Video } from "lucide-react";

/**
 * Your studio (/help/studio; /help/rooms redirects here). Called "Rooms" until 21 Nov 2026.
 * The labels are the real ones in the studio itself (MyStudio.tsx, components/room/*) and on
 * the dashboard's Studio screen (StudioHome.tsx); the messages are server/myStudio.ts's.
 */
export default function HelpRooms() {
  useEffect(() => {
    document.title = "Your studio — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Studio"
        title="Your studio: record and go live with guests"
        lead={<>Your studio is yours any time. Bring guests in on a link, switch scenes, show your logo and banners, record, and go live if you like. What you record lands in your Library, ready for Pōstify.</>}
        toc={[["#enter", "Go into your studio"], ["#invite", "Invite a guest"], ["#scenes", "Scenes and your look"], ["#backstage", "On stage and backstage"], ["#record", "Record"], ["#live", "Go live"], ["#keys", "Streaming keys"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="enter" title="Go into your studio">
          <HelpStep k="a">Sign in to your dashboard and press <strong>Studio</strong> in the menu.</HelpStep>
          <HelpStep k="b">Check your camera and microphone, and your name as it shows on screen. A title is optional.</HelpStep>
          <HelpStep k="c">Press <strong>Enter studio</strong>. Going in doesn't start anything: you choose when to record and when to go live.</HelpStep>
          <HelpNote>No picture or sound? Your browser needs your OK. Press the camera icon in the address bar, allow the camera and microphone for this site, then reload the page.</HelpNote>
          <p className="mt-4">The bar at the bottom has Mic, Camera, Share (your screen), Invite, Notes, Settings and Leave. When you leave, you'll see <strong>You've left your studio</strong>. Press <strong>Go back in</strong>, or <strong>Open your Library</strong> to see what you recorded.</p>
        </HelpSection>

        <HelpSection n={2} id="invite" title="Invite a guest">
          <p>Your studio has one invite link. Guests don't need an account. They open the link, type their name, and press <strong>Join</strong>.</p>
          <HelpStep k="a">In your studio, press <strong>Invite guests</strong> at the top. It copies your link.</HelpStep>
          <HelpStep k="b">Send it to your guest by text or email.</HelpStep>
          <HelpStep k="c">They check their camera and mic, type their name and press <strong>Join</strong>.</HelpStep>
          <HelpSub>Want a fresh link?</HelpSub>
          <p className="mt-2">On your dashboard's Studio screen, press <strong>New link</strong>. The old link stops working at once. Anyone who opens it is told to ask you for a new one.</p>
        </HelpSection>

        <HelpSection n={3} id="scenes" title="Scenes and your look">
          <p>On a computer, your scenes are on the left and <strong>Your look</strong> is on the right. What you change shows on the stage straight away, and it's what your recording and your live show see.</p>
          <HelpStep k="a"><strong>Scenes</strong> are what viewers see. <strong>People</strong> are who's in the room. Click a scene card, or press its number key (1 to 9), to put it on stage. The one on stage says <strong>ON STAGE</strong>, and each card says who's on it. Press <strong>+ New scene</strong> and pick its type. A <strong>Media presentation</strong> asks what it shows: a clip, a picture or a shared screen.</HelpStep>
          <HelpStep k="b"><strong>Intro and outro video:</strong> add them at the top and bottom of the scenes, then press play to show one. The stage goes back to your people when it ends.</HelpStep>
          <HelpStep k="c"><strong>Play a video:</strong> press <strong>Present or invite</strong>, then <strong>Video file</strong>. It plays once, with its sound, for everyone in your studio and in the recording, then the stage goes back to your scene. Tick <strong>Loop it</strong> to keep it going until you stop presenting.</HelpStep>
          <HelpStep k="d"><strong>Your name on screen:</strong> open <strong>People</strong> and use your own row. Change the name, or switch <strong>Show my name</strong> off. To hide the show's logo, the host opens <strong>Media</strong> and picks <strong>None</strong> under Logo.</HelpStep>
          <HelpStep k="e"><strong>Your look:</strong> pick your logo and its corner, a background colour or picture, and banners. Press <strong>Show</strong> on a banner to put it on screen; it goes away by itself after its time.</HelpStep>
        </HelpSection>

        <HelpSection n={4} id="backstage" title="On stage and backstage">
          <p>Everyone in your studio shows on the stage unless you send them backstage. Under the stage, each guest has <strong>Send backstage</strong> and <strong>Bring on stage</strong>.</p>
          <p className="mt-3">A guest who's backstage can still hear you and talk to you, but isn't in the recording or the live show. They see "You're backstage" until you bring them on.</p>
        </HelpSection>

        <HelpSection n={5} id="record" title="Record">
          <HelpStep k="a">Open <strong>Recording</strong> on the right and press <strong>Start recording</strong>. A red timer shows it's running.</HelpStep>
          <HelpStep k="b">While it records, press <strong>Mark a clip</strong> at the top when something good happens. We'll have a clip of that moment waiting after the show.</HelpStep>
          <HelpStep k="c">Press <strong>Stop recording</strong> when you're done. It's in your Library a minute or two later, named after your show and the date. From there, Pōstify makes the clips and a clean episode.</HelpStep>
          <HelpNote>The recorder needs at least one camera on. If it doesn't start, turn a camera on and press Start recording again.</HelpNote>
        </HelpSection>

        <HelpSection n={6} id="live" title="Go live">
          <HelpStep k="a">In your studio, press <strong>Go live</strong> at the top. Pick <strong>YouTube</strong> or add a streaming key, check the title of your show, and go. No YouTube key yet? Paste your stream key right there, once.</HelpStep>
          <HelpStep k="b">A red <strong>LIVE</strong> timer shows you're on. Press <strong>Watch</strong> to see what your audience sees.</HelpStep>
          <HelpStep k="c">Press <strong>End live</strong> to stop. You can record and be live at the same time.</HelpStep>
          <HelpSub>Turn on live streaming first</HelpSub>
          <p className="mt-2">YouTube has to switch on live streaming for your channel before anyone can stream to it. In YouTube Studio, press <strong>Create</strong>, then <strong>Go live</strong>. YouTube asks for a phone number, and the first time can take up to a day. Do it before your first show, not on the day.</p>
          <p className="mt-3">If it isn't on yet, your studio says so. You can still go live on a streaming key while you wait.</p>
        </HelpSection>

        <HelpSection n={7} id="keys" title="Streaming keys">
          <p>Go live on Facebook, LinkedIn, Twitch, Kick and most others with a streaming key. Each gives you a server address and a key in its "Live" or "Stream" settings.</p>
          <HelpStep k="a">In <strong>Go live</strong>, press <strong>Add a key</strong>. Or, on your dashboard's Studio screen, press <strong>Add a streaming key</strong>.</HelpStep>
          <HelpStep k="b">Type a name (like Facebook), paste the server (it starts rtmp:// or rtmps://) and the stream key, then save it.</HelpStep>
          <HelpStep k="c">On the Studio screen, each key has a switch to turn it on or off for your next Go live. The bin removes it.</HelpStep>
          <p className="mt-3">You can add up to six. Go live needs at least one place to go: YouTube or a key.</p>
          <p className="mt-3">On Radio or Marathon day, your slot goes out from your Radio show or the green room, not your studio. See <a href="/prepare" className="font-medium text-primary hover:underline">the podcaster guide</a>.</p>
        </HelpSection>

        <HelpContact n={8} />

        <HelpCta icon={Video} text="Your studio is one press away: Studio, in your dashboard menu." label="Open my studio" href="/my-studio" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
