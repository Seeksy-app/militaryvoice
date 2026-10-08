import { useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { HelpArticle, HelpContact, HelpCta, HelpNote, HelpSection, HelpStep, HelpSub } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Video } from "lucide-react";

/**
 * Rooms: the quick, Zoom-like room every creator has. The labels are the
 * real ones on the Rooms screen (StudioHome.tsx) and in the room itself
 * (MyStudio.tsx); the messages are server/myStudio.ts's.
 */
export default function HelpRooms() {
  useEffect(() => {
    document.title = "Rooms — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Rooms"
        title="Your room: record and go live with guests"
        lead={<>Rooms is quick, like Zoom. Hop in any time and bring guests on a link. Record it or don't. Go live if you like. What you record lands in your Library, ready for Pōstify.</>}
        toc={[["#enter", "Go into your room"], ["#invite", "Invite a guest"], ["#record", "Record"], ["#live", "Go live"], ["#keys", "Streaming keys"], ["#studio", "Rooms or Studio?"], ["#support", "Help and contact"]]}
      >
        <HelpSection n={1} id="enter" title="Go into your room">
          <HelpStep k="a">Sign in to your dashboard and press <strong>Rooms</strong> in the menu.</HelpStep>
          <HelpStep k="b">Press <strong>Enter my room</strong>. Your room opens in its own page.</HelpStep>
          <HelpStep k="c">Check your camera and microphone. Pick the ones you want, and check <strong>Your name</strong>.</HelpStep>
          <HelpStep k="d">Press <strong>Enter my room</strong> again. You're in.</HelpStep>
          <p className="mt-4">Inside, you can see everyone as a grid or the speaker big, share your screen, and chat.</p>
          <HelpNote>No picture or sound? Your browser needs your OK. Press the camera icon in the address bar, allow the camera and microphone for this site, then reload the page.</HelpNote>
          <p className="mt-4">When you leave, you'll see <strong>You've left your room</strong>. Press <strong>Go back in</strong>, or <strong>Your Library</strong> to see what you recorded.</p>
        </HelpSection>

        <HelpSection n={2} id="invite" title="Invite a guest">
          <p>Your room has one invite link. Guests don't need an account. They open the link, type their name, and come straight in.</p>
          <HelpStep k="a">On the Rooms screen, under <strong>Invite a guest</strong>, press <strong>Copy link</strong>. In the room, press <strong>Invite a guest</strong> at the top. Both copy the same link.</HelpStep>
          <HelpStep k="b">Send it to your guest by text or email.</HelpStep>
          <HelpStep k="c">They check their camera and mic, type their name and press <strong>Join</strong>.</HelpStep>
          <HelpSub>Want a fresh link?</HelpSub>
          <p className="mt-2">Press <strong>New link</strong> on the Rooms screen. The old link stops working at once. Anyone who opens it is told to ask you for a new one.</p>
        </HelpSection>

        <HelpSection n={3} id="record" title="Record">
          <HelpStep k="a">In your room, press <strong>Record</strong> at the top. A red <strong>REC</strong> timer shows it's running. Everyone in the room sees it.</HelpStep>
          <HelpStep k="b">Press <strong>Stop recording</strong> when you're done.</HelpStep>
          <HelpStep k="c">It's in your Library in a minute or two, named after your show and the date. From there, Pōstify makes the clips and a clean episode.</HelpStep>
          <HelpNote>The recorder needs at least one camera on. If it doesn't start, turn a camera on and press Record again.</HelpNote>
        </HelpSection>

        <HelpSection n={4} id="live" title="Go live">
          <p><strong>Go live</strong> streams your room to everywhere switched on under <strong>When you go live</strong> on the Rooms screen, all at once.</p>
          <HelpStep k="a">On the Rooms screen, check <strong>YouTube</strong> is switched on. Each time you go live, it makes a new live video on your channel. Not connected yet? Press <strong>Connect YouTube</strong>.</HelpStep>
          <HelpStep k="b">In your room, press <strong>Go live</strong>. A red <strong>LIVE</strong> timer shows you're on. Press <strong>Watch on YouTube</strong> to see what your audience sees.</HelpStep>
          <HelpStep k="c">Press <strong>End live</strong> to stop. You can record and be live at the same time.</HelpStep>
          <HelpSub>Turn on live streaming first</HelpSub>
          <p className="mt-2">YouTube has to switch on live streaming for your channel before anyone can stream to it. In YouTube Studio, press <strong>Create</strong>, then <strong>Go live</strong>. YouTube asks for a phone number, and the first time can take up to a day. Do it before your first show, not on the day.</p>
          <p className="mt-3">If it isn't on yet, your room says so. You can still go live on a streaming key while you wait.</p>
        </HelpSection>

        <HelpSection n={5} id="keys" title="Streaming keys">
          <p>Go live on Facebook, LinkedIn, Twitch, Kick and most others with a streaming key. Each gives you a server address and a key in its "Live" or "Stream" settings.</p>
          <HelpStep k="a">On the Rooms screen, press <strong>Add a streaming key</strong>.</HelpStep>
          <HelpStep k="b">Type a name (like Facebook), paste the <strong>Server</strong> (it starts rtmp:// or rtmps://) and the <strong>Stream key</strong>, then press <strong>Add</strong>.</HelpStep>
          <HelpStep k="c">Use its switch to turn it on or off for your next Go live. The bin removes it.</HelpStep>
          <p className="mt-3">You can add up to six. Go live needs at least one place to go: YouTube or a key.</p>
        </HelpSection>

        <HelpSection n={6} id="studio" title="Rooms or Studio?">
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Rooms</strong> is here now: quick, with guests on a link, record, go live.</li>
            <li><strong>Studio</strong> is the full marathon studio for your own show: scenes, layouts, lower thirds and a producer console. It's coming soon.</li>
            <li>On Marathon day, your slot goes out from the green room, not your room. See <a href="/prepare" className="font-medium text-primary hover:underline">the podcaster guide</a>.</li>
          </ul>
        </HelpSection>

        <HelpContact n={7} />

        <HelpCta icon={Video} text="Your invite link and where going live goes are on the Rooms screen." label="Open Rooms" href="/host/dashboard/rooms" />
      </HelpArticle>
      <SiteFooter />
    </div>
  );
}
