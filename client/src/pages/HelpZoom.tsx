import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { HelpArticle } from "@/components/HelpArticle";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Video } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const CONTACT = "hello@militaryvoices.ai";

/**
 * The Zoom app, start to finish: adding it, using it, removing it, and what
 * it can see. Zoom's Marketplace review reads this page (it's the app's
 * documentation link), so it has to be public and say exactly what the code
 * in server/zoom.ts and ZoomConnect.tsx does — the labels are the real ones.
 */
export default function HelpZoom() {
  useEffect(() => {
    document.title = "Zoom recordings — MilitaryVoices.ai help";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <HelpArticle
        eyebrow="Help · Your recordings"
        title="Your Zoom recordings, straight into your Library"
        lead={<>Connect your Zoom account to MilitaryVoices.ai once. Your cloud recordings then come into your Library, ready for Pōstify to make clips and a clean episode. The app only reads your recordings. It never changes, deletes or shares anything in your Zoom account.</>}
        toc={[["#add", "Adding the app"], ["#use", "Using it"], ["#remove", "Removing the app"], ["#data", "What we access and store"], ["#support", "Help and contact"]]}
      >
        <Section n={1} id="add" title="Adding the app">
          <p className="font-semibold text-foreground">Before you start, you need:</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <strong>A MilitaryVoices.ai podcaster account.</strong> Sign in at your{" "}
              <Link href="/host/dashboard" className="font-medium text-primary hover:underline">dashboard</Link> with your
              email and the 6-digit code we send you.
            </li>
            <li>
              <strong>A Zoom account with cloud recording switched on.</strong> Cloud recording comes with Zoom's paid plans.
              To check, sign in at zoom.us and open <strong>Settings → Recording</strong>. <strong>Cloud recording</strong>{" "}
              should be on.
            </li>
            <li>
              <strong>Recordings saved to the cloud.</strong> In a meeting, press <strong>Record</strong>, then{" "}
              <strong>Record to the Cloud</strong>. Recordings saved to your computer stay on your computer, so the app
              can't see them.
            </li>
          </ul>

          <p className="mt-6 font-semibold text-foreground">Then connect it:</p>
          <Step k="a" text={<>Sign in to your dashboard and open <strong>Integrations</strong>.</>} />
          <Step k="b" text={<>On the <strong>Zoom</strong> card, press <strong>Connect Zoom</strong>.</>} />
          <Step
            k="c"
            text={<>Zoom opens. Sign in if it asks, check what the MilitaryVoices app can see, and press <strong>Allow</strong>.</>}
          />
          <Step
            k="d"
            text={
              <>
                You're back on Integrations with <strong>"Zoom is connected"</strong>. The card now says{" "}
                <strong>Connected as</strong> and your Zoom email address.
              </>
            }
          />
          <p className="mt-5 text-sm text-muted-foreground">
            Pressed Decline by mistake? You'll see "Zoom wasn't connected". Nothing was saved, so press Connect Zoom again.
            If you see "That took too long", the approval waited more than 15 minutes. Press Connect Zoom again.
          </p>
          <div className="mt-5">
            <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
              <Link href="/host/dashboard/integrations">Open Integrations <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </Section>

        <Section n={2} id="use" title="Using it">
          <h3 className="font-semibold text-foreground">New recordings come in on their own</h3>
          <p className="mt-1">
            When Zoom finishes processing a cloud recording, it tells us, and the video comes into your Library. Zoom can
            take a while after the meeting ends. It emails you when the recording is ready, and ours starts coming in then.
          </p>
          <p className="mt-2">
            The switch on the Zoom card, <strong>Bring each new cloud recording into my Library on its own</strong>, turns
            this on and off. It's on when you first connect.
          </p>

          <h3 className="mt-6 font-semibold text-foreground">Bringing in past recordings</h3>
          <Step k="a" text={<>On the Zoom card, press <strong>Import past recordings</strong>.</>} />
          <Step
            k="b"
            text={<>You'll see your cloud recordings from the last 30 days, newest first, with the date, length and size.</>}
          />
          <Step
            k="c"
            text={<>Press <strong>Import</strong> next to the one you want. It changes to <strong>In your Library</strong>.</>}
          />
          <p className="mt-3">
            <strong>No video</strong> next to a recording means it has no MP4 video to bring in, such as an audio-only
            recording.
          </p>

          <h3 className="mt-6 font-semibold text-foreground">What happens next</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              Each recording shows in your{" "}
              <Link href="/host/dashboard/library" className="font-medium text-primary hover:underline">Library</Link> as its
              own episode. It says <strong>"Importing from Zoom…"</strong> for a few minutes while we copy it, then it's
              ready to play.
            </li>
            <li>
              Open the <strong>⋯</strong> menu on it and choose <strong>Pōstify it</strong> to make clips and a clean
              episode. You can also download it or move it to a folder.
            </li>
            <li>
              Zoom can save a meeting in several views. We keep one video: the shared screen with the speaker if there is
              one, otherwise the active speaker, otherwise any finished MP4.
            </li>
            <li>The recording stays in your Zoom account too. We copy it; we never move or delete it.</li>
          </ul>

          <h3 className="mt-6 font-semibold text-foreground">Good to know</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <strong>The list covers the last 30 days.</strong> For an older recording, download it from Zoom (zoom.us →
              Recordings) and upload it to your Library.
            </li>
            <li>
              <strong>MP4 video only.</strong> Audio-only files, chat and transcripts aren't brought in.
            </li>
            <li>
              <strong>Cloud recordings only.</strong> Upload recordings saved on your computer in the Library yourself.
            </li>
            <li>
              <strong>Recordings from before you connected</strong> don't come in on their own. Use Import past recordings.
            </li>
            <li>
              <strong>"Couldn't bring it in"</strong> on a Library card means the copy failed. Write to us and we'll look.
            </li>
          </ul>
        </Section>

        <Section n={3} id="remove" title="Removing the app">
          <p>You can remove it either way. Both delete the connection straight away.</p>

          <h3 className="mt-5 font-semibold text-foreground">From MilitaryVoices.ai</h3>
          <Step k="a" text={<>Sign in to your dashboard and open <strong>Integrations</strong>.</>} />
          <Step
            k="b"
            text={
              <>
                On the Zoom card, press <strong>Disconnect</strong>. You'll see <strong>"Zoom disconnected"</strong>. We ask
                Zoom to revoke our access and delete the connection.
              </>
            }
          />

          <h3 className="mt-6 font-semibold text-foreground">From Zoom</h3>
          <Step
            k="a"
            text={
              <>
                Sign in to the{" "}
                <a href="https://marketplace.zoom.us/" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  Zoom App Marketplace
                </a>
                .
              </>
            }
          />
          <Step k="b" text={<>Open <strong>Manage</strong>, then <strong>Added Apps</strong>.</>} />
          <Step
            k="c"
            text={<>Find <strong>MilitaryVoices</strong> and press <strong>Remove</strong>. Zoom tells us, and we delete the connection.</>}
          />

          <h3 className="mt-6 font-semibold text-foreground">What gets deleted, and what stays</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <strong>Deleted at once:</strong> your Zoom access and refresh tokens, your Zoom user ID, account ID and email
              address, and your automatic-import setting. New recordings stop coming in.
            </li>
            <li>
              <strong>Stays until you delete it:</strong> videos you already imported. They're yours to keep. To delete one,
              open your Library, press <strong>⋯</strong> on it, then <strong>Delete</strong>. That removes our copy of the
              video, with its clean and edited copies and its clips.
            </li>
            <li>
              A recording that was already coming in when you disconnected may still finish. Delete it from your Library if
              you don't want it.
            </li>
            <li>
              Want everything gone? Write to <a href={`mailto:${CONTACT}`} className="font-medium text-primary hover:underline">{CONTACT}</a>{" "}
              and we'll delete your account and all of your data.
            </li>
            <li>Nothing in your Zoom account changes. Your recordings stay in Zoom.</li>
          </ul>
        </Section>

        <Section n={4} id="data" title="What we access and store">
          <p>The app asks Zoom for three permissions. In plain words:</p>
          <ul className="mt-3 space-y-3">
            <Scope
              name="user:read:user"
              plain="See your Zoom profile."
              why="Read once, when you connect, for your Zoom user ID and email. That's how we match new recordings to you and show who's connected."
            />
            <Scope
              name="cloud_recording:read:list_user_recordings"
              plain="See the list of your cloud recordings."
              why="Used for the Import past recordings list."
            />
            <Scope
              name="cloud_recording:read:list_recording_files"
              plain="See the files in a recording."
              why="Used to find and download the MP4 of a recording you import, or of each new one while automatic import is on."
            />
          </ul>
          <p className="mt-4">
            Zoom also sends us two notices: when a new cloud recording is ready, and when you remove the app.
          </p>

          <h3 className="mt-6 font-semibold text-foreground">What we store</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              Your Zoom access and refresh tokens, Zoom user ID, account ID and email. They're kept in our database,
              encrypted at rest, and never sent to your browser. They're deleted when you disconnect or remove the app.
            </li>
            <li>
              The videos you import, in private storage (Cloudflare R2), with each meeting's topic, date, length and size so
              your Library can show them. They stay until you delete them.
            </li>
          </ul>

          <h3 className="mt-6 font-semibold text-foreground">What we never do</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>Change, delete or share anything in your Zoom account.</li>
            <li>Read your meetings, chats, contacts or calendar.</li>
            <li>Sell your data, or use it for advertising.</li>
          </ul>
          <p className="mt-4">
            The full detail, and your rights over your data, are in our{" "}
            <Link href="/privacy#zoom" className="font-medium text-primary hover:underline">privacy policy</Link>.
          </p>
        </Section>

        <Section n={5} id="support" title="Help and contact">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Email us:</strong>{" "}
              <a href={`mailto:${CONTACT}`} className="font-medium text-primary hover:underline">{CONTACT}</a>. A person reads
              every message and writes back.
            </li>
            <li>
              <strong>Search the help, or ask Alex:</strong>{" "}
              <Link href="/help" className="font-medium text-primary hover:underline">militaryvoices.ai/help</Link>.
            </li>
            <li>
              <strong>The small print:</strong>{" "}
              <Link href="/privacy" className="font-medium text-primary hover:underline">privacy policy</Link> and{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline">terms of service</Link>.
            </li>
          </ul>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B5CFF] text-white"><Video className="h-5 w-5" /></span>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">Ready? It takes about a minute.</p>
          <Button asChild className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
            <Link href="/host/dashboard/integrations">Connect my Zoom <ArrowRight className="h-4 w-4" /></Link>
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

function Scope({ name, plain, why }: { name: string; plain: string; why: string }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <p className="font-semibold text-foreground">{plain}</p>
      <code className="mt-1 inline-block break-all rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{name}</code>
      <p className="mt-2 text-sm text-muted-foreground">{why}</p>
    </li>
  );
}
